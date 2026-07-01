import { readChallengeProfile, subscribeChallengeProfile } from './challengeProfile'

type AnalyticsProfile = {
  pseudo?: string
  emailHash?: string
  hasAccount?: boolean
}

type AnalyticsEvent = {
  id: string
  name: string
  at: string
  path: string
  surface: string
  payload?: Record<string, unknown>
}

const VISITOR_KEY = 'brakup:analytics-visitor'
const SESSION_KEY = 'brakup:analytics-session'
const ENDPOINT = '/api/admin-analytics'
const FLUSH_INTERVAL_MS = 15000
const HEARTBEAT_INTERVAL_MS = 20000
const MAX_QUEUE = 60

let initialized = false
let queue: AnalyticsEvent[] = []
let currentSurface = 'app'
let flushTimer: number | null = null
let heartbeatTimer: number | null = null
let profile: AnalyticsProfile = {}
let unsubscribeProfile: (() => void) | null = null

function randomId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}:${crypto.randomUUID()}`
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}

function readOrCreateId(storage: Storage, key: string, prefix: string) {
  const existing = storage.getItem(key)
  if (existing) return existing
  const next = randomId(prefix)
  storage.setItem(key, next)
  return next
}

function visitorId() {
  try {
    return readOrCreateId(window.localStorage, VISITOR_KEY, 'visitor')
  } catch {
    return randomId('visitor')
  }
}

function sessionId() {
  try {
    return readOrCreateId(window.sessionStorage, SESSION_KEY, 'session')
  } catch {
    return randomId('session')
  }
}

function clientInfo() {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string }
    deviceMemory?: number
  }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages ? [...navigator.languages] : [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      dpr: window.devicePixelRatio || 1,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    connection: nav.connection?.effectiveType,
    memoryGb: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    touch: navigator.maxTouchPoints > 0,
    referrer: document.referrer,
  }
}

function currentProfile(): AnalyticsProfile {
  const stored = readChallengeProfile()
  const hasToken = Boolean(window.localStorage.getItem('brakup:token'))
  return {
    pseudo: profile.pseudo || stored.pseudo || undefined,
    emailHash: profile.emailHash,
    hasAccount: Boolean(profile.hasAccount || hasToken),
  }
}

function payload(events: AnalyticsEvent[]) {
  return {
    action: 'track',
    visitorId: visitorId(),
    sessionId: sessionId(),
    client: clientInfo(),
    profile: currentProfile(),
    events,
  }
}

function send(events: AnalyticsEvent[], useBeacon = false) {
  if (!events.length) return
  const body = JSON.stringify(payload(events))
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
    return
  }
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: useBeacon,
  }).catch(() => undefined)
}

export function flushAnalytics(useBeacon = false) {
  const events = queue
  queue = []
  send(events, useBeacon)
}

export function trackAnalytics(name: string, payload?: Record<string, unknown>, surface = currentSurface) {
  if (typeof window === 'undefined') return
  queue.push({
    id: randomId('event'),
    name,
    at: new Date().toISOString(),
    path: `${window.location.pathname}${window.location.search}`,
    surface,
    payload,
  })
  if (queue.length >= MAX_QUEUE) flushAnalytics()
}

export function identifyAnalyticsProfile(next: AnalyticsProfile) {
  profile = { ...profile, ...next }
  trackAnalytics('profile_identified', {
    pseudo: next.pseudo,
    hasAccount: Boolean(next.hasAccount),
  })
  flushAnalytics()
}

export function initAnalytics(surface: string) {
  if (typeof window === 'undefined') return
  currentSurface = surface
  if (initialized) {
    trackAnalytics('surface_view', { surface })
    return
  }
  initialized = true
  profile = currentProfile()

  trackAnalytics('page_view', {
    title: document.title,
    href: window.location.href,
  }, surface)

  flushTimer = window.setInterval(() => flushAnalytics(), FLUSH_INTERVAL_MS)
  heartbeatTimer = window.setInterval(() => {
    trackAnalytics('heartbeat', {
      visible: document.visibilityState === 'visible',
    })
  }, HEARTBEAT_INTERVAL_MS)

  document.addEventListener('visibilitychange', () => {
    trackAnalytics('visibility', { state: document.visibilityState })
    if (document.visibilityState === 'hidden') flushAnalytics(true)
  })
  window.addEventListener('pagehide', () => flushAnalytics(true))
  window.addEventListener('beforeunload', () => flushAnalytics(true))
  unsubscribeProfile = subscribeChallengeProfile((stored) => {
    identifyAnalyticsProfile({
      pseudo: stored.pseudo || undefined,
      hasAccount: Boolean(window.localStorage.getItem('brakup:token')),
    })
  })
}

export function stopAnalytics() {
  if (flushTimer) window.clearInterval(flushTimer)
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  unsubscribeProfile?.()
  flushTimer = null
  heartbeatTimer = null
  unsubscribeProfile = null
  initialized = false
  flushAnalytics(true)
}
