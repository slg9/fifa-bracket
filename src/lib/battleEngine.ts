import type { BattleDifficulty, BattleResult, BattleRound, Team } from '../types'

export type { BattleResult, BattleRound }

const DIFFICULTIES: Array<{ value: BattleDifficulty; weight: number }> = [
  { value: 'easy', weight: 0.3 },
  { value: 'medium', weight: 0.5 },
  { value: 'hard', weight: 0.2 },
]

function randomDifficulty(): BattleDifficulty {
  const roll = Math.random()
  let cursor = 0
  for (const item of DIFFICULTIES) {
    cursor += item.weight
    if (roll <= cursor) return item.value
  }
  return 'medium'
}

export function adjustDifficulty(difficulty: BattleDifficulty, momentum: number): BattleDifficulty {
  const order: BattleDifficulty[] = ['easy', 'medium', 'hard']
  const shift = momentum > 1 ? -1 : momentum < -1 ? 1 : 0
  const index = Math.max(0, Math.min(order.length - 1, order.indexOf(difficulty) + shift))
  return order[index]
}

export function updateMomentum(momentum: number, success: boolean): number {
  return Math.max(-3, Math.min(3, momentum + (success ? 1 : -1)))
}

export function generateBattleRounds(params: {
  homeTeam: Team
  awayTeam: Team
  playerSide: 'home' | 'away'
}): BattleRound[] {
  void params
  const count = 6 + Math.floor(Math.random() * 3)
  const rounds: BattleRound[] = []
  let nextType: BattleRound['type'] = 'attack'

  for (let index = 0; index < count; index += 1) {
    const roundType: BattleRound['type'] = nextType
    const surpriseRepeat = index > 1 && index < count - 1 && Math.random() < 0.2
    if (!surpriseRepeat) nextType = roundType === 'attack' ? 'defense' : 'attack'

    rounds.push({
      type: roundType,
      commentaryPhase: roundType === 'attack' ? 'pre_attack' : 'pre_defense',
      difficulty: randomDifficulty(),
      ...(roundType === 'defense' ? {
        balloonCount: 1 + Math.floor(Math.random() * 5),
        hasSonic: index >= 2 && Math.random() < 0.35,
      } : {}),
    })
  }

  return rounds
}
