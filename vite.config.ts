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

  function extractScorers() {
    const scorers: Array<{ name: string; minute: string }> = []
    const minuteRe = /^\d+[''\u2019\u02b9\u2032]/
    for (let i = 0; i < lines.length - 1; i++) {
      if (minuteRe.test(lines[i + 1]) && /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ\s\-']+$/.test(lines[i]) && lines[i].length > 2) {
        scorers.push({ name: lines[i], minute: lines[i + 1] })
        i++
      }
    }
    return scorers
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

export default defineConfig({
  plugins: [react(), fifaSyncApi(), matchStatsApi()],
})
