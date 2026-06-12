import type { GroupMatch, Team } from '../types'

export type PlayerStat = {
  name: string
  teamId: string
  teamName: string
  goals: number
  matches: number
}

function defaultPlayers(team: Team): string[] {
  return team.players?.length
    ? team.players
    : [`${team.shortName} 9`, `${team.shortName} 10`, `${team.shortName} 11`]
}

function registerGoal(
  table: Map<string, PlayerStat>,
  team: Team,
  playerName: string,
) {
  const key = `${team.id}:${playerName}`
  const current = table.get(key)

  if (current) {
    current.goals += 1
    return
  }

  table.set(key, {
    name: playerName,
    teamId: team.id,
    teamName: team.name,
    goals: 1,
    matches: 0,
  })
}

function registerMatchAppearance(
  table: Map<string, PlayerStat>,
  team: Team,
  playerName: string,
) {
  const key = `${team.id}:${playerName}`
  const current = table.get(key)

  if (current) {
    current.matches += 1
    return
  }

  table.set(key, {
    name: playerName,
    teamId: team.id,
    teamName: team.name,
    goals: 0,
    matches: 1,
  })
}

export function computePlayerStats(
  teams: Team[],
  matches: GroupMatch[],
): PlayerStat[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]))
  const table = new Map<string, PlayerStat>()

  for (const match of matches) {
    const homeTeam = teamsById.get(match.homeTeamId)
    const awayTeam = teamsById.get(match.awayTeamId)

    if (!homeTeam || !awayTeam) {
      continue
    }

    const homePlayers = defaultPlayers(homeTeam)
    const awayPlayers = defaultPlayers(awayTeam)

    homePlayers.forEach((playerName) => registerMatchAppearance(table, homeTeam, playerName))
    awayPlayers.forEach((playerName) => registerMatchAppearance(table, awayTeam, playerName))

    if (match.homeScore !== null) {
      for (let goalIndex = 0; goalIndex < match.homeScore; goalIndex += 1) {
        registerGoal(table, homeTeam, homePlayers[goalIndex % homePlayers.length])
      }
    }

    if (match.awayScore !== null) {
      for (let goalIndex = 0; goalIndex < match.awayScore; goalIndex += 1) {
        registerGoal(table, awayTeam, awayPlayers[goalIndex % awayPlayers.length])
      }
    }
  }

  return [...table.values()].sort((a, b) =>
    b.goals - a.goals ||
    b.matches - a.matches ||
    a.name.localeCompare(b.name),
  )
}
