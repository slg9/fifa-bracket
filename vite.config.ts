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

function parseMatchStats(text: string) {
  const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)

  function extractPair(label: string) {
    const idx = lines.findIndex((l: string) => l === label || l.startsWith(label))
    if (idx === -1) return null
    const values: number[] = []
    for (let i = idx + 1; i < Math.min(idx + 10, lines.length) && values.length < 2; i++) {
      const m = lines[i].match(/^(\d+)/)
      if (m) values.push(Number(m[1]))
    }
    return values.length === 2 ? { home: values[0], away: values[1] } : null
  }

  function extractPossession() {
    const idx = lines.findIndex((l: string) => l === 'Possession')
    if (idx === -1) return null
    const pcts: number[] = []
    for (let i = idx + 1; i < Math.min(idx + 8, lines.length) && pcts.length < 2; i++) {
      const m = lines[i].match(/^(\d+)%/)
      if (m) pcts.push(Number(m[1]))
      else {
        const m2 = lines[i].match(/^(\d+)%\w/)
        if (m2) pcts.push(Number(m2[1]))
      }
    }
    return pcts.length >= 2 ? { home: pcts[0], away: pcts[1] } : null
  }

  function extractTotalShots() {
    const frapIdx = lines.findIndex((l: string) => l === 'Frappes au but' || l.includes('Frappes au but'))
    if (frapIdx === -1) return extractPair('Total')
    const totalIdx = lines.findIndex((l: string, i: number) => i > frapIdx && l === 'Total')
    if (totalIdx === -1) return null
    const values: number[] = []
    for (let i = totalIdx + 1; i < Math.min(totalIdx + 6, lines.length) && values.length < 2; i++) {
      const m = lines[i].match(/^(\d+)/)
      if (m) values.push(Number(m[1]))
    }
    return values.length === 2 ? { home: values[0], away: values[1] } : null
  }

  function dedup(s: string): string {
    const parts = s.trim().split(/\s+/)
    const half = Math.floor(parts.length / 2)
    if (half > 0) {
      const first = parts.slice(0, half).join(' ')
      const second = parts.slice(half).join(' ')
      if (first === second) return first
    }
    return s.trim()
  }

  function extractScorers() {
    // Strategy 1: FIFA player-stats "Buts Buts" doubled-label (GER/CUW style pages)
    const butsRe = /^Buts?\s+Buts?$/i
    const scorers1: Array<{ name: string; minute: string | null }> = []
    for (let i = 3; i < lines.length; i++) {
      if (!butsRe.test(lines[i])) continue
      const lastRaw = lines[i - 2]
      const firstRaw = lines[i - 3]
      if (!lastRaw || !firstRaw) continue
      const lastName = dedup(lastRaw)
      const firstName = dedup(firstRaw)
      const name = `${firstName} ${lastName}`.trim()
      if (name.length > 2) scorers1.push({ name, minute: null })
    }
    if (scorers1.length > 0) return scorers1

    // Strategy 2: events section — Name line followed by minute line (NED/JPN style pages)
    const minuteRe = /^\d{1,3}['\u2019\u02b9\u2032+]/
    const skipRe = /^(https?:|www\.|Image|Coupe|FIFA|Groupe|Phase|APERÇU|STATS|COMPO|CLASSEM|INFOS|LIVE|Où|Télé|Pas|data |Fin |Mi-|En |Match|Politique|Télécharger)/i
    const scorers2: Array<{ name: string; minute: string | null }> = []
    for (let i = 0; i < lines.length - 1; i++) {
      if (!minuteRe.test(lines[i + 1])) continue
      const name = lines[i].trim()
      if (name.length < 3 || name.length > 60) continue
      if (skipRe.test(name)) continue
      if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) continue
      if (/^\d+$/.test(name)) continue
      scorers2.push({ name, minute: lines[i + 1].replace(/['\u2019\u02b9\u2032]/g, "'") })
      i++
    }
    return scorers2
  }

  return {
    possession: extractPossession(),
    shots: extractTotalShots(),
    shotsOnTarget: extractPair('Cadrés'),
    corners: extractPair('Corners') ?? extractPair('Corner'),
    fouls: extractPair('Fautes concédées'),
    yellowCards: extractPair('Cartons jaunes'),
    redCards: extractPair('Cartons rouges'),
    passes: extractPair('Passes décisives'),
    scorers: extractScorers(),
  }
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

      const url = `https://r.jina.ai/https://www.fifa.com/fr/match-centre/match/${path}`
      const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0', 'x-no-cache': 'true' },
      })

      if (!response.ok) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'FIFA page unavailable' }))
        return
      }

      const text = await response.text()
      const stats = parseMatchStats(text)

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.end(JSON.stringify(stats))
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
