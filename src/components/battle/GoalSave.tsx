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
  delay: number
  duration: number
  state: BallState
}

function makeBalls(count: number, duration: number): Ball[] {
  const balls: Ball[] = []
  for (let i = 0; i < count; i++) {
    // spawn from random screen edges (0=top, 1=right, 2=bottom, 3=left)
    const edge = Math.floor(Math.random() * 4)
    let sx = 50, sy = 50
    if (edge === 0) { sx = 15 + Math.random() * 70; sy = -5 }
    else if (edge === 1) { sx = 105; sy = 10 + Math.random() * 60 }
    else if (edge === 2) { sx = 15 + Math.random() * 70; sy = 110 }
    else { sx = -5; sy = 10 + Math.random() * 60 }
    balls.push({ id: i, startX: sx, startY: sy, delay: i * 400, duration, state: 'flying' })
  }
  return balls
}

export function GoalSave({ ballCount, difficulty, onResult }: GoalSaveProps) {
  const duration = difficulty === 'easy' ? 1800 : difficulty === 'medium' ? 1400 : 1000
  const [balls, setBalls] = useState<Ball[]>(() => makeBalls(Math.min(3, Math.max(1, ballCount)), duration))
  const [particles, setParticles] = useState<{ id: number; x: number; y: number }[]>([])
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const endedRef = useRef(false)
  const resolvedRef = useRef(new Set<number>())
  const ballsRef = useRef(balls)
  ballsRef.current = balls

  // auto-resolve balls that reach goal
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    balls.forEach((ball) => {
      // after delay + duration, if still flying → scored
      const t = setTimeout(() => {
        setBalls((prev) => prev.map((b) => b.id === ball.id && b.state === 'flying' ? { ...b, state: 'scored' as const } : b))
        resolvedRef.current.add(ball.id)
      }, ball.delay + ball.duration + 50)
      timers.push(t)
    })
    return () => timers.forEach(clearTimeout)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // check resolution
  useEffect(() => {
    if (endedRef.current) return
    const allResolved = balls.every((b) => b.state !== 'flying')
    if (!allResolved) return
    const saved = balls.every((b) => b.state === 'intercepted')
    endedRef.current = true
    setResultLabel(saved ? 'ARRÊTÉ !' : 'BUT !')
    const t = setTimeout(() => onResult(saved), 900)
    return () => clearTimeout(t)
  }, [balls, onResult])

  const interceptBall = (id: number, clientX: number, clientY: number, containerRect: DOMRect) => {
    if (endedRef.current) return
    setBalls((prev) => prev.map((b) => b.id === id && b.state === 'flying' ? { ...b, state: 'intercepted' as const } : b))
    const px = (clientX - containerRect.left) / containerRect.width * 100
    const py = (clientY - containerRect.top) / containerRect.height * 100
    setParticles((prev) => [...prev, { id: Date.now() + id, x: px, y: py }])
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== Date.now() + id)), 600)
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // swipe detection
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeRef.current) return
    const dx = e.clientX - swipeRef.current.x
    const dy = e.clientY - swipeRef.current.y
    const dist = Math.hypot(dx, dy)
    if (dist < 18) return
    swipeRef.current = { x: e.clientX, y: e.clientY }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    // find nearest flying ball to swipe path
    const mx = (e.clientX - rect.left) / rect.width * 100
    const my = (e.clientY - rect.top) / rect.height * 100
    const now = Date.now()
    ballsRef.current.forEach((ball) => {
      if (ball.state !== 'flying') return
      // estimate ball position based on animation progress
      const elapsed = now - ball.delay
      if (elapsed < 0) return
      const progress = Math.min(1, elapsed / ball.duration)
      const bx = ball.startX + (50 - ball.startX) * progress
      const by = ball.startY + (85 - ball.startY) * progress
      const d = Math.hypot(mx - bx, my - by)
      if (d < 14) {
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

      {/* Goal frame SVG background */}
      <svg className="gs-goal-frame" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Net fill */}
        <path d="M8 20H92L96 88H4Z" fill="rgba(255,255,255,.03)" />
        {/* Vertical net lines */}
        {[20, 34, 48, 62, 76].map((x) => (
          <line key={x} x1={x} y1="20" x2={x + (x - 50) * 0.08} y2="88"
            stroke="rgba(255,255,255,.12)" strokeWidth="0.5" />
        ))}
        {/* Horizontal net lines */}
        {[35, 50, 65, 80].map((y) => {
          const progress = (y - 20) / 68
          const left = 8 - progress * 4
          const right = 92 + progress * 4
          return <line key={y} x1={left} y1={y} x2={right} y2={y} stroke="rgba(255,255,255,.12)" strokeWidth="0.5" />
        })}
        {/* Goal frame */}
        <path d="M4 88L8 20H92L96 88" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="4" y1="88" x2="96" y2="88" stroke="rgba(255,255,255,.9)" strokeWidth="1.5" />
        {/* Top crossbar */}
        <line x1="8" y1="20" x2="92" y2="20" stroke="rgba(255,255,255,.9)" strokeWidth="1.5" />
        {/* Ground */}
        <line x1="0" y1="90" x2="100" y2="90" stroke="rgba(255,255,255,.2)" strokeWidth="0.5" />
      </svg>

      <div className="gs-label">TOUCHEZ LES BALLONS !</div>

      {/* Balls */}
      {balls.map((ball) => {
        // Animate ball position via CSS animation
        const animName = `gsFly${ball.id}`
        const radius = ball.state === 'flying' ? undefined : ball.state === 'intercepted' ? 22 : 18
        return (
          <div key={ball.id}>
            <style>{`
              @keyframes ${animName} {
                0% { left: ${ball.startX}%; top: ${ball.startY}%; width: 20px; height: 20px; }
                100% { left: 50%; top: 85%; width: 56px; height: 56px; }
              }
              .gs-ball-${ball.id} {
                animation: ${animName} ${ball.duration}ms linear ${ball.delay}ms both;
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
