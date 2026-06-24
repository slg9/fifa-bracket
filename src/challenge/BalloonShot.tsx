import { useEffect, useRef, useState } from 'react'
import type { BattleDifficulty } from '../types'

export interface BalloonShotProps {
  difficulty: BattleDifficulty
  onResult: (result: 'goal' | 'saved' | 'wide' | 'weak') => void
  teamColor?: string
}

export function BalloonShot({ difficulty, onResult, teamColor = '#2bff9a' }: BalloonShotProps) {
  const maxRadius = typeof window !== 'undefined' && window.innerWidth <= 680 ? 80 : 100
  const [targetRadius] = useState(() => maxRadius * (0.4 + Math.random() * 0.35))
  const [ballRadius, setBallRadius] = useState(8)
  const [isPressing, setIsPressing] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const finishedRef = useRef(false)
  const startRef = useRef(0)
  const radiusRef = useRef(8)
  const animationRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const circumference = 2 * Math.PI * 90

  const finish = (forced?: 'saved') => {
    if (finishedRef.current) return
    finishedRef.current = true
    setIsPressing(false)
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    if (forced) {
      onResult(forced)
      return
    }
    const tolerance = targetRadius * (difficulty === 'easy' ? 0.12 : difficulty === 'hard' ? 0.06 : 0.08)
    const radius = radiusRef.current
    onResult(radius < targetRadius - tolerance ? 'weak' : radius > targetRadius + tolerance ? 'wide' : 'goal')
  }

  const grow = (now: number) => {
    const duration = now - startRef.current
    const next = Math.min(maxRadius, 8 + (duration / 16) * 4)
    radiusRef.current = next
    setBallRadius(next)
    setElapsed(Math.min(3000, duration))
    if (!finishedRef.current) animationRef.current = requestAnimationFrame(grow)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (finishedRef.current || isPressing) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setHasStarted(true)
    setIsPressing(true)
    startRef.current = performance.now()
    animationRef.current = requestAnimationFrame(grow)
    timeoutRef.current = window.setTimeout(() => finish('saved'), 3000)
  }

  useEffect(() => () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
  }, [])

  return (
    <div className={`brakup-shot${isPressing ? ' is-pressing' : ''}`} onPointerDown={handlePointerDown} onPointerUp={() => isPressing && finish()} onPointerCancel={() => isPressing && finish('saved')} onPointerLeave={() => isPressing && finish()} role="button" tabIndex={0} aria-label="Maintenir puis relâcher pour tirer">
      <svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="brakup-ball-gradient" cx="35%" cy="30%"><stop offset="0" stopColor="#fff" /><stop offset="0.7" stopColor="#dbe2eb" /><stop offset="1" stopColor="#64748b" /></radialGradient>
          <pattern id="brakup-ball-pattern" width="24" height="24" patternUnits="userSpaceOnUse"><polygon points="12,3 20,9 17,19 7,19 4,9" fill="#07101e" opacity=".85" /></pattern>
        </defs>
        <rect width="200" height="200" rx="24" fill="rgba(1,7,18,.78)" />
        <circle className="brakup-target-ring" cx="100" cy="100" r={targetRadius} fill="none" stroke="#FFB800" strokeWidth="3" />
        <circle cx="100" cy="100" r={ballRadius} fill="url(#brakup-ball-gradient)" stroke={teamColor} strokeWidth="1.5" />
        <circle cx="100" cy="100" r={ballRadius} fill="url(#brakup-ball-pattern)" opacity=".75" />
        <circle className="brakup-shot-timer" cx="100" cy="100" r="90" fill="none" stroke="#2bff9a" strokeWidth="4" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - elapsed / 3000)} transform="rotate(-90 100 100)" />
        {!hasStarted && <text x="100" y="106" textAnchor="middle" className="brakup-shot-label">APPUIE</text>}
      </svg>
    </div>
  )
}

export default BalloonShot
