import type {
  GroupMatch,
  KnockoutEntrant,
  KnockoutMatch,
  MatchOverride,
  RankedStandingRow,
  StandingRow,
  Team,
} from '../types'

type KnockoutTemplate = {
  id: string
  stage: string
  label: string
  dateLabel: string
  home:
    | { type: 'winner'; groupId: string }
    | { type: 'runnerUp'; groupId: string }
    | { type: 'third'; candidateGroups: string[] }
    | { type: 'winnerOf'; matchId: string }
  away:
    | { type: 'winner'; groupId: string }
    | { type: 'runnerUp'; groupId: string }
    | { type: 'third'; candidateGroups: string[] }
    | { type: 'winnerOf'; matchId: string }
}

export const knockoutTemplates: KnockoutTemplate[] = [
  { id: 'M73', stage: 'Round of 32', label: 'Match 73', dateLabel: '28 Jun', home: { type: 'runnerUp', groupId: 'A' }, away: { type: 'runnerUp', groupId: 'B' } },
  { id: 'M74', stage: 'Round of 32', label: 'Match 74', dateLabel: '28 Jun', home: { type: 'winner', groupId: 'E' }, away: { type: 'third', candidateGroups: ['A', 'B', 'C', 'D', 'F'] } },
  { id: 'M75', stage: 'Round of 32', label: 'Match 75', dateLabel: '28 Jun', home: { type: 'winner', groupId: 'F' }, away: { type: 'runnerUp', groupId: 'C' } },
  { id: 'M76', stage: 'Round of 32', label: 'Match 76', dateLabel: '28 Jun', home: { type: 'winner', groupId: 'C' }, away: { type: 'runnerUp', groupId: 'F' } },
  { id: 'M77', stage: 'Round of 32', label: 'Match 77', dateLabel: '29 Jun', home: { type: 'winner', groupId: 'I' }, away: { type: 'third', candidateGroups: ['C', 'D', 'F', 'G', 'H'] } },
  { id: 'M78', stage: 'Round of 32', label: 'Match 78', dateLabel: '29 Jun', home: { type: 'runnerUp', groupId: 'E' }, away: { type: 'runnerUp', groupId: 'I' } },
  { id: 'M79', stage: 'Round of 32', label: 'Match 79', dateLabel: '29 Jun', home: { type: 'winner', groupId: 'A' }, away: { type: 'third', candidateGroups: ['C', 'E', 'F', 'H', 'I'] } },
  { id: 'M80', stage: 'Round of 32', label: 'Match 80', dateLabel: '29 Jun', home: { type: 'winner', groupId: 'L' }, away: { type: 'third', candidateGroups: ['E', 'H', 'I', 'J', 'K'] } },
  { id: 'M81', stage: 'Round of 32', label: 'Match 81', dateLabel: '30 Jun', home: { type: 'winner', groupId: 'D' }, away: { type: 'third', candidateGroups: ['B', 'E', 'F', 'I', 'J'] } },
  { id: 'M82', stage: 'Round of 32', label: 'Match 82', dateLabel: '30 Jun', home: { type: 'winner', groupId: 'G' }, away: { type: 'third', candidateGroups: ['A', 'E', 'H', 'I', 'J'] } },
  { id: 'M83', stage: 'Round of 32', label: 'Match 83', dateLabel: '30 Jun', home: { type: 'runnerUp', groupId: 'K' }, away: { type: 'runnerUp', groupId: 'L' } },
  { id: 'M84', stage: 'Round of 32', label: 'Match 84', dateLabel: '30 Jun', home: { type: 'winner', groupId: 'H' }, away: { type: 'runnerUp', groupId: 'J' } },
  { id: 'M85', stage: 'Round of 32', label: 'Match 85', dateLabel: '1 Jul', home: { type: 'winner', groupId: 'B' }, away: { type: 'third', candidateGroups: ['E', 'F', 'G', 'I', 'J'] } },
  { id: 'M86', stage: 'Round of 32', label: 'Match 86', dateLabel: '1 Jul', home: { type: 'winner', groupId: 'J' }, away: { type: 'runnerUp', groupId: 'H' } },
  { id: 'M87', stage: 'Round of 32', label: 'Match 87', dateLabel: '1 Jul', home: { type: 'winner', groupId: 'K' }, away: { type: 'third', candidateGroups: ['D', 'E', 'I', 'J', 'L'] } },
  { id: 'M88', stage: 'Round of 32', label: 'Match 88', dateLabel: '1 Jul', home: { type: 'runnerUp', groupId: 'D' }, away: { type: 'runnerUp', groupId: 'G' } },
  { id: 'M89', stage: 'Round of 16', label: 'Match 89', dateLabel: '3 Jul', home: { type: 'winnerOf', matchId: 'M73' }, away: { type: 'winnerOf', matchId: 'M75' } },
  { id: 'M90', stage: 'Round of 16', label: 'Match 90', dateLabel: '3 Jul', home: { type: 'winnerOf', matchId: 'M74' }, away: { type: 'winnerOf', matchId: 'M77' } },
  { id: 'M91', stage: 'Round of 16', label: 'Match 91', dateLabel: '4 Jul', home: { type: 'winnerOf', matchId: 'M76' }, away: { type: 'winnerOf', matchId: 'M78' } },
  { id: 'M92', stage: 'Round of 16', label: 'Match 92', dateLabel: '4 Jul', home: { type: 'winnerOf', matchId: 'M79' }, away: { type: 'winnerOf', matchId: 'M80' } },
  { id: 'M93', stage: 'Round of 16', label: 'Match 93', dateLabel: '5 Jul', home: { type: 'winnerOf', matchId: 'M83' }, away: { type: 'winnerOf', matchId: 'M84' } },
  { id: 'M94', stage: 'Round of 16', label: 'Match 94', dateLabel: '5 Jul', home: { type: 'winnerOf', matchId: 'M81' }, away: { type: 'winnerOf', matchId: 'M82' } },
  { id: 'M95', stage: 'Round of 16', label: 'Match 95', dateLabel: '6 Jul', home: { type: 'winnerOf', matchId: 'M86' }, away: { type: 'winnerOf', matchId: 'M88' } },
  { id: 'M96', stage: 'Round of 16', label: 'Match 96', dateLabel: '6 Jul', home: { type: 'winnerOf', matchId: 'M85' }, away: { type: 'winnerOf', matchId: 'M87' } },
  { id: 'M97', stage: 'Quarter-final', label: 'Match 97', dateLabel: '9 Jul', home: { type: 'winnerOf', matchId: 'M89' }, away: { type: 'winnerOf', matchId: 'M90' } },
  { id: 'M98', stage: 'Quarter-final', label: 'Match 98', dateLabel: '9 Jul', home: { type: 'winnerOf', matchId: 'M93' }, away: { type: 'winnerOf', matchId: 'M94' } },
  { id: 'M99', stage: 'Quarter-final', label: 'Match 99', dateLabel: '10 Jul', home: { type: 'winnerOf', matchId: 'M91' }, away: { type: 'winnerOf', matchId: 'M92' } },
  { id: 'M100', stage: 'Quarter-final', label: 'Match 100', dateLabel: '10 Jul', home: { type: 'winnerOf', matchId: 'M95' }, away: { type: 'winnerOf', matchId: 'M96' } },
  { id: 'M101', stage: 'Semi-final', label: 'Match 101', dateLabel: '14 Jul', home: { type: 'winnerOf', matchId: 'M97' }, away: { type: 'winnerOf', matchId: 'M98' } },
  { id: 'M102', stage: 'Semi-final', label: 'Match 102', dateLabel: '15 Jul', home: { type: 'winnerOf', matchId: 'M99' }, away: { type: 'winnerOf', matchId: 'M100' } },
  { id: 'M103', stage: 'Finale', label: 'Finale', dateLabel: '19 Jul', home: { type: 'winnerOf', matchId: 'M101' }, away: { type: 'winnerOf', matchId: 'M102' } },
]

function createBaseStandingRow(teamId: string, groupId: string): StandingRow {
  return {
    teamId,
    groupId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  }
}

function compareRows(a: StandingRow, b: StandingRow): number {
  if (b.points !== a.points) return b.points - a.points
  if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
  if (a.goalsAgainst !== b.goalsAgainst) return a.goalsAgainst - b.goalsAgainst
  return a.teamId.localeCompare(b.teamId)
}

function buildMiniTable(groupMatches: GroupMatch[], teamIds: string[]): Map<string, StandingRow> {
  const rows = new Map<string, StandingRow>()

  for (const teamId of teamIds) {
    rows.set(teamId, createBaseStandingRow(teamId, ''))
  }

  for (const match of groupMatches) {
    if (
      match.homeScore === null ||
      match.awayScore === null ||
      !rows.has(match.homeTeamId) ||
      !rows.has(match.awayTeamId)
    ) {
      continue
    }

    const home = rows.get(match.homeTeamId)
    const away = rows.get(match.awayTeamId)

    if (!home || !away) {
      continue
    }

    home.played += 1
    away.played += 1
    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore
    home.goalDifference = home.goalsFor - home.goalsAgainst
    away.goalDifference = away.goalsFor - away.goalsAgainst

    if (match.homeScore > match.awayScore) {
      home.wins += 1
      away.losses += 1
      home.points += 3
    } else if (match.homeScore < match.awayScore) {
      away.wins += 1
      home.losses += 1
      away.points += 3
    } else {
      home.draws += 1
      away.draws += 1
      home.points += 1
      away.points += 1
    }
  }

  return rows
}

function rankGroupWithHeadToHead(rows: StandingRow[], groupMatches: GroupMatch[]): RankedStandingRow[] {
  const sorted = [...rows].sort(compareRows)
  const ranked: RankedStandingRow[] = []
  let index = 0

  while (index < sorted.length) {
    const current = sorted[index]
    const tied = sorted.filter((row) => row.points === current.points)
    const start = sorted.findIndex((row) => row.points === current.points)
    const end = start + tied.length

    if (index !== start) {
      index += 1
      continue
    }

    const tiedIds = tied.map((row) => row.teamId)
    const miniTable = buildMiniTable(groupMatches, tiedIds)
    const reranked = tied
      .map((row) => {
        const mini = miniTable.get(row.teamId)
        return {
          row,
          miniPoints: mini?.points ?? 0,
          miniGoalDifference: mini?.goalDifference ?? 0,
          miniGoalsFor: mini?.goalsFor ?? 0,
        }
      })
      .sort((a, b) => {
        if (b.miniPoints !== a.miniPoints) return b.miniPoints - a.miniPoints
        if (b.miniGoalDifference !== a.miniGoalDifference) {
          return b.miniGoalDifference - a.miniGoalDifference
        }
        if (b.miniGoalsFor !== a.miniGoalsFor) return b.miniGoalsFor - a.miniGoalsFor
        return compareRows(a.row, b.row)
      })

    reranked.forEach((item, tiedIndex) => {
      ranked.push({
        ...item.row,
        rank: start + tiedIndex + 1,
      })
    })

    index = end
  }

  return ranked
}

export function mergeScores(
  matches: GroupMatch[],
  liveMatches: Array<{ id: string; homeScore: number | null; awayScore: number | null; status: GroupMatch['status']; kickoffTime?: string | null; kickoffIso?: string | null }>,
  overrides: Record<string, MatchOverride>,
  mode: 'real' | 'simulation',
): GroupMatch[] {
  const liveMap = new Map(liveMatches.map((match) => [match.id, match]))

  return matches.map((match) => {
    const live = liveMap.get(match.id)
    const override = overrides[match.id]

    const baseMatch: GroupMatch = {
      ...match,
      homeScore: live?.homeScore ?? match.homeScore,
      awayScore: live?.awayScore ?? match.awayScore,
      status: live?.status ?? match.status,
      kickoffTime: live?.kickoffTime ?? match.kickoffTime ?? null,
      kickoffIso: live?.kickoffIso ?? match.kickoffIso ?? null,
    }

    if (mode === 'simulation' && override) {
      return {
        ...baseMatch,
        homeScore: override.homeScore,
        awayScore: override.awayScore,
        status:
          override.homeScore === null || override.awayScore === null
            ? 'scheduled'
            : 'finished',
      }
    }

    return baseMatch
  })
}

export function buildGroupOrderOverrides(
  groupMatches: GroupMatch[],
  orderedTeamIds: string[],
): Record<string, MatchOverride> {
  const rankMap = new Map(orderedTeamIds.map((teamId, index) => [teamId, index]))
  const overrides: Record<string, MatchOverride> = {}

  for (const match of groupMatches) {
    const homeRank = rankMap.get(match.homeTeamId)
    const awayRank = rankMap.get(match.awayTeamId)

    if (homeRank === undefined || awayRank === undefined || homeRank === awayRank) {
      continue
    }

    const higherRankGap = Math.abs(homeRank - awayRank)
    const winningScore = higherRankGap >= 2 ? 2 : 1

    overrides[match.id] =
      homeRank < awayRank
        ? { homeScore: winningScore, awayScore: 0 }
        : { homeScore: 0, awayScore: winningScore }
  }

  return overrides
}

export function computeStandings(teams: Team[], matches: GroupMatch[]): Record<string, RankedStandingRow[]> {
  const teamMap = new Map(teams.map((team) => [team.id, team]))
  const rows = new Map<string, StandingRow>()

  for (const team of teams) {
    rows.set(team.id, createBaseStandingRow(team.id, team.groupId))
  }

  for (const match of matches) {
    if (match.homeScore === null || match.awayScore === null) {
      continue
    }

    const home = rows.get(match.homeTeamId)
    const away = rows.get(match.awayTeamId)

    if (!home || !away) {
      continue
    }

    home.played += 1
    away.played += 1
    home.goalsFor += match.homeScore
    home.goalsAgainst += match.awayScore
    away.goalsFor += match.awayScore
    away.goalsAgainst += match.homeScore
    home.goalDifference = home.goalsFor - home.goalsAgainst
    away.goalDifference = away.goalsFor - away.goalsAgainst

    if (match.homeScore > match.awayScore) {
      home.wins += 1
      away.losses += 1
      home.points += 3
    } else if (match.homeScore < match.awayScore) {
      away.wins += 1
      home.losses += 1
      away.points += 3
    } else {
      home.draws += 1
      away.draws += 1
      home.points += 1
      away.points += 1
    }
  }

  const groupedRows: Record<string, StandingRow[]> = {}

  for (const row of rows.values()) {
    const team = teamMap.get(row.teamId)
    if (!team) continue
    groupedRows[team.groupId] ??= []
    groupedRows[team.groupId].push(row)
  }

  const ranked: Record<string, RankedStandingRow[]> = {}

  for (const [groupId, groupRows] of Object.entries(groupedRows)) {
    ranked[groupId] = rankGroupWithHeadToHead(
      groupRows,
      matches.filter((match) => match.groupId === groupId),
    )
  }

  return ranked
}

export function getBestThirdPlacedTeams(groupStandings: Record<string, RankedStandingRow[]>): RankedStandingRow[] {
  return Object.values(groupStandings)
    .map((rows) => rows.find((row) => row.rank === 3))
    .filter((row): row is RankedStandingRow => Boolean(row))
    .sort(compareRows)
    .slice(0, 8)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }))
}

function resolveThirdPlaceAssignments(qualifiedThirds: RankedStandingRow[], templates: KnockoutTemplate[]) {
  const thirdPlaceSlots = templates.flatMap((template) => {
    const entries: Array<{ matchId: string; side: 'home' | 'away'; candidateGroups: string[] }> = []
    if (template.home.type === 'third') {
      entries.push({ matchId: template.id, side: 'home', candidateGroups: template.home.candidateGroups })
    }
    if (template.away.type === 'third') {
      entries.push({ matchId: template.id, side: 'away', candidateGroups: template.away.candidateGroups })
    }
    return entries
  })

  const sortedTeams = [...qualifiedThirds]
  const assignments = new Map<string, string>()

  function backtrack(slotIndex: number, usedTeamIds: Set<string>): boolean {
    if (slotIndex === thirdPlaceSlots.length) {
      return true
    }

    const slot = thirdPlaceSlots[slotIndex]
    const candidates = sortedTeams.filter(
      (team) =>
        slot.candidateGroups.includes(team.groupId) &&
        !usedTeamIds.has(team.teamId),
    )

    for (const candidate of candidates) {
      assignments.set(`${slot.matchId}:${slot.side}`, candidate.teamId)
      usedTeamIds.add(candidate.teamId)

      if (backtrack(slotIndex + 1, usedTeamIds)) {
        return true
      }

      usedTeamIds.delete(candidate.teamId)
      assignments.delete(`${slot.matchId}:${slot.side}`)
    }

    return false
  }

  thirdPlaceSlots.sort((a, b) => a.candidateGroups.length - b.candidateGroups.length)
  backtrack(0, new Set<string>())

  return assignments
}

function entrantFromStanding(row: RankedStandingRow | undefined): KnockoutEntrant {
  if (!row) {
    return { kind: 'placeholder', label: 'À déterminer' }
  }

  return { kind: 'team', teamId: row.teamId }
}

function entrantFromTemplate(
  templateEntry: KnockoutTemplate['home'],
  groupStandings: Record<string, RankedStandingRow[]>,
  assignments: Map<string, string>,
  matchId: string,
  side: 'home' | 'away',
): KnockoutEntrant {
  if (templateEntry.type === 'winner') {
    return entrantFromStanding(groupStandings[templateEntry.groupId]?.find((row) => row.rank === 1))
  }

  if (templateEntry.type === 'runnerUp') {
    return entrantFromStanding(groupStandings[templateEntry.groupId]?.find((row) => row.rank === 2))
  }

  if (templateEntry.type === 'winnerOf') {
    return { kind: 'placeholder', label: `Vainqueur ${templateEntry.matchId}` }
  }

  const assignedTeamId = assignments.get(`${matchId}:${side}`)
  if (assignedTeamId) {
    return { kind: 'team', teamId: assignedTeamId }
  }

  return {
    kind: 'placeholder',
    label: `3e ${templateEntry.candidateGroups.join('/')}`,
  }
}

export function buildKnockoutBracket(groupStandings: Record<string, RankedStandingRow[]>): KnockoutMatch[] {
  const bestThirds = getBestThirdPlacedTeams(groupStandings)
  const assignments = resolveThirdPlaceAssignments(bestThirds, knockoutTemplates)

  return knockoutTemplates.map((template) => ({
    id: template.id,
    stage: template.stage,
    label: template.label,
    dateLabel: template.dateLabel,
    home: entrantFromTemplate(template.home, groupStandings, assignments, template.id, 'home'),
    away: entrantFromTemplate(template.away, groupStandings, assignments, template.id, 'away'),
  }))
}
