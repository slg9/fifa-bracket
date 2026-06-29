import { list, put } from '@vercel/blob'
import type { ChallengeEntry } from '../src/types'

type ApiRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

type TokenPayload = { emailHash: string; exp: number }

const encoder = new TextEncoder()
const DEV_SECRET = 'brakup-local-development-secret-32'

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function parseBody(req: ApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') return JSON.parse(req.body) as Record<string, unknown>
  return (req.body ?? {}) as Record<string, unknown>
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value.trim().toLowerCase()))
  return base64Url(new Uint8Array(digest))
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(process.env.JWT_SECRET ?? DEV_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signToken(emailHash: string): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload: TokenPayload = { emailHash, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 }
  const encodedPayload = base64Url(encoder.encode(JSON.stringify(payload)))
  const unsigned = `${header}.${encodedPayload}`
  const signature = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(unsigned))
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`
}

async function verifyToken(token: string): Promise<TokenPayload | null> {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return null
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(),
    Buffer.from(signature, 'base64url'),
    encoder.encode(`${header}.${payload}`),
  )
  if (!valid) return null
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload
  return parsed.exp > Math.floor(Date.now() / 1000) ? parsed : null
}

async function readJson<T>(pathname: string, fallback: T): Promise<T> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fallback
  const result = await list({ prefix: pathname, limit: 1, token: process.env.BLOB_READ_WRITE_TOKEN })
  const blob = result.blobs.find((item) => item.pathname === pathname)
  if (!blob) return fallback
  const response = await fetch(blob.url, { cache: 'no-store' })
  return response.ok ? response.json() as Promise<T> : fallback
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn(`[brakup] BLOB_READ_WRITE_TOKEN absent, écriture ignorée: ${pathname}`)
    return
  }
  await put(pathname, JSON.stringify(value), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
}

async function sendMagicLink(email: string, token: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[brakup] RESEND_API_KEY absent, lien magique non envoyé.')
    return false
  }
  const origin = process.env.PUBLIC_SITE_URL ?? 'http://localhost:5173'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.BRAKUP_FROM_EMAIL ?? 'brakup@ton-domaine.com',
      to: email,
      subject: 'Ton lien Brakup 🏆',
      html: `<p>Ton accès Brakup est prêt.</p><p><a href="${origin}/?challenge&token=${encodeURIComponent(token)}">Accéder à mes brackets</a></p>`,
    }),
  })
  return response.ok
}

function bearerToken(req: ApiRequest): string | null {
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  return value?.startsWith('Bearer ') ? value.slice(7) : null
}

export async function recalculateLeaderboard(realResults: Record<string, string>): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return
  const { calculateScore } = await import('../src/lib/scoring.ts')
  const result = await list({ prefix: 'challenge/', limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN })
  const bracketBlobs = result.blobs.filter((blob) => blob.pathname.endsWith('/brackets.json'))
  const allEntries: ChallengeEntry[] = []

  for (const blob of bracketBlobs) {
    const response = await fetch(blob.url, { cache: 'no-store' })
    if (!response.ok) continue
    const entries = await response.json() as ChallengeEntry[]
    const scored = entries.map((entry) => ({ ...entry, ...calculateScore(entry, realResults) }))
    await writeJson(blob.pathname, scored)
    allEntries.push(...scored.filter((entry) => entry.submittedAt))
  }

  allEntries.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
  const ranked = allEntries.map((entry, index) => ({ ...entry, rank: index + 1 }))
  await writeJson('challenge/leaderboard.json', ranked.slice(0, 50))
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }

  try {
    const body = parseBody(req)
    const action = String(body.action ?? '')

    if (action === 'board') {
      const board = await readJson<ChallengeEntry[]>('challenge/leaderboard.json', [])
      res.status(200).json({ data: board.slice(0, 50) })
      return
    }

    if (action === 'submit') {
      const input = (body.entry ?? {}) as Partial<ChallengeEntry> & { email?: string }
      if (!input.email || !input.pseudo?.trim() || !input.bracketName?.trim()) {
        res.status(400).json({ error: 'Email, pseudo et nom du bracket requis.' })
        return
      }
      const emailHash = await sha256(input.email)
      const pathname = `challenge/${emailHash}/brackets.json`
      const entries = await readJson<ChallengeEntry[]>(pathname, [])
      const current = input.id ? entries.find((entry) => entry.id === input.id) : undefined
      const entry: ChallengeEntry = {
        id: current?.id ?? crypto.randomUUID(),
        emailHash,
        pseudo: input.pseudo.trim().slice(0, 40),
        bracketName: input.bracketName.trim().slice(0, 60),
        picks: input.picks ?? current?.picks ?? {},
        battleScores: input.battleScores ?? current?.battleScores ?? {},
        scorers: input.scorers ?? current?.scorers ?? {},
        score: Math.max(0, Math.round(input.score ?? current?.score ?? 0)),
        rank: current?.rank ?? null,
        submittedAt: input.submittedAt ?? current?.submittedAt ?? null,
        breakdown: input.breakdown ?? current?.breakdown ?? {},
        battleBonuses: Math.min(40, Math.max(0, input.battleBonuses ?? current?.battleBonuses ?? 0)),
        createdAt: current?.createdAt ?? new Date().toISOString(),
      }
      const updated = current ? entries.map((item) => item.id === entry.id ? entry : item) : [...entries, entry]
      await writeJson(pathname, updated)
      const token = await signToken(emailHash)
      await sendMagicLink(input.email, token)
      res.status(200).json({ data: { entry, token } })
      return
    }

    if (action === 'get') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expiré ou invalide.' })
        return
      }
      const entries = await readJson<ChallengeEntry[]>(`challenge/${payload.emailHash}/brackets.json`, [])
      res.status(200).json({ data: entries })
      return
    }

    if (action === 'resend') {
      const email = String(body.email ?? '')
      if (!email.includes('@')) {
        res.status(400).json({ error: 'Email invalide.' })
        return
      }
      const token = await signToken(await sha256(email))
      const sent = await sendMagicLink(email, token)
      res.status(200).json({ data: { sent, ...(!sent ? { token } : {}) } })
      return
    }

    if (action === 'getById') {
      const entryId = String(body.entryId ?? '')
      if (!entryId) {
        res.status(400).json({ error: 'ID du bracket requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      const result = await list({ prefix: 'challenge/', limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN })
      const bracketBlobs = result.blobs.filter((blob) => blob.pathname.endsWith('/brackets.json'))
      
      for (const blob of bracketBlobs) {
        const response = await fetch(blob.url, { cache: 'no-store' })
        if (!response.ok) continue
        const entries = await response.json() as ChallengeEntry[]
        const entry = entries.find((e) => e.id === entryId)
        if (entry) {
          res.status(200).json({ data: entry })
          return
        }
      }
      res.status(404).json({ error: 'Bracket non trouvé.' })
      return
    }

    if (action === 'score') {
      const secret = String(body.secret ?? '')
      if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
        res.status(401).json({ error: 'Accès refusé.' })
        return
      }
      await recalculateLeaderboard((body.realResults ?? {}) as Record<string, string>)
      res.status(200).json({ data: { recalculated: true } })
      return
    }

    res.status(400).json({ error: 'Action inconnue.' })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Erreur Brakup.' })
  }
}
