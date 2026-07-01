import type { ChallengeEntry, PublicBracketShare, SimulatorBracketEntry } from '../types'

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

type ChallengeResponse<T> = { data: T; token?: string }

async function request<T>(action: string, body: Record<string, unknown> = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/challenge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    })
  } catch {
    throw new Error('Connexion Brakup interrompue. Ton résultat reste sauvegardé sur cet appareil.')
  }
  const contentType = response.headers.get('content-type') ?? ''
  let payload: (ChallengeResponse<T> & { error?: string }) | null = null
  if (contentType.includes('application/json')) {
    payload = await response.json() as ChallengeResponse<T> & { error?: string }
  } else {
    await response.text()
    if (!response.ok) throw new Error('Service Brakup indisponible. Ton brouillon reste sauvegardé sur cet appareil.')
  }
  if (!payload) throw new Error('Réponse Brakup invalide.')
  if (!response.ok) throw new Error(payload.error ?? 'Service Brakup indisponible.')
  return payload.data
}

const LOCAL_STORAGE_KEY = 'brakup:localBrackets'
const LOCAL_SIMULATOR_STORAGE_KEY = 'brakup:localSimulatorBracket'
const LOCAL_TOKEN = 'brakup-local-development-token'

function localEntries(): ChallengeEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? '[]') as ChallengeEntry[]
  } catch {
    return []
  }
}

function saveLocalEntries(entries: ChallengeEntry[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries))
}

function localSimulatorEntry(): SimulatorBracketEntry | null {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SIMULATOR_STORAGE_KEY) ?? 'null') as SimulatorBracketEntry | null
  } catch {
    return null
  }
}

function saveLocalSimulatorEntry(entry: SimulatorBracketEntry) {
  localStorage.setItem(LOCAL_SIMULATOR_STORAGE_KEY, JSON.stringify(entry))
}

export async function submitBracket(entry: Partial<ChallengeEntry> & { email: string }, token?: string): Promise<{ entry: ChallengeEntry; token: string }> {
  try {
    return await request('submit', { entry }, token)
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const entries = localEntries()
    const current = entry.id ? entries.find((item) => item.id === entry.id) : undefined
    const next: ChallengeEntry = {
      id: current?.id ?? crypto.randomUUID(),
      emailHash: 'local',
      pseudo: entry.pseudo ?? current?.pseudo ?? 'Joueur',
      bracketName: entry.bracketName ?? current?.bracketName ?? 'Mon bracket',
      picks: entry.picks ?? current?.picks ?? {},
      battleScores: entry.battleScores ?? current?.battleScores ?? {},
      scorers: entry.scorers ?? current?.scorers ?? {},
      score: Math.max(0, Math.round(entry.score ?? current?.score ?? 0)),
      rank: null,
      submittedAt: entry.submittedAt ?? null,
      breakdown: entry.breakdown ?? current?.breakdown ?? {},
      battleBonuses: entry.battleBonuses ?? current?.battleBonuses ?? 0,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    }
    saveLocalEntries(current ? entries.map((item) => item.id === next.id ? next : item) : [...entries, next])
    return { entry: next, token: LOCAL_TOKEN }
  }
}

export async function getBrackets(token: string): Promise<ChallengeEntry[]> {
  if (import.meta.env.DEV && token === LOCAL_TOKEN) return localEntries()
  try {
    return await request('get', {}, token)
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    return localEntries()
  }
}

export async function getLeaderboard(): Promise<ChallengeEntry[]> {
  try {
    return await request('board')
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    return localEntries().filter((entry) => entry.submittedAt).sort((a, b) => b.score - a.score).slice(0, 50)
  }
}

export async function getSimulatorLeaderboard(): Promise<SimulatorBracketEntry[]> {
  try {
    return await request('simulatorBoard')
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const current = localSimulatorEntry()
    return current ? [{ ...current, rank: 1 }] : []
  }
}

export async function getBracketById(entryId: string): Promise<ChallengeEntry | null> {
  try {
    return await request<ChallengeEntry>('getById', { entryId })
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const allEntries = localEntries()
    return allEntries.find((entry) => entry.id === entryId) ?? null
  }
}

export async function checkPseudo(pseudo: string): Promise<boolean> {
  try {
    const result = await request<{ exists: boolean }>('checkPseudo', { pseudo })
    return result.exists
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const allEntries = localEntries()
    return allEntries.some((entry) => entry.pseudo?.toLowerCase() === pseudo.toLowerCase())
  }
}

export async function checkEmailOrPseudo(email: string, pseudo: string): Promise<{ exists: boolean; message: string }> {
  try {
    const result = await request<{ exists: boolean; emailExists: boolean; pseudoExists: boolean }>('checkCredentials', { email, pseudo })
    if (result.pseudoExists) {
      return { exists: true, message: `Un joueur existe déjà avec le pseudo "${pseudo}".` }
    }
    if (result.emailExists) {
      return { exists: true, message: `Un joueur existe déjà avec l'email "${email}".` }
    }
    return { exists: false, message: '' }
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const allEntries = localEntries()
    const pseudoExists = allEntries.some((entry) => entry.pseudo?.toLowerCase() === pseudo.toLowerCase())
    const emailHash = await sha256(email)
    const emailExists = allEntries.some((entry) => entry.emailHash === emailHash)
    if (pseudoExists) {
      return { exists: true, message: `Un joueur existe déjà avec le pseudo "${pseudo}".` }
    }
    if (emailExists) {
      return { exists: true, message: `Un joueur existe déjà avec l'email "${email}".` }
    }
    return { exists: false, message: '' }
  }
}

export async function requestOTP(email: string, pseudo: string): Promise<boolean> {
  try {
    const result = await request<{ sent: boolean }>('requestOTP', { email, pseudo })
    return result.sent
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    console.warn('OTP request failed in dev mode:', error)
    return true // In dev mode, pretend it was sent
  }
}

export async function verifyOTP(email: string, pseudo: string, otp: string): Promise<string> {
  try {
    const result = await request<{ token: string }>('verifyOTP', { email, pseudo, otp })
    return result.token
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    // In dev mode, return a local token
    return LOCAL_TOKEN
  }
}

export async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const result = await request<{ emailExists: boolean; pseudoExists: boolean }>('checkCredentials', { email, pseudo: '__noop__' })
    return result.emailExists
  } catch {
    return false
  }
}

export function resendMagicLink(email: string): Promise<{ sent: boolean; token?: string }> {
  return request('resend', { email })
}

export async function verifyLoginOTP(email: string, otp: string, pseudo?: string): Promise<{ token: string; needsProfile: boolean; email: string }> {
  try {
    const result = await request<{ token: string; needsProfile: boolean; email: string }>('verifyLoginOTP', { email, otp, pseudo })
    return result
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    return { token: LOCAL_TOKEN, needsProfile: false, email }
  }
}

export function getProfileStatus(token: string): Promise<{
  blobConfigured: boolean
  bracketCount: number
  hasEntries: boolean
  emailHash: string
  pseudo: string
  lastSavedAt: string | null
}> {
  return request('profileStatus', {}, token)
}

export async function getSeenOutcomeKeys(token: string): Promise<string[]> {
  try {
    const result = await request<{ keys: string[] }>('getSeenOutcomes', {}, token)
    return Array.isArray(result.keys) ? result.keys.filter((key): key is string => typeof key === 'string') : []
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    return []
  }
}

export async function markSeenOutcomeKeys(token: string, keys: string[]): Promise<string[]> {
  try {
    const result = await request<{ keys: string[] }>('markSeenOutcomes', { keys }, token)
    return Array.isArray(result.keys) ? result.keys.filter((key): key is string => typeof key === 'string') : []
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const current = new Set<string>()
    try {
      const parsed = JSON.parse(localStorage.getItem('brakup:seen-outcomes') ?? '[]') as unknown
      if (Array.isArray(parsed)) {
        for (const key of parsed) if (typeof key === 'string') current.add(key)
      }
    } catch {
      // local fallback only
    }
    keys.forEach((key) => current.add(key))
    localStorage.setItem('brakup:seen-outcomes', JSON.stringify([...current]))
    return [...current]
  }
}

export async function getSimulatorBracket(token: string): Promise<SimulatorBracketEntry | null> {
  if (import.meta.env.DEV && token === LOCAL_TOKEN) return localSimulatorEntry()
  try {
    return await request<SimulatorBracketEntry | null>('getSimulatorBracket', {}, token)
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    return localSimulatorEntry()
  }
}


export async function getSimulatorBracketByPseudo(pseudo: string): Promise<SimulatorBracketEntry | null> {
  try {
    return await request<SimulatorBracketEntry | null>('getSimulatorBracketByPseudo', { pseudo })
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const current = localSimulatorEntry()
    return current && current.pseudo.toLowerCase() === pseudo.toLowerCase() ? current : null
  }
}
export async function saveSimulatorBracket(
  token: string,
  entry: Pick<SimulatorBracketEntry, 'pseudo' | 'bracketName' | 'overrides' | 'knockoutPicks'> & Pick<SimulatorBracketEntry, 'score' | 'scoreBreakdown' | 'completeBonus'>,
): Promise<SimulatorBracketEntry> {
  try {
    return await request<SimulatorBracketEntry>('saveSimulatorBracket', { entry }, token)
  } catch (error) {
    if (!import.meta.env.DEV) throw error
    const current = localSimulatorEntry()
    const now = new Date().toISOString()
    const next: SimulatorBracketEntry = {
      emailHash: current?.emailHash ?? 'local',
      pseudo: entry.pseudo || current?.pseudo || 'Joueur',
      bracketName: entry.bracketName || current?.bracketName || 'Simulator',
      overrides: entry.overrides ?? current?.overrides ?? {},
      knockoutPicks: entry.knockoutPicks ?? current?.knockoutPicks ?? {},
      score: Math.max(0, Math.round(entry.score ?? current?.score ?? 0)),
      scoreBreakdown: entry.scoreBreakdown ?? current?.scoreBreakdown ?? {},
      completeBonus: entry.completeBonus ?? current?.completeBonus ?? 0,
      rank: current?.rank ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    saveLocalSimulatorEntry(next)
    return next
  }
}


export async function publishPublicBracketShare(payload: {
  pseudo: string
  bracketName: string
  overrides: PublicBracketShare['overrides']
  knockoutPicks: PublicBracketShare['knockoutPicks']
  imageDataUrl: string
  expiresInDays?: number
}): Promise<{ share: PublicBracketShare; shareUrl: string }> {
  const response = await fetch('/api/bracket-share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as { data?: { share: PublicBracketShare; shareUrl: string }; error?: string }
  if (!response.ok || !body.data) throw new Error(body.error ?? 'Partage indisponible.')
  return body.data
}

export async function publishResultShare(payload: {
  title: string
  description: string
  redirectUrl: string
  imageDataUrl: string
  pseudo?: string
  expiresInDays?: number
}): Promise<{ share: PublicBracketShare; shareUrl: string }> {
  const response = await fetch('/api/bracket-share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'result',
      pseudo: payload.pseudo ?? 'Brakup',
      bracketName: 'Resultat Brakup',
      title: payload.title,
      description: payload.description,
      redirectUrl: payload.redirectUrl,
      imageDataUrl: payload.imageDataUrl,
      overrides: {},
      knockoutPicks: {},
      expiresInDays: payload.expiresInDays,
    }),
  })
  const body = await response.json() as { data?: { share: PublicBracketShare; shareUrl: string }; error?: string }
  if (!response.ok || !body.data) throw new Error(body.error ?? 'Partage indisponible.')
  return body.data
}

export async function getPublicBracketShare(id: string): Promise<PublicBracketShare> {
  const response = await fetch(`/api/bracket-share?id=${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  })
  const body = await response.json() as { data?: PublicBracketShare; error?: string }
  if (!response.ok || !body.data) throw new Error(body.error ?? 'Bracket partage indisponible.')
  return body.data
}

export function updateProfile(token: string, values: { email: string; pseudo: string }): Promise<{
  token: string
  entries: ChallengeEntry[]
  profile: {
    email: string
    pseudo: string
    bracketCount: number
    blobConfigured: boolean
  }
}> {
  return request('updateProfile', values, token)
}
