import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BattleDifficulty, Defender, DefenderType } from '../../types'
import GoalView, { type BallFlight, type GoalTarget } from './GoalView'

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1; const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export type AttackEndReason = 'goal' | 'saved' | 'miss' | 'intercepted' | 'timeout'

type AttackPhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  onRoundEnd: (isGoal: boolean, reason?: AttackEndReason) => void
}

type DefenderSeed = {
  type: DefenderType
  hits: number
  speed: number
  spawnDelay?: number
}

// 3 waves per difficulty — agile from wave 1, 3+ defenders always
const WAVES: Record<BattleDifficulty, DefenderSeed[][]> = {
  easy: [
    [{ type: 'normal', hits: 1, speed: 72 }, { type: 'agile', hits: 1, speed: 88 }, { type: 'costaud', hits: 2, speed: 52 }],
    [{ type: 'agile', hits: 1, speed: 100 }, { type: 'costaud', hits: 2, speed: 60 }, { type: 'normal', hits: 1, speed: 78 }, { type: 'agile', hits: 1, speed: 94 }],
    [{ type: 'sonic', hits: 1, speed: 260 }, { type: 'costaud', hits: 2, speed: 68 }, { type: 'agile', hits: 1, speed: 108 }, { type: 'normal', hits: 1, speed: 82 }],
  ],
  medium: [
    [{ type: 'normal', hits: 1, speed: 92 }, { type: 'costaud', hits: 3, speed: 65 }, { type: 'agile', hits: 1, speed: 110 }, { type: 'normal', hits: 1, speed: 88 }],
    [{ type: 'costaud', hits: 3, speed: 78 }, { type: 'agile', hits: 1, speed: 125 }, { type: 'sonic', hits: 1, speed: 330 }, { type: 'costaud', hits: 2, speed: 72 }, { type: 'agile', hits: 1, speed: 118 }],
    [{ type: 'costaud', hits: 3, speed: 92 }, { type: 'sonic', hits: 1, speed: 380 }, { type: 'agile', hits: 1, speed: 140 }, { type: 'costaud', hits: 2, speed: 82 }, { type: 'sonic', hits: 1, speed: 360 }],
  ],
  hard: [
    [{ type: 'costaud', hits: 3, speed: 140 }, { type: 'agile', hits: 1, speed: 158 }, { type: 'sonic', hits: 1, speed: 400 }, { type: 'normal', hits: 1, speed: 132 }, { type: 'agile', hits: 1, speed: 150 }],
    [{ type: 'costaud', hits: 4, speed: 155 }, { type: 'sonic', hits: 1, speed: 450 }, { type: 'agile', hits: 1, speed: 172 }, { type: 'costaud', hits: 3, speed: 142 }, { type: 'sonic', hits: 1, speed: 420 }, { type: 'agile', hits: 1, speed: 162 }],
    [{ type: 'sonic', hits: 1, speed: 500 }, { type: 'costaud', hits: 4, speed: 165 }, { type: 'sonic', hits: 1, speed: 480 }, { type: 'agile', hits: 1, speed: 185 }, { type: 'costaud', hits: 3, speed: 155 }, { type: 'agile', hits: 1, speed: 172 }],
  ],
}

// Auto-fire+miss threshold
const OVERSHOOT_DIAMETER = 60
// Perfect zone ± tolerance
const PERFECT_MIN = 34
const PERFECT_MAX = 54

type AttackDifficultyConfig = {
  countdown: number
  agileSwipeStrict: boolean
}

type RuntimeDefender = Defender & {
  baseX: number
  speed: number
  spawnDelay: number
  age: number
  state: 'active' | 'removing'
  hitAt: number | null
  removeAt: number | null
  incarnation: number
}

type SwipeTrail = { id: string; x1: number; y1: number; x2: number; y2: number; createdAt: number }

const PLAYER_NUMBERS = [7, 11, 9]

function getDifficultyConfig(difficulty: BattleDifficulty): AttackDifficultyConfig {
  const configs: Record<BattleDifficulty, AttackDifficultyConfig> = {
    easy: { countdown: 18, agileSwipeStrict: false },
    medium: { countdown: 14, agileSwipeStrict: true },
    hard: { countdown: 10, agileSwipeStrict: true },
  }
  return configs[difficulty]
}

function randomInt(max: number) {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return value[0] % max
}

function defenderSize(type: DefenderType, hitsRemaining: number, initialHits: number) {
  if (type === 'sonic') return 36
  if (type === 'normal') return 48
  if (type === 'agile') return 44
  const hitsTaken = initialHits - hitsRemaining
  return hitsTaken <= 0 ? 80 : hitsTaken === 1 ? 60 : 40
}

function createWaveDefenders(seeds: DefenderSeed[], waveIdx: number): RuntimeDefender[] {
  return seeds.map((seed, index) => {
    const baseX = 12 + randomInt(77)
    return {
      id: crypto.randomUUID(),
      type: seed.type,
      x: baseX,
      baseX,
      y: -9,
      hitsRemaining: seed.hits,
      size: defenderSize(seed.type, seed.hits, seed.hits),
      direction: 1,
      speed: seed.speed,
      spawnDelay: seed.spawnDelay ?? Math.min(index * 180, 550),
      age: 0,
      state: 'active' as const,
      hitAt: null,
      removeAt: null,
      incarnation: waveIdx * 10 + index,
    }
  })
}

function colorFromTeam(teamId: string) {
  let hash = 0
  for (const character of teamId) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hash} 72% 46%)`
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function AttackDefenderSprite({ defender, color, frozen, recentlyHit, appearing }: {
  defender: RuntimeDefender
  color: string
  frozen: boolean
  recentlyHit: boolean
  appearing: boolean
}) {
  const spawned = defender.age >= defender.spawnDelay
  const bgColor = defender.type === 'sonic'
    ? '#00DDCC'
    : defender.type === 'costaud'
      ? '#FF4455'
      : defender.type === 'agile'
        ? '#3B82F6'
        : color
  const borderColor = defender.type === 'sonic' ? 'rgba(0,255,220,.9)' : 'rgba(255,255,255,.85)'
  const borderWidth = defender.type === 'costaud' ? 6 : 4
  return <svg viewBox="0 0 100 125" className={`battle-p16-defender${defender.state === 'removing' ? ' is-removing' : ''}${recentlyHit && defender.state === 'active' ? ' is-hit' : ''}${appearing ? ' is-appearing' : ''}${defender.type === 'sonic' ? ' is-sonic' : ''}`} style={{ left: `${defender.x}%`, top: `${defender.y}%`, width: defender.size, height: defender.size * 1.25, opacity: spawned ? 1 : 0, pointerEvents: 'none' }}>
    {appearing ? <>
      <circle cx="50" cy="58" r="38" fill="rgba(255,255,255,.06)" />
      <circle cx="50" cy="58" r="44" fill="rgba(255,255,255,.1)" />
    </> : null}
    <circle cx="50" cy="58" r="43" fill={bgColor} stroke={borderColor} strokeWidth={borderWidth} />
    {defender.type === 'costaud' ? <path d="M20 25 l6 14 -10 8 12 6 -6 16" stroke="rgba(0,0,0,.3)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {defender.type === 'agile' ? <path d="M20 17 8 31M80 17 92 31" fill="none" stroke="#60a5fa" strokeWidth="6" strokeLinecap="round" /> : null}
    {defender.type === 'sonic' ? <>
      <path d="M62 18 46 50h14L38 94 55 54H42Z" fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" strokeLinejoin="round" />
    </> : null}
    {defender.type !== 'sonic' && <text x="50" y="70" textAnchor="middle" fontSize="32" fontWeight="900">{defender.hitsRemaining}</text>}
    {recentlyHit && defender.hitsRemaining > 0 ? <text className="alert" x="50" y="20" textAnchor="middle">!</text> : null}
    {frozen && defender.hitsRemaining > 0 && defender.type !== 'sonic' ? <text className="pause" x="50" y="66" textAnchor="middle">⏸</text> : null}
  </svg>
}

export function AttackPhase({ difficulty, homeTeamId, awayTeamId, onRoundEnd }: AttackPhaseProps) {
  const config = useMemo(() => getDifficultyConfig(difficulty), [difficulty])
  const waves = useMemo(() => WAVES[difficulty], [difficulty])
  const pitchRef = useRef<HTMLDivElement | null>(null)
  const lastTouchAtRef = useRef(-1000)
  const remainingMsRef = useRef(config.countdown * 1000)
  const endedRef = useRef(false)
  const shootingWindowRef = useRef(false)
  const keeperRef = useRef(50)
  const keeperDirectionRef = useRef<1 | -1>(1)
  const shotResolveAtRef = useRef<number | null>(null)
  const shotOutcomeRef = useRef<{ goal: boolean; reason: AttackEndReason } | null>(null)
  const waveIndexRef = useRef(0)
  const waveClearingRef = useRef(false)
  const [waveIndex, setWaveIndex] = useState(0)
  const [waveBanner, setWaveBanner] = useState<string | null>(null)
  const [defenders, setDefenders] = useState<RuntimeDefender[]>(() => createWaveDefenders(waves[0], 0))
  const defendersRef = useRef(defenders)
  const [remainingSeconds, setRemainingSeconds] = useState(config.countdown)
  const [shootingWindow, setShootingWindow] = useState(false)
  const [trails, setTrails] = useState<SwipeTrail[]>([])
  const [passes, setPasses] = useState(0)
  const [passFeedbackUntil, setPassFeedbackUntil] = useState(0)
  const [activePlayer, setActivePlayer] = useState(0)
  const [previousPlayer, setPreviousPlayer] = useState<number | null>(null)
  const [playerTransitionUntil, setPlayerTransitionUntil] = useState(0)
  const [target, setTarget] = useState<GoalTarget | null>(null)
  const [keeperX, setKeeperX] = useState(50)
  const [charging, setCharging] = useState(false)
  const [chargeDiameter, setChargeDiameter] = useState(20)
  const chargeDiameterRef = useRef(20)
  const [flight, setFlight] = useState<BallFlight | null>(null)
  const [shotResolved, setShotResolved] = useState(false)
  const [clockNow, setClockNow] = useState(0)
  const clockNowRef = useRef(0)
  const pitchPointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const pitchLastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const defenderColor = useMemo(() => colorFromTeam(awayTeamId), [awayTeamId])
  void useMemo(() => colorFromTeam(homeTeamId), [homeTeamId])
  const initialHitsByType = useMemo<Record<DefenderType, number>>(() => ({
    normal: 1,
    agile: 1,
    sonic: 1,
    costaud: difficulty === 'easy' ? 2 : difficulty === 'medium' ? 3 : 4,
  }), [difficulty])

  const finish = useCallback((goal: boolean, reason: AttackEndReason) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(goal, reason)
  }, [onRoundEnd])

  const openShootingWindow = useCallback(() => {
    if (shootingWindowRef.current || endedRef.current) return
    shootingWindowRef.current = true
    setShootingWindow(true)
  }, [])

  // Advance to next wave or open shooting window when current wave is cleared.
  // NOTE: must NOT check shootingWindowRef here — called before shooting window is set.
  const advanceWave = useCallback((now: number) => {
    if (waveClearingRef.current || endedRef.current) return
    waveClearingRef.current = true
    const nextWaveIndex = waveIndexRef.current + 1
    if (nextWaveIndex >= waves.length) {
      // Final wave cleared → brief "TIRER !" banner then open shooting window
      setWaveBanner('TIRER !')
      window.setTimeout(() => {
        if (endedRef.current) return
        setWaveBanner(null)
        openShootingWindow()
        waveClearingRef.current = false
      }, 600)
    } else {
      const bannerText = nextWaveIndex === waves.length - 1 ? 'VAGUE FINALE !' : `VAGUE ${nextWaveIndex + 1} / ${waves.length}`
      setWaveBanner(bannerText)
      window.setTimeout(() => {
        if (endedRef.current) return
        const nextDefenders = createWaveDefenders(waves[nextWaveIndex], nextWaveIndex)
        defendersRef.current = nextDefenders
        setDefenders(nextDefenders)
        waveIndexRef.current = nextWaveIndex
        setWaveIndex(nextWaveIndex)
        waveClearingRef.current = false
        setWaveBanner(null)
      }, 900)
    }
    void now
  }, [waves, openShootingWindow])

  useEffect(() => {
    let frame = 0
    let previous: number | null = null
    const tick = (now: number) => {
      if (previous === null) previous = now
      const delta = Math.min(50, now - previous)
      previous = now
      clockNowRef.current = now
      setClockNow(now)

      if (!endedRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - delta)
        const seconds = remainingMsRef.current / 1000
        setRemainingSeconds(seconds)

        if (seconds <= 3) openShootingWindow()
        if (seconds <= 0) {
          finish(false, 'timeout')
          return
        }

        if (!shootingWindowRef.current && !waveClearingRef.current) {
          const pitchHeight = pitchRef.current?.clientHeight ?? 420
          let intercepted = false
          const nextDefenders = defendersRef.current
            .filter((defender) => defender.removeAt === null || now < defender.removeAt)
            .map((defender) => {
              if (defender.state === 'removing') return defender
              const age = defender.age + delta
              if (age < defender.spawnDelay) return { ...defender, age }
              const speedFactor = defender.type === 'sonic' ? 1 : 1
              const y = defender.y + defender.speed * speedFactor * delta / 1000 / pitchHeight * 100
              if (y >= 92) intercepted = true
              if (defender.type !== 'agile') return { ...defender, age, y }
              const wave = (age - defender.spawnDelay) / 360 + defender.incarnation
              const direction: 1 | -1 = Math.cos(wave) >= 0 ? 1 : -1
              return { ...defender, age, y, x: clamp(defender.baseX + Math.sin(wave) * 14, 8, 92), direction }
            })
          defendersRef.current = nextDefenders
          setDefenders(nextDefenders)
          if (intercepted) {
            finish(false, 'intercepted')
            return
          }
          // Check if wave is cleared
          const allDefeated = nextDefenders.every((d) => d.hitsRemaining <= 0)
          if (allDefeated && nextDefenders.length > 0) {
            advanceWave(now)
          }
        } else if (shootingWindowRef.current) {
          const nextDefenders = defendersRef.current.filter((defender) => defender.removeAt === null || now < defender.removeAt)
          defendersRef.current = nextDefenders
          setDefenders(nextDefenders)
        }

        setTrails((current) => current.filter((trail) => now - trail.createdAt < 200))

        if (shotResolveAtRef.current !== null && now >= shotResolveAtRef.current && shotOutcomeRef.current) {
          const outcome = shotOutcomeRef.current
          finish(outcome.goal, outcome.reason)
          return
        }
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [finish, openShootingWindow, advanceWave])

  useEffect(() => {
    if (!shootingWindow || endedRef.current) return
    let frame = 0
    let previous: number | null = null
    let directionChangedAt = 0
    const moveKeeper = (now: number) => {
      if (previous === null) previous = now
      const delta = Math.min(50, now - previous)
      previous = now
      const dirChangePeriod = difficulty === 'hard' ? 420 : difficulty === 'medium' ? 620 : 900
      if (now - directionChangedAt >= dirChangePeriod) {
        keeperDirectionRef.current = randomInt(2) === 0 ? -1 : 1
        directionChangedAt = now
      }
      const speed = difficulty === 'easy' ? 260 : difficulty === 'medium' ? 380 : 520
      const slowMotion = target ? .22 : 1
      const next = keeperRef.current + keeperDirectionRef.current * speed * slowMotion * delta / 1000 / 4.2
      if (next <= 12.5 || next >= 87.5) keeperDirectionRef.current = keeperDirectionRef.current === 1 ? -1 : 1
      keeperRef.current = clamp(next, 12.5, 87.5)
      setKeeperX(keeperRef.current)
      frame = requestAnimationFrame(moveKeeper)
    }
    frame = requestAnimationFrame(moveKeeper)
    return () => cancelAnimationFrame(frame)
  }, [difficulty, shootingWindow, target])

  // Charge grow loop — linear grow, auto-fires miss when overshooting ring
  useEffect(() => {
    if (!charging) return
    let frame = 0
    let started: number | null = null
    // Total time to grow 20→72: easy=700ms, medium=580ms, hard=460ms
    const chargeTimeMs = difficulty === 'easy' ? 700 : difficulty === 'medium' ? 580 : 460
    const maxDiameter = 72
    const grow = (now: number) => {
      if (started === null) started = now
      const progress = Math.min(1, (now - started) / chargeTimeMs)
      // Linear grow — easier to time
      const diameter = 20 + progress * (maxDiameter - 20)
      chargeDiameterRef.current = diameter
      setChargeDiameter(diameter)
      // Auto-fire miss when ball clearly overshoots ring
      if (diameter >= OVERSHOOT_DIAMETER && !shotOutcomeRef.current && target) {
        setCharging(false)
        setFlight({ id: Math.round(now), target, state: 'saved', duration: 250 })
        setShotResolved(true)
        shotOutcomeRef.current = { goal: false, reason: 'miss' }
        shotResolveAtRef.current = clockNowRef.current + 280
        return
      }
      if (progress < 1) frame = requestAnimationFrame(grow)
    }
    frame = requestAnimationFrame(grow)
    return () => cancelAnimationFrame(frame)
  }, [charging, difficulty, target])

  const handlePitchPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (shootingWindowRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    pitchPointerDownRef.current = pos
    pitchLastPointerRef.current = pos
  }

  const handlePitchPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pitchPointerDownRef.current || !pitchLastPointerRef.current || shootingWindowRef.current) return
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const last = pitchLastPointerRef.current
    const totalDeltaX = x - pitchPointerDownRef.current.x
    const now = clockNowRef.current

    setTrails((current) => [...current, {
      id: crypto.randomUUID(),
      x1: last.x / rect.width * 100, y1: last.y / rect.height * 100,
      x2: x / rect.width * 100, y2: y / rect.height * 100,
      createdAt: now,
    }])

    let anyHit = false
    const nextDefenders = defendersRef.current.map((defender) => {
      if (defender.state !== 'active') return defender
      const defPx = defender.x / 100 * rect.width
      const defPy = defender.y / 100 * rect.height
      if (distanceToSegment(defPx, defPy, last.x, last.y, x, y) > defender.size / 2 + 12) return defender
      if (defender.type === 'agile' && config.agileSwipeStrict) {
        const swipeDir: 1 | -1 = totalDeltaX >= 0 ? 1 : -1
        if (Math.abs(totalDeltaX) < 50 || swipeDir === defender.direction) return defender
      }
      anyHit = true
      const hitsRemaining = defender.hitsRemaining - 1
      if (hitsRemaining <= 0) return { ...defender, hitsRemaining: 0, state: 'removing' as const, removeAt: now + 300, hitAt: now }
      return { ...defender, hitsRemaining, size: defenderSize(defender.type, hitsRemaining, initialHitsByType[defender.type]), hitAt: now }
    })
    if (anyHit) {
      defendersRef.current = nextDefenders
      setDefenders(nextDefenders)
      // Wave advancement handled by tick loop — do NOT call openShootingWindow() here
    }
    pitchLastPointerRef.current = { x, y }
  }

  const handlePitchPointerUp = () => {
    pitchPointerDownRef.current = null
    pitchLastPointerRef.current = null
  }

  const pass = (time: number) => {
    if (endedRef.current || shootingWindowRef.current) return
    remainingMsRef.current = Math.max(1000, remainingMsRef.current - 2000)
    setRemainingSeconds(remainingMsRef.current / 1000)
    setPassFeedbackUntil(time + 700)
    setPasses((current) => current + 1)
    setPreviousPlayer(activePlayer)
    setPlayerTransitionUntil(time + 200)
    setActivePlayer((current) => (current + 1) % PLAYER_NUMBERS.length)
    // Spawn a bonus defender from current wave
    const waveSeeds = waves[waveIndexRef.current]
    const seed = waveSeeds[randomInt(waveSeeds.length)]
    const extra = { ...createWaveDefenders([{ ...seed, spawnDelay: 0 }], waveIndexRef.current)[0] }
    const nextDefenders = [...defendersRef.current, extra]
    defendersRef.current = nextDefenders
    setDefenders(nextDefenders)
    if (remainingMsRef.current <= 3000) openShootingWindow()
  }

  const startCharge = () => {
    if (!target || shotOutcomeRef.current || endedRef.current) return
    chargeDiameterRef.current = 20
    setChargeDiameter(20)
    setCharging(true)
  }

  const releaseShot = (time: number) => {
    if (!charging || !target || shotOutcomeRef.current) return
    setCharging(false)
    const diameter = chargeDiameterRef.current
    const keeperClear = Math.abs(keeperRef.current - target.x) > 16
    const perfect = diameter >= PERFECT_MIN && diameter <= PERFECT_MAX
    const goal = perfect && keeperClear
    const reason: AttackEndReason = goal ? 'goal' : !perfect ? 'miss' : 'saved'
    setFlight({ id: Math.round(time), target, state: goal ? 'goal' : 'saved', duration: 250 })
    setShotResolved(true)
    shotOutcomeRef.current = { goal, reason }
    shotResolveAtRef.current = time + 280
  }

  const countdownRatio = clamp(remainingSeconds / config.countdown, 0, 1)
  const countdownColor = countdownRatio > .45 ? `hsl(${Math.round(5 + countdownRatio * 38)} 100% 50%)` : '#ff334d'

  const inPerfectZone = chargeDiameter >= PERFECT_MIN && chargeDiameter <= PERFECT_MAX
  const overshot = chargeDiameter > PERFECT_MAX

  return (
    <section className={`battle-attack battle-attack--p16${shootingWindow ? ' is-shooting' : ''}`}>
      <style>{`
        .battle-attack.battle-attack--p16{grid-template-rows:5% 30% 50% 15%;background:#050b16}
        /* Countdown bar */
        .battle-p16-clock{position:relative;z-index:30;display:flex;align-items:center;gap:8px;padding:0 14px;height:100%;background:#04110a;box-sizing:border-box}
        .battle-p16-clock__track{flex:1;height:7px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
        .battle-p16-clock__track i{display:block;width:100%;height:100%;transform-origin:left;transition:background .12s}
        .battle-p16-clock strong{min-width:24px;font:800 13px 'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;text-align:right}
        .battle-p16-minus{position:absolute;right:48px;top:50%;transform:translateY(-50%);font:900 14px 'JetBrains Mono',monospace;color:#FF4455;opacity:.6;text-shadow:0 0 8px rgba(255,68,85,.5);animation:p16Float .7s both}
        /* Goal zone */
        .battle-p16-goal{position:relative;z-index:4;display:grid;align-items:end;background:linear-gradient(180deg,#0e3b24,#0c2e1d);overflow:hidden;filter:saturate(.45) brightness(.8);transition:filter .25s}
        .battle-attack--p16.is-shooting .battle-p16-goal{filter:none}
        .battle-p16-goal-inactive-label{position:absolute;left:14px;top:12px;font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.4);z-index:2;pointer-events:none}
        .battle-p16-goal-shoot-prompt{position:absolute;left:0;right:0;bottom:8px;text-align:center;font:900 26px 'Barlow Condensed',sans-serif;letter-spacing:.12em;color:#FFB800;text-shadow:0 0 18px rgba(255,184,0,.7);animation:bk-charge .8s ease-in-out infinite;z-index:2;pointer-events:none}
        /* Pitch */
        .battle-p16-pitch{position:relative;z-index:5;overflow:hidden;background:linear-gradient(180deg,#0c2e1d,#0a2618);touch-action:none}
        .battle-p16-pitch-lines{position:absolute;inset:0;opacity:.5}
        /* Defender tokens */
        .battle-p16-defender{position:absolute;z-index:4;overflow:visible;transform:translate(-50%,-50%);touch-action:none;filter:drop-shadow(0 8px 7px rgba(0,0,0,.5))}
        .battle-p16-defender.is-removing{animation:p16SpinOut .3s ease-out forwards;pointer-events:none}
        .battle-p16-defender.is-hit{animation:p16Shake .2s linear, p16RedFlash .2s linear}
        .battle-p16-defender.is-appearing{animation:p16Appear .2s ease-out both}
        .battle-p16-defender.is-sonic{filter:drop-shadow(0 0 8px rgba(0,221,204,.8)) drop-shadow(0 8px 7px rgba(0,0,0,.5));animation:p16SonicPulse .4s ease-in-out infinite alternate}
        .battle-p16-defender.is-sonic.is-removing{animation:p16SpinOut .3s ease-out forwards}
        .battle-p16-defender text{fill:#fff;font-weight:950;text-shadow:0 2px 2px #000;pointer-events:none;font-family:'Barlow Condensed',sans-serif}
        .battle-p16-defender .pause{font-size:21px}.battle-p16-defender .alert{fill:#FF4455;font-size:28px;animation:p16Alert .35s both;font-family:'Barlow Condensed',sans-serif}
        /* Swipe trails */
        .battle-p16-trails{position:absolute;z-index:12;inset:0;width:100%;height:100%;pointer-events:none}
        .battle-p16-trails line{stroke:#2bff9a;stroke-width:4;stroke-linecap:round;filter:drop-shadow(0 0 5px rgba(43,255,154,.6));animation:p16Trail .2s both}
        /* Bottom controls */
        .battle-p16-bottom{position:relative;z-index:15;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:0;padding:6px 20px max(8px,env(safe-area-inset-bottom));background:linear-gradient(180deg,#0a2618,#061a10);box-sizing:border-box}
        /* Pass button */
        .battle-p16-pass-wrap{display:flex;flex-direction:column;align-items:center;gap:5px}
        .battle-p16-pass{width:56px;height:56px;border-radius:16px;background:rgba(255,184,0,.1);border:1.5px solid rgba(255,184,0,.6);box-shadow:0 0 16px rgba(255,184,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;padding:0}
        .battle-p16-pass:disabled{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.1);opacity:.4;cursor:not-allowed;box-shadow:none}
        .battle-p16-pass svg{width:30px;height:22px}
        .battle-p16-pass circle{fill:#FFB800}.battle-p16-pass path{fill:none;stroke:#FFB800;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        .battle-p16-pass:disabled circle{fill:#5a6168}.battle-p16-pass:disabled path{stroke:#5a6168}
        .battle-p16-pass-count{font:600 10px 'Barlow Condensed',sans-serif;letter-spacing:.08em;color:rgba(255,255,255,.5)}
        /* Player badge (center) */
        .battle-p16-player-wrap{display:flex;flex-direction:column;align-items:center;gap:5px;justify-self:center}
        .battle-p16-player-stage{position:relative;width:58px;height:58px}
        .battle-p16-player{position:absolute;inset:0;display:grid;place-items:center;border:2px solid #2bff9a;border-radius:50%;background:#0b1626;box-shadow:0 0 22px rgba(43,255,154,.5);font:900 20px 'Barlow Condensed',sans-serif;color:#2bff9a;animation:p16PlayerIn .2s ease-out both}
        .battle-p16-player.is-outgoing{animation:p16PlayerOut .2s ease-in both}
        .battle-p16-player-label{font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:#2bff9a}
        /* Score pill + round dots (right) */
        .battle-p16-score-wrap{display:flex;flex-direction:column;align-items:center;gap:7px}
        .battle-p16-score{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:99px;background:rgba(255,255,255,.06);border:1px solid rgba(255,184,0,.5);font:800 16px 'JetBrains Mono',monospace}
        .battle-p16-score-home{color:#2bff9a}
        .battle-p16-score-sep{color:rgba(255,255,255,.4)}
        .battle-p16-score-away{color:#FF4455}
        .battle-p16-rounds{display:flex;gap:6px;align-items:center}
        /* Wave badge */
        .battle-p16-wave{position:absolute;top:8px;right:10px;z-index:20;padding:3px 8px;border-radius:6px;background:rgba(255,184,0,.15);border:1px solid rgba(255,184,0,.5);font:800 11px 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:#FFB800}
        /* Wave banner overlay */
        .battle-p16-wave-banner{position:absolute;inset:0;z-index:50;display:grid;place-items:center;background:rgba(0,0,0,.55);animation:p16WaveBannerIn .15s ease-out both}
        .battle-p16-wave-banner span{font:900 clamp(32px,12vw,56px) 'Barlow Condensed',sans-serif;letter-spacing:.08em;color:#FFB800;text-shadow:0 0 36px rgba(255,184,0,.7);animation:bk-charge .5s ease-in-out infinite}
        /* Ball charge — arc power meter */
        .battle-p16-ball{position:absolute;z-index:20;left:50%;top:44%;width:96px;height:96px;display:grid;place-items:center;padding:0;border:0;background:none;transform:translate(-50%,-50%);touch-action:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
        .battle-p16-ball:not(.is-charging){animation:p16BallPulse 1s ease-in-out infinite}
        .battle-p16-ball.is-perfect .p16-arc-fill{filter:drop-shadow(0 0 6px #2bff9a)}
        .battle-p16-ball.is-overshot .p16-arc-fill{filter:drop-shadow(0 0 6px #FF4455)}
        .battle-p16-ball__label{position:absolute;top:-24px;left:50%;transform:translateX(-50%);font:900 11px 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:#FFB800;white-space:nowrap;pointer-events:none;text-shadow:0 0 10px rgba(255,184,0,.7)}
        .battle-p16-ball__state{position:absolute;bottom:-24px;left:50%;transform:translateX(-50%);font:900 12px 'Barlow Condensed',sans-serif;letter-spacing:.1em;white-space:nowrap;pointer-events:none}
        @keyframes p16BallPulse{0%,100%{filter:drop-shadow(0 0 0px rgba(255,184,0,.3))}50%{filter:drop-shadow(0 0 12px rgba(255,184,0,.8))}}
        @keyframes p16SpinOut{to{transform:translate(-50%,-50%) rotate(360deg) scale(.1);opacity:0}}
        @keyframes p16Shake{0%,100%{margin-left:0}16%{margin-left:-5px}32%{margin-left:5px}48%{margin-left:-5px}64%{margin-left:5px}80%{margin-left:-5px}}
        @keyframes p16RedFlash{50%{filter:drop-shadow(0 0 18px #FF4455) saturate(2)}}
        @keyframes p16Appear{from{transform:translate(-50%,-50%) scale(0);opacity:0}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
        @keyframes p16Alert{from{transform:translateY(10px);opacity:1}to{transform:translateY(-25px);opacity:0}}
        @keyframes p16Trail{0%{opacity:0}30%{opacity:1}100%{opacity:0}}
        @keyframes p16PlayerIn{from{transform:translateX(-90px);opacity:0}to{transform:none;opacity:1}}
        @keyframes p16PlayerOut{to{transform:translateX(-90px);opacity:0}}
        @keyframes p16Float{to{transform:translateY(-18px);opacity:0}}
        @keyframes p16SonicPulse{from{filter:drop-shadow(0 0 6px rgba(0,221,204,.6)) drop-shadow(0 8px 7px rgba(0,0,0,.5))}to{filter:drop-shadow(0 0 14px rgba(0,221,204,1)) drop-shadow(0 8px 7px rgba(0,0,0,.5))}}
        @keyframes p16WaveBannerIn{from{opacity:0;transform:scale(1.1)}to{opacity:1;transform:none}}
      `}</style>

      {/* TOP 5% — countdown bar */}
      <div className="battle-p16-clock">
        <div className="battle-p16-clock__track">
          <i style={{ transform: `scaleX(${countdownRatio})`, background: `linear-gradient(90deg,#FFB800,#ff7a1a 60%,${countdownColor})` }} />
        </div>
        <strong style={{ color: countdownColor }}>{Math.ceil(remainingSeconds)}s</strong>
        {clockNow < passFeedbackUntil ? <span className="battle-p16-minus">-2s</span> : null}
      </div>

      {/* TOP 30% — goal zone (dimmed until shooting window) */}
      <div className="battle-p16-goal">
        {!shootingWindow && <div className="battle-p16-goal-inactive-label">Fenêtre de tir fermée</div>}
        {shootingWindow && !target && <div className="battle-p16-goal-shoot-prompt">CLIQUE DANS LE BUT !</div>}
        {shootingWindow && target && !charging && !shotResolved && <div className="battle-p16-goal-shoot-prompt" style={{ color: '#2bff9a', fontSize: '16px' }}>MAINTENIR LE BALLON {'\u2193'}</div>}
        {charging && <div className="battle-p16-goal-shoot-prompt" style={{ color: inPerfectZone ? '#2bff9a' : overshot ? '#FF4455' : '#FFB800' }}>{inPerfectZone ? 'RELACHER !' : overshot ? 'TROP FORT !' : 'CHARGER...'}</div>}
        <GoalView difficulty={difficulty} keeperX={keeperX} target={target} ballFlight={flight} interactive={shootingWindow && !shotResolved} slowMotion={Boolean(target)} onTarget={(nextTarget) => !target && setTarget(nextTarget)} />
      </div>

      {/* MIDDLE 50% — pitch with defenders */}
      <div className="battle-p16-pitch" ref={pitchRef}
        onPointerDown={handlePitchPointerDown}
        onPointerMove={handlePitchPointerMove}
        onPointerUp={handlePitchPointerUp}
        onPointerCancel={handlePitchPointerUp}
        style={{ touchAction: 'none', cursor: shootingWindow ? 'default' : 'crosshair', userSelect: 'none' }}>
        <svg className="battle-p16-pitch-lines" viewBox="0 0 375 406" preserveAspectRatio="none">
          <g stroke="rgba(255,255,255,.06)" strokeWidth="1">
            <line x1="0" y1="70" x2="375" y2="70" /><line x1="0" y1="150" x2="375" y2="150" />
            <line x1="0" y1="230" x2="375" y2="230" /><line x1="0" y1="310" x2="375" y2="310" />
          </g>
        </svg>
        {/* Wave badge */}
        {!shootingWindow && <div className="battle-p16-wave">V{waveIndex + 1}/{waves.length}</div>}
        {defenders.map((defender) => {
          const recentlyHit = defender.hitAt !== null && clockNow - defender.hitAt < 200
          const appearing = defender.age >= defender.spawnDelay && defender.age - defender.spawnDelay < 200
          return <AttackDefenderSprite key={defender.id} defender={defender} color={defenderColor} frozen={shootingWindow} recentlyHit={recentlyHit} appearing={appearing} />
        })}
        <svg className="battle-p16-trails" viewBox="0 0 100 100" preserveAspectRatio="none">
          {trails.map((trail) => <line key={trail.id} x1={trail.x1} y1={trail.y1} x2={trail.x2} y2={trail.y2} />)}
        </svg>
        {/* Wave banner */}
        {waveBanner ? <div className="battle-p16-wave-banner"><span>{waveBanner}</span></div> : null}
        {shootingWindow && target && !shotResolved ? (() => {
          // Arc power meter: progress 0→1 from first press to auto-miss
          const arcProgress = clamp((chargeDiameter - 20) / (OVERSHOOT_DIAMETER - 20), 0, 1)
          const R = 40  // arc radius in SVG units (viewBox 96×96, center 48,48)
          const circ = 2 * Math.PI * R  // ≈ 251
          const dashOffset = circ * (1 - arcProgress)
          // Perfect zone arc: from perfectMin% to perfectMax%
          const perfectStart = (PERFECT_MIN - 20) / (OVERSHOOT_DIAMETER - 20)  // ≈ 35%
          const perfectEnd = (PERFECT_MAX - 20) / (OVERSHOOT_DIAMETER - 20)    // ≈ 85%
          const perfectArcLen = (perfectEnd - perfectStart) * circ              // green zone length
          const perfectArcOffset = circ * (1 - perfectEnd) + circ              // offset to position it correctly
          const arcColor = inPerfectZone ? '#2bff9a' : overshot ? '#FF4455' : '#FFB800'
          return (
            <button
              type="button"
              className={`battle-p16-ball${charging ? ` is-charging${inPerfectZone ? ' is-perfect' : overshot ? ' is-overshot' : ''}` : ''}`}
              onContextMenu={(e) => e.preventDefault()}
              onTouchStart={(event) => { event.preventDefault(); lastTouchAtRef.current = event.timeStamp; startCharge() }}
              onTouchEnd={(event) => { event.preventDefault(); lastTouchAtRef.current = event.timeStamp; releaseShot(event.timeStamp) }}
              onMouseDown={(event) => { event.preventDefault(); if (event.timeStamp - lastTouchAtRef.current > 500) startCharge() }}
              onMouseUp={(event) => { if (event.timeStamp - lastTouchAtRef.current > 500) releaseShot(event.timeStamp) }}
              onMouseLeave={(event) => { if (charging && event.timeStamp - lastTouchAtRef.current > 500) releaseShot(event.timeStamp) }}
              aria-label="Maintenir pour charger le tir">
              {!charging && <span className="battle-p16-ball__label">APPUYER</span>}
              {charging && <span className="battle-p16-ball__state" style={{ color: arcColor }}>{inPerfectZone ? 'LACHER !' : overshot ? 'TROP FORT' : '...'}</span>}
              <svg viewBox="0 0 96 96" width="96" height="96" style={{ transform: 'rotate(-90deg)' }}>
                {/* Background track */}
                <circle cx="48" cy="48" r={R} fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.1)" strokeWidth="8" />
                {/* Perfect zone arc (green zone guide) */}
                <circle cx="48" cy="48" r={R} fill="none"
                  stroke="rgba(43,255,154,.25)" strokeWidth="8"
                  strokeDasharray={`${perfectArcLen} ${circ - perfectArcLen}`}
                  strokeDashoffset={perfectArcOffset}
                  strokeLinecap="round" />
                {/* Fill arc */}
                <circle className="p16-arc-fill" cx="48" cy="48" r={R} fill="none"
                  stroke={arcColor} strokeWidth="8"
                  strokeDasharray={`${circ}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round" />
                {/* Ball icon center */}
                <g transform="rotate(90 48 48)">
                  <circle cx="48" cy="48" r="20" fill="#f4f7ff" stroke="#0b1422" strokeWidth="2.5" />
                  <path d="M48 33 l7 5 -2.5 8h-9l-2.5-8z" fill="none" stroke="#0b1422" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M48 27v6M61 36l-4 3M35 36l4 3M39 58l3-4M57 58l-3-4" fill="none" stroke="#0b1422" strokeWidth="1.5" strokeLinecap="round" />
                </g>
              </svg>
            </button>
          )
        })() : null}
      </div>

      {/* BOTTOM 15% — controls */}
      <div className="battle-p16-bottom">
        {/* PASSE button */}
        <div className="battle-p16-pass-wrap">
          <button type="button" className="battle-p16-pass" disabled={shootingWindow}
            onTouchEnd={(event) => { event.preventDefault(); lastTouchAtRef.current = event.timeStamp; pass(event.timeStamp) }}
            onMouseUp={(event) => { if (event.timeStamp - lastTouchAtRef.current > 500) pass(event.timeStamp) }}
            aria-label="Faire une passe">
            <svg viewBox="0 0 34 24" fill="none">
              <circle cx="6" cy="12" r="5" />
              <circle cx="28" cy="12" r="5" />
              <path d="M12 12 H24 M20 8 l4 4 -4 4" strokeLinecap="round" />
            </svg>
          </button>
          <span className="battle-p16-pass-count">Passes: {passes}</span>
        </div>

        {/* Active player badge */}
        <div className="battle-p16-player-wrap">
          <div className="battle-p16-player-stage">
            {previousPlayer !== null && clockNow < playerTransitionUntil
              ? <div className="battle-p16-player is-outgoing" key={`out-${previousPlayer}`}>{PLAYER_NUMBERS[previousPlayer]}</div>
              : null}
            <div className="battle-p16-player" key={`in-${activePlayer}`}>{PLAYER_NUMBERS[activePlayer]}</div>
          </div>
          <span className="battle-p16-player-label">Joueur {PLAYER_NUMBERS[activePlayer]}</span>
        </div>

        {/* Score pill + wave indicator */}
        <div className="battle-p16-score-wrap">
          <div className="battle-p16-score">
            <span className="battle-p16-score-home">{0}</span>
            <span className="battle-p16-score-sep">–</span>
            <span className="battle-p16-score-away">{0}</span>
          </div>
          <div className="battle-p16-rounds">
            {waves.map((_, i) => (
              <i key={i} style={{ width: i <= waveIndex ? 9 : 7, height: i <= waveIndex ? 9 : 7, borderRadius: '50%', background: i < waveIndex ? '#2bff9a' : i === waveIndex ? '#FFB800' : 'rgba(255,255,255,.18)', boxShadow: i === waveIndex ? '0 0 8px rgba(255,184,0,.7)' : 'none', display: 'inline-block', transition: 'all .2s' }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export default AttackPhase
