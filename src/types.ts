export type Mode = 'real' | 'simulation'

export type Group = {
  id: string
  name: string
}

export type Team = {
  id: string
  name: string
  shortName: string
  fifaCode: string
  iso2: string
  flagEmoji: string
  groupId: string
  players?: string[]
}

export type MatchStatus = 'scheduled' | 'live' | 'finished'

export type GroupMatch = {
  id: string
  groupId: string
  matchday: number
  homeTeamId: string
  awayTeamId: string
  kickoffDate: string
  kickoffTime?: string | null
  kickoffIso?: string | null
  liveMinute?: string | null
  fifaMatchPath?: string | null
  venue: string
  homeScore: number | null
  awayScore: number | null
  status: MatchStatus
}

export type TournamentSeed = {
  meta: {
    name: string
    seedVersion: string
    sourceUrls: {
      standings: string
      fixtures: string
    }
  }
  groups: Group[]
  teams: Team[]
  matches: GroupMatch[]
}

export type LiveSnapshot = {
  syncedAt: string | null
  source: string
  warnings: string[]
  matches: Array<{
    id: string
    homeScore: number | null
    awayScore: number | null
    status: MatchStatus
    kickoffTime?: string | null
    kickoffIso?: string | null
    liveMinute?: string | null
    fifaMatchPath?: string | null
    winnerTeamCode?: string | null
  }>
  standings: Array<{
    groupId: string
    teamId: string
    rank: number
    played: number
    wins: number
    draws: number
    losses: number
    points: number
    goalDifference: number
    goalsFor: number
    goalsAgainst: number
  }>
  predictions?: MatchPrediction[]
  topScorers?: Array<{ name: string; teamCode: string; goals: number }>
}

export type MatchPrediction = {
  matchId: string
  homePercent: number
  drawPercent: number
  awayPercent: number
  homeForm: string | null   // e.g. "WWDLW"
  awayForm: string | null
  homeGoalsAvg: number | null
  awayGoalsAvg: number | null
  advice: string | null
  winnerName: string | null
}

export type MatchOverride = {
  homeScore: number | null
  awayScore: number | null
}

export type StandingRow = {
  teamId: string
  groupId: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export type RankedStandingRow = StandingRow & {
  rank: number
}

export type KnockoutEntrant =
  | { kind: 'team'; teamId: string }
  | { kind: 'placeholder'; label: string }

export type KnockoutMatch = {
  id: string
  stage: string
  label: string
  dateLabel: string
  home: KnockoutEntrant
  away: KnockoutEntrant
  qualificationStatus?: 'confirmed' | 'projected'
}

export type ChallengeBreakdown = Record<string, {
  points: number
  correct: boolean
  played: boolean
  stage: string
  exact?: boolean
  exactPoints?: number
  scorerHits?: number
  scorerPoints?: number
}>

export type BattleScorer = {
  name: string
  teamId: string
  teamCode?: string
  number?: number
  goals?: number
  controlled?: boolean
}

export interface ChallengeEntry {
  id: string
  emailHash: string
  pseudo: string
  bracketName: string
  picks: Record<string, string>
  battleScores?: Record<string, { p: number; o: number }>
  scorers?: Record<string, BattleScorer[]>
  score: number
  rank: number | null
  submittedAt: string | null
  breakdown: ChallengeBreakdown
  battleBonuses: number
  createdAt: string
}

export interface SimulatorBracketEntry {
  emailHash: string
  pseudo: string
  bracketName: string
  overrides: Record<string, MatchOverride>
  knockoutPicks: Record<string, string>
  score?: number
  rank?: number | null
  scoreBreakdown?: Record<string, { points: number; label: string; correct: boolean; combo: number }>
  completeBonus?: number
  createdAt: string
  updatedAt: string
}

export interface PublicBracketShare {
  id: string
  pseudo: string
  bracketName: string
  overrides: Record<string, MatchOverride>
  knockoutPicks: Record<string, string>
  kind?: 'bracket' | 'result'
  title?: string
  description?: string
  redirectUrl?: string
  imagePath: string
  createdAt: string
  expiresAt: string | null
}

export type CommentaryPhase =
  | 'pre_attack'
  | 'attack_success'
  | 'attack_fail'
  | 'pre_defense'
  | 'defense_success'
  | 'defense_fail'

export type BattleDifficulty = 'easy' | 'medium' | 'hard'
export type BattleDifficultySetting = 'auto' | BattleDifficulty

export type DefenderType = 'normal' | 'costaud' | 'agile' | 'sonic'

export type Defender = {
  id: string
  type: DefenderType
  x: number
  y: number
  hitsRemaining: number
  size: number
  direction: -1 | 1
}

export type DefenseOutcome =
  | { path: 'space_invaders'; blocked: number; total: number }
  | { path: 'goal_save'; blocked: number; total: number; saved: boolean }

export type BattleRoundType = 'attack' | 'defense' | 'fruit_ninja'

export type BattlePhase = 'intro' | 'draw' | 'round_start' | 'countdown' | 'playing' | 'round_result' | 'interception_goal_save' | 'penalties' | 'coin_flip' | 'match_result'

export type BattleMatchState = {
  roundIndex: number
  rounds: BattleRoundType[]
  suddenDeathStartIndex: number
  playerScore: number
  opponentScore: number
  phase: BattlePhase
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
}

export type BattleRound = {
  type: 'attack' | 'defense'
  commentaryPhase: CommentaryPhase
  balloonCount?: number
  hasSonic?: boolean
  difficulty: BattleDifficulty
}

export type BattleResult = {
  homeScore: number
  awayScore: number
  winnerId: string
  playerScore: number
  difficulty?: BattleDifficulty
  rounds: Array<{ type: BattleRoundType; success: boolean; isGoal: boolean; scorer?: BattleScorer }>
  scorers?: BattleScorer[]
  penalties?: { home: number; away: number }
  simulated?: boolean
  commentary?: string
}
