import type { LiveSnapshot, TournamentSeed } from '../types'

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
