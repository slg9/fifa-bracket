import type { KnockoutMatch, Team } from '../types'
import { STAGE_POINTS } from '../lib/scoring'

export type BattleScore = { p: number; o: number }
export type OfficialScore = { home: number; away: number }
export type DisplayScore = { home: number; away: number }

export type MatchProgress = {
  played: boolean
  correct: boolean
  wrong: boolean
  exact: boolean
  points: number
  stagePoints: number
  exactPoints: number
  realWinnerTeamId?: string
  realScore?: OfficialScore
  playedScore?: DisplayScore | null
}

export type ProgressSummary = {
  points: number
  correct: number
  wrong: number
  exact: number
  resolved: number
}

export const EXACT_SCORE_BONUS = 5

export function entrantTeamId(match: KnockoutMatch, side: 'home' | 'away') {
  const entrant = match[side]
  return entrant.kind === 'team' ? entrant.teamId : null
}

export function scoreForPick(match: KnockoutMatch, pickedTeamId?: string, score?: BattleScore): DisplayScore | null {
  const homeTeamId = entrantTeamId(match, 'home')
  const awayTeamId = entrantTeamId(match, 'away')
  if (!score || !pickedTeamId || !homeTeamId || !awayTeamId) return null
  const pickedHome = pickedTeamId === homeTeamId
  return pickedHome
    ? { home: score.p, away: score.o }
    : { home: score.o, away: score.p }
}

export function formatScore(score?: DisplayScore | OfficialScore | null) {
  return score ? `${score.home} - ${score.away}` : 'en attente'
}

export function evaluateMatchProgress(
  match: KnockoutMatch,
  picks: Record<string, string>,
  scores: Record<string, BattleScore>,
  realResults: Record<string, string>,
  officialScores: Record<string, OfficialScore>,
): MatchProgress {
  const pickedTeamId = picks[match.id]
  const realWinnerTeamId = realResults[match.id]
  const realScore = officialScores[match.id]
  const played = Boolean(pickedTeamId && realWinnerTeamId)
  const correct = played && pickedTeamId === realWinnerTeamId
  const wrong = played && !correct
  const playedScore = scoreForPick(match, pickedTeamId, scores[match.id])
  const exact = Boolean(
    correct &&
    playedScore &&
    realScore &&
    playedScore.home === realScore.home &&
    playedScore.away === realScore.away,
  )
  const stagePoints = correct ? STAGE_POINTS[match.stage] ?? 0 : 0
  const exactPoints = exact ? EXACT_SCORE_BONUS : 0

  return {
    played,
    correct,
    wrong,
    exact,
    points: stagePoints + exactPoints,
    stagePoints,
    exactPoints,
    realWinnerTeamId,
    realScore,
    playedScore,
  }
}

export function summarizeProgress(
  matches: KnockoutMatch[],
  picks: Record<string, string>,
  scores: Record<string, BattleScore>,
  realResults: Record<string, string>,
  officialScores: Record<string, OfficialScore>,
  battleBonuses = 0,
): ProgressSummary {
  return matches.reduce<ProgressSummary>((summary, match) => {
    const progress = evaluateMatchProgress(match, picks, scores, realResults, officialScores)
    return {
      points: summary.points + progress.points + (match.id === 'M104' && progress.correct ? 30 : 0),
      correct: summary.correct + (progress.correct ? 1 : 0),
      wrong: summary.wrong + (progress.wrong ? 1 : 0),
      exact: summary.exact + (progress.exact ? 1 : 0),
      resolved: summary.resolved + (progress.played ? 1 : 0),
    }
  }, { points: Math.min(40, Math.max(0, battleBonuses)), correct: 0, wrong: 0, exact: 0, resolved: 0 })
}

export function teamLabel(team?: Team, fallback = 'A determiner') {
  return team?.shortName || team?.name || fallback
}
