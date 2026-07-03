import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BattleDifficulty } from '../../types'
import KawaiiSprite, { KAWAII_SPRITE_CSS } from './KawaiiSprite'

export type GoalTarget = {
  x: number
  y: number
  clientX: number
  clientY: number
}

export type BallFlight = {
  id: number
  target: GoalTarget
  state: 'flying' | 'goal' | 'saved' | 'miss'
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
  targetActive?: boolean
  originYFrac?: number
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

function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number) {
  const oneMinusT = 1 - t
  return {
    x: oneMinusT * oneMinusT * oneMinusT * p0.x + 3 * oneMinusT * oneMinusT * t * p1.x + 3 * oneMinusT * t * t * p2.x + t * t * t * p3.x,
    y: oneMinusT * oneMinusT * oneMinusT * p0.y + 3 * oneMinusT * oneMinusT * t * p1.y + 3 * oneMinusT * t * t * p2.y + t * t * t * p3.y,
  }
}

function goalFrameMetrics(width: number, height: number, compact?: boolean) {
  const topY = height * (compact ? 0.31 : 0.12)
  const bottomY = height * (compact ? 0.46 : 0.88)
  const topLeft = width * (compact ? 0.18 : 0.12)
  const topRight = width * (compact ? 0.82 : 0.88)
  const bottomLeft = width * (compact ? 0.12 : 0.06)
  const bottomRight = width * (compact ? 0.88 : 0.94)
  return { topY, bottomY, topLeft, topRight, bottomLeft, bottomRight }
}

function goalEdgeAtY(width: number, height: number, normalizedY: number, compact = false) {
  const { topY, bottomY, topLeft, topRight, bottomLeft, bottomRight } = goalFrameMetrics(width, height, compact)
  const progress = normalizedY / 100
  return {
    left: interpolate(topLeft, bottomLeft, progress),
    right: interpolate(topRight, bottomRight, progress),
    y: interpolate(topY, bottomY, progress),
  }
}

export function goalPointFromNormalized(
  width: number,
  height: number,
  target: { x: number; y: number },
  compact = false,
) {
  const edges = goalEdgeAtY(width, height, target.y, compact)
  return {
    x: interpolate(edges.left, edges.right, target.x / 100),
    y: edges.y,
  }
}

function pointFromPossiblyOutsideGoal(
  width: number,
  height: number,
  target: { x: number; y: number },
  compact = false,
) {
  const { topY, bottomY, topLeft, topRight, bottomLeft, bottomRight } = goalFrameMetrics(width, height, compact)
  const progress = target.y / 100
  const leftAtY = interpolate(topLeft, bottomLeft, progress)
  const rightAtY = interpolate(topRight, bottomRight, progress)
  return {
    x: interpolate(leftAtY, rightAtY, target.x / 100),
    y: interpolate(topY, bottomY, progress),
    left: leftAtY,
    right: rightAtY,
  }
}

function buildShotCurve(
  width: number,
  height: number,
  target: { x: number; y: number },
  originYFrac = 0.95,
  compact = false,
  allowOutside = false,
) {
  const origin = { x: width / 2, y: height * originYFrac }
  const targetPoint = allowOutside ? pointFromPossiblyOutsideGoal(width, height, target, compact) : goalPointFromNormalized(width, height, target, compact)
  const horizontalShift = targetPoint.x - origin.x
  const verticalShift = targetPoint.y - origin.y
  const bend = clamp(52 + Math.abs(horizontalShift) * 0.2 + Math.abs(verticalShift) * 0.04, 44, 126)
  const cp1: Point = {
    x: origin.x + horizontalShift * 0.18,
    y: origin.y - bend,
  }
  const cp2: Point = {
    x: targetPoint.x - horizontalShift * 0.22,
    y: targetPoint.y + bend * (allowOutside ? 0.18 : 0.42),
  }
  const path = `M ${origin.x} ${origin.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${targetPoint.x} ${targetPoint.y}`
  return { origin, cp1, cp2, targetPoint, path }
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
  const accent = secondaryColor ?? '#ffffff'
  return (
    <g className={`goal-keeper${saving ? ' is-saving' : ''}`} style={{ '--goal-save-angle': `${saveAngle}deg` } as CSSProperties}>
      <g transform="translate(-41 -34)">
        <KawaiiSprite
          jerseyColor={core}
          accentColor={accent}
          shortsColor="#141a2b"
          role="keeper"
          seed={`${core}-${accent}`}
          width={82}
          height={100}
        />
      </g>
    </g>
  )
}

export function GoalView({
  difficulty: _difficulty,
  keeperX,
  keeperY: keeperYProp = 70,
  goalkeeperColor = '#2f7de1',
  goalkeeperSecondaryColor = '#7dd3fc',
  target,
  ballFlight,
  interactive = false,
  slowMotion = false,
  controllableKeeper = false,
  compact = false,
  showAimGuide = false,
  targetActive = true,
  originYFrac: originYFracProp,
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
  const [flightProgress, setFlightProgress] = useState(0)
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
  }, [keeperX, keeperYProp])

  useEffect(() => {
    if (!ballFlight) {
      setFlightProgress(0)
      return
    }

    let raf = 0
    const start = performance.now()
    const duration = ballFlight.duration ?? 700

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setFlightProgress(eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ballFlight?.id, ballFlight?.duration])

  const width = Math.max(MIN_SVG_WIDTH, dimensions.width || MIN_SVG_WIDTH)
  const height = Math.max(MIN_SVG_HEIGHT, dimensions.height || MIN_SVG_HEIGHT)
  const frame = goalFrameMetrics(width, height, compact)
  const goalHeight = frame.bottomY - frame.topY
  const activeTarget = ballFlight?.target ?? target
  const targetPoint = useMemo(() => activeTarget ? (ballFlight?.state === 'miss' ? pointFromPossiblyOutsideGoal(width, height, activeTarget, compact) : goalPointFromNormalized(width, height, activeTarget, compact)) : { x: width / 2, y: height / 2 }, [activeTarget, ballFlight?.state, compact, height, width])
  const keeperBottom = goalEdgeAtY(width, height, 92, compact)
  const keeperSvgX = interpolate(keeperBottom.left, keeperBottom.right, keeperX / 100)
  const keeperMargin = compact ? clamp(goalHeight * 0.22, 12, 28) : 20
  const keeperYNorm = clamp(keeperYProp, 10, 90) / 100
  const keeperSvgY = interpolate(frame.topY + keeperMargin, frame.bottomY - keeperMargin, keeperYNorm)
  const keeperScale = compact ? 0.78 : 1
  const originYFrac = originYFracProp ?? (compact ? 0.86 : 0.95)
  const shot = useMemo(() => (activeTarget ? buildShotCurve(width, height, activeTarget, originYFrac, compact, ballFlight?.state === 'miss') : null), [activeTarget, ballFlight?.state, compact, height, originYFrac, width])
  const ballPoint = shot ? cubicBezierPoint(shot.origin, shot.cp1, shot.cp2, shot.targetPoint, flightProgress) : null
  const saveAngle = targetPoint.x >= keeperSvgX ? 42 : -42
  const saving = ballFlight?.state === 'saved'
  const keeperZoneWidth = clamp(width * (compact ? 0.145 : 0.20), 42, 82)
  const keeperZoneHeight = clamp(goalHeight * (compact ? 0.62 : 0.34), 28, 64)
  const transitionMs = Math.max(40, 130 - 2.2 * 50) * (slowMotion ? 4 : 1)

  const coordinates = (clientX: number, clientY: number): GoalTarget | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || dimensions.width === 0 || dimensions.height === 0) return null
    const svgX = ((clientX - rect.left) / rect.width) * dimensions.width
    const svgY = ((clientY - rect.top) / rect.height) * dimensions.height
    const normalizedY = ((svgY - frame.topY) / goalHeight) * 100
    if (normalizedY < 0 || normalizedY > 100) return null
    const edges = goalEdgeAtY(width, height, normalizedY, compact)
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
    const top = goalEdgeAtY(width, height, y1Normalized, compact)
    const bottom = goalEdgeAtY(width, height, y2Normalized, compact)
    const x1Top = interpolate(top.left, top.right, column / ZONE_COLUMNS)
    const x2Top = interpolate(top.left, top.right, (column + 1) / ZONE_COLUMNS)
    const x1Bottom = interpolate(bottom.left, bottom.right, column / ZONE_COLUMNS)
    const x2Bottom = interpolate(bottom.left, bottom.right, (column + 1) / ZONE_COLUMNS)
    return `${x1Top},${top.y} ${x2Top},${top.y} ${x2Bottom},${bottom.y} ${x1Bottom},${bottom.y}`
  })

  const renderKeeperAt = (position: number, opacity: number, ghostIndex?: number) => {
    const x = interpolate(keeperBottom.left, keeperBottom.right, position / 100)
    const orientation = motion.direction === 1 ? -1 : 1
    return (
      <g
        key={ghostIndex ?? 'keeper'}
        className={`goal-keeper-position${ghostIndex === undefined ? ' is-current' : ' is-ghost'}`}
        opacity={opacity}
        transform={`translate(${x} ${keeperSvgY}) scale(${keeperScale})`}
        style={{ transitionDuration: `${transitionMs}ms` }}
      >
        <g className="goal-keeper-orientation" transform={`scale(${orientation} 1)`}>
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
        .goal-stage__crowd-band,
        .goal-stage__crowd-dot {
          display: none;
        }
        .goal-stage__net {
          stroke: rgba(255,255,255,.18);
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
          stroke-width: 4.8;
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
        .goal-stage__target.is-idle .goal-stage__target-core {
          fill: #f7fbff;
          stroke: #2bff9a;
          stroke-width: 2.6;
          filter: drop-shadow(0 0 16px rgba(43,255,154,.82));
          animation: goalTargetGrab 0.78s ease-in-out infinite alternate;
        }
        .goal-stage__target.is-idle .goal-stage__target-halo {
          fill: rgba(43,255,154,.12);
          stroke: rgba(43,255,154,.92);
          stroke-width: 2.4;
          stroke-dasharray: 3 5;
        }
        .goal-stage__target-pulse {
          fill: none;
          stroke: rgba(255,216,74,.5);
          stroke-width: 1.6;
          animation: goalTargetPulseRing 1.1s ease-out infinite;
          transform-box: fill-box;
          transform-origin: center;
        }
        .goal-stage__target.is-idle .goal-stage__target-pulse {
          stroke: rgba(43,255,154,.55);
        }
        .goal-stage__target-cross {
          stroke: rgba(255,255,255,.92);
          stroke-width: 2.2;
          filter: drop-shadow(0 0 6px rgba(255,216,74,.5));
        }
        @keyframes goalTargetPulseRing {
          0% { transform: scale(.7); opacity: .9; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        .goal-stage__target-label {
          fill: #ffffff;
          font: 900 10px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em;
          text-anchor: middle;
          paint-order: stroke;
          stroke: rgba(3,8,16,.9);
          stroke-width: 3;
          pointer-events: none;
          animation: goalTargetLabel 0.9s ease-in-out infinite alternate;
        }
        .goal-stage__curve {
          fill: none;
          stroke: #2bff9a;
          stroke-width: 3;
          stroke-dasharray: 4 7;
          stroke-linecap: round;
          opacity: .9;
          filter: drop-shadow(0 0 10px rgba(43,255,154,.45));
        }
        .goal-stage__shot.is-miss .goal-stage__curve { stroke: rgba(255,216,74,.78); filter: drop-shadow(0 0 10px rgba(255,216,74,.38)); }
        .goal-stage__shot.is-goal .goal-stage__curve { stroke: #2bff9a; }
        .goal-stage__shot.is-saved .goal-stage__curve { stroke: #ff4455; filter: drop-shadow(0 0 10px rgba(255,68,85,.45)); }
        .goal-stage__shot { pointer-events: none; }
        .goal-stage__animated-ball-wrap {
          filter: drop-shadow(0 0 10px rgba(255,255,255,.35));
        }
        .goal-stage__animated-ball {
          fill: #f7f9ff;
          stroke: #06111f;
          stroke-width: 3;
        }
        .goal-stage__keeper-zone {
          fill: rgba(255,68,85,.12);
          stroke: rgba(255,68,85,.66);
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
        }
        .goal-keeper {
          transform-box: fill-box;
          transform-origin: center;
        }
        .goal-keeper.is-saving {
          animation: goalKeeperSave .42s ease-out both;
        }
        ${KAWAII_SPRITE_CSS}
        .goal-stage__ball {
          fill: #f7f9ff;
          stroke: #06111f;
          stroke-width: 3.5;
          filter: drop-shadow(0 0 10px rgba(255,255,255,.22));
        }
        .goal-stage__player {
          transform-box: fill-box;
          transform-origin: 50% 88%;
        }
        .goal-stage__player.is-kicking {
          animation: goalPlayerKick 220ms ease-out both;
        }
        .goal-stage__ball-shadow {
          fill: rgba(0,0,0,.36);
        }
        .goal-stage__flight-shadow {
          fill: rgba(0,0,0,.25);
        }
        .goal-stage__net-flash {
          opacity: 0;
          animation: goalNetFlash .4s ease-out both;
        }
        .goal-stage__goal-flash,
        .goal-stage__save-flash {
          opacity: 0;
          animation: goalImpactFlash .34s ease-out both;
        }
        .goal-stage__goal-flash {
          fill: rgba(255,216,74,.30);
        }
        .goal-stage__save-flash {
          fill: rgba(255,68,85,.22);
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
        @keyframes goalTargetGrab {
          from { transform: scale(.96); }
          to { transform: scale(1.12); }
        }
        @keyframes goalTargetLabel {
          from { opacity: .55; transform: translateY(0); }
          to { opacity: 1; transform: translateY(-2px); }
        }
        @keyframes goalKeeperSave {
          0% { transform: scale(1); }
          45% { transform: rotate(var(--goal-save-angle)) scale(1.14, .96); }
          100% { transform: scale(.98); }
        }
        @keyframes goalPlayerKick {
          0% { transform: scale(1); }
          45% { transform: rotate(-3deg) scale(1.04, .98); }
          100% { transform: scale(1); }
        }
        .goal-stage__shot.is-miss .goal-stage__animated-ball {
          opacity: .88;
        }
        @keyframes goalNetFlash {
          0% { opacity: 0; transform: scale(.7); }
          30% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.18); }
        }
        @keyframes goalImpactFlash {
          0% { opacity: 0; transform: scale(.7); }
          18% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.45); }
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
        aria-label={interactive ? 'Deplacez votre cible dans le but' : 'But kawaii'}
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

        {/* Crowd removed for shot readability. */}
        <path d={`M ${frame.topLeft} ${frame.topY} H ${frame.topRight} L ${frame.bottomRight} ${frame.bottomY} H ${frame.bottomLeft} Z`} fill="rgba(255,255,255,.02)" />

        {Array.from({ length: 5 }, (_, index) => {
          const amount = (index + 1) / 6
          return <line key={`vertical-${index}`} className="goal-stage__net" x1={interpolate(frame.topLeft, frame.topRight, amount)} y1={frame.topY} x2={interpolate(frame.bottomLeft, frame.bottomRight, amount)} y2={frame.bottomY} />
        })}
        {Array.from({ length: 3 }, (_, index) => {
          const amount = (index + 1) / 4
          const edge = goalEdgeAtY(width, height, amount * 100, compact)
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
            <circle className="goal-stage__ball-shadow" cx={shot.origin.x} cy={shot.origin.y + 6} r="12" opacity=".22" />
            <circle className="goal-stage__ball" cx={shot.origin.x} cy={shot.origin.y} r="12" />
          </>
        ) : null}

        {target ? (
          <g className={`goal-stage__target${targetActive ? ' is-active' : ' is-idle'}`} transform={`translate(${targetPoint.x} ${targetPoint.y})`}>
            <circle className="goal-stage__target-pulse" r={compact ? 22 : 18} />
            <circle className="goal-stage__target-halo" r={compact ? 22 : 18} />
            <circle className="goal-stage__target-core" r={compact ? 12 : 11} />
            <g className="goal-stage__target-cross" strokeLinecap="round">
              <path d={compact ? 'M0 -20 V-13 M0 20 V13 M-20 0 H-13 M20 0 H13' : 'M0 -17 V-11 M0 17 V11 M-17 0 H-11 M17 0 H11'} />
            </g>
            {!targetActive ? <text className="goal-stage__target-label" y={compact ? -30 : -26}>DRAG</text> : null}
          </g>
        ) : null}

        <g>
          <ellipse
            className={`goal-stage__keeper-zone${ballFlight?.state === 'saved' ? ' is-hot' : ''}`}
            cx={keeperSvgX}
            cy={keeperSvgY}
            rx={keeperZoneWidth / 2}
            ry={keeperZoneHeight / 2}
          />
        </g>

        {slowMotion ? motion.history.slice(0, 3).reverse().map((position, index) => renderKeeperAt(position, [0.12, 0.24, 0.36][index], index)) : null}
        {renderKeeperAt(keeperX, 1)}

        {ballFlight && shot && ballPoint ? (
          <g key={ballFlight.id} className={`goal-stage__shot is-${ballFlight.state}`}>
            <path className="goal-stage__curve" d={shot.path} />
            {ballFlight.state === 'goal' && flightProgress >= 0.98 ? <circle className="goal-stage__goal-flash goal-stage__net-flash" cx={shot.targetPoint.x} cy={shot.targetPoint.y} r="24" /> : null}
            {ballFlight.state === 'saved' && flightProgress >= 0.98 ? <circle className="goal-stage__save-flash" cx={keeperSvgX} cy={keeperSvgY} r="24" /> : null}
            <g className={`goal-stage__animated-ball-wrap is-${ballFlight.state}`} transform={`translate(${ballPoint.x}, ${ballPoint.y})`}>
              <ellipse className="goal-stage__flight-shadow" cx="0" cy="8" rx={Math.max(4, 10 - flightProgress * 4)} ry="3" />
              <circle className="goal-stage__animated-ball" cx="0" cy="0" r={Math.max(7, 9 - flightProgress * 2)} />
              <path d="M-4 -3 L4 3 M4 -3 L-4 3" stroke="#06111f" strokeWidth="1.4" strokeLinecap="round" />
            </g>
          </g>
        ) : null}
      </svg>
    </div>
  )
}

export default GoalView
