import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BattleDifficulty } from '../../types'

export type GoalTarget = {
  x: number
  y: number
  clientX: number
  clientY: number
}

export type BallFlight = {
  id: number
  target: GoalTarget
  state: 'flying' | 'goal' | 'saved'
  duration?: number
}

type GoalViewProps = {
  difficulty: BattleDifficulty
  keeperX: number
  keeperY?: number
  goalkeeperColor?: string
  goalkeeperSecondaryColor?: string
  target?: GoalTarget | null
  ballFlight?: BallFlight | null
  interactive?: boolean
  slowMotion?: boolean
  controllableKeeper?: boolean
  compact?: boolean
  showAimGuide?: boolean
  onTarget?: (target: GoalTarget) => void
  onPreviewTarget?: (target: GoalTarget | null) => void
  onKeeperMove?: (position: number) => void
}

type Dimensions = { width: number; height: number }
type KeeperMotion = { last: number; direction: -1 | 1; history: number[] }

type Point = { x: number; y: number }

const MIN_SVG_WIDTH = 300
const MIN_SVG_HEIGHT = 168
const ZONE_COLUMNS = 3
const ZONE_ROWS = 2

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampKeeper(value: number) {
  return clamp(value, 12.5, 87.5)
}

function interpolate(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function goalFrameMetrics(width: number, height: number, compact?: boolean) {
  const topY = height * (compact ? 0.04 : 0.12)
  const bottomY = height * (compact ? 0.33 : 0.88)
  const topLeft = width * 0.12
  const topRight = width * 0.88
  const bottomLeft = width * 0.06
  const bottomRight = width * 0.94
  return { topY, bottomY, topLeft, topRight, bottomLeft, bottomRight }
}

function goalEdgeAtY(width: number, height: number, normalizedY: number) {
  const { topY, bottomY, topLeft, topRight, bottomLeft, bottomRight } = goalFrameMetrics(width, height)
  const progress = normalizedY / 100
  return {
    left: interpolate(topLeft, bottomLeft, progress),
    right: interpolate(topRight, bottomRight, progress),
    y: interpolate(topY, bottomY, progress),
  }
}

export function goalPointFromNormalized(width: number, height: number, target: { x: number; y: number }) {
  const edges = goalEdgeAtY(width, height, target.y)
  return {
    x: interpolate(edges.left, edges.right, target.x / 100),
    y: edges.y,
  }
}

function buildShotCurve(width: number, height: number, target: { x: number; y: number }, originYFrac = 0.95) {
  const origin = { x: width / 2, y: height * originYFrac }
  const targetPoint = goalPointFromNormalized(width, height, target)
  const horizontalShift = targetPoint.x - origin.x
  const bend = clamp(42 + Math.abs(horizontalShift) * 0.16, 36, 84)
  const cp1: Point = {
    x: origin.x + horizontalShift * 0.2,
    y: origin.y - bend,
  }
  const cp2: Point = {
    x: targetPoint.x - horizontalShift * 0.22,
    y: targetPoint.y + bend * 0.45,
  }
  const path = `M ${origin.x} ${origin.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${targetPoint.x} ${targetPoint.y}`
  return { origin, targetPoint, path }
}

function Goalkeeper({
  color,
  secondaryColor,
  saving,
  saveAngle,
}: {
  color: string
  secondaryColor?: string
  saving: boolean
  saveAngle: number
}) {
  const core = color === '#2f7de1' ? '#ff5470' : color
  const gloveColor = '#2bff9a'
  return (
    <g className={`goal-keeper${saving ? ' is-saving' : ''}`} style={{ '--goal-save-angle': `${saveAngle}deg` } as CSSProperties}>
      {/* Shadow */}
      <ellipse cx="0" cy="44" rx="32" ry="8" fill="rgba(0,0,0,.22)" />
      {/* Left arm raised */}
      <rect x="-28" y="-34" width="10" height="26" rx="5" fill="#f0c9a2" stroke="#fff" strokeWidth="1" />
      {/* Right arm raised */}
      <rect x="18" y="-34" width="10" height="26" rx="5" fill="#f0c9a2" stroke="#fff" strokeWidth="1" />
      {/* Left glove (raised) */}
      <g className="goal-keeper__glove goal-keeper__glove--left">
        <circle cx="-23" cy="-38" r="11" fill={gloveColor} stroke="#fff" strokeWidth="1.5" />
        <rect x="-30" y="-44" width="7" height="8" rx="3.5" fill={gloveColor} stroke="#fff" strokeWidth="1" />
        <rect x="-22" y="-46" width="7" height="8" rx="3.5" fill={gloveColor} stroke="#fff" strokeWidth="1" />
        <rect x="-14" y="-46" width="7" height="8" rx="3.5" fill={gloveColor} stroke="#fff" strokeWidth="1" />
      </g>
      {/* Right glove (raised) */}
      <g className="goal-keeper__glove goal-keeper__glove--right">
        <circle cx="23" cy="-38" r="11" fill={gloveColor} stroke="#fff" strokeWidth="1.5" />
        <rect x="16" y="-46" width="7" height="8" rx="3.5" fill={gloveColor} stroke="#fff" strokeWidth="1" />
        <rect x="24" y="-46" width="7" height="8" rx="3.5" fill={gloveColor} stroke="#fff" strokeWidth="1" />
        <rect x="32" y="-44" width="7" height="8" rx="3.5" fill={gloveColor} stroke="#fff" strokeWidth="1" />
      </g>
      {/* Jersey */}
      <path d="M-18 6 q18 -9 36 0 l-2 28 q-16 5 -32 0z" fill={core} stroke="#fff" strokeWidth="1.5" />
      {secondaryColor ? <rect x="-12" y="12" width="24" height="4" rx="2" fill={secondaryColor} opacity=".92" /> : null}
      {/* Legs */}
      <rect x="-12" y="32" width="10" height="13" rx="4" fill={core} stroke="#fff" strokeWidth="1.2" />
      <rect x="2" y="32" width="10" height="13" rx="4" fill={core} stroke="#fff" strokeWidth="1.2" />
      {/* Head */}
      <circle cx="0" cy="-10" r="16" fill="#f0c9a2" stroke="#fff" strokeWidth="1.5" />
      {/* Hair */}
      <path d="M-13 -12 q13 -16 26 0 q-3 -12 -13 -16 q-10 4 -13 16z" fill="#3b2a1e" />
      {/* Eyes (determined) */}
      <circle cx="-5" cy="-10" r="2.2" fill="#111" />
      <circle cx="5" cy="-10" r="2.2" fill="#111" />
      <circle cx="-4" cy="-11" r="0.9" fill="#fff" />
      <circle cx="6" cy="-11" r="0.9" fill="#fff" />
      {/* Rosy cheeks */}
      <circle cx="-10" cy="-4" r="2.5" fill="#ff8a8a" opacity=".5" />
      <circle cx="10" cy="-4" r="2.5" fill="#ff8a8a" opacity=".5" />
      {/* Determined mouth */}
      <path d="M-4 -1 q4 3 8 0" stroke="#111" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </g>
  )
}

export function GoalView({
  difficulty: _difficulty,
  keeperX,
  keeperY: keeperYProp,
  goalkeeperColor = '#2f7de1',
  goalkeeperSecondaryColor = '#7dd3fc',
  target,
  ballFlight,
  interactive = false,
  slowMotion = false,
  controllableKeeper = false,
  compact = false,
  showAimGuide = false,
  onTarget,
  onPreviewTarget,
  onKeeperMove,
}: GoalViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const rawId = useId()
  const id = rawId.replace(/:/g, '')
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const [motion, setMotion] = useState<KeeperMotion>({ last: keeperX, direction: 1, history: [] })
  const movedRef = useRef(false)
  const startXRef = useRef(0)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      setDimensions((current) => current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMotion((current) => {
      if (current.last === keeperX) return current
      return {
        last: keeperX,
        direction: keeperX > current.last ? 1 : -1,
        history: [current.last, ...current.history].slice(0, 3),
      }
    }))
    return () => cancelAnimationFrame(frame)
  }, [keeperX])

  const width = Math.max(1, dimensions.width)
  const height = Math.max(1, dimensions.height)
  const frame = goalFrameMetrics(width, height, compact)
  const goalHeight = frame.bottomY - frame.topY
  const targetPoint = useMemo(() => target ? goalPointFromNormalized(width, height, target) : { x: width / 2, y: height / 2 }, [height, target, width])
  const keeperBottom = goalEdgeAtY(width, height, 92)
  const keeperSvgX = interpolate(keeperBottom.left, keeperBottom.right, keeperX / 100)
  const keeperYNorm = (keeperYProp ?? 72) / 100
  const keeperSvgY = interpolate(frame.topY + 20, frame.bottomY - 20, keeperYNorm)
  const originYFrac = compact ? 0.86 : 0.95
  const shot = useMemo(() => (target ? buildShotCurve(width, height, target, originYFrac) : null), [height, target, width, originYFrac])
  const shotOriginX = width / 2
  const shotOriginY = height * originYFrac
  const saveAngle = targetPoint.x >= keeperSvgX ? 42 : -42
  const saving = ballFlight?.state === 'saved'
  const keeperZoneWidth = clamp(width * 0.20, 52, 100)
  const keeperZoneHeight = clamp(height * 0.22, 60, 110)
  const transitionMs = Math.max(40, 130 - 2.2 * 50) * (slowMotion ? 4 : 1)

  const coordinates = (clientX: number, clientY: number): GoalTarget | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || dimensions.width === 0 || dimensions.height === 0) return null
    const svgX = ((clientX - rect.left) / rect.width) * dimensions.width
    const svgY = ((clientY - rect.top) / rect.height) * dimensions.height
    const normalizedY = ((svgY - frame.topY) / goalHeight) * 100
    if (normalizedY < 0 || normalizedY > 100) return null
    const edges = goalEdgeAtY(width, height, normalizedY)
    if (svgX < edges.left || svgX > edges.right) return null
    return {
      x: ((svgX - edges.left) / (edges.right - edges.left)) * 100,
      y: normalizedY,
      clientX,
      clientY,
    }
  }

  const moveKeeper = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !onKeeperMove) return
    const left = rect.left + (keeperBottom.left / width) * rect.width
    const goalWidth = ((keeperBottom.right - keeperBottom.left) / width) * rect.width
    onKeeperMove(clampKeeper(((clientX - left) / goalWidth) * 100))
  }

  const activate = (clientX: number, clientY: number) => {
    const point = coordinates(clientX, clientY)
    if (!point) return
    if (controllableKeeper) onKeeperMove?.(clampKeeper(point.x))
    if (interactive) onTarget?.(point)
  }

  const updateHover = (clientX: number, clientY: number) => {
    if (!interactive && !onPreviewTarget) return
    const point = coordinates(clientX, clientY)
    onPreviewTarget?.(point)
  }

  const handleTouchStart = (event: React.TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0]
    startXRef.current = touch.clientX
    movedRef.current = false
    updateHover(touch.clientX, touch.clientY)
    setDragging(true)
  }

  const handleTouchMove = (event: React.TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0]
    updateHover(touch.clientX, touch.clientY)
    if (!dragging || !controllableKeeper) return
    movedRef.current ||= Math.abs(touch.clientX - startXRef.current) > 6
    moveKeeper(touch.clientX)
  }

  const handleTouchEnd = (event: React.TouchEvent<SVGSVGElement>) => {
    const touch = event.changedTouches[0]
    if (!movedRef.current) activate(touch.clientX, touch.clientY)
    setDragging(false)
  }

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    startXRef.current = event.clientX
    movedRef.current = false
    setDragging(true)
  }

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    updateHover(event.clientX, event.clientY)
    if (!dragging || !controllableKeeper) return
    movedRef.current ||= Math.abs(event.clientX - startXRef.current) > 6
    moveKeeper(event.clientX)
  }

  const handleMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!movedRef.current) activate(event.clientX, event.clientY)
    setDragging(false)
  }

  const zones = Array.from({ length: ZONE_COLUMNS * ZONE_ROWS }, (_, index) => {
    const row = Math.floor(index / ZONE_COLUMNS)
    const column = index % ZONE_COLUMNS
    const y1Normalized = (row * 100) / ZONE_ROWS
    const y2Normalized = ((row + 1) * 100) / ZONE_ROWS
    const top = goalEdgeAtY(width, height, y1Normalized)
    const bottom = goalEdgeAtY(width, height, y2Normalized)
    const x1Top = interpolate(top.left, top.right, column / ZONE_COLUMNS)
    const x2Top = interpolate(top.left, top.right, (column + 1) / ZONE_COLUMNS)
    const x1Bottom = interpolate(bottom.left, bottom.right, column / ZONE_COLUMNS)
    const x2Bottom = interpolate(bottom.left, bottom.right, (column + 1) / ZONE_COLUMNS)
    return `${x1Top},${top.y} ${x2Top},${top.y} ${x2Bottom},${bottom.y} ${x1Bottom},${bottom.y}`
  })

  const renderKeeperAt = (position: number, opacity: number, ghostIndex?: number) => {
    const x = interpolate(keeperBottom.left, keeperBottom.right, position / 100)
    return (
      <g
        key={ghostIndex ?? 'keeper'}
        className={`goal-keeper-position${ghostIndex === undefined ? ' is-current' : ' is-ghost'}`}
        opacity={opacity}
        style={{ transform: `translate(${x}px, ${keeperSvgY}px)`, transitionDuration: `${transitionMs}ms` }}
      >
        <g className="goal-keeper-orientation" style={{ transform: `scaleX(${motion.direction === 1 ? -1 : 1})` }}>
          <Goalkeeper color={goalkeeperColor} secondaryColor={goalkeeperSecondaryColor} saving={ghostIndex === undefined && saving} saveAngle={saveAngle} />
        </g>
      </g>
    )
  }

  return (
    <div className={`battle-goal-view goal-arcade${interactive ? ' is-interactive' : ''}${slowMotion ? ' is-slowmo' : ''}`}>
      <style>{`
        .goal-arcade {
          position: relative;
          width: min(100%, 760px);
          margin: 0 auto;
          border-radius: 28px;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 20%, rgba(43,255,154,.12), transparent 26%),
            radial-gradient(circle at 50% 76%, rgba(22,168,255,.14), transparent 18%),
            linear-gradient(180deg, #071126 0%, #040a13 100%);
          box-shadow: 0 22px 80px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.05);
        }
        .goal-arcade > svg {
          display: block;
          width: 100%;
          min-width: ${MIN_SVG_WIDTH}px;
          min-height: ${MIN_SVG_HEIGHT}px;
          aspect-ratio: 9 / 16;
          margin: 0 auto;
          overflow: visible;
          touch-action: none;
        }
        .goal-stage,
        .goal-stage__vignette,
        .goal-stage__crowd,
        .goal-stage__net,
        .goal-stage__frame,
        .goal-stage__target,
        .goal-stage__curve,
        .goal-stage__keeper,
        .goal-stage__shadow,
        .goal-stage__ball,
        .goal-stage__zone {
          pointer-events: none;
        }
        .goal-stage__vignette {
          fill: none;
          stroke: rgba(0,0,0,.55);
          stroke-width: 16;
          opacity: .9;
        }
        .goal-stage__crowd-band {
          fill: rgba(255,255,255,.04);
        }
        .goal-stage__crowd-dot {
          opacity: .95;
        }
        .goal-stage__net {
          stroke: rgba(255,255,255,.14);
          stroke-width: 1;
          fill: none;
        }
        .goal-stage__frame-shadow {
          fill: none;
          stroke: rgba(0,0,0,.55);
          stroke-width: 9;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: blur(2px);
        }
        .goal-stage__frame {
          fill: none;
          stroke: rgba(255,255,255,.96);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: drop-shadow(0 12px 26px rgba(0,0,0,.5));
        }
        .goal-stage__zone {
          stroke: rgba(255,255,255,.06);
          stroke-dasharray: 5 6;
          stroke-width: 1;
        }
        .goal-stage__target-core {
          fill: #ffd84a;
          stroke: rgba(255,255,255,.95);
          stroke-width: 2;
          filter: drop-shadow(0 0 10px rgba(255,216,74,.7));
          animation: goalTargetPulse 1.15s ease-in-out infinite;
        }
        .goal-stage__target-halo {
          fill: rgba(255,216,74,.12);
          stroke: rgba(255,216,74,.88);
          stroke-width: 2;
          stroke-dasharray: 4 5;
          filter: drop-shadow(0 0 12px rgba(255,216,74,.35));
          animation: goalTargetOrbit 1.45s linear infinite;
        }
        .goal-stage__curve {
          fill: none;
          stroke: #2bff9a;
          stroke-width: 2.8;
          stroke-dasharray: 2 7;
          stroke-linecap: round;
          filter: drop-shadow(0 0 10px rgba(43,255,154,.45));
        }
        .goal-stage__keeper-zone {
          fill: rgba(255,68,85,.10);
          stroke: rgba(255,68,85,.45);
          stroke-width: 1.5;
          stroke-dasharray: 5 6;
          filter: drop-shadow(0 0 10px rgba(255,68,85,.16));
        }
        .goal-stage__keeper-zone.is-hot {
          fill: rgba(255,68,85,.18);
          stroke: rgba(255,68,85,.76);
        }
        .goal-keeper-position {
          transform-box: fill-box;
          transform-origin: center;
          transition-property: transform;
          transition-timing-function: linear;
          filter: drop-shadow(0 12px 16px rgba(0,0,0,.36));
        }
        .goal-keeper-position.is-ghost {
          opacity: .18;
        }
        .goal-keeper-orientation {
          transform-box: fill-box;
          transform-origin: center;
          transition: transform .12s linear;
        }
        .goal-keeper {
          transform-box: fill-box;
          transform-origin: center;
        }
        .goal-keeper.is-saving {
          animation: goalKeeperSave .42s ease-out both;
        }
        .goal-keeper__glove {
          opacity: .98;
        }
        .goal-stage__ball {
          fill: #f7f9ff;
          stroke: #06111f;
          stroke-width: 3.5;
          filter: drop-shadow(0 0 10px rgba(255,255,255,.22));
        }
        .goal-stage__ball-shadow {
          fill: rgba(0,0,0,.36);
        }
        .goal-stage__flight-shadow {
          fill: rgba(0,0,0,.18);
        }
        .goal-stage__net-flash {
          opacity: 0;
          animation: goalNetFlash .4s ease-out both;
        }
        .goal-stage__goal-flash {
          fill: rgba(255,216,74,.26);
        }
        .goal-stage__save-flash {
          fill: rgba(255,68,85,.18);
        }
        .goal-slowmo-label {
          position: absolute;
          left: 14px;
          top: 14px;
          z-index: 2;
          color: #ffd84a;
          font: 800 11px Barlow, sans-serif;
          letter-spacing: .12em;
          text-transform: uppercase;
          pointer-events: none;
          text-shadow: 0 0 8px rgba(255,216,74,.45);
        }
        @keyframes goalTargetPulse {
          0%,100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes goalTargetOrbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes goalKeeperSave {
          0% { transform: scale(1); }
          45% { transform: rotate(var(--goal-save-angle)) scale(1.18); }
          100% { transform: scale(.96); }
        }
        @keyframes goalNetFlash {
          0% { opacity: 0; transform: scale(.7); }
          30% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.18); }
        }
        @media (min-width: 960px) {
          .goal-arcade {
            max-width: 720px;
          }
        }
      `}</style>
      {slowMotion ? <div className="goal-slowmo-label" aria-hidden="true">SLOW MOTION</div> : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={interactive ? 'D?placez votre cible dans le but' : 'But kawaii'}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragging(false); onPreviewTarget?.(null) }}
      >
        <defs>
          <clipPath id={`${id}-goal-clip`}>
            <path d={`M ${frame.topLeft} ${frame.topY} H ${frame.topRight} L ${frame.bottomRight} ${frame.bottomY} H ${frame.bottomLeft} Z`} />
          </clipPath>
          <linearGradient id={`${id}-crowd`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#18283d" />
            <stop offset="100%" stopColor="#08111d" />
          </linearGradient>
          <filter id={`${id}-gk-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <path id={`${id}-flight-path`} d={shot?.path ?? `M ${shotOriginX} ${shotOriginY} L ${shotOriginX} ${frame.topY}`} />
        </defs>

        {/* Green pitch section below goal in compact mode */}
        {compact && (
          <>
            <rect x="0" y={frame.bottomY} width={width} height={height - frame.bottomY + 4} fill="#0a3a1e" />
            <line x1={0} y1={frame.bottomY + 0.5} x2={width} y2={frame.bottomY + 0.5} stroke="rgba(255,255,255,.22)" strokeWidth="1.5" />
            <rect x={width * 0.12} y={frame.bottomY + 2} width={width * 0.76} height={(height - frame.bottomY) * 0.22} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="0.8" />
            <ellipse cx={width / 2} cy={frame.bottomY + (height - frame.bottomY) * 0.35} rx={width * 0.28} ry={(height - frame.bottomY) * 0.14} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="0.8" />
          </>
        )}

        <rect className="goal-stage__crowd-band" x="0" y="0" width={width} height={frame.topY + 20} />
        <line className="goal-stage__net" x1="0" y1={frame.topY + 10} x2={width} y2={frame.topY + 10} />
        {Array.from({ length: 10 }, (_, row) => (
          <g key={`crowd-${row}`} transform={`translate(0, ${8 + row * 8})`}>
            {Array.from({ length: 15 }, (_, col) => {
              const palette = ['#2bff9a', '#ff8a3d', '#FFB800', '#a78bfa', '#38bdf8']
              const color = palette[(row + col) % palette.length]
              const x = 16 + col * ((width - 32) / 14) + (row % 2 ? 6 : 0)
              return (
                <g key={`${row}-${col}`} transform={`translate(${x}, 0)`} className="goal-stage__crowd-dot">
                  <circle cx="0" cy="0" r="2.1" fill={color} />
                  <rect x="-2" y="2.4" width="4" height="4.4" rx="1.4" fill={color} opacity=".75" />
                </g>
              )
            })}
          </g>
        ))}

        <path d={`M ${frame.topLeft} ${frame.topY} H ${frame.topRight} L ${frame.bottomRight} ${frame.bottomY} H ${frame.bottomLeft} Z`} fill="rgba(255,255,255,.02)" />

        {Array.from({ length: 5 }, (_, index) => {
          const amount = (index + 1) / 6
          return <line key={`vertical-${index}`} className="goal-stage__net" x1={interpolate(frame.topLeft, frame.topRight, amount)} y1={frame.topY} x2={interpolate(frame.bottomLeft, frame.bottomRight, amount)} y2={frame.bottomY} />
        })}
        {Array.from({ length: 3 }, (_, index) => {
          const amount = (index + 1) / 4
          const edge = goalEdgeAtY(width, height, amount * 100)
          return <line key={`horizontal-${index}`} className="goal-stage__net" x1={edge.left} y1={edge.y} x2={edge.right} y2={edge.y} />
        })}

        <g clipPath={`url(#${id}-goal-clip)`}>
          {zones.map((points, index) => <polygon key={`zone-${index}`} className="goal-stage__zone" points={points} fill={target && interactive ? 'rgba(255,255,255,.03)' : 'transparent'} />)}
        </g>

        <path className="goal-stage__frame-shadow" d={`M ${frame.bottomLeft - 3} ${frame.bottomY + 3} L ${frame.topLeft - 3} ${frame.topY + 2} H ${frame.topRight + 3} L ${frame.bottomRight + 3} ${frame.bottomY + 3}`} />
        <path className="goal-stage__frame" d={`M ${frame.bottomLeft} ${frame.bottomY} L ${frame.topLeft} ${frame.topY} H ${frame.topRight} L ${frame.bottomRight} ${frame.bottomY}`} />

        {shot && showAimGuide && !ballFlight ? (
          <>
            <path className="goal-stage__curve" d={shot.path} />
            {compact ? (() => {
              const cx = shotOriginX
              const cy = shotOriginY
              // Scale so the character is ~22% of view height (seen from behind)
              const sc = height * 0.22 / 148
              return (
                <g transform={`translate(${cx - 64 * sc}, ${cy - 148 * sc}) scale(${sc})`}>
                  {/* Shadow */}
                  <ellipse cx="64" cy="148" rx="38" ry="7" fill="rgba(0,0,0,.35)" />
                  {/* Left leg straight */}
                  <rect x="50" y="102" width="10" height="28" rx="5" fill="#f3c9a0"/>
                  {/* Right leg — raised / kicking forward */}
                  <rect x="66" y="94" width="10" height="28" rx="5" fill="#f3c9a0" transform="rotate(22 71 108)"/>
                  {/* Boots */}
                  <ellipse cx="55" cy="130" rx="12" ry="7" fill="#0b1422"/>
                  <ellipse cx="79" cy="122" rx="12" ry="7" fill="#0b1422" transform="rotate(22 79 122)"/>
                  {/* Shorts */}
                  <rect x="46" y="90" width="36" height="18" rx="5" fill="#101a2c"/>
                  {/* Jersey — from behind with number */}
                  <path d="M40 62 q24 -10 48 0 l-3 32 q-21 6 -42 0 z" fill="#2bff9a"/>
                  <path d="M54 56 v36 M74 56 v36" stroke="#0b1422" strokeWidth="3" opacity=".35"/>
                  <text x="64" y="86" fontFamily="Barlow Condensed" fontWeight="900" fontSize="20" fill="#0b1422" textAnchor="middle">9</text>
                  {/* Left arm (balance, slightly out) */}
                  <rect x="29" y="66" width="10" height="24" rx="5" fill="#2bff9a"/>
                  {/* Right arm (raised forward with kick momentum) */}
                  <rect x="89" y="58" width="10" height="24" rx="5" fill="#2bff9a" transform="rotate(-28 94 70)"/>
                  <circle cx="34" cy="92" r="5" fill="#f3c9a0"/>
                  <circle cx="99" cy="82" r="5" fill="#f3c9a0"/>
                  {/* Head — back of head, hair visible from behind */}
                  <circle cx="64" cy="36" r="28" fill="#f3c9a0"/>
                  {/* Hair from behind (covers top & sides) */}
                  <path d="M36 28 q28 -30 56 0 q-10 -26 -28 -28 q-18 2 -28 28z" fill="#3a2a1c"/>
                  <path d="M36 28 q0 10 -2 20" stroke="#3a2a1c" strokeWidth="5" strokeLinecap="round" fill="none"/>
                  <path d="M92 28 q0 10 2 20" stroke="#3a2a1c" strokeWidth="5" strokeLinecap="round" fill="none"/>
                </g>
              )
            })() : (
              <>
                <circle className="goal-stage__ball-shadow" cx={shot.origin.x} cy={shot.origin.y + 6} r="12" opacity=".22" />
                <circle className="goal-stage__ball" cx={shot.origin.x} cy={shot.origin.y} r="12" />
              </>
            )}
          </>
        ) : null}

        {target ? (
          <g transform={`translate(${targetPoint.x} ${targetPoint.y})`}>
            <circle className="goal-stage__target-halo" r={compact ? 26 : 18} />
            <circle className="goal-stage__target-core" r={compact ? 16 : 11} />
          </g>
        ) : null}

        <g>
          <rect
            className={`goal-stage__keeper-zone${ballFlight?.state === 'saved' ? ' is-hot' : ''}`}
            x={keeperSvgX - keeperZoneWidth / 2}
            y={keeperSvgY - keeperZoneHeight / 2}
            width={keeperZoneWidth}
            height={keeperZoneHeight}
            rx="18"
          />
          <ellipse
            className="goal-stage__keeper-zone"
            cx={keeperSvgX}
            cy={keeperSvgY}
            rx={keeperZoneWidth * 0.34}
            ry={keeperZoneHeight * 0.42}
          />
        </g>

        {slowMotion ? motion.history.slice(0, 3).reverse().map((position, index) => renderKeeperAt(position, [0.12, 0.24, 0.36][index], index)) : null}
        {renderKeeperAt(keeperX, 1)}

        {ballFlight ? (
          <g key={ballFlight.id} className={`goal-stage__flight is-${ballFlight.state}`}>
            {ballFlight.state === 'goal' ? <circle className="goal-stage__goal-flash" cx={targetPoint.x} cy={targetPoint.y} r="18" /> : null}
            {ballFlight.state === 'saved' ? <circle className="goal-stage__save-flash" cx={targetPoint.x} cy={targetPoint.y} r="18" /> : null}
            <circle className="goal-stage__flight-shadow" cx={shotOriginX} cy={shotOriginY + 6} r="10" opacity=".22" />
            <circle className="goal-stage__ball" cx={shotOriginX} cy={shotOriginY} r="13">
              <animateMotion dur={`${ballFlight.duration ?? 320}ms`} fill="freeze" calcMode="spline" keySplines="0.18 0.76 0.21 1">
                <mpath href={`#${id}-flight-path`} />
              </animateMotion>
              <animateTransform attributeName="transform" type="scale" values="1;1.08;0.92" dur={`${ballFlight.duration ?? 320}ms`} fill="freeze" />
            </circle>
          </g>
        ) : null}
      </svg>
    </div>
  )
}

export default GoalView
