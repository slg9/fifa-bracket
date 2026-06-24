import { useEffect, useRef, useState } from 'react'

export interface FruitNinjaProps {
  balloonCount: number
  hasSonic: boolean
  onResult: (blocked: number, total: number, sonicBlocked: boolean) => void
}

type Balloon = {
  id: string
  type: 'normal' | 'sonic'
  x: number
  spawnDelay: number
  speed: number
  radius: number
}

type SwipeStart = { x: number; y: number; time: number }

function createBalloons(balloonCount: number, hasSonic: boolean): Balloon[] {
  const sonicIndex = hasSonic ? Math.max(0, balloonCount - 1 - Math.floor(Math.random() * Math.min(2, balloonCount))) : -1
  let delay = 0
  return Array.from({ length: balloonCount }, (_, index) => {
    if (index > 0) delay += Math.random() * 1200
    const type = index === sonicIndex ? 'sonic' : 'normal'
    return { id: crypto.randomUUID(), type, x: 10 + Math.random() * 80, spawnDelay: delay, speed: 1500 + Math.random() * 1500, radius: type === 'sonic' ? 22 : 28 }
  })
}

export function FruitNinjaDefense({ balloonCount, hasSonic, onResult }: FruitNinjaProps) {
  const [balloons] = useState<Balloon[]>(() => createBalloons(balloonCount, hasSonic))
  const [blockedIds, setBlockedIds] = useState<Set<string>>(() => new Set())
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set())
  const swipeStarts = useRef(new Map<string, SwipeStart>())
  const resultSent = useRef(false)

  const block = (id: string) => {
    setBlockedIds((current) => new Set(current).add(id))
    setResolvedIds((current) => new Set(current).add(id))
  }

  useEffect(() => {
    const timers = balloons.map((balloon) => window.setTimeout(() => {
      setResolvedIds((current) => new Set(current).add(balloon.id))
    }, balloon.spawnDelay + balloon.speed))
    return () => timers.forEach(window.clearTimeout)
  }, [balloons])

  useEffect(() => {
    if (resolvedIds.size !== balloons.length || resultSent.current) return
    resultSent.current = true
    const sonic = balloons.find((balloon) => balloon.type === 'sonic')
    window.setTimeout(() => onResult(blockedIds.size, balloons.length, sonic ? blockedIds.has(sonic.id) : false), 250)
  }, [balloons, blockedIds, onResult, resolvedIds])

  const pointerDown = (balloon: Balloon, event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (balloon.type === 'normal') block(balloon.id)
    else swipeStarts.current.set(balloon.id, { x: event.clientX, y: event.clientY, time: event.timeStamp })
  }

  const pointerUp = (balloon: Balloon, event: React.PointerEvent<SVGSVGElement>) => {
    if (balloon.type !== 'sonic') return
    const start = swipeStarts.current.get(balloon.id)
    if (!start) return
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (distance > 30 && event.timeStamp - start.time < 200) block(balloon.id)
    swipeStarts.current.delete(balloon.id)
  }

  return (
    <div className="brakup-defense" aria-label="Touchez les ballons et balayez le ballon Sonic">
      <div className="brakup-defense__hint">Touchez · ⚡ balayez vite</div>
      {balloons.map((balloon) => (
        <svg key={balloon.id} viewBox="0 0 80 80" className={`brakup-fruit brakup-fruit--${balloon.type}${blockedIds.has(balloon.id) ? ' is-blocked' : ''}`}
          style={{ left: `${balloon.x}%`, width: balloon.radius * 2, height: balloon.radius * 2, animationDelay: `${balloon.spawnDelay}ms`, animationDuration: `${balloon.speed}ms` }}
          onPointerDown={(event) => pointerDown(balloon, event)} onPointerUp={(event) => pointerUp(balloon, event)}>
          <circle cx="40" cy="40" r="35" fill={balloon.type === 'sonic' ? '#3B82F6' : '#fff'} stroke={balloon.type === 'sonic' ? '#60A5FA' : 'rgba(255,255,255,.3)'} strokeWidth="4" />
          {balloon.type === 'sonic'
            ? <path d="M45 8 25 43h14l-5 29 22-39H42z" fill="#fff" />
            : <path d="M40 18 50 26 47 40 33 40 30 26z M33 40 23 52M47 40 57 52" stroke="#07101e" strokeWidth="4" fill="none" />}
          {blockedIds.has(balloon.id) && Array.from({ length: 8 }, (_, index) => <circle key={index} className="brakup-fruit-particle" cx={40 + Math.cos(index * Math.PI / 4) * 24} cy={40 + Math.sin(index * Math.PI / 4) * 24} r="4" fill="#FFB800" />)}
        </svg>
      ))}
    </div>
  )
}

export default FruitNinjaDefense
