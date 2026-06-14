import { blobGetFresh, blobPut } from '../scripts/blob-cache.mjs'

// Cache finished matches forever (data never changes), live/scheduled for 3 min
const FINISHED_MAX_AGE = 365 * 24 * 60 * 60 * 1000 // 1 year = permanent
const LIVE_MAX_AGE = 3 * 60 * 1000 // 3 minutes

const FIFA_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; fifabracket/1.0)' }

async function fetchFifaMatchData(fifaMatchPath) {
  const url = `https://api.fifa.com/api/v3/live/football/${fifaMatchPath}?language=fr-FR`
  const response = await fetch(url, { headers: FIFA_HEADERS })
  if (!response.ok) return null
  return response.json()
}

async function fetchFifaTimelines(fifaMatchPath) {
  const url = `https://api.fifa.com/api/v3/timelines/${fifaMatchPath}?language=fr-FR`
  try {
    const response = await fetch(url, { headers: FIFA_HEADERS })
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

// Timeline event types
const EV_YELLOW = 2, EV_RED = 3, EV_SHOT = 12, EV_CORNER = 16, EV_FOUL = 18

function extractStats(timelineData, homeTeamId, awayTeamId) {
  const events = timelineData?.Event ?? []
  const counts = (teamId) => ({
    shots: events.filter(e => e.Type === EV_SHOT && e.IdTeam === teamId).length,
    corners: events.filter(e => e.Type === EV_CORNER && e.IdTeam === teamId).length,
    fouls: events.filter(e => e.Type === EV_FOUL && e.IdTeam === teamId).length,
    yellowCards: events.filter(e => e.Type === EV_YELLOW && e.IdTeam === teamId).length,
    redCards: events.filter(e => e.Type === EV_RED && e.IdTeam === teamId).length,
  })
  if (!homeTeamId || !awayTeamId) return null
  return { home: counts(homeTeamId), away: counts(awayTeamId) }
}

function extractPlayers(teamData) {
  if (!teamData?.Players) return []
  return teamData.Players.map((p) => ({
    shirt: p.ShirtNumber ?? 0,
    name: p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? '',
    starter: p.Status === 1,
  })).sort((a, b) => {
    if (a.starter !== b.starter) return a.starter ? -1 : 1
    return a.shirt - b.shirt
  })
}

function extractGoals(data) {
  const allGoals = []
  const homeCode = data?.HomeTeam?.Abbreviation ?? null
  const awayCode = data?.AwayTeam?.Abbreviation ?? null

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
      _raw: parseInt(String(goal.Minute ?? '999'), 10) || 999,
    })
  }
  for (const goal of data?.AwayTeam?.Goals ?? []) {
    const player = playerMap.get(goal.IdPlayer)
    if (!player) continue
    allGoals.push({
      name: player.name,
      minute: goal.Minute != null ? String(goal.Minute).replace(/'+$/, '') + "'" : '',
      team: awayCode,
      _raw: parseInt(String(goal.Minute ?? '999'), 10) || 999,
    })
  }

  allGoals.sort((a, b) => a._raw - b._raw)
  return allGoals.map(({ name, minute, team }) => ({ name, minute, team }))
}

function buildResult(data, timelineData) {
  const homeTeamId = data.HomeTeam?.IdTeam ?? null
  const awayTeamId = data.AwayTeam?.IdTeam ?? null
  return {
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
    attendance: data.Attendance != null ? String(data.Attendance) : null,
    stats: extractStats(timelineData, homeTeamId, awayTeamId),
  }
}

export default async function handler(req, res) {
  const { path, status } = req.query
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path required' })
  }

  const isFinished = status === 'finished'
  const blobKey = `match-events/${path.replace(/\//g, '-')}.json`
  const maxAge = isFinished ? FINISHED_MAX_AGE : LIVE_MAX_AGE

  // 1. Try blob cache first
  const cached = await blobGetFresh(blobKey, maxAge)
  if (cached && !cached.stale) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', isFinished
      ? 'public, s-maxage=86400, stale-while-revalidate=604800'
      : 'public, s-maxage=180, stale-while-revalidate=300')
    res.setHeader('X-Cache', 'HIT')
    return res.status(200).json(cached.data)
  }

  // 2. Fetch from FIFA API (live match data + timelines for stats)
  const [data, timelineData] = await Promise.all([
    fetchFifaMatchData(path),
    fetchFifaTimelines(path),
  ])
  if (!data) {
    // If we have stale cache, return it rather than erroring
    if (cached) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('X-Cache', 'STALE')
      return res.status(200).json(cached.data)
    }
    return res.status(502).json({ error: 'FIFA API unavailable' })
  }

  const result = buildResult(data, timelineData)

  // 3. Persist to blob (fire-and-forget — don't delay the response)
  // Only persist finished matches or matches with goals (avoid caching empty pre-match data)
  if (isFinished || result.goals.length > 0) {
    blobPut(blobKey, result).catch(() => {})
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', isFinished
    ? 'public, s-maxage=86400, stale-while-revalidate=604800'
    : 'public, s-maxage=180, stale-while-revalidate=300')
  res.setHeader('X-Cache', 'MISS')
  res.status(200).json(result)
}
