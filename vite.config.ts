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

export default defineConfig({
  plugins: [react(), fifaSyncApi()],
})
