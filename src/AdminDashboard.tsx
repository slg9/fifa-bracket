import { useEffect, useMemo, useState } from 'react'

type AdminEvent = {
  id?: string
  name: string
  at: string
  path?: string
  surface?: string
  sessionId: string
  visitorId: string
  pseudo: string | null
  payload?: Record<string, unknown>
}

type AdminSession = {
  sessionId: string
  visitorId: string
  firstSeenAt: string
  lastSeenAt: string
  durationMs: number
  eventCount: number
  paths: string[]
  surfaces: string[]
  client: {
    userAgent?: string
    language?: string
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
  lastActions: Array<{ name: string; at: string; path?: string; surface?: string; payload?: Record<string, unknown> }>
}

type AdminSummary = {
  updatedAt: string
  totals: {
    sessions: number
    active: number
    guests: number
    accounts: number
    converted: number
    avgDurationMs: number
    events: number
  }
  topPaths: Array<[string, number]>
  recentEvents: AdminEvent[]
  sessions: AdminSession[]
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function payloadPreview(payload: Record<string, unknown> | undefined) {
  if (!payload || Object.keys(payload).length === 0) return ''
  return JSON.stringify(payload).slice(0, 140)
}

export function AdminDashboard() {
  const [token, setToken] = useState(() => window.localStorage.getItem('brakup:admin-token') ?? '')
  const [draftToken, setDraftToken] = useState(token)
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const selectedSession = useMemo(
    () => summary?.sessions.find((session) => session.sessionId === selectedSessionId) ?? summary?.sessions[0] ?? null,
    [selectedSessionId, summary],
  )

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin-analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: 'summary' }),
      })
      const payload = await response.json() as { data?: AdminSummary; error?: string }
      if (!response.ok || !payload.data) throw new Error(payload.error ?? 'Dashboard indisponible.')
      setSummary(payload.data)
      setSelectedSessionId((current) => current ?? payload.data?.sessions[0]?.sessionId ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dashboard indisponible.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(interval)
  }, [token])

  function saveToken() {
    window.localStorage.setItem('brakup:admin-token', draftToken)
    setToken(draftToken)
  }

  return (
    <main className="admin-dash">
      <header className="admin-dash__header">
        <div>
          <span>Brakup Admin</span>
          <h1>Dashboard analytics</h1>
          <p>Sessions, invités, profils créés, actions de jeu et infos navigateur.</p>
        </div>
        <div className="admin-dash__auth">
          <input
            type="password"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            placeholder="Token admin"
            aria-label="Token admin"
          />
          <button type="button" onClick={saveToken}>Connecter</button>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
        </div>
      </header>

      {error ? <div className="admin-dash__error">{error}</div> : null}

      <section className="admin-kpis">
        <article><span>Sessions</span><strong>{summary?.totals.sessions ?? '-'}</strong></article>
        <article><span>Actifs 5 min</span><strong>{summary?.totals.active ?? '-'}</strong></article>
        <article><span>Invités</span><strong>{summary?.totals.guests ?? '-'}</strong></article>
        <article><span>Comptes</span><strong>{summary?.totals.accounts ?? '-'}</strong></article>
        <article><span>Conversions</span><strong>{summary?.totals.converted ?? '-'}</strong></article>
        <article><span>Temps moyen</span><strong>{summary ? formatDuration(summary.totals.avgDurationMs) : '-'}</strong></article>
      </section>

      <section className="admin-grid">
        <div className="admin-panel">
          <h2>Sessions récentes</h2>
          <div className="admin-session-list">
            {(summary?.sessions ?? []).map((session) => (
              <button
                key={session.sessionId}
                type="button"
                className={selectedSession?.sessionId === session.sessionId ? 'is-active' : ''}
                onClick={() => setSelectedSessionId(session.sessionId)}
              >
                <strong>{session.profile.pseudo || 'Invité'}</strong>
                <span>{formatDuration(session.durationMs)} · {session.eventCount} events</span>
                <small>{session.network.city || session.network.country || 'Localisation inconnue'} · {formatDate(session.lastSeenAt)}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-panel">
          <h2>Détail session</h2>
          {selectedSession ? (
            <div className="admin-session-detail">
              <div><span>Visitor</span><strong>{selectedSession.visitorId}</strong></div>
              <div><span>Pseudo</span><strong>{selectedSession.profile.pseudo || 'Invité'}</strong></div>
              <div><span>Compte</span><strong>{selectedSession.profile.hasAccount ? 'Oui' : 'Non'}</strong></div>
              <div><span>IP</span><strong>{selectedSession.network.ip || '-'}</strong></div>
              <div><span>Lieu</span><strong>{[selectedSession.network.city, selectedSession.network.region, selectedSession.network.country].filter(Boolean).join(', ') || '-'}</strong></div>
              <div><span>Fuseau</span><strong>{selectedSession.client.timezone || selectedSession.network.timezone || '-'}</strong></div>
              <div><span>Langue</span><strong>{selectedSession.client.language || '-'}</strong></div>
              <div><span>Device</span><strong>{selectedSession.client.platform || '-'}</strong></div>
              <div><span>Écran</span><strong>{selectedSession.client.screen ? `${selectedSession.client.screen.width}x${selectedSession.client.screen.height} @${selectedSession.client.screen.dpr}` : '-'}</strong></div>
              <div><span>Viewport</span><strong>{selectedSession.client.viewport ? `${selectedSession.client.viewport.width}x${selectedSession.client.viewport.height}` : '-'}</strong></div>
              <div><span>Connexion</span><strong>{selectedSession.client.connection || '-'}</strong></div>
              <div><span>CPU/RAM</span><strong>{selectedSession.client.cores ?? '-'} cores · {selectedSession.client.memoryGb ?? '-'} GB</strong></div>
              <div className="admin-session-detail__wide"><span>User agent</span><strong>{selectedSession.client.userAgent || '-'}</strong></div>
            </div>
          ) : <p>Aucune session.</p>}
        </div>

        <div className="admin-panel">
          <h2>Top pages</h2>
          <div className="admin-paths">
            {(summary?.topPaths ?? []).map(([path, count]) => (
              <div key={path}>
                <span>{path}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-panel">
          <h2>Actions récentes</h2>
          <div className="admin-events">
            {(summary?.recentEvents ?? []).map((event) => (
              <div key={`${event.sessionId}-${event.id}-${event.at}`}>
                <time>{formatDate(event.at)}</time>
                <strong>{event.name}</strong>
                <span>{event.pseudo || 'Invité'} · {event.path}</span>
                {payloadPreview(event.payload) ? <small>{payloadPreview(event.payload)}</small> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

export default AdminDashboard
