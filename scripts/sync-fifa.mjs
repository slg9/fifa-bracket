import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFifaLiveSnapshot } from './fifa-sync-core.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const seedPath = resolve(root, 'public/data/world-cup-2026.json')
const livePath = resolve(root, 'public/data/fifa-live.json')

async function main() {
  const seed = JSON.parse(await readFile(seedPath, 'utf8'))
  const snapshot = await buildFifaLiveSnapshot(seed)

  await mkdir(dirname(livePath), { recursive: true })
  await writeFile(livePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(`Snapshot ecrit dans ${livePath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
