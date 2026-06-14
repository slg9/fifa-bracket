// Vercel Blob cache helper — used by API routes and sync scripts.
// Falls back gracefully (returns null) when BLOB_READ_WRITE_TOKEN is absent (local dev without env pull).

import { put, head } from '@vercel/blob'

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN

function hasToken() {
  return Boolean(TOKEN)
}

/**
 * Read a JSON value from Blob storage.
 * Returns null if not found, token missing, or on any error.
 */
export async function blobGet(key) {
  if (!hasToken()) return null
  try {
    // Blob URL is deterministic when using addRandomSuffix: false
    const url = `https://${process.env.BLOB_STORE_ID}.public.blob.vercel-storage.com/${key}`
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Write a JSON value to Blob storage.
 * Wraps the value with a `cachedAt` timestamp.
 * Returns the blob URL or null on failure.
 */
export async function blobPut(key, value) {
  if (!hasToken()) return null
  try {
    const payload = JSON.stringify({ cachedAt: new Date().toISOString(), data: value })
    const { url } = await put(key, payload, {
      access: 'public',
      addRandomSuffix: false,
      token: TOKEN,
      contentType: 'application/json',
    })
    return url
  } catch {
    return null
  }
}

/**
 * Read a cached blob entry and check if it's still fresh.
 * @param {string} key
 * @param {number} maxAgeMs - milliseconds before cache is considered stale
 * @returns {{ data: any, stale: boolean } | null}
 */
export async function blobGetFresh(key, maxAgeMs) {
  const entry = await blobGet(key)
  if (!entry || !entry.cachedAt) return null
  const age = Date.now() - new Date(entry.cachedAt).getTime()
  return { data: entry.data, stale: age > maxAgeMs }
}
