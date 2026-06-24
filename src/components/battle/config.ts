import type { BattleDifficulty } from '../../types'

export type DifficultyConfig = {
  defenderCount: number
  defenderSpeed: number
  gkSpeed: number
  chargeTime: number
  countdown: number
}

const CONFIG: Record<BattleDifficulty, DifficultyConfig> = {
  easy: { defenderCount: 1, defenderSpeed: 80, gkSpeed: 60, chargeTime: 2, countdown: 6 },
  medium: { defenderCount: 2, defenderSpeed: 110, gkSpeed: 100, chargeTime: 1.8, countdown: 5 },
  hard: { defenderCount: 3, defenderSpeed: 150, gkSpeed: 150, chargeTime: 1.5, countdown: 4 },
}

export function getDifficultyConfig(difficulty: BattleDifficulty): DifficultyConfig {
  return CONFIG[difficulty]
}

export function difficultyForStage(stage: string): BattleDifficulty {
  if (stage === 'Round of 32' || stage === 'Round of 16') return 'easy'
  if (stage === 'Quarter-final') return 'medium'
  return 'hard'
}
