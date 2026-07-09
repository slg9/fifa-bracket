import { get, put } from '@vercel/blob'

type ApiRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
}

type ClientInfo = {
  userAgent?: string
  language?: string
  languages?: string[]
  timezone?: string
  platform?: string
  screen?: { width: number; height: number; dpr: number }
  viewport?: { width: number; height: number }
  connection?: string
  memoryGb?: number
  cores?: number
  touch?: boolean
  referrer?: string
}

type AnalyticsEvent = {
  id?: string
  name: string
  at?: string
  path?: string
  surface?: string
  payload?: Record<string, unknown>
}

type AnalyticsSession = {
  sessionId: string
  visitorId: string
  firstSeenAt: string
  lastSeenAt: string
  durationMs: number
  eventCount: number
  paths: string[]
  surfaces: string[]
  client: ClientInfo
  network: {
    ip: string | null
    country: string | null
    region: string | null
    city: string | null
    latitude: string | null
    longitude: string | null
    timezone: string | null
  }
  profile: {
    pseudo: string | null
    emailHash: string | null
    hasAccount: boolean
    becameAccountAt: string | null
  }
  lastActions: Array<AnalyticsEvent & { at: string }>
}

type AnalyticsStore = {
  updatedAt: string
  sessions: AnalyticsSession[]
}

const BLOB_ACCESS = process.env.BRAKUP_BLOB_ACCESS === 'public' ? 'public' : 'private'
const STORE_PATH = 'analytics/sessions.json'
const MAX_SESSIONS = 1200
const MAX_ACTIONS_PER_SESSION = 80
const memoryStore: AnalyticsStore = { updatedAt: new Date(0).toISOString(), sessions: [] }

function emptyStore(): AnalyticsStore {
  return { updatedAt: new Date(0).toISOString(), sessions: [] }
}

function header(req: ApiRequest, name: string) {
  const value = req.headers[name.toLowerCase()] ?? req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function parseBody(req: ApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') return req.body.trim() ? JSON.parse(req.body) as Record<string, unknown> : {}
  return (req.body ?? {}) as Record<string, unknown>
}

function cleanText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max)
}

function cleanId(value: unknown, fallback: string = crypto.randomUUID()) {
  const text = cleanText(value, 100).replace(/[^a-zA-Z0-9:_-]/g, '')
  return text || fallback
}

function clientIp(req: ApiRequest) {
  const forwarded = header(req, 'x-forwarded-for')?.split(',')[0]?.trim()
  return header(req, 'cf-connecting-ip') ?? header(req, 'x-real-ip') ?? header(req, 'x-vercel-forwarded-for') ?? forwarded ?? null
}

function requestGeo(req: ApiRequest): AnalyticsSession['network'] {
  return {
    ip: clientIp(req),
    country: header(req, 'x-vercel-ip-country') ?? header(req, 'cf-ipcountry') ?? null,
    region: header(req, 'x-vercel-ip-country-region') ?? header(req, 'x-vercel-ip-region') ?? null,
    city: decodeURIComponent(header(req, 'x-vercel-ip-city') ?? ''),
    latitude: header(req, 'x-vercel-ip-latitude') ?? null,
    longitude: header(req, 'x-vercel-ip-longitude') ?? null,
    timezone: header(req, 'x-vercel-ip-timezone') ?? null,
  }
}

function sanitizeClient(input: unknown): ClientInfo {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const screen = source.screen && typeof source.screen === 'object' ? source.screen as Record<string, unknown> : null
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport as Record<string, unknown> : null
  return {
    userAgent: cleanText(source.userAgent, 260),
    language: cleanText(source.language, 32),
    languages: Array.isArray(source.languages) ? source.languages.map((item) => cleanText(item, 32)).filter(Boolean).slice(0, 8) : [],
    timezone: cleanText(source.timezone, 80),
    platform: cleanText(source.platform, 80),
    screen: screen ? {
      width: Number(screen.width) || 0,
      height: Number(screen.height) || 0,
      dpr: Number(screen.dpr) || 1,
    } : undefined,
    viewport: viewport ? {
      width: Number(viewport.width) || 0,
      height: Number(viewport.height) || 0,
    } : undefined,
    connection: cleanText(source.connection, 40),
    memoryGb: Number(source.memoryGb) || undefined,
    cores: Number(source.cores) || undefined,
    touch: Boolean(source.touch),
    referrer: cleanText(source.referrer, 320),
  }
}

function sanitizeEvents(input: unknown): Array<AnalyticsEvent & { at: string }> {
  if (!Array.isArray(input)) return []
  return input.slice(0, 30).map((event) => {
    const source = event && typeof event === 'object' ? event as Record<string, unknown> : {}
    const at = cleanText(source.at, 40)
    return {
      id: cleanId(source.id, ''),
      name: cleanText(source.name, 80) || 'event',
      at: Number.isNaN(Date.parse(at)) ? new Date().toISOString() : at,
      path: cleanText(source.path, 180),
      surface: cleanText(source.surface, 80),
      payload: source.payload && typeof source.payload === 'object' ? source.payload as Record<string, unknown> : {},
    }
  })
}

function sanitizeStore(input: unknown): AnalyticsStore {
  if (!input || typeof input !== 'object') return emptyStore()
  const source = input as Partial<AnalyticsStore>
  return {
    updatedAt: cleanText(source.updatedAt, 40) || new Date(0).toISOString(),
    sessions: Array.isArray(source.sessions) ? source.sessions.filter((session): session is AnalyticsSession => {
      if (!session || typeof session !== 'object') return false
      const candidate = session as Partial<AnalyticsSession>
      return Boolean(candidate.sessionId && candidate.visitorId && candidate.profile && candidate.network && Array.isArray(candidate.lastActions))
    }) : [],
  }
}

async function readStore(): Promise<AnalyticsStore> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return memoryStore
  try {
    const result = await get(STORE_PATH, {
      access: BLOB_ACCESS,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: false,
    })
    if (!result || result.statusCode !== 200 || !result.stream) return emptyStore()
    const text = await new Response(result.stream).text()
    return text.trim() ? sanitizeStore(JSON.parse(text)) : emptyStore()
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('not found') || message.includes('no such') || message.includes('invalid json')) return emptyStore()
    throw error
  }
}

async function writeStore(store: AnalyticsStore) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    memoryStore.updatedAt = store.updatedAt
    memoryStore.sessions = store.sessions
    return
  }
  await put(STORE_PATH, JSON.stringify(store), {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
}

function isAdmin(req: ApiRequest, body: Record<string, unknown>) {
  const configured = process.env.ADMIN_ANALYTICS_TOKEN ?? process.env.ADMIN_TOKEN ?? ''
  if (!configured && process.env.NODE_ENV !== 'production') return true
  const auth = header(req, 'authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : String(body.adminToken ?? body.token ?? '')
  return Boolean(configured && token === configured)
}

function mergeSession(store: AnalyticsStore, body: Record<string, unknown>, req: ApiRequest) {
  const now = new Date().toISOString()
  const sessionId = cleanId(body.sessionId)
  const visitorId = cleanId(body.visitorId)
  const events = sanitizeEvents(body.events)
  const client = sanitizeClient(body.client)
  const profileInput = body.profile && typeof body.profile === 'object' ? body.profile as Record<string, unknown> : {}
  const pseudo = cleanText(profileInput.pseudo, 40) || null
  const emailHash = cleanText(profileInput.emailHash, 120) || null
  const hasAccount = Boolean(profileInput.hasAccount)
  const existing = store.sessions.find((session) => session.sessionId === sessionId)
  const firstSeenAt = existing?.firstSeenAt ?? events[0]?.at ?? now
  const lastSeenAt = events.at(-1)?.at ?? now
  const paths = new Set([...(existing?.paths ?? []), ...events.map((event) => event.path).filter(Boolean) as string[]])
  const surfaces = new Set([...(existing?.surfaces ?? []), ...events.map((event) => event.surface).filter(Boolean) as string[]])
  const network = existing?.network ?? requestGeo(req)

  const next: AnalyticsSession = {
    sessionId,
    visitorId,
    firstSeenAt,
    lastSeenAt,
    durationMs: Math.max(existing?.durationMs ?? 0, Date.parse(lastSeenAt) - Date.parse(firstSeenAt)),
    eventCount: (existing?.eventCount ?? 0) + events.length,
    paths: [...paths].slice(-20),
    surfaces: [...surfaces].slice(-12),
    client: { ...(existing?.client ?? {}), ...client },
    network,
    profile: {
      pseudo: pseudo ?? existing?.profile.pseudo ?? null,
      emailHash: emailHash ?? existing?.profile.emailHash ?? null,
      hasAccount: hasAccount || existing?.profile.hasAccount || false,
      becameAccountAt: existing?.profile.becameAccountAt ?? (hasAccount ? now : null),
    },
    lastActions: [...(existing?.lastActions ?? []), ...events].slice(-MAX_ACTIONS_PER_SESSION),
  }

  const others = store.sessions.filter((session) => session.sessionId !== sessionId)
  store.sessions = [next, ...others]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, MAX_SESSIONS)
  store.updatedAt = now
}

function summarize(store: AnalyticsStore) {
  const now = Date.now()
  const sessions = store.sessions
  const active = sessions.filter((session) => now - Date.parse(session.lastSeenAt) < 5 * 60 * 1000)
  const guests = sessions.filter((session) => !session.profile.hasAccount)
  const converted = sessions.filter((session) => session.profile.hasAccount && session.profile.becameAccountAt)
  const events = sessions.flatMap((session) => session.lastActions.map((event) => ({ ...event, sessionId: session.sessionId, visitorId: session.visitorId, pseudo: session.profile.pseudo })))
  const topPaths = [...sessions.reduce((map, session) => {
    for (const path of session.paths) map.set(path, (map.get(path) ?? 0) + 1)
    return map
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 12)

  return {
    updatedAt: store.updatedAt,
    totals: {
      sessions: sessions.length,
      active: active.length,
      guests: guests.length,
      accounts: sessions.length - guests.length,
      converted: converted.length,
      avgDurationMs: sessions.length ? Math.round(sessions.reduce((sum, session) => sum + session.durationMs, 0) / sessions.length) : 0,
      events: sessions.reduce((sum, session) => sum + session.eventCount, 0),
    },
    topPaths,
    recentEvents: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120),
    sessions: sessions.slice(0, 200),
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Methode non autorisee.' })
    return
  }

  try {
    const body = parseBody(req)
    const action = String(body.action ?? '')

    if (action === 'track') {
      try {
        const store = await readStore()
        mergeSession(store, body, req)
        await writeStore(store)
        res.status(200).json({ data: { ok: true } })
      } catch (trackError) {
        console.warn('[analytics] track ignored:', trackError instanceof Error ? trackError.message : trackError)
        res.status(200).json({ data: { ok: false } })
      }
      return
    }

    if (action === 'summary') {
      if (!isAdmin(req, body)) {
        res.status(401).json({ error: 'Acces admin refuse.' })
        return
      }
      res.status(200).json({ data: summarize(await readStore()) })
      return
    }

    res.status(400).json({ error: 'Action inconnue.' })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Analytics indisponible.' })
  }
}
