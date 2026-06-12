const standingsUrl =
  'https://r.jina.ai/https://www.fifa.com/fr/tournaments/mens/worldcup/canadamexicousa2026/standings'
const fixturesUrl =
  'https://r.jina.ai/https://www.fifa.com/fr/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures?country=FR&wtw-filter=ALL'

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io'
const API_FOOTBALL_LEAGUE = 1
const API_FOOTBALL_SEASON = 2026

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

function normalizeApiFootballStatus(shortStatus) {
  const live = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']
  const finished = ['FT', 'AET', 'PEN']

  if (live.includes(shortStatus)) return 'live'
  if (finished.includes(shortStatus)) return 'finished'
  return 'scheduled'
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

    // Primary: groupId + codes
    lookup.set(`${match.groupId}:${homeTeam.fifaCode}:${awayTeam.fifaCode}`, match)
    // Secondary: codes only (for API-Football which doesn't expose groupId)
    lookup.set(`${homeTeam.fifaCode}:${awayTeam.fifaCode}`, match)
  }

  return lookup
}

async function buildApiFootballSnapshot(seed, apiKey) {
  const warnings = []
  const matchLookup = buildMatchLookup(seed)

  const url = `${API_FOOTBALL_BASE}/fixtures?league=${API_FOOTBALL_LEAGUE}&season=${API_FOOTBALL_SEASON}`
  const response = await fetch(url, {
    headers: {
      'x-apisports-key': apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(`API-Football indisponible (${response.status}).`)
  }

  const json = await response.json()
  const fixtures = json.response ?? []

  if (fixtures.length === 0) {
    throw new Error('API-Football: aucun match retourné pour la Coupe du Monde 2026.')
  }

  // Only process group stage fixtures
  const groupFixtures = fixtures.filter((f) =>
    typeof f.league?.round === 'string' && f.league.round.startsWith('Group Stage'),
  )

  const matches = []
  // Map: seed match ID → API-Football fixture ID (for predictions)
  const apiFixtureIdBySeedId = new Map()

  for (const f of groupFixtures) {
    const homeCode = f.teams?.home?.code
    const awayCode = f.teams?.away?.code
    if (!homeCode || !awayCode) continue

    const seedMatch = matchLookup.get(`${homeCode}:${awayCode}`)
    if (!seedMatch) {
      warnings.push(`API-Football: match non mappé ${homeCode}-${awayCode}.`)
      continue
    }

    const status = normalizeApiFootballStatus(f.fixture?.status?.short ?? '')
    const homeScore = f.goals?.home ?? null
    const awayScore = f.goals?.away ?? null

    matches.push({
      id: seedMatch.id,
      homeScore: status === 'scheduled' ? null : homeScore,
      awayScore: status === 'scheduled' ? null : awayScore,
      status,
      kickoffTime: null,
      kickoffIso: f.fixture?.date ?? null,
    })

    if (status === 'scheduled' && f.fixture?.id) {
      apiFixtureIdBySeedId.set(seedMatch.id, f.fixture.id)
    }
  }

  if (matches.length === 0) {
    throw new Error('API-Football: aucun match de groupe mappé.')
  }

  // Fetch predictions for upcoming matches (next 10 days, max 15 calls)
  const now = new Date()
  const tenDays = 10 * 24 * 60 * 60 * 1000
  const upcomingEntries = [...apiFixtureIdBySeedId.entries()]
    .filter(([seedId]) => {
      const m = matches.find((x) => x.id === seedId)
      if (!m?.kickoffIso) return false
      const diff = new Date(m.kickoffIso) - now
      return diff >= 0 && diff <= tenDays
    })
    .slice(0, 15)

  const predictions = []
  if (upcomingEntries.length > 0) {
    // Batch in groups of 5 to avoid rate-limit bursts
    for (let i = 0; i < upcomingEntries.length; i += 5) {
      const batch = upcomingEntries.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async ([seedId, apiId]) => {
          const res = await fetch(`${API_FOOTBALL_BASE}/predictions?fixture=${apiId}`, {
            headers: { 'x-apisports-key': apiKey },
          })
          if (!res.ok) return null
          const json = await res.json()
          const pred = json.response?.[0]
          if (!pred) return null

          const pct = pred.predictions?.percent ?? {}
          const parse = (s) => parseInt((s ?? '0').replace('%', ''), 10) || 0

          return {
            matchId: seedId,
            homePercent: parse(pct.home),
            drawPercent: parse(pct.draw),
            awayPercent: parse(pct.away),
            homeForm: pred.teams?.home?.last_5?.form ?? null,
            awayForm: pred.teams?.away?.last_5?.form ?? null,
            homeGoalsAvg: parseFloat(pred.teams?.home?.last_5?.goals?.for?.average ?? '') || null,
            awayGoalsAvg: parseFloat(pred.teams?.away?.last_5?.goals?.for?.average ?? '') || null,
            advice: pred.predictions?.advice ?? null,
            winnerName: pred.predictions?.winner?.name ?? null,
          }
        }),
      )
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          predictions.push(result.value)
        }
      }
      // Small pause between batches
      if (i + 5 < upcomingEntries.length) {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }

  // Build standings from API-Football standings endpoint
  const standingsUrl2 = `${API_FOOTBALL_BASE}/standings?league=${API_FOOTBALL_LEAGUE}&season=${API_FOOTBALL_SEASON}`
  const standingsRes = await fetch(standingsUrl2, {
    headers: { 'x-apisports-key': apiKey },
  })

  const standings = []
  const codeToTeamId = new Map(seed.teams.map((team) => [team.fifaCode, team.id]))

  if (standingsRes.ok) {
    const standingsJson = await standingsRes.json()
    const groups = standingsJson.response?.[0]?.league?.standings ?? []

    for (const group of groups) {
      for (const row of group) {
        const teamId = codeToTeamId.get(row.team?.code)
        if (!teamId) {
          warnings.push(`API-Football: équipe non mappée dans classements: ${row.team?.code}.`)
          continue
        }
        standings.push({
          groupId: row.group?.replace('Group ', '') ?? '',
          teamId,
          rank: row.rank ?? 0,
          points: row.points ?? 0,
          goalDifference: row.goalsDiff ?? 0,
          goalsFor: row.all?.goals?.for ?? 0,
          goalsAgainst: row.all?.goals?.against ?? 0,
        })
      }
    }
  } else {
    warnings.push(`API-Football: classements indisponibles (${standingsRes.status}).`)
  }

  return {
    syncedAt: new Date().toISOString(),
    source: 'api-football',
    warnings,
    matches,
    standings,
    predictions,
  }
}

export async function buildFifaLiveSnapshot(seed, apiKey) {
  // Try API-Football first if key is provided
  if (apiKey) {
    try {
      return await buildApiFootballSnapshot(seed, apiKey)
    } catch (error) {
      console.warn('[sync] API-Football failed, falling back to FIFA.com:', error.message)
    }
  }

  // Fallback: scrape FIFA.com via Jina
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
      kickoffTime: null, // scraped time has no reliable timezone — use API-Football kickoffIso instead
      kickoffIso: null,
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
