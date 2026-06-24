import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { toBlob } from 'html-to-image'
import './App.css'
import { loadLiveSnapshot, loadSeed, syncLiveSnapshot as requestLiveSync, fetchMatchStats, fetchOdds } from './lib/data'
import type { MatchEventsData, MatchOdds, OddsSnapshot } from './lib/data'
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
  matches: Array<{ id: string; homeScore: number | null; awayScore: number | null; status: GroupMatch['status']; kickoffTime?: string | null; kickoffIso?: string | null; liveMinute?: string | null; fifaMatchPath?: string | null }>
  standings: RankedStandingRow[]
  predictions: MatchPrediction[]
  topScorers?: Array<{ name: string; teamCode: string; goals: number }>
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
    topScorers: snapshot.topScorers?.length ? snapshot.topScorers : current.topScorers,
  }
}

function hasRenderableScore(match: Pick<GroupMatch, 'homeScore' | 'awayScore'>): boolean {
  return match.homeScore !== null && match.awayScore !== null
}

function ScoreLoading() {
  return (
    <div className="daymatch__score daymatch__score--loading" aria-label="Chargement du score" role="status">
      <span />
      <span />
      <span />
    </div>
  )
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
  { key: 'R32L', stage: 'Round of 32', side: 'left', ids: ['M74', 'M77', 'M73', 'M75', 'M83', 'M84', 'M81', 'M82'] },
  { key: 'R16L', stage: 'Round of 16', side: 'left', ids: ['M89', 'M90', 'M93', 'M94'] },
  { key: 'QFL', stage: 'Quarter-final', side: 'left', ids: ['M97', 'M98'] },
  { key: 'SFL', stage: 'Semi-final', side: 'left', ids: ['M101'] },
  { key: 'F', stage: 'Finale', side: 'center', ids: ['M103', 'M104'] },
  { key: 'SFR', stage: 'Semi-final', side: 'right', ids: ['M102'] },
  { key: 'QFR', stage: 'Quarter-final', side: 'right', ids: ['M99', 'M100'] },
  { key: 'R16R', stage: 'Round of 16', side: 'right', ids: ['M91', 'M92', 'M95', 'M96'] },
  { key: 'R32R', stage: 'Round of 32', side: 'right', ids: ['M76', 'M78', 'M79', 'M80', 'M86', 'M88', 'M85', 'M87'] },
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

function getEntrantTeamId(entrant: KnockoutEntrant): string | null {
  return entrant.kind === 'team' ? entrant.teamId : null
}

function buildConnectorPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  const horizontalDirection = x2 >= x1 ? 1 : -1
  const deltaY = y2 - y1
  const radius = Math.min(18, Math.abs(deltaY) / 2, Math.abs(midX - x1))

  if (radius < 1) {
    return `M ${x1} ${y1} H ${x2}`
  }

  const turnInX = midX - horizontalDirection * radius
  const turnOutX = midX + horizontalDirection * radius
  const turnInY = y1 + Math.sign(deltaY) * radius
  const turnOutY = y2 - Math.sign(deltaY) * radius

  return [
    `M ${x1} ${y1}`,
    `H ${turnInX}`,
    `Q ${midX} ${y1} ${midX} ${turnInY}`,
    `V ${turnOutY}`,
    `Q ${midX} ${y2} ${turnOutX} ${y2}`,
    `H ${x2}`,
  ].join(' ')
}

function normalizeFilePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const mobileRoundTabs = [
  { key: 'R32', label: 'R32', stage: 'Round of 32' },
  { key: 'R16', label: 'R16', stage: 'Round of 16' },
  { key: 'QF', label: 'QF', stage: 'Quarter-final' },
  { key: 'SF', label: 'SF', stage: 'Semi-final' },
  { key: 'F', label: 'Finale', stage: 'Finale' },
] as const

function KnockoutTeamBadge({
  entrant,
  teamsById,
  isWinner,
  isLoser,
  isFocus,
  isActivePath,
  side,
  isInteractive,
  onPick,
  onPreview,
  onStandingsHover,
}: {
  entrant: KnockoutEntrant
  teamsById: Map<string, Team>
  isWinner: boolean
  isLoser: boolean
  isFocus: boolean
  isActivePath: boolean
  side: 'left' | 'center' | 'right'
  isInteractive: boolean
  onPick?: (teamId: string) => void
  onPreview?: (teamId: string | null) => void
  onStandingsHover?: (teamId: string | null, event: React.MouseEvent) => void
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
        <span className="bm__name">Equipe inconnue</span>
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
        isActivePath ? 'is-active-path' : '',
      ].filter(Boolean).join(' ')}
      disabled={!isInteractive}
      onClick={() => onPick?.(team.id)}
      onMouseEnter={(e) => { onPreview?.(team.id); onStandingsHover?.(team.id, e) }}
      onMouseLeave={(e) => { onPreview?.(null); onStandingsHover?.(null, e) }}
      onFocus={(e) => { onPreview?.(team.id); onStandingsHover?.(team.id, e) }}
      onBlur={(e) => { onPreview?.(null); onStandingsHover?.(null, e) }}
    >
      {side === 'right' ? (
        <>
          <span className="bm__name">{team.name}</span>
          {isWinner ? <span className="bm__tick" aria-hidden="true">x</span> : null}
          {src ? <img src={src} alt="" className="flag-image" crossOrigin="anonymous" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
        </>
      ) : (
        <>
          {src ? <img src={src} alt="" className="flag-image" crossOrigin="anonymous" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
          <span className="bm__name">{team.name}</span>
          {isWinner ? <span className="bm__tick" aria-hidden="true">x</span> : null}
        </>
      )}
    </button>
  )
}

const MatchCard = memo(function MatchCard({
  match,
  teamsById,
  side,
  simulationEnabled,
  isActive,
  isDimmed,
  isFinalCard,
  focusId,
  registerRef,
  onPick,
  onClear,
  onPreview,
  onStandingsHover,
}: {
  match: DisplayMatch
  teamsById: Map<string, Team>
  side: 'left' | 'center' | 'right'
  simulationEnabled: boolean
  isActive: boolean
  isDimmed: boolean
  isFinalCard: boolean
  focusId: string | null
  registerRef: (node: HTMLDivElement | null) => void
  onPick: (matchId: string, teamId: string) => void
  onClear: (matchId: string) => void
  onPreview: (teamId: string | null) => void
  onStandingsHover?: (teamId: string | null, event: React.MouseEvent) => void
}) {
  const homeTeamId = getEntrantTeamId(match.home)
  const awayTeamId = getEntrantTeamId(match.away)

  return (
    <article
      className={[
        'bm',
        isActive ? 'is-active' : '',
        isDimmed ? 'is-dimmed' : '',
        isFinalCard ? 'bm--final' : '',
      ].filter(Boolean).join(' ')}
      ref={registerRef}
      data-match-id={match.id}
    >
      <div className="bm__meta">
        <span>{match.label.toUpperCase()}</span>
        <span>{match.dateLabel.toUpperCase()}</span>
      </div>
      <KnockoutTeamBadge
        entrant={match.home}
        teamsById={teamsById}
        isWinner={match.winnerId === homeTeamId}
        isLoser={match.played && Boolean(homeTeamId) && match.winnerId !== homeTeamId}
        isFocus={focusId === homeTeamId}
        isActivePath={isActive}
        side={side}
        isInteractive={simulationEnabled}
        onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
        onPreview={onPreview}
        onStandingsHover={onStandingsHover}
      />
      <KnockoutTeamBadge
        entrant={match.away}
        teamsById={teamsById}
        isWinner={match.winnerId === awayTeamId}
        isLoser={match.played && Boolean(awayTeamId) && match.winnerId !== awayTeamId}
        isFocus={focusId === awayTeamId}
        isActivePath={isActive}
        side={side}
        isInteractive={simulationEnabled}
        onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
        onPreview={onPreview}
        onStandingsHover={onStandingsHover}
      />
      {simulationEnabled && match.played ? (
        <div className="bm__actions match-card-actions">
          <button type="button" className="bm__clear" onClick={() => onClear(match.id)} aria-label={`Effacer ${match.label}`}>
            ?
          </button>
        </div>
      ) : null}
    </article>
  )
})

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
        : template.home.type === 'loserOf'
          ? (() => {
              const prev = display.get(template.home.matchId)
              if (prev?.winnerId) {
                const loser = [prev.home, prev.away].find(
                  (e) => e.kind === 'team' && e.teamId !== prev.winnerId,
                )
                return loser?.kind === 'team'
                  ? ({ kind: 'team', teamId: loser.teamId } satisfies KnockoutEntrant)
                  : ({ kind: 'placeholder', label: `Perdant ${template.home.matchId}` } satisfies KnockoutEntrant)
              }
              return { kind: 'placeholder', label: `Perdant ${template.home.matchId}` } satisfies KnockoutEntrant
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
        : template.away.type === 'loserOf'
          ? (() => {
              const prev = display.get(template.away.matchId)
              if (prev?.winnerId) {
                const loser = [prev.home, prev.away].find(
                  (e) => e.kind === 'team' && e.teamId !== prev.winnerId,
                )
                return loser?.kind === 'team'
                  ? ({ kind: 'team', teamId: loser.teamId } satisfies KnockoutEntrant)
                  : ({ kind: 'placeholder', label: `Perdant ${template.away.matchId}` } satisfies KnockoutEntrant)
              }
              return { kind: 'placeholder', label: `Perdant ${template.away.matchId}` } satisfies KnockoutEntrant
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
  standings,
  onPick,
  onClear,
  onFocusChange,
}: {
  matches: DisplayMatch[]
  teamsById: Map<string, Team>
  focusId: string | null
  picks: Record<string, string>
  simulationEnabled: boolean
  standings: Record<string, RankedStandingRow[]>
  onPick: (matchId: string, teamId: string) => void
  onClear: (matchId: string) => void
  onFocusChange: (teamId: string | null) => void
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const fullscreenRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [visualScale, setVisualScale] = useState(1)
  const [lines, setLines] = useState<Array<{ id: string; d: string; active: boolean }>>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLandscape, setIsLandscape] = useState(() => window.innerWidth >= window.innerHeight)
  const [previewTeamId, setPreviewTeamId] = useState<string | null>(null)
  const [activeMobileRound, setActiveMobileRound] = useState<(typeof mobileRoundTabs)[number]['key']>('R32')
  const [isExporting, setIsExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const [standingsPopup, setStandingsPopup] = useState<{ teamId: string; x: number; y: number } | null>(null)
  const isFullscreenRef = useRef(false)

  const matchMap = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches])
  const parentLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const template of knockoutTemplates) {
      if (template.home.type === 'winnerOf') {
        lookup.set(template.home.matchId, template.id)
      }
      if (template.away.type === 'winnerOf') {
        lookup.set(template.away.matchId, template.id)
      }
    }
    return lookup
  }, [])
  const allTeams = useMemo(() => {
    const teamIds = new Set<string>()
    for (const match of matches) {
      const homeTeamId = getEntrantTeamId(match.home)
      const awayTeamId = getEntrantTeamId(match.away)
      if (homeTeamId) teamIds.add(homeTeamId)
      if (awayTeamId) teamIds.add(awayTeamId)
    }

    return [...teamIds]
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is Team => Boolean(team))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [matches, teamsById])
  const focusTeamId = previewTeamId ?? focusId
  const defaultActiveMatchIds = useMemo(() => new Set(['M101', 'M102', 'M103', 'M104'].filter((id) => matchMap.has(id))), [matchMap])
  const activeMatchIds = useMemo(() => {
    if (!focusTeamId) {
      return defaultActiveMatchIds
    }

    const highlighted = new Set<string>()
    for (const match of matches) {
      if ([match.home, match.away].some((entrant) => entrant.kind === 'team' && entrant.teamId === focusTeamId)) {
        highlighted.add(match.id)
      }
    }
    return highlighted
  }, [defaultActiveMatchIds, focusTeamId, matches])
  const activeLineIds = useMemo(() => {
    if (!focusTeamId) {
      return new Set(['M101', 'M102'])
    }

    const highlighted = new Set<string>()
    for (const [childId, parentId] of parentLookup.entries()) {
      if (activeMatchIds.has(childId) && activeMatchIds.has(parentId)) {
        highlighted.add(childId)
      }
    }
    return highlighted
  }, [activeMatchIds, focusTeamId, parentLookup])
  const finalMatch = matchMap.get('M104') ?? null
  const championTeam = finalMatch?.winnerId ? teamsById.get(finalMatch.winnerId) ?? null : null
  const mobileRoundMatches = useMemo(() => {
    const grouped = new Map<string, DisplayMatch[]>()
    for (const tab of mobileRoundTabs) {
      grouped.set(tab.key, matches.filter((match) => match.stage === tab.stage))
    }
    return grouped
  }, [matches])
  const focusedPathMatches = useMemo(() => {
    if (!focusTeamId) return []
    return knockoutTemplates
      .map((template) => matchMap.get(template.id))
      .filter((match): match is DisplayMatch => Boolean(match))
      .filter((match) => activeMatchIds.has(match.id))
  }, [activeMatchIds, focusTeamId, matchMap])

  useEffect(() => {
    if (!exportFeedback) {
      return
    }

    const timeout = window.setTimeout(() => setExportFeedback(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [exportFeedback])

  useEffect(() => {
    isFullscreenRef.current = isFullscreen
  }, [isFullscreen])

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

  useEffect(() => {
    const updateGeometry = () => {
      if (!boardRef.current) {
        return
      }

      const nextWidth = Math.ceil(boardRef.current.scrollWidth)
      const nextHeight = Math.ceil(boardRef.current.scrollHeight)
      const viewportWidth = viewportRef.current?.clientWidth ?? 0
      const viewportHeight = viewportRef.current?.clientHeight ?? 0
      const scaleByWidth = viewportWidth > 0 && nextWidth > 0 ? (viewportWidth - 24) / nextWidth : 1
      const scaleByHeight = isFullscreenRef.current && viewportHeight > 0 && nextHeight > 0
        ? (viewportHeight - 40) / nextHeight
        : 1
      const nextScale = Math.min(1, Math.max(0.35, Math.min(scaleByWidth, scaleByHeight)))
      const boardRect = boardRef.current.getBoundingClientRect()
      const safeScale = nextScale || 1
      const nextLines: Array<{ id: string; d: string; active: boolean }> = []

      setBox({
        width: nextWidth,
        height: nextHeight,
      })
      setVisualScale(nextScale)

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
        const x1 = (side === 'right' ? matchRect.left - boardRect.left : matchRect.right - boardRect.left) / safeScale
        const x2 = (side === 'right' ? parentRect.right - boardRect.left : parentRect.left - boardRect.left) / safeScale
        const y1 = (matchRect.top + matchRect.height / 2 - boardRect.top) / safeScale
        const y2 = (parentRect.top + parentRect.height / 2 - boardRect.top) / safeScale

        nextLines.push({
          id: match.id,
          d: buildConnectorPath(x1, y1, x2, y2),
          active: activeLineIds.has(match.id),
        })
      }

      setLines(nextLines)
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateGeometry)
    })

    if (boardRef.current) {
      observer.observe(boardRef.current)
    }
    if (viewportRef.current) {
      observer.observe(viewportRef.current)
    }

    const frame = requestAnimationFrame(updateGeometry)
    const timeout = window.setTimeout(updateGeometry, 90)
    window.addEventListener('resize', updateGeometry)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      window.removeEventListener('resize', updateGeometry)
    }
  }, [activeLineIds, matches, parentLookup, picks])

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

  async function generateBracketBlob() {
    if (!exportRef.current) {
      throw new Error("Zone d'export introuvable.")
    }

    setIsExporting(true)
    exportRef.current.classList.add('is-exporting')

    try {
      const blob = await toBlob(exportRef.current, {
        cacheBust: true,
        pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
        backgroundColor: '#050b16',
      })

      if (!blob) {
        throw new Error("La generation de l'image a echoue.")
      }

      return blob
    } finally {
      exportRef.current.classList.remove('is-exporting')
      setIsExporting(false)
    }
  }

  function getBracketFileName() {
    const homeTeamId = finalMatch ? getEntrantTeamId(finalMatch.home) : null
    const awayTeamId = finalMatch ? getEntrantTeamId(finalMatch.away) : null
    const homeTeam = homeTeamId ? teamsById.get(homeTeamId) : null
    const awayTeam = awayTeamId ? teamsById.get(awayTeamId) : null

    if (homeTeam && awayTeam) {
      return `fifa-bracket-${normalizeFilePart(homeTeam.name)}-vs-${normalizeFilePart(awayTeam.name)}.png`
    }

    const date = new Date().toISOString().slice(0, 10)
    return `fifa-bracket-${date}.png`
  }

  function downloadGeneratedBlob(blob: Blob) {
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = getBracketFileName()
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function handleDownload() {
    try {
      setExportFeedback("Generation de l'image...")
      const blob = await generateBracketBlob()
      downloadGeneratedBlob(blob)
      setExportFeedback('Image telechargee.')
    } catch (error) {
      console.error('Bracket image download failed:', error)
      setExportFeedback("Impossible de generer l'image pour le moment.")
    }
  }

  async function handleShare() {
    let blob: Blob | null = null

    try {
      setExportFeedback("Generation de l'image...")
      blob = await generateBracketBlob()
      const file = new File([blob], getBracketFileName(), { type: 'image/png' })

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'FIFA Bracket',
          text: 'Voici mon bracket FIFA',
          files: [file],
        })
        setExportFeedback("Image prete a etre partagee.")
        return
      }

      downloadGeneratedBlob(blob)
      setExportFeedback('Telechargement lance.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setExportFeedback(null)
        return
      }

      console.error('Bracket image share failed:', error)

      if (blob) {
        downloadGeneratedBlob(blob)
        setExportFeedback('Partage non disponible, telechargement lance.')
        return
      }

      try {
        const fallbackBlob = await generateBracketBlob()
        downloadGeneratedBlob(fallbackBlob)
        setExportFeedback('Partage non disponible, telechargement lance.')
      } catch (fallbackError) {
        console.error('Bracket share fallback failed:', fallbackError)
        setExportFeedback("Impossible de generer l'image pour le moment.")
      }
    }
  }

  return (
    <div className={`bracket-shell${isFullscreen ? ' is-fullscreen' : ''}`} ref={fullscreenRef}>
      <div className="bracket-shell__toolbar">
        <div className="bracket-shell__copy">
          <div className="bracket-shell__title">Tableau final</div>
          <div className="bracket-shell__hint">
            {focusTeamId
              ? `Parcours mis en avant: ${teamsById.get(focusTeamId)?.name ?? 'Equipe'}`
              : 'Le centre souligne naturellement la route vers la finale.'}
          </div>
        </div>

        <div className="bracket-toolbar">
          <label className="bracket-select">
            <span>Equipe</span>
            <select value={focusId ?? ''} onChange={(event) => onFocusChange(event.target.value || null)}>
              <option value="">Parcours finalistes</option>
              {allTeams.map((team) => (
                <option key={team.id} value={team.id}>{team.flagEmoji} {team.name}</option>
              ))}
            </select>
          </label>

          {focusId ? (
            <button type="button" className="chip-btn chip-btn--sm" onClick={() => onFocusChange(null)}>
              Reinitialiser le focus
            </button>
          ) : null}

          <button type="button" className="chip-btn chip-btn--sm" disabled={isExporting} onClick={() => void handleShare()}>
            {isExporting ? "Generation de l'image..." : 'Partager'}
          </button>

          <button type="button" className="chip-btn chip-btn--sm" disabled={isExporting} onClick={() => void handleDownload()}>
            {isExporting ? "Generation de l'image..." : 'Telecharger'}
          </button>

          <button type="button" className="chip-btn chip-btn--sm bracket-shell__fullscreen" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? 'Quitter plein ecran' : 'Plein ecran'}
          </button>
        </div>
      </div>

      {exportFeedback ? <div className="bracket-shell__feedback">{exportFeedback}</div> : null}

      {isFullscreen && !isLandscape ? (
        <div className="bracket-rotate">
          <div className="bracket-rotate__icon" aria-hidden="true">R</div>
          <div className="bracket-rotate__title">Passe en paysage</div>
          <p>Le bracket complet est plus lisible en mode horizontal pendant le plein ecran.</p>
        </div>
      ) : null}

      <div className="bracket-mobile-shell">
        {focusTeamId ? (
          <section className="bracket-mobile-path">
            <div className="bracket-mobile-path__head">
              <strong>{teamsById.get(focusTeamId)?.name}</strong>
              <span>Parcours selectionne</span>
            </div>
            <div className="bracket-mobile-path__list">
              {focusedPathMatches.map((match) => (
                <div key={match.id} className="bracket-mobile-path__item">
                  <span>{match.stage}</span>
                  <b>
                    {match.home.kind === 'team' ? teamsById.get(match.home.teamId)?.name : match.home.label}
                    {' vs '}
                    {match.away.kind === 'team' ? teamsById.get(match.away.teamId)?.name : match.away.label}
                  </b>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="bracket-mobile-tabs" role="tablist" aria-label="Rounds du bracket">
          {mobileRoundTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeMobileRound === tab.key}
              className={`bracket-mobile-tab${activeMobileRound === tab.key ? ' is-active' : ''}`}
              onClick={() => setActiveMobileRound(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bracket-mobile-round">
          {(mobileRoundMatches.get(activeMobileRound) ?? []).map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              teamsById={teamsById}
              side="center"
              simulationEnabled={simulationEnabled}
              isActive={activeMatchIds.has(match.id)}
              isDimmed={Boolean(focusTeamId) && !activeMatchIds.has(match.id)}
              isFinalCard={match.id === 'M104'}
              focusId={focusId}
              registerRef={() => undefined}
              onPick={onPick}
              onClear={onClear}
              onPreview={setPreviewTeamId}
            />
          ))}
        </div>
      </div>

      <div className="bracket-fit" ref={viewportRef}>
        <div className="bracket-fit__stage" style={{ height: box.height ? Math.ceil(box.height * visualScale) + 44 : undefined }}>
          <div
            className="bracket-fit__transform"
            style={{
              width: box.width || undefined,
              transform: visualScale < 0.999 ? `scale(${visualScale})` : undefined,
            }}
          >
            <div className={`bracket-export-wrapper${isExporting ? ' is-exporting' : ''}`} ref={exportRef}>
              <div className="bracket-board" ref={boardRef}>
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
                          <div key={match.id} className="bracket-final">
                            <MatchCard
                              match={match}
                              teamsById={teamsById}
                              side="center"
                              simulationEnabled={simulationEnabled}
                              isActive={activeMatchIds.has(match.id)}
                              isDimmed={Boolean(focusTeamId) && !activeMatchIds.has(match.id)}
                              isFinalCard={match.id === 'M104'}
                              focusId={focusId}
                              registerRef={(node) => {
                                refs.current[match.id] = node
                              }}
                              onPick={onPick}
                              onClear={onClear}
                              onPreview={setPreviewTeamId}
                            />
                            <div className="finale__caption">
                              {match.id === 'M103' ? '3E PLACE / 19 JUL' : 'FINALE / 19 JUL'}
                            </div>
                          </div>
                        )
                      })}

                      <div className={`champ${championTeam ? ' is-set' : ''}`}>
                        <div className="champ__eyebrow">Champion</div>
                        {championTeam ? (
                          <>
                            {flagUrl(championTeam) ? (
                              <img src={flagUrl(championTeam)} alt="" className="champ__flag-image" crossOrigin="anonymous" />
                            ) : (
                              <div className="champ__flag">{championTeam.flagEmoji}</div>
                            )}
                            <div className="champ__name">{championTeam.name}</div>
                            <div className="champ__cap">Le trophee prend forme ici</div>
                          </>
                        ) : (
                          <>
                            <div className="champ__trophy">CUP</div>
                            <div className="champ__cap champ__cap--tbd">Le champion s'affiche ici</div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    column.ids.map((id) => {
                      const match = matchMap.get(id)
                      if (!match) return null

                      return (
                        <MatchCard
                          key={match.id}
                          match={match}
                          teamsById={teamsById}
                          side={column.side}
                          simulationEnabled={simulationEnabled}
                          isActive={activeMatchIds.has(match.id)}
                          isDimmed={Boolean(focusTeamId) && !activeMatchIds.has(match.id)}
                          isFinalCard={false}
                          focusId={focusId}
                          registerRef={(node) => {
                            refs.current[match.id] = node
                          }}
                          onPick={onPick}
                          onClear={onClear}
                          onPreview={setPreviewTeamId}
                          onStandingsHover={column.stage === 'Round of 16' ? (teamId, event) => {
                            if (teamId) setStandingsPopup({ teamId, x: event.clientX, y: event.clientY })
                            else setStandingsPopup(null)
                          } : undefined}
                        />
                      )
                    })
                  )}
                </div>
              </div>
            ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {standingsPopup && (() => {
        const popupTeam = teamsById.get(standingsPopup.teamId)
        if (!popupTeam) return null
        const groupRows = standings[popupTeam.groupId] ?? []
        const teamRow = groupRows.find((r) => r.teamId === standingsPopup.teamId)
        if (!teamRow) return null
        const popupX = Math.min(standingsPopup.x + 12, window.innerWidth - 220)
        const popupY = Math.min(standingsPopup.y - 8, window.innerHeight - 220)
        return (
          <div
            className="standings-popup"
            style={{ left: popupX, top: popupY }}
            onMouseLeave={() => setStandingsPopup(null)}
          >
            <div className="standings-popup__header">
              {flagUrl(popupTeam)
                ? <img src={flagUrl(popupTeam)} alt="" className="standings-popup__flag" crossOrigin="anonymous" />
                : <span className="standings-popup__emoji">{popupTeam.flagEmoji}</span>
              }
              <span className="standings-popup__name">{popupTeam.name}</span>
              <span className="standings-popup__group">Grp {popupTeam.groupId}</span>
            </div>
            <table className="standings-popup__table">
              <thead>
                <tr>
                  <th>J</th><th>G</th><th>N</th><th>P</th><th>+/-</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => {
                  const rowTeam = teamsById.get(row.teamId)
                  return (
                    <tr key={row.teamId} className={row.teamId === standingsPopup.teamId ? 'standings-popup__row--highlight' : ''}>
                      <td>{row.rank}. {rowTeam?.shortName ?? row.teamId}</td>
                      <td>{row.played}</td>
                      <td>{row.wins}</td>
                      <td>{row.draws}</td>
                      <td>{row.losses}</td>
                      <td>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td>
                      <td className="standings-popup__pts">{row.points}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}
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
  const simulatorMode = useMemo(() => new URLSearchParams(window.location.search).has('simulator'), [])
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).has('simulator') ? 'bracket' : 'groups'
  )
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
  const [initialDayModalLoading, setInitialDayModalLoading] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState(() => localDateStr())
  const [menuOpen, setMenuOpen] = useState(false)
  const [matchModalGroupId, setMatchModalGroupId] = useState<string | null>(null)
  const [matchStatsModal, setMatchStatsModal] = useState<{ match: GroupMatch; homeTeam: Team; awayTeam: Team } | null>(null)
  const [matchStatsData, setMatchStatsData] = useState<MatchEventsData | null>(null)
  const [matchStatsLoading, setMatchStatsLoading] = useState(false)
  const [oddsData, setOddsData] = useState<OddsSnapshot | null>(null)
  const dayModalAutoOpenedRef = useRef(false)
  const initialSyncBaselineRef = useRef<string | null>(null)

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
        setInitialDayModalLoading(true)
        initialSyncBaselineRef.current = staticSnapshot?.syncedAt ?? null

        // Then fetch fresh scores from FIFA.com in background
        requestLiveSync().then((liveSnapshot) => {
          if (!active) return
          setLiveSource((current) => mergeLiveSnapshot(current, liveSnapshot))
        }).catch(() => {
          // Sync failed — static data already shown, nothing to do
        })

        // Fetch odds in background (cached 2h at CDN edge)
        fetchOdds().then((odds) => {
          if (!active || !odds) return
          setOddsData(odds)
        }).catch(() => {})

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
    if (!initialDayModalLoading) {
      return
    }

    if (liveSource.syncedAt && liveSource.syncedAt !== initialSyncBaselineRef.current) {
      setInitialDayModalLoading(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setInitialDayModalLoading(false)
    }, 8000)

    return () => window.clearTimeout(timeoutId)
  }, [initialDayModalLoading, liveSource.syncedAt])

  useEffect(() => {
    if (!showDayModal && !matchModalGroupId && !matchStatsModal) return

    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [showDayModal, matchModalGroupId, matchStatsModal])

  useEffect(() => {
    if (!seed || dayModalAutoOpenedRef.current) {
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

    setSelectedDayKey(localDateStr())
    setShowDayModal(true)
    dayModalAutoOpenedRef.current = true
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
  const teamsByFifaCode = new Map(seed.teams.map((team) => [team.fifaCode, team]))
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

  function getMatchOdds(homeId: string, awayId: string): MatchOdds | null {
    if (!oddsData) return null
    return oddsData[`${homeId}-${awayId}`] ?? oddsData[`${awayId}-${homeId}`] ?? null
  }

  async function openMatchStats(match: GroupMatch) {
    const homeTeam = teamsById.get(match.homeTeamId)
    const awayTeam = teamsById.get(match.awayTeamId)
    if (!homeTeam || !awayTeam) return
    setMatchStatsModal({ match, homeTeam, awayTeam })
    setMatchStatsData(null)
    if (match.fifaMatchPath) {
      setMatchStatsLoading(true)
      const stats = await fetchMatchStats(match.fifaMatchPath)
      setMatchStatsData(stats)
      setMatchStatsLoading(false)
    }
  }

  async function refreshMatchStats() {
    if (!matchStatsModal || !matchStatsModal.match.fifaMatchPath) return
    setMatchStatsLoading(true)
    setMatchStatsData(null)
    const stats = await fetchMatchStats(matchStatsModal.match.fifaMatchPath)
    setMatchStatsData(stats)
    setMatchStatsLoading(false)
  }

  function reopenDayModal() {
    setSelectedDayKey(localDateStr())
    setShowDayModal(true)
  }

  return (
    <div className={`app-shell${simulatorMode ? ' is-simulator' : ''}`}>
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

      {showDayModal && (featuredDayMatch || initialDayModalLoading) ? (
        <div className="daymodal" role="dialog" aria-modal="true" aria-labelledby="daymodal-title">
          <div className="daymodal__scrim" onClick={closeDayModal} />
          <div className="daymodal__panel">
            <button type="button" className="daymodal__close" onClick={closeDayModal} aria-label="Fermer">
              ×
            </button>

            {initialDayModalLoading ? (
              <div className="daymodal__loading">
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
                <div className="daymodal__loading-copy">
                  <span className="boot-loader__label">Récupération FIFA</span>
                  <span className="boot-loader__status">Chargement des scores et classements du jour</span>
                </div>
              </div>
            ) : featuredDayMatch ? (
              <>
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
                const heroHasScore = hasRenderableScore(featuredDayMatch)
                const heroFinished = heroStatus === 'finished'
                const heroHomeWin = heroFinished && heroHasScore && featuredDayMatch.homeScore! > featuredDayMatch.awayScore!
                const heroAwayWin = heroFinished && heroHasScore && featuredDayMatch.awayScore! > featuredDayMatch.homeScore!

                return (
                  <div
                    className={`daymatch daymatch--hero daymatch--clickable${heroStatus === 'live' ? ' is-live' : heroStatus === 'scheduled' ? ' is-upcoming' : ''}`}
                    onClick={() => { closeDayModal(); void openMatchStats(featuredDayMatch) }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') { closeDayModal(); void openMatchStats(featuredDayMatch) } }}
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
                        ) : heroHasScore ? (
                          <div className="daymatch__score">
                            <span className={heroHomeWin ? 'is-winner-score' : ''}>{featuredDayMatch.homeScore}</span>
                            <i>:</i>
                            <span className={heroAwayWin ? 'is-winner-score' : ''}>{featuredDayMatch.awayScore}</span>
                          </div>
                        ) : (
                          <ScoreLoading />
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
                const miniHasScore = hasRenderableScore(match)
                const miniFinished = liveStatus === 'finished'
                const miniHomeWin = miniFinished && miniHasScore && match.homeScore! > match.awayScore!
                const miniAwayWin = miniFinished && miniHasScore && match.awayScore! > match.homeScore!

                return (
                  <article
                    key={match.id}
                    className={`daymatch daymatch--clickable${liveStatus === 'live' ? ' is-live' : liveStatus === 'scheduled' ? ' is-upcoming' : ''}`}
                    onClick={() => { closeDayModal(); void openMatchStats(match) }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') { closeDayModal(); void openMatchStats(match) } }}
                  >
                    <div className="daymatch__meta">
                      <span>Groupe {match.groupId}</span>
                      <div className="daymatch__meta-right">
                        <BroadcasterBadge matchId={match.id} />
                        <span>{match.venue}</span>
                      </div>
                    </div>

                    <div className="daymatch__main">
                      <div className={`daymatch__team${miniHomeWin ? ' is-winner' : miniAwayWin ? ' is-loser' : ''}`}>
                        {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{homeTeam.flagEmoji}</span>}
                        <strong>{homeTeam.name}</strong>
                      </div>
                      <div className="daymatch__scoreblock">
                        <div className="daymatch__status">
                          {liveStatus === 'live'
                            ? formatLiveMinute(match.liveMinute, liveSource.syncedAt).toUpperCase()
                            : liveStatus === 'finished' ? 'TERMINÉ' : 'BIENTÔT'}
                        </div>
                        {liveStatus === 'scheduled' && kickoffTime ? (
                          <div className="daymatch__score daymatch__score--time">{kickoffTime}</div>
                        ) : miniHasScore ? (
                          <div className="daymatch__score">
                            <span className={miniHomeWin ? 'is-winner-score' : ''}>{match.homeScore}</span>
                            <i>:</i>
                            <span className={miniAwayWin ? 'is-winner-score' : ''}>{match.awayScore}</span>
                          </div>
                        ) : (
                          <ScoreLoading />
                        )}
                      </div>
                      <div className={`daymatch__team daymatch__team--right${miniAwayWin ? ' is-winner' : miniHomeWin ? ' is-loser' : ''}`}>
                        <strong>{awayTeam.name}</strong>
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
                  </article>
                )
              })}
            </div>
              </>
            ) : null}
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
                    <div
                      key={match.id}
                      className={`gmrow${isLive ? ' is-live' : ''}${isMatchToday(match) ? ' is-today' : ''}${isDone || isLive ? ' is-clickable' : ''}`}
                      onClick={isDone || isLive ? () => void openMatchStats(match) : undefined}
                      style={isDone || isLive ? { cursor: 'pointer' } : undefined}
                    >

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
        {simulatorMode ? null : (
        <div className="seg">
          <button type="button" className={`seg__btn${view === 'groups' ? ' is-active' : ''}`} onClick={() => setView('groups')}>
            ▦ Groupes
          </button>
          <button type="button" className={`seg__btn${view === 'bracket' ? ' is-active' : ''}`} onClick={() => setView('bracket')}>
            🏆 Tableau
          </button>
          <div className={`seg__thumb seg__thumb--${view}`} />
        </div>
        )}

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
              standings={standings}
              onPick={handlePickWinner}
              onClear={handleClearWinner}
              onFocusChange={setFocusId}
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

          {liveSource.topScorers && liveSource.topScorers.length > 0 ? (
            <div className="panel">
              <div className="panel__head">
                <div className="panel__title">Top buteurs</div>
              </div>
              <div className="scorers">
                {liveSource.topScorers.map((scorer, index) => {
                  const team = teamsByFifaCode.get(scorer.teamCode)
                  return (
                    <div key={`${scorer.name}-${scorer.teamCode}`} className={`scorerrow${index === 0 ? ' is-top' : ''}`}>
                      <span className="scorerrow__rank">{index + 1}</span>
                      {team ? (flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>) : null}
                      <span className="scorerrow__name">{scorer.name}</span>
                      <span className="scorerrow__goals"><b>{scorer.goals}</b></span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

        </aside>
      </div>
      {matchStatsModal ? (() => {
        const { match, homeTeam, awayTeam } = matchStatsModal
        const effectiveStatus = inferStatus(match)
        const msHomeWin = effectiveStatus === 'finished' && match.homeScore !== null && match.awayScore !== null && match.homeScore > match.awayScore
        const msAwayWin = effectiveStatus === 'finished' && match.homeScore !== null && match.awayScore !== null && match.awayScore > match.homeScore

        return (
          <div className="statsmodal" role="dialog" aria-modal="true">
            <div className="statsmodal__scrim" onClick={() => setMatchStatsModal(null)} />
            <div className="statsmodal__panel">
              <button type="button" className="statsmodal__close" onClick={() => setMatchStatsModal(null)} aria-label="Fermer">×</button>

              {/* Header */}
              <div className="statsmodal__header">
                <div className={`statsmodal__team${msHomeWin ? ' is-winner' : msAwayWin ? ' is-loser' : ''}`}>
                  {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{homeTeam.flagEmoji}</span>}
                  <span>{homeTeam.name}</span>
                </div>
                <div className="statsmodal__score">
                  <div className="statsmodal__status">
                    {effectiveStatus === 'live' ? formatLiveMinute(match.liveMinute, liveSource.syncedAt).toUpperCase() : effectiveStatus === 'finished' ? 'TERMINÉ' : 'BIENTÔT'}
                  </div>
                  <div className="statsmodal__digits">
                    <span className={msHomeWin ? 'is-winner-score' : ''}>{match.homeScore ?? '–'}</span>
                    <i>:</i>
                    <span className={msAwayWin ? 'is-winner-score' : ''}>{match.awayScore ?? '–'}</span>
                  </div>
                </div>
                <div className={`statsmodal__team statsmodal__team--right${msAwayWin ? ' is-winner' : msHomeWin ? ' is-loser' : ''}`}>
                  <span>{awayTeam.name}</span>
                  {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{awayTeam.flagEmoji}</span>}
                </div>
              </div>

              {/* Odds probability bar */}
              {(() => {
                const odds = getMatchOdds(match.homeTeamId, match.awayTeamId)
                if (!odds) return null
                const swapped = !oddsData![`${match.homeTeamId}-${match.awayTeamId}`]
                const homeProb = swapped ? odds.away.prob : odds.home.prob
                const awayProb = swapped ? odds.home.prob : odds.away.prob
                const drawProb = odds.draw.prob
                const homeOdds = swapped ? odds.away.avgOdds : odds.home.avgOdds
                const awayOdds = swapped ? odds.home.avgOdds : odds.away.avgOdds
                return (
                  <div className="statsmodal__odds">
                    <div className="statsmodal__odds-bar">
                      <div className="statsmodal__odds-seg statsmodal__odds-seg--home" style={{ width: `${homeProb}%` }} />
                      <div className="statsmodal__odds-seg statsmodal__odds-seg--draw" style={{ width: `${drawProb}%` }} />
                      <div className="statsmodal__odds-seg statsmodal__odds-seg--away" style={{ width: `${awayProb}%` }} />
                    </div>
                    <div className="statsmodal__odds-labels">
                      <span className="statsmodal__odds-pct statsmodal__odds-pct--home">
                        <b>{homeProb}%</b>
                        <span>{homeOdds.toFixed(2)}</span>
                      </span>
                      <span className="statsmodal__odds-pct statsmodal__odds-pct--draw">
                        <b>{drawProb}%</b>
                        <span>X {odds.draw.avgOdds.toFixed(2)}</span>
                      </span>
                      <span className="statsmodal__odds-pct statsmodal__odds-pct--away">
                        <b>{awayProb}%</b>
                        <span>{awayOdds.toFixed(2)}</span>
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Body */}
              <div className="statsmodal__body">
                {matchStatsLoading ? (
                  <div className="statsmodal__loading">
                    <svg className="boot-loader__mark" style={{ width: 64, height: 64 }} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <circle className="boot-loader__orbit boot-loader__orbit--outer" cx="60" cy="60" r="50" />
                      <circle className="boot-loader__orbit boot-loader__orbit--inner" cx="60" cy="60" r="39" />
                      <g className="boot-loader__ball">
                        <circle cx="60" cy="60" r="24" fill="#eef3ff" />
                        <polygon points="60,45 71,53 67,67 53,67 49,53" fill="#0a1020" />
                        <path d="M60 45 60 36M71 53 80 49M67 67 73 76M53 67 47 76M49 53 40 49" stroke="#0a1020" strokeWidth="3" strokeLinecap="round" />
                        <path d="M60 36A24 24 0 0 1 80 49M73 76A24 24 0 0 1 47 76M40 49A24 24 0 0 1 60 36" stroke="#0a1020" strokeWidth="3" fill="none" />
                      </g>
                    </svg>
                    <span className="boot-loader__label" style={{ fontSize: 11 }}>Chargement des stats</span>
                  </div>
                ) : !match.fifaMatchPath ? (
                  <div className="statsmodal__empty">Stats disponibles après synchronisation.</div>
                ) : !matchStatsData ? (
                  <div className="statsmodal__empty">
                    <div>Stats indisponibles pour ce match.</div>
                    <button type="button" className="statsmodal__refresh-btn" onClick={() => void refreshMatchStats()}>Réessayer</button>
                  </div>
                ) : (
                  <>
                    {/* Match stats table */}
                    {matchStatsData.stats ? (() => {
                      const s = matchStatsData.stats
                      const rows: Array<{ label: string; home: number; away: number }> = [
                        { label: 'Tirs', home: s.home.shots, away: s.away.shots },
                        { label: 'Corners', home: s.home.corners, away: s.away.corners },
                        { label: 'Fautes', home: s.home.fouls, away: s.away.fouls },
                        { label: 'Jaunes', home: s.home.yellowCards, away: s.away.yellowCards },
                        { label: 'Rouges', home: s.home.redCards, away: s.away.redCards },
                      ].filter(r => r.home > 0 || r.away > 0)
                      if (!rows.length) return null
                      return (
                        <div className="statsmodal__statstable">
                          {rows.map((r, i) => (
                            <div key={i} className="statsmodal__statsrow">
                              <span className="statsmodal__statsval statsmodal__statsval--home">{r.home}</span>
                              <span className="statsmodal__statslabel">{r.label}</span>
                              <span className="statsmodal__statsval statsmodal__statsval--away">{r.away}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })() : null}

                    {/* Goals */}
                    {matchStatsData.goals.length > 0 ? (
                      <div className="statsmodal__goals-section">
                        <div className="statsmodal__scorers-title">Buts</div>
                        {matchStatsData.goals.map((g, i) => {
                          const isHome = g.team === (matchStatsData.home.code ?? homeTeam.fifaCode)
                          return (
                            <div key={i} className={`statsmodal__scorer statsmodal__scorer--${isHome ? 'home' : 'away'}`}>
                              {isHome ? (
                                <>
                                  <span className="statsmodal__scorer-name">⚽ {g.name}</span>
                                  <span className="statsmodal__scorer-min">{g.minute}</span>
                                  <span />
                                </>
                              ) : (
                                <>
                                  <span />
                                  <span className="statsmodal__scorer-min">{g.minute}</span>
                                  <span className="statsmodal__scorer-name statsmodal__scorer-name--away">⚽ {g.name}</span>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}

                    {/* Home lineup */}
                    <div className="statsmodal__lineup">
                      <div className="statsmodal__scorers-title">
                        {matchStatsData.home.code ?? homeTeam.fifaCode}
                        {matchStatsData.home.tactics ? <span className="statsmodal__lineup-tactics">{matchStatsData.home.tactics}</span> : null}
                      </div>
                      {matchStatsData.home.coach ? (
                        <div className="statsmodal__player" style={{ opacity: 0.6, fontSize: 11 }}>Coach · {matchStatsData.home.coach}</div>
                      ) : null}
                      {matchStatsData.home.players.filter(p => p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">TITULAIRES</div>
                          {matchStatsData.home.players.filter(p => p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      {matchStatsData.home.players.filter(p => !p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">REMPLAÇANTS</div>
                          {matchStatsData.home.players.filter(p => !p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>

                    {/* Away lineup */}
                    <div className="statsmodal__lineup">
                      <div className="statsmodal__scorers-title">
                        {matchStatsData.away.code ?? awayTeam.fifaCode}
                        {matchStatsData.away.tactics ? <span className="statsmodal__lineup-tactics">{matchStatsData.away.tactics}</span> : null}
                      </div>
                      {matchStatsData.away.coach ? (
                        <div className="statsmodal__player" style={{ opacity: 0.6, fontSize: 11 }}>Coach · {matchStatsData.away.coach}</div>
                      ) : null}
                      {matchStatsData.away.players.filter(p => p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">TITULAIRES</div>
                          {matchStatsData.away.players.filter(p => p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      {matchStatsData.away.players.filter(p => !p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">REMPLAÇANTS</div>
                          {matchStatsData.away.players.filter(p => !p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>

                    {/* Attendance */}
                    {matchStatsData.attendance ? (
                      <div className="statsmodal__player" style={{ opacity: 0.55, fontSize: 11, marginTop: 8 }}>
                        Affluence · {Number(matchStatsData.attendance).toLocaleString('fr-FR')}
                      </div>
                    ) : null}

                    {/* Empty state */}
                    {matchStatsData.goals.length === 0 && matchStatsData.home.players.length === 0 && matchStatsData.away.players.length === 0 ? (
                      <div className="statsmodal__empty" style={{ fontSize: 12 }}>
                        Données non disponibles — le moteur FIFA charge les données en direct.
                        <br />
                        <button type="button" className="statsmodal__refresh-btn" style={{ marginTop: 10 }} onClick={() => void refreshMatchStats()}>↻ Actualiser</button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div className="statsmodal__foot">
                <span>Groupe {match.groupId} · {match.venue}</span>
                {match.fifaMatchPath && !matchStatsLoading ? (
                  <button type="button" className="statsmodal__refresh-btn" onClick={() => void refreshMatchStats()} title="Actualiser les stats">↻</button>
                ) : null}
              </div>
            </div>
          </div>
        )
      })() : null}
    </div>
  )
}

export default App
