import type { BattleScorer, KnockoutMatch, Team } from '../types'
import { STAGE_POINTS } from '../lib/scoring'

export type BattleScore = { p: number; o: number }
export type OfficialScore = { home: number; away: number }
export type DisplayScore = { home: number; away: number }
export type RealScorer = { name: string; teamId: string; teamCode?: string; goals: number }

export type MatchProgress = {
  played: boolean
  correct: boolean
  wrong: boolean
  exact: boolean
  points: number
  stagePoints: number
  exactPoints: number
  scorerHits: BattleScorer[]
  scorerPoints: number
  realWinnerTeamId?: string
  realScore?: OfficialScore
  playedScore?: DisplayScore | null
}

export type ProgressSummary = {
  points: number
  correct: number
  wrong: number
  exact: number
  scorers: number
  resolved: number
}

export const EXACT_SCORE_BONUS = 5
export const SCORER_FOUND_BONUS = 2

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

function normalizeScorerName(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scorerKey(scorer: Pick<BattleScorer, 'name' | 'teamId'>) {
  return `${scorer.teamId}:${normalizeScorerName(scorer.name)}`
}

function realScorerIndex(realScorers: RealScorer[]) {
  return new Map(realScorers.map((scorer) => [scorerKey(scorer), scorer]))
}

export function evaluateScorerHits(pickedScorers: BattleScorer[] = [], realScorers: RealScorer[] = []) {
  const realIndex = realScorerIndex(realScorers)
  const seen = new Set<string>()
  const hits: BattleScorer[] = []

  for (const scorer of pickedScorers) {
    if (scorer.controlled === false) continue
    const key = scorerKey(scorer)
    if (seen.has(key)) continue
    const real = realIndex.get(key)
    if (!real || real.goals <= 0) continue
    seen.add(key)
    hits.push({ ...scorer, goals: real.goals, teamCode: scorer.teamCode ?? real.teamCode })
  }

  return hits
}

export function evaluateMatchProgress(
  match: KnockoutMatch,
  picks: Record<string, string>,
  scores: Record<string, BattleScore>,
  realResults: Record<string, string>,
  officialScores: Record<string, OfficialScore>,
  scorers: Record<string, BattleScorer[]> = {},
  realScorers: RealScorer[] = [],
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
  const scorerHits = played ? evaluateScorerHits(scorers[match.id], realScorers) : []
  const scorerPoints = scorerHits.length * SCORER_FOUND_BONUS

  return {
    played,
    correct,
    wrong,
    exact,
    points: stagePoints + exactPoints + scorerPoints,
    stagePoints,
    exactPoints,
    scorerHits,
    scorerPoints,
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
  scorers: Record<string, BattleScorer[]> = {},
  realScorers: RealScorer[] = [],
): ProgressSummary {
  return matches.reduce<ProgressSummary>((summary, match) => {
    const progress = evaluateMatchProgress(match, picks, scores, realResults, officialScores, scorers, realScorers)
    return {
      points: summary.points + progress.points + (match.id === 'M104' && progress.correct ? 30 : 0),
      correct: summary.correct + (progress.correct ? 1 : 0),
      wrong: summary.wrong + (progress.wrong ? 1 : 0),
      exact: summary.exact + (progress.exact ? 1 : 0),
      scorers: summary.scorers + progress.scorerHits.length,
      resolved: summary.resolved + (progress.played ? 1 : 0),
    }
  }, { points: Math.min(40, Math.max(0, battleBonuses)), correct: 0, wrong: 0, exact: 0, scorers: 0, resolved: 0 })
}

export function teamLabel(team?: Team, fallback = 'A determiner') {
  return team?.shortName || team?.name || fallback
}
