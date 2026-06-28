import type { ChallengeEntry } from '../types.ts'

export const STAGE_POINTS: Record<string, number> = {
  'Round of 32': 3,
  'Round of 16': 6,
  'Quarter-final': 10,
  'Semi-final': 15,
  Finale: 20,
}

export const CHAMPION_BONUS = 30
const EARLY_BIRD_DEADLINE = Date.parse('2026-06-28T22:00:00Z')

export function calculateScore(
  entry: ChallengeEntry,
  realResults: Record<string, string>,
): { score: number; breakdown: ChallengeEntry['breakdown'] } {
  const breakdown: ChallengeEntry['breakdown'] = {}
  const orderedIds = Object.keys(entry.picks).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  let baseScore = 0
  let streak: string[] = []
  let roundOf32Correct = 0

  for (const matchId of orderedIds) {
    const pick = entry.picks[matchId]
    const winner = realResults[matchId]
    const priorStage = entry.breakdown[matchId]?.stage
    const matchNumber = Number(matchId.slice(1))
    const stage = priorStage ?? (matchNumber <= 88 ? 'Round of 32' : matchNumber <= 96 ? 'Round of 16' : matchNumber <= 100 ? 'Quarter-final' : matchNumber <= 102 ? 'Semi-final' : 'Finale')
    const played = Boolean(winner)
    const correct = played && pick === winner
    let points = correct ? (STAGE_POINTS[stage] ?? 0) : 0

    if (correct) {
      streak.push(matchId)
      if (stage === 'Round of 32') roundOf32Correct += 1
      if (streak.length === 5) {
        for (const streakId of streak) {
          if (breakdown[streakId]) {
            const bonus = Math.round(breakdown[streakId].points * 0.5)
            breakdown[streakId].points += bonus
            baseScore += bonus
          } else {
            points += Math.round(points * 0.5)
          }
        }
        streak = []
      }
    } else if (played) {
      streak = []
    }

    breakdown[matchId] = { points, correct, played, stage }
    baseScore += points
  }

  const championCorrect = realResults.M104 && entry.picks.M104 === realResults.M104
  if (championCorrect && breakdown.M104) {
    breakdown.M104.points += CHAMPION_BONUS
    baseScore += CHAMPION_BONUS
  }

  if (roundOf32Correct === 16) baseScore += 25
  if (entry.submittedAt && Date.parse(entry.submittedAt) <= EARLY_BIRD_DEADLINE) baseScore += 10
  baseScore += Math.min(40, Math.max(0, entry.battleBonuses))

  return { score: baseScore, breakdown }
}
