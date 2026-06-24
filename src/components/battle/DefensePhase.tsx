import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BattleDifficulty, DefenderType, DefenseOutcome } from '../../types'
import FruitNinjaPhase from './FruitNinjaPhase'
import GoalView from './GoalView'

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1; const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

type DefensePhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  onRoundEnd: (outcome: DefenseOutcome) => void
}

type AttackerType = DefenderType
type AttackerSeed = { type: AttackerType; hits: number; spawnDelay?: number }
type AttackerState = 'active' | 'removing' | 'locked'

type RuntimeAttacker = {
  id: string
  type: AttackerType
  x: number
  baseX: number
  y: number
  hitsRemaining: number
  initialHits: number
  size: number
  direction: -1 | 1
  speed: number
  spawnDelay: number
  age: number
  state: AttackerState
  hitAt: number | null
  removeAt: number | null
}

type DefenseConfig = { countdown: number; speed: number; attackers: AttackerSeed[]; agileSwipeStrict: boolean }
type DefenseTrail = { id: string; x1: number; y1: number; x2: number; y2: number; createdAt: number }

const SHOOTING_ZONE_Y = 80

function getDefenseConfig(difficulty: BattleDifficulty): DefenseConfig {
  const configs: Record<BattleDifficulty, DefenseConfig> = {
    easy: { countdown: 12, speed: 70, agileSwipeStrict: false, attackers: [{ type: 'normal', hits: 1 }, { type: 'costaud', hits: 2 }] },
    medium: { countdown: 9, speed: 100, agileSwipeStrict: true, attackers: [{ type: 'normal', hits: 1 }, { type: 'costaud', hits: 3 }, { type: 'agile', hits: 1 }] },
    hard: { countdown: 6, speed: 140, agileSwipeStrict: true, attackers: [{ type: 'costaud', hits: 3 }, { type: 'costaud', hits: 3 }, { type: 'agile', hits: 1 }, { type: 'normal', hits: 1, spawnDelay: 1500 }] },
  }
  return configs[difficulty]
}

function randomInt(maximum: number) {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return value[0] % maximum
}

function attackerSize(type: AttackerType, hitsRemaining: number, initialHits: number) {
  if (type === 'normal') return 48
  if (type === 'agile') return 44
  const hitsTaken = initialHits - hitsRemaining
  return hitsTaken === 0 ? 80 : hitsTaken === 1 ? 60 : 40
}

function createAttackers(config: DefenseConfig) {
  return config.attackers.map<RuntimeAttacker>((seed, index) => {
    const baseX = 14 + randomInt(73)
    const speed = config.speed * (seed.type === 'costaud' ? .72 : seed.type === 'agile' ? 1.05 : 1)
    return {
      id: crypto.randomUUID(), type: seed.type, x: baseX, baseX, y: -8,
      hitsRemaining: seed.hits, initialHits: seed.hits, size: attackerSize(seed.type, seed.hits, seed.hits),
      direction: 1, speed, spawnDelay: seed.spawnDelay ?? Math.min(index * 220, 650), age: 0,
      state: 'active', hitAt: null, removeAt: null,
    }
  })
}

function teamColor(teamId: string) {
  let hash = 0
  for (const character of teamId) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return `hsl(${hash} 72% 46%)`
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function AttackerSprite({ attacker, color, frozen, recentlyHit }: {
  attacker: RuntimeAttacker
  color: string
  frozen: boolean
  recentlyHit: boolean
}) {
  const spawned = attacker.age >= attacker.spawnDelay
  const bgColor = attacker.type === 'costaud' ? '#FF4455' : attacker.type === 'agile' ? '#3B82F6' : color
  const strokeColor = 'rgba(255,255,255,.85)'
  const strokeWidth = attacker.type === 'costaud' ? 6 : 4
  return <svg viewBox="0 0 100 125" className={`defense-p17-attacker${attacker.state === 'removing' ? ' is-removing' : ''}${recentlyHit && attacker.state === 'active' ? ' is-hit' : ''}`} style={{ left: `${attacker.x}%`, top: `${attacker.y}%`, width: attacker.size, height: attacker.size * 1.25, opacity: spawned ? 1 : 0, pointerEvents: 'none' }}>
    <circle cx="50" cy="58" r="43" fill={bgColor} stroke={strokeColor} strokeWidth={strokeWidth} />
    {attacker.type === 'costaud' ? <path d="M22 25 l6 14 -10 8 12 6 -6 16" stroke="rgba(0,0,0,.3)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {attacker.type === 'agile' ? <path d="M19 18 7 31M81 18 93 31" fill="none" stroke="#60a5fa" strokeWidth="6" strokeLinecap="round" /> : null}
    <text x="50" y="70" textAnchor="middle" fontSize="32" fontWeight="900">{attacker.hitsRemaining}</text>
    {recentlyHit && attacker.hitsRemaining > 0 ? <text className="defense-p17-alert" x="50" y="20" textAnchor="middle">!</text> : null}
    {frozen ? <text className="defense-p17-pause" x="50" y="67" textAnchor="middle">⏸</text> : null}
  </svg>
}

export function DefensePhase({ difficulty, homeTeamId: _homeTeamId, awayTeamId, onRoundEnd }: DefensePhaseProps) {
  const config = useMemo(() => getDefenseConfig(difficulty), [difficulty])
  const pitchRef = useRef<HTMLDivElement | null>(null)
  const initialAttackers = useMemo(() => createAttackers(config), [config])
  const attackersRef = useRef(initialAttackers)
  const remainingMsRef = useRef(config.countdown * 1000)
  const endedRef = useRef(false)
  const cleanSweepAtRef = useRef<number | null>(null)
  const [attackers, setAttackers] = useState(initialAttackers)
  const [remainingSeconds, setRemainingSeconds] = useState(config.countdown)
  const [clockNow, setClockNow] = useState(0)
  const clockNowRef = useRef(0)
  const [dangerUntil, setDangerUntil] = useState(0)
  const [trails, setTrails] = useState<DefenseTrail[]>([])
  const [phase, setPhase] = useState<'swipe' | 'fruit_ninja'>('swipe')
  const [fruitAttackers, setFruitAttackers] = useState(0)
  const attackerColor = useMemo(() => teamColor(awayTeamId), [awayTeamId])
  const lastTouchAtRef = useRef(-1000)
  const pitchPointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const pitchLastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const lockedAttackers = attackers.filter((attacker) => attacker.state === 'locked').slice(0, 3)

  const finish = useCallback((outcome: DefenseOutcome) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(outcome)
  }, [onRoundEnd])

  const beginFruitNinja = useCallback((count: number) => {
    if (endedRef.current || count <= 0) return
    setFruitAttackers(Math.min(3, count))
    setPhase('fruit_ninja')
  }, [])

  useEffect(() => {
    if (phase !== 'swipe') return
    let frame = 0
    let previous: number | null = null
    const animate = (now: number) => {
      if (previous === null) previous = now
      const delta = Math.min(50, now - previous)
      previous = now
      clockNowRef.current = now
      setClockNow(now)
      remainingMsRef.current = Math.max(0, remainingMsRef.current - delta)
      const seconds = remainingMsRef.current / 1000
      setRemainingSeconds(seconds)
      setTrails((current) => current.filter((trail) => now - trail.createdAt < 300))

      const pitchHeight = pitchRef.current?.clientHeight ?? 430
      let enteredZone = false
      const nextAttackers = attackersRef.current
        .filter((attacker) => attacker.removeAt === null || now < attacker.removeAt)
        .map((attacker) => {
          if (attacker.state !== 'active') return attacker
          const age = attacker.age + delta
          if (age < attacker.spawnDelay) return { ...attacker, age }
          const y = attacker.y + attacker.speed * delta / 1000 / pitchHeight * 100
          if (y >= SHOOTING_ZONE_Y) {
            enteredZone = true
            return { ...attacker, age, y: 88, state: 'locked' as const }
          }
          if (attacker.type !== 'agile') return { ...attacker, age, y }
          const wave = (age - attacker.spawnDelay) / 360
          const direction: 1 | -1 = Math.cos(wave) >= 0 ? 1 : -1
          return { ...attacker, age, y, x: clamp(attacker.baseX + Math.sin(wave) * 14, 8, 92), direction }
        })
      attackersRef.current = nextAttackers
      setAttackers(nextAttackers)
      if (enteredZone) setDangerUntil(now + 650)

      const remainingThreats = nextAttackers.filter((attacker) => attacker.hitsRemaining > 0)
      const zoneCount = Math.min(3, nextAttackers.filter((attacker) => attacker.state === 'locked').length)
      if (remainingThreats.length === 0) {
        if (cleanSweepAtRef.current === null) cleanSweepAtRef.current = now + 300
        if (now >= cleanSweepAtRef.current) {
          finish({ path: 'clean_sweep' })
          return
        }
      } else {
        cleanSweepAtRef.current = null
      }

      if (seconds <= 0) {
        if (zoneCount === 0) finish({ path: 'clean_sweep' })
        else beginFruitNinja(zoneCount)
        return
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [beginFruitNinja, finish, phase])

  const handlePitchPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (endedRef.current || phase !== 'swipe') return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    pitchPointerDownRef.current = pos
    pitchLastPointerRef.current = pos
  }

  const handlePitchPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pitchPointerDownRef.current || !pitchLastPointerRef.current || endedRef.current || phase !== 'swipe') return
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
    const nextAttackers = attackersRef.current.map((attacker) => {
      if (attacker.state !== 'active') return attacker
      const attPx = attacker.x / 100 * rect.width
      const attPy = attacker.y / 100 * rect.height
      if (distanceToSegment(attPx, attPy, last.x, last.y, x, y) > attacker.size / 2 + 12) return attacker
      if (attacker.type === 'agile' && config.agileSwipeStrict) {
        const swipeDir: 1 | -1 = totalDeltaX >= 0 ? 1 : -1
        if (Math.abs(totalDeltaX) < 50 || swipeDir === attacker.direction) return attacker
      }
      anyHit = true
      const hitsRemaining = attacker.hitsRemaining - 1
      if (hitsRemaining <= 0) return { ...attacker, hitsRemaining: 0, state: 'removing' as const, hitAt: now, removeAt: now + 300 }
      return { ...attacker, hitsRemaining, size: attackerSize(attacker.type, hitsRemaining, attacker.initialHits), hitAt: now }
    })
    if (anyHit) {
      attackersRef.current = nextAttackers
      setAttackers(nextAttackers)
    }
    pitchLastPointerRef.current = { x, y }
  }

  const handlePitchPointerUp = () => {
    pitchPointerDownRef.current = null
    pitchLastPointerRef.current = null
  }

  if (phase === 'fruit_ninja') {
    return <FruitNinjaPhase attackersInZone={fruitAttackers} difficulty={difficulty} onResult={(saved) => finish({ path: 'fruit_ninja', attackersInZone: fruitAttackers, saved })} />
  }

  const countdownRatio = clamp(remainingSeconds / config.countdown, 0, 1)
  const countdownColor = countdownRatio > .45 ? `hsl(${Math.round(5 + countdownRatio * 38)} 100% 50%)` : '#ff334d'

  return <section className="battle-defense defense-p17">
    <style>{`
      .battle-defense.defense-p17{grid-template-rows:5% 20% 55% 20%;padding:0;background:#050b16;touch-action:none;font-family:'Barlow',sans-serif}
      /* Countdown bar — red tint background */
      .defense-p17-clock{position:relative;z-index:25;display:flex;align-items:center;gap:8px;padding:0 14px;height:100%;background:#1a0608;box-sizing:border-box}
      .defense-p17-clock div{flex:1;height:7px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
      .defense-p17-clock i{display:block;width:100%;height:100%;transform-origin:left}
      .defense-p17-clock strong{min-width:24px;font:800 13px 'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;text-align:right}
      /* Origin zone — opponent bench */
      .defense-p17-origin{position:relative;display:grid;place-items:center;align-content:center;gap:4px;background:linear-gradient(180deg,#1a0d10,#120a0d);overflow:hidden}
      .defense-p17-origin svg{opacity:.8;filter:drop-shadow(0 6px 12px rgba(0,0,0,.5))}
      .defense-p17-origin circle{fill:#d7a67d}
      .defense-p17-origin path{fill:${attackerColor};stroke:#ff8796;stroke-width:3}
      .defense-p17-origin small{font:800 11px 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgba(255,255,255,.7);text-transform:uppercase}
      /* Pitch — red-tinted background */
      .defense-p17-pitch{position:relative;overflow:hidden;background:linear-gradient(180deg,#140a0d,#0d0608);touch-action:none}
      .defense-p17-pitch-lines{position:absolute;inset:0;opacity:.35}
      /* Attacker sprites */
      .defense-p17-attacker{position:absolute;z-index:5;overflow:visible;transform:translate(-50%,-50%);filter:drop-shadow(0 8px 8px rgba(0,0,0,.5));touch-action:none}
      .defense-p17-attacker text{fill:#fff;font-weight:950;font-family:'Barlow Condensed',sans-serif}
      .defense-p17-attacker.is-removing{animation:defenseP17Spin .3s ease-out forwards;pointer-events:none}
      .defense-p17-attacker.is-hit{animation:defenseP17Shake .2s linear}
      .defense-p17-alert{fill:#FF4455!important;font-size:28px;animation:defenseP17Alert .3s both;font-family:'Barlow Condensed',sans-serif}
      .defense-p17-pause{font-size:21px}
      /* Swipe trails */
      .defense-p17-trails{position:absolute;z-index:12;inset:0;width:100%;height:100%;pointer-events:none}
      .defense-p17-trails line{stroke:#fff;stroke-width:4;stroke-linecap:round;filter:drop-shadow(0 0 5px rgba(255,255,255,.6));animation:defenseP17Trail .3s both}
      /* Shot zone (bottom 20%) */
      .defense-p17-zone{position:relative;z-index:8;overflow:hidden;border-top:2px dashed rgba(255,68,85,.7);background:rgba(255,68,85,.2);box-sizing:border-box}
      .defense-p17-zone.is-danger{background:rgba(255,68,85,.4);border-top-color:rgba(255,68,85,.9)}
      .defense-p17-zone .battle-goal-view{position:absolute;left:50%;bottom:-20%;width:72%;transform:translateX(-50%);opacity:.45}
      .defense-p17-zone-label{position:absolute;z-index:5;top:50%;left:50%;transform:translate(-50%,-50%);font:800 11px 'Barlow Condensed',sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#FF4455;pointer-events:none;white-space:nowrap}
      .defense-p17-danger-label{position:absolute;z-index:12;left:0;right:0;top:-2px;transform:translateY(-100%);text-align:center;font:900 16px 'Barlow Condensed',sans-serif;letter-spacing:.2em;color:#FF4455;text-shadow:0 0 12px rgba(255,68,85,.7);animation:bk-charge .5s ease-in-out infinite}
      /* Locked attacker badges in zone */
      .defense-p17-locked{position:absolute;z-index:10;bottom:8%;display:grid;width:48px;height:48px;place-items:center;border:3px solid rgba(255,130,145,.9);border-radius:50%;color:#fff;background:${attackerColor};font:900 18px 'Barlow Condensed',sans-serif;transform:translateX(-50%);box-shadow:0 0 14px rgba(255,68,85,.6)}
      .defense-p17-locked-glow{position:absolute;inset:-8px;border-radius:50%;background:radial-gradient(circle,rgba(255,68,85,.5),rgba(255,68,85,0) 70%);animation:bk-charge .8s ease-in-out infinite}
      /* DÉFENDRE button */
      .defense-p17-button{position:absolute;z-index:15;right:18px;bottom:14px;display:flex;flex-direction:column;align-items:center;gap:4px}
      .defense-p17-button button{width:56px;height:56px;border-radius:16px;background:#FF4455;border:1.5px solid #ff8a96;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(255,68,85,.6);animation:bk-gold 1.2s ease-in-out infinite;touch-action:manipulation;padding:0}
      .defense-p17-button button:disabled{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.12);opacity:.4;cursor:not-allowed;animation:none;box-shadow:none}
      .defense-p17-button small{font:700 10px 'Barlow Condensed',sans-serif;letter-spacing:.06em;color:#fff}
      /* Red vignette */
      .defense-p17-vignette{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 90px 34px rgba(150,0,16,.4);border-radius:inherit;z-index:20}
      @keyframes defenseP17Spin{to{transform:translate(-50%,-50%) rotate(360deg) scale(.1);opacity:0}}
      @keyframes defenseP17Shake{0%,100%{margin-left:0}20%{margin-left:-5px}40%{margin-left:5px}60%{margin-left:-5px}80%{margin-left:5px}}
      @keyframes defenseP17Alert{to{transform:translateY(-22px);opacity:0}}
      @keyframes defenseP17Trail{0%{opacity:0}25%{opacity:1}100%{opacity:0}}
    `}</style>

    {/* TOP 5% — countdown bar */}
    <div className="defense-p17-clock">
      <div><i style={{ transform: `scaleX(${countdownRatio})`, background: `linear-gradient(90deg,#FFB800,#ff7a1a 55%,${countdownColor})` }} /></div>
      <strong style={{ color: countdownColor }}>{Math.ceil(remainingSeconds)}s</strong>
    </div>

    {/* 20% — Opponent origin zone */}
    <div className="defense-p17-origin">
      <svg width="58" height="72" viewBox="0 0 100 120">
        <circle cx="50" cy="23" r="17" />
        <path d="M25 48Q50 32 75 48L68 88H58L56 115H43L41 88H31Z" />
      </svg>
      <small>ATTAQUE {awayTeamId.toUpperCase()}</small>
    </div>

    {/* 55% — Pitch with attackers */}
    <div className="defense-p17-pitch" ref={pitchRef}
      onPointerDown={handlePitchPointerDown}
      onPointerMove={handlePitchPointerMove}
      onPointerUp={handlePitchPointerUp}
      onPointerCancel={handlePitchPointerUp}
      style={{ touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}>
      <svg className="defense-p17-pitch-lines" viewBox="0 0 375 447" preserveAspectRatio="none">
        <g stroke="rgba(255,255,255,.06)" strokeWidth="1">
          <line x1="0" y1="80" x2="375" y2="80" /><line x1="0" y1="170" x2="375" y2="170" />
          <line x1="0" y1="260" x2="375" y2="260" /><line x1="0" y1="350" x2="375" y2="350" />
        </g>
      </svg>
      {attackers.filter((attacker) => attacker.state !== 'locked').map((attacker) => (
        <AttackerSprite key={attacker.id} attacker={attacker} color={attackerColor} frozen={false}
          recentlyHit={attacker.hitAt !== null && clockNow - attacker.hitAt < 200} />
      ))}
      <svg className="defense-p17-trails" viewBox="0 0 100 100" preserveAspectRatio="none">
        {trails.map((trail) => <line key={trail.id} x1={trail.x1} y1={trail.y1} x2={trail.x2} y2={trail.y2} />)}
      </svg>
    </div>

    {/* 20% — Shot zone */}
    <div className={`defense-p17-zone${clockNow < dangerUntil ? ' is-danger' : ''}`}>
      {clockNow < dangerUntil
        ? <div className="defense-p17-danger-label">⚠ DANGER</div>
        : <span className="defense-p17-zone-label">Zone de tir</span>}
      <GoalView difficulty={difficulty} keeperX={50} />
      {lockedAttackers.map((attacker, index) => (
        <div key={attacker.id} className="defense-p17-locked" style={{ left: `${25 + index * 25}%` }}>
          <div className="defense-p17-locked-glow" />
          {attacker.hitsRemaining}
        </div>
      ))}
      <div className="defense-p17-button">
        <button type="button"
          disabled={lockedAttackers.length === 0}
          onTouchEnd={(event) => { event.preventDefault(); lastTouchAtRef.current = event.timeStamp; beginFruitNinja(lockedAttackers.length) }}
          onMouseUp={(event) => { if (event.timeStamp - lastTouchAtRef.current > 500) beginFruitNinja(lockedAttackers.length) }}
          aria-label="Défendre">
          <svg width="24" height="26" viewBox="0 0 24 26" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M12 2 L21 6 V13 C21 19 12 24 12 24 C12 24 3 19 3 13 V6 Z" />
          </svg>
        </button>
        {lockedAttackers.length > 0 && <small>{lockedAttackers.length} en zone</small>}
      </div>
    </div>
  </section>
}

export default DefensePhase
