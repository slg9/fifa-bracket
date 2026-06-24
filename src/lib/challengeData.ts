import type { ChallengeEntry } from '../types'

type ChallengeResponse<T> = { data: T; token?: string }

async function request<T>(action: string, body: Record<string, unknown> = {}, token?: string): Promise<T> {
  const response = await fetch('/api/challenge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  })
  const payload = await response.json() as ChallengeResponse<T> & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Service Brakup indisponible.')
  return payload.data
}

const LOCAL_STORAGE_KEY = 'brakup:localBrackets'
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

export async function submitBracket(entry: Partial<ChallengeEntry> & { email: string }): Promise<{ entry: ChallengeEntry; token: string }> {
  try {
    return await request('submit', { entry })
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
      score: current?.score ?? 0,
      rank: null,
      submittedAt: entry.submittedAt ?? null,
      breakdown: current?.breakdown ?? {},
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

export function resendMagicLink(email: string): Promise<{ sent: boolean; token?: string }> {
  return request('resend', { email })
}
