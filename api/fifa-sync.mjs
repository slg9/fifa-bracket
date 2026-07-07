import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFifaLiveSnapshot } from '../scripts/fifa-sync-core.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const seedPath = join(__dirname, '..', 'public', 'data', 'world-cup-2026.json')
const CACHE_MS = parsePositiveInt(process.env.FIFA_SYNC_CACHE_MS, 2 * 60_000)
const STALE_IF_ERROR_MS = parsePositiveInt(process.env.FIFA_SYNC_STALE_IF_ERROR_MS, 30 * 60_000)

let memoryCache = null
let inFlight = null

function parsePositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isFresh(entry, maxAgeMs) {
  return entry && Date.now() - entry.cachedAt < maxAgeMs
}

function sendSnapshot(res, snapshot, cacheStatus) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', `public, s-maxage=${Math.floor(CACHE_MS / 1000)}, stale-while-revalidate=${Math.floor(STALE_IF_ERROR_MS / 1000)}`)
  res.setHeader('X-FIFA-Sync-Cache', cacheStatus)
  res.status(200).send(JSON.stringify(snapshot))
}

export default async function handler(_req, res) {
  try {
    if (isFresh(memoryCache, CACHE_MS)) {
      sendSnapshot(res, memoryCache.snapshot, 'HIT')
      return
    }

    if (!inFlight) {
      inFlight = (async () => {
        const seed = JSON.parse(await readFile(seedPath, 'utf8'))
        return buildFifaLiveSnapshot(seed)
      })().finally(() => {
        inFlight = null
      })
    }

    const snapshot = await inFlight
    memoryCache = { cachedAt: Date.now(), snapshot }
    sendSnapshot(res, snapshot, 'MISS')
  } catch (error) {
    if (isFresh(memoryCache, STALE_IF_ERROR_MS)) {
      sendSnapshot(res, {
        ...memoryCache.snapshot,
        warnings: [
          ...(Array.isArray(memoryCache.snapshot.warnings) ? memoryCache.snapshot.warnings : []),
          error instanceof Error ? `Sync stale: ${error.message}` : 'Sync stale.',
        ],
      }, 'STALE')
      return
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Sync failed.',
    })
  }
}
