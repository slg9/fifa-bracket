import { useEffect, useMemo, useRef, useState } from 'react'
import { sfx } from '../lib/sfx'
import type { KnockoutMatch, Team } from '../types'

export interface WorldCupMapMenuProps {
  matches: KnockoutMatch[]
  teamsById: Map<string, Team>
  picks: Record<string, string>
  scores?: Record<string, { p: number; o: number }>
  onPick: (matchId: string, teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
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
}

// ─── Candy Crush winding layout ───────────────────────────────────────────────
// All matches in ascending order, top → bottom, zigzag left↔right

const MAP_HEIGHT = 1820

const ROUTE_X = [
  24, 74, 30, 70, 18, 82, 34, 66,
  22, 78, 28, 72, 16, 84, 34, 68,
  20, 80, 32, 66, 24, 76, 30, 70,
  18, 82, 34, 66, 26, 74, 32, 50,
]
const ROUTE_Y_START = 1720
const ROUTE_Y_END = 120

// Sequence order drives both path rendering and node visit order
const MATCH_SEQUENCE = [
  'M73','M74','M75','M76',
  'M77','M78','M79','M80',
  'M81','M82','M83','M84',
  'M85','M86','M87','M88',
  'M89','M90','M91','M92',
  'M93','M94','M95','M96',
  'M97','M98',
  'M99','M100',
  'M101','M102',
  'M103','M104',
]

const NODE_POS: Record<string, { x: number; y: number }> = Object.fromEntries(
  MATCH_SEQUENCE.map((id, index) => {
    const t = index / (MATCH_SEQUENCE.length - 1)
    const y = Math.round(ROUTE_Y_START - t * (ROUTE_Y_START - ROUTE_Y_END))
    return [id, { x: ROUTE_X[index] ?? 50, y }]
  }),
) as Record<string, { x: number; y: number }>

// Zone labels — positioned between sections, encountered as user scrolls UP
const ZONE_BANNERS = [
  { label: '16es de finale', y: 1670 },   // intro to R32 (just above bottom rows)
  { label: '8es de finale', y: 1175 },    // R32 → R16 transition
  { label: 'Quarts de finale', y: 865 },  // R16 → QF transition
  { label: 'Demi-finales', y: 540 },      // QF → SF transition
  { label: '🏆 Finale', y: 340 },         // SF → Finals transition
]

// ─── Round labels ──────────────────────────────────────────────────────────────

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
  if (match.id === 'M103') return '3e'
  if (match.id === 'M104') return '🏆'
  return ROUND_SHORT[match.stage] ?? match.stage
}

function getStatusHint(status: NodeStatus) {
  switch (status) {
    case 'completed': return 'Choix enregistré — tu peux rejouer.'
    case 'live': return 'Ce match est le prochain à jouer !'
    case 'available': return 'Choisis ton équipe et lance le match.'
    default: return 'Termine les matchs précédents pour débloquer.'
  }
}

function entrantTeam(match: KnockoutMatch, side: 'home' | 'away', teamsById: Map<string, Team>) {
  const e = match[side]
  return e.kind === 'team' ? teamsById.get(e.teamId) : undefined
}
function displayTeamName(team?: Team, fallback?: string) {
  if (team) return team.shortName || team.name
  return fallback ?? 'À déterminer'
}

// ─── Data builder ─────────────────────────────────────────────────────────────

function buildDisplayNodes(
  matches: KnockoutMatch[],
  teamsById: Map<string, Team>,
  picks: Record<string, string>,
): DisplayNode[] {
  const resolved = matches.map((match) => ({
    match,
    homeTeam: entrantTeam(match, 'home', teamsById),
    awayTeam: entrantTeam(match, 'away', teamsById),
    pickedTeamId: picks[match.id],
  }))

  const firstPlayable = resolved.find((r) => !r.pickedTeamId && r.homeTeam && r.awayTeam)?.match.id

  return resolved.map(({ match, homeTeam, awayTeam, pickedTeamId }) => {
    const pos = NODE_POS[match.id]
    const status: NodeStatus = pickedTeamId
      ? 'completed'
      : homeTeam && awayTeam
        ? match.id === firstPlayable ? 'live' : 'available'
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
      match, status, homeTeam, awayTeam, pickedTeamId,
    }
  })
}

// ─── SVG path (single winding road) ──────────────────────────────────────────

function MapPathSvg({ nodes }: { nodes: DisplayNode[] }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  return (
    <svg
      className="wcmap__paths"
      viewBox={`0 0 100 ${MAP_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {MATCH_SEQUENCE.slice(1).map((id, i) => {
        const from = byId.get(MATCH_SEQUENCE[i])
        const to = byId.get(id)
        if (!from || !to) return null

        const fx = from.x, fy = from.y
        const tx = to.x, ty = to.y
        const dx = tx - fx
        const dy = ty - fy
        const direction = dx >= 0 ? 1 : -1
        const bend = Math.max(18, Math.min(44, Math.abs(dx) * 0.48 + 16))
        const lift = Math.max(36, Math.min(96, Math.abs(dy) * 0.22 + 28))
        const midX = (fx + tx) / 2 + direction * bend * 0.36
        const midY = (fy + ty) / 2
        const cp1x = fx + direction * bend
        const cp1y = fy - lift
        const cp2x = midX - direction * bend * 0.22
        const cp2y = midY - lift * 0.42
        const cp4x = tx - direction * bend
        const cp4y = ty + lift
        const d = `M ${fx} ${fy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${midX} ${midY} S ${cp4x} ${cp4y}, ${tx} ${ty}`

        const isActive = to.status !== 'locked'

        return (
          <path
            key={`${MATCH_SEQUENCE[i]}-${id}`}
            className={`wcmap__path${isActive ? ' is-active' : ''}`}
            d={d}
          />
        )
      })}
    </svg>
  )
}

// ─── Node bubble ──────────────────────────────────────────────────────────────

function MatchNode({
  node,
  selecting,
  onClick,
}: {
  node: DisplayNode
  selecting: boolean
  onClick: () => void
}) {
  const isLocked = node.status === 'locked'
  const isCompleted = node.status === 'completed'
  const isLive = node.status === 'live'

  return (
    <button
      type="button"
      data-node-id={node.id}
      className={[
        'wcmap__node',
        `is-${node.status}`,
        node.isFinalBoss ? 'is-final' : '',
        node.isThirdPlace ? 'is-third' : '',
        selecting ? 'is-selecting' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: `${node.x}%`, top: `${node.y}px` }}
      onClick={onClick}
    >
      {isLocked ? (
        <>
          <span className="wcmap__node-lock">🔒</span>
          <span className="wcmap__node-num">{node.matchNumber}</span>
        </>
      ) : (
        <>
          <div className="wcmap__node-flags">
            <span>{node.homeTeam?.flagEmoji ?? '🌍'}</span>
            <span>{node.awayTeam?.flagEmoji ?? '🌍'}</span>
          </div>
          <span className="wcmap__node-round">{node.roundShort}</span>
        </>
      )}
      {isCompleted && <span className="wcmap__node-badge">★</span>}
      {isLive && <span className="wcmap__node-live-dot" />}
    </button>
  )
}

// ─── Level entry screen ───────────────────────────────────────────────────────

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
  onShowBracket: _onShowBracket,
  onShare: _onShare,
}: {
  node: DisplayNode | null
  selectedTeamId: string | null
  score?: { p: number; o: number }
  open: boolean
  canShare: boolean
  canShowBracket: boolean
  onClose: () => void
  onPickTeam: (teamId: string) => void
  onPlay: () => void
  onShowBracket?: () => void
  onShare?: () => void
}) {
  if (!open || !node) return null

  const canPlay = Boolean(node.homeTeam && node.awayTeam && (selectedTeamId || node.pickedTeamId))

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

        {node.status !== 'completed' && (
          <p className="wcmap-entry__hint">{getStatusHint(node.status)}</p>
        )}

        {/* Completed match: show winner summary */}
        {node.status === 'completed' && node.pickedTeamId ? (
          <div className="wcmap-entry__result">
            <div className="wcmap-entry__result-winner">
              <span className="wcmap-entry__result-flag">
                {(node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam)?.flagEmoji ?? '🏆'}
              </span>
              <div>
                <small className="wcmap-entry__result-label">VAINQUEUR</small>
                <strong className="wcmap-entry__result-name">
                  {(node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam)?.name ?? node.pickedTeamId}
                </strong>
              </div>
            </div>
            {score ? (
              <div className="wcmap-entry__result-score">
                <span>{node.homeTeam?.flagEmoji ?? '🌍'}</span>
                <strong>{score.p} — {score.o}</strong>
                <span>{node.awayTeam?.flagEmoji ?? '🌍'}</span>
              </div>
            ) : (
              <div className="wcmap-entry__result-vs">
                <span>{node.homeTeam?.flagEmoji ?? '🌍'} {displayTeamName(node.homeTeam)}</span>
                <em>vs</em>
                <span>{displayTeamName(node.awayTeam)} {node.awayTeam?.flagEmoji ?? '🌍'}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="wcmap-entry__teams">
            <button
              type="button"
              className={`wcmap-entry__team${selectedTeamId === node.homeTeam?.id ? ' is-selected' : ''}`}
              onClick={() => node.homeTeam && onPickTeam(node.homeTeam.id)}
              disabled={!node.homeTeam}
            >
              <span className="wcmap-entry__team-flag">{node.homeTeam?.flagEmoji ?? '🌍'}</span>
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
              <span className="wcmap-entry__team-flag">{node.awayTeam?.flagEmoji ?? '🌍'}</span>
              <strong>{displayTeamName(node.awayTeam, node.match.away.kind === 'placeholder' ? node.match.away.label : undefined)}</strong>
              <small>{node.awayTeam?.name ?? 'En attente'}</small>
            </button>
          </div>
        )}

        <div className="wcmap-entry__actions">
          <button
            type="button"
            className="wcmap-entry__play"
            onClick={onPlay}
            disabled={!canPlay}
          >
            {node.status === 'completed'
              ? '↺ Rejouer le match'
              : node.isFinalBoss ? '🏆 JOUER LA FINALE' : '⚽ JOUER CE MATCH'}
          </button>
        </div>
      </aside>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorldCupMapMenu({
  matches,
  teamsById,
  picks,
  scores = {},
  onPick: _onPick,
  onPlay,
  onShowBracket,
  onSave,
}: WorldCupMapMenuProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panInitRef = useRef(false)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const dragDistRef = useRef(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const nodes = useMemo(() => buildDisplayNodes(matches, teamsById, picks), [matches, teamsById, picks])
  const focusNode = nodes.find((n) => n.status === 'live') ?? nodes.find((n) => n.status === 'available') ?? null
  const selectedNode = nodes.find((n) => n.id === selectedMatchId) ?? null
  const completedCount = nodes.filter((n) => n.status === 'completed').length

  useEffect(() => {
    if (!selectedNode) return
    setSelectedTeamId(selectedNode.pickedTeamId ?? null)
  }, [selectedNode])

  // Auto-pan to focus node on first render (show R32 matches at bottom)
  useEffect(() => {
    if (!focusNode || panInitRef.current || !viewportRef.current) return
    panInitRef.current = true
    const vh = viewportRef.current.clientHeight
    const maxPan = MAP_HEIGHT - vh
    // Center focus node vertically at 60% from top (slightly below center)
    const targetOffset = -(focusNode.y - vh * 0.4)
    setOffset({ x: 0, y: Math.max(-maxPan, Math.min(0, targetOffset)) })
  }, [focusNode])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
    dragDistRef.current = 0
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !viewportRef.current) return
    const dy = e.clientY - dragRef.current.py
    dragDistRef.current = Math.abs(dy)
    const vh = viewportRef.current.clientHeight
    const maxPan = MAP_HEIGHT - vh
    const newY = Math.max(-maxPan, Math.min(0, dragRef.current.oy + dy))
    setOffset({ x: 0, y: newY })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(t)
  }, [notice])

  const handleSelectNode = (node: DisplayNode) => {
    if (dragDistRef.current > 8) return // was a pan, not a tap
    if (node.status === 'locked') {
      setNotice('Match verrouille. Termine les matchs precedents pour debloquer.')
      return
    }
    sfx.tab()
    setSelectingId(node.id)
    setSelectedMatchId(node.id)
    setSelectedTeamId(node.pickedTeamId ?? null)
    window.setTimeout(() => setSelectingId(null), 220)
  }

  const handlePickTeam = (teamId: string) => {
    if (!selectedNode) return
    sfx.pick()
    // Only update local selection — match is only 'completed' after playing it
    setSelectedTeamId(teamId)
  }

  const handlePlay = () => {
    if (!selectedNode) return
    const chosenTeamId = selectedTeamId ?? selectedNode.pickedTeamId
    if (!chosenTeamId) {
      setNotice('Choisis ton camp avant de jouer.')
      return
    }
    sfx.battle()
    onPlay(selectedNode.id, chosenTeamId)
  }

  return (
    <section className="wcmap">
      <div className="wcmap__hud">
        <div>
          <span className="wcmap__eyebrow">World Cup 2026</span>
        </div>
        <div className="wcmap__hud-actions">
          <div className="wcmap__progress-card">
            <strong>{completedCount}/{nodes.length}</strong>
            <span>matchs</span>
          </div>
          {onShowBracket && (
            <button type="button" className="wcmap__ghost" onClick={onShowBracket}>Tableau</button>
          )}
          {onSave && (
            <button type="button" className="wcmap__ghost" onClick={onSave}>Sauvegarder</button>
          )}
        </div>
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

          {ZONE_BANNERS.map((b) => (
            <div key={b.label} className="wcmap__marker" style={{ top: `${b.y}px` }}>
              <span>{b.label}</span>
            </div>
          ))}

          {nodes.map((node) => (
            <MatchNode
              key={node.id}
              node={node}
              selecting={selectingId === node.id}
              onClick={() => handleSelectNode(node)}
            />
          ))}
        </div>
      </div>

      <div
        className={`wcmap__notice${notice ? ' is-visible' : ''}`}
        role="status"
        aria-live="polite"
      >
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
        onShowBracket={onShowBracket}
        onShare={onSave}
      />
    </section>
  )
}

export default WorldCupMapMenu
