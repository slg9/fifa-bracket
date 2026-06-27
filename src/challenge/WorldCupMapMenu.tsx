import { useEffect, useMemo, useRef, useState } from 'react'
import { sfx } from '../lib/sfx'
import type { KnockoutMatch, Team } from '../types'

export interface WorldCupMapMenuProps {
  matches: KnockoutMatch[]
  teamsById: Map<string, Team>
  picks: Record<string, string>
  scores?: Record<string, { p: number; o: number }>
  realResults?: Record<string, string>
  onPick: (matchId: string, teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
  onSimulate?: (matchId: string) => void
  onShowBracket?: () => void
  onSave?: () => void
}

type NodeStatus = 'locked' | 'available' | 'completed' | 'live'

type DisplayNode = {
  id: string
  matchNumber: number
  roundLabel: string
  roundShort: string
  isFinalBoss: boolean
  isThirdPlace: boolean
  x: number
  y: number
  match: KnockoutMatch
  status: NodeStatus
  homeTeam?: Team
  awayTeam?: Team
  pickedTeamId?: string
  realWinnerTeamId?: string
  predictionState?: 'correct' | 'wrong'
}

type BattleScore = { p: number; o: number }
type DisplayScore = { home: number; away: number }

const MAP_HEIGHT = 2600
const ROUTE_Y_START = 2450
const ROUTE_Y_END = 180

const ROUTE_X = [
  22, 72, 34, 80,
  20, 66, 38, 80,
  28, 74, 20, 62,
  36, 80, 26, 70,

  20, 58, 80, 42,
  72, 24, 64, 34,

  78, 30, 68, 22,

  40, 74,
  56,
  50,
]

const MATCH_SEQUENCE = [
  'M73', 'M74', 'M75', 'M76',
  'M77', 'M78', 'M79', 'M80',
  'M81', 'M82', 'M83', 'M84',
  'M85', 'M86', 'M87', 'M88',
  'M89', 'M90', 'M91', 'M92',
  'M93', 'M94', 'M95', 'M96',
  'M97', 'M98', 'M99', 'M100',
  'M101', 'M102', 'M103', 'M104',
]

const NODE_POS: Record<string, { x: number; y: number }> = Object.fromEntries(
  MATCH_SEQUENCE.map((id, index) => {
    const t = index / (MATCH_SEQUENCE.length - 1)
    const y = Math.round(ROUTE_Y_START - t * (ROUTE_Y_START - ROUTE_Y_END))
    return [id, { x: ROUTE_X[index] ?? 50, y }]
  }),
) as Record<string, { x: number; y: number }>

const ZONE_BANNERS = [
  { label: '16ES DE FINALE', y: 2380 },
  { label: '8ES DE FINALE', y: 1740 },
  { label: 'QUARTS DE FINALE', y: 1170 },
  { label: 'DEMI-FINALES', y: 700 },
  { label: 'FINALE', y: 390 },
]

const ROUND_LONG: Record<string, string> = {
  'Round of 32': '16e de finale',
  'Round of 16': '8e de finale',
  'Quarter-final': 'Quart de finale',
  'Semi-final': 'Demi-finale',
  Finale: 'Finale',
}

const ROUND_SHORT: Record<string, string> = {
  'Round of 32': '16e',
  'Round of 16': '8e',
  'Quarter-final': 'QF',
  'Semi-final': 'SF',
  Finale: 'FINALE',
}

function getRoundLabel(match: KnockoutMatch) {
  if (match.id === 'M103') return '3e place'
  return ROUND_LONG[match.stage] ?? match.stage
}

function getRoundShort(match: KnockoutMatch) {
  if (match.id === 'M103') return '3E'
  if (match.id === 'M104') return 'FINALE'
  return ROUND_SHORT[match.stage] ?? match.stage
}

function getStatusHint(status: NodeStatus) {
  switch (status) {
    case 'completed':
      return 'Choix enregistré — tu peux rejouer.'
    case 'live':
      return 'Ce match est le prochain à jouer.'
    case 'available':
      return 'Choisis ton équipe et lance le match.'
    default:
      return 'Termine les matchs précédents pour débloquer.'
  }
}

function entrantTeam(match: KnockoutMatch, side: 'home' | 'away', teamsById: Map<string, Team>) {
  const entrant = match[side]
  return entrant.kind === 'team' ? teamsById.get(entrant.teamId) : undefined
}

function displayTeamName(team?: Team, fallback?: string) {
  if (team) return team.shortName || team.name
  return fallback ?? 'À déterminer'
}

function teamFlagImageUrl(team?: Team) {
  if (!team) return null
  return `https://flagcdn.com/w80/${team.iso2}.png`
}

function scoreForNode(node: DisplayNode, score?: BattleScore): DisplayScore | null {
  if (!score || !node.pickedTeamId || !node.homeTeam || !node.awayTeam) return null
  const pickedHome = node.pickedTeamId === node.homeTeam.id
  return pickedHome
    ? { home: score.p, away: score.o }
    : { home: score.o, away: score.p }
}

function matchDateFromLabel(dateLabel: string) {
  const parsed = dateLabel.match(/(\d{1,2})\s+([A-Za-z]+)/)
  if (!parsed) return null
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }
  const month = months[parsed[2]]
  if (month == null) return null
  return new Date(2026, month, Number(parsed[1]), 12)
}

function isMatchDayOrPast(match: KnockoutMatch) {
  const date = matchDateFromLabel(match.dateLabel)
  if (!date) return false
  const today = new Date()
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const matchKey = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return todayKey >= matchKey
}

function buildDisplayNodes(
  matches: KnockoutMatch[],
  teamsById: Map<string, Team>,
  picks: Record<string, string>,
  realResults: Record<string, string>,
): DisplayNode[] {
  const resolved = matches.map((match) => ({
    match,
    homeTeam: entrantTeam(match, 'home', teamsById),
    awayTeam: entrantTeam(match, 'away', teamsById),
    pickedTeamId: picks[match.id],
  }))

  const firstPlayable = resolved.find((entry) => !entry.pickedTeamId && entry.homeTeam && entry.awayTeam)?.match.id

  return resolved.map(({ match, homeTeam, awayTeam, pickedTeamId }) => {
    const pos = NODE_POS[match.id]
    const realWinnerTeamId = realResults[match.id]
    const isUnlockedByDate = homeTeam && awayTeam && isMatchDayOrPast(match)
    const status: NodeStatus = pickedTeamId
      ? 'completed'
      : homeTeam && awayTeam && (match.id === firstPlayable || isUnlockedByDate)
        ? 'live'
        : 'locked'

    return {
      id: match.id,
      matchNumber: Number(match.id.replace('M', '')),
      roundLabel: getRoundLabel(match),
      roundShort: getRoundShort(match),
      isFinalBoss: match.id === 'M104',
      isThirdPlace: match.id === 'M103',
      x: pos?.x ?? 50,
      y: pos?.y ?? 0,
      match,
      status,
      homeTeam,
      awayTeam,
      pickedTeamId,
      realWinnerTeamId,
      predictionState: pickedTeamId && realWinnerTeamId ? pickedTeamId === realWinnerTeamId ? 'correct' : 'wrong' : undefined,
    }
  })
}

function MapPathSvg({ nodes }: { nodes: DisplayNode[] }) {
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  return (
    <svg
      className="wcmap__paths"
      viewBox={`0 0 1000 ${MAP_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {MATCH_SEQUENCE.slice(1).map((id, index) => {
        const from = byId.get(MATCH_SEQUENCE[index])
        const to = byId.get(id)
        if (!from || !to) return null

        const fx = from.x * 10
        const fy = from.y
        const tx = to.x * 10
        const ty = to.y
        const dx = tx - fx
        const direction = dx >= 0 ? 1 : -1
        const bend = Math.max(10, Math.min(22, Math.abs(dx) * 0.36 + 8))
        const cp1x = fx + dx * 0.24 + direction * bend
        const cp1y = fy - 62
        const cp2x = tx - dx * 0.24 - direction * bend * 0.7
        const cp2y = ty + 62
        const pathDef = `M ${fx} ${fy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`
        const isActive = to.status !== 'locked'

        return (
          <path
            key={`${MATCH_SEQUENCE[index]}-${id}`}
            className={`wcmap__path${isActive ? ' is-active' : ''}`}
            d={pathDef}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

function MatchNode({
  node,
  selecting,
  score,
  onClick,
}: {
  node: DisplayNode
  selecting: boolean
  score?: BattleScore
  onClick: () => void
}) {
  const isLocked = node.status === 'locked'
  const isCompleted = node.status === 'completed'
  const isLive = node.status === 'live'
  const winnerTeam = isCompleted && node.pickedTeamId
    ? node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam
    : undefined
  const loserTeam = isCompleted && node.pickedTeamId
    ? node.pickedTeamId === node.homeTeam?.id ? node.awayTeam : node.homeTeam
    : undefined
  const displayScore = scoreForNode(node, score)
  const realWinnerTeam = node.pickedTeamId && node.realWinnerTeamId
    ? node.realWinnerTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam
    : undefined

  return (
    <button
      type="button"
      data-node-id={node.id}
      className={[
        'wcmap__field-node',
        `is-${node.status}`,
        node.isFinalBoss ? 'is-final' : '',
        node.isThirdPlace ? 'is-third' : '',
        selecting ? 'is-selecting' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: `${node.x}%`, top: `${node.y}px` }}
      onClick={onClick}
    >
      <div className="wcmap__field-panel">
        <span className="wcmap__match-number">M{node.matchNumber}</span>

        {!isLocked ? (
          displayScore ? (
            <span className="wcmap__score-badge" aria-label={`Score ${displayScore.home} a ${displayScore.away}`}>
              <strong>{displayScore.home}</strong>
              <em>-</em>
              <strong>{displayScore.away}</strong>
            </span>
          ) : (
            <span className="wcmap__flags-vs">
              <span>{node.homeTeam?.flagEmoji ?? ''}</span>
              <strong>VS</strong>
              <span>{node.awayTeam?.flagEmoji ?? ''}</span>
            </span>
          )
        ) : (
          <span className="wcmap__locked-label">VERROUILLE</span>
        )}
      </div>

      <div className="wcmap__mini-field">
        <div className="wcmap__pitch-line wcmap__pitch-line--mid" />
        <div className="wcmap__pitch-circle" />
        <div className="wcmap__goal wcmap__goal--top" />
        <div className="wcmap__goal wcmap__goal--bottom" />

        {winnerTeam && loserTeam ? (
          <span className="wcmap__result-matchup" aria-label={`Vainqueur ${winnerTeam.name}, perdant ${loserTeam.name}`}>
            <span className="wcmap__result-flag wcmap__result-flag--winner">
              {teamFlagImageUrl(winnerTeam) ? (
                <img src={teamFlagImageUrl(winnerTeam) ?? undefined} alt="" />
              ) : (
                <span>{winnerTeam.flagEmoji}</span>
              )}
            </span>
            <span className="wcmap__result-flag wcmap__result-flag--loser">
              {teamFlagImageUrl(loserTeam) ? (
                <img src={teamFlagImageUrl(loserTeam) ?? undefined} alt="" />
              ) : (
                <span>{loserTeam.flagEmoji}</span>
              )}
            </span>
          </span>
        ) : null}

        {isLive && node.homeTeam && node.awayTeam ? (
          <span className="wcmap__live-matchup" aria-hidden="true">
            {teamFlagImageUrl(node.homeTeam) ? <img src={teamFlagImageUrl(node.homeTeam) ?? undefined} alt="" /> : <span>{node.homeTeam.flagEmoji}</span>}
            <strong>VS</strong>
            {teamFlagImageUrl(node.awayTeam) ? <img src={teamFlagImageUrl(node.awayTeam) ?? undefined} alt="" /> : <span>{node.awayTeam.flagEmoji}</span>}
          </span>
        ) : null}
      </div>

      <span className="wcmap__round-chip">{node.roundShort}</span>

      {isLocked && <span className="wcmap__status-badge wcmap__status-badge--lock">{'\uD83D\uDD12'}</span>}
      {isCompleted && <span className="wcmap__status-badge">{'\u2713'}</span>}
      {node.match.qualificationStatus ? (
        <span className={`wcmap__qualification-badge is-${node.match.qualificationStatus}`}>
          {node.match.qualificationStatus === 'confirmed' ? 'SUR' : 'CALC'}
        </span>
      ) : null}
      {node.predictionState ? <span className={`wcmap__prediction-dot is-${node.predictionState}`} title={node.predictionState === 'correct' ? 'Prono réussi' : 'Prono raté'} /> : null}
      {realWinnerTeam ? <span className="wcmap__official-winner" title={`Vrai vainqueur: ${realWinnerTeam.name}`}>{realWinnerTeam.flagEmoji}</span> : null}
      {isLive && <span className="wcmap__live-dot" />}
    </button>
  )
}

function LevelEntryScreen({
  node,
  selectedTeamId,
  score,
  open,
  canShare: _canShare,
  canShowBracket: _canShowBracket,
  onClose,
  onPickTeam,
  onPlay,
  onSimulate,
  onShowBracket: _onShowBracket,
  onShare: _onShare,
}: {
  node: DisplayNode | null
  selectedTeamId: string | null
  score?: BattleScore
  open: boolean
  canShare: boolean
  canShowBracket: boolean
  onClose: () => void
  onPickTeam: (teamId: string) => void
  onPlay: () => void
  onSimulate?: () => void
  onShowBracket?: () => void
  onShare?: () => void
}) {
  if (!open || !node) return null

  const canPlay = Boolean(node.homeTeam && node.awayTeam && selectedTeamId)
  const canSimulate = Boolean(node.homeTeam && node.awayTeam && onSimulate)
  const displayScore = scoreForNode(node, score)

  return (
    <div className="wcmap-entry" role="dialog" aria-modal="true">
      <button type="button" className="wcmap-entry__scrim" onClick={onClose} aria-label="Fermer" />
      <aside className={`wcmap-entry__panel${node.isFinalBoss ? ' is-final' : ''}`}>
        <div className="wcmap-entry__grab" />

        <div className="wcmap-entry__header">
          <div className="wcmap-entry__badge">{node.roundLabel.toUpperCase()}</div>
          {node.match.qualificationStatus ? (
            <div className={`wcmap-entry__qbadge is-${node.match.qualificationStatus}`}>
              {node.match.qualificationStatus === 'confirmed' ? '16e confirme' : '16e projete'}
            </div>
          ) : null}
          <div className="wcmap-entry__match-num">Match {node.matchNumber}</div>
          <button type="button" className="wcmap-entry__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {node.status !== 'completed' && (
          <p className="wcmap-entry__hint">{getStatusHint(node.status)}</p>
        )}

        {node.status === 'completed' && node.pickedTeamId ? (
          <div className="wcmap-entry__result">
            <div className="wcmap-entry__result-winner">
              <span className="wcmap-entry__result-flag">
                {(node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam)?.flagEmoji ?? '🌍'}
              </span>
              <div>
                <small className="wcmap-entry__result-label">VAINQUEUR</small>
                <strong className="wcmap-entry__result-name">
                  {(node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam)?.name ?? node.pickedTeamId}
                </strong>
              </div>
            </div>
            {displayScore ? (
              <div className="wcmap-entry__result-score">
                <span>{node.homeTeam?.flagEmoji ?? '??'}</span>
                <strong>{displayScore.home} - {displayScore.away}</strong>
                <span>{node.awayTeam?.flagEmoji ?? '??'}</span>
              </div>
            ) : (
              <div className="wcmap-entry__result-vs">
                <span>{node.homeTeam?.flagEmoji ?? '🌍'} {displayTeamName(node.homeTeam)}</span>
                <em>vs</em>
                <span>{displayTeamName(node.awayTeam)} {node.awayTeam?.flagEmoji ?? '🌍'}</span>
              </div>
            )}
          </div>
        ) : null}

        <button
          type="button"
          className="wcmap-entry__simulate"
          onClick={onSimulate}
          disabled={!canSimulate}
        >
          Simuler le match
        </button>

        <div className="wcmap-entry__teams">
            <button
              type="button"
              className={`wcmap-entry__team${selectedTeamId === node.homeTeam?.id ? ' is-selected' : ''}`}
              onClick={() => node.homeTeam && onPickTeam(node.homeTeam.id)}
              disabled={!node.homeTeam}
            >
              <span className="wcmap-entry__team-flag">
                {teamFlagImageUrl(node.homeTeam) ? <img src={teamFlagImageUrl(node.homeTeam) ?? undefined} alt="" /> : <span>{node.homeTeam?.flagEmoji ?? '🌍'}</span>}
              </span>
              <strong>{displayTeamName(node.homeTeam, node.match.home.kind === 'placeholder' ? node.match.home.label : undefined)}</strong>
              <small>{node.homeTeam?.name ?? 'En attente'}</small>
            </button>
            <div className="wcmap-entry__vs">VS</div>
            <button
              type="button"
              className={`wcmap-entry__team${selectedTeamId === node.awayTeam?.id ? ' is-selected' : ''}`}
              onClick={() => node.awayTeam && onPickTeam(node.awayTeam.id)}
              disabled={!node.awayTeam}
            >
              <span className="wcmap-entry__team-flag">
                {teamFlagImageUrl(node.awayTeam) ? <img src={teamFlagImageUrl(node.awayTeam) ?? undefined} alt="" /> : <span>{node.awayTeam?.flagEmoji ?? '🌍'}</span>}
              </span>
              <strong>{displayTeamName(node.awayTeam, node.match.away.kind === 'placeholder' ? node.match.away.label : undefined)}</strong>
              <small>{node.awayTeam?.name ?? 'En attente'}</small>
            </button>
          </div>

        <div className="wcmap-entry__actions">
          <button
            type="button"
            className="wcmap-entry__play"
            onClick={onPlay}
            disabled={!canPlay}
          >
            {node.status === 'completed'
              ? 'Rejouer avec ce camp'
              : node.isFinalBoss ? 'Jouer la finale' : 'Jouer ce match'}
          </button>
        </div>
      </aside>
    </div>
  )
}

export function WorldCupMapMenu({
  matches,
  teamsById,
  picks,
  scores = {},
  realResults = {},
  onPick: _onPick,
  onPlay,
  onSimulate,
  onShowBracket,
  onSave,
}: WorldCupMapMenuProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panFocusRef = useRef<string | null>(null)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number; lastY: number; lastT: number; vy: number } | null>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const momentumRef = useRef<number | null>(null)
  const panAnimRef = useRef<number | null>(null)
  const dragDistRef = useRef(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const nodes = useMemo(() => buildDisplayNodes(matches, teamsById, picks, realResults), [matches, teamsById, picks, realResults])
  const focusNode = nodes.find((node) => node.status === 'live') ?? nodes.find((node) => node.status === 'available') ?? null
  const selectedNode = nodes.find((node) => node.id === selectedMatchId) ?? null

  const setPanOffset = (next: { x: number; y: number }) => {
    offsetRef.current = next
    setOffset(next)
  }

  const clampPanY = (y: number) => {
    const viewportHeight = viewportRef.current?.clientHeight ?? 0
    const maxPan = Math.max(0, MAP_HEIGHT - viewportHeight)
    return Math.max(-maxPan, Math.min(0, y))
  }

  const stopPanMotion = () => {
    if (momentumRef.current !== null) {
      cancelAnimationFrame(momentumRef.current)
      momentumRef.current = null
    }
    if (panAnimRef.current !== null) {
      cancelAnimationFrame(panAnimRef.current)
      panAnimRef.current = null
    }
  }

  const animatePanTo = (targetY: number, duration = 620) => {
    stopPanMotion()
    const startY = offsetRef.current.y
    const clampedTarget = clampPanY(targetY)
    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setPanOffset({ x: 0, y: startY + (clampedTarget - startY) * eased })
      if (progress < 1) {
        panAnimRef.current = requestAnimationFrame(tick)
      } else {
        panAnimRef.current = null
      }
    }

    panAnimRef.current = requestAnimationFrame(tick)
  }

  const startMomentum = (velocityY: number) => {
    if (Math.abs(velocityY) < 0.04) return
    let previous = performance.now()
    let velocity = velocityY

    const tick = (now: number) => {
      const elapsed = Math.min(32, now - previous)
      previous = now
      const currentY = offsetRef.current.y
      const nextY = clampPanY(currentY + velocity * elapsed)
      setPanOffset({ x: 0, y: nextY })

      if (nextY !== currentY + velocity * elapsed) {
        velocity *= 0.35
      }
      velocity *= Math.pow(0.94, elapsed / 16.67)

      if (Math.abs(velocity) > 0.02) {
        momentumRef.current = requestAnimationFrame(tick)
      } else {
        momentumRef.current = null
      }
    }

    momentumRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (!selectedNode) return
    setSelectedTeamId(selectedNode.status === 'completed' ? null : selectedNode.pickedTeamId ?? null)
  }, [selectedNode])

  useEffect(() => {
    if (!focusNode || !viewportRef.current || panFocusRef.current === focusNode.id) return
    panFocusRef.current = focusNode.id
    const viewportHeight = viewportRef.current.clientHeight
    const maxPan = Math.max(0, MAP_HEIGHT - viewportHeight)
    const targetOffset = -(focusNode.y - viewportHeight * 0.5)
    animatePanTo(Math.max(-maxPan, Math.min(0, targetOffset)), 720)
  }, [focusNode])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    stopPanMotion()

    // Vérifie si le clic a ciblé un bouton MatchNode
    const target = event.target as HTMLElement;
    const nodeButton = target.closest('.wcmap__field-node');

    if (nodeButton) {
      // Clic sur un match → ne pas capturer, laisser le onClick du bouton agir
      dragRef.current = null;
      dragDistRef.current = 0;
      return;
    }

    // Clic ailleurs (viewport) → activer le drag
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      px: event.clientX,
      py: event.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
      lastY: event.clientY,
      lastT: performance.now(),
      vy: 0,
    };
    dragDistRef.current = 0;
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !viewportRef.current) return
    event.preventDefault()
    const deltaY = event.clientY - dragRef.current.py
    const deltaX = event.clientX - dragRef.current.px
    dragDistRef.current = Math.max(dragDistRef.current, Math.hypot(deltaX, deltaY))
    const now = performance.now()
    const dt = Math.max(1, now - dragRef.current.lastT)
    dragRef.current.vy = (event.clientY - dragRef.current.lastY) / dt
    dragRef.current.lastY = event.clientY
    dragRef.current.lastT = now
    const nextY = clampPanY(dragRef.current.oy + deltaY)
    setPanOffset({ x: 0, y: nextY })
  }

  const handlePointerUp = () => {
    const velocityY = dragRef.current?.vy ?? 0
    dragRef.current = null
    startMomentum(velocityY)
  }

  useEffect(() => () => stopPanMotion(), [])

  useEffect(() => {
    if (!notice) return
    const timeoutId = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const handleSelectNode = (node: DisplayNode) => {
    if (dragDistRef.current > 8) {
      dragDistRef.current = 0
      return
    }
    dragDistRef.current = 0
    if (node.status === 'locked') {
      setNotice('Match verrouillé. Termine le match qui clignote pour débloquer la suite.')
      return
    }
    sfx.tab()
    setSelectingId(node.id)
    setSelectedMatchId(node.id)
    setSelectedTeamId(node.status === 'completed' ? null : node.pickedTeamId ?? null)
    window.setTimeout(() => setSelectingId(null), 220)
  }

  const handlePickTeam = (teamId: string) => {
    if (!selectedNode) return
    sfx.pick()
    setSelectedTeamId(teamId)
  }

  const handlePlay = () => {
    if (!selectedNode) return
    const chosenTeamId = selectedTeamId
    if (!chosenTeamId) {
      setNotice('Choisis ton camp avant de jouer.')
      return
    }
    sfx.battle()
    onPlay(selectedNode.id, chosenTeamId)
  }

  const handleSimulate = () => {
    if (!selectedNode) return
    sfx.click()
    onSimulate?.(selectedNode.id)
  }

  return (
    <section className="wcmap">
      <div
        className="wcmap__viewport"
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="wcmap__canvas"
          style={{ height: `${MAP_HEIGHT}px`, transform: `translateY(${offset.y}px)` }}
        >
          <MapPathSvg nodes={nodes} />

          {ZONE_BANNERS.map((banner) => (
            <div key={banner.label} className="wcmap__marker" style={{ top: `${banner.y}px` }}>
              <span>{banner.label}</span>
            </div>
          ))}

          {nodes.map((node) => (
            <MatchNode
              key={node.id}
              node={node}
              selecting={selectingId === node.id}
              score={scores[node.id]}
              onClick={() => handleSelectNode(node)}
            />
          ))}
        </div>
      </div>

      <div className={`wcmap__notice${notice ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {notice}
      </div>

      <LevelEntryScreen
        node={selectedNode}
        selectedTeamId={selectedTeamId}
        score={selectedNode ? scores[selectedNode.id] : undefined}
        open={Boolean(selectedNode)}
        canShare={Boolean(onSave)}
        canShowBracket={Boolean(onShowBracket)}
        onClose={() => setSelectedMatchId(null)}
        onPickTeam={handlePickTeam}
        onPlay={handlePlay}
        onSimulate={onSimulate ? handleSimulate : undefined}
        onShowBracket={onShowBracket}
        onShare={onSave}
      />
    </section>
  )
}

export default WorldCupMapMenu
