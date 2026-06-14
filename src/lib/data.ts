import type { LiveSnapshot, TournamentSeed } from '../types'

export type MatchStatsData = {
  possession: { home: number; away: number } | null
  shots: { home: number; away: number } | null
  shotsOnTarget: { home: number; away: number } | null
  corners: { home: number; away: number } | null
  fouls: { home: number; away: number } | null
  yellowCards: { home: number; away: number } | null
  redCards: { home: number; away: number } | null
  passes: { home: number; away: number } | null
  scorers: Array<{ name: string; minute: string | null }>
}

export async function loadSeed(): Promise<TournamentSeed> {
  const response = await fetch('/data/world-cup-2026.json')

  if (!response.ok) {
    throw new Error('Impossible de charger le seed tournoi.')
  }

  return response.json() as Promise<TournamentSeed>
}

export async function loadLiveSnapshot(): Promise<LiveSnapshot | null> {
  const response = await fetch('/data/fifa-live.json', { cache: 'no-store' })

  if (!response.ok) {
    return null
  }

  return response.json() as Promise<LiveSnapshot>
}

export async function syncLiveSnapshot(): Promise<LiveSnapshot> {
  const response = await fetch('/api/fifa-sync', { cache: 'no-store' })

  if (!response.ok) {
    throw new Error('Synchronisation live indisponible.')
  }

  return response.json() as Promise<LiveSnapshot>
}

export async function fetchMatchStats(fifaMatchPath: string): Promise<MatchStatsData | null> {
  try {
    const encoded = encodeURIComponent(fifaMatchPath)
    const response = await fetch(`/api/match-stats?path=${encoded}`, { cache: 'no-store' })
    if (!response.ok) return null
    return response.json() as Promise<MatchStatsData>
  } catch {
    return null
  }
}
