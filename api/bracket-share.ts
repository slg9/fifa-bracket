import { get, put } from '@vercel/blob'
import type { PublicBracketShare } from '../src/types'

type ApiRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string | number) => void
  end: (body?: string | Buffer) => void
}

const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL ?? 'https://brakup.app').replace(/\/$/, '')
const BLOB_ACCESS = process.env.BRAKUP_BLOB_ACCESS === 'public' ? 'public' : 'private'
const DEFAULT_EXPIRY_DAYS = 30
const MAX_DATA_URL_BYTES = 8 * 1024 * 1024

function parseBody(req: ApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') return JSON.parse(req.body) as Record<string, unknown>
  return (req.body ?? {}) as Record<string, unknown>
}

function sharePath(id: string) {
  return `public-bracket-shares/${id}.json`
}

function imagePath(id: string) {
  return `public-bracket-shares/${id}.png`
}

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
}

function sanitizeText(value: unknown, fallback: string, max = 80) {
  return String(value ?? fallback).trim().slice(0, max) || fallback
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function dataUrlToPngBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/)
  if (!match) throw new Error('Image PNG invalide.')
  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_DATA_URL_BYTES) {
    throw new Error('Image trop lourde pour le partage.')
  }
  return buffer
}

async function readShare(id: string): Promise<PublicBracketShare | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null
  const result = await get(sharePath(id), {
    access: BLOB_ACCESS,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    useCache: false,
  })
  if (!result || result.statusCode !== 200 || !result.stream) return null
  const text = await new Response(result.stream).text()
  return text.trim() ? JSON.parse(text) as PublicBracketShare : null
}

function isExpired(share: PublicBracketShare) {
  return Boolean(share.expiresAt && new Date(share.expiresAt).getTime() < Date.now())
}

async function readImage(id: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null
  const result = await get(imagePath(id), {
    access: BLOB_ACCESS,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    useCache: false,
  })
  if (!result || result.statusCode !== 200 || !result.stream) return null
  return Buffer.from(await new Response(result.stream).arrayBuffer())
}

function sendHtml(res: ApiResponse, share: PublicBracketShare, shareUrl: string, imageUrl: string) {
  const title = `${share.bracketName || 'Bracket FIFA'} - ${share.pseudo || 'Brakup'}`
  const description = `Le bracket Coupe du Monde 2026 de ${share.pseudo || 'Brakup'}. Cree le tien et compare ton parcours.`
  const appUrl = `${PUBLIC_SITE_URL}/?share=${encodeURIComponent(share.id)}`
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:type" content="image/png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}" />
</head>
<body>
  <a href="${escapeHtml(appUrl)}">Ouvrir le bracket</a>
  <script>location.replace(${JSON.stringify(appUrl)})</script>
</body>
</html>`
  res.status(200)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.end(html)
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const url = new URL(req.url ?? '/api/bracket-share', PUBLIC_SITE_URL)

    if (req.method === 'POST') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        res.status(500).json({ error: 'Stockage Brakup indisponible.' })
        return
      }

      const body = parseBody(req)
      const id = cleanId(crypto.randomUUID().replaceAll('-', '').slice(0, 18))
      const now = new Date()
      const expiresInDays = Math.max(1, Math.min(90, Number(body.expiresInDays ?? DEFAULT_EXPIRY_DAYS) || DEFAULT_EXPIRY_DAYS))
      const imageBuffer = dataUrlToPngBuffer(String(body.imageDataUrl ?? ''))
      const share: PublicBracketShare = {
        id,
        pseudo: sanitizeText(body.pseudo, 'Brakup', 40),
        bracketName: sanitizeText(body.bracketName, 'Mon bracket', 60),
        overrides: body.overrides && typeof body.overrides === 'object' ? body.overrides as PublicBracketShare['overrides'] : {},
        knockoutPicks: body.knockoutPicks && typeof body.knockoutPicks === 'object' ? body.knockoutPicks as PublicBracketShare['knockoutPicks'] : {},
        imagePath: imagePath(id),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      }

      await put(imagePath(id), imageBuffer, {
        access: BLOB_ACCESS,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'image/png',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })
      await put(sharePath(id), JSON.stringify(share), {
        access: BLOB_ACCESS,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })

      res.status(200).json({ data: { share, shareUrl: `${PUBLIC_SITE_URL}/share/bracket/${id}` } })
      return
    }

    if (req.method && req.method !== 'GET') {
      res.status(405).json({ error: 'Methode non autorisee.' })
      return
    }

    const id = cleanId(url.searchParams.get('id') ?? url.pathname.split('/').filter(Boolean).at(-1) ?? '')
    if (!id) {
      res.status(400).json({ error: 'ID requis.' })
      return
    }

    const share = await readShare(id)
    if (!share || isExpired(share)) {
      res.status(404).json({ error: 'Bracket partage introuvable.' })
      return
    }

    if (url.searchParams.get('image') === '1') {
      const image = await readImage(id)
      if (!image) {
        res.status(404).json({ error: 'Image introuvable.' })
        return
      }
      res.status(200)
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
      res.end(image)
      return
    }

    const accept = Array.isArray(req.headers.accept) ? req.headers.accept.join(',') : req.headers.accept ?? ''
    if (accept.includes('application/json') || url.searchParams.get('format') === 'json') {
      res.status(200).json({ data: share })
      return
    }

    const shareUrl = `${PUBLIC_SITE_URL}/share/bracket/${share.id}`
    const imageUrl = `${PUBLIC_SITE_URL}/api/bracket-share?id=${encodeURIComponent(share.id)}&image=1`
    sendHtml(res, share, shareUrl, imageUrl)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Partage indisponible.' })
  }
}
