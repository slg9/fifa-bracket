import { useCallback, useEffect, useRef, useState } from 'react'
import type { BattleDifficulty, DefenseOutcome } from '../../types'
import GoalSave from './GoalSave'

type DefensePhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
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
  state: 'waiting' | 'active' | 'destroyed' | 'passed'; y: number; startedAt: number | null
}
type Bullet = { id: string; x: number; y: number }

function createBalls(cfg: typeof DEFENSE_CFG['easy']): BallItem[] {
  const total = cfg.waveCount * cfg.balloonsPerWave
  const balls: BallItem[] = []
  let delay = 0
  for (let i = 0; i < total; i++) {
    delay += i === 0 ? 300 : 350 + Math.random() * 500
    balls.push({ id: crypto.randomUUID(), x: 8 + Math.random() * 84, spawnDelay: delay, speed: cfg.ballSpeed * (0.85 + Math.random() * 0.3), state: 'waiting', y: -10, startedAt: null })
  }
  return balls
}

export function DefensePhase({ difficulty, homeTeamId: _h, awayTeamId: _a, onRoundEnd, isPaused }: DefensePhaseProps) {
  const cfg = DEFENSE_CFG[difficulty]
  const totalBalls = cfg.waveCount * cfg.balloonsPerWave

  const [tutorialDone, setTutorialDone] = useState(() => sessionStorage.getItem('brakup:tut:def') === '1')
  const [phase, setPhase]               = useState<'invaders' | 'goal_save'>('invaders')
  const [showGoalSaveIntro, setShowGoalSaveIntro] = useState(false)
  const [balls, setBalls]               = useState<BallItem[]>(() => createBalls(cfg))
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

      // ── Apply hits ──
      const finalBalls   = hitBallIds.size > 0 ? nextBalls.map((b) => hitBallIds.has(b.id) ? { ...b, state: 'destroyed' as const } : b) : nextBalls
      const finalBullets = movedBullets.filter((b) => !hitBulletIds.has(b.id))

      if (hitBallIds.size > 0) {
        destroyedCountRef.current += hitBallIds.size
        setDestroyedCount(destroyedCountRef.current)
        hitBallIds.forEach((id) => {
          setBurstIds((prev) => new Set(prev).add(id))
          setTimeout(() => setBurstIds((prev) => { const next = new Set(prev); next.delete(id); return next }), 500)
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
      <section style={{ position:'relative', width:'100%', height:'100%', background:'#050b16', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'28px 20px', textAlign:'center', fontFamily:"'Barlow Condensed',sans-serif" }}>
        <style>{`.def-trans-btn{margin-top:10px;padding:13px 32px;border-radius:10px;border:2px solid #FF4455;background:rgba(255,68,85,.12);color:#FF4455;font:800 16px 'Barlow Condensed',sans-serif;letter-spacing:.14em;cursor:pointer;box-shadow:0 0 20px rgba(255,68,85,.3)}`}</style>
        <div style={{fontSize:36}}>⚠️</div>
        <div style={{font:"900 clamp(26px,9vw,44px) 'Barlow Condensed',sans-serif",letterSpacing:'.12em',color:'#FF4455',textShadow:'0 0 28px rgba(255,68,85,.6)',textTransform:'uppercase'}}>Attention !</div>
        <div style={{font:"800 clamp(14px,5vw,20px) 'Barlow Condensed',sans-serif",letterSpacing:'.08em',color:'#FFB800'}}>L&apos;adversaire entre dans la zone de tir</div>
        <div style={{font:"500 clamp(12px,3.5vw,15px) 'Barlow Condensed',sans-serif",color:'rgba(255,255,255,.7)',maxWidth:300,lineHeight:1.45}}>
          {n} ballon{n>1?'s':''} fonc{n>1?'ent':'e'} vers ton but !{' '}
          <b style={{color:'#FF4455'}}>Touche ou balaye les ballons</b>{' '}
          avant qu&apos;ils passent la ligne. Un seul passe — but encaissé !
        </div>
        <button type="button" className="def-trans-btn" onClick={() => { setShowGoalSaveIntro(false); phaseRef.current = 'goal_save'; setPhase('goal_save') }}>
          🧤 Je défends !
        </button>
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
        .def-shooter { position:absolute; transform:translate(-50%,-50%); z-index:15; pointer-events:none; filter:drop-shadow(0 0 8px rgba(43,255,154,.7)); transition:left .04s linear; }
        .def-burst-ring { position:absolute; transform:translate(-50%,-50%); pointer-events:none; z-index:20; animation:defBurstRing .5s ease-out forwards; }
        .def-danger-line { position:absolute; left:0; right:0; height:3px; background:rgba(255,68,85,.35); top:88%; pointer-events:none; z-index:5; box-shadow:0 0 8px rgba(255,68,85,.5); }
        .def-info { display:flex; align-items:center; justify-content:space-between; padding:8px 20px; background:linear-gradient(180deg,#1a0608,#0d0405); box-sizing:border-box; z-index:5; }
        .def-info-stat { display:flex; flex-direction:column; align-items:center; gap:2px; }
        .def-info-stat span { font:900 18px 'JetBrains Mono',monospace; }
        .def-info-stat small { font:700 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; color:rgba(255,255,255,.5); text-transform:uppercase; }
        .def-info-label { font:800 12px 'Barlow Condensed',sans-serif; letter-spacing:.1em; color:rgba(255,255,255,.6); text-transform:uppercase; }
        .def-danger-warn { position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); font:900 clamp(18px,7vw,36px) 'Barlow Condensed',sans-serif; letter-spacing:.12em; color:#FF4455; text-shadow:0 0 24px rgba(255,68,85,.8); pointer-events:none; animation:defDanger .5s ease-in-out infinite alternate; z-index:20; }
        @keyframes defBurst { 0%{transform:translate(-50%,-50%) scale(1);opacity:1} 60%{transform:translate(-50%,-50%) scale(2);opacity:.4} 100%{transform:translate(-50%,-50%) scale(2.6);opacity:0} }
        @keyframes defBurstRing { 0%{transform:translate(-50%,-50%) scale(.4);opacity:1} 100%{transform:translate(-50%,-50%) scale(2.8);opacity:0} }
        @keyframes defDanger { from{opacity:.6} to{opacity:1;text-shadow:0 0 40px rgba(255,68,85,1)} }
      `}</style>

      {/* Tutorial */}
      {!tutorialDone && (
        <div className="def-tutorial">
          <div className="def-tutorial__title">DÉFENSE</div>
          <div className="def-tutorial__instruction">
            Déplace le tireur gauche/droite pour viser les ballons.<br/>
            <b style={{color:'#FFB800'}}>Le tir est automatique</b> — concentre-toi sur le visée !<br/><br/>
            <span style={{color:'rgba(255,255,255,.5)',fontSize:'0.9em'}}>⌨ Clavier : ← → pour se déplacer</span>
          </div>
          <div className="def-tutorial__hint">↔</div>
          <button type="button" className="def-tutorial__btn" onClick={() => { sessionStorage.setItem('brakup:tut:def','1'); setTutorialDone(true) }}>
            OK — Jouer !
          </button>
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

        {balls.map((ball) => (
          <div key={ball.id}>
            {burstIds.has(ball.id) && (
              <div className="def-burst-ring" style={{ left:`${ball.x}%`, top:`${ball.y}%` }}>
                <svg viewBox="0 0 80 80" width="80" height="80" style={{pointerEvents:'none'}}>
                  {Array.from({length:8},(_,i)=>{ const a=(i/8)*Math.PI*2; return <circle key={i} cx={40+Math.cos(a)*28} cy={40+Math.sin(a)*28} r="5" fill="#FFB800" opacity="0.9"/> })}
                </svg>
              </div>
            )}
            <div className={`def-ball is-${ball.state}`} style={{ left:`${ball.x}%`, top:`${ball.y}%` }}>
              <svg viewBox="0 0 80 80" width="46" height="46" style={{pointerEvents:'none'}}>
                <circle cx="40" cy="40" r="34" fill="#f7f9fc" stroke="#101827" strokeWidth="4"/>
                <path d="M40 19 53 28 48 45H32L27 28Z" fill="none" stroke="#101827" strokeWidth="3"/>
                <line x1="40" y1="6"  x2="40" y2="19" stroke="#101827" strokeWidth="2" strokeLinecap="round"/>
                <line x1="53" y1="28" x2="66" y2="22" stroke="#101827" strokeWidth="2" strokeLinecap="round"/>
                <line x1="48" y1="45" x2="56" y2="57" stroke="#101827" strokeWidth="2" strokeLinecap="round"/>
                <line x1="32" y1="45" x2="24" y2="57" stroke="#101827" strokeWidth="2" strokeLinecap="round"/>
                <line x1="27" y1="28" x2="14" y2="22" stroke="#101827" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
        ))}

        {bullets.map((b) => <div key={b.id} className="def-bullet" style={{ left:`${b.x}%`, top:`${b.y}%` }} />)}

        {tutorialDone && (
          <div className="def-shooter" style={{ left:`${shooterX}%`, top:'92%' }}>
            <svg viewBox="0 0 60 70" width="44" height="52" style={{pointerEvents:'none'}}>
              <ellipse cx="30" cy="65" rx="26" ry="7" fill="rgba(43,255,154,.18)"/>
              <rect x="18" y="32" width="24" height="28" rx="8" fill="#2bff9a"/>
              <rect x="24" y="4" width="12" height="32" rx="6" fill="#2bff9a" stroke="rgba(255,255,255,.4)" strokeWidth="1.5"/>
              <circle cx="30" cy="6" r="5" fill="#FFB800" opacity="0.9"/>
              <circle cx="24" cy="42" r="3" fill="#050b16"/>
              <circle cx="36" cy="42" r="3" fill="#050b16"/>
              <circle cx="25" cy="41" r="1" fill="#fff"/>
              <circle cx="37" cy="41" r="1" fill="#fff"/>
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
