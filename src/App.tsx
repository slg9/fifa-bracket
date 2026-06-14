import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { loadLiveSnapshot, loadSeed, syncLiveSnapshot as requestLiveSync } from './lib/data'
import { computePlayerStats } from './lib/players'
import {
  buildGroupOrderOverrides,
  buildKnockoutBracket,
  computeStandings,
  getBestThirdPlacedTeams,
  knockoutTemplates,
  mergeScores,
} from './lib/tournament'
import type {
  GroupMatch,
  LiveSnapshot,
  KnockoutEntrant,
  MatchOverride,
  MatchPrediction,
  Mode,
  RankedStandingRow,
  Team,
  TournamentSeed,
} from './types'

type View = 'groups' | 'bracket'

type LiveState = {
  syncedAt: string | null
  source: string
  warnings: string[]
  matches: Array<{ id: string; homeScore: number | null; awayScore: number | null; status: GroupMatch['status']; kickoffTime?: string | null; kickoffIso?: string | null; liveMinute?: string | null }>
  standings: RankedStandingRow[]
  predictions: MatchPrediction[]
}

function mergeLiveSnapshot(current: LiveState, snapshot: LiveSnapshot): LiveState {
  const hasMatches = snapshot.matches.length > 0
  const hasStandings = snapshot.standings.length > 0
  const extractionFailed = !hasMatches && !hasStandings

  return {
    syncedAt: extractionFailed ? current.syncedAt : snapshot.syncedAt,
    source: extractionFailed ? current.source : snapshot.source,
    warnings: extractionFailed ? [] : snapshot.warnings,
    matches: hasMatches ? snapshot.matches : current.matches,
    standings: hasStandings ? snapshot.standings : current.standings,
    predictions: snapshot.predictions?.length ? snapshot.predictions : current.predictions,
  }
}

type DisplayMatch = {
  id: string
  stage: string
  label: string
  dateLabel: string
  home: KnockoutEntrant
  away: KnockoutEntrant
  winnerId: string | null
  played: boolean
}

type DragState = {
  groupId: string
  teamId: string
  overTeamId: string | null
}

const simulationStorageKey = 'fifabracket:simulation'

// Free-to-air broadcaster per match (France). Matches not listed = beIN Sports only.
// Source: M6/W9 rights + beIN Sports 2026 World Cup schedule.
const broadcasterFR: Record<string, 'M6' | 'W9'> = {
  A1: 'M6',                               // MEX vs RSA
  B1: 'M6', B2: 'W9', B5: 'M6',          // CAN-BIH, QAT-SUI, SUI-CAN
  C2: 'M6', C4: 'M6',                     // BRA-MAR, SCO-MAR
  D4: 'M6',                               // USA-AUS
  E2: 'W9', E3: 'W9', E6: 'W9',          // GER-CUW, GER-CIV, ECU-GER
  F1: 'W9', F6: 'M6',                     // NED-JPN, TUN-NED
  G2: 'M6', G3: 'M6',                     // BEL-EGY, BEL-IRN
  H1: 'M6', H2: 'W9', H4: 'W9', H6: 'M6', // KSA-URU, ESP-CPV, ESP-KSA, URU-ESP
  I1: 'M6', I4: 'M6', I5: 'M6',          // FRA-SEN, FRA-IRQ, NOR-FRA
  J3: 'M6', J5: 'M6',                     // ARG-AUT, ALG-AUT
  K3: 'W9', K5: 'M6',                     // POR-UZB, COL-POR
  L2: 'W9', L3: 'W9', L5: 'M6',          // ENG-CRO, ENG-GHA, PAN-ENG
}

function BroadcasterBadge({ matchId }: { matchId: string }) {
  const ch = broadcasterFR[matchId]
  if (ch === 'M6') return <span className="bcbadge bcbadge--m6">M6</span>
  if (ch === 'W9') return <span className="bcbadge bcbadge--w9">W9</span>
  return <span className="bcbadge bcbadge--bein">beIN</span>
}

type WatchOption = {
  label: string
  href: string
}

type StoredSimulation = {
  overrides: Record<string, MatchOverride>
  knockoutPicks: Record<string, string>
}

const roundColumns: Array<{ key: string; stage: string; side: 'left' | 'center' | 'right'; ids: string[] }> = [
  { key: 'R32L', stage: 'Round of 32', side: 'left', ids: ['M73', 'M74', 'M75', 'M76', 'M77', 'M78', 'M79', 'M80'] },
  { key: 'R16L', stage: 'Round of 16', side: 'left', ids: ['M89', 'M90', 'M91', 'M92'] },
  { key: 'QFL', stage: 'Quarter-final', side: 'left', ids: ['M97', 'M99'] },
  { key: 'SFL', stage: 'Semi-final', side: 'left', ids: ['M101'] },
  { key: 'F', stage: 'Finale', side: 'center', ids: ['M103'] },
  { key: 'SFR', stage: 'Semi-final', side: 'right', ids: ['M102'] },
  { key: 'QFR', stage: 'Quarter-final', side: 'right', ids: ['M98', 'M100'] },
  { key: 'R16R', stage: 'Round of 16', side: 'right', ids: ['M93', 'M94', 'M95', 'M96'] },
  { key: 'R32R', stage: 'Round of 32', side: 'right', ids: ['M81', 'M82', 'M83', 'M84', 'M85', 'M86', 'M87', 'M88'] },
]

const watchOptionsByCountry: Record<string, WatchOption[]> = {
  FR: [
    { label: 'beIN Sports', href: 'https://www.beinsports.com/france/' },
    { label: 'M6 Direct', href: 'https://www.m6.fr/m6/direct' },
  ],
  US: [
    { label: 'FOX Sports', href: 'https://www.foxsports.com/soccer/fifa-world-cup-men' },
    { label: 'Telemundo', href: 'https://www.telemundo.com/deportes/fifa-world-cup' },
  ],
}


function getCountryCodeFromFixturesUrl(url: string): string {
  const match = url.match(/[?&]country=([A-Z]{2})/i)
  return match?.[1]?.toUpperCase() ?? 'FR'
}

// Format live minute for display.
// rawToken = scraper value like "MT", "45'", "90'+2'", "45", "90+2"
// syncedAt = ISO string of when that token was scraped
function formatLiveMinute(rawToken: string | null | undefined, syncedAt: string | null): string {
  if (!rawToken) return 'En direct'
  const upper = rawToken.toUpperCase().replace(/['\u2019\u02b9\u2032]/g, '')
  if (upper === 'MT' || upper === 'MI' || upper === 'HT') return 'Mi-temps'

  // Parse numeric minute (e.g. "90+2" → base 90, extra 2)
  const m = upper.match(/^(\d+)(?:\+(\d+))?$/)
  if (!m) return rawToken // unknown token, show as-is

  let base = Number(m[1])
  const extra = m[2] ? Number(m[2]) : 0
  const scraped = base + extra

  // Add elapsed seconds since sync (capped at period max: 45 or 90)
  if (syncedAt) {
    const elapsedMin = Math.floor((Date.now() - new Date(syncedAt).getTime()) / 60_000)
    const raw = scraped + elapsedMin
    const max = scraped <= 45 ? 45 : 90
    base = Math.min(raw, max)
  } else {
    base = scraped
  }

  return `${base}'`
}

function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isMatchToday(match: Pick<GroupMatch, 'kickoffDate' | 'kickoffIso'>): boolean {
  if (!match.kickoffIso) {
    return match.kickoffDate === localDateStr()
  }

  return localDateStr(new Date(match.kickoffIso)) === localDateStr()
}

function matchLocalDateKey(match: Pick<GroupMatch, 'kickoffDate' | 'kickoffIso'>): string {
  return match.kickoffIso ? localDateStr(new Date(match.kickoffIso)) : match.kickoffDate
}

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function isLiveNow(kickoffIso: string | null | undefined): boolean {
  if (!kickoffIso) return false
  const elapsed = Date.now() - new Date(kickoffIso).getTime()
  return elapsed >= 0 && elapsed < 130 * 60 * 1000
}

// If the scraper still marks a match as 'scheduled' but kickoff time has passed,
// infer the actual status from wall-clock time (no API needed).
function inferStatus(match: GroupMatch): GroupMatch['status'] {
  if (match.status !== 'scheduled' || !match.kickoffIso) return match.status
  const elapsed = Date.now() - new Date(match.kickoffIso).getTime()
  if (elapsed < 0) return 'scheduled'
  if (elapsed < 130 * 60 * 1000) return 'live'  // within 130 min → probably live
  return 'finished'
}

function formatKickoffTime(match: GroupMatch): string | null {
  if (!match.kickoffIso) return null

  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(match.kickoffIso))
}

function formatSyncTime(isoDate: string | null): string {
  if (!isoDate) {
    return 'Jamais'
  }

  return new Date(isoDate).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readStoredSimulation(): StoredSimulation | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(simulationStorageKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSimulation>
    return {
      overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
      knockoutPicks:
        parsed.knockoutPicks && typeof parsed.knockoutPicks === 'object' ? parsed.knockoutPicks : {},
    }
  } catch {
    return null
  }
}

function writeStoredSimulation(simulation: StoredSimulation) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(simulationStorageKey, JSON.stringify(simulation))
}

function clearStoredSimulation() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(simulationStorageKey)
}

function flagUrl(team: Team): string {
  if (team.iso2.includes('-')) {
    return ''
  }

  return `https://flagcdn.com/w80/${team.iso2}.png`
}

function KnockoutTeamBadge({
  entrant,
  teamsById,
  isWinner,
  isLoser,
  isFocus,
  side,
  isInteractive,
  onPick,
}: {
  entrant: KnockoutEntrant
  teamsById: Map<string, Team>
  isWinner: boolean
  isLoser: boolean
  isFocus: boolean
  side: 'left' | 'center' | 'right'
  isInteractive: boolean
  onPick?: (teamId: string) => void
}) {
  if (entrant.kind === 'placeholder') {
    return (
      <div className="bm__team bm__team--placeholder">
        <span className="bm__name">{entrant.label}</span>
      </div>
    )
  }

  const team = teamsById.get(entrant.teamId)

  if (!team) {
    return (
      <div className="bm__team bm__team--placeholder">
        <span className="bm__name">Équipe inconnue</span>
      </div>
    )
  }

  const src = flagUrl(team)

  return (
    <button
      type="button"
      className={[
        'bm__team',
        isInteractive ? 'is-interactive' : '',
        isWinner ? 'is-win' : '',
        isLoser ? 'is-lose' : '',
        isFocus ? 'is-focus' : '',
      ].filter(Boolean).join(' ')}
      disabled={!isInteractive}
      onClick={() => onPick?.(team.id)}
    >
      {side === 'right' ? (
        <>
          <span className="bm__name">{team.name}</span>
          {src ? <img src={src} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
        </>
      ) : (
        <>
          {src ? <img src={src} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
          <span className="bm__name">{team.name}</span>
        </>
      )}
    </button>
  )
}

function resolveDisplayBracket(
  groupBracket: ReturnType<typeof buildKnockoutBracket>,
  picks: Record<string, string>,
): DisplayMatch[] {
  const byId = new Map(groupBracket.map((match) => [match.id, match]))
  const display = new Map<string, DisplayMatch>()

  for (const template of knockoutTemplates) {
    const source = byId.get(template.id)

    if (!source) {
      continue
    }

    const resolvedHome =
      template.home.type === 'winnerOf'
        ? (() => {
            const prev = display.get(template.home.matchId)
            return prev?.winnerId
              ? ({ kind: 'team', teamId: prev.winnerId } satisfies KnockoutEntrant)
              : ({ kind: 'placeholder', label: `Vainqueur ${template.home.matchId}` } satisfies KnockoutEntrant)
          })()
        : source.home

    const resolvedAway =
      template.away.type === 'winnerOf'
        ? (() => {
            const prev = display.get(template.away.matchId)
            return prev?.winnerId
              ? ({ kind: 'team', teamId: prev.winnerId } satisfies KnockoutEntrant)
              : ({ kind: 'placeholder', label: `Vainqueur ${template.away.matchId}` } satisfies KnockoutEntrant)
          })()
        : source.away

    const pickedWinnerId = picks[source.id]
    const validPick =
      pickedWinnerId &&
      [resolvedHome, resolvedAway].some(
        (entrant) => entrant.kind === 'team' && entrant.teamId === pickedWinnerId,
      )
        ? pickedWinnerId
        : null

    display.set(source.id, {
      ...source,
      home: resolvedHome,
      away: resolvedAway,
      winnerId: validPick,
      played: Boolean(validPick),
    })
  }

  return knockoutTemplates
    .map((template) => display.get(template.id))
    .filter((match): match is DisplayMatch => Boolean(match))
}

function BracketBoard({
  matches,
  teamsById,
  focusId,
  picks,
  simulationEnabled,
  onPick,
  onClear,
}: {
  matches: DisplayMatch[]
  teamsById: Map<string, Team>
  focusId: string | null
  picks: Record<string, string>
  simulationEnabled: boolean
  onPick: (matchId: string, teamId: string) => void
  onClear: (matchId: string) => void
}) {
  const fitRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const fullscreenRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [lines, setLines] = useState<Array<{ id: string; d: string; active: boolean }>>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLandscape, setIsLandscape] = useState(() => window.innerWidth >= window.innerHeight)

  const matchMap = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches])

  useEffect(() => {
    const fit = () => {
      if (!fitRef.current || !wrapRef.current) {
        return
      }

      const naturalWidth = wrapRef.current.scrollWidth
      const naturalHeight = wrapRef.current.scrollHeight
      const availableWidth = fitRef.current.clientWidth
      const availableHeight = isFullscreen ? Math.max(fullscreenRef.current?.clientHeight ?? 0, fitRef.current.clientHeight) : 0
      const widthScale = naturalWidth > 0 ? availableWidth / naturalWidth : 1
      const heightScale = naturalHeight > 0 && availableHeight > 0 ? availableHeight / naturalHeight : 1
      const nextScale = Math.min(1, widthScale, heightScale)

      setScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale))
      setBox({ width: naturalWidth, height: naturalHeight })
    }

    fit()

    const resizeObserver = new ResizeObserver(fit)
    if (fitRef.current) {
      resizeObserver.observe(fitRef.current)
    }

    window.addEventListener('resize', fit)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [isFullscreen, isLandscape, matches, picks])

  useEffect(() => {
    const syncViewportState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement === fullscreenRef.current))
      setIsLandscape(window.innerWidth >= window.innerHeight)
    }

    syncViewportState()
    document.addEventListener('fullscreenchange', syncViewportState)
    window.addEventListener('resize', syncViewportState)
    window.addEventListener('orientationchange', syncViewportState)

    return () => {
      document.removeEventListener('fullscreenchange', syncViewportState)
      window.removeEventListener('resize', syncViewportState)
      window.removeEventListener('orientationchange', syncViewportState)
    }
  }, [])

  async function toggleFullscreen() {
    const node = fullscreenRef.current
    if (!node) {
      return
    }

    if (document.fullscreenElement === node) {
      await document.exitFullscreen()
      return
    }

    await node.requestFullscreen()

    const orientation = screen.orientation as (ScreenOrientation & { lock?: (orientation: OrientationLockType) => Promise<void> }) | undefined
    if (orientation?.lock) {
      try {
        await orientation.lock('landscape')
      } catch {
        // iOS Safari and some Android browsers ignore or block orientation lock.
      }
    }
  }

  useEffect(() => {
    const parentLookup = new Map<string, string>()
    for (const template of knockoutTemplates) {
      if (template.home.type === 'winnerOf') {
        parentLookup.set(template.home.matchId, template.id)
      }
      if (template.away.type === 'winnerOf') {
        parentLookup.set(template.away.matchId, template.id)
      }
    }

    const computeLines = () => {
      if (!wrapRef.current) {
        return
      }

      const boardRect = wrapRef.current.getBoundingClientRect()
      const nextLines: Array<{ id: string; d: string; active: boolean }> = []

      for (const match of matches) {
        const parentId = parentLookup.get(match.id)
        const node = refs.current[match.id]
        const parentNode = parentId ? refs.current[parentId] : null

        if (!node || !parentNode) {
          continue
        }

        const matchRect = node.getBoundingClientRect()
        const parentRect = parentNode.getBoundingClientRect()
        const matchColumn = roundColumns.find((column) => column.ids.includes(match.id))
        const side = matchColumn?.side ?? 'left'
        const x1 =
          side === 'right'
            ? (matchRect.left - boardRect.left) / scale
            : (matchRect.right - boardRect.left) / scale
        const x2 =
          side === 'right'
            ? (parentRect.right - boardRect.left) / scale
            : (parentRect.left - boardRect.left) / scale
        const y1 = (matchRect.top + matchRect.height / 2 - boardRect.top) / scale
        const y2 = (parentRect.top + parentRect.height / 2 - boardRect.top) / scale
        const midX = (x1 + x2) / 2
        const active = Boolean(
          focusId &&
            match.winnerId === focusId &&
            [match.home, match.away].some(
              (entrant) => entrant.kind === 'team' && entrant.teamId === focusId,
            ),
        )

        nextLines.push({
          id: match.id,
          d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
          active,
        })
      }

      setLines(nextLines)
    }

    const frame = requestAnimationFrame(computeLines)
    const timeout = setTimeout(computeLines, 120)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
    }
  }, [matches, focusId, scale])

  const champion = matches.find((match) => match.id === 'M103')?.winnerId
  const championTeam = champion ? teamsById.get(champion) : null

  return (
    <div className={`bracket-shell${isFullscreen ? ' is-fullscreen' : ''}`} ref={fullscreenRef}>
      <div className="bracket-shell__toolbar">
        <div className="bracket-shell__hint">
          {isFullscreen && !isLandscape ? 'Tourne sur le cote pour profiter du bracket en paysage.' : 'Le tableau s ajuste a la largeur de ton ecran.'}
        </div>
        <button type="button" className="chip-btn bracket-shell__fullscreen" onClick={() => void toggleFullscreen()}>
          {isFullscreen ? 'Quitter plein ecran' : 'Plein ecran'}
        </button>
      </div>

      {isFullscreen && !isLandscape ? (
        <div className="bracket-rotate">
          <div className="bracket-rotate__icon" aria-hidden="true">
            ↺
          </div>
          <div className="bracket-rotate__title">Tourne sur le cote</div>
          <p>Le plein ecran est lance. Passe le telephone en paysage pour voir tout le tableau comme une video.</p>
        </div>
      ) : null}

      <div className="bracket-fit" ref={fitRef} style={{ height: box.height ? Math.ceil(box.height * scale) : undefined }}>
        <div
          className="bracket"
          ref={wrapRef}
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
        <svg className="bracket__links" width={box.width} height={box.height} aria-hidden="true">
          {lines.map((line) => (
            <path key={line.id} d={line.d} className={line.active ? 'link link--lit' : 'link'} />
          ))}
        </svg>

        {roundColumns.map((column) => (
          <div key={column.key} className={`bcol bcol--${column.side}`}>
            <div className="bcol__label">{column.stage}</div>
            <div className="bcol__matches">
              {column.side === 'center' ? (
                <div className="finalwrap">
                  {column.ids.map((id) => {
                    const match = matchMap.get(id)
                    if (!match) return null

                    return (
                      <div
                        key={match.id}
                        className={`bm${focusId && [match.home, match.away].some((entrant) => entrant.kind === 'team' && entrant.teamId === focusId) ? ' is-onpath' : ''}`}
                        ref={(node) => {
                          refs.current[match.id] = node
                        }}
                      >
                        <KnockoutTeamBadge
                          entrant={match.home}
                          teamsById={teamsById}
                          isWinner={match.winnerId === (match.home.kind === 'team' ? match.home.teamId : '')}
                          isLoser={match.played && match.winnerId !== (match.home.kind === 'team' ? match.home.teamId : '')}
                          isFocus={focusId === (match.home.kind === 'team' ? match.home.teamId : '')}
                          side="center"
                          isInteractive={simulationEnabled}
                          onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
                        />
                        <div className="bm__meta">
                          <span>{match.label}</span>
                          <span>{match.dateLabel}</span>
                        </div>
                        <KnockoutTeamBadge
                          entrant={match.away}
                          teamsById={teamsById}
                          isWinner={match.winnerId === (match.away.kind === 'team' ? match.away.teamId : '')}
                          isLoser={match.played && match.winnerId !== (match.away.kind === 'team' ? match.away.teamId : '')}
                          isFocus={focusId === (match.away.kind === 'team' ? match.away.teamId : '')}
                          side="center"
                          isInteractive={simulationEnabled}
                          onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
                        />
                        {simulationEnabled && match.played ? (
                          <button type="button" className="bm__clear" onClick={() => onClear(match.id)}>
                            ×
                          </button>
                        ) : null}
                      </div>
                    )
                  })}

                  <div className={`champ${championTeam ? ' is-set' : ''}`}>
                    <div className="champ__trophy">🏆</div>
                    {championTeam ? (
                      <>
                        {flagUrl(championTeam) ? (
                          <img src={flagUrl(championTeam)} alt="" className="champ__flag-image" />
                        ) : (
                          <div className="champ__flag">{championTeam.flagEmoji}</div>
                        )}
                        <div className="champ__name">{championTeam.name}</div>
                        <div className="champ__cap">Champion provisoire</div>
                      </>
                    ) : (
                      <div className="champ__cap champ__cap--tbd">Le champion s'affiche ici</div>
                    )}
                  </div>
                </div>
              ) : (
                column.ids.map((id) => {
                  const match = matchMap.get(id)
                  if (!match) return null
                  const isOnPath = Boolean(
                    focusId &&
                      [match.home, match.away].some(
                        (entrant) => entrant.kind === 'team' && entrant.teamId === focusId,
                      ),
                  )

                  return (
                    <div
                      key={match.id}
                      className={`bm${isOnPath ? ' is-onpath' : ''}`}
                      ref={(node) => {
                        refs.current[match.id] = node
                      }}
                    >
                      <KnockoutTeamBadge
                        entrant={match.home}
                        teamsById={teamsById}
                        isWinner={match.winnerId === (match.home.kind === 'team' ? match.home.teamId : '')}
                        isLoser={match.played && match.winnerId !== (match.home.kind === 'team' ? match.home.teamId : '')}
                        isFocus={focusId === (match.home.kind === 'team' ? match.home.teamId : '')}
                        side={column.side}
                        isInteractive={simulationEnabled}
                        onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
                      />
                      <div className="bm__meta">
                        <span>{match.label}</span>
                        <span>{match.dateLabel}</span>
                      </div>
                      <KnockoutTeamBadge
                        entrant={match.away}
                        teamsById={teamsById}
                        isWinner={match.winnerId === (match.away.kind === 'team' ? match.away.teamId : '')}
                        isLoser={match.played && match.winnerId !== (match.away.kind === 'team' ? match.away.teamId : '')}
                        isFocus={focusId === (match.away.kind === 'team' ? match.away.teamId : '')}
                        side={column.side}
                        isInteractive={simulationEnabled}
                        onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
                      />
                      {simulationEnabled && match.played ? (
                        <button type="button" className="bm__clear" onClick={() => onClear(match.id)}>
                          ×
                        </button>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  )
}

function FormDots({ form, align = 'left' }: { form: string; align?: 'left' | 'right' }) {
  const chars = form.toUpperCase().split('').filter((c) => 'WDL'.includes(c)).slice(-5)
  return (
    <div className={`formdots formdots--${align}`}>
      {chars.map((c, i) => (
        <span key={i} className={`formdot formdot--${c === 'W' ? 'win' : c === 'D' ? 'draw' : 'loss'}`} title={c === 'W' ? 'Victoire' : c === 'D' ? 'Nul' : 'Défaite'} />
      ))}
    </div>
  )
}

function App() {
  const [seed, setSeed] = useState<TournamentSeed | null>(null)
  const [liveSource, setLiveSource] = useState<LiveState>({
    syncedAt: null,
    source: 'seed',
    warnings: [],
    matches: [],
    standings: [],
    predictions: [],
  })
  const [mode, setMode] = useState<Mode>('real')
  const [view, setView] = useState<View>('groups')
  const [overrides, setOverrides] = useState<Record<string, MatchOverride>>({})
  const [knockoutPicks, setKnockoutPicks] = useState<Record<string, string>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [, setTick] = useState(0)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [isCompactGroups, setIsCompactGroups] = useState(() => window.innerWidth <= 680)
  const [selectedGroupId, setSelectedGroupId] = useState('A')
  const [showDayModal, setShowDayModal] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState(() => localDateStr())
  const [menuOpen, setMenuOpen] = useState(false)
  const [matchModalGroupId, setMatchModalGroupId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        // Load seed + static snapshot in parallel — show UI immediately
        const [seedData, staticSnapshot] = await Promise.all([
          loadSeed(),
          loadLiveSnapshot(),
        ])

        if (!active) return

        setSeed(seedData)
        const storedSimulation = readStoredSimulation()
        if (storedSimulation) {
          setOverrides(storedSimulation.overrides)
          setKnockoutPicks(storedSimulation.knockoutPicks)
          if (
            Object.keys(storedSimulation.overrides).length > 0 ||
            Object.keys(storedSimulation.knockoutPicks).length > 0
          ) {
            setMode('simulation')
          }
        }

        // Show static data right away — UI is usable instantly
        if (staticSnapshot) {
          setLiveSource({
            syncedAt: staticSnapshot.syncedAt,
            source: staticSnapshot.source,
            warnings: staticSnapshot.warnings,
            matches: staticSnapshot.matches,
            standings: staticSnapshot.standings,
            predictions: staticSnapshot.predictions ?? [],
          })
        }
        setLoading(false)

        // Then fetch fresh scores from FIFA.com in background
        requestLiveSync().then((liveSnapshot) => {
          if (!active) return
          setLiveSource((current) => mergeLiveSnapshot(current, liveSnapshot))
        }).catch(() => {
          // Sync failed — static data already shown, nothing to do
        })
      } catch (caughtError) {
        if (!active) return
        setError(caughtError instanceof Error ? caughtError.message : 'Chargement impossible.')
        setLoading(false)
      }
    }

    bootstrap()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (Object.keys(overrides).length === 0 && Object.keys(knockoutPicks).length === 0) {
      clearStoredSimulation()
      return
    }

    writeStoredSimulation({
      overrides,
      knockoutPicks,
    })
  }, [overrides, knockoutPicks])

  useEffect(() => {
    const syncViewport = () => {
      setIsCompactGroups(window.innerWidth <= 680)
    }

    syncViewport()
    window.addEventListener('resize', syncViewport)
    return () => window.removeEventListener('resize', syncViewport)
  }, [])

  useEffect(() => {
    if (!showDayModal && !matchModalGroupId) return

    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [showDayModal, matchModalGroupId])

  useEffect(() => {
    if (!seed) {
      return
    }

    const hasTodayMatches = liveSource.matches.some((match) => {
      const seedMatch = seed.matches.find((candidate) => candidate.id === match.id)
      return seedMatch ? isMatchToday({ ...seedMatch, kickoffIso: match.kickoffIso }) : false
    })
    const hasLiveMatch = liveSource.matches.some((m) => m.status === 'live' || isLiveNow(m.kickoffIso))
    if (!hasTodayMatches && !hasLiveMatch) {
      return
    }

    setShowDayModal(true)
  }, [liveSource.matches, seed])

  async function handleSyncLiveSnapshot() {
    setSyncing(true)
    try {
      const snapshot = await requestLiveSync()
      setLiveSource((current) => mergeLiveSnapshot(current, snapshot))
    } catch (caughtError) {
      setLiveSource((current) => ({
        ...current,
        warnings: [caughtError instanceof Error ? caughtError.message : 'Synchronisation live indisponible.'],
      }))
    } finally {
      setSyncing(false)
    }
  }

  // Silent background sync — no spinner, no error banner
  const silentSyncRef = useRef<() => void>(() => {})
  useEffect(() => {
    silentSyncRef.current = async () => {
      try {
        const snapshot = await requestLiveSync()
        setLiveSource((current) => mergeLiveSnapshot(current, snapshot))
      } catch {
        // network hiccup — keep current data
      }
    }
  })

  // Compute how often to poll based on match schedule
  const pollingInterval = useMemo(() => {
    if (!seed) return null
    const now = Date.now()

    // Any live match → poll every 20s (Jina latency ~2-3s, avoid overlap)
    if (liveSource.matches.some((m) => m.status === 'live' || isLiveNow(m.kickoffIso))) return 20_000

    // Find closest upcoming kickoff (from live snapshot which has kickoffIso)
    const msToNext = liveSource.matches
      .filter((m) => m.kickoffIso && m.status === 'scheduled')
      .map((m) => new Date(m.kickoffIso!).getTime() - now)
      .filter((d) => d > 0)
      .sort((a, b) => a - b)[0]

    if (msToNext !== undefined) {
      if (msToNext < 15 * 60_000)  return 60_000        // < 15 min → 1 min
      if (msToNext < 2 * 3600_000) return 2 * 60_000    // < 2h    → 2 min
    }

    // Match day but nothing imminent → 5 min
    if (liveSource.matches.some((match) => {
      const seedMatch = seed.matches.find((candidate) => candidate.id === match.id)
      return seedMatch ? isMatchToday({ ...seedMatch, kickoffIso: match.kickoffIso }) : false
    })) return 5 * 60_000

    return null // no relevant match → no polling
  }, [seed, liveSource.matches])

  // Start / restart polling whenever the interval changes
  useEffect(() => {
    if (!pollingInterval) return
    const id = setInterval(() => silentSyncRef.current(), pollingInterval)
    return () => clearInterval(id)
  }, [pollingInterval])

  // Tick every 30s to keep live-minute display fresh between polls
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <main className="app-shell loading">
        <div className="boot-loader">
          <svg className="boot-loader__mark" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle className="boot-loader__orbit boot-loader__orbit--outer" cx="60" cy="60" r="50" />
            <circle className="boot-loader__orbit boot-loader__orbit--inner" cx="60" cy="60" r="39" />
            <g className="boot-loader__ball">
              <circle cx="60" cy="60" r="24" fill="#eef3ff" />
              <polygon points="60,45 71,53 67,67 53,67 49,53" fill="#0a1020" />
              <path d="M60 45 60 36M71 53 80 49M67 67 73 76M53 67 47 76M49 53 40 49" stroke="#0a1020" strokeWidth="3" strokeLinecap="round" />
              <path d="M60 36A24 24 0 0 1 80 49M73 76A24 24 0 0 1 47 76M40 49A24 24 0 0 1 60 36" stroke="#0a1020" strokeWidth="3" fill="none" />
            </g>
          </svg>
          <div className="boot-loader__copy">
            <span className="boot-loader__label">Coupe du Monde 2026</span>
            <span className="boot-loader__status">Synchronisation du terrain</span>
          </div>
        </div>
      </main>
    )
  }

  if (error || !seed) {
    return <main className="app-shell loading">{error ?? 'Aucune donnée disponible.'}</main>
  }

  const teamsById = new Map(seed.teams.map((team) => [team.id, team]))
  const mergedMatches = mergeScores(seed.matches, liveSource.matches, overrides, mode)
  const computedStandings = computeStandings(seed.teams, mergedMatches)
  const officialStandings = liveSource.standings.reduce<Record<string, RankedStandingRow[]>>((groups, row) => {
    groups[row.groupId] ??= []
    groups[row.groupId].push(row)
    return groups
  }, {})
  const standings = mode === 'real' && liveSource.standings.length > 0
    ? officialStandings
    : computedStandings
  const predMap = new Map(liveSource.predictions.map((p) => [p.matchId, p]))
  const bestThirds = getBestThirdPlacedTeams(standings)
  const groupBracket = buildKnockoutBracket(standings)
  const activeKnockoutPicks = mode === 'simulation' ? knockoutPicks : {}
  const displayBracket = resolveDisplayBracket(groupBracket, activeKnockoutPicks)
  const playerStats = computePlayerStats(seed.teams, mergedMatches)
  const projectedQualifiedIds = new Set<string>()

  Object.values(standings).forEach((rows) => {
    rows
      .filter((row) => row.rank <= 2)
      .forEach((row) => projectedQualifiedIds.add(row.teamId))
  })
  bestThirds.forEach((row) => projectedQualifiedIds.add(row.teamId))

  const completedGroups = seed.groups.filter((group) =>
    mergedMatches
      .filter((match) => match.groupId === group.id)
      .every((match) => match.homeScore !== null && match.awayScore !== null),
  ).length
  const visibleGroups = isCompactGroups ? seed.groups.filter((group) => group.id === selectedGroupId) : seed.groups
  const todayMatches = mergedMatches.filter(isMatchToday)
  const matchDayKeys = [...new Set(mergedMatches.map(matchLocalDateKey))].sort()
  const selectedDayIndex = matchDayKeys.indexOf(selectedDayKey)
  const activeDayIndex = selectedDayIndex >= 0
    ? selectedDayIndex
    : Math.max(0, matchDayKeys.findIndex((dateKey) => dateKey >= localDateStr()))
  const activeDayKey = matchDayKeys[activeDayIndex] ?? selectedDayKey
  const dayMatches = mergedMatches
    .filter((match) => matchLocalDateKey(match) === activeDayKey)
    .sort((a, b) => {
      const aTime = a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`
      const bTime = b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`
      return aTime.localeCompare(bTime)
    })
    .slice(0, 10)
  const liveNowMatches = dayMatches.filter((match) => inferStatus(match) === 'live')
  const featuredDayMatch = liveNowMatches[0] ?? dayMatches[0] ?? null
  const previousDayKey = activeDayIndex > 0 ? matchDayKeys[activeDayIndex - 1] : null
  const nextDayKey = activeDayIndex < matchDayKeys.length - 1 ? matchDayKeys[activeDayIndex + 1] : null
  const isSelectedToday = activeDayKey === localDateStr()
  const countryCode = getCountryCodeFromFixturesUrl(seed.meta.sourceUrls.fixtures)
  const watchOptions = [
    ...(watchOptionsByCountry[countryCode] ?? watchOptionsByCountry.FR),
    { label: 'Programme FIFA', href: seed.meta.sourceUrls.fixtures },
  ]

  function updateOverride(matchId: string, side: 'homeScore' | 'awayScore', value: string) {
    setOverrides((current) => {
      const next = { ...current }
      const match = next[matchId] ?? { homeScore: null, awayScore: null }
      const normalized = value === '' ? null : Number(value)
      next[matchId] = {
        ...match,
        [side]: Number.isNaN(normalized) ? null : normalized,
      }
      return next
    })
  }

  function applyGroupRankingSimulation(groupId: string, orderedTeamIds: string[]) {
    if (!seed) {
      return
    }

    const groupMatches = seed.matches.filter((match) => match.groupId === groupId)
    const nextGroupOverrides = buildGroupOrderOverrides(groupMatches, orderedTeamIds)

    setOverrides((current) => {
      const next = { ...current }

      for (const match of groupMatches) {
        delete next[match.id]
      }

      return {
        ...next,
        ...nextGroupOverrides,
      }
    })

    setKnockoutPicks({})
  }

  function clearSimulation() {
    setOverrides({})
    setKnockoutPicks({})
    setFocusId(null)
    setDragState(null)
    clearStoredSimulation()
    setMode('real')
  }

  function toggleFocus(teamId: string) {
    setFocusId((current) => (current === teamId ? null : teamId))
  }

  function handlePickWinner(matchId: string, teamId: string) {
    setKnockoutPicks((current) => ({
      ...current,
      [matchId]: teamId,
    }))
  }

  function handleClearWinner(matchId: string) {
    setKnockoutPicks((current) => {
      const next = { ...current }
      delete next[matchId]
      return next
    })
  }

  function handleGroupDragStart(groupId: string, teamId: string) {
    if (mode !== 'simulation') {
      return
    }

    setDragState({
      groupId,
      teamId,
      overTeamId: teamId,
    })
  }

  function handleGroupDragEnter(groupId: string, teamId: string) {
    setDragState((current) => {
      if (!current || current.groupId !== groupId || current.teamId === teamId) {
        return current
      }

      return {
        ...current,
        overTeamId: teamId,
      }
    })
  }

  function handleGroupDrop(groupId: string, targetTeamId: string, currentRows: Array<{ teamId: string }>) {
    if (!dragState || dragState.groupId !== groupId || dragState.teamId === targetTeamId) {
      setDragState(null)
      return
    }

    const orderedTeamIds = currentRows.map((row) => row.teamId)
    const fromIndex = orderedTeamIds.indexOf(dragState.teamId)
    const toIndex = orderedTeamIds.indexOf(targetTeamId)

    if (fromIndex === -1 || toIndex === -1) {
      setDragState(null)
      return
    }

    const [movedTeamId] = orderedTeamIds.splice(fromIndex, 1)
    orderedTeamIds.splice(toIndex, 0, movedTeamId)
    applyGroupRankingSimulation(groupId, orderedTeamIds)
    setDragState(null)
  }

  function closeDayModal() {
    setShowDayModal(false)
  }

  function reopenDayModal() {
    setSelectedDayKey(localDateStr())
    setShowDayModal(true)
  }

  return (
    <div className="app-shell">
      {menuOpen ? <div className="menu-scrim" onClick={() => setMenuOpen(false)} /> : null}
      <div className="floods" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <header className="topbar">
        <div className="brand">
          <div className="brand__mark">
            <span>26</span>
          </div>
          <div>
            <div className="brand__title">
              MONDIAL <b>2026</b>
            </div>
            <div className="brand__sub">Simulateur de bracket · React · live + simulation</div>
          </div>
        </div>

        <div className="topactions">
          {todayMatches.length > 0 ? (
            <button type="button" className="chip-btn chip-btn--live" onClick={reopenDayModal}>
              <span className="chip-btn__pulse" aria-hidden="true" />
              {todayMatches.length} match{todayMatches.length > 1 ? 's' : ''} aujourd&apos;hui
            </button>
          ) : null}
          <button type="button" className={`syncbtn${syncing ? ' is-busy' : ''}${pollingInterval ? ' is-polling' : ''}`} onClick={handleSyncLiveSnapshot} title="Synchroniser les données live">
            <span className="syncbtn__ico">{syncing ? '◌' : '⟳'}</span>
            <span className="syncbtn__label">{syncing ? 'Synchro…' : pollingInterval ? `Auto · ${pollingInterval >= 60_000 ? `${pollingInterval / 60_000}min` : `${pollingInterval / 1_000}s`}` : 'Sync'}</span>
            <span className="syncbtn__meta">{formatSyncTime(liveSource.syncedAt)}</span>
          </button>
        </div>

        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? 'Fermer' : 'Menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? '×' : '☰'}
        </button>

        {menuOpen ? (
          <div className="topmenu" role="menu">
            {todayMatches.length > 0 ? (
              <button
                type="button"
                className="topmenu__item chip-btn--live"
                onClick={() => { reopenDayModal(); setMenuOpen(false) }}
              >
                <span className="chip-btn__pulse" aria-hidden="true" />
                {todayMatches.length} match{todayMatches.length > 1 ? 's' : ''} aujourd&apos;hui
              </button>
            ) : null}
            <div className="topmenu__sep" />
            <button
              type="button"
              className={`topmenu__item${mode === 'real' ? ' is-active' : ''}`}
              onClick={() => { setMode('real'); setMenuOpen(false) }}
            >
              Vue en direct
            </button>
            <button
              type="button"
              className={`topmenu__item${mode === 'simulation' ? ' is-active' : ''}`}
              onClick={() => { setMode('simulation'); setMenuOpen(false) }}
            >
              Mode simulation
            </button>
            {mode === 'simulation' ? (
              <button
                type="button"
                className="topmenu__item topmenu__item--danger"
                onClick={() => { clearSimulation(); setMenuOpen(false) }}
              >
                Réinitialiser simulation
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {showDayModal && featuredDayMatch ? (
        <div className="daymodal" role="dialog" aria-modal="true" aria-labelledby="daymodal-title">
          <div className="daymodal__scrim" onClick={closeDayModal} />
          <div className="daymodal__panel">
            <button type="button" className="daymodal__close" onClick={closeDayModal} aria-label="Fermer">
              ×
            </button>

            <div className="daymodal__hero">
              <div className="daymodal__eyebrow">
                {liveNowMatches.length > 0 ? (
                  <span className="daymodal__livepill">
                    <span className="gstatus__pulse" aria-hidden="true" />
                    En direct
                  </span>
                ) : (
                  <span className="daymodal__livepill daymodal__livepill--upcoming">Aujourd hui</span>
                )}
                <span>{formatSyncTime(liveSource.syncedAt)}</span>
              </div>

              <div className="daymodal__daynav" aria-label="Navigation entre les journées de matchs">
                <button
                  type="button"
                  onClick={() => previousDayKey && setSelectedDayKey(previousDayKey)}
                  disabled={!previousDayKey}
                  aria-label="Journée précédente"
                >
                  ←
                </button>
                <div>
                  <strong>{isSelectedToday ? 'Aujourd hui' : formatDayLabel(activeDayKey)}</strong>
                  <span>{dayMatches.length} match{dayMatches.length > 1 ? 's' : ''}</span>
                </div>
                <button
                  type="button"
                  className="daymodal__todaybtn"
                  onClick={() => setSelectedDayKey(localDateStr())}
                  disabled={isSelectedToday}
                >
                  Aujourd hui
                </button>
                <button
                  type="button"
                  onClick={() => nextDayKey && setSelectedDayKey(nextDayKey)}
                  disabled={!nextDayKey}
                  aria-label="Journée suivante"
                >
                  →
                </button>
              </div>

              <div className="daymodal__heroheader">
                <div>
                  <h2 id="daymodal-title">Soiree Coupe du monde</h2>
                  <p>
                    {liveNowMatches.length > 0
                      ? `${liveNowMatches.length} match${liveNowMatches.length > 1 ? 's' : ''} en direct maintenant.`
                      : `${dayMatches.length} match${dayMatches.length > 1 ? 's' : ''} au programme ${isSelectedToday ? 'aujourd hui' : formatDayLabel(activeDayKey)}.`}
                  </p>
                </div>

                <div className="daymodal__watchlist">
                  <span>Où regarder</span>
                  <div className="daymodal__watchchips">
                    {watchOptions.map((option) => (
                      <a key={option.label} href={option.href} target="_blank" rel="noreferrer" className="daymodal__watchchip">
                        {option.label}
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {(() => {
                const homeTeam = teamsById.get(featuredDayMatch.homeTeamId)
                const awayTeam = teamsById.get(featuredDayMatch.awayTeamId)
                if (!homeTeam || !awayTeam) return null
                const heroStatus = inferStatus(featuredDayMatch)
                const heroHHMM = formatKickoffTime(featuredDayMatch)
                const heroFinished = heroStatus === 'finished'
                const heroHomeWin = heroFinished && featuredDayMatch.homeScore !== null && featuredDayMatch.awayScore !== null && featuredDayMatch.homeScore > featuredDayMatch.awayScore
                const heroAwayWin = heroFinished && featuredDayMatch.homeScore !== null && featuredDayMatch.awayScore !== null && featuredDayMatch.awayScore > featuredDayMatch.homeScore

                return (
                  <div
                    className={`daymatch daymatch--hero daymatch--clickable${heroStatus === 'live' ? ' is-live' : heroStatus === 'scheduled' ? ' is-upcoming' : ''}`}
                    onClick={() => { closeDayModal(); setMatchModalGroupId(featuredDayMatch.groupId) }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') { closeDayModal(); setMatchModalGroupId(featuredDayMatch.groupId) } }}
                  >
                    <div className="daymatch__meta">
                      <span>Groupe {featuredDayMatch.groupId}</span>
                      <div className="daymatch__meta-right">
                        <BroadcasterBadge matchId={featuredDayMatch.id} />
                        <span>{featuredDayMatch.venue}</span>
                      </div>
                    </div>

                    <div className="daymatch__main">
                      <div className={`daymatch__team${heroHomeWin ? ' is-winner' : heroAwayWin ? ' is-loser' : ''}`}>
                        {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{homeTeam.flagEmoji}</span>}
                        <strong>{homeTeam.name}</strong>
                      </div>

                      <div className="daymatch__scoreblock">
                        <div className="daymatch__status">
                          {heroStatus === 'live'
                            ? formatLiveMinute(featuredDayMatch.liveMinute, liveSource.syncedAt).toUpperCase()
                            : heroStatus === 'finished' ? 'TERMINÉ' : 'BIENTÔT'}
                        </div>
                        {heroStatus === 'scheduled' && heroHHMM ? (
                          <div className="daymatch__score daymatch__score--time">{heroHHMM}</div>
                        ) : (
                          <div className="daymatch__score">
                            <span className={heroHomeWin ? 'is-winner-score' : ''}>{featuredDayMatch.homeScore ?? '-'}</span>
                            <i>:</i>
                            <span className={heroAwayWin ? 'is-winner-score' : ''}>{featuredDayMatch.awayScore ?? '-'}</span>
                          </div>
                        )}
                      </div>

                      <div className={`daymatch__team daymatch__team--right${heroAwayWin ? ' is-winner' : heroHomeWin ? ' is-loser' : ''}`}>
                        <strong>{awayTeam.name}</strong>
                        {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{awayTeam.flagEmoji}</span>}
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="daymodal__grid">
              {dayMatches.filter((m) => m.id !== featuredDayMatch.id).map((match) => {
                const homeTeam = teamsById.get(match.homeTeamId)
                const awayTeam = teamsById.get(match.awayTeamId)
                if (!homeTeam || !awayTeam) return null
                const kickoffTime = formatKickoffTime(match)
                const liveStatus = inferStatus(match)
                const miniFinished = liveStatus === 'finished'
                const miniHomeWin = miniFinished && match.homeScore !== null && match.awayScore !== null && match.homeScore > match.awayScore
                const miniAwayWin = miniFinished && match.homeScore !== null && match.awayScore !== null && match.awayScore > match.homeScore

                return (
                  <article
                    key={match.id}
                    className={`daymatch daymatch--clickable${liveStatus === 'live' ? ' is-live' : liveStatus === 'scheduled' ? ' is-upcoming' : ''}`}
                    onClick={() => { closeDayModal(); setMatchModalGroupId(match.groupId) }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') { closeDayModal(); setMatchModalGroupId(match.groupId) } }}
                  >
                    <div className="daymatch__meta">
                      <span>Groupe {match.groupId}</span>
                      <div className="daymatch__meta-right">
                        <BroadcasterBadge matchId={match.id} />
                        {liveStatus === 'live' ? <span>{formatLiveMinute(match.liveMinute, liveSource.syncedAt)}</span> : null}
                      </div>
                    </div>

                    <div className="daymatch__row">
                      <div className={`daymatch__mini${miniHomeWin ? ' is-winner' : miniAwayWin ? ' is-loser' : ''}`}>
                        {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{homeTeam.flagEmoji}</span>}
                        <span>{homeTeam.shortName}</span>
                      </div>
                      <div className="daymatch__mini daymatch__mini--score">
                        {liveStatus === 'scheduled' && kickoffTime ? (
                          <time className="daymatch__mini-time">{kickoffTime}</time>
                        ) : (
                          <>
                            <b className={miniHomeWin ? 'is-winner-score' : ''}>{match.homeScore ?? '-'}</b>
                            <span>:</span>
                            <b className={miniAwayWin ? 'is-winner-score' : ''}>{match.awayScore ?? '-'}</b>
                          </>
                        )}
                      </div>
                      <div className={`daymatch__mini daymatch__mini--right${miniAwayWin ? ' is-winner' : miniHomeWin ? ' is-loser' : ''}`}>
                        <span>{awayTeam.shortName}</span>
                        {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{awayTeam.flagEmoji}</span>}
                      </div>
                    </div>

                    {match.status === 'scheduled' && predMap.has(match.id) ? (
                      <div className="daymatch__prono">
                        {(() => {
                          const pred = predMap.get(match.id)!
                          return (
                            <>
                              <div className="prono__bar">
                                <div className="prono__seg prono__seg--home" style={{ width: `${pred.homePercent}%` }} />
                                <div className="prono__seg prono__seg--draw" style={{ width: `${pred.drawPercent}%` }} />
                                <div className="prono__seg prono__seg--away" style={{ width: `${pred.awayPercent}%` }} />
                              </div>
                              <div className="prono__pcts">
                                <span className="prono__pct prono__pct--home">{pred.homePercent}%</span>
                                <span className="prono__pct prono__pct--draw">{pred.drawPercent}% nul</span>
                                <span className="prono__pct prono__pct--away">{pred.awayPercent}%</span>
                              </div>
                            </>
                          )
                        })()}
                      </div>
                    ) : null}

                    <div className="daymatch__foot">
                      <span>{match.venue}</span>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {matchModalGroupId ? (() => {
        const modalMatches = mergedMatches
          .filter((m) => m.groupId === matchModalGroupId)
          .sort((a, b) => (a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`).localeCompare(b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`))
        const modalStandings = standings[matchModalGroupId] ?? []

        // rank lookup: teamId → rank in this group
        const rankByTeamId = new Map(modalStandings.map((r) => [r.teamId, r.rank]))

        return (
          <div className="gmmodal" role="dialog" aria-modal="true">
            <div className="gmmodal__scrim" onClick={() => setMatchModalGroupId(null)} />
            <div className="gmmodal__panel">

              {/* Header */}
              <div className="gmmodal__head">
                <div className="gmmodal__title">
                  <span className="gmmodal__badge">{matchModalGroupId}</span>
                  Groupe {matchModalGroupId}
                </div>
                <button type="button" className="gmmodal__close" onClick={() => setMatchModalGroupId(null)} aria-label="Fermer">×</button>
              </div>

              {/* Match list */}
              <div className="gmmodal__body">
                {modalMatches.map((match) => {
                  const homeTeam = teamsById.get(match.homeTeamId)
                  const awayTeam = teamsById.get(match.awayTeamId)
                  if (!homeTeam || !awayTeam) return null

                  const effectiveStatus = inferStatus(match)
                  const isLive = effectiveStatus === 'live'
                  const isDone = effectiveStatus === 'finished'
                  const isScheduled = effectiveStatus === 'scheduled'
                  const homeWin = isDone && match.homeScore !== null && match.awayScore !== null && match.homeScore > match.awayScore
                  const awayWin = isDone && match.homeScore !== null && match.awayScore !== null && match.awayScore > match.homeScore

                  const homeRank = rankByTeamId.get(homeTeam.id)
                  const awayRank = rankByTeamId.get(awayTeam.id)
                  const pred = predMap.get(match.id)

                  // Format time in browser local timezone
                  const kickoffDate = new Date(match.kickoffIso ?? `${match.kickoffDate}T12:00:00Z`)
                  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(kickoffDate)
                  const kickoffHHMM = match.kickoffIso
                    ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(match.kickoffIso))
                    : null

                  return (
                    <div key={match.id} className={`gmrow${isLive ? ' is-live' : ''}${isMatchToday(match) ? ' is-today' : ''}`}>

                      {/* Date / status row */}
                      <div className="gmrow__header">
                        {isLive
                          ? <span className="gmrow__livebadge"><span className="gstatus__pulse" aria-hidden="true" />{formatLiveMinute(match.liveMinute, liveSource.syncedAt)}</span>
                          : <span className="gmrow__time">{dateLabel}</span>
                        }
                        <div className="gmrow__header-right">
                          <BroadcasterBadge matchId={match.id} />
                          <span className="gmrow__venue">{match.venue}</span>
                        </div>
                      </div>

                      {/* Teams + score */}
                      <div className="gmrow__match">
                        <div className={`gmrow__team gmrow__team--home${homeWin ? ' is-win' : ''}`}>
                          {homeRank != null && <span className={`gmrow__rank${homeRank <= 2 ? ' is-q' : ''}`}>#{homeRank}</span>}
                          {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="flag-image" /> : <span className="flag-emoji">{homeTeam.flagEmoji}</span>}
                          <span className="gmrow__name">{homeTeam.name}</span>
                        </div>

                        <div className="gmrow__score">
                          {isScheduled && kickoffHHMM && (
                            <span className="gmrow__kicktime">{kickoffHHMM}</span>
                          )}
                          <div className="gmrow__score__digits">
                            {mode === 'simulation' ? (
                              <>
                                <input type="number" min="0"
                                  value={overrides[match.id]?.homeScore ?? match.homeScore ?? ''}
                                  onChange={(e) => updateOverride(match.id, 'homeScore', e.target.value)} />
                                <span>:</span>
                                <input type="number" min="0"
                                  value={overrides[match.id]?.awayScore ?? match.awayScore ?? ''}
                                  onChange={(e) => updateOverride(match.id, 'awayScore', e.target.value)} />
                              </>
                            ) : isScheduled ? (
                              <span className="gmrow__score__dash">–</span>
                            ) : (
                              <>
                                <b>{match.homeScore ?? '–'}</b>
                                <span>:</span>
                                <b>{match.awayScore ?? '–'}</b>
                              </>
                            )}
                          </div>
                        </div>

                        <div className={`gmrow__team gmrow__team--away${awayWin ? ' is-win' : ''}`}>
                          <span className="gmrow__name">{awayTeam.name}</span>
                          {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="flag-image" /> : <span className="flag-emoji">{awayTeam.flagEmoji}</span>}
                          {awayRank != null && <span className={`gmrow__rank${awayRank <= 2 ? ' is-q' : ''}`}>#{awayRank}</span>}
                        </div>
                      </div>

                      {/* Prono — only for scheduled matches */}
                      {isScheduled && pred ? (
                        <div className="gmrow__prono">
                          <div className="prono__teams">
                            <span>{homeTeam.shortName}</span>
                            <span className="prono__label">Prono</span>
                            <span>{awayTeam.shortName}</span>
                          </div>
                          <div className="prono__bar">
                            <div className="prono__seg prono__seg--home" style={{ width: `${pred.homePercent}%` }} />
                            <div className="prono__seg prono__seg--draw" style={{ width: `${pred.drawPercent}%` }} />
                            <div className="prono__seg prono__seg--away" style={{ width: `${pred.awayPercent}%` }} />
                          </div>
                          <div className="prono__pcts">
                            <span className="prono__pct prono__pct--home">{pred.homePercent}%</span>
                            <span className="prono__pct prono__pct--draw">{pred.drawPercent}% nul</span>
                            <span className="prono__pct prono__pct--away">{pred.awayPercent}%</span>
                          </div>
                          {(pred.homeForm || pred.awayForm) && (
                            <div className="prono__forms">
                              {pred.homeForm ? <FormDots form={pred.homeForm} /> : <span />}
                              <span className="prono__formsep">5 derniers</span>
                              {pred.awayForm ? <FormDots form={pred.awayForm} align="right" /> : <span />}
                            </div>
                          )}
                          {pred.advice && <div className="prono__advice">✦ {pred.advice}</div>}
                        </div>
                      ) : null}

                      {/* No time hint if no kickoffIso */}
                      {isScheduled && !match.kickoffIso && !pred && (
                        <div className="gmrow__nosync">Sync pour voir l&apos;heure exacte et le pronostic</div>
                      )}

                    </div>
                  )
                })}
              </div>

              <div className="gmmodal__foot">
                <span className={`srcdot srcdot--${mode === 'simulation' ? 'sim' : 'live'}`} />
                {mode === 'simulation' ? 'Scores simulés' : liveSource.syncedAt ? `Données live · ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(liveSource.syncedAt))}` : 'Synchronise pour avoir les horaires et pronostics'}
              </div>
            </div>
          </div>
        )
      })() : null}

      <div className="controls">
        <div className="seg">
          <button type="button" className={`seg__btn${view === 'groups' ? ' is-active' : ''}`} onClick={() => setView('groups')}>
            ▦ Groupes
          </button>
          <button type="button" className={`seg__btn${view === 'bracket' ? ' is-active' : ''}`} onClick={() => setView('bracket')}>
            🏆 Tableau
          </button>
          <div className={`seg__thumb seg__thumb--${view}`} />
        </div>

        <div className="controls__modeseg">
          <div className="seg seg--mode">
            <button type="button" className={`seg__btn${mode === 'real' ? ' is-active' : ''}`} onClick={() => setMode('real')}>
              En direct
            </button>
            <button type="button" className={`seg__btn${mode === 'simulation' ? ' is-active' : ''}`} onClick={() => setMode('simulation')}>
              Simulation
            </button>
            <div className={`seg__thumb seg__thumb--${mode === 'real' ? 'groups' : 'bracket'}`} />
          </div>
          {mode === 'simulation' ? (
            <button type="button" className="chip-btn chip-btn--danger chip-btn--sm" onClick={clearSimulation}>
              Réinitialiser
            </button>
          ) : null}
        </div>

        <div className="controls__right">
          <div className="progresschip">
            <span className="progresschip__n">
              {completedGroups}
              <i>/12</i>
            </span>
            <span className="progresschip__bar">
              <span style={{ width: `${(completedGroups / 12) * 100}%` }} />
            </span>
            <span className="progresschip__lbl">groupes</span>
          </div>

          {focusId ? (
            <div className="focuschip">
              <span>{teamsById.get(focusId)?.name}</span>
              <button type="button" onClick={() => setFocusId(null)}>
                ×
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {liveSource.warnings.length > 0 ? (
        <div className="warning-strip">
          {liveSource.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {mode === 'simulation' ? (
        <div className="simhint">
          <span className="simhint__ico">✦</span>
          Glisse les équipes pour réordonner un groupe · ajuste les scores · clique une équipe dans le tableau pour la faire avancer
        </div>
      ) : null}

      {view === 'groups' ? (
        <div className="groups-rail" aria-label="Navigation groupes">
          {seed.groups.map((group) => {
            const groupMatches = mergedMatches.filter((match) => match.groupId === group.id)
            const todayMatches = groupMatches.filter(isMatchToday).length
            const isComplete = groupMatches.every((match) => match.homeScore !== null && match.awayScore !== null)
            return (
              <button
                key={group.id}
                type="button"
                className={`groups-rail__chip${selectedGroupId === group.id ? ' is-active' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <span>Groupe {group.id}</span>
                {todayMatches > 0 ? <span className="groups-rail__dot is-live" aria-hidden="true" /> : null}
                {isComplete ? <span className="groups-rail__state">OK</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={`board${view === 'bracket' ? ' board--wide' : ''}`}>
        <main className="board__main">
          {view === 'groups' ? (
            <div className="groups">
              {visibleGroups.map((group) => {
                const groupStandings = standings[group.id] ?? []
                const groupMatches = mergedMatches.filter((match) => match.groupId === group.id)
                const isComplete = groupMatches.every((match) => match.homeScore !== null && match.awayScore !== null)
                const todayMatches = groupMatches.filter(isMatchToday).length

                return (
                  <section key={group.id} className={`gcard${isComplete ? ' is-complete' : ''}`}>
                    <header className="gcard__head">
                      <div className="gcard__identity">
                        <div className="gcard__badge">{group.id}</div>
                        <div>
                          <div className="gcard__title">Groupe {group.id}</div>
                          <div className="gcard__sub">{isComplete ? 'Classement fige' : 'Classement en cours'}</div>
                        </div>
                      </div>
                      <div className="gcard__status">
                        {todayMatches > 0 ? <span className="gstatus gstatus--live"><span className="gstatus__pulse" aria-hidden="true" />Aujourd hui {todayMatches}</span> : null}
                        <span className={`gstatus${isComplete ? ' gstatus--ok' : ''}`}>{isComplete ? 'Complet' : `${groupMatches.length} matchs`}</span>
                      </div>
                    </header>

                    <table className="stand">
                      <thead>
                        <tr>
                          <th className="stand__pos">#</th>
                          <th className="stand__team">Équipe</th>
                          <th title="Matchs joués">J</th>
                          <th title="Matchs gagnés">G</th>
                          <th title="Matchs nuls">N</th>
                          <th title="Matchs perdus">P</th>
                          <th title="Différence de buts : buts marqués moins buts encaissés">+/-</th>
                          <th className="stand__pts" title="Points de classement : 3 par victoire, 1 par nul">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupStandings.map((row) => {
                          const team = teamsById.get(row.teamId)
                          if (!team) return null

                          return (
                            <tr
                              key={row.teamId}
                              className={[
                                'stand__row',
                                row.rank <= 2 ? 'stand__row--q1' : row.rank === 3 ? 'stand__row--q3' : 'stand__row--q0',
                                focusId === row.teamId ? 'is-focus' : '',
                                mode === 'simulation' ? 'stand__row--draggable' : '',
                                dragState?.groupId === group.id && dragState.overTeamId === row.teamId ? 'is-drag-over' : '',
                              ].filter(Boolean).join(' ')}
                              draggable={mode === 'simulation'}
                              onDragStart={() => handleGroupDragStart(group.id, row.teamId)}
                              onDragEnter={() => handleGroupDragEnter(group.id, row.teamId)}
                              onDragOver={(event) => {
                                if (mode === 'simulation') {
                                  event.preventDefault()
                                }
                              }}
                              onDrop={() => handleGroupDrop(group.id, row.teamId, groupStandings)}
                              onDragEnd={() => setDragState(null)}
                            >
                              <td className="stand__pos">{row.rank}</td>
                              <td className="stand__team" onClick={() => toggleFocus(row.teamId)}>
                                <div className="stand__team-content">
                                  {mode === 'simulation' ? <span className="stand__drag">⋮⋮</span> : null}
                                  {flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
                                  <span className="stand__name">{team.name}</span>
                                  {projectedQualifiedIds.has(team.id) ? <span className="stand__check">✓</span> : null}
                                </div>
                              </td>
                              <td>{row.played}</td>
                              <td>{row.wins}</td>
                              <td>{row.draws}</td>
                              <td>{row.losses}</td>
                              <td className={row.goalDifference > 0 ? 'pos' : row.goalDifference < 0 ? 'neg' : ''}>
                                {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                              </td>
                              <td className="stand__pts">{row.points}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    <div className="gcard__footer">
                      <button type="button" className="gcard__toggle" onClick={() => setMatchModalGroupId(group.id)}>
                        {todayMatches > 0 ? <span className="gcard__livetag"><span className="gstatus__pulse" aria-hidden="true" />En direct</span> : null}
                        <span>Programme · {groupMatches.length} matchs</span>
                        <span className="gcard__togglearrow">→</span>
                      </button>
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <BracketBoard
              matches={displayBracket}
              teamsById={teamsById}
              focusId={focusId}
              picks={activeKnockoutPicks}
              simulationEnabled={mode === 'simulation'}
              onPick={handlePickWinner}
              onClear={handleClearWinner}
            />
          )}
        </main>

        <aside className="board__side">
          <div className="panel">
            <div className="panel__head">
              <div>
                <div className="panel__title">En route pour les 8es</div>
                <div className="panel__sub">Top 2 par groupe · 8 meilleurs 3es qualifiés</div>
              </div>
            </div>
            <div className="odds">
              {[...projectedQualifiedIds]
                .slice(0, 12)
                .map((teamId, index) => {
                  const team = teamsById.get(teamId)
                  if (!team) return null

                  return (
                    <button key={team.id} type="button" className={`oddrow${focusId === team.id ? ' is-focus' : ''}`} onClick={() => toggleFocus(team.id)}>
                      <span className="oddrow__rank">{index + 1}</span>
                      {flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
                      <span className="oddrow__name">{team.name}</span>
                      <span className="oddrow__bar">
                        <span className="oddrow__fill" style={{ width: `${100 - index * 5}%` }} />
                      </span>
                      <span className="oddrow__pct">{team.groupId}</span>
                    </button>
                  )
                })}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <div>
                <div className="panel__title">Meilleurs troisièmes</div>
                <div className="panel__sub">Projection en cours pour les slots variables</div>
              </div>
            </div>
            <div className="scorers">
              {bestThirds.map((row, index) => {
                const team = teamsById.get(row.teamId)
                if (!team) return null

                return (
                  <div key={team.id} className={`scorerrow${index === 0 ? ' is-top' : ''}`}>
                    <span className="scorerrow__rank">{index + 1}</span>
                    {flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
                    <span className="scorerrow__name">{team.name}</span>
                    <span className="scorerrow__team">{team.groupId}</span>
                    <span className="scorerrow__goals">
                      <b>{row.points}</b>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="panel__foot">
              <span className={`srcdot srcdot--${mode === 'simulation' ? 'sim' : 'live'}`} />
              {mode === 'simulation' ? 'Données simulées' : 'Données live fusionnées au seed'}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <div>
                <div className="panel__title">Stats joueurs</div>
                <div className="panel__sub">Classement des buteurs à partir des matchs joués</div>
              </div>
            </div>
            <div className="scorers">
              {playerStats.slice(0, 10).map((stat, index) => {
                const team = teamsById.get(stat.teamId)

                return (
                  <div key={`${stat.teamId}:${stat.name}`} className={`scorerrow${index === 0 ? ' is-top' : ''}`}>
                    <span className="scorerrow__rank">{index + 1}</span>
                    {team ? (
                      flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>
                    ) : (
                      <span className="flag-emoji">•</span>
                    )}
                    <span className="scorerrow__name">{stat.name}</span>
                    <span className="scorerrow__team">{team?.fifaCode ?? ''}</span>
                    <span className="scorerrow__goals">
                      <b>{stat.goals}</b>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="panel__foot">
              Basé sur les scores du mode actif
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default App
