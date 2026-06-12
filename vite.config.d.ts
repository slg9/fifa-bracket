declare module './scripts/fifa-sync-core.mjs' {
  import type { LiveSnapshot, TournamentSeed } from './src/types'

  export function buildFifaLiveSnapshot(seed: TournamentSeed): Promise<LiveSnapshot>
}
