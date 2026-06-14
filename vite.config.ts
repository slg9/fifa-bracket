import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Vite executes this file in Node; the runtime module is typed locally in the repo.
// @ts-expect-error Local .mjs helper is used by the dev server and sync route.
import { buildFifaLiveSnapshot } from './scripts/fifa-sync-core.mjs'

const seedPath = fileURLToPath(new URL('./public/data/world-cup-2026.json', import.meta.url))

type ApiResponse = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}

type IncomingMessage = {
  url?: string
}

type FifaPlayer = {
  IdPlayer?: string
  ShirtNumber?: number
  Status?: number
  PlayerName?: Array<{ Description?: string }>
  Name?: Array<{ Description?: string }>
}

type FifaCoach = {
  Role?: number
  Name?: Array<{ Description?: string }>
}

type FifaGoal = {
  IdPlayer?: string
  Minute?: number
  Type?: number
}

type FifaTeam = {
  IdTeam?: string
  Abbreviation?: string
  Tactics?: string
  Players?: FifaPlayer[]
  Coaches?: FifaCoach[]
  Goals?: FifaGoal[]
}

type FifaMatchData = {
  HomeTeam?: FifaTeam
  AwayTeam?: FifaTeam
  Attendance?: number
  Stadium?: { Attendance?: number }
}

type FifaTimelineEvent = {
  Type?: number
  IdTeam?: string
}

type FifaTimeline = {
  Event?: FifaTimelineEvent[]
}

const EV_YELLOW = 2, EV_RED = 3, EV_SHOT = 12, EV_CORNER = 16, EV_FOUL = 18

function extractStatsFromTimeline(timelineData: FifaTimeline | null, homeTeamId: string | undefined, awayTeamId: string | undefined) {
  if (!homeTeamId || !awayTeamId) return null
  const events = timelineData?.Event ?? []
  const counts = (teamId: string) => ({
    shots: events.filter(e => e.Type === EV_SHOT && e.IdTeam === teamId).length,
    corners: events.filter(e => e.Type === EV_CORNER && e.IdTeam === teamId).length,
    fouls: events.filter(e => e.Type === EV_FOUL && e.IdTeam === teamId).length,
    yellowCards: events.filter(e => e.Type === EV_YELLOW && e.IdTeam === teamId).length,
    redCards: events.filter(e => e.Type === EV_RED && e.IdTeam === teamId).length,
  })
  return { home: counts(homeTeamId), away: counts(awayTeamId) }
}

function extractPlayersFromTeam(teamData: FifaTeam | undefined): Array<{ shirt: number; name: string; starter: boolean }> {
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

function extractGoalsFromData(data: FifaMatchData) {
  const homeCode = data.HomeTeam?.Abbreviation ?? null
  const awayCode = data.AwayTeam?.Abbreviation ?? null

  const playerMap = new Map<string, { name: string; team: string | null }>()
  for (const p of data.HomeTeam?.Players ?? []) {
    const name = p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? ''
    if (p.IdPlayer) playerMap.set(p.IdPlayer, { name, team: homeCode })
  }
  for (const p of data.AwayTeam?.Players ?? []) {
    const name = p.PlayerName?.[0]?.Description ?? p.Name?.[0]?.Description ?? ''
    if (p.IdPlayer) playerMap.set(p.IdPlayer, { name, team: awayCode })
  }

  const allGoals: Array<{ name: string; minute: string; team: string | null; _raw: number }> = []
  for (const goal of data.HomeTeam?.Goals ?? []) {
    if (!goal.IdPlayer) continue
    const player = playerMap.get(goal.IdPlayer)
    if (!player) continue
    allGoals.push({ name: player.name, minute: goal.Minute != null ? String(goal.Minute).replace(/'+$/, '') + "'" : '', team: homeCode, _raw: parseInt(String(goal.Minute ?? '999'), 10) || 999 })
  }
  for (const goal of data.AwayTeam?.Goals ?? []) {
    if (!goal.IdPlayer) continue
    const player = playerMap.get(goal.IdPlayer)
    if (!player) continue
    allGoals.push({ name: player.name, minute: goal.Minute != null ? String(goal.Minute).replace(/'+$/, '') + "'" : '', team: awayCode, _raw: parseInt(String(goal.Minute ?? '999'), 10) || 999 })
  }
  allGoals.sort((a, b) => a._raw - b._raw)
  return allGoals.map(({ name, minute, team }) => ({ name, minute, team: team ?? '' }))
}

function fifaSyncApi() {
  const handler = async (_req: unknown, res: ApiResponse) => {
    try {
      const seed = JSON.parse(await readFile(seedPath, 'utf8'))
      const snapshot = await buildFifaLiveSnapshot(seed)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(snapshot))
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          message: error instanceof Error ? error.message : 'Synchronisation live indisponible.',
        }),
      )
    }
  }

  return {
    name: 'fifa-sync-api',
    configureServer(server: { middlewares: { use: (path: string, callback: (req: unknown, res: ApiResponse) => void) => void } }) {
      server.middlewares.use('/api/fifa-sync', handler)
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, callback: (req: unknown, res: ApiResponse) => void) => void } }) {
      server.middlewares.use('/api/fifa-sync', handler)
    },
  }
}

function matchStatsApi() {
  const handler = async (req: IncomingMessage, res: ApiResponse) => {
    try {
      const urlStr = req.url ?? ''
      const qIndex = urlStr.indexOf('?')
      const searchParams = new URLSearchParams(qIndex >= 0 ? urlStr.slice(qIndex + 1) : '')
      const path = searchParams.get('path')

      if (!path) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'path required' }))
        return
      }

      const FIFA_HDR = { 'user-agent': 'Mozilla/5.0 (compatible; fifabracket/1.0)' }
      const [response, tlResponse] = await Promise.all([
        fetch(`https://api.fifa.com/api/v3/live/football/${path}?language=fr-FR`, { headers: FIFA_HDR }),
        fetch(`https://api.fifa.com/api/v3/timelines/${path}?language=fr-FR`, { headers: FIFA_HDR }).catch(() => null),
      ])

      if (!response.ok) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'FIFA API unavailable' }))
        return
      }

      const data = await response.json() as FifaMatchData
      const timelineData: FifaTimeline | null = (tlResponse?.ok ? await tlResponse.json() : null)

      const result = {
        home: {
          code: data.HomeTeam?.Abbreviation ?? null,
          tactics: data.HomeTeam?.Tactics ?? null,
          coach: data.HomeTeam?.Coaches?.find((c) => c.Role === 1)?.Name?.[0]?.Description
            ?? data.HomeTeam?.Coaches?.[0]?.Name?.[0]?.Description
            ?? null,
          players: extractPlayersFromTeam(data.HomeTeam),
        },
        away: {
          code: data.AwayTeam?.Abbreviation ?? null,
          tactics: data.AwayTeam?.Tactics ?? null,
          coach: data.AwayTeam?.Coaches?.find((c) => c.Role === 1)?.Name?.[0]?.Description
            ?? data.AwayTeam?.Coaches?.[0]?.Name?.[0]?.Description
            ?? null,
          players: extractPlayersFromTeam(data.AwayTeam),
        },
        goals: extractGoalsFromData(data),
        attendance: data.Attendance != null ? String(data.Attendance) : null,
        stats: extractStatsFromTimeline(timelineData, data.HomeTeam?.IdTeam, data.AwayTeam?.IdTeam),
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
      res.end(JSON.stringify(result))
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Stats unavailable.' }))
    }
  }

  return {
    name: 'match-stats-api',
    configureServer(server: { middlewares: { use: (path: string, callback: (req: IncomingMessage, res: ApiResponse) => void) => void } }) {
      server.middlewares.use('/api/match-stats', handler)
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, callback: (req: IncomingMessage, res: ApiResponse) => void) => void } }) {
      server.middlewares.use('/api/match-stats', handler)
    },
  }
}

const ODDS_API_NAME_TO_FIFA: Record<string, string> = {
  Algeria: 'ALG', Argentina: 'ARG', Australia: 'AUS', Austria: 'AUT',
  Belgium: 'BEL', 'Bosnia & Herzegovina': 'BIH', Brazil: 'BRA', Canada: 'CAN',
  'Cape Verde': 'CPV', Colombia: 'COL', Croatia: 'CRO', 'Curaçao': 'CUW',
  'Czech Republic': 'CZE', 'DR Congo': 'COD', Ecuador: 'ECU', Egypt: 'EGY',
  England: 'ENG', France: 'FRA', Germany: 'GER', Ghana: 'GHA',
  Haiti: 'HAI', Iran: 'IRN', Iraq: 'IRQ', 'Ivory Coast': 'CIV',
  Japan: 'JPN', Jordan: 'JOR', Mexico: 'MEX', Morocco: 'MAR',
  Netherlands: 'NED', 'New Zealand': 'NZL', Norway: 'NOR', Panama: 'PAN',
  Paraguay: 'PAR', Portugal: 'POR', Qatar: 'QAT', 'Saudi Arabia': 'KSA',
  Scotland: 'SCO', Senegal: 'SEN', 'South Africa': 'RSA', 'South Korea': 'KOR',
  Spain: 'ESP', Sweden: 'SWE', Switzerland: 'SUI', Tunisia: 'TUN',
  Turkey: 'TUR', USA: 'USA', Uruguay: 'URU', Uzbekistan: 'UZB',
}

function oddsApi() {
  const handler = async (_req: unknown, res: ApiResponse) => {
    const apiKey = process.env.ODDS_API_KEY
    if (!apiKey) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'ODDS_API_KEY not configured' }))
      return
    }
    try {
      const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?apiKey=${apiKey}&regions=eu&markets=h2h&oddsFormat=decimal`
      const response = await fetch(url)
      if (!response.ok) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'Odds API unavailable' }))
        return
      }
      const events = await response.json() as Array<{
        home_team: string; away_team: string; commence_time: string
        bookmakers: Array<{ markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }> }>
      }>

      const result: Record<string, unknown> = {}
      for (const event of events) {
        const homeCode = ODDS_API_NAME_TO_FIFA[event.home_team]
        const awayCode = ODDS_API_NAME_TO_FIFA[event.away_team]
        if (!homeCode || !awayCode) continue
        const prices = { home: [] as number[], draw: [] as number[], away: [] as number[] }
        for (const bk of event.bookmakers) {
          const h2h = bk.markets.find(m => m.key === 'h2h')
          if (!h2h) continue
          for (const outcome of h2h.outcomes) {
            const code = ODDS_API_NAME_TO_FIFA[outcome.name]
            if (code === homeCode) prices.home.push(outcome.price)
            else if (code === awayCode) prices.away.push(outcome.price)
            else if (outcome.name === 'Draw') prices.draw.push(outcome.price)
          }
        }
        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
        const homeAvg = avg(prices.home), drawAvg = avg(prices.draw), awayAvg = avg(prices.away)
        if (!homeAvg || !drawAvg || !awayAvg) continue
        const rH = 1 / homeAvg, rD = 1 / drawAvg, rA = 1 / awayAvg, total = rH + rD + rA
        const r1 = (x: number) => Math.round(x * 10) / 10
        result[`${homeCode}-${awayCode}`] = {
          commenceTime: event.commence_time,
          home: { code: homeCode, avgOdds: r1(homeAvg), prob: Math.round((rH / total) * 100) },
          draw: { avgOdds: r1(drawAvg), prob: Math.round((rD / total) * 100) },
          away: { code: awayCode, avgOdds: r1(awayAvg), prob: Math.round((rA / total) * 100) },
        }
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=14400')
      res.end(JSON.stringify(result))
    } catch (err) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Odds unavailable' }))
    }
  }

  return {
    name: 'odds-api',
    configureServer(server: { middlewares: { use: (path: string, callback: (req: unknown, res: ApiResponse) => void) => void } }) {
      server.middlewares.use('/api/odds', handler)
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, callback: (req: unknown, res: ApiResponse) => void) => void } }) {
      server.middlewares.use('/api/odds', handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), fifaSyncApi(), matchStatsApi(), oddsApi()],
})
