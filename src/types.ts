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
}
