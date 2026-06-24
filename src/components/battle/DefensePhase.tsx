import { useCallback, useEffect, useRef, useState } from 'react'
import type { BattleDifficulty, DefenseOutcome } from '../../types'
import GoalSave from './GoalSave'

type DefensePhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  onRoundEnd: (outcome: DefenseOutcome) => void
}

const DEFENSE_CFG = {
  easy:   { timer: 12, ballSpeed: 70,  waveCount: 3, balloonsPerWave: 4 },
  medium: { timer: 10, ballSpeed: 105, waveCount: 4, balloonsPerWave: 5 },
  hard:   { timer: 8,  ballSpeed: 150, waveCount: 5, balloonsPerWave: 6 },
}

type BallItem = {
  id: string
  x: number          // 0–100%
  spawnDelay: number // ms relative to RAF start
  speed: number      // % per second
  state: 'waiting' | 'active' | 'destroyed' | 'passed'
  y: number          // current % position (animated via RAF)
  startedAt: number | null
}

function createBalls(cfg: typeof DEFENSE_CFG['easy']): BallItem[] {
  const total = cfg.waveCount * cfg.balloonsPerWave
  const balls: BallItem[] = []
  let delay = 0
  for (let i = 0; i < total; i++) {
    delay += i === 0 ? 200 : 300 + Math.random() * 400
    balls.push({
      id: crypto.randomUUID(),
      x: 5 + Math.random() * 90,
      spawnDelay: delay,
      speed: cfg.ballSpeed * (0.85 + Math.random() * 0.3),
      state: 'waiting',
      y: -8,
      startedAt: null,
    })
  }
  return balls
}

export function DefensePhase({ difficulty, homeTeamId: _homeTeamId, awayTeamId: _awayTeamId, onRoundEnd }: DefensePhaseProps) {
  const cfg = DEFENSE_CFG[difficulty]
  const totalBalls = cfg.waveCount * cfg.balloonsPerWave

  const [tutorialDone, setTutorialDone] = useState(() => sessionStorage.getItem('brakup:tut:def') === '1')
  const [tutorialCountdown, setTutorialCountdown] = useState(15)
  const [tutorialReady, setTutorialReady] = useState(false)

  const [phase, setPhase] = useState<'invaders' | 'goal_save'>('invaders')
  const [balls, setBalls] = useState<BallItem[]>(() => createBalls(cfg))
  const [remainingSeconds, setRemainingSeconds] = useState(cfg.timer)
  const [burstIds, setBurstIds] = useState<Set<string>>(() => new Set())
  const [passedCount, setPassedCount] = useState(0)
  const [destroyedCount, setDestroyedCount] = useState(0)

  const endedRef = useRef(false)
  const ballsRef = useRef(balls)
  ballsRef.current = balls
  const remainingMsRef = useRef(cfg.timer * 1000)
  const passedCountRef = useRef(0)
  const destroyedCountRef = useRef(0)
  const phaseRef = useRef<'invaders' | 'goal_save'>('invaders')
  const goalSaveTriggeredRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)

  // Tutorial countdown
  useEffect(() => {
    if (tutorialDone) return
    if (tutorialCountdown <= 0) {
      setTutorialReady(true)
      return
    }
    const timer = setTimeout(() => {
      setTutorialCountdown((c) => c - 1)
    }, 1000)
    return () => clearTimeout(timer)
  }, [tutorialDone, tutorialCountdown])

  const handleTutorialStart = () => {
    if (!tutorialReady) return
    sessionStorage.setItem('brakup:tut:def', '1')
    setTutorialDone(true)
  }

  const finish = useCallback((outcome: DefenseOutcome) => {
    if (endedRef.current) return
    endedRef.current = true
    cancelAnimationFrame(frameRef.current)
    onRoundEnd(outcome)
  }, [onRoundEnd])

  const [showGoalSaveIntro, setShowGoalSaveIntro] = useState(false)

  const triggerGoalSave = useCallback(() => {
    if (goalSaveTriggeredRef.current || endedRef.current) return
    goalSaveTriggeredRef.current = true
    cancelAnimationFrame(frameRef.current)
    // Show transition overlay before GoalSave
    setShowGoalSaveIntro(true)
  }, [])

  // Main animation loop
  useEffect(() => {
    if (phase !== 'invaders' || !tutorialDone) return
    let prev: number | null = null
    const tick = (now: number) => {
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev)
      prev = now
      if (endedRef.current) return

      // Record RAF start time for relative spawn delay comparison
      if (startTimeRef.current === null) startTimeRef.current = now
      const relativeNow = now - startTimeRef.current

      remainingMsRef.current = Math.max(0, remainingMsRef.current - delta)
      const seconds = remainingMsRef.current / 1000
      setRemainingSeconds(seconds)

      const nextBalls = ballsRef.current.map((ball): BallItem => {
        if (ball.state === 'destroyed' || ball.state === 'passed') return ball
        if (ball.state === 'waiting') {
          // check if spawn time reached using RELATIVE time
          if (relativeNow >= ball.spawnDelay) {
            return { ...ball, state: 'active', startedAt: now }
          }
          return ball
        }
        // active
        const elapsed = ball.startedAt !== null ? now - ball.startedAt : 0
        const newY = ball.y + ball.speed * delta / 1000
        if (newY > 92) {
          passedCountRef.current += 1
          setPassedCount(passedCountRef.current)
          return { ...ball, y: 92, state: 'passed' }
        }
        void elapsed
        return { ...ball, y: newY }
      })

      ballsRef.current = nextBalls
      setBalls(nextBalls)

      // Check if 3+ passed → trigger goal save immediately
      if (passedCountRef.current >= 3 && !goalSaveTriggeredRef.current) {
        triggerGoalSave()
        return
      }

      // Check all resolved
      const allResolved = nextBalls.every((b) => b.state === 'destroyed' || b.state === 'passed')
      if (allResolved && !goalSaveTriggeredRef.current) {
        const passed = passedCountRef.current
        if (passed >= 3) {
          triggerGoalSave()
        } else {
          finish({ path: 'space_invaders', blocked: destroyedCountRef.current, total: totalBalls })
        }
        return
      }

      // Timer expired
      if (seconds <= 0) {
        const passed = passedCountRef.current
        if (passed >= 3) {
          triggerGoalSave()
        } else {
          // Mark remaining active balls as passed
          const finalPassed = nextBalls.filter((b) => b.state !== 'destroyed').length
          finish({ path: 'space_invaders', blocked: destroyedCountRef.current, total: totalBalls })
          void finalPassed
        }
        return
      }

      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [phase, cfg, totalBalls, finish, triggerGoalSave, tutorialDone])

  const destroyBall = (id: string) => {
    if (endedRef.current || phaseRef.current !== 'invaders') return
    const ball = ballsRef.current.find((b) => b.id === id)
    if (!ball || ball.state !== 'active') return
    destroyedCountRef.current += 1
    setDestroyedCount(destroyedCountRef.current)
    setBurstIds((prev) => new Set(prev).add(id))
    setTimeout(() => setBurstIds((prev) => { const next = new Set(prev); next.delete(id); return next }), 500)
    const next = ballsRef.current.map((b) => b.id === id ? { ...b, state: 'destroyed' as const } : b)
    ballsRef.current = next
    setBalls(next)
  }

  if (showGoalSaveIntro) {
    const safePassedCount = Math.min(3, Math.max(1, passedCountRef.current || 1))
    return (
      <section style={{ position:'relative', width:'100%', height:'100%', background:'#050b16', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'28px 20px', textAlign:'center', fontFamily:"'Barlow Condensed', sans-serif" }}>
        <style>{`.def-trans-btn { margin-top:10px; padding:13px 32px; border-radius:10px; border:2px solid #FF4455; background:rgba(255,68,85,.12); color:#FF4455; font:800 16px 'Barlow Condensed',sans-serif; letter-spacing:.14em; cursor:pointer; box-shadow:0 0 20px rgba(255,68,85,.3); }`}</style>
        <div style={{fontSize:36}}>⚠️</div>
        <div style={{font:"900 clamp(26px,9vw,44px) 'Barlow Condensed',sans-serif", letterSpacing:'.12em', color:'#FF4455', textShadow:'0 0 28px rgba(255,68,85,.6)', textTransform:'uppercase'}}>Attention !</div>
        <div style={{font:"800 clamp(14px,5vw,20px) 'Barlow Condensed',sans-serif", letterSpacing:'.08em', color:'#FFB800'}}>L&apos;adversaire entre dans la zone de tir</div>
        <div style={{font:"500 clamp(12px,3.5vw,15px) 'Barlow Condensed',sans-serif", color:'rgba(255,255,255,.7)', maxWidth:300, lineHeight:1.45}}>
          {safePassedCount} ballon{safePassedCount > 1 ? 's' : ''} fonce{safePassedCount > 1 ? 'nt' : ''} vers ton but !{' '}
          <b style={{color:'#FF4455'}}>Touche ou balaye les ballons</b>{' '}
          avant qu&apos;ils passent la ligne pour les arrêter. Si un seul passe — but encaissé !
        </div>
        <button
          type="button"
          className="def-trans-btn"
          onClick={() => { setShowGoalSaveIntro(false); phaseRef.current = 'goal_save'; setPhase('goal_save') }}
        >
          🧤 Je défends !
        </button>
      </section>
    )
  }

  if (phase === 'goal_save') {
    const safePassedCount = Math.min(3, Math.max(1, passedCountRef.current || 1))
    return (
      <section className="def-root" style={{ width: '100%', height: '100%' }}>
        <style>{`
          .def-root { display: flex; flex-direction: column; width: 100%; height: 100%; background: #050b16; font-family: 'Barlow Condensed', sans-serif; overflow: hidden; }
          .def-gs-header { padding: 8px 16px; background: #1a0608; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
          .def-gs-header span { font: 900 14px 'Barlow Condensed', sans-serif; letter-spacing: .14em; color: #FF4455; text-transform: uppercase; }
          .def-gs-body { flex: 1; min-height: 0; }
        `}</style>
        <div className="def-gs-header">
          <span>⚠ GARDIEN ! {safePassedCount} ballon{safePassedCount > 1 ? 's' : ''} à arrêter</span>
        </div>
        <div className="def-gs-body">
          <GoalSave
            ballCount={safePassedCount}
            difficulty={difficulty}
            onResult={(saved) => finish({ path: 'goal_save', blocked: destroyedCountRef.current, total: totalBalls, saved })}
          />
        </div>
      </section>
    )
  }

  const countdownRatio = Math.max(0, Math.min(1, remainingSeconds / cfg.timer))
  const countdownColor = countdownRatio > 0.45
    ? `hsl(${Math.round(5 + countdownRatio * 38)} 100% 50%)`
    : '#ff334d'

  return (
    <section className="def-root" ref={containerRef} style={{ touchAction: 'none', userSelect: 'none' }}>
      <style>{`
        .def-root {
          display: grid;
          grid-template-rows: 5% 70% 25%;
          width: 100%;
          height: 100%;
          background: #050b16;
          font-family: 'Barlow Condensed', sans-serif;
          overflow: hidden;
          position: relative;
        }
        /* Tutorial overlay */
        .def-tutorial {
          position: absolute;
          inset: 0;
          z-index: 50;
          background: rgba(5,11,22,0.88);
          backdrop-filter: blur(3px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 24px;
        }
        .def-tutorial__title {
          font: 900 clamp(32px,10vw,56px) 'Barlow Condensed', sans-serif;
          letter-spacing: .2em;
          color: #FF4455;
          text-shadow: 0 0 32px rgba(255,68,85,.6);
          text-transform: uppercase;
        }
        .def-tutorial__instruction {
          font: 600 clamp(13px,4vw,17px) 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.85);
          text-align: center;
          max-width: 320px;
          line-height: 1.4;
        }
        .def-tutorial__btn {
          margin-top: 8px;
          padding: 12px 28px;
          border-radius: 10px;
          border: 2px solid rgba(255,68,85,.4);
          background: rgba(255,68,85,.08);
          color: rgba(255,255,255,.45);
          font: 800 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em;
          cursor: default;
          transition: background .2s, border-color .2s, color .2s;
          pointer-events: none;
        }
        .def-tutorial__btn.is-ready {
          background: #1a0608;
          border-color: #2bff9a;
          color: #2bff9a;
          cursor: pointer;
          pointer-events: auto;
          box-shadow: 0 0 16px rgba(43,255,154,.35);
        }
        /* Countdown */
        .def-clock {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 14px;
          background: #1a0608;
          box-sizing: border-box;
          z-index: 10;
        }
        .def-clock__track {
          flex: 1;
          height: 7px;
          border-radius: 99px;
          background: rgba(255,255,255,.08);
          overflow: hidden;
        }
        .def-clock__fill {
          display: block;
          width: 100%;
          height: 100%;
          transform-origin: left;
        }
        .def-clock strong {
          min-width: 28px;
          font: 800 13px 'JetBrains Mono', monospace;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        /* Game area */
        .def-game {
          position: relative;
          overflow: hidden;
          background: linear-gradient(180deg, #050b16, #0a0c18);
        }
        .def-game-lines {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          opacity: .2;
        }
        /* Ball */
        .def-ball {
          position: absolute;
          transform: translate(-50%, -50%);
          z-index: 8;
          touch-action: none;
        }
        .def-ball.is-active {
          pointer-events: auto;
          cursor: pointer;
        }
        .def-ball.is-destroyed { pointer-events: none; animation: defBurst .4s ease-out forwards; }
        .def-ball.is-passed { pointer-events: none; opacity: 0; }
        .def-ball.is-waiting { pointer-events: none; opacity: 0; }
        .def-burst-ring {
          position: absolute;
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 15;
          animation: defBurstRing .5s ease-out forwards;
        }
        /* Info bar */
        .def-info {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 20px;
          background: linear-gradient(180deg, #1a0608, #0d0405);
          box-sizing: border-box;
          z-index: 5;
        }
        .def-info-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .def-info-stat span {
          font: 900 18px 'JetBrains Mono', monospace;
        }
        .def-info-stat small {
          font: 700 10px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em;
          color: rgba(255,255,255,.5);
          text-transform: uppercase;
        }
        .def-info-label {
          font: 800 12px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em;
          color: rgba(255,255,255,.6);
          text-transform: uppercase;
        }
        .def-danger-warning {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font: 900 clamp(20px,8vw,40px) 'Barlow Condensed', sans-serif;
          letter-spacing: .12em;
          color: #FF4455;
          text-shadow: 0 0 24px rgba(255,68,85,.8);
          pointer-events: none;
          animation: defDanger .5s ease-in-out infinite alternate;
          z-index: 20;
        }
        @keyframes defBurst {
          0% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
          60% { transform: translate(-50%,-50%) scale(1.8); opacity: .5; }
          100% { transform: translate(-50%,-50%) scale(2.4); opacity: 0; }
        }
        @keyframes defBurstRing {
          0% { transform: translate(-50%,-50%) scale(0.5); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(2.5); opacity: 0; }
        }
        @keyframes defDanger {
          from { opacity: .7; }
          to { opacity: 1; text-shadow: 0 0 36px rgba(255,68,85,1); }
        }
      `}</style>

      {/* Tutorial overlay */}
      {!tutorialDone && (
        <div className="def-tutorial">
          <div className="def-tutorial__title">DÉFENSE</div>
          <div className="def-tutorial__instruction">
            Cliquez / tapez sur les ballons pour les détruire avant qu'ils franchissent la ligne ! Si 3 passent, vous devez arrêter les tirs sur le but !
          </div>
          <button
            type="button"
            className={`def-tutorial__btn${tutorialReady ? ' is-ready' : ''}`}
            onClick={handleTutorialStart}
          >
            {tutorialReady ? 'OK — Jouer !' : `Démarrer (${tutorialCountdown})`}
          </button>
        </div>
      )}

      {/* TOP 5% — countdown */}
      <div className="def-clock">
        <div className="def-clock__track">
          <i className="def-clock__fill" style={{
            transform: `scaleX(${countdownRatio})`,
            background: `linear-gradient(90deg,#FFB800,#ff7a1a 55%,${countdownColor})`,
          }} />
        </div>
        <strong style={{ color: countdownColor }}>{Math.ceil(remainingSeconds)}s</strong>
      </div>

      {/* 70% — invaders game */}
      <div className="def-game">
        <svg className="def-game-lines" viewBox="0 0 375 420" preserveAspectRatio="none">
          <g stroke="rgba(255,100,100,.15)" strokeWidth="1">
            {[70, 140, 210, 280, 350].map((y) => (
              <line key={y} x1="0" y1={y} x2="375" y2={y} />
            ))}
          </g>
        </svg>

        {balls.map((ball) => (
          <div key={ball.id}>
            {burstIds.has(ball.id) && (
              <div className="def-burst-ring" style={{ left: `${ball.x}%`, top: `${ball.y}%` }}>
                <svg viewBox="0 0 80 80" width="80" height="80" style={{ pointerEvents: 'none' }}>
                  {Array.from({ length: 8 }, (_, i) => {
                    const angle = (i / 8) * Math.PI * 2
                    return <circle key={i} cx={40 + Math.cos(angle) * 28} cy={40 + Math.sin(angle) * 28} r="5" fill="#FFB800" opacity="0.9" />
                  })}
                </svg>
              </div>
            )}
            <div
              className={`def-ball is-${ball.state}`}
              style={{ left: `${ball.x}%`, top: `${ball.y}%` }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                destroyBall(ball.id)
              }}
            >
              <svg viewBox="0 0 80 80" width="52" height="52" style={{ pointerEvents: 'none' }}>
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
        ))}

        {passedCount >= 2 && (
          <div className="def-danger-warning">⚠ DANGER</div>
        )}
      </div>

      {/* 25% — info bar */}
      <div className="def-info">
        <div className="def-info-stat">
          <span style={{ color: '#2bff9a' }}>{destroyedCount}</span>
          <small>Arrêtés</small>
        </div>
        <span className="def-info-label">Touchez les ballons !</span>
        <div className="def-info-stat">
          <span style={{ color: passedCount >= 3 ? '#FF4455' : passedCount >= 2 ? '#FFB800' : 'rgba(255,255,255,.7)' }}>
            {passedCount}/3
          </span>
          <small>Passés</small>
        </div>
      </div>
    </section>
  )
}

export default DefensePhase
