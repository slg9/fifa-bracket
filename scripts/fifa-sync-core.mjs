const standingsUrl =
  'https://r.jina.ai/http://https://www.fifa.com/fr/tournaments/mens/worldcup/canadamexicousa2026/standings'
const fixturesUrl =
  'https://r.jina.ai/http://https://www.fifa.com/fr/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures?country=FR&wtw-filter=ALL'

function stripImages(text) {
  return text.replace(/!\[Image[^\]]*\]\([^)]*\)/g, '')
}

function normalizeStatus(statusToken) {
  const upper = statusToken.toUpperCase()

  if (upper === 'FIN' || upper === 'FT') {
    return 'finished'
  }

  if (upper === 'LIVE' || upper === 'EN DIRECT') {
    return 'live'
  }

  return 'finished'
}

function parseFixtureEntry(entry) {
  if (!entry.includes('Phase de groupes')) {
    return null
  }

  const [left, right = ''] = entry.split('Phase de groupes')
  const trimmedLeft = left.trim()
  const trimmedRight = right.trim()
  const groupMatch = trimmedRight.match(/^.\s+Groupe\s+([A-L])\s*[·-]?\s*(.*)$/)

  if (!groupMatch) {
    return null
  }

  const detailsMatch = trimmedLeft.match(
    /^([A-Z]{3})\s+(.+?)\s+(?:(\d+)\s+([A-Z]+)\s+(\d+)|(\d{1,2}:\d{2}))\s+([A-Z]{3})\s+(.+)$/,
  )

  if (!detailsMatch) {
    return null
  }

  const [, homeCode, homeName, homeScore, statusToken, awayScore, kickoffTime, awayCode, awayName] = detailsMatch

  return {
    groupId: groupMatch[1],
    venue: groupMatch[2]?.trim() ?? '',
    homeCode,
    homeName: homeName.trim(),
    awayCode,
    awayName: awayName.trim(),
    kickoffTime: kickoffTime ?? null,
    homeScore: homeScore ? Number(homeScore) : null,
    awayScore: awayScore ? Number(awayScore) : null,
    status: statusToken ? normalizeStatus(statusToken) : 'scheduled',
  }
}

function parseFixtures(text) {
  const cleaned = stripImages(text)
  const chunks = cleaned.split('](https://www.fifa.com/fr/match-centre/match/')
  const fixtures = []

  for (let index = 0; index < chunks.length - 1; index += 1) {
    const chunk = chunks[index]
    const entry = chunk.slice(chunk.lastIndexOf('[') + 1).replace(/\s+/g, ' ').trim()

    if (!entry) {
      continue
    }

    const parsed = parseFixtureEntry(entry)
    if (parsed) {
      fixtures.push(parsed)
    }
  }

  return fixtures
}

function parseStandings(text) {
  const cleaned = stripImages(text)
  const lines = cleaned.split(/\r?\n/)
  const rows = []
  let currentGroupId = null

  for (const line of lines) {
    const groupHeader = line.match(/^Classements - Groupe\s+([A-L])$/)
    if (groupHeader) {
      currentGroupId = groupHeader[1]
      continue
    }

    if (!currentGroupId || !line.includes('/teams/')) {
      continue
    }

    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 12) {
      continue
    }

    const teamCell = cells[3]
    const teamMatch = teamCell.match(/\[\s*(.+?)\s+([A-Z]{3})\]\(/)
    if (!teamMatch) {
      continue
    }

    rows.push({
      groupId: currentGroupId,
      teamCode: teamMatch[2],
      rank: Number(cells[2]),
      goalsFor: Number(cells[8]),
      goalsAgainst: Number(cells[9]),
      goalDifference: Number(cells[10]),
      points: Number(cells[11]),
    })
  }

  return rows
}

function buildMatchLookup(seed) {
  const teamsById = new Map(seed.teams.map((team) => [team.id, team]))
  const lookup = new Map()

  for (const match of seed.matches) {
    const homeTeam = teamsById.get(match.homeTeamId)
    const awayTeam = teamsById.get(match.awayTeamId)

    if (!homeTeam || !awayTeam) {
      continue
    }

    lookup.set(`${match.groupId}:${homeTeam.fifaCode}:${awayTeam.fifaCode}`, match)
  }

  return lookup
}

export async function buildFifaLiveSnapshot(seed) {
  const warnings = []
  const codeToTeamId = new Map(seed.teams.map((team) => [team.fifaCode, team.id]))
  const matchLookup = buildMatchLookup(seed)

  const [standingsResponse, fixturesResponse] = await Promise.all([
    fetch(standingsUrl, { headers: { 'user-agent': 'Mozilla/5.0' } }),
    fetch(fixturesUrl, { headers: { 'user-agent': 'Mozilla/5.0' } }),
  ])

  if (!standingsResponse.ok || !fixturesResponse.ok) {
    throw new Error(`Sources FIFA indisponibles (${standingsResponse.status}/${fixturesResponse.status}).`)
  }

  const [standingsText, fixturesText] = await Promise.all([
    standingsResponse.text(),
    fixturesResponse.text(),
  ])

  const parsedFixtures = parseFixtures(fixturesText)
  const parsedStandings = parseStandings(standingsText)

  const matches = []
  for (const fixture of parsedFixtures) {
    const match = matchLookup.get(`${fixture.groupId}:${fixture.homeCode}:${fixture.awayCode}`)

    if (!match) {
      warnings.push(`Match FIFA non mappe: ${fixture.groupId} ${fixture.homeCode}-${fixture.awayCode}.`)
      continue
    }

    matches.push({
      id: match.id,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      status: fixture.status,
      kickoffTime: fixture.kickoffTime,
    })
  }

  const standings = []
  for (const row of parsedStandings) {
    const teamId = codeToTeamId.get(row.teamCode)
    if (!teamId) {
      warnings.push(`Equipe FIFA non mappee dans le classement: ${row.teamCode}.`)
      continue
    }

    standings.push({
      groupId: row.groupId,
      teamId,
      rank: row.rank,
      points: row.points,
      goalDifference: row.goalDifference,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
    })
  }

  if (matches.length === 0) {
    warnings.push('Aucun resultat de groupe n a ete extrait depuis FIFA.')
  }

  if (standings.length === 0) {
    warnings.push('Aucun classement de groupe n a ete extrait depuis FIFA.')
  }

  return {
    syncedAt: new Date().toISOString(),
    source: 'fifa-live',
    warnings,
    matches,
    standings,
  }
}
