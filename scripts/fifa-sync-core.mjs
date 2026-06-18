const FIFA_COMPETITION_ID = '17'
const FIFA_SEASON_ID = '285023'
const FIFA_LANGUAGE = 'fr'
const FIFA_API_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; fifabracket/1.0)' }
const fifaStagesUrl =
  `https://api.fifa.com/api/v3/stages?idSeason=${FIFA_SEASON_ID}&language=${FIFA_LANGUAGE}`

function buildStandingUrl(stageId) {
  return `https://api.fifa.com/api/v3/calendar/${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}/${stageId}/standing?language=${FIFA_LANGUAGE}&count=200`
}

function stripImages(text) {
  return text.replace(/!\[Image[^\]]*\]\([^)]*\)/g, '')
}

function normalizeStatus(statusToken) {
  const upper = statusToken.toUpperCase()

  const finishedTokens = ['FIN', 'FT', 'AET', 'PEN', 'APR']
  if (finishedTokens.includes(upper)) return 'finished'

  // Live/in-progress tokens from FIFA.com French rendering
  // MT = Mi-Temps or in-game minute abbreviation, P = Prolongations, etc.
  const liveTokens = ['LIVE', 'EN DIRECT', 'MT', 'MI', 'P', 'ET', 'HT', 'EX']
  if (liveTokens.includes(upper)) return 'live'

  // Minute token = live: "45", "90+2", "90'+2'", "90ʹ+2ʹ" etc.
  // Strip prime/apostrophe chars then test for digits+optional extension
  const stripped = upper.replace(/['\u2019\u02b9\u2032]+/g, '')
  if (/^\d+(\+\d+)?$/.test(stripped)) return 'live'

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

  // Status token: letters (FIN/MT/ET…) OR minute like 45' / 90'+2' / 90+3'
  const detailsMatch = trimmedLeft.match(
    /^([A-Z]{3})\s+(.+?)\s+(?:(\d+)\s+([A-Za-z0-9'+\u2019\u02b9\u2032]+)\s+(\d+)|(\d{1,2}:\d{2}))\s+([A-Z]{3})\s+(.+)$/,
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
    rawStatusToken: statusToken ?? null,
  }
}

// Parse a French date like "Jeudi 11 juin 2026" → "2026-06-11"
function parseFrenchDateLine(line) {
  // Map every likely variant (accented, unaccented, English) to a zero-padded month number.
  const monthMap = {
    janvier: '01', january: '01',
    'f\u00e9vrier': '02', fevrier: '02', february: '02',
    mars: '03', march: '03',
    avril: '04', april: '04',
    mai: '05', may: '05',
    juin: '06', june: '06',
    juillet: '07', july: '07',
    'ao\u00fbt': '08', aout: '08', august: '08',
    septembre: '09', september: '09',
    octobre: '10', october: '10',
    novembre: '11', november: '11',
    'd\u00e9cembre': '12', decembre: '12', december: '12',
  }
  // Match "11 juin 2026" or "Jeudi 11 juin 2026" — allow accented word chars in month name
  const m = line.match(/\b(\d{1,2})\s+([\w\u00c0-\u024f]+)\s+(\d{4})\b/i)
  if (!m) return null
  const month = monthMap[m[2].toLowerCase()]
  if (!month) return null
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`
}

function parseFixtures(text) {
  const cleaned = stripImages(text)
  const chunks = cleaned.split('](https://www.fifa.com/fr/match-centre/match/')
  const fixtures = []
  let currentUtcDate = null

  for (let index = 0; index < chunks.length - 1; index += 1) {
    const chunk = chunks[index]

    // Jina's server-side FIFA rendering exposes fixture dates and times in UTC.
    const beforeEntry = chunk.slice(0, chunk.lastIndexOf('['))
    for (const line of beforeEntry.split('\n')) {
      const d = parseFrenchDateLine(line)
      if (d) currentUtcDate = d
    }

    const entry = chunk.slice(chunk.lastIndexOf('[') + 1).replace(/\s+/g, ' ').trim()

    if (!entry) {
      continue
    }

    const parsed = parseFixtureEntry(entry)
    if (parsed) {
      const nextChunk = chunks[index + 1] ?? ''
      const fifaMatchPath = nextChunk.match(/^([^\s)\n]+)/)?.[1] ?? null
      fixtures.push({ ...parsed, utcDate: currentUtcDate, fifaMatchPath })
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
      played: Number(cells[4]),
      wins: Number(cells[5]),
      draws: Number(cells[6]),
      losses: Number(cells[7]),
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

function buildFallbackStandings(seed, matches) {
  const rowsByTeamId = new Map(
    seed.teams.map((team) => [team.id, {
      groupId: team.groupId,
      teamId: team.id,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    }]),
  )

  const matchById = new Map(matches.map((match) => [match.id, match]))

  for (const seedMatch of seed.matches) {
    const liveMatch = matchById.get(seedMatch.id)
    if (!liveMatch || liveMatch.homeScore === null || liveMatch.awayScore === null) {
      continue
    }

    const homeRow = rowsByTeamId.get(seedMatch.homeTeamId)
    const awayRow = rowsByTeamId.get(seedMatch.awayTeamId)
    if (!homeRow || !awayRow) {
      continue
    }

    homeRow.played += 1
    awayRow.played += 1
    homeRow.goalsFor += liveMatch.homeScore
    homeRow.goalsAgainst += liveMatch.awayScore
    awayRow.goalsFor += liveMatch.awayScore
    awayRow.goalsAgainst += liveMatch.homeScore

    if (liveMatch.homeScore > liveMatch.awayScore) {
      homeRow.wins += 1
      awayRow.losses += 1
      homeRow.points += 3
    } else if (liveMatch.homeScore < liveMatch.awayScore) {
      awayRow.wins += 1
      homeRow.losses += 1
      awayRow.points += 3
    } else {
      homeRow.draws += 1
      awayRow.draws += 1
      homeRow.points += 1
      awayRow.points += 1
    }
  }

  const standings = []
  for (const group of seed.groups) {
    const rows = seed.teams
      .filter((team) => team.groupId === group.id)
      .map((team) => {
        const row = rowsByTeamId.get(team.id)
        row.goalDifference = row.goalsFor - row.goalsAgainst
        return row
      })
      .sort((a, b) => (
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.teamId.localeCompare(b.teamId)
      ))

    rows.forEach((row, index) => {
      standings.push({
        ...row,
        rank: index + 1,
      })
    })
  }

  return standings
}

function parseGroupId(groupDescriptions = []) {
  for (const entry of groupDescriptions) {
    const description = entry?.Description ?? ''
    const match = description.match(/Groupe\s+([A-L])/i)
    if (match) {
      return match[1].toUpperCase()
    }
  }
  return null
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: FIFA_API_HEADERS })
  if (!response.ok) {
    throw new Error(`Source FIFA indisponible (${response.status})`)
  }
  return response.json()
}

async function fetchGroupStageId() {
  const payload = await fetchJson(fifaStagesUrl)
  const stages = payload?.Results ?? []
  const groupStage = stages.find((stage) => {
    const name = stage?.Name?.find((item) => item?.Locale?.startsWith('fr'))?.Description
      ?? stage?.Name?.[0]?.Description
      ?? ''
    return stage?.Type === 1 || /phase de groupes/i.test(name)
  })

  if (!groupStage?.IdStage) {
    throw new Error('Stage FIFA de phase de groupes introuvable.')
  }

  return groupStage.IdStage
}

function buildStandingsFromApiRows(seed, rows, warnings) {
  const codeToTeamId = new Map(seed.teams.map((team) => [team.fifaCode, team.id]))
  const numericTeamIdToCode = new Map()
  const standings = []

  for (const row of rows) {
    const teamCode = row?.Team?.Abbreviation ?? null
    const groupId = parseGroupId(row?.Group)

    if (row?.Team?.IdTeam && teamCode) {
      numericTeamIdToCode.set(String(row.Team.IdTeam), teamCode)
    }

    if (!teamCode || !groupId) {
      continue
    }

    const teamId = codeToTeamId.get(teamCode)
    if (!teamId) {
      warnings.push(`Equipe FIFA non mappee dans le classement: ${teamCode}.`)
      continue
    }

    standings.push({
      groupId,
      teamId,
      rank: Number(row.Position ?? 0),
      played: Number(row.Played ?? 0),
      wins: Number(row.Won ?? 0),
      draws: Number(row.Drawn ?? 0),
      losses: Number(row.Lost ?? 0),
      points: Number(row.Points ?? 0),
      goalDifference: Number(row.GoalsDiference ?? 0),
      goalsFor: Number(row.For ?? 0),
      goalsAgainst: Number(row.Against ?? 0),
    })
  }

  return { standings, numericTeamIdToCode }
}

function normalizeMatchStatus(resultCode, homeScore, awayScore) {
  if (homeScore === null || awayScore === null) {
    return 'scheduled'
  }

  const liveCodes = new Set([1, 2, 5, 6, 7, 8])
  if (liveCodes.has(Number(resultCode))) {
    return 'live'
  }

  return 'finished'
}

function inferLiveMinute(matchResult) {
  const minute = matchResult?.Minute
    ?? matchResult?.MatchMinute
    ?? matchResult?.LivePeriod
    ?? null
  return minute === null || minute === undefined ? null : String(minute)
}

function buildMatchesFromApiRows(seed, rows, numericTeamIdToCode, stageId, warnings) {
  const matchLookup = buildMatchLookup(seed)
  const fixtureByMatchId = new Map()

  for (const row of rows) {
    const groupId = parseGroupId(row?.Group)
    if (!groupId) {
      continue
    }

    for (const result of row?.MatchResults ?? []) {
      const homeCode = numericTeamIdToCode.get(String(result.HomeTeamId))
      const awayCode = numericTeamIdToCode.get(String(result.AwayTeamId))

      if (!homeCode || !awayCode) {
        continue
      }

      const match = matchLookup.get(`${groupId}:${homeCode}:${awayCode}`)
      if (!match) {
        warnings.push(`Match FIFA non mappe: ${groupId} ${homeCode}-${awayCode}.`)
        continue
      }

      if (fixtureByMatchId.has(match.id)) {
        continue
      }

      const homeScore = result.HomeTeamScore ?? null
      const awayScore = result.AwayTeamScore ?? null
      fixtureByMatchId.set(match.id, {
        id: match.id,
        homeScore,
        awayScore,
        status: normalizeMatchStatus(result.Result, homeScore, awayScore),
        kickoffTime: null,
        kickoffIso: result.StartTime ?? null,
        liveMinute: inferLiveMinute(result),
        fifaMatchPath: result.IdMatch ? `${FIFA_COMPETITION_ID}/${FIFA_SEASON_ID}/${stageId}/${result.IdMatch}` : null,
      })
    }
  }

  return Array.from(fixtureByMatchId.values())
}

export async function buildFifaLiveSnapshot(seed) {
  const warnings = []
  const stageId = await fetchGroupStageId()
  const standingsPayload = await fetchJson(buildStandingUrl(stageId))
  const standingRows = standingsPayload?.Results ?? []

  const {
    standings: officialStandings,
    numericTeamIdToCode,
  } = buildStandingsFromApiRows(seed, standingRows, warnings)

  const matches = buildMatchesFromApiRows(seed, standingRows, numericTeamIdToCode, stageId, warnings)

  let standings = officialStandings
  if (officialStandings.length !== seed.teams.length) {
    warnings.push('Classements FIFA incomplets, classement recalcule depuis les resultats de match.')
    standings = buildFallbackStandings(seed, matches)
  }

  if (matches.length === 0) {
    warnings.push('Aucun resultat de groupe n a ete extrait depuis FIFA.')
  }

  if (standings.length === 0) {
    warnings.push('Aucun classement de groupe n a ete extrait depuis FIFA.')
  }

  // Fetch goals from FIFA live API for finished matches to build top scorers
  const finishedMatches = matches.filter(
    (m) => m.status === 'finished' && m.fifaMatchPath,
  )

  const topScorers = await buildTopScorers(finishedMatches, warnings)

  return {
    syncedAt: new Date().toISOString(),
    source: 'fifa-live',
    warnings,
    matches,
    standings,
    topScorers,
  }
}

async function fetchFifaLiveData(fifaMatchPath) {
  try {
    const url = `https://api.fifa.com/api/v3/live/football/${fifaMatchPath}?language=fr-FR`
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; fifabracket/1.0)' },
    })
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

async function buildTopScorers(finishedMatches, warnings) {
  const goalTally = new Map() // key: `${name}|${teamCode}`, value: count

  const results = await Promise.all(
    finishedMatches.map((m) => fetchFifaLiveData(m.fifaMatchPath)),
  )

  for (const data of results) {
    if (!data) continue

    const homeCode = data?.HomeTeam?.Abbreviation ?? null
    const awayCode = data?.AwayTeam?.Abbreviation ?? null

    // Build player id → { name, teamCode } map
    const playerMap = new Map()
    for (const p of data?.HomeTeam?.Players ?? []) {
      const name = p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? ''
      if (p.IdPlayer && name) playerMap.set(p.IdPlayer, { name, teamCode: homeCode })
    }
    for (const p of data?.AwayTeam?.Players ?? []) {
      const name = p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? ''
      if (p.IdPlayer && name) playerMap.set(p.IdPlayer, { name, teamCode: awayCode })
    }

    for (const goal of data?.HomeTeam?.Goals ?? []) {
      const player = playerMap.get(goal.IdPlayer)
      if (!player) continue
      const key = `${player.name}|${player.teamCode}`
      goalTally.set(key, (goalTally.get(key) ?? 0) + 1)
    }

    for (const goal of data?.AwayTeam?.Goals ?? []) {
      const player = playerMap.get(goal.IdPlayer)
      if (!player) continue
      const key = `${player.name}|${player.teamCode}`
      goalTally.set(key, (goalTally.get(key) ?? 0) + 1)
    }
  }

  if (goalTally.size === 0 && finishedMatches.length > 0) {
    warnings.push('Aucun buteur extrait depuis l API FIFA live.')
  }

  return Array.from(goalTally.entries())
    .map(([key, goals]) => {
      const [name, teamCode] = key.split('|')
      return { name, teamCode, goals }
    })
    .sort((a, b) => b.goals - a.goals)
}
