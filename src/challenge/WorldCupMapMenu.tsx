import { useEffect, useMemo, useRef, useState } from 'react'
import { sfx } from '../lib/sfx'
import type { KnockoutMatch, Team } from '../types'
import { evaluateMatchProgress, formatScore, scoreForPick, type BattleScore, type DisplayScore, type MatchProgress, type OfficialScore } from './progress'

export interface WorldCupMapMenuProps {
  matches: KnockoutMatch[]
  teamsById: Map<string, Team>
  picks: Record<string, string>
  scores?: Record<string, { p: number; o: number }>
  realResults?: Record<string, string>
  officialScores?: Record<string, OfficialScore>
  onPick: (matchId: string, teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
  onSimulate?: (matchId: string) => void
  onShowBracket?: () => void
  onSave?: () => void
  autosavedAt?: string | null
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
  progress: MatchProgress
  isNextPlayable: boolean
}

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
      return 'Choix enregistre. Touche une equipe pour rejouer avec ce camp.'
    case 'live':
      return 'Choisis une equipe pour lancer le match.'
    case 'available':
      return 'Choisis une equipe pour lancer le match.'
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

function formatAutosaveTime(value?: string | null) {
  if (!value) return 'Brouillon local'
  return `Sauvé ${new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function teamFlagImageUrl(team?: Team) {
  if (!team) return null
  return `https://flagcdn.com/w80/${team.iso2}.png`
}

function scoreForNode(node: DisplayNode, score?: BattleScore): DisplayScore | null {
  return scoreForPick(node.match, node.pickedTeamId, score)
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
  scores: Record<string, BattleScore>,
  realResults: Record<string, string>,
  officialScores: Record<string, OfficialScore>,
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
    const progress = evaluateMatchProgress(match, picks, scores, realResults, officialScores)
    const isNextPlayable = match.id === firstPlayable
    const isUnlockedByDate = homeTeam && awayTeam && isMatchDayOrPast(match)
    const status: NodeStatus = pickedTeamId
      ? 'completed'
      : homeTeam && awayTeam && isNextPlayable
        ? 'live'
        : homeTeam && awayTeam && isUnlockedByDate
          ? 'available'
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
      progress,
      isNextPlayable,
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
      {node.progress.played && node.progress.realScore ? (
        <span className="wcmap__score-compare">
          R {formatScore(node.progress.realScore)} · J {formatScore(node.progress.playedScore)}
        </span>
      ) : null}

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
      {node.progress.played ? (
        <span className={`wcmap__outcome-badge${node.progress.correct ? ' is-correct' : ' is-wrong'}`} title={node.progress.correct ? `Prono reussi +${node.progress.points}` : 'Prono rate'}>
          {node.progress.correct ? `★ +${node.progress.points}` : '!'}
        </span>
      ) : null}
      {node.progress.exact ? <span className="wcmap__exact-badge" title="Score exact">◎</span> : null}
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
  onSimulate?: () => void
  onShowBracket?: () => void
  onShare?: () => void
}) {
  if (!open || !node) return null

  const canSimulate = Boolean(node.homeTeam && node.awayTeam && onSimulate)
  const displayScore = scoreForNode(node, score)

  return (
    <div className="wcmap-entry" role="dialog" aria-modal="true">
      <button type="button" className="wcmap-entry__scrim" onClick={onClose} aria-label="Fermer" />
      <aside className={`wcmap-entry__panel${node.isFinalBoss ? ' is-final' : ''}`}>
        <div className="wcmap-entry__grab" />

        <div className="wcmap-entry__header">
          <div className="wcmap-entry__badge">{node.roundLabel.toUpperCase()}</div>
          <div className="wcmap-entry__match-num">Match {node.matchNumber}</div>
          <button type="button" className="wcmap-entry__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <p className="wcmap-entry__hint">{getStatusHint(node.status)}</p>

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
            {node.progress.played ? (
              <div className={`wcmap-entry__verdict${node.progress.correct ? ' is-correct' : ' is-wrong'}`}>
                <strong>{node.progress.correct ? `★ Prono reussi +${node.progress.points}` : '! Prono rate'}</strong>
                <span>Reel {formatScore(node.progress.realScore)} · Ton jeu {formatScore(node.progress.playedScore)}</span>
                {node.progress.exact ? <em>Score exact +{node.progress.exactPoints}</em> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {node.status !== 'completed' ? (
          <div className="wcmap-entry__choose">
            <span>Choisis une equipe</span>
            <small>Le match demarre avec l'equipe que tu touches.</small>
          </div>
        ) : null}

        <div className="wcmap-entry__teams">
          <button
            type="button"
            className={`wcmap-entry__team${selectedTeamId === node.homeTeam?.id ? ' is-selected' : ''}`}
            onClick={() => node.homeTeam && onPickTeam(node.homeTeam.id)}
            disabled={!node.homeTeam || !node.awayTeam}
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
            disabled={!node.homeTeam || !node.awayTeam}
          >
            <span className="wcmap-entry__team-flag">
              {teamFlagImageUrl(node.awayTeam) ? <img src={teamFlagImageUrl(node.awayTeam) ?? undefined} alt="" /> : <span>{node.awayTeam?.flagEmoji ?? '🌍'}</span>}
            </span>
            <strong>{displayTeamName(node.awayTeam, node.match.away.kind === 'placeholder' ? node.match.away.label : undefined)}</strong>
            <small>{node.awayTeam?.name ?? 'En attente'}</small>
          </button>
        </div>
        {canSimulate ? (
          <button
            type="button"
            className="wcmap-entry__simulate"
            onClick={onSimulate}
          >
            Simuler sans jouer
          </button>
        ) : null}
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
  officialScores = {},
  onPick: _onPick,
  onPlay,
  onSimulate,
  onShowBracket,
  onSave,
  autosavedAt,
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

  const nodes = useMemo(() => buildDisplayNodes(matches, teamsById, picks, scores, realResults, officialScores), [matches, teamsById, picks, scores, realResults, officialScores])
  const focusNode = nodes.find((node) => node.isNextPlayable) ?? nodes.find((node) => node.status === 'live') ?? nodes.find((node) => node.status === 'available') ?? null
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
    if (!focusNode || panFocusRef.current === focusNode.id) return

    let frameId: number | null = null
    const viewport = viewportRef.current

    const focusMap = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        if (panFocusRef.current === focusNode.id) return
        if (!viewportRef.current) return
        const viewportHeight = viewportRef.current?.clientHeight ?? 0
        if (!viewportHeight) return
        const maxPan = Math.max(0, MAP_HEIGHT - viewportHeight)
        const targetOffset = -(focusNode.y - viewportHeight * 0.52)
        panFocusRef.current = focusNode.id
        animatePanTo(Math.max(-maxPan, Math.min(0, targetOffset)), 520)
      })
    }

    const observer = viewport && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(focusMap)
      : null
    if (viewport && observer) observer.observe(viewport)

    focusMap()
    const timeoutId = window.setTimeout(focusMap, 160)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      observer?.disconnect()
    }
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
    if (!selectedNode.homeTeam || !selectedNode.awayTeam) {
      setNotice('Ce match n est pas encore disponible.')
      return
    }
    sfx.pick()
    setSelectedTeamId(teamId)
    sfx.battle()
    onPlay(selectedNode.id, teamId)
  }

  const handleSimulate = () => {
    if (!selectedNode) return
    sfx.click()
    onSimulate?.(selectedNode.id)
  }

  return (
    <section className="wcmap">
      <div className="wcmap__autosave" aria-live="polite">
        <span>{formatAutosaveTime(autosavedAt)}</span>
        {onShowBracket ? <button type="button" onClick={onShowBracket}>Tableau</button> : null}
      </div>
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
        onSimulate={onSimulate ? handleSimulate : undefined}
        onShowBracket={onShowBracket}
        onShare={onSave}
      />
    </section>
  )
}

export default WorldCupMapMenu
