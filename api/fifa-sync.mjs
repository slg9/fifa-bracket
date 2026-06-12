import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFifaLiveSnapshot } from '../scripts/fifa-sync-core.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const seedPath = join(__dirname, '..', 'public', 'data', 'world-cup-2026.json')

export default async function handler(_req, res) {
  try {
    const seed = JSON.parse(await readFile(seedPath, 'utf8'))
    const snapshot = await buildFifaLiveSnapshot(seed)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(JSON.stringify(snapshot))
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Sync failed.',
    })
  }
}
