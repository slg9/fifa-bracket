async function fetchFifaMatchData(fifaMatchPath) {
  const url = `https://api.fifa.com/api/v3/live/football/${fifaMatchPath}?language=fr-FR`
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; fifabracket/1.0)' },
  })
  if (!response.ok) return null
  return response.json()
}

function extractPlayers(teamData) {
  if (!teamData?.Players) return []
  return teamData.Players.map((p) => ({
    shirt: p.ShirtNumber ?? 0,
    name: p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? '',
    starter: p.Status === 1,
  })).sort((a, b) => {
    // Starters first, then by shirt number
    if (a.starter !== b.starter) return a.starter ? -1 : 1
    return a.shirt - b.shirt
  })
}

function extractGoals(data) {
  const allGoals = []

  const homeCode = data?.HomeTeam?.Abbreviation ?? null
  const awayCode = data?.AwayTeam?.Abbreviation ?? null

  // Build player lookup across both teams
  const playerMap = new Map()
  for (const p of data?.HomeTeam?.Players ?? []) {
    const name = p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? ''
    if (p.IdPlayer) playerMap.set(p.IdPlayer, { name, team: homeCode })
  }
  for (const p of data?.AwayTeam?.Players ?? []) {
    const name = p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? ''
    if (p.IdPlayer) playerMap.set(p.IdPlayer, { name, team: awayCode })
  }

  for (const goal of data?.HomeTeam?.Goals ?? []) {
    const player = playerMap.get(goal.IdPlayer)
    if (!player) continue
    allGoals.push({
      name: player.name,
      minute: goal.Minute != null ? String(goal.Minute).replace(/'+$/, '') + "'" : '',
      team: homeCode,
      _minuteRaw: parseInt(String(goal.Minute ?? '999'), 10) || 999,
    })
  }

  for (const goal of data?.AwayTeam?.Goals ?? []) {
    const player = playerMap.get(goal.IdPlayer)
    if (!player) continue
    allGoals.push({
      name: player.name,
      minute: goal.Minute != null ? `${goal.Minute}'` : '',
      team: awayCode,
      _minuteRaw: goal.Minute ?? 999,
    })
  }

  allGoals.sort((a, b) => a._minuteRaw - b._minuteRaw)
  return allGoals.map(({ name, minute, team }) => ({ name, minute, team }))
}

export default async function handler(req, res) {
  const { path } = req.query
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path required' })
  }

  const data = await fetchFifaMatchData(path)

  if (!data) {
    return res.status(502).json({ error: 'FIFA API unavailable' })
  }

  const result = {
    home: {
      code: data.HomeTeam?.Abbreviation ?? null,
      tactics: data.HomeTeam?.Tactics ?? null,
      coach: data.HomeTeam?.Coaches?.find((c) => c.Role === 1)?.Name?.[0]?.Description
        ?? data.HomeTeam?.Coaches?.[0]?.Name?.[0]?.Description
        ?? null,
      players: extractPlayers(data.HomeTeam),
    },
    away: {
      code: data.AwayTeam?.Abbreviation ?? null,
      tactics: data.AwayTeam?.Tactics ?? null,
      coach: data.AwayTeam?.Coaches?.find((c) => c.Role === 1)?.Name?.[0]?.Description
        ?? data.AwayTeam?.Coaches?.[0]?.Name?.[0]?.Description
        ?? null,
      players: extractPlayers(data.AwayTeam),
    },
    goals: extractGoals(data),
    attendance: data.Stadium?.Attendance != null ? String(data.Stadium.Attendance) : null,
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  res.status(200).json(result)
}
