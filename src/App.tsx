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
  KnockoutEntrant,
  MatchOverride,
  Mode,
  Team,
  TournamentSeed,
} from './types'

type View = 'groups' | 'bracket'

type LiveState = {
  syncedAt: string | null
  source: string
  warnings: string[]
  matches: Array<{ id: string; homeScore: number | null; awayScore: number | null; status: GroupMatch['status']; kickoffTime?: string | null }>
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

const venueUtcOffsetBySeedVenue: Record<string, string> = {
  'Mexico City Stadium': '-06:00',
  'Estadio Guadalajara': '-06:00',
  'Estadio Monterrey': '-06:00',
  'Toronto Stadium': '-04:00',
  'San Francisco Bay Area Stadium': '-07:00',
  'Los Angeles Stadium': '-07:00',
  'BC Place Vancouver': '-07:00',
  'Boston Stadium': '-04:00',
  'New York New Jersey Stadium': '-04:00',
  'Philadelphia Stadium': '-04:00',
  'Atlanta Stadium': '-04:00',
  'Miami Stadium': '-04:00',
  'Houston Stadium': '-05:00',
  'Dallas Stadium': '-05:00',
  'Kansas City Stadium': '-05:00',
  'Seattle Stadium': '-07:00',
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00Z`))
}

function isToday(date: string): boolean {
  const now = new Date()
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')

  return date === `${year}-${month}-${day}`
}

function formatKickoff(match: GroupMatch): { label: string; tooltip?: string } {
  if (!match.kickoffTime) {
    return { label: formatDate(match.kickoffDate) }
  }

  const venueOffset = venueUtcOffsetBySeedVenue[match.venue]
  if (!venueOffset) {
    return { label: `${formatDate(match.kickoffDate)} ? ${match.kickoffTime}` }
  }

  const localInstant = new Date(`${match.kickoffDate}T${match.kickoffTime}:00${venueOffset}`)
  const formatted = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(localInstant)

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    label: formatted,
    tooltip: `Heure locale du visiteur ? ${timeZone}`, 
  }
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
  const [scale, setScale] = useState(1)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [lines, setLines] = useState<Array<{ id: string; d: string; active: boolean }>>([])

  const matchMap = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches])

  useEffect(() => {
    const fit = () => {
      if (!fitRef.current || !wrapRef.current) {
        return
      }

      const naturalWidth = wrapRef.current.scrollWidth
      const naturalHeight = wrapRef.current.scrollHeight
      const availableWidth = fitRef.current.clientWidth
      const nextScale = naturalWidth > 0 ? Math.min(1, availableWidth / naturalWidth) : 1

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
  }, [matches, picks])

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
  )
}

function App() {
  const [seed, setSeed] = useState<TournamentSeed | null>(null)
  const [liveSource, setLiveSource] = useState<LiveState>({
    syncedAt: null,
    source: 'seed',
    warnings: [],
    matches: [],
  })
  const [mode, setMode] = useState<Mode>('real')
  const [view, setView] = useState<View>('groups')
  const [overrides, setOverrides] = useState<Record<string, MatchOverride>>({})
  const [knockoutPicks, setKnockoutPicks] = useState<Record<string, string>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [dragState, setDragState] = useState<DragState | null>(null)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        const seedData = await loadSeed()

        if (!active) {
          return
        }

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

        try {
          const liveSnapshot = await requestLiveSync()

          if (!active) {
            return
          }

          setLiveSource({
            syncedAt: liveSnapshot.syncedAt,
            source: liveSnapshot.source,
            warnings: liveSnapshot.warnings,
            matches: liveSnapshot.matches,
          })
        } catch {
          const fallbackSnapshot = await loadLiveSnapshot()

          if (!active || !fallbackSnapshot) {
            return
          }

          setLiveSource({
            syncedAt: fallbackSnapshot.syncedAt,
            source: fallbackSnapshot.source,
            warnings: fallbackSnapshot.warnings,
            matches: fallbackSnapshot.matches,
          })
        }
      } catch (caughtError) {
        if (!active) {
          return
        }

        setError(caughtError instanceof Error ? caughtError.message : 'Chargement impossible.')
      } finally {
        if (active) {
          setLoading(false)
        }
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

  async function handleSyncLiveSnapshot() {
    setSyncing(true)
    try {
      const snapshot = await requestLiveSync()
      setLiveSource({
        syncedAt: snapshot.syncedAt,
        source: snapshot.source,
        warnings: snapshot.warnings,
        matches: snapshot.matches,
      })
    } catch (caughtError) {
      setLiveSource((current) => ({
        ...current,
        warnings: [caughtError instanceof Error ? caughtError.message : 'Synchronisation live indisponible.'],
      }))
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <main className="app-shell loading">Chargement du simulateur…</main>
  }

  if (error || !seed) {
    return <main className="app-shell loading">{error ?? 'Aucune donnée disponible.'}</main>
  }

  const teamsById = new Map(seed.teams.map((team) => [team.id, team]))
  const mergedMatches = mergeScores(seed.matches, liveSource.matches, overrides, mode)
  const standings = computeStandings(seed.teams, mergedMatches)
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

  return (
    <div className="app-shell">
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

        <div className="syncbox">
          <button type="button" className={`syncbtn${syncing ? ' is-busy' : ''}`} onClick={handleSyncLiveSnapshot}>
            <span className="syncbtn__ico">{syncing ? '◌' : '⟳'}</span>
            <span>{syncing ? 'Synchronisation…' : 'Synchroniser les résultats'}</span>
          </button>
          <div className="syncmeta">
            <span className={`srcdot srcdot--${mode === 'simulation' ? 'sim' : 'live'}`} />
            {mode === 'simulation' ? 'Simulation locale' : liveSource.source} · {formatSyncTime(liveSource.syncedAt)}
          </div>
        </div>

        <div className="topactions">
          <button type="button" className={`chip-btn${mode === 'real' ? ' is-active' : ''}`} onClick={() => setMode('real')}>
            Réel
          </button>
          <button
            type="button"
            className={`chip-btn${mode === 'simulation' ? ' is-active' : ''}`}
            onClick={() => setMode('simulation')}
          >
            Simulation
          </button>
          {mode === 'simulation' ? (
            <button type="button" className="chip-btn chip-btn--danger" onClick={clearSimulation}>
              Réinitialiser
            </button>
          ) : null}
        </div>
      </header>

      <div className="controls">
        <div className="seg">
          <button type="button" className={`seg__btn${view === 'groups' ? ' is-active' : ''}`} onClick={() => setView('groups')}>
            <span className="seg__icon">▦</span>
            Phase de groupes
          </button>
          <button type="button" className={`seg__btn${view === 'bracket' ? ' is-active' : ''}`} onClick={() => setView('bracket')}>
            <span className="seg__icon">🏆</span>
            Tableau final
          </button>
          <div className={`seg__thumb seg__thumb--${view}`} />
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
        <div className="warning-strip warning-strip--sim">
          <p>Simulation active : glisse les equipes dans un groupe pour generer un classement coherent, ajuste ensuite les scores, puis clique sur une equipe du tableau final pour la faire avancer.</p>
        </div>
      ) : null}

      <div className={`board${view === 'bracket' ? ' board--wide' : ''}`}>
        <main className="board__main">
          {view === 'groups' ? (
            <div className="groups">
              {seed.groups.map((group) => {
                const groupStandings = standings[group.id] ?? []
                const groupMatches = mergedMatches.filter((match) => match.groupId === group.id)

                return (
                  <section key={group.id} className={`gcard${groupMatches.every((match) => match.homeScore !== null && match.awayScore !== null) ? ' is-complete' : ''}`}>
                    <header className="gcard__head">
                      <div className="gcard__badge">{group.id}</div>
                      <div className="gcard__title">Groupe {group.id}</div>
                    </header>

                    <table className="stand">
                      <thead>
                        <tr>
                          <th className="stand__pos">#</th>
                          <th className="stand__team">Équipe</th>
                          <th>J</th>
                          <th>G</th>
                          <th>N</th>
                          <th>P</th>
                          <th>+/-</th>
                          <th className="stand__pts">Pts</th>
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
                                {mode === 'simulation' ? <span className="stand__drag">⋮⋮</span> : null}
                                {flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
                                <span className="stand__name">{team.name}</span>
                                {projectedQualifiedIds.has(team.id) ? <span className="stand__check">✓</span> : null}
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

                    <div className="gcard__matches">
                      {groupMatches.map((match) => {
                        const homeTeam = teamsById.get(match.homeTeamId)
                        const awayTeam = teamsById.get(match.awayTeamId)
                        if (!homeTeam || !awayTeam) return null

                        return (
                          <div key={match.id} className={`mrow${isToday(match.kickoffDate) ? ' mrow--today' : ''}`}>
                            <div className={`mrow__team mrow__team--home${match.homeScore !== null && match.awayScore !== null && (match.homeScore > match.awayScore) ? ' is-win' : ''}`}>
                              <span className="mrow__name" onClick={() => toggleFocus(homeTeam.id)}>{homeTeam.name}</span>
                              {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="flag-image" /> : <span className="flag-emoji">{homeTeam.flagEmoji}</span>}
                            </div>
                            <div className="mrow__score">
                              {mode === 'simulation' ? (
                                <>
                                  <input
                                    type="number"
                                    min="0"
                                    value={overrides[match.id]?.homeScore ?? match.homeScore ?? ''}
                                    onChange={(event) => updateOverride(match.id, 'homeScore', event.target.value)}
                                  />
                                  <span className="mrow__sep">:</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={overrides[match.id]?.awayScore ?? match.awayScore ?? ''}
                                    onChange={(event) => updateOverride(match.id, 'awayScore', event.target.value)}
                                  />
                                </>
                              ) : (
                                <>
                                  <b>{match.homeScore ?? '-'}</b>
                                  <span className="mrow__sep">:</span>
                                  <b>{match.awayScore ?? '-'}</b>
                                </>
                              )}
                            </div>
                            <div className={`mrow__team mrow__team--away${match.homeScore !== null && match.awayScore !== null && (match.awayScore > match.homeScore) ? ' is-win' : ''}`}>
                              {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="flag-image" /> : <span className="flag-emoji">{awayTeam.flagEmoji}</span>}
                              <span className="mrow__name" onClick={() => toggleFocus(awayTeam.id)}>{awayTeam.name}</span>
                            </div>
                            {(() => {
                              const kickoff = formatKickoff(match)
                              return (
                                <div className="mrow__tools" title={kickoff.tooltip}>
                                  {isToday(match.kickoffDate) ? "Aujourd'hui · " : ''}
                                  {kickoff.label}
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })}
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
                <div className="panel__title">Qualifiés projetés</div>
                <div className="panel__sub">Top 2 de chaque groupe + 8 meilleurs 3es</div>
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
