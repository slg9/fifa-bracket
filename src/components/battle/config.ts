import type { BattleDifficulty } from '../../types'

export type DifficultyConfig = {
  defenderCount: number
  defenderSpeed: number
  gkSpeed: number
  chargeTime: number
  countdown: number
}

const CONFIG: Record<BattleDifficulty, DifficultyConfig> = {
  easy: { defenderCount: 2, defenderSpeed: 80, gkSpeed: 140, chargeTime: 0.9, countdown: 8 },
  medium: { defenderCount: 3, defenderSpeed: 120, gkSpeed: 200, chargeTime: 0.8, countdown: 7 },
  hard: { defenderCount: 4, defenderSpeed: 160, gkSpeed: 280, chargeTime: 0.7, countdown: 6 },
}

export function getDifficultyConfig(difficulty: BattleDifficulty): DifficultyConfig {
  return CONFIG[difficulty]
}

export function difficultyForStage(stage: string): BattleDifficulty {
  if (stage === 'Round of 32' || stage === 'Round of 16') return 'easy'
  if (stage === 'Quarter-final') return 'medium'
  return 'hard'
}
