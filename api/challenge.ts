import { get, list, put } from '@vercel/blob'
import type { ChallengeEntry, SimulatorBracketEntry } from '../src/types'

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
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? process.env.BRAKUP_FROM_EMAIL ?? 'Brakup <no-reply@brakup.app>'
const BLOB_ACCESS = process.env.BRAKUP_BLOB_ACCESS === 'public' ? 'public' : 'private'

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

async function signingKey() {
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
  const result = await get(pathname, {
    access: BLOB_ACCESS,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    useCache: false,
  })
  if (!result || result.statusCode !== 200 || !result.stream) return fallback
  const text = await new Response(result.stream).text()
  return text.trim() ? JSON.parse(text) as T : fallback
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn(`[brakup] BLOB_READ_WRITE_TOKEN absent, écriture ignorée: ${pathname}`)
    return
  }
  await put(pathname, JSON.stringify(value), {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
}

async function listBracketBlobs() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return []
  const blobs: Array<{ pathname: string }> = []
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
    })))
    cursor = result.hasMore ? result.cursor : undefined
  } while (cursor)

  return blobs
}

async function listSimulatorBlobs() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return []
  const blobs: Array<{ pathname: string }> = []
  let cursor: string | undefined

  do {
    const result = await list({
      prefix: 'challenge/',
      limit: 1000,
      cursor,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    blobs.push(...result.blobs.filter((blob) => blob.pathname.endsWith('/simulator.json')).map((blob) => ({
      pathname: blob.pathname,
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

    const entries = await readJson<ChallengeEntry[]>(blob.pathname, [])

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
    const entries = await readJson<ChallengeEntry[]>(blob.pathname, [])
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

async function readAllSimulatorEntries(): Promise<SimulatorBracketEntry[]> {
  const blobs = await listSimulatorBlobs()
  const entries: SimulatorBracketEntry[] = []
  for (const blob of blobs) {
    const entry = await readJson<SimulatorBracketEntry | null>(blob.pathname, null)
    if (entry && entry.pseudo && Object.keys(entry.knockoutPicks ?? {}).length > 0) entries.push(entry)
  }
  return entries
}

function rankSimulatorEntries(entries: SimulatorBracketEntry[]): SimulatorBracketEntry[] {
  return entries
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.updatedAt.localeCompare(b.updatedAt))
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}

function emailAssetUrl(pathname: string) {
  return `${PUBLIC_SITE_URL}${pathname}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function brakupEmailTemplate(params: {
  eyebrow: string
  title: string
  intro: string
  body: string
  ctaLabel: string
  ctaUrl: string
  footerNote: string
  code?: string
}) {
  const headerUrl = emailAssetUrl('/brakup-email-header.png')
  const eyebrow = escapeHtml(params.eyebrow)
  const title = escapeHtml(params.title)
  const intro = escapeHtml(params.intro)
  const body = escapeHtml(params.body)
  const ctaLabel = escapeHtml(params.ctaLabel)
  const footerNote = escapeHtml(params.footerNote)
  const code = params.code ? escapeHtml(params.code) : null

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;background:#050712;color:#eef3ff;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050712;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0a1224;border:1px solid rgba(255,255,255,.12);border-radius:24px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45);">
            <tr>
              <td style="background:#090b1f;">
                <img src="${headerUrl}" width="640" alt="" style="display:block;width:100%;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 34px;">
                <div style="color:#2bff9a;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px;">${eyebrow}</div>
                <h1 style="margin:0 0 14px;color:#ffffff;font-size:34px;line-height:1.05;font-weight:900;">${title}</h1>
                <p style="margin:0 0 16px;color:#c9d3e6;font-size:17px;line-height:1.55;">${intro}</p>
                <p style="margin:0 0 22px;color:#9aa8c0;font-size:15px;line-height:1.65;">${body}</p>
                ${code ? `<div style="margin:22px 0;padding:18px 20px;border:1px solid rgba(43,255,154,.35);border-radius:16px;background:#07192b;text-align:center;"><div style="color:#8795aa;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;">Code de connexion</div><div style="color:#ffffff;font-family:'Courier New',monospace;font-size:34px;font-weight:900;letter-spacing:.22em;">${code}</div></div>` : ''}
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 22px;">
                  <tr>
                    <td style="border-radius:999px;background:#2bff9a;">
                      <a href="${params.ctaUrl}" style="display:inline-block;padding:15px 24px;color:#04110c;text-decoration:none;font-size:14px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;">${ctaLabel}</a>
                    </td>
                  </tr>
                </table>
                <div style="padding:16px;border:1px solid rgba(255,184,0,.28);border-radius:16px;background:rgba(255,184,0,.08);color:#ffd978;font-size:14px;line-height:1.55;">
                  Fais ton prono en jouant le match a notre maniere : choisis ton equipe, vise le bon score, trouve les buteurs et vois si ton instinct merite le haut du classement.
                </div>
                <p style="margin:22px 0 0;color:#66748a;font-size:12px;line-height:1.5;">${footerNote}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

async function sendMagicLink(email: string, token: string, otp?: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[brakup] RESEND_API_KEY absent, lien magique non envoyé.')
    return false
  }
  const origin = PUBLIC_SITE_URL
  const linkUrl = `${origin}/challenge?token=${encodeURIComponent(token)}`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: email,
      subject: 'Ton acces Brakup est pret',
      html: brakupEmailTemplate({
        eyebrow: 'Lien magique',
        title: 'Ton bracket t attend',
        intro: 'Ton acces Brakup est pret. Ouvre ce lien sur ton appareil pour retrouver ton bracket, ton score et ta progression.',
        body: 'Chaque choix compte: vainqueur, score exact, buteurs et bonus de match. Reviens sur la carte, joue tes affiches et grimpe au classement.',
        ctaLabel: 'Ouvrir Brakup',
        ctaUrl: linkUrl,
        code: otp,
        footerNote: otp
          ? 'Le lien reste valable 30 jours. Le code expire dans 15 minutes. Si tu n as pas demande cet email, tu peux simplement l ignorer.'
          : 'Ce lien reste valable 30 jours. Si tu n as pas demande cet email, tu peux simplement l ignorer.',
      }),
    }),
  })
  return response.ok
}

async function sendOTPEmail(email: string, pseudo: string, otp: string, origin: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[brakup] RESEND_API_KEY absent, email OTP non envoyé.')
    return false
  }
  const otpUrl = `${origin}/challenge?otp=1&pseudo=${encodeURIComponent(pseudo)}&email=${encodeURIComponent(email)}`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: email,
      subject: `Ton code OTP Brakup pour ${pseudo}`,
      html: brakupEmailTemplate({
        eyebrow: 'Code de connexion',
        title: `Retour sur la pelouse, ${pseudo}`,
        intro: 'Utilise ce code pour reconnecter ton compte Brakup et recuperer ton bracket sur cet appareil.',
        body: 'Ton parcours reprend ou tu l avais laisse: pronostics, scores, buteurs et leaderboard. A toi de jouer juste.',
        ctaLabel: 'Entrer mon code',
        ctaUrl: otpUrl,
        code: otp,
        footerNote: 'Ce code expire dans 15 minutes. Si tu n as pas demande cet email, tu peux simplement l ignorer.',
      }),
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
    const entries = await readJson<ChallengeEntry[]>(blob.pathname, [])
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
      // Only send the magic link on first account creation, not on every subsequent save
      if (!current) {
        await sendMagicLink(input.email, token)
      }
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

    if (action === 'getSeenOutcomes') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expiré ou invalide.' })
        return
      }
      const keys = await readJson<string[]>(`challenge/${payload.emailHash}/seen-outcomes.json`, [])
      res.status(200).json({ data: { keys: Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [] } })
      return
    }

    if (action === 'markSeenOutcomes') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expiré ou invalide.' })
        return
      }
      const incoming = Array.isArray(body.keys) ? body.keys.filter((key): key is string => typeof key === 'string') : []
      const pathname = `challenge/${payload.emailHash}/seen-outcomes.json`
      const current = await readJson<string[]>(pathname, [])
      const merged = [...new Set([...(Array.isArray(current) ? current : []), ...incoming])].slice(-500)
      await writeJson(pathname, merged)
      res.status(200).json({ data: { keys: merged } })
      return
    }

    if (action === 'simulatorBoard') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      res.status(200).json({ data: rankSimulatorEntries(await readAllSimulatorEntries()) })
      return
    }

    if (action === 'getSimulatorBracket') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expire ou invalide.' })
        return
      }
      const entry = await readJson<SimulatorBracketEntry | null>(`challenge/${payload.emailHash}/simulator.json`, null)
      res.status(200).json({ data: entry })
      return
    }


    if (action === 'getSimulatorBracketByPseudo') {
      const pseudo = sanitizePseudo(String(body.pseudo ?? ''))
      if (!pseudo) {
        res.status(400).json({ error: 'Pseudo requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }

      const bracketBlobs = await listBracketBlobs()
      for (const blob of bracketBlobs) {
        const entries = await readJson<ChallengeEntry[]>(blob.pathname, [])
        if (!entries.some((entry) => normalizePseudo(entry.pseudo ?? '') === normalizePseudo(pseudo))) {
          continue
        }

        const emailHash = blob.pathname.split('/')[1]
        const simulator = await readJson<SimulatorBracketEntry | null>(`challenge/${emailHash}/simulator.json`, null)
        if (simulator) {
          res.status(200).json({ data: simulator })
          return
        }
      }

      res.status(404).json({ error: 'Bracket introuvable.' })
      return
    }
    if (action === 'saveSimulatorBracket') {
      const token = bearerToken(req) ?? String(body.token ?? '')
      const payload = token ? await verifyToken(token) : null
      if (!payload) {
        res.status(401).json({ error: 'Lien expire ou invalide.' })
        return
      }
      const input = (body.entry ?? {}) as Partial<SimulatorBracketEntry>
      const entries = await readJson<ChallengeEntry[]>(`challenge/${payload.emailHash}/brackets.json`, [])
      const latestEntry = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
      const current = await readJson<SimulatorBracketEntry | null>(`challenge/${payload.emailHash}/simulator.json`, null)
      const now = new Date().toISOString()
      const next: SimulatorBracketEntry = {
        emailHash: payload.emailHash,
        pseudo: sanitizePseudo(String(input.pseudo ?? latestEntry?.pseudo ?? current?.pseudo ?? 'Joueur')),
        bracketName: sanitizeBracketName(String(input.bracketName ?? current?.bracketName ?? 'Simulator')),
        overrides: input.overrides && typeof input.overrides === 'object' ? input.overrides : current?.overrides ?? {},
        knockoutPicks: input.knockoutPicks && typeof input.knockoutPicks === 'object' ? input.knockoutPicks : current?.knockoutPicks ?? {},
        score: Math.max(0, Math.round(Number(input.score ?? current?.score ?? 0))),
        scoreBreakdown: input.scoreBreakdown && typeof input.scoreBreakdown === 'object' ? input.scoreBreakdown : current?.scoreBreakdown ?? {},
        completeBonus: Math.max(0, Math.round(Number(input.completeBonus ?? current?.completeBonus ?? 0))),
        rank: current?.rank ?? null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      }
      await writeJson(`challenge/${payload.emailHash}/simulator.json`, next)
      res.status(200).json({ data: next })
      return
    }

    if (action === 'resend') {
      const email = String(body.email ?? '')
      if (!email.includes('@')) {
        res.status(400).json({ error: 'Email invalide.' })
        return
      }
      const emailHash = await sha256(email)
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Connexion indisponible: stockage Brakup non configuré.' })
        return
      }
      // Generer OTP et envoyer email dans tous les cas
      // La creation de compte se fera dans verifyLoginOTP si necessaire
      const token = await signToken(emailHash)
      const otp = String(Math.floor(100000 + Math.random() * 900000))
      await writeJson(`challenge/login-otp/${emailHash}.json`, {
        email,
        otp,
        expiresAt: Date.now() + 15 * 60 * 1000,
      })
      const sent = await sendMagicLink(email, token, otp)
      if (!sent) {
        res.status(502).json({ error: 'Email de connexion impossible à envoyer pour le moment.' })
        return
      }
      res.status(200).json({ data: { sent: true } })
      return
    }

    if (action === 'verifyLoginOTP') {
      const email = String(body.email ?? '')
      const otp = String(body.otp ?? '')
      if (!email.includes('@') || !otp || otp.length !== 6) {
        res.status(400).json({ error: 'Email et code OTP (6 chiffres) requis.' })
        return
      }
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Service Brakup indisponible.' })
        return
      }
      const emailHash = await sha256(email)
      const otpPathname = `challenge/login-otp/${emailHash}.json`
      const otpData = await readJson<{ email: string; otp: string; expiresAt: number } | null>(otpPathname, null)
      if (!otpData || otpData.otp !== otp || otpData.expiresAt < Date.now()) {
        res.status(401).json({ error: 'Code OTP invalide ou expiré.' })
        return
      }
      await writeJson(otpPathname, {})
      
      // Verifier si le compte existe
      const entries = await readJson<ChallengeEntry[]>(`challenge/${emailHash}/brackets.json`, [])
      if (entries.length === 0) {
        res.status(404).json({ error: 'Aucun compte Brakup trouvé pour cet email. Crée ton compte depuis le menu.' })
        return
      }
      
      const token = await signToken(emailHash)
      res.status(200).json({ 
        data: { 
          token,
          needsProfile: false,
          email
        } 
      })
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
        const entries = await readJson<ChallengeEntry[]>(blob.pathname, [])
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
      const otpData = await readJson<{ email: string; pseudo: string; otp: string; expiresAt: number } | null>(otpPathname, null)
      
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
        const entries = await readJson<ChallengeEntry[]>(blob.pathname, [])
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
      const simulatorPath = `challenge/${payload.emailHash}/simulator.json`
      const currentSimulator = await readJson<SimulatorBracketEntry | null>(simulatorPath, null)
      if (currentSimulator) {
        await writeJson(`challenge/${nextEmailHash}/simulator.json`, {
          ...currentSimulator,
          emailHash: nextEmailHash,
          pseudo,
          updatedAt: new Date().toISOString(),
        })
      }
      if (nextEmailHash !== payload.emailHash) {
        await writeJson(currentPath, [])
        await writeJson(simulatorPath, null)
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
