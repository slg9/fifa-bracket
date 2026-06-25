import { useCallback, useEffect, useRef, useState } from 'react'
import type { BattleDifficulty, DefenseOutcome } from '../../types'
import GoalSave from './GoalSave'

type DefensePhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  awayTeamPlayers?: string[]
  onRoundEnd: (outcome: DefenseOutcome) => void
  isPaused?: boolean
}

const DEFENSE_CFG = {
  easy:   { timer: 14, ballSpeed: 60,  waveCount: 3, balloonsPerWave: 4 },
  medium: { timer: 12, ballSpeed: 90,  waveCount: 4, balloonsPerWave: 5 },
  hard:   { timer: 10, ballSpeed: 130, waveCount: 5, balloonsPerWave: 6 },
}

const BULLET_SPEED   = 280   // % per second upward
const AUTO_FIRE_MS   = 160   // ms between auto-fire shots
const SHOOTER_SPEED  = 60    // %/s via keyboard

type BallItem = {
  id: string; x: number; spawnDelay: number; speed: number
  state: 'waiting' | 'active' | 'destroyed' | 'passed'
  y: number; startedAt: number | null
  health: number; maxHealth: number  // multi-hit resistance
}
type Bullet = { id: string; x: number; y: number }

// Column positions (%) for vertical rows
const COLUMN_X = [12, 26, 40, 50, 60, 74, 88]

function createBalls(cfg: typeof DEFENSE_CFG['easy'], difficulty: 'easy' | 'medium' | 'hard'): BallItem[] {
  const balls: BallItem[] = []
  let delay = 0

  // Alternate between random spreads and tight vertical columns for variety
  for (let wave = 0; wave < cfg.waveCount; wave++) {
    const isColumn = wave % 2 === 1  // even waves = random, odd = column
    const colX = COLUMN_X[Math.floor(Math.random() * COLUMN_X.length)]

    for (let i = 0; i < cfg.balloonsPerWave; i++) {
      delay += (wave === 0 && i === 0) ? 300 : isColumn ? 220 + Math.random() * 120 : 350 + Math.random() * 500

      const maxHp = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : (Math.random() < 0.4 ? 3 : 2)
      const x = isColumn
        ? colX + (Math.random() - 0.5) * 8
        : 8 + Math.random() * 84

      balls.push({
        id: crypto.randomUUID(),
        x,
        spawnDelay: delay,
        speed: cfg.ballSpeed * (0.85 + Math.random() * 0.3),
        state: 'waiting', y: -10, startedAt: null,
        health: maxHp, maxHealth: maxHp,
      })
    }
    delay += 600
  }
  return balls
}

export function DefensePhase({ difficulty, homeTeamId: _h, awayTeamId: _a, awayTeamPlayers = [], onRoundEnd, isPaused }: DefensePhaseProps) {
  const cfg = DEFENSE_CFG[difficulty]
  const totalBalls = cfg.waveCount * cfg.balloonsPerWave

  const [tutorialDone, setTutorialDone] = useState(() => sessionStorage.getItem('brakup:tut:def') === '1')
  const [preCountdownNum, setPreCountdownNum] = useState<number | null>(null)
  const [phase, setPhase]               = useState<'invaders' | 'goal_save'>('invaders')
  const [showGoalSaveIntro, setShowGoalSaveIntro] = useState(false)
  const [balls, setBalls]               = useState<BallItem[]>(() => createBalls(cfg, difficulty))
  const [bullets, setBullets]           = useState<Bullet[]>([])
  const [remainingSeconds, setRemainingSeconds] = useState(cfg.timer)
  const [burstIds, setBurstIds]         = useState<Set<string>>(() => new Set())
  const [passedCount, setPassedCount]   = useState(0)
  const [destroyedCount, setDestroyedCount] = useState(0)
  const [shooterX, setShooterX]         = useState(50)

  const endedRef            = useRef(false)
  const ballsRef            = useRef(balls)
  ballsRef.current          = balls
  const bulletsRef          = useRef<Bullet[]>([])
  const remainingMsRef      = useRef(cfg.timer * 1000)
  const passedCountRef      = useRef(0)
  const destroyedCountRef   = useRef(0)
  const phaseRef            = useRef<'invaders' | 'goal_save'>('invaders')
  const goalSaveTriggeredRef = useRef(false)
  const containerRef        = useRef<HTMLDivElement>(null)
  const frameRef            = useRef(0)
  const startTimeRef        = useRef<number | null>(null)
  const shooterXRef         = useRef(50)
  const lastFireMsRef       = useRef(0)   // tracks auto-fire timing
  const isPausedRef         = useRef(false)
  isPausedRef.current       = isPaused ?? false
  const keysRef             = useRef({ left: false, right: false })

  // Keyboard controls
  useEffect(() => {
    if (!tutorialDone) return
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { keysRef.current.left  = true; e.preventDefault() }
      if (e.key === 'ArrowRight') { keysRef.current.right = true; e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  keysRef.current.left  = false
      if (e.key === 'ArrowRight') keysRef.current.right = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [tutorialDone])

  const finish = useCallback((outcome: DefenseOutcome) => {
    if (endedRef.current) return
    endedRef.current = true
    cancelAnimationFrame(frameRef.current)
    onRoundEnd(outcome)
  }, [onRoundEnd])

  const triggerGoalSave = useCallback(() => {
    if (goalSaveTriggeredRef.current || endedRef.current) return
    goalSaveTriggeredRef.current = true
    cancelAnimationFrame(frameRef.current)
    setShowGoalSaveIntro(true)
  }, [])

  // ── RAF loop ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'invaders' || !tutorialDone) return
    let prev: number | null = null

    const tick = (now: number) => {
      if (isPausedRef.current) { prev = null; frameRef.current = requestAnimationFrame(tick); return }
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev)
      prev = now
      if (endedRef.current) return

      if (startTimeRef.current === null) startTimeRef.current = now
      const relativeNow = now - startTimeRef.current

      remainingMsRef.current = Math.max(0, remainingMsRef.current - delta)
      setRemainingSeconds(remainingMsRef.current / 1000)

      // ── Keyboard movement ──
      if (keysRef.current.left) {
        shooterXRef.current = Math.max(5, shooterXRef.current - SHOOTER_SPEED * delta / 1000)
        setShooterX(shooterXRef.current)
      }
      if (keysRef.current.right) {
        shooterXRef.current = Math.min(95, shooterXRef.current + SHOOTER_SPEED * delta / 1000)
        setShooterX(shooterXRef.current)
      }

      // ── Auto-fire ──
      lastFireMsRef.current += delta
      let newBullets = bulletsRef.current
      if (lastFireMsRef.current >= AUTO_FIRE_MS) {
        lastFireMsRef.current = 0
        const bullet: Bullet = { id: crypto.randomUUID(), x: shooterXRef.current, y: 86 }
        newBullets = [...bulletsRef.current, bullet]
      }

      // ── Move bullets up ──
      const movedBullets = newBullets
        .map((b) => ({ ...b, y: b.y - BULLET_SPEED * delta / 1000 }))
        .filter((b) => b.y > -5)

      // ── Move balls down ──
      const nextBalls = ballsRef.current.map((ball): BallItem => {
        if (ball.state === 'destroyed' || ball.state === 'passed') return ball
        if (ball.state === 'waiting') {
          if (relativeNow >= ball.spawnDelay) return { ...ball, state: 'active', startedAt: now }
          return ball
        }
        const newY = ball.y + ball.speed * delta / 1000
        if (newY > 92) {
          passedCountRef.current += 1; setPassedCount(passedCountRef.current)
          return { ...ball, y: 92, state: 'passed' }
        }
        return { ...ball, y: newY }
      })

      // ── Collision detection ──
      const hitBallIds   = new Set<string>()
      const hitBulletIds = new Set<string>()
      for (const bullet of movedBullets) {
        for (const ball of nextBalls) {
          if (ball.state !== 'active') continue
          if (hitBallIds.has(ball.id) || hitBulletIds.has(bullet.id)) continue
          if (Math.abs(bullet.x - ball.x) < 11 && Math.abs(bullet.y - ball.y) < 12) {
            hitBallIds.add(ball.id); hitBulletIds.add(bullet.id)
          }
        }
      }

      // ── Apply hits — decrement health, only destroy when health reaches 0 ──
      let newlyDestroyed = 0
      const finalBalls = hitBallIds.size > 0
        ? nextBalls.map((b) => {
            if (!hitBallIds.has(b.id)) return b
            const newHp = b.health - 1
            if (newHp <= 0) {
              newlyDestroyed++
              return { ...b, health: 0, state: 'destroyed' as const }
            }
            return { ...b, health: newHp }  // damaged but alive
          })
        : nextBalls
      const finalBullets = movedBullets.filter((b) => !hitBulletIds.has(b.id))

      if (newlyDestroyed > 0) {
        destroyedCountRef.current += newlyDestroyed
        setDestroyedCount(destroyedCountRef.current)
        finalBalls.forEach((b) => {
          if (b.state === 'destroyed' && hitBallIds.has(b.id)) {
            setBurstIds((prev) => new Set(prev).add(b.id))
            setTimeout(() => setBurstIds((prev) => { const next = new Set(prev); next.delete(b.id); return next }), 500)
          }
        })
      } else if (hitBallIds.size > 0) {
        // Just damage — brief flash on hit balls
        hitBallIds.forEach((id) => {
          setBurstIds((prev) => new Set(prev).add(id))
          setTimeout(() => setBurstIds((prev) => { const next = new Set(prev); next.delete(id); return next }), 120)
        })
      }

      ballsRef.current = finalBalls; setBalls(finalBalls)
      bulletsRef.current = finalBullets; setBullets(finalBullets)

      // ── End conditions ──
      if (passedCountRef.current >= 3 && !goalSaveTriggeredRef.current) { triggerGoalSave(); return }
      const allResolved = finalBalls.every((b) => b.state === 'destroyed' || b.state === 'passed')
      if (allResolved && !goalSaveTriggeredRef.current) {
        if (passedCountRef.current >= 3) triggerGoalSave()
        else finish({ path: 'space_invaders', blocked: destroyedCountRef.current, total: totalBalls })
        return
      }
      if (remainingMsRef.current <= 0) {
        if (passedCountRef.current >= 3) triggerGoalSave()
        else finish({ path: 'space_invaders', blocked: destroyedCountRef.current, total: totalBalls })
        return
      }

      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [phase, cfg, totalBalls, finish, triggerGoalSave, tutorialDone])

  // ── Pointer: only for movement (no fire) ─────────────────
  const getX = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return 50
    return Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100))
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'invaders' || endedRef.current || !tutorialDone) return
    shooterXRef.current = getX(e)
    setShooterX(shooterXRef.current)
  }
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'invaders' || endedRef.current || !tutorialDone) return
    shooterXRef.current = getX(e)
    setShooterX(shooterXRef.current)
  }

  // ── GoalSave intro screen ────────────────────────────────
  if (showGoalSaveIntro) {
    const n = Math.min(3, Math.max(1, passedCountRef.current || 1))
    return (
      <section className="def-alert">
        <style>{`
          .def-alert{position:relative;display:grid;grid-template-rows:minmax(220px,48vh) auto auto;width:100%;height:100%;padding:0;background:linear-gradient(180deg,#06110b 0%,#081320 58%,#050b16 100%);overflow:hidden;font-family:'Barlow Condensed',sans-serif}
          .def-alert__visual{position:relative;overflow:hidden;background:radial-gradient(circle at 50% 12%,rgba(255,184,0,.10),transparent 26%),linear-gradient(180deg,#0a2113 0%,#123e1f 32%,#0d3419 58%,#091e10 100%)}
          .def-alert__visual::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,11,22,.04),rgba(5,11,22,.18) 58%,rgba(5,11,22,.72) 100%);pointer-events:none}
          .def-alert__copy{display:grid;gap:12px;padding:20px 20px 0}
          .def-alert__eyebrow{color:#FFB800;font:800 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.22em;text-transform:uppercase}
          .def-alert__title{font:900 clamp(30px,10vw,50px) 'Barlow Condensed',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#FF4455;text-shadow:0 0 30px rgba(255,68,85,.45)}
          .def-alert__commentary{display:grid;gap:8px;padding:16px 18px;border-left:3px solid #FF4455;border-radius:0 12px 12px 0;background:rgba(10,21,38,.88);animation:commentaryIn .3s both}
          .def-alert__commentary-main{font:700 clamp(14px,4vw,17px) 'Barlow Condensed',sans-serif;color:#fff;line-height:1.35}
          .def-alert__commentary-sub{font:500 clamp(11px,3.5vw,13px) 'Barlow',sans-serif;color:rgba(255,255,255,.58);line-height:1.45}
          .def-alert__actions{padding:16px 20px 24px}
          .def-alert__button{width:100%;padding:14px 22px;border-radius:12px;border:1.5px solid rgba(255,68,85,.42);background:rgba(255,68,85,.12);color:#fff;font:800 16px 'Barlow Condensed',sans-serif;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;box-shadow:0 0 20px rgba(255,68,85,.22)}
          .def-alert__button:hover{background:rgba(255,68,85,.18)}
          .def-alert__badge{position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:999px;border:1px solid rgba(255,184,0,.35);background:rgba(5,11,22,.56);color:#FFB800;font:800 10px/1 'Barlow Condensed',sans-serif;letter-spacing:.18em;text-transform:uppercase;z-index:2}
        `}</style>
        <div className="def-alert__visual">
          <div className="def-alert__badge">Zone de tir</div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
            <rect x="0" y="0" width="100" height="100" fill="transparent" />
            <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,.16)" strokeWidth="0.45" />
            <circle cx="50" cy="26" r="8" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="0.45" />
            <rect x="18" y="52" width="64" height="20" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="0.5" />
            <rect x="32" y="64" width="36" height="8" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="0.5" />
            <path d="M10 84 H90 L96 98 H4 Z" fill="rgba(255,255,255,.05)" />
            <line x1="10" y1="84" x2="4" y2="98" stroke="rgba(255,255,255,.92)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="90" y1="84" x2="96" y2="98" stroke="rgba(255,255,255,.92)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="10" y1="84" x2="90" y2="84" stroke="rgba(255,255,255,.92)" strokeWidth="1.4" />
            <line x1="4" y1="98" x2="96" y2="98" stroke="rgba(255,255,255,.92)" strokeWidth="1.4" />
            {[24, 38, 50, 62, 76].map((x) => (
              <line key={x} x1={x} y1="84" x2={50 + (x - 50) * 0.18} y2="98" stroke="rgba(255,255,255,.14)" strokeWidth="0.45" />
            ))}
            {[88, 92, 96].map((y) => (
              <line key={y} x1={10 - ((y - 84) / 14) * 6} y1={y} x2={90 + ((y - 84) / 14) * 6} y2={y} stroke="rgba(255,255,255,.14)" strokeWidth="0.45" />
            ))}
            {[0, 1, 2].slice(0, n).map((index) => {
              const x = [34, 50, 66][index]
              const y = [30, 21, 33][index]
              return (
                <g key={index} transform={`translate(${x} ${y})`}>
                  <circle cx="0" cy="0" r="4.8" fill="#f7f9fc" stroke="#101827" strokeWidth="1.4" />
                  <path d="M0 -2.8 1.9 -1.2 1.2 1.2h-2.4L-1.9 -1.2Z" fill="none" stroke="#101827" strokeWidth="0.9" />
                  <path d="M0 6 L0 34" stroke="rgba(255,184,0,.55)" strokeDasharray="2 2" strokeWidth="1" strokeLinecap="round" />
                </g>
              )
            })}
          </svg>
        </div>
        <div className="def-alert__copy">
          <span className="def-alert__eyebrow">Alerte defense</span>
          <div className="def-alert__title">Attention !</div>
          <div className="def-alert__commentary">
            <div className="def-alert__commentary-main">L'adversaire entre dans la zone de tir.</div>
            <div className="def-alert__commentary-sub">{n} ballon{n > 1 ? 's' : ''} descendent plein cadre. Touche ou balaie les ballons avant la ligne : un seul qui passe, et c'est but encaisse.</div>
          </div>
        </div>
        <div className="def-alert__actions">
          <button type="button" className="def-alert__button" onClick={() => { setShowGoalSaveIntro(false); phaseRef.current = 'goal_save'; setPhase('goal_save') }}>
            Je defends !
          </button>
        </div>
      </section>
    )
  }

  if (phase === 'goal_save') {
    const n = Math.min(3, Math.max(1, passedCountRef.current || 1))
    return (
      <section style={{ display:'flex', flexDirection:'column', width:'100%', height:'100%', background:'#050b16', fontFamily:"'Barlow Condensed',sans-serif", overflow:'hidden' }}>
        <div style={{ padding:'8px 16px', background:'#1a0608', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <span style={{ font:"900 14px 'Barlow Condensed',sans-serif", letterSpacing:'.14em', color:'#FF4455', textTransform:'uppercase' }}>
            ⚠ GARDIEN ! {n} ballon{n>1?'s':''} à arrêter
          </span>
        </div>
        <div style={{ flex:1, minHeight:0 }}>
          <GoalSave ballCount={n} difficulty={difficulty} onResult={(saved) => finish({ path:'goal_save', blocked:destroyedCountRef.current, total:totalBalls, saved })} />
        </div>
      </section>
    )
  }

  const countdownRatio = Math.max(0, Math.min(1, remainingSeconds / cfg.timer))
  const countdownColor = countdownRatio > 0.45 ? `hsl(${Math.round(5 + countdownRatio * 38)} 100% 50%)` : '#ff334d'

  return (
    <section
      className="def-root"
      ref={containerRef}
      style={{ touchAction:'none', userSelect:'none' }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
    >
      <style>{`
        .def-root { display:grid; grid-template-rows:5% 70% 25%; width:100%; height:100%; background:#050b16; font-family:'Barlow Condensed',sans-serif; overflow:hidden; position:relative; }
        .def-tutorial { position:absolute; inset:0; z-index:50; background:rgba(5,11,22,.90); backdrop-filter:blur(3px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; }
        .def-tutorial__title { font:900 clamp(32px,10vw,52px) 'Barlow Condensed',sans-serif; letter-spacing:.2em; color:#FF4455; text-shadow:0 0 32px rgba(255,68,85,.6); text-transform:uppercase; }
        .def-tutorial__instruction { font:600 clamp(13px,4vw,16px) 'Barlow Condensed',sans-serif; color:rgba(255,255,255,.85); text-align:center; max-width:300px; line-height:1.45; }
        .def-tutorial__hint { font-size:28px; animation:defHintLR .7s ease-in-out infinite alternate; }
        @keyframes defHintLR { from{transform:translateX(-10px)} to{transform:translateX(10px)} }
        .def-tutorial__btn { margin-top:8px; padding:12px 28px; border-radius:10px; border:2px solid #2bff9a; background:rgba(43,255,154,.1); color:#2bff9a; font:800 16px 'Barlow Condensed',sans-serif; letter-spacing:.1em; cursor:pointer; box-shadow:0 0 16px rgba(43,255,154,.35); }
        .def-clock { display:flex; align-items:center; gap:8px; padding:0 14px; background:#1a0608; box-sizing:border-box; z-index:10; }
        .def-clock__track { flex:1; height:7px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden; }
        .def-clock__fill { display:block; width:100%; height:100%; transform-origin:left; }
        .def-clock strong { min-width:28px; font:800 13px 'JetBrains Mono',monospace; font-variant-numeric:tabular-nums; text-align:right; }
        .def-game { position:relative; overflow:hidden; background:linear-gradient(180deg,#050b16 0%,#0a0d1a 60%,#0f1525 100%); cursor:none; }
        .def-ball { position:absolute; transform:translate(-50%,-50%); z-index:8; pointer-events:none; }
        .def-ball.is-destroyed { animation:defBurst .4s ease-out forwards; }
        .def-ball.is-passed,.def-ball.is-waiting { opacity:0; }
        .def-bullet { position:absolute; transform:translate(-50%,-50%); width:8px; height:22px; border-radius:4px; background:linear-gradient(180deg,#FFB800,#ff7a00); box-shadow:0 0 10px rgba(255,184,0,.9),0 0 20px rgba(255,184,0,.5); pointer-events:none; z-index:12; }
        .def-shooter { position:absolute; transform:translate(-50%,-50%); z-index:15; pointer-events:none; filter:drop-shadow(0 0 8px rgba(43,255,154,.7)); }
        .def-pre-countdown { position:absolute; inset:0; z-index:55; background:rgba(5,11,22,.75); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; pointer-events:none; }
        .def-pre-countdown__num { font:900 clamp(80px,25vw,140px) 'Barlow Condensed',sans-serif; color:#fff; letter-spacing:.06em; line-height:1; text-shadow:0 0 40px rgba(255,255,255,.5); animation:defCdnPop .85s cubic-bezier(.22,1,.36,1) both; }
        .def-pre-countdown__num.is-go { color:#2bff9a; text-shadow:0 0 60px rgba(43,255,154,.9); animation:defCdnGo .55s cubic-bezier(.22,1,.36,1) both; }
        @keyframes defCdnPop { 0%{transform:scale(2.2);opacity:0} 25%{opacity:1} 80%{transform:scale(1);opacity:1} 100%{transform:scale(.8);opacity:0} }
        @keyframes defCdnGo { 0%{transform:scale(.4);opacity:0} 40%{transform:scale(1.1);opacity:1} 100%{transform:scale(1.5);opacity:0} }
        .def-burst-ring { position:absolute; transform:translate(-50%,-50%); pointer-events:none; z-index:20; animation:defBurstRing .5s ease-out forwards; }
        .def-danger-line { position:absolute; left:0; right:0; height:3px; background:rgba(255,68,85,.35); top:88%; pointer-events:none; z-index:5; box-shadow:0 0 8px rgba(255,68,85,.5); }
        .def-info { display:flex; align-items:center; justify-content:space-between; padding:8px 20px; background:linear-gradient(180deg,#1a0608,#0d0405); box-sizing:border-box; z-index:5; }
        .def-info-stat { display:flex; flex-direction:column; align-items:center; gap:2px; }
        .def-info-stat span { font:900 18px 'JetBrains Mono',monospace; }
        .def-info-stat small { font:700 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; color:rgba(255,255,255,.5); text-transform:uppercase; }
        .def-info-label { font:800 12px 'Barlow Condensed',sans-serif; letter-spacing:.1em; color:rgba(255,255,255,.6); text-transform:uppercase; text-align:center; }
        .def-danger-warn { position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); font:900 clamp(18px,7vw,36px) 'Barlow Condensed',sans-serif; letter-spacing:.12em; color:#FF4455; text-shadow:0 0 24px rgba(255,68,85,.8); pointer-events:none; animation:defDanger .5s ease-in-out infinite alternate; z-index:20; }
        @keyframes defBurst { 0%{transform:translate(-50%,-50%) scale(1);opacity:1} 60%{transform:translate(-50%,-50%) scale(2);opacity:.4} 100%{transform:translate(-50%,-50%) scale(2.6);opacity:0} }
        @keyframes defBurstRing { 0%{transform:translate(-50%,-50%) scale(.4);opacity:1} 100%{transform:translate(-50%,-50%) scale(2.8);opacity:0} }
        @keyframes defDanger { from{opacity:.6} to{opacity:1;text-shadow:0 0 40px rgba(255,68,85,1)} }
      `}</style>

      {/* Tutorial */}
      {!tutorialDone && preCountdownNum === null && (
        <div className="def-tutorial">
          <div className="def-tutorial__title">DÉFENSE</div>
          <div className="def-tutorial__instruction">
            Déplace le tireur gauche/droite pour viser les ballons.<br/>
            <b style={{color:'#FFB800'}}>Le tir est automatique</b> — concentre-toi sur le visée !<br/><br/>
            <span style={{color:'rgba(255,255,255,.5)',fontSize:'0.9em'}}>⌨ Clavier : ← → pour se déplacer</span>
          </div>
          <div className="def-tutorial__hint">↔</div>
          <button type="button" className="def-tutorial__btn" onClick={() => {
            sessionStorage.setItem('brakup:tut:def','1')
            setPreCountdownNum(3)
            setTimeout(() => setPreCountdownNum(2), 900)
            setTimeout(() => setPreCountdownNum(1), 1800)
            setTimeout(() => setPreCountdownNum(0), 2700)
            setTimeout(() => { setPreCountdownNum(null); setTutorialDone(true) }, 3300)
          }}>
            OK — Jouer !
          </button>
        </div>
      )}

      {/* Pre-game countdown (after tutorial dismiss) */}
      {!tutorialDone && preCountdownNum !== null && (
        <div className="def-pre-countdown">
          <div key={preCountdownNum} className={`def-pre-countdown__num${preCountdownNum === 0 ? ' is-go' : ''}`}>
            {preCountdownNum === 0 ? 'GO !' : preCountdownNum}
          </div>
        </div>
      )}

      {/* Timer bar */}
      <div className="def-clock">
        <div className="def-clock__track">
          <i className="def-clock__fill" style={{ transform:`scaleX(${countdownRatio})`, background:`linear-gradient(90deg,#FFB800,#ff7a1a 55%,${countdownColor})` }} />
        </div>
        <strong style={{ color:countdownColor }}>{Math.ceil(remainingSeconds)}s</strong>
      </div>

      {/* Game area */}
      <div className="def-game">
        <div className="def-danger-line" />

        {balls.filter((b) => b.state === 'active' || b.state === 'destroyed' || burstIds.has(b.id)).map((ball, bi) => {
          const defLabel = awayTeamPlayers.length > 0
            ? awayTeamPlayers[bi % awayTeamPlayers.length].split(' ').pop()!.slice(0, 7)
            : '9'
          const defFontSize = defLabel.length > 5 ? '7' : '10'
          const hpFrac = ball.maxHealth > 1 ? ball.health / ball.maxHealth : 1
          const isTough = ball.maxHealth > 1
          const jerseyColor = hpFrac > 0.66 ? '#FF4455' : hpFrac > 0.33 ? '#FF7A00' : '#cc1122'
          return (
          <div key={ball.id}>
            {burstIds.has(ball.id) && ball.state === 'destroyed' && (
              <div className="def-burst-ring" style={{ left:`${ball.x}%`, top:`${ball.y}%`, willChange:'transform,opacity' }}>
                <svg viewBox="0 0 80 80" width="80" height="80" style={{pointerEvents:'none'}}>
                  {Array.from({length:8},(_,i)=>{ const a=(i/8)*Math.PI*2; return <circle key={i} cx={40+Math.cos(a)*28} cy={40+Math.sin(a)*28} r="5" fill="#FF4455" opacity="0.9"/> })}
                </svg>
              </div>
            )}
            {/* HP bar for tough defenders */}
            {ball.state === 'active' && isTough && (
              <div style={{ position:'absolute', left:`${ball.x}%`, top:`${ball.y - 7}%`, transform:'translate(-50%,-50%)', width:44, background:'rgba(0,0,0,.6)', borderRadius:3, height:5, pointerEvents:'none', zIndex:9 }}>
                <div style={{ width:`${hpFrac * 100}%`, height:'100%', background: hpFrac > 0.5 ? '#2bff9a' : '#FF4455', borderRadius:3, transition:'width .1s' }} />
              </div>
            )}
            {(ball.state === 'active' || ball.state === 'destroyed') && (
              <div className={`def-ball is-${ball.state}`} style={{ left:`${ball.x}%`, top:`${ball.y}%`, willChange:'transform,left,top' }}>
                {/* Kawaii attacker with ball at feet, running downward */}
                <svg viewBox="0 0 80 90" width="50" height="56" style={{pointerEvents:'none', display:'block'}}>
                  <ellipse cx="38" cy="85" rx="22" ry="5" fill="rgba(0,0,0,.3)"/>
                  <circle cx="56" cy="76" r="11" fill="#f7f9fc" stroke="#101827" strokeWidth="2"/>
                  <path d="M56 67 l5 4-2 6h-6l-2-6z" fill="none" stroke="#101827" strokeWidth="1.5"/>
                  <rect x="24" y="54" width="9" height="22" rx="4.5" fill="#1a0a3a"/>
                  <rect x="38" y="54" width="9" height="22" rx="4.5" fill="#1a0a3a"/>
                  <ellipse cx="28" cy="76" rx="8" ry="5" fill="#222"/>
                  <ellipse cx="42" cy="76" rx="8" ry="5" fill="#222"/>
                  <path d="M15 27 q23-9 46 0 l-3 29 q-20 5-40 0z" fill={jerseyColor}/>
                  <path d="M28 22 v31 M48 22 v31" stroke="rgba(0,0,0,.25)" strokeWidth="3"/>
                  <rect x="7" y="30" width="9" height="20" rx="4.5" fill={jerseyColor}/>
                  <rect x="64" y="30" width="9" height="20" rx="4.5" fill={jerseyColor}/>
                  <circle cx="11" cy="51" r="4" fill="#f3c9a0"/>
                  <circle cx="68" cy="51" r="4" fill="#f3c9a0"/>
                  <circle cx="38" cy="16" r="18" fill="#f3c9a0"/>
                  <path d="M21 12 q17-20 34 0 q-4-14-17-16 q-13 2-17 16z" fill="#2a1a0e"/>
                  <circle cx="31" cy="16" r="3.6" fill="#1a1a1a"/>
                  <circle cx="45" cy="16" r="3.6" fill="#1a1a1a"/>
                  <circle cx="32.2" cy="14.8" r="1.2" fill="#fff"/>
                  <circle cx="46.2" cy="14.8" r="1.2" fill="#fff"/>
                  <circle cx="24" cy="22" r="2.8" fill="#ff8a8a" opacity=".55"/>
                  <circle cx="52" cy="22" r="2.8" fill="#ff8a8a" opacity=".55"/>
                  <path d="M34 24 q4 3 8 0" stroke="#1a1a1a" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
                  <text x="38" y="44" fontFamily="Barlow Condensed" fontWeight="900" fontSize={defFontSize} fill="rgba(255,255,255,.9)" textAnchor="middle">{defLabel}</text>
                </svg>
              </div>
            )}
          </div>
          )
        })}

        {bullets.map((b) => <div key={b.id} className="def-bullet" style={{ left:`${b.x}%`, top:`${b.y}%`, willChange:'top' }} />)}

        {tutorialDone && (
          <div className="def-shooter" style={{ left:`${shooterX}%`, top:'92%', filter:'drop-shadow(0 0 10px rgba(43,255,154,.7))' }}>
            {/* Kawaii goalkeeper at bottom */}
            <svg viewBox="0 0 80 90" width="48" height="54" style={{pointerEvents:'none', display:'block'}}>
              <ellipse cx="40" cy="85" rx="24" ry="5" fill="rgba(43,255,154,.15)"/>
              <rect x="28" y="54" width="9" height="22" rx="4.5" fill="#1a0a3a"/>
              <rect x="43" y="54" width="9" height="22" rx="4.5" fill="#1a0a3a"/>
              <ellipse cx="32" cy="76" rx="8" ry="5" fill="#1a3a2a"/>
              <ellipse cx="48" cy="76" rx="8" ry="5" fill="#1a3a2a"/>
              <path d="M16 27 q24-9 48 0 l-3 29 q-21 5-42 0z" fill="#2bff9a"/>
              <path d="M29 22 v31 M51 22 v31" stroke="rgba(0,0,0,.25)" strokeWidth="3"/>
              {/* Gloves raised */}
              <rect x="4" y="14" width="11" height="24" rx="5" fill="#2bff9a" transform="rotate(18 9 26)"/>
              <rect x="65" y="14" width="11" height="24" rx="5" fill="#2bff9a" transform="rotate(-18 71 26)"/>
              <circle cx="9" cy="10" r="8" fill="#2bff9a" stroke="#fff" strokeWidth="1.5"/>
              <circle cx="71" cy="10" r="8" fill="#2bff9a" stroke="#fff" strokeWidth="1.5"/>
              <circle cx="40" cy="16" r="18" fill="#f3c9a0"/>
              <path d="M23 12 q17-18 34 0 q-4-14-17-16 q-13 2-17 16z" fill="#3b2a1e"/>
              <circle cx="33" cy="16" r="3" fill="#1a1a1a"/>
              <circle cx="47" cy="16" r="3" fill="#1a1a1a"/>
              <circle cx="34" cy="14.8" r="1" fill="#fff"/>
              <circle cx="48" cy="14.8" r="1" fill="#fff"/>
              <circle cx="26" cy="22" r="2.5" fill="#ff8a8a" opacity=".5"/>
              <circle cx="54" cy="22" r="2.5" fill="#ff8a8a" opacity=".5"/>
              <path d="M36 24 q4 2 8 0" stroke="#1a1a1a" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
              <text x="40" y="44" fontFamily="Barlow Condensed" fontWeight="900" fontSize="9" fill="rgba(0,0,0,.7)" textAnchor="middle">GK</text>
            </svg>
          </div>
        )}

        {passedCount >= 2 && <div className="def-danger-warn">⚠ DANGER</div>}
      </div>

      {/* Info bar */}
      <div className="def-info">
        <div className="def-info-stat">
          <span style={{color:'#2bff9a'}}>{destroyedCount}</span>
          <small>Détruits</small>
        </div>
        <span className="def-info-label">Déplace ↔ pour viser</span>
        <div className="def-info-stat">
          <span style={{color:passedCount>=3?'#FF4455':passedCount>=2?'#FFB800':'rgba(255,255,255,.7)'}}>{passedCount}/3</span>
          <small>Passés</small>
        </div>
      </div>
    </section>
  )
}

export default DefensePhase
