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
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL ?? 'https://brakup.app').replace(/\/$/, '')

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

async function listBracketBlobs() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return []
  const blobs: Array<{ pathname: string; url: string }> = []
  let cursor: string | undefined

  do {
    const result = await list({
      prefix: 'challenge/',
      limit: 1000,
      cursor,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    blobs.push(...result.blobs.filter((blob) => blob.pathname.endsWith('/brackets.json')).map((blob) => ({
      pathname: blob.pathname,
      url: blob.url,
    })))
    cursor = result.hasMore ? result.cursor : undefined
  } while (cursor)

  return blobs
}

function normalizePseudo(value: string) {
  return value.trim().toLowerCase()
}

function sanitizePseudo(value: string) {
  return value.trim().slice(0, 40)
}

function sanitizeBracketName(value: string) {
  return value.trim().slice(0, 60)
}

async function findCredentialConflicts(params: { emailHash: string; pseudo: string; ignoreEmailHash?: string }) {
  const bracketBlobs = await listBracketBlobs()
  let pseudoExists = false
  let emailExists = false
  const normalizedPseudo = normalizePseudo(params.pseudo)

  for (const blob of bracketBlobs) {
    const ownerHash = blob.pathname.replace(/^challenge\/(.+)\/brackets\.json$/, '$1')
    if (params.ignoreEmailHash && ownerHash === params.ignoreEmailHash) continue

    const response = await fetch(blob.url, { cache: 'no-store' })
    if (!response.ok) continue
    const entries = await response.json() as ChallengeEntry[]

    if (!pseudoExists) {
      pseudoExists = entries.some((entry) => normalizePseudo(entry.pseudo ?? '') === normalizedPseudo)
    }
    if (!emailExists) {
      emailExists = entries.some((entry) => entry.emailHash === params.emailHash)
    }
    if (pseudoExists && emailExists) break
  }

  return { exists: pseudoExists || emailExists, pseudoExists, emailExists }
}

async function readAllBracketEntries(): Promise<ChallengeEntry[]> {
  const bracketBlobs = await listBracketBlobs()
  const allEntries: ChallengeEntry[] = []

  for (const blob of bracketBlobs) {
    const response = await fetch(blob.url, { cache: 'no-store' })
    if (!response.ok) continue
    const entries = await response.json() as ChallengeEntry[]
    allEntries.push(...entries)
  }

  return allEntries
}

function rankSubmittedEntries(entries: ChallengeEntry[]): ChallengeEntry[] {
  const ranked = entries
    .filter((entry) => entry.submittedAt)
    .sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))
    .map((entry, index) => ({ ...entry, rank: index + 1 }))

  return ranked.slice(0, 50)
}

async function rebuildLeaderboardFromStoredScores(): Promise<ChallengeEntry[]> {
  const ranked = rankSubmittedEntries(await readAllBracketEntries())
  await writeJson('challenge/leaderboard.json', ranked)
  return ranked
}

async function sendMagicLink(email: string, token: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[brakup] RESEND_API_KEY absent, lien magique non envoyé.')
    return false
  }
  const origin = PUBLIC_SITE_URL
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
      html: `<p>Ton accès Brakup est prêt.</p><p>Your Brakup access is ready.</p><p><a href="${origin}/?challenge&token=${encodeURIComponent(token)}">Accéder à mes brackets / Open my brackets</a></p>`,
    }),
  })
  return response.ok
}

async function sendOTPEmail(email: string, pseudo: string, otp: string, origin: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[brakup] RESEND_API_KEY absent, email OTP non envoyé.')
    return false
  }
  const otpUrl = `${origin}/?challenge&otp=1&pseudo=${encodeURIComponent(pseudo)}&email=${encodeURIComponent(email)}`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.BRAKUP_FROM_EMAIL ?? 'brakup@ton-domaine.com',
      to: email,
      subject: `Ton code OTP Brakup pour ${pseudo}`,
      html: `<p>Ton code de connexion Brakup est : <strong style="font-size: 24px; letter-spacing: 4px;">${otp}</strong></p><p>Your Brakup login code is: <strong style="font-size: 24px; letter-spacing: 4px;">${otp}</strong></p><p>Ce code expire dans 15 minutes. This code expires in 15 minutes.</p><p>Rends-toi sur <a href="${otpUrl}">Brakup</a> et entre ce code pour te connecter.</p>`,
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
  const bracketBlobs = await listBracketBlobs()
  const allEntries: ChallengeEntry[] = []

  for (const blob of bracketBlobs) {
    const response = await fetch(blob.url, { cache: 'no-store' })
    if (!response.ok) continue
    const entries = await response.json() as ChallengeEntry[]
    const scored = entries.map((entry) => ({ ...entry, ...calculateScore(entry, realResults) }))
    await writeJson(blob.pathname, scored)
    allEntries.push(...scored.filter((entry) => entry.submittedAt))
  }

  await writeJson('challenge/leaderboard.json', rankSubmittedEntries(allEntries))
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
      const board = process.env.BLOB_READ_WRITE_TOKEN
        ? await rebuildLeaderboardFromStoredScores()
        : await readJson<ChallengeEntry[]>('challenge/leaderboard.json', [])
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
      const current = input.id ? entries.find((entry) => entry.id === input.id) : entries[0]
      const pseudo = sanitizePseudo(input.pseudo)
      const bracketName = sanitizeBracketName(input.bracketName)
      const conflicts = await findCredentialConflicts({ emailHash, pseudo, ignoreEmailHash: emailHash })
      if (conflicts.pseudoExists) {
        res.status(409).json({ error: `Le pseudo "${pseudo}" est déjà utilisé.` })
        return
      }
      const entry: ChallengeEntry = {
        id: current?.id ?? crypto.randomUUID(),
        emailHash,
        pseudo,
        bracketName,
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
      const updated = [entry]
      await writeJson(pathname, updated)
      const board = await rebuildLeaderboardFromStoredScores()
      const rankedEntry = board.find((item) => item.id === entry.id) ?? entry
      const token = await signToken(emailHash)
      await sendMagicLink(input.email, token)
      res.status(200).json({ data: { entry: rankedEntry, token } })
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

    if (action === 'checkPseudo') {
      const pseudo = String(body.pseudo ?? '')
      if (!pseudo.trim()) {
        res.status(400).json({ error: 'Pseudo requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      const bracketBlobs = await listBracketBlobs()

      for (const blob of bracketBlobs) {
        const response = await fetch(blob.url, { cache: 'no-store' })
        if (!response.ok) continue
        const entries = await response.json() as ChallengeEntry[]
        const exists = entries.some((entry) => normalizePseudo(entry.pseudo ?? '') === normalizePseudo(pseudo))
        if (exists) {
          res.status(200).json({ data: { exists: true } })
          return
        }
      }
      res.status(200).json({ data: { exists: false } })
      return
    }

    if (action === 'checkCredentials') {
      const email = String(body.email ?? '')
      const pseudo = String(body.pseudo ?? '')
      if (!email.includes('@') || !pseudo.trim()) {
        res.status(400).json({ error: 'Email et pseudo requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      const emailHash = await sha256(email)
      const conflicts = await findCredentialConflicts({ emailHash, pseudo })
      res.status(200).json({ data: conflicts })
      return
    }

    if (action === 'requestOTP') {
      const email = String(body.email ?? '')
      const pseudo = String(body.pseudo ?? '')
      if (!email.includes('@') || !pseudo.trim()) {
        res.status(400).json({ error: 'Email et pseudo requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.RESEND_API_KEY) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      
      const emailHash = await sha256(email)
      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const otpPathname = `challenge/otp/${emailHash}.json`
      const otpData = { email, pseudo, otp, expiresAt: Date.now() + 15 * 60 * 1000 }
      await writeJson(otpPathname, otpData)
      
      const origin = PUBLIC_SITE_URL
      const sent = await sendOTPEmail(email, pseudo, otp, origin)
      
      if (sent) {
        res.status(200).json({ data: { sent: true } })
      } else {
        res.status(500).json({ error: 'Echec de l\'envoi de l\'email OTP.' })
      }
      return
    }

    if (action === 'verifyOTP') {
      const email = String(body.email ?? '')
      const pseudo = String(body.pseudo ?? '')
      const otp = String(body.otp ?? '')
      if (!email.includes('@') || !pseudo.trim() || !otp || otp.length !== 6) {
        res.status(400).json({ error: 'Email, pseudo et code OTP (6 chiffres) requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      
      const emailHash = await sha256(email)
      const otpPathname = `challenge/otp/${emailHash}.json`
      const otpData = await readJson<{ email: string; pseudo: string; otp: string; expiresAt: number }>(otpPathname, null)
      
      if (!otpData || otpData.otp !== otp || otpData.expiresAt < Date.now()) {
        res.status(401).json({ error: 'Code OTP invalide ou expiré.' })
        return
      }
      
      const token = await signToken(emailHash)
      await writeJson(otpPathname, {}) // Invalider le code OTP
      
      res.status(200).json({ data: { token } })
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
      const bracketBlobs = await listBracketBlobs()
      
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

    if (action === 'profileStatus') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expiré ou invalide.' })
        return
      }
      const entries = await readJson<ChallengeEntry[]>(`challenge/${payload.emailHash}/brackets.json`, [])
      const latestEntry = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
      res.status(200).json({
        data: {
          blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
          bracketCount: entries.length,
          hasEntries: entries.length > 0,
          emailHash: payload.emailHash,
          pseudo: latestEntry?.pseudo ?? '',
          lastSavedAt: latestEntry?.createdAt ?? null,
        },
      })
      return
    }

    if (action === 'updateProfile') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expiré ou invalide.' })
        return
      }
      const email = String(body.email ?? '')
      const pseudo = sanitizePseudo(String(body.pseudo ?? ''))
      if (!email.includes('@') || !pseudo) {
        res.status(400).json({ error: 'Email et pseudo requis.' })
        return
      }

      const currentPath = `challenge/${payload.emailHash}/brackets.json`
      const currentEntries = await readJson<ChallengeEntry[]>(currentPath, [])
      const nextEmailHash = await sha256(email)
      const conflicts = await findCredentialConflicts({
        emailHash: nextEmailHash,
        pseudo,
        ignoreEmailHash: payload.emailHash,
      })

      if (conflicts.pseudoExists) {
        res.status(409).json({ error: `Le pseudo "${pseudo}" est déjà utilisé.` })
        return
      }
      if (conflicts.emailExists) {
        res.status(409).json({ error: `Un compte existe déjà avec l'email "${email}".` })
        return
      }

      const updatedEntries = currentEntries.map((entry) => ({
        ...entry,
        emailHash: nextEmailHash,
        pseudo,
      }))
      await writeJson(`challenge/${nextEmailHash}/brackets.json`, updatedEntries)
      if (nextEmailHash !== payload.emailHash) {
        await writeJson(currentPath, [])
      }
      await rebuildLeaderboardFromStoredScores()
      const nextToken = await signToken(nextEmailHash)
      res.status(200).json({
        data: {
          token: nextToken,
          entries: updatedEntries,
          profile: {
            email,
            pseudo,
            bracketCount: updatedEntries.length,
            blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
          },
        },
      })
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
