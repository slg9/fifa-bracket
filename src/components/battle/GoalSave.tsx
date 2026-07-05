import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BattleDifficulty } from '../../types'
import type { TeamKit } from '../../lib/teamKits'
import { playGameSound } from '../../lib/useGameAudio'
import { sfx } from '../../lib/sfx'
import { hasSeenBattleTutorial, markBattleTutorialSeen, type BattleTutorialId } from './tutorialPrefs'
import KawaiiSprite, { KAWAII_SPRITE_CSS } from './KawaiiSprite'

export type GoalSaveProps = {
  ballCount: number
  difficulty: BattleDifficulty
  onResult: (saved: boolean) => void
  playerKit?: TeamKit
  opponentKit?: TeamKit
  opponentName?: string
  opponentFlag?: string
  keeperName?: string
  alertNames?: string[]
  mode?: 'goal_save' | 'penalty' | 'sudden_death'
  onAudioOverride?: (src: string | null) => void
  roundIntroComment?: string
  onRetry?: () => void
  retryLabel?: string
  startLabel?: string
}

type BallType = 'normal' | 'fast' | 'curveLeft' | 'curveRight' | 'delayed' | 'doubleTap' | 'fake'
type BallState = 'waiting' | 'flying' | 'intercepted' | 'scored' | 'expired'

type Ball = {
  id: number
  wave: number
  type: BallType
  startX: number
  startY: number
  endX: number
  endY: number
  cp1X: number
  cp1Y: number
  cp2X: number
  cp2Y: number
  delay: number
  duration: number
  health: number
  maxHealth: number
  state: BallState
  speedFeel: number
  spinDirection: 1 | -1
  lastHitAt?: number
}

type BallPosition = { x: number; y: number; progress: number; raw: number; started: boolean }
type Particle = { id: number; x: number; y: number; tone: 'save' | 'score' | 'combo' }
type TrailSegment = { id: string; x1: number; y1: number; x2: number; y2: number; at: number }

type GoalSaveConfig = {
  waves: number
  minBallsPerWave: number
  maxBallsPerWave: number
  durationRange: [number, number]
  delayRange: [number, number]
  allowedMisses: number
  swipeRadius: number
}

const GOAL_SAVE_DIFFICULTY: Record<BattleDifficulty, GoalSaveConfig> = {
  easy: {
    waves: 3,
    minBallsPerWave: 2,
    maxBallsPerWave: 3,
    durationRange: [2300, 2850],
    delayRange: [420, 760],
    allowedMisses: 0,
    swipeRadius: 0.105,
  },
  medium: {
    waves: 3,
    minBallsPerWave: 3,
    maxBallsPerWave: 4,
    durationRange: [2050, 2550],
    delayRange: [340, 640],
    allowedMisses: 0,
    swipeRadius: 0.095,
  },
  hard: {
    waves: 3,
    minBallsPerWave: 4,
    maxBallsPerWave: 5,
    durationRange: [1780, 2250],
    delayRange: [280, 520],
    allowedMisses: 0,
    swipeRadius: 0.085,
  },
}

const GOAL_ZONE = { minX: 8, maxX: 92, minY: 78, scoreY: 94 }
const MIN_SWIPE_DISTANCE = 3
const MIN_SWIPE_SPEED = 0.035
const DOUBLE_TAP_WINDOW_MS = 1050

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}


function easeBall(type: BallType, t: number) {
  const smooth = t * t * (3 - 2 * t)
  if (type === 'fast') return Math.pow(t, 1.28)
  if (type === 'delayed') return Math.pow(smooth, 1.18)
  if (type === 'curveLeft' || type === 'curveRight') return Math.pow(smooth, 0.94)
  return smooth
}

function cubicBezierPoint(ball: Ball, t: number) {
  const mt = 1 - t
  return {
    x: mt * mt * mt * ball.startX + 3 * mt * mt * t * ball.cp1X + 3 * mt * t * t * ball.cp2X + t * t * t * ball.endX,
    y: mt * mt * mt * ball.startY + 3 * mt * mt * t * ball.cp1Y + 3 * mt * t * t * ball.cp2Y + t * t * t * ball.endY,
  }
}

function getBallPosition(ball: Ball, now: number, startTime: number): BallPosition {
  const elapsed = now - startTime - ball.delay
  const raw = clamp(elapsed / ball.duration, 0, 1)
  const eased = easeBall(ball.type, raw)
  const point = cubicBezierPoint(ball, eased)
  return { ...point, progress: eased, raw, started: elapsed >= 0 }
}

function distancePointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1)
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

function pointToClient(rect: DOMRect, point: BallPosition) {
  return {
    x: rect.left + (point.x / 100) * rect.width,
    y: rect.top + (point.y / 100) * rect.height,
  }
}

function makeGoalSaveBalls(ballCount: number, difficulty: BattleDifficulty, mode: 'goal_save' | 'penalty' | 'sudden_death' = 'goal_save') {
  const cfg = GOAL_SAVE_DIFFICULTY[difficulty]
  const isPenalty = mode === 'penalty'
  const isSuddenDeath = mode === 'sudden_death'
  const isSpotKick = isPenalty || isSuddenDeath
  const danger = clamp(ballCount, 1, 3)
  const balls: Ball[] = []
  const count = isSpotKick ? 1 : clamp(Math.round(ballCount), 1, 6)
  const penaltyDurationBase = isSuddenDeath
    ? difficulty === 'hard' ? 1120 : difficulty === 'medium' ? 1260 : 1400
    : difficulty === 'hard' ? 1460 : difficulty === 'medium' ? 1640 : 1820

  for (let i = 0; i < count; i += 1) {
    const type: BallType = isSpotKick ? (isSuddenDeath && Math.random() < 0.42 ? 'fast' : Math.random() < 0.34 ? 'curveLeft' : Math.random() < 0.52 ? 'curveRight' : 'normal') : difficulty === 'hard' && i === 0 ? 'fast' : i % 2 ? 'curveLeft' : 'normal'
    const laneX = isSpotKick ? randomBetween(24, 76) : 22 + ((i + 1) / (count + 1)) * 56
    const endX = clamp(laneX + randomBetween(-6, 6), 18, 82)
    const startX = clamp(endX + randomBetween(-24, 24), 8, 92)
    const startY = isSpotKick ? randomBetween(5, 11) : randomBetween(10, 18)
    const endY = randomBetween(94, 97)
    const curveDir = type === 'curveLeft' ? -1 : Math.random() < 0.5 ? -1 : 1
    const curvePower = type === 'fast' ? 8 : randomBetween(10, 20)
    const baseDuration = isSpotKick ? penaltyDurationBase : randomBetween(cfg.durationRange[0], cfg.durationRange[1])
    const pressureTrim = isSpotKick ? 0 : (danger - 1) * 70 + i * 35
    const typeTrim = type === 'fast' ? 170 : type === 'curveLeft' || type === 'curveRight' ? 60 : 0
    const duration = Math.max(isSuddenDeath ? 1040 : isPenalty ? 1320 : 1680, baseDuration - pressureTrim - typeTrim)
    const delay = isSuddenDeath ? 120 : isPenalty ? 3100 : 220 + i * randomBetween(cfg.delayRange[0], cfg.delayRange[1])

    balls.push({
      id: i + 1,
      wave: 0,
      type,
      startX,
      startY,
      endX,
      endY,
      cp1X: clamp(startX + (endX - startX) * 0.22 + curveDir * curvePower, -8, 108),
      cp1Y: randomBetween(24, 38),
      cp2X: clamp(endX - curveDir * curvePower * 0.32, 0, 100),
      cp2Y: randomBetween(58, 72),
      delay,
      duration,
      health: 1,
      maxHealth: 1,
      state: 'waiting',
      speedFeel: clamp(1.2 - duration / 2800, 0.2, 1),
      spinDirection: Math.random() < 0.5 ? -1 : 1,
    })
  }

  return balls
}

export function GoalSave({ ballCount, difficulty, onResult, playerKit, opponentKit, opponentName, opponentFlag, keeperName, alertNames = [], mode = 'goal_save', onAudioOverride, roundIntroComment, onRetry, retryLabel, startLabel }: GoalSaveProps) {
  const cfg = GOAL_SAVE_DIFFICULTY[difficulty]
  const isPenalty = mode === 'penalty'
  const isSuddenDeath = mode === 'sudden_death'
  const tutorialId: BattleTutorialId = isPenalty || isSuddenDeath ? 'penalty' : 'goal-save'
  const showKicker = isPenalty || isSuddenDeath
  const autoResolve = !isPenalty
  const playerJerseyColor = playerKit?.primary ?? '#2bff9a'
  const playerAccentColor = playerKit?.secondary ?? '#FFB800'
  const playerShortsColor = playerKit?.shorts ?? '#101827'
  const playerTextColor = playerKit?.text ?? '#ffffff'
  const opponentJerseyColor = opponentKit?.primary ?? '#FF4455'
  const opponentAccentColor = opponentKit?.secondary ?? '#7dd3fc'
  const opponentShortsColor = opponentKit?.shorts ?? '#101827'
  const opponentTextColor = opponentKit?.text ?? '#ffffff'
  const [balls, setBalls] = useState<Ball[]>(() => makeGoalSaveBalls(ballCount, difficulty, mode))
  const [penaltyCountdown, setPenaltyCountdown] = useState<number | null>(null)
  const [tutorialDone, setTutorialDone] = useState(false)
  const [showGoalSaveTutorial, setShowGoalSaveTutorial] = useState(true)
  const [showGoalSaveDemo, setShowGoalSaveDemo] = useState(() => !hasSeenBattleTutorial(tutorialId))
  const [tutorialCountdown, setTutorialCountdown] = useState<number | null>(null)
  const [particles, setParticles] = useState<Particle[]>([])
  const [trail, setTrail] = useState<TrailSegment[]>([])
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const [pendingResult, setPendingResult] = useState<boolean | null>(null)
  const [renderNow, setRenderNow] = useState(() => performance.now())
  const [scoreFlash, setScoreFlash] = useState(false)
  const [shake, setShake] = useState(false)
  const [missedCount, setMissedCount] = useState(0)
  const [stoppedCount, setStoppedCount] = useState(0)
  const [combo, setCombo] = useState(0)
const [hitFreeze, setHitFreeze] = useState(false)
  const alertNamesLabel = alertNames.length ? `${alertNames.slice(0, 4).join(', ')}${alertNames.length > 4 ? ` +${alertNames.length - 4}` : ''}` : ''
  const keeperLabel = keeperName ?? 'Gardien'

  const containerRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef(performance.now())
  const rafRef = useRef(0)
  const endedRef = useRef(false)
  const ballsRef = useRef(balls)
  const onResultRef = useRef(onResult)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const swipeRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const missedRef = useRef(0)
  const stoppedRef = useRef(0)
  const comboRef = useRef({ count: 0, lastAt: 0 })

  ballsRef.current = balls
  onResultRef.current = onResult

  useEffect(() => {
    if (isPenalty || isSuddenDeath) {
      onAudioOverride?.(null)
      const heart = playGameSound('/audio/heart.mp3', { volume: 0.88, loop: true, kind: 'ambience' })
      return () => {
        heart?.stop()
        onAudioOverride?.(null)
      }
    }
    onAudioOverride?.('/audio/save-the-chaos.mp3')
    return () => onAudioOverride?.(null)
  }, [isPenalty, isSuddenDeath, onAudioOverride])

  useEffect(() => {
    if (!isPenalty || !tutorialDone) return
    sfx.countdownTick()
    setPenaltyCountdown(3)
    const t1 = window.setTimeout(() => { setPenaltyCountdown(2); sfx.countdownTick() }, 800)
    const t2 = window.setTimeout(() => { setPenaltyCountdown(1); sfx.countdownTick() }, 1600)
    const t3 = window.setTimeout(() => { setPenaltyCountdown(0); sfx.countdownGo(); sfx.whistle() }, 2400)
    const t4 = window.setTimeout(() => setPenaltyCountdown(null), 3050)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
    }
  }, [isPenalty, tutorialDone])

  const addTimer = useCallback((callback: () => void, ms: number) => {
    const timer = window.setTimeout(callback, ms)
    timersRef.current.push(timer)
    return timer
  }, [])

  const clearManagedTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  const startGoalSaveTutorial = useCallback(() => {
    sfx.click()
    markBattleTutorialSeen(tutorialId)
    setShowGoalSaveTutorial(false)
    sfx.countdownTick()
    setTutorialCountdown(3)
    addTimer(() => { setTutorialCountdown(2); sfx.countdownTick() }, 800)
    addTimer(() => { setTutorialCountdown(1); sfx.countdownTick() }, 1600)
    addTimer(() => { setTutorialCountdown(0); sfx.countdownGo(); sfx.whistle() }, 2400)
    addTimer(() => {
      setTutorialCountdown(null)
      setTutorialDone(true)
    }, 3050)
  }, [addTimer, tutorialId])

  const updateBalls = useCallback((updater: (prev: Ball[]) => Ball[]) => {
    setBalls((prev) => {
      const next = updater(prev)
      ballsRef.current = next
      return next
    })
  }, [])

  const addParticle = useCallback((x: number, y: number, tone: Particle['tone']) => {
    const id = Date.now() + Math.floor(Math.random() * 10000)
    setParticles((prev) => [...prev, { id, x, y, tone }])
    addTimer(() => setParticles((prev) => prev.filter((particle) => particle.id !== id)), 720)
  }, [addTimer])

  const resolve = useCallback((saved: boolean, label: string) => {
    if (endedRef.current) return
    endedRef.current = true
    setResultLabel(label)
    setPendingResult(saved)
    if (!saved) playGameSound('/audio/sad.mp3', { volume: 0.86 })
    if (autoResolve) {
      addTimer(() => onResultRef.current(saved), 780)
    }
  }, [addTimer, autoResolve])

  const maybeFinishIfComplete = useCallback((nextBalls: Ball[]) => {
    if (endedRef.current) return
    const complete = nextBalls.every((ball) => ball.state === 'intercepted' || ball.state === 'scored' || ball.state === 'expired')
    if (!complete) return
    resolve(true, 'SAUVE !')
  }, [cfg.allowedMisses, resolve])

  const missBall = useCallback((ball: Ball, point: BallPosition) => {
    if (endedRef.current) return
    if (ball.type === 'fake') {
      updateBalls((prev) => {
        const next = prev.map((item) => item.id === ball.id ? { ...item, state: 'expired' as const } : item)
        maybeFinishIfComplete(next)
        return next
      })
      return
    }

    missedRef.current += 1
    setMissedCount(missedRef.current)
    setScoreFlash(true)
    setShake(true)
    addParticle(point.x, point.y, 'score')
    addTimer(() => setScoreFlash(false), 220)
    addTimer(() => setShake(false), 180)

    updateBalls((prev) => {
      const next = prev.map((item) => item.id === ball.id ? { ...item, state: 'scored' as const } : item)
      resolve(false, 'BUT !')
      return next
    })
  }, [addParticle, addTimer, resolve, updateBalls])

  const registerCombo = useCallback((x: number, y: number) => {
    const now = performance.now()
    const nextCombo = now - comboRef.current.lastAt <= 800 ? comboRef.current.count + 1 : 1
    comboRef.current = { count: nextCombo, lastAt: now }
    setCombo(nextCombo)
    if (nextCombo >= 2) addParticle(x, y, 'combo')
    addTimer(() => {
      if (performance.now() - comboRef.current.lastAt >= 760) {
        comboRef.current = { count: 0, lastAt: 0 }
        setCombo(0)
      }
    }, 820)
  }, [addParticle, addTimer])

  const interceptBall = useCallback((ball: Ball, point: BallPosition, now: number) => {
    if (endedRef.current || (ball.state !== 'flying' && ball.state !== 'waiting')) return
    sfx.slice()
    playGameSound('/audio/ball-kick.mp3', { volume: 0.82 })

    updateBalls((prev) => {
      let didStop = false
      let didDamage = false
      const next = prev.map((item) => {
        if (item.id !== ball.id || item.state === 'intercepted' || item.state === 'scored' || item.state === 'expired') return item
        if (item.type === 'fake') {
          didStop = true
          return { ...item, state: 'intercepted' as const }
        }
        if (item.health > 1) {
          const fastEnoughSecondCut = item.lastHitAt == null || now - item.lastHitAt <= DOUBLE_TAP_WINDOW_MS
          if (!fastEnoughSecondCut) return { ...item, lastHitAt: now }
          didDamage = true
          const nextHealth = item.health - 1
          if (nextHealth <= 0) {
            didStop = true
            return { ...item, health: 0, state: 'intercepted' as const }
          }
          return { ...item, health: nextHealth, lastHitAt: now }
        }
        didStop = true
        return { ...item, state: 'intercepted' as const }
      })

      if (didStop) {
        stoppedRef.current += ball.type === 'fake' ? 0 : 1
        setStoppedCount(stoppedRef.current)
        addParticle(point.x, point.y, 'save')
        registerCombo(point.x, point.y)
        maybeFinishIfComplete(next)
      } else if (didDamage) {
        addParticle(point.x, point.y, 'combo')
        setHitFreeze(true)
        addTimer(() => setHitFreeze(false), 55)
      }
      return next
    })
  }, [addParticle, addTimer, maybeFinishIfComplete, registerCombo, updateBalls])

  useEffect(() => {
    if (!tutorialDone || penaltyCountdown !== null) return
    startTimeRef.current = performance.now()

    const tick = (now: number) => {
      setRenderNow(now)
      if (!endedRef.current) {
        for (const ball of ballsRef.current) {
          if (ball.state === 'intercepted' || ball.state === 'scored' || ball.state === 'expired') continue
          const point = getBallPosition(ball, now, startTimeRef.current)
          if (!point.started) continue
          if (ball.state === 'waiting') {
            updateBalls((prev) => prev.map((item) => item.id === ball.id ? { ...item, state: 'flying' as const } : item))
          }
          const crossedGoal = point.raw >= 1 || (point.y >= GOAL_ZONE.scoreY && point.x >= GOAL_ZONE.minX && point.x <= GOAL_ZONE.maxX)
          if (crossedGoal) {
            missBall(ball, point)
            break
          }
        }
      }
      if (!endedRef.current) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      clearManagedTimers()
    }
  }, [clearManagedTimers, missBall, penaltyCountdown, tutorialDone, updateBalls])

  const testSwipeSegment = useCallback((x1: number, y1: number, x2: number, y2: number, rect: DOMRect, velocity: number) => {
    if (!tutorialDone || penaltyCountdown !== null) return
    if (velocity < MIN_SWIPE_SPEED) return
    const now = performance.now()
    for (const ball of ballsRef.current) {
      if (ball.state === 'intercepted' || ball.state === 'scored' || ball.state === 'expired') continue
      const point = getBallPosition(ball, now, startTimeRef.current)
      if (!point.started || point.raw >= 1) continue
      const clientPoint = pointToClient(rect, point)
      const radiusMultiplier = ball.type === 'fast' ? 1.02 : ball.type === 'doubleTap' ? 1.24 : ball.type === 'fake' ? 1 : 1.12
      const radius = clamp(rect.width * cfg.swipeRadius, 34, 58) * radiusMultiplier
      if (distancePointToSegment(clientPoint.x, clientPoint.y, x1, y1, x2, y2) <= radius) {
        interceptBall(ball, point, now)
      }
    }
  }, [cfg.swipeRadius, interceptBall, penaltyCountdown, tutorialDone])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (endedRef.current || !tutorialDone || penaltyCountdown !== null) return
    const now = performance.now()
    swipeRef.current = { x: event.clientX, y: event.clientY, at: now }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* noop */ }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    for (const ball of ballsRef.current) {
      if (ball.state === 'intercepted' || ball.state === 'scored' || ball.state === 'expired') continue
      const point = getBallPosition(ball, now, startTimeRef.current)
      if (!point.started || point.raw >= 1) continue
      const clientPoint = pointToClient(rect, point)
      const radiusMultiplier = ball.type === 'fast' ? 1 : ball.type === 'doubleTap' ? 1.18 : 1.08
      const directRadius = clamp(rect.width * cfg.swipeRadius, 32, 56) * radiusMultiplier
      if (Math.hypot(clientPoint.x - event.clientX, clientPoint.y - event.clientY) <= directRadius) {
        interceptBall(ball, point, now)
        break
      }
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeRef.current && event.pointerType === 'mouse') {
      handlePointerDown(event)
      return
    }
    if (!swipeRef.current || endedRef.current || !tutorialDone || penaltyCountdown !== null) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const prev = swipeRef.current
    const now = performance.now()
    const distance = Math.hypot(event.clientX - prev.x, event.clientY - prev.y)
    const dt = Math.max(12, now - prev.at)
    if (distance < MIN_SWIPE_DISTANCE) return
    const velocity = distance / dt
    setTrail((prevTrail) => [
      ...prevTrail.filter((item) => now - item.at < 280),
      {
        id: crypto.randomUUID(),
        x1: ((prev.x - rect.left) / rect.width) * 100,
        y1: ((prev.y - rect.top) / rect.height) * 100,
        x2: ((event.clientX - rect.left) / rect.width) * 100,
        y2: ((event.clientY - rect.top) / rect.height) * 100,
        at: now,
      },
    ])
    testSwipeSegment(prev.x, prev.y, event.clientX, event.clientY, rect, velocity)
    swipeRef.current = { x: event.clientX, y: event.clientY, at: now }
  }

  const endSwipe = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event) {
      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* noop */ }
    }
    swipeRef.current = null
  }

  useEffect(() => {
    if (!trail.length) return
    const timer = window.setTimeout(() => {
      const now = performance.now()
      setTrail((prev) => prev.filter((item) => now - item.at < 280))
    }, 70)
    return () => clearTimeout(timer)
  }, [trail])

  const handleResultContinue = useCallback(() => {
    if (pendingResult === null) return
    sfx.click()
    onResultRef.current(pendingResult)
  }, [pendingResult])

  const activeBalls = balls.map((ball) => ({ ball, point: getBallPosition(ball, renderNow, startTimeRef.current) }))
  const currentWave = Math.max(0, Math.min(cfg.waves - 1, balls.reduce((wave, ball) => {
    if (renderNow - startTimeRef.current >= ball.delay - 150) return Math.max(wave, ball.wave)
    return wave
  }, 0)))
  const waveStart = balls.find((ball) => ball.wave === currentWave)?.delay ?? 0
  const showWaveLabel = renderNow - startTimeRef.current - waveStart < 850
  const totalRealBalls = balls.filter((ball) => ball.type !== 'fake').length

  return (
    <div
      ref={containerRef}
      className={`gs-container${isPenalty ? ' is-penalty' : ''}${isSuddenDeath ? ' is-sudden-death' : ''}${scoreFlash ? ' is-score-flash' : ''}${shake ? ' is-shaking' : ''}${hitFreeze ? ' is-freeze' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endSwipe}
      onPointerCancel={endSwipe}
      onPointerLeave={endSwipe}
    >
      <style>{`
        .gs-container { position:relative; width:100%; height:100%; overflow:hidden; touch-action:none; user-select:none; cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%23f7fbff' stroke='%230b1726' stroke-width='4' stroke-linejoin='round' d='M17 45C12 36 12 25 19 19c5-4 10-2 12 4l2-12c1-5 6-7 10-5 4 1 6 5 5 10l-1 11 4-11c2-4 6-5 10-3 4 2 5 6 4 10l-3 12 4-9c2-4 6-4 9-2 3 2 4 6 2 9l-6 16c-3 7-9 12-16 13l-11 2c-8 1-15-2-19-9Z'/%3E%3C/svg%3E") 18 18,crosshair; background:radial-gradient(circle at 50% 11%,rgba(43,255,154,.11),transparent 28%),linear-gradient(180deg,#061426 0%,#081b1a 48%,#07130c 74%,#030806 100%); font-family:'Barlow Condensed',sans-serif; }
        .gs-container.is-penalty { background:radial-gradient(circle at 50% 14%,rgba(255,68,85,.13),transparent 26%),radial-gradient(circle at 50% 96%,rgba(43,255,154,.11),transparent 32%),linear-gradient(180deg,#061426 0%,#082324 48%,#07130c 74%,#030806 100%); }
        .gs-container.is-sudden-death { background:radial-gradient(circle at 50% 14%,rgba(255,68,85,.22),transparent 28%),radial-gradient(circle at 50% 96%,rgba(255,184,0,.14),transparent 34%),linear-gradient(180deg,#090d18 0%,#081b1a 48%,#07130c 74%,#030806 100%); }
        .gs-penalty-kicker { position:absolute; top:9%; left:50%; z-index:9; transform:translateX(-50%); display:grid; place-items:center; gap:2px; color:#fff; pointer-events:none; filter:drop-shadow(0 10px 18px rgba(0,0,0,.42)); animation:gsKickerPulse .7s ease-in-out infinite alternate; }
        ${KAWAII_SPRITE_CSS}
        .gs-container.is-sudden-death .gs-penalty-kicker { top:12%; animation:gsKickerStrike .55s ease-in-out infinite alternate; }
        .gs-penalty-kicker__flag { display:grid; place-items:center; width:31px; height:31px; border-radius:50%; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.22); font-size:19px; margin-bottom:-4px; }
        .gs-penalty-kicker__name { padding:4px 9px; border-radius:999px; background:rgba(2,8,16,.62); border:1px solid rgba(255,255,255,.12); font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.13em; text-transform:uppercase; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .gs-penalty-countdown { position:absolute; inset:0; z-index:35; display:grid; place-items:center; pointer-events:none; }
        .gs-penalty-countdown span { display:grid; place-items:center; width:118px; aspect-ratio:1; border-radius:50%; color:#fff; background:radial-gradient(circle,rgba(2,8,16,.86) 0 58%,transparent 60%),conic-gradient(#FFB800 0 80%,rgba(255,255,255,.14) 80%); box-shadow:0 0 42px rgba(255,184,0,.32); font:900 52px 'Barlow Condensed',sans-serif; letter-spacing:.12em; animation:gsPenaltyCount .72s ease-out both; }
        .gs-tutorial-open { position:absolute; z-index:41; top:max(76px, calc(env(safe-area-inset-top) + 56px)); right:12px; padding:9px 13px; border-radius:999px; border:1px solid rgba(255,255,255,.62); background:rgba(3,5,9,.74); color:#fff; font:900 12px 'Barlow Condensed',sans-serif; letter-spacing:.12em; text-transform:uppercase; box-shadow:0 0 18px rgba(255,255,255,.1); backdrop-filter:blur(8px); cursor:pointer; }
        .gs-tutorial-open:active { transform:scale(.96); }
        .gs-tutorial { position:absolute; inset:0; z-index:42; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:11px; padding:22px 20px; text-align:center; background:linear-gradient(180deg, rgba(255,255,255,.055), transparent 34%), #030509; backdrop-filter:blur(4px) grayscale(1); color:#fff; }
        .gs-tutorial__title { font:900 clamp(30px,9vw,48px) 'Barlow Condensed',sans-serif; color:#fff; letter-spacing:.16em; text-transform:uppercase; text-align:center; text-shadow:0 0 24px rgba(255,255,255,.28); }
        .gs-tutorial__comment { display:grid; grid-template-columns:58px minmax(0,1fr); align-items:center; gap:10px; width:min(86vw,340px); padding:9px 11px; border:1px solid rgba(255,255,255,.22); border-left:3px solid #fff; border-radius:14px; background:rgba(255,255,255,.06); box-shadow:0 14px 28px rgba(0,0,0,.28); text-align:left; }
        .gs-tutorial__avatar { width:58px; height:64px; display:grid; place-items:center; overflow:visible; filter:drop-shadow(0 8px 12px rgba(0,0,0,.42)); animation:gsKickerPulse .7s ease-in-out infinite alternate; }
        .gs-tutorial__comment p { margin:0; color:#fff; font:800 clamp(13px,3.8vw,16px) 'Barlow Condensed',sans-serif; line-height:1.3; letter-spacing:.04em; }
        .gs-tutorial__comment strong { color:#fff; text-shadow:0 0 12px rgba(255,255,255,.28); }
        .gs-tutorial__text { max-width:340px; padding:10px 12px; border-left:3px solid #fff; background:rgba(255,255,255,.06); color:rgba(255,255,255,.9); font:800 clamp(13px,3.8vw,16px) 'Barlow Condensed',sans-serif; line-height:1.32; letter-spacing:.05em; }
        .gs-tutorial__text strong { font-weight:950; color:#fff; text-shadow:0 0 12px rgba(255,255,255,.32); }
        .gs-tutorial__sub { max-width:300px; color:rgba(255,255,255,.62); font:800 clamp(11px,3.4vw,13px) 'Barlow Condensed',sans-serif; line-height:1.25; letter-spacing:.07em; }
        .gs-tutorial__demo { position:relative; width:min(78vw,270px); height:142px; border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,.2); background:linear-gradient(180deg,#10131a,#05070b 58%,#0f1117); box-shadow:0 16px 36px rgba(0,0,0,.34), inset 0 0 30px rgba(255,255,255,.04); }
        .gs-tutorial__demo:before { content:''; position:absolute; left:8%; right:8%; bottom:22%; height:3px; background:rgba(255,68,85,.68); box-shadow:0 0 14px rgba(255,68,85,.75); }
        .gs-demo-ball { position:absolute; top:18%; width:30px; height:30px; border-radius:50%; background:#f7f9fc; border:3px solid #101827; box-shadow:0 0 14px rgba(255,184,0,.7); animation:gsDemoBall 2.55s linear infinite; }
        .gs-demo-ball:before { content:''; position:absolute; inset:6px; border-radius:inherit; background:radial-gradient(circle at 34% 34%,#fff 0 22%,#d9e0ea 24% 100%); }
        .gs-demo-ball:after { content:''; position:absolute; left:50%; top:50%; width:54px; height:54px; border-radius:50%; transform:translate(-50%,-50%) scale(.2); background:radial-gradient(circle,rgba(255,216,74,.95) 0 18%,rgba(255,68,85,.82) 19% 34%,transparent 58%); opacity:0; animation:gsDemoBurst 2.55s linear infinite; }
        .gs-demo-ball i { position:absolute; left:-7px; right:-7px; top:50%; height:4px; border-radius:999px; background:#2bff9a; box-shadow:0 0 12px rgba(43,255,154,.95); transform:translateY(-50%) rotate(-18deg) scaleX(.18); opacity:0; animation:gsDemoCut 2.55s linear infinite; }
        .gs-demo-ball--1 { left:28%; } .gs-demo-ball--1:after,.gs-demo-ball--1 i { animation-delay:-.2s; }
        .gs-demo-ball--2 { left:51%; }
        .gs-demo-ball--3 { left:70%; } .gs-demo-ball--3:after,.gs-demo-ball--3 i { animation-delay:.2s; }
        .gs-demo-finger { position:absolute; left:-34px; top:54%; width:40px; height:58px; z-index:6; animation:gsDemoSwipe 2.55s linear infinite; filter:drop-shadow(0 0 12px rgba(43,255,154,.78)); }
        .gs-demo-finger svg { width:100%; height:100%; overflow:visible; }
        .gs-demo-slash { position:absolute; right:30px; top:13px; width:0; height:7px; border-radius:999px; background:linear-gradient(90deg,rgba(43,255,154,.08),rgba(43,255,154,.88),#2bff9a); box-shadow:0 0 16px rgba(43,255,154,.9); transform-origin:100% 50%; transform:rotate(-8deg); opacity:0; animation:gsDemoSlash 2.55s linear infinite; }
        .gs-tutorial__actions { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; margin-top:4px; }
        .gs-tutorial__btn { min-height:50px; padding:0 30px; border-radius:14px; border:1.5px solid rgba(255,255,255,.86); background:rgba(255,255,255,.92); color:#030509; font:900 16px 'Barlow Condensed',sans-serif; letter-spacing:.14em; text-transform:uppercase; cursor:pointer; box-shadow:0 12px 28px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.65); transition:transform .12s ease; }
        .gs-tutorial__btn:active { transform:scale(.97); }
        .gs-tutorial__btn.is-retry { border:1.5px solid rgba(255,184,0,.86); background:rgba(255,184,0,.1); color:#FFB800; box-shadow:0 0 24px rgba(255,184,0,.24); }
        .gs-tutorial-countdown { position:absolute; inset:0; z-index:43; display:grid; place-items:center; background:rgba(3,7,14,.74); backdrop-filter:blur(2px); pointer-events:none; }
        .gs-tutorial-countdown span { color:#fff; font:900 clamp(80px,25vw,140px) 'Barlow Condensed',sans-serif; text-shadow:0 0 40px rgba(255,255,255,.5); animation:gsTutorialCount .82s both; }
        .gs-tutorial-countdown span.is-go { color:#2bff9a; text-shadow:0 0 40px rgba(43,255,154,.7); }
        .gs-container.is-shaking { animation:gsShake .16s linear both; }
        .gs-container.is-freeze .gs-ball { filter:brightness(1.35) drop-shadow(0 0 18px ${playerJerseyColor}); }
        .gs-container::after { content:''; position:absolute; inset:0; pointer-events:none; opacity:0; background:radial-gradient(circle at 50% 92%,rgba(255,68,85,.36),transparent 36%); transition:opacity .12s ease-out; z-index:18; }
        .gs-container.is-score-flash::after { opacity:1; }
        .gs-goal-frame { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
        .gs-hud { position:absolute; top:max(50px, calc(env(safe-area-inset-top) + 42px)); left:12px; right:12px; z-index:24; display:grid; grid-template-columns:1fr auto 1fr; gap:7px; align-items:center; pointer-events:none; }
        .gs-hud__pill { padding:6px 8px; border:1px solid rgba(255,255,255,.12); border-radius:999px; background:rgba(2,8,16,.62); color:rgba(255,255,255,.78); font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; text-transform:uppercase; text-align:center; box-shadow:0 0 24px rgba(43,255,154,.08); backdrop-filter:blur(8px); }
        .gs-hud__pill strong { color:#fff; font-size:13px; }
        .gs-label { position:absolute; top:max(124px, calc(env(safe-area-inset-top) + 114px)); left:50%; transform:translateX(-50%); z-index:8; width:max-content; max-width:calc(100% - 28px); padding:7px 12px; border:1px solid rgba(255,255,255,.12); border-radius:999px; background:rgba(2,8,16,.5); color:rgba(255,255,255,.78); font:900 12px 'Barlow Condensed',sans-serif; letter-spacing:.12em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; backdrop-filter:blur(8px); }
        .gs-wave-label { position:absolute; top:max(150px, 24%); left:50%; z-index:25; transform:translateX(-50%); padding:9px 18px; border-radius:999px; background:rgba(43,255,154,.14); border:1px solid rgba(43,255,154,.44); color:#2bff9a; font:900 18px 'Barlow Condensed'; letter-spacing:.18em; text-shadow:0 0 18px rgba(43,255,154,.55); animation:gsWave .72s ease-out both; pointer-events:none; }
        .gs-combo { position:absolute; top:26%; left:50%; z-index:26; transform:translateX(-50%); color:${playerJerseyColor}; font:900 25px 'Barlow Condensed'; letter-spacing:.16em; text-shadow:0 0 24px currentColor; animation:gsCombo .35s ease-out both; pointer-events:none; }
        .gs-ball { position:absolute; left:0; top:0; z-index:12; width:var(--gs-ball-size); height:var(--gs-ball-size); transform:translate(-50%,-50%) scale(var(--gs-scale,1)); pointer-events:auto; opacity:1; filter:drop-shadow(0 12px 14px rgba(0,0,0,.42)) drop-shadow(0 0 14px rgba(255,255,255,.16)); will-change:left,top,width,height,opacity,transform; }
        .gs-ball.is-waiting { opacity:0; }
        .gs-ball.is-fake { opacity:.48; filter:drop-shadow(0 0 18px rgba(130,180,255,.24)); }
        .gs-ball.is-fast { filter:drop-shadow(0 16px 18px rgba(0,0,0,.45)) drop-shadow(0 0 18px rgba(255,216,74,.22)); }
        .gs-ball.is-doubleTap { filter:drop-shadow(0 16px 18px rgba(0,0,0,.46)) drop-shadow(0 0 20px ${playerJerseyColor}66); }
        .gs-ball.is-intercepted { opacity:0; transform:translate(-50%,-50%) scale(1.9); transition:opacity .18s ease-out,transform .18s ease-out; }
        .gs-ball.is-scored,.gs-ball.is-expired { opacity:.1; transform:translate(-50%,-50%) scale(.55); transition:opacity .24s ease-out,transform .24s ease-out; }
        .gs-ball__svg { display:block; width:100%; height:100%; animation:gsBallSpin var(--gs-spin-speed) linear infinite; animation-direction:var(--gs-spin-direction); }
        .gs-ball__hp { position:absolute; left:50%; top:-7px; transform:translateX(-50%); display:flex; gap:3px; }
        .gs-ball__hp i { width:8px; height:4px; border-radius:8px; background:${playerJerseyColor}; box-shadow:0 0 8px ${playerJerseyColor}; }
        .gs-shadow { position:absolute; left:50%; top:calc(50% + var(--gs-shadow-offset)); width:calc(var(--gs-ball-size) * .84); height:calc(var(--gs-ball-size) * .18); transform:translate(-50%,-50%); border-radius:50%; background:rgba(0,0,0,.28); filter:blur(1px); z-index:-1; }
        .gs-particle { position:absolute; transform:translate(-50%,-50%); pointer-events:none; animation:gsParticle .68s ease-out forwards; z-index:22; }
        .gs-particle.is-score { filter:drop-shadow(0 0 16px rgba(255,68,85,.55)); }
        .gs-particle.is-combo { filter:drop-shadow(0 0 20px ${playerJerseyColor}); }
        .gs-trail { position:absolute; inset:0; width:100%; height:100%; z-index:21; pointer-events:none; filter:drop-shadow(0 0 11px ${playerJerseyColor}); }
        .gs-result { position:absolute; inset:0; z-index:30; display:flex; flex-direction:column; gap:18px; align-items:center; justify-content:center; overflow-y:auto; padding:24px 16px max(22px,env(safe-area-inset-bottom)); color:#FF4455; font:900 clamp(42px,15vw,78px) 'Barlow Condensed',sans-serif; letter-spacing:.09em; text-shadow:0 0 34px currentColor; pointer-events:auto; background:rgba(2,8,14,.42); animation:gsResultIn .22s ease-out both; -webkit-overflow-scrolling:touch; }
        .gs-result.is-save { color:${playerJerseyColor}; }
        .gs-result__comment { font:800 15px 'Barlow Condensed',sans-serif; letter-spacing:.12em; color:rgba(255,255,255,.8); text-shadow:none; text-align:center; }
        .gs-result__continue { min-width:190px; padding:13px 24px; border-radius:14px; border:1.5px solid currentColor; background:rgba(255,255,255,.08); color:currentColor; font:900 15px 'Barlow Condensed',sans-serif; letter-spacing:.14em; cursor:pointer; box-shadow:0 0 22px color-mix(in srgb, currentColor 38%, transparent); }
        @media (max-height: 680px) {
          .gs-result { gap:10px; justify-content:center; font-size:clamp(34px,11vw,54px); padding-top:16px; }
          .gs-result__comment { font-size:13px; }
          .gs-result__continue { min-width:170px; padding:10px 18px; font-size:13px; }
        }
        @keyframes gsBallSpin { to { rotate:360deg; } }
        @keyframes gsParticle { 0%{transform:translate(-50%,-50%) scale(.7);opacity:1} 100%{transform:translate(-50%,-50%) scale(3.2);opacity:0} }
        @keyframes gsResultIn { from{transform:scale(.55);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes gsWave { 0%{opacity:0;transform:translateX(-50%) scale(.72)} 24%{opacity:1;transform:translateX(-50%) scale(1.08)} 100%{opacity:0;transform:translateX(-50%) scale(1)} }
        @keyframes gsCombo { from{opacity:0;transform:translateX(-50%) translateY(8px) scale(.8)} to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)} }
        @keyframes gsShake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(2px,-1px)} 50%{transform:translate(-2px,1px)} 75%{transform:translate(1px,2px)} }
        @keyframes gsKickerPulse { to{ transform:translateX(-50%) translateY(4px) scale(1.03); } }
        @keyframes gsKickerStrike { to{ transform:translateX(-50%) translateY(7px) scale(1.08); filter:drop-shadow(0 0 22px rgba(255,68,85,.46)) drop-shadow(0 10px 18px rgba(0,0,0,.42)); } }
        @keyframes gsPenaltyCount { 0%{opacity:0;transform:scale(.58)} 30%{opacity:1;transform:scale(1.08)} 100%{opacity:0;transform:scale(.92)} }
        @keyframes gsTutorialCount { 0%{transform:scale(2.1);opacity:0} 24%{opacity:1} 82%{transform:scale(1)} 100%{transform:scale(.82);opacity:0} }
        @keyframes gsDemoBall { 0%{transform:translate3d(-50%,-36px,0) scale(.72);opacity:0} 10%{transform:translate3d(-50%,36px,0) scale(1);opacity:1} 78%{transform:translate3d(-50%,38px,0) scale(1.04);opacity:1} 88%{transform:translate3d(-50%,39px,0) scale(1.36);opacity:.18;filter:brightness(2.2)} 100%{transform:translate3d(-50%,108px,0) scale(.48);opacity:0} }
        @keyframes gsDemoCut { 0%,58%{opacity:0;transform:translateY(-50%) rotate(-18deg) scaleX(.18)} 63%,72%{opacity:1;transform:translateY(-50%) rotate(-18deg) scaleX(1)} 86%,100%{opacity:0;transform:translateY(-50%) rotate(-18deg) scaleX(1.18)} }
        @keyframes gsDemoBurst { 0%,68%{opacity:0;transform:translate(-50%,-50%) scale(.2)} 76%{opacity:1;transform:translate(-50%,-50%) scale(1)} 92%,100%{opacity:0;transform:translate(-50%,-50%) scale(1.55)} }
        @keyframes gsDemoSwipe { 0%,42%{left:-34px;transform:translate3d(0,26px,0) rotate(-10deg);opacity:0} 47%{left:8%;transform:translate3d(0,18px,0) rotate(-9deg);opacity:1} 58%{left:28%;transform:translate3d(-14px,6px,0) rotate(-6deg);opacity:1} 68%{left:51%;transform:translate3d(-14px,0,0) rotate(-1deg);opacity:1} 78%{left:70%;transform:translate3d(-14px,-4px,0) rotate(6deg);opacity:1} 92%{left:96%;transform:translate3d(-14px,-12px,0) rotate(12deg);opacity:.2} 100%{left:102%;transform:translate3d(-14px,-14px,0) rotate(12deg);opacity:0} }
        @keyframes gsDemoSlash { 0%,50%{opacity:0;width:0} 57%{opacity:.9;width:62px} 70%{opacity:1;width:132px} 84%{opacity:.72;width:204px} 96%,100%{opacity:0;width:224px} }
      `}</style>

      {showGoalSaveTutorial && !tutorialDone && tutorialCountdown === null ? (
        <div className="gs-tutorial">
          <div className="gs-tutorial__title">{isSuddenDeath ? 'TUTORIEL PENALTY' : 'TUTORIEL ARRET'}</div>
          <div className="gs-tutorial__comment">
            <div className="gs-tutorial__avatar" aria-hidden="true">
              <KawaiiSprite
                label={keeperLabel.split(' ').pop()?.slice(0, 7).toUpperCase() ?? 'GK'}
                jerseyColor={playerJerseyColor}
                accentColor={playerAccentColor}
                shortsColor={playerShortsColor}
                textColor={playerTextColor}
                role="keeper"
                motion="ready"
                gloveColor="#f7fbff"
                seed={keeperLabel}
                width={56}
                height={68}
              />
            </div>
            <p>{roundIntroComment ?? (isSuddenDeath ? <><strong>{keeperLabel}</strong>, prépare-toi pour le penalty. Swipe le ballon avant la cage.</> : <><strong>{keeperLabel}</strong>, {ballCount} attaquant{ballCount>1?'s':''} {ballCount>1?'ont':'a'} franchi la ligne rouge{alertNamesLabel&&<> : <strong>{alertNamesLabel}</strong></>}. Swipe les ballons avant la cage.</>)}</p>
          </div>
          {showGoalSaveDemo ? (
            <div className="gs-tutorial__demo" aria-hidden="true">
              {[0,1,2].slice(0, Math.min(3, ballCount)).map((i)=><i key={i} className={`gs-demo-ball gs-demo-ball--${i+1}`}><span /></i>)}
              <span className="gs-demo-finger"><i className="gs-demo-slash"/><svg viewBox="0 0 36 54"><path d="M15 4c3.2 0 5.7 2.5 5.7 5.7v13.1l1.4-1.2c2.2-1.8 5.4-1.4 7.1.9l1.4 1.9c1.1 1.5 1.5 3.3 1.2 5.1l-2.1 12.3c-.7 4.1-4.2 7.1-8.4 7.1h-8.2c-3.2 0-6.1-1.8-7.6-4.6L2.7 37c-1.1-2-.4-4.5 1.6-5.6 1.8-1 4-.6 5.3.9V9.7C9.6 6.5 12.1 4 15 4z" fill="#fff" stroke="#101827" strokeWidth="2.2" strokeLinejoin="round"/><path d="M15.1 8.2v21.4M20.8 22.8v8.1M25.4 25.1v7.7" stroke="rgba(16,24,39,.46)" strokeWidth="1.7" strokeLinecap="round"/><circle cx="15" cy="35" r="7" fill="rgba(43,255,154,.22)" stroke="#2bff9a" strokeWidth="2"/></svg></span>
            </div>
          ) : (
            <button type="button" className="gs-tutorial-open" onClick={() => { sfx.click(); setShowGoalSaveDemo(true) }}>
              Voir tutoriel
            </button>
          )}
          {!roundIntroComment ? (
            <>
              <div className="gs-tutorial__sub">Si tu rates la séquence, l'action finit en but encaissé.</div>
            </>
          ) : null}
          <div className="gs-tutorial__actions">
            {onRetry ? <button type="button" className="gs-tutorial__btn is-retry" onClick={onRetry}>{retryLabel ?? 'Réessayer la phase'}</button> : null}
            <button type="button" className="gs-tutorial__btn" onClick={startGoalSaveTutorial}>{startLabel ?? 'OK - Jouer'}</button>
          </div>
        </div>
      ) : null}

      {!tutorialDone && tutorialCountdown !== null ? (
        <div className="gs-tutorial-countdown" aria-live="polite">
          <span key={tutorialCountdown} className={tutorialCountdown === 0 ? 'is-go' : ''}>{tutorialCountdown === 0 ? 'GO !' : tutorialCountdown}</span>
        </div>
      ) : null}

      <svg className="gs-goal-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0" y="0" width="100" height="78" fill="rgba(43,255,154,.025)" />
        <path d="M0 0 V100 M20 0 V78 M40 0 V78 M60 0 V78 M80 0 V78 M100 0 V100" stroke="rgba(255,255,255,.035)" strokeWidth=".35" />
        <circle cx="50" cy="42" r="1.1" fill="rgba(255,255,255,.24)" />
        <rect x="18" y="55" width="64" height="23" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth=".55" />
        <rect x="32" y="68" width="36" height="10" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth=".5" />
        <path d="M8 78 H92 L98 98 H2 Z" fill="rgba(255,255,255,.045)" />
        {[14, 28, 42, 58, 72, 86].map((x) => <line key={x} x1={x} y1="78" x2={50 + (x - 50) * 1.08} y2="98" stroke="rgba(255,255,255,.16)" strokeWidth=".55" />)}
        {[82, 87, 92, 96].map((y) => { const p = (y - 78) / 20; return <line key={y} x1={8 - p * 6} y1={y} x2={92 + p * 6} y2={y} stroke="rgba(255,255,255,.14)" strokeWidth=".55" /> })}
        <line x1="8" y1="78" x2="2" y2="98" stroke="rgba(255,255,255,.94)" strokeWidth="2" strokeLinecap="round" />
        <line x1="92" y1="78" x2="98" y2="98" stroke="rgba(255,255,255,.94)" strokeWidth="2" strokeLinecap="round" />
        <line x1="8" y1="78" x2="92" y2="78" stroke="rgba(255,255,255,.96)" strokeWidth="2.1" strokeLinecap="round" />
        <line x1="2" y1="97" x2="98" y2="97" stroke="rgba(255,255,255,.86)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1={GOAL_ZONE.minX} y1={GOAL_ZONE.scoreY} x2={GOAL_ZONE.maxX} y2={GOAL_ZONE.scoreY} stroke="rgba(255,68,85,.32)" strokeWidth=".65" strokeDasharray="2 2" />
      </svg>

      {showKicker ? (
        <div className="gs-penalty-kicker" aria-hidden="true">
          {opponentFlag ? <div className="gs-penalty-kicker__flag">{opponentFlag}</div> : null}
          <KawaiiSprite
            jerseyColor={opponentJerseyColor}
            accentColor={opponentAccentColor}
            shortsColor={opponentShortsColor}
            textColor={opponentTextColor}
            role="kicker"
            withBall
            seed={opponentName ?? 'kicker'}
            width={62}
            height={76}
          />
          <div className="gs-penalty-kicker__name">{opponentName ?? 'TIREUR'}</div>
        </div>
      ) : null}

      {isPenalty && penaltyCountdown !== null ? (
        <div className="gs-penalty-countdown" aria-live="polite"><span key={penaltyCountdown}>{penaltyCountdown === 0 ? 'GO' : penaltyCountdown}</span></div>
      ) : null}

      <div className="gs-hud">
        <div className="gs-hud__pill">STOP <strong>{stoppedCount}/{totalRealBalls}</strong></div>
        <div className="gs-hud__pill">{isSuddenDeath ? 'TIR' : 'VAGUE'} <strong>{isSuddenDeath ? '1/1' : `${currentWave + 1}/${cfg.waves}`}</strong></div>
        <div className="gs-hud__pill">RATÉ <strong>{missedCount}/1</strong></div>
      </div>
      <div className="gs-label">{showKicker ? `${keeperName ?? 'GARDIEN'} - SWIPE POUR ARRÊTER` : `${keeperName ?? 'GARDIEN'} : 1 PASSE = BUT`}</div>
      {showWaveLabel ? <div className="gs-wave-label">{isSuddenDeath ? 'MORT SUBITE' : isPenalty ? 'PRÉPARE LE PLONGEON' : 'DERNIÈRE CHANCE'}</div> : null}
      {combo >= 2 ? <div className="gs-combo">COMBO x{combo}</div> : null}

      {activeBalls.map(({ ball, point }) => {
        const size = (ball.type === 'fast' ? 20 : ball.type === 'doubleTap' ? 28 : 24) + point.progress * (ball.type === 'fast' ? 30 : 36)
        const spinMs = clamp(780 - ball.speedFeel * 420, 260, 780)
        return (
          <div
            key={ball.id}
            className={`gs-ball is-${ball.type}${!point.started || ball.state === 'waiting' ? ' is-waiting' : ''}${ball.state !== 'flying' && ball.state !== 'waiting' ? ` is-${ball.state}` : ''}`}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              '--gs-ball-size': `${size}px`,
              '--gs-shadow-offset': `${8 + point.progress * 11}px`,
              '--gs-spin-speed': `${spinMs}ms`,
              '--gs-spin-direction': ball.spinDirection === 1 ? 'normal' : 'reverse',
              '--gs-scale': `${1 + point.progress * 0.08}`,
            } as CSSProperties}
          >
            <div className="gs-shadow" />
            {ball.maxHealth > 1 && ball.state === 'flying' ? <div className="gs-ball__hp">{Array.from({ length: ball.health }, (_, i) => <i key={i} />)}</div> : null}
            <svg className="gs-ball__svg" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill={ball.type === 'fake' ? 'rgba(210,230,255,.42)' : '#f7f9fc'} stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="4" strokeDasharray={ball.type === 'fake' ? '7 5' : undefined} />
              <path d="M40 19 53 28 48 45H32L27 28Z" fill="none" stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="3" />
              <line x1="40" y1="6" x2="40" y2="19" stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="2" strokeLinecap="round" />
              <line x1="53" y1="28" x2="66" y2="22" stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="2" strokeLinecap="round" />
              <line x1="48" y1="45" x2="56" y2="57" stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="2" strokeLinecap="round" />
              <line x1="32" y1="45" x2="24" y2="57" stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="2" strokeLinecap="round" />
              <line x1="27" y1="28" x2="14" y2="22" stroke={ball.type === 'fake' ? '#7dd3fc' : '#101827'} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        )
      })}

      {trail.length > 0 ? <svg className="gs-trail">{trail.map((segment, index) => { const age = clamp((performance.now() - segment.at) / 280, 0, 1); return <line key={segment.id} x1={`${segment.x1}%`} y1={`${segment.y1}%`} x2={`${segment.x2}%`} y2={`${segment.y2}%`} stroke={index % 2 ? playerAccentColor : playerJerseyColor} strokeWidth={Math.max(3, 8 - index)} strokeLinecap="round" opacity={1 - age} /> })}</svg> : null}

      {particles.map((particle) => (
        <div key={particle.id} className={`gs-particle is-${particle.tone}`} style={{ left: `${particle.x}%`, top: `${particle.y}%` }}>
          <svg viewBox="0 0 52 52" width="52" height="52">
            <circle cx="26" cy="26" r="10" fill={particle.tone === 'score' ? '#FF4455' : playerJerseyColor} opacity=".35" />
            {Array.from({ length: 11 }, (_, i) => { const angle = (i / 11) * Math.PI * 2; const color = particle.tone === 'score' ? '#FF4455' : (i % 2 ? playerAccentColor : playerJerseyColor); return <circle key={i} cx={26 + Math.cos(angle) * randomBetween(13, 21)} cy={26 + Math.sin(angle) * randomBetween(13, 21)} r="3.8" fill={color} /> })}
          </svg>
        </div>
      ))}

      {resultLabel ? (
        <div className={`gs-result${pendingResult ? ' is-save' : ''}`}>
          <div>{resultLabel}</div>
          <div className="gs-result__comment">{pendingResult ? 'TIR BLOQUÉ - CAGES SAUVÉES' : 'BUT ENCAISSÉ'}</div>
          {!autoResolve ? <button type="button" className="gs-result__continue" onClick={handleResultContinue}>CONTINUER</button> : null}
        </div>
      ) : null}
    </div>
  )
}

export default GoalSave
