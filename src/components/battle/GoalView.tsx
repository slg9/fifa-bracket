import { useEffect, useId, useRef, useState } from 'react'
import type { BattleDifficulty } from '../../types'
import { getDifficultyConfig } from './config'

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
  goalkeeperColor?: string
  goalkeeperSecondaryColor?: string
  target?: GoalTarget | null
  ballFlight?: BallFlight | null
  interactive?: boolean
  slowMotion?: boolean
  controllableKeeper?: boolean
  onTarget?: (target: GoalTarget) => void
  onKeeperMove?: (position: number) => void
}

type Dimensions = { width: number; height: number }
type KeeperMotion = { last: number; direction: -1 | 1; history: number[] }

const MIN_SVG_WIDTH = 296
const MIN_SVG_HEIGHT = 148
const ZONE_COLUMNS = 3
const ZONE_ROWS = 2

function clampKeeper(value: number) {
  return Math.max(12.5, Math.min(87.5, value))
}

function interpolate(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function GoalkeeperGlove({ color, secondaryColor, saving, saveAngle }: {
  color: string
  secondaryColor?: string
  saving: boolean
  saveAngle: number
}) {
  // Use design color: #FF4455 (design spec) but allow override via prop
  const gloveColor = color === '#2f7de1' ? '#FF4455' : color
  const fingers = [-15, -7, 1, 9]
  const rotations = [-8, -3, 3, 8]
  return <g className={`goal-p18-glove${saving ? ' is-saving' : ''}`} style={{ '--goal-p18-save-angle': `${saveAngle}deg` } as React.CSSProperties}>
    {/* cuff */}
    <rect x="-12" y="19" width="24" height="11" rx="4" fill={gloveColor} stroke="#fff" strokeWidth="1.6" />
    {secondaryColor ? <rect x="-8" y="23" width="16" height="3" rx="1.5" fill={secondaryColor} opacity=".9" /> : null}
    {/* palm */}
    <rect x="-16" y="-2" width="32" height="22" rx="6" fill={gloveColor} stroke="#fff" strokeWidth="1.6" />
    {/* 4 fingers */}
    {fingers.map((x, index) => <rect key={x} x={x} y="-20" width="6" height="18" rx="3" fill={gloveColor} stroke="#fff" strokeWidth="1.4" transform={`rotate(${rotations[index]} ${x + 3} -2)`} />)}
    {/* thumb */}
    <rect x="-22" y="1" width="8" height="16" rx="4" fill={gloveColor} stroke="#fff" strokeWidth="1.4" transform="rotate(-40 -18 8)" />
    {/* grip lines */}
    {[4, 9, 14].map((y) => <line key={y} x1="-11" y1={y} x2="11" y2={y} stroke="rgba(255,255,255,.3)" strokeWidth="1.4" strokeLinecap="round" />)}
  </g>
}

export function GoalView({
  difficulty,
  keeperX,
  goalkeeperColor = '#2f7de1',
  goalkeeperSecondaryColor,
  target,
  ballFlight,
  interactive = false,
  slowMotion = false,
  controllableKeeper = false,
  onTarget,
  onKeeperMove,
}: GoalViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const rawId = useId()
  const id = rawId.replace(/:/g, '')
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const [hoveredZone, setHoveredZone] = useState<number | null>(null)
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
  const topY = height * .12
  const bottomY = height * .88
  const topLeft = width * .09
  const topRight = width * .91
  const bottomLeft = width * .04
  const bottomRight = width * .96
  const goalHeight = bottomY - topY
  const edgeAtY = (normalizedY: number) => {
    const progress = normalizedY / 100
    return {
      left: interpolate(topLeft, bottomLeft, progress),
      right: interpolate(topRight, bottomRight, progress),
      y: interpolate(topY, bottomY, progress),
    }
  }
  const targetEdges = edgeAtY(target?.y ?? 50)
  const targetSvgX = target ? interpolate(targetEdges.left, targetEdges.right, target.x / 100) : width / 2
  const targetSvgY = targetEdges.y
  const keeperBottom = edgeAtY(92)
  const keeperSvgX = interpolate(keeperBottom.left, keeperBottom.right, keeperX / 100)
  const keeperSvgY = bottomY - 36
  const saveAngle = targetSvgX >= keeperSvgX ? 45 : -45
  const saving = ballFlight?.state === 'saved'
  const transitionMs = Math.max(35, 120 - getDifficultyConfig(difficulty).gkSpeed * .4) * (slowMotion ? 4 : 1)

  const coordinates = (clientX: number, clientY: number): GoalTarget | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || dimensions.width === 0 || dimensions.height === 0) return null
    const svgX = (clientX - rect.left) / rect.width * dimensions.width
    const svgY = (clientY - rect.top) / rect.height * dimensions.height
    const normalizedY = (svgY - topY) / goalHeight * 100
    if (normalizedY < 0 || normalizedY > 100) return null
    const edges = edgeAtY(normalizedY)
    if (svgX < edges.left || svgX > edges.right) return null
    return {
      x: (svgX - edges.left) / (edges.right - edges.left) * 100,
      y: normalizedY,
      clientX,
      clientY,
    }
  }

  const moveKeeper = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !onKeeperMove) return
    const left = rect.left + keeperBottom.left / width * rect.width
    const goalWidth = (keeperBottom.right - keeperBottom.left) / width * rect.width
    onKeeperMove(clampKeeper((clientX - left) / goalWidth * 100))
  }

  const activate = (clientX: number, clientY: number) => {
    const point = coordinates(clientX, clientY)
    if (!point) return
    if (controllableKeeper) onKeeperMove?.(clampKeeper(point.x))
    if (interactive) onTarget?.(point)
  }

  const updateHover = (clientX: number, clientY: number) => {
    if (!interactive) {
      setHoveredZone(null)
      return
    }
    const point = coordinates(clientX, clientY)
    if (!point) {
      setHoveredZone(null)
      return
    }
    const column = Math.min(ZONE_COLUMNS - 1, Math.floor(point.x / (100 / ZONE_COLUMNS)))
    const row = Math.min(ZONE_ROWS - 1, Math.floor(point.y / (100 / ZONE_ROWS)))
    setHoveredZone(row * ZONE_COLUMNS + column)
  }

  const handleTouchStart = (event: React.TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0]
    startXRef.current = touch.clientX
    movedRef.current = false
    setDragging(true)
  }

  const handleTouchMove = (event: React.TouchEvent<SVGSVGElement>) => {
    if (!dragging || !controllableKeeper) return
    const touch = event.touches[0]
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
    const y1Normalized = row * 100 / ZONE_ROWS
    const y2Normalized = (row + 1) * 100 / ZONE_ROWS
    const top = edgeAtY(y1Normalized)
    const bottom = edgeAtY(y2Normalized)
    const x1Top = interpolate(top.left, top.right, column / ZONE_COLUMNS)
    const x2Top = interpolate(top.left, top.right, (column + 1) / ZONE_COLUMNS)
    const x1Bottom = interpolate(bottom.left, bottom.right, column / ZONE_COLUMNS)
    const x2Bottom = interpolate(bottom.left, bottom.right, (column + 1) / ZONE_COLUMNS)
    return `${x1Top},${top.y} ${x2Top},${top.y} ${x2Bottom},${bottom.y} ${x1Bottom},${bottom.y}`
  })

  const renderGloveAt = (position: number, opacity: number, ghostIndex?: number) => {
    const x = interpolate(keeperBottom.left, keeperBottom.right, position / 100)
    return <g key={ghostIndex ?? 'keeper'} className={`goal-p18-keeper-position${ghostIndex === undefined ? ' is-current' : ' is-ghost'}`} opacity={opacity}
      style={{ transform: `translate(${x}px, ${keeperSvgY}px)`, transitionDuration: `${transitionMs}ms` }} filter={slowMotion ? `url(#${id}-gk-glow)` : undefined}>
      <g className="goal-p18-keeper-orientation" style={{ transform: `scaleX(${motion.direction === 1 ? -1 : 1})` }}>
        <GoalkeeperGlove color={goalkeeperColor} secondaryColor={goalkeeperSecondaryColor} saving={ghostIndex === undefined && saving} saveAngle={saveAngle} />
      </g>
    </g>
  }

  // Vanishing point for depth lines (center top of goal)
  const vpX = width / 2
  const vpY = topY * 0.3

  return (
    <div className={`battle-goal-view goal-p18${interactive ? ' is-interactive' : ''}${slowMotion ? ' is-slowmo' : ''}`}>
      <style>{`
        .goal-p18{position:relative}
        .goal-p18>svg{display:block;width:90%!important;min-width:${MIN_SVG_WIDTH}px;min-height:${MIN_SVG_HEIGHT}px;aspect-ratio:2/1;margin:0 auto;overflow:visible;touch-action:none}
        .goal-p18-frame-shadow{fill:none;stroke:rgba(0,0,0,.42);stroke-width:8;stroke-linecap:round;stroke-linejoin:round;filter:blur(2px)}
        .goal-p18-frame{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 18px 30px rgba(0,0,0,.6))}
        .goal-p18-net{stroke:rgba(255,255,255,.15);stroke-width:1;fill:none}
        .goal-p18-depth{stroke:rgba(255,255,255,.1);stroke-width:1;fill:none}
        .goal-p18-zone{transition:fill .1s}
        .goal-p18-target{transform-box:fill-box;transform-origin:center;filter:drop-shadow(0 0 8px #f5c842);animation:goalP18TargetPop .2s cubic-bezier(.2,1.55,.5,1) both,goalP18TargetPulse 1.1s .2s ease-in-out infinite}
        .goal-p18.is-slowmo .goal-p18-target{animation-duration:.2s,1.5s}
        .goal-p18-target.is-exiting{animation:goalP18TargetExit .15s ease-in both}
        .goal-p18-keeper-position{transform-box:view-box;transform-origin:0 0;transition-property:transform;transition-timing-function:linear}
        .goal-p18-keeper-position.is-ghost{pointer-events:none}
        .goal-p18-keeper-orientation{transform-box:fill-box;transform-origin:center;transition:transform .1s linear}
        .goal-p18-glove{transform-box:fill-box;transform-origin:center}
        .goal-p18-glove.is-saving{animation:goalP18Save .4s ease-out both,goalP18SaveFlash .4s linear both}
        .goal-p18-slowmo-label{position:absolute;left:14px;top:14px;font:italic 700 11px 'Barlow',sans-serif;letter-spacing:.08em;color:#f5c842;text-shadow:0 0 8px rgba(245,200,66,.4);pointer-events:none}
        @keyframes goalP18TargetPop{0%{transform:scale(0);opacity:0}65%{transform:scale(1.2);opacity:1}100%{transform:scale(1)}}
        @keyframes goalP18TargetPulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}
        @keyframes goalP18TargetExit{to{transform:scale(0);opacity:0}}
        @keyframes goalP18Save{0%,100%{transform:rotate(0) scale(1)}40%{transform:rotate(var(--goal-p18-save-angle)) scale(1.3)}}
        @keyframes goalP18SaveFlash{0%,50%,100%{filter:none}25%{filter:saturate(0) brightness(3)}}
      `}</style>
      {slowMotion ? <div className="goal-p18-slowmo-label" aria-hidden="true">◷ SLOW MOTION</div> : null}
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={controllableKeeper ? 'Glissez le gardien ou touchez une zone' : 'Touchez une zone du but'}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={() => { setDragging(false); setHoveredZone(null) }}>
        <defs>
          <clipPath id={`${id}-goal-clip`}><path d={`M${topLeft} ${topY}H${topRight}L${bottomRight} ${bottomY}H${bottomLeft}Z`} /></clipPath>
          <filter id={`${id}-gk-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Goal interior fill */}
        <path d={`M${topLeft} ${topY}H${topRight}L${bottomRight} ${bottomY}H${bottomLeft}Z`} fill="rgba(255,255,255,.025)" />

        {/* Vertical net lines */}
        {Array.from({ length: 5 }, (_, index) => {
          const amount = (index + 1) / 6
          return <line key={`vertical-${index}`} className="goal-p18-net" x1={interpolate(topLeft, topRight, amount)} y1={topY} x2={interpolate(bottomLeft, bottomRight, amount)} y2={bottomY} />
        })}
        {/* Horizontal net lines */}
        {Array.from({ length: 3 }, (_, index) => {
          const amount = (index + 1) / 4
          const edge = edgeAtY(amount * 100)
          return <line key={`horizontal-${index}`} className="goal-p18-net" x1={edge.left} y1={edge.y} x2={edge.right} y2={edge.y} />
        })}

        {/* Depth / vanishing-point lines */}
        {[
          [topLeft, topY],
          [topRight, topY],
          [interpolate(topLeft, bottomLeft, .5), interpolate(topY, bottomY, .5)],
          [interpolate(topRight, bottomRight, .5), interpolate(topY, bottomY, .5)],
        ].map(([x, y], index) => <line key={`depth-${index}`} className="goal-p18-depth" x1={x} y1={y} x2={vpX} y2={vpY} />)}

        {/* 6 zone overlays (2 rows × 3 cols) with subtle dashed outlines */}
        <g stroke="rgba(255,255,255,.08)" strokeWidth="1" strokeDasharray="4 5" fill="none">
          {zones.map((points, index) => (
            <polygon key={`zone-outline-${index}`} points={points} />
          ))}
        </g>
        <g clipPath={`url(#${id}-goal-clip)`}>
          {zones.map((points, index) => <polygon key={index} className="goal-p18-zone" points={points} fill={hoveredZone === index ? 'rgba(255,255,255,.05)' : 'transparent'} />)}
        </g>

        {/* Goal frame shadow */}
        <path className="goal-p18-frame-shadow" d={`M${bottomLeft - 3} ${bottomY + 3}L${topLeft - 3} ${topY + 2}H${topRight + 3}L${bottomRight + 3} ${bottomY + 3}`} />
        {/* Goal frame */}
        <path className="goal-p18-frame" d={`M${bottomLeft} ${bottomY}L${topLeft} ${topY}H${topRight}L${bottomRight} ${bottomY}`} />

        {/* Golden ring target */}
        {target ? <circle className={`goal-p18-target${ballFlight ? ' is-exiting' : ''}`} cx={targetSvgX} cy={targetSvgY} r="22" fill="none" stroke="#f5c842" strokeWidth="2.5"
          style={{ boxShadow: '0 0 8px #f5c842, 0 0 18px rgba(245,200,66,.5)' }} /> : null}

        {/* Ghost keeper trails in slow-mo */}
        {slowMotion ? motion.history.slice(0, 3).reverse().map((position, index) => renderGloveAt(position, [.1, .2, .3][index], index)) : null}
        {/* Current keeper */}
        {renderGloveAt(keeperX, 1)}

        {/* Ball flight */}
        {ballFlight ? <g key={ballFlight.id} className={`battle-shot-flight is-${ballFlight.state}`} style={{ '--battle-flight-duration': `${ballFlight.duration ?? 300}ms` } as React.CSSProperties}>
          <circle className="battle-shot-flight__ball" cx={width / 2} cy={height * .96} r="13">
            <animate attributeName="cx" from={width / 2} to={targetSvgX} dur={`${ballFlight.duration ?? 300}ms`} fill="freeze" />
            <animate attributeName="cy" from={height * .96} to={targetSvgY} dur={`${ballFlight.duration ?? 300}ms`} fill="freeze" />
            <animate attributeName="r" values="13;16;9" dur={`${ballFlight.duration ?? 300}ms`} fill="freeze" />
          </circle>
        </g> : null}
      </svg>
      {slowMotion ? <div className="battle-vignette" aria-hidden="true" /> : null}
    </div>
  )
}

export default GoalView
