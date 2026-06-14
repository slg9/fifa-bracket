import type { LiveSnapshot, TournamentSeed } from '../types'

export type TeamMatchStats = {
  shots: number
  corners: number
  fouls: number
  yellowCards: number
  redCards: number
}

export type MatchEventsData = {
  home: { code: string; tactics: string | null; coach: string | null; players: Array<{ shirt: number; name: string; starter: boolean }> }
  away: { code: string; tactics: string | null; coach: string | null; players: Array<{ shirt: number; name: string; starter: boolean }> }
  goals: Array<{ name: string; minute: string; team: string }>
  attendance: string | null
  stats: { home: TeamMatchStats; away: TeamMatchStats } | null
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

export type MatchOdds = {
  commenceTime: string
  home: { code: string; avgOdds: number; prob: number }
  draw: { avgOdds: number; prob: number }
  away: { code: string; avgOdds: number; prob: number }
}

export type OddsSnapshot = Record<string, MatchOdds>

export async function fetchOdds(): Promise<OddsSnapshot | null> {
  try {
    const response = await fetch('/api/odds', { cache: 'no-store' })
    if (!response.ok) return null
    return response.json() as Promise<OddsSnapshot>
  } catch {
    return null
  }
}

export async function fetchMatchStats(fifaMatchPath: string): Promise<MatchEventsData | null> {
  try {
    const encoded = encodeURIComponent(fifaMatchPath)
    const response = await fetch(`/api/match-stats?path=${encoded}`, { cache: 'no-store' })
    if (!response.ok) return null
    return response.json() as Promise<MatchEventsData>
  } catch {
    return null
  }
}
