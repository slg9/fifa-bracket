import { useEffect, useRef, useState } from 'react'
import type { BattleDifficulty } from '../../types'

export type GoalSaveProps = {
  ballCount: number
  difficulty: BattleDifficulty
  onResult: (saved: boolean) => void
}

type BallState = 'flying' | 'intercepted' | 'scored'

type Ball = {
  id: number
  startX: number
  startY: number
  endX: number
  endY: number
  delay: number
  duration: number
  state: BallState
}

function makeBalls(count: number, duration: number): Ball[] {
  const balls: Ball[] = []
  for (let i = 0; i < count; i++) {
    // Spawn from top of screen, fly DOWN toward goal at bottom
    const sx = 10 + Math.random() * 80
    const sy = -8 + Math.random() * 12
    const ex = 28 + Math.random() * 44
    const ey = 80 + Math.random() * 8
    balls.push({ id: i, startX: sx, startY: sy, endX: ex, endY: ey, delay: i * 500, duration, state: 'flying' })
  }
  return balls
}

export function GoalSave({ ballCount, difficulty, onResult }: GoalSaveProps) {
  const duration = difficulty === 'easy' ? 1800 : difficulty === 'medium' ? 1400 : 1000
  const [balls, setBalls] = useState<Ball[]>(() => makeBalls(Math.min(3, Math.max(1, ballCount)), duration))
  const [particles, setParticles] = useState<{ id: number; x: number; y: number }[]>([])
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const endedRef = useRef(false)
  const ballsRef = useRef(balls)
  ballsRef.current = balls
  // keep latest onResult without making it a dep of the resolution effect
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  // auto-resolve balls that reach goal
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    balls.forEach((ball) => {
      // after delay + duration, if still flying → scored
      const t = setTimeout(() => {
        setBalls((prev) => {
          const target = prev.find((b) => b.id === ball.id)
          if (!target || target.state !== 'flying') return prev // no change → same ref, no re-render
          return prev.map((b) => b.id === ball.id ? { ...b, state: 'scored' as const } : b)
        })
      }, ball.delay + ball.duration + 50)
      timers.push(t)
    })
    return () => timers.forEach(clearTimeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // check resolution — immediate BUT if any ball scored; ARRÊTÉ when all blocked
  useEffect(() => {
    if (endedRef.current) return
    // First ball to reach goal = immediate concede (no cleanup return — endedRef prevents double fire)
    if (balls.some((b) => b.state === 'scored')) {
      endedRef.current = true
      setResultLabel('BUT !')
      window.setTimeout(() => onResultRef.current(false), 900)
      return
    }
    // Only resolve when no balls remain 'flying' OR 'waiting' (waiting = not yet launched)
    const allResolved = balls.every((b) => b.state === 'intercepted' || b.state === 'scored')
    if (!allResolved) return
    const saved = balls.every((b) => b.state === 'intercepted')
    endedRef.current = true
    setResultLabel(saved ? 'ARRÊTÉ !' : 'BUT !')
    window.setTimeout(() => onResultRef.current(saved), 900)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balls])

  const interceptBall = (id: number, clientX: number, clientY: number, containerRect: DOMRect) => {
    if (endedRef.current) return
    setBalls((prev) => {
      const target = prev.find((b) => b.id === id)
      if (!target || target.state !== 'flying') return prev // same ref → no re-render
      return prev.map((b) => b.id === id ? { ...b, state: 'intercepted' as const } : b)
    })
    const px = (clientX - containerRect.left) / containerRect.width * 100
    const py = (clientY - containerRect.top) / containerRect.height * 100
    const particleId = Date.now() + id
    setParticles((prev) => [...prev, { id: particleId, x: px, y: py }])
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== particleId)), 600)
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // Swipe trail visual
  const [trail, setTrail] = useState<Array<{ id: string; x1: number; y1: number; x2: number; y2: number; at: number }>>([])
  const trailTimerRef = useRef(0)

  // swipe detection
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeRef.current) return
    const dx = e.clientX - swipeRef.current.x
    const dy = e.clientY - swipeRef.current.y
    const dist = Math.hypot(dx, dy)
    if (dist < 12) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const prevX = (swipeRef.current.x - rect.left) / rect.width * 100
    const prevY = (swipeRef.current.y - rect.top) / rect.height * 100
    swipeRef.current = { x: e.clientX, y: e.clientY }
    const mx = (e.clientX - rect.left) / rect.width * 100
    const my = (e.clientY - rect.top) / rect.height * 100
    // Add trail segment
    const seg = { id: crypto.randomUUID(), x1: prevX, y1: prevY, x2: mx, y2: my, at: Date.now() }
    setTrail((prev) => [...prev.filter((s) => Date.now() - s.at < 400), seg])
    clearTimeout(trailTimerRef.current)
    trailTimerRef.current = window.setTimeout(() => setTrail([]), 450)
    const now = Date.now()
    ballsRef.current.forEach((ball) => {
      if (ball.state !== 'flying') return
      const elapsed = now - ball.delay
      if (elapsed < 0) return
      const progress = Math.min(1, elapsed / ball.duration)
      const bx = ball.startX + (ball.endX - ball.startX) * progress
      const by = ball.startY + (ball.endY - ball.startY) * progress
      const d = Math.hypot(mx - bx, my - by)
      if (d < 22) {
        interceptBall(ball.id, e.clientX, e.clientY, rect)
      }
    })
  }

  return (
    <div
      ref={containerRef}
      className="gs-container"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#04110a', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={(e) => { swipeRef.current = { x: e.clientX, y: e.clientY } }}
      onPointerMove={handlePointerMove}
      onPointerUp={() => { swipeRef.current = null }}
      onPointerCancel={() => { swipeRef.current = null }}
    >
      <style>{`
        .gs-container { cursor: crosshair; }
        .gs-goal-frame { position: absolute; inset: 0; pointer-events: none; }
        .gs-ball {
          position: absolute;
          transform: translate(-50%, -50%);
          pointer-events: auto;
          cursor: pointer;
          z-index: 10;
          touch-action: none;
        }
        .gs-ball.is-intercepted { animation: gsBurst 0.35s ease-out forwards; }
        .gs-ball.is-scored { animation: gsScored 0.4s ease-out forwards; }
        .gs-particle {
          position: absolute;
          transform: translate(-50%, -50%);
          pointer-events: none;
          animation: gsParticle 0.55s ease-out forwards;
          z-index: 20;
        }
        .gs-result {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 30;
          font: 900 clamp(40px, 14vw, 72px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em;
          pointer-events: none;
          text-shadow: 0 0 36px currentColor;
          animation: gsResultIn 0.25s ease-out both;
        }
        .gs-label {
          position: absolute;
          top: 12%;
          left: 50%;
          transform: translateX(-50%);
          font: 800 13px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em;
          color: rgba(255,255,255,.7);
          text-transform: uppercase;
          pointer-events: none;
          animation: gsFadeIn 0.4s ease-out both;
          white-space: nowrap;
          z-index: 5;
        }
        @keyframes gsBurst { to { transform: translate(-50%,-50%) scale(2.2); opacity: 0; } }
        @keyframes gsScored { to { transform: translate(-50%,-50%) scale(0.3); opacity: 0; } }
        @keyframes gsParticle {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
        @keyframes gsResultIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes gsFadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Goal frame SVG background — goalkeeper perspective, goal at bottom */}
      <svg className="gs-goal-frame" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Field gradient top */}
        <rect x="0" y="0" width="100" height="74" fill="rgba(43,255,154,.03)" />
        {/* Net fill — behind the goal (at bottom) */}
        <path d="M6 76H94L98 98H2Z" fill="rgba(255,255,255,.04)" />
        {/* Vertical net lines (perspective: converge upward) */}
        {[18, 32, 50, 68, 82].map((x) => (
          <line key={x} x1={x} y1="76" x2={50 + (x - 50) * 0.18} y2="98"
            stroke="rgba(255,255,255,.14)" strokeWidth="0.5" />
        ))}
        {/* Horizontal net lines */}
        {[80, 86, 92].map((y) => {
          const progress = (y - 76) / 22
          const left = 6 - progress * 4
          const right = 94 + progress * 4
          return <line key={y} x1={left} y1={y} x2={right} y2={y} stroke="rgba(255,255,255,.14)" strokeWidth="0.5" />
        })}
        {/* Goal posts */}
        <line x1="6" y1="76" x2="2" y2="98" stroke="rgba(255,255,255,.92)" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="94" y1="76" x2="98" y2="98" stroke="rgba(255,255,255,.92)" strokeWidth="1.8" strokeLinecap="round" />
        {/* Crossbar (top of goal) */}
        <line x1="6" y1="76" x2="94" y2="76" stroke="rgba(255,255,255,.92)" strokeWidth="1.8" />
        {/* Goal line at bottom */}
        <line x1="2" y1="98" x2="98" y2="98" stroke="rgba(255,255,255,.92)" strokeWidth="1.8" />
        {/* Ground / field lines */}
        <line x1="0" y1="74" x2="100" y2="74" stroke="rgba(255,255,255,.15)" strokeWidth="0.5" />
        {/* Penalty spot */}
        <circle cx="50" cy="40" r="1.2" fill="rgba(255,255,255,.25)" />
        {/* Penalty box outline */}
        <rect x="18" y="55" width="64" height="19" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="0.5" />
        {/* Goal area box */}
        <rect x="32" y="66" width="36" height="8" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="0.5" />
      </svg>

      <div className="gs-label">TOUCHE LES BALLONS !</div>

      {/* Balls */}
      {balls.map((ball) => {
        // Animate ball position via CSS animation
        const animName = `gsFly${ball.id}`
        const radius = ball.state === 'flying' ? undefined : ball.state === 'intercepted' ? 22 : 18
        return (
          <div key={ball.id}>
            <style>{`
              @keyframes ${animName} {
                0% { left: ${ball.startX}%; top: ${ball.startY}%; width: 22px; height: 22px; }
                100% { left: ${ball.endX}%; top: ${ball.endY}%; width: 60px; height: 60px; }
              }
              .gs-ball-${ball.id} {
                animation: ${animName} ${ball.duration}ms cubic-bezier(.2,.4,.6,1) ${ball.delay}ms both;
              }
            `}</style>
            <div
              className={`gs-ball gs-ball-${ball.id}${ball.state !== 'flying' ? ` is-${ball.state}` : ''}`}
              style={radius !== undefined ? { width: radius * 2, height: radius * 2 } : undefined}
              onPointerDown={(e) => {
                e.stopPropagation()
                const rect = containerRef.current?.getBoundingClientRect()
                if (rect && ball.state === 'flying') interceptBall(ball.id, e.clientX, e.clientY, rect)
              }}
            >
              <svg viewBox="0 0 80 80" width="100%" height="100%">
                <circle cx="40" cy="40" r="34" fill="#f7f9fc" stroke="#101827" strokeWidth="4" />
                <path d="M40 19 53 28 48 45H32L27 28Z" fill="none" stroke="#101827" strokeWidth="3" />
                <line x1="40" y1="6" x2="40" y2="19" stroke="#101827" strokeWidth="2" strokeLinecap="round" />
                <line x1="53" y1="28" x2="66" y2="22" stroke="#101827" strokeWidth="2" strokeLinecap="round" />
                <line x1="48" y1="45" x2="56" y2="57" stroke="#101827" strokeWidth="2" strokeLinecap="round" />
                <line x1="32" y1="45" x2="24" y2="57" stroke="#101827" strokeWidth="2" strokeLinecap="round" />
                <line x1="27" y1="28" x2="14" y2="22" stroke="#101827" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        )
      })}

      {/* Swipe trail */}
      {trail.length > 0 && (
        <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:25 }}>
          {trail.map((seg, i) => {
            const age = (Date.now() - seg.at) / 400
            return (
              <line key={seg.id}
                x1={`${seg.x1}%`} y1={`${seg.y1}%`}
                x2={`${seg.x2}%`} y2={`${seg.y2}%`}
                stroke="#2bff9a" strokeWidth={4 - i * 0.5}
                strokeLinecap="round"
                opacity={Math.max(0, 1 - age)}
              />
            )
          })}
        </svg>
      )}

      {/* Burst particles */}
      {particles.map((p) => (
        <div key={p.id} className="gs-particle" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
          <svg viewBox="0 0 40 40" width="40" height="40">
            {Array.from({ length: 8 }, (_, i) => {
              const angle = (i / 8) * Math.PI * 2
              return <circle key={i} cx={20 + Math.cos(angle) * 14} cy={20 + Math.sin(angle) * 14} r="4" fill="#FFB800" />
            })}
          </svg>
        </div>
      ))}

      {/* Result overlay */}
      {resultLabel ? (
        <div className="gs-result" style={{ color: resultLabel === 'ARRÊTÉ !' ? '#2bff9a' : '#FF4455' }}>
          {resultLabel}
        </div>
      ) : null}
    </div>
  )
}

export default GoalSave
