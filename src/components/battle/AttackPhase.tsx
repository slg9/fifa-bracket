import { useCallback, useEffect, useRef, useState } from 'react'
import type { BattleDifficulty } from '../../types'
import GoalView from './GoalView'

export type AttackEndReason = 'goal' | 'saved' | 'miss' | 'intercepted' | 'timeout'

type AttackPhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  onRoundEnd: (isGoal: boolean, reason?: AttackEndReason) => void
}

const ATTACK_CFG = {
  easy:   { slalomTimer: 9,   rowCount: 5, gapWidth: 28, slalomAmp: 8,  pulseSpeed: 1.2,  perfectRange: 14, keeperSpeed: 22 },
  medium: { slalomTimer: 7,   rowCount: 6, gapWidth: 22, slalomAmp: 13, pulseSpeed: 0.85, perfectRange: 9,  keeperSpeed: 50 },
  hard:   { slalomTimer: 5.5, rowCount: 7, gapWidth: 17, slalomAmp: 17, pulseSpeed: 0.60, perfectRange: 5,  keeperSpeed: 85 },
}

const SLALOM_COMMENTS = [
  'Beau dribble !', 'Bien joué !', 'Incroyable !', 'Quel geste !',
  'Il les passe tous !', 'Magnifique !', 'Élégant !', 'En pleine course !',
]

// Each row has a single oscillating gap that alternates strictly left↔right
type SlalomRow = {
  y: number         // vertical position (%)
  gapW: number      // gap width (%)
  baseX: number     // gap left-edge center around which it oscillates
  amp: number       // oscillation amplitude (%)
  speed: number     // oscillation speed (rad/s)
  phaseOff: number  // starting phase offset
}

function generateRows(cfg: typeof ATTACK_CFG['easy']): SlalomRow[] {
  const rows: SlalomRow[] = []
  const { rowCount, gapWidth, slalomAmp } = cfg

  for (let i = 0; i < rowCount; i++) {
    const y = 80 - (i / (rowCount - 1)) * 62  // 80% → 18%

    // Strictly alternate: left zone (center ~18%) vs right zone (center ~78%)
    // This forces the player to move ~60% of screen width between rows
    const isLeft = i % 2 === 0
    const center = isLeft ? 18 : 78
    const baseX = center - gapWidth / 2

    // Different speed per row so rows don't synchronize
    const speed = 0.6 + Math.random() * 1.4   // 0.6–2.0 rad/s
    const phaseOff = Math.random() * Math.PI * 2

    rows.push({ y, gapW: gapWidth, baseX, amp: slalomAmp, speed, phaseOff })
  }
  return rows
}

/** Compute oscillated gap left-edge for a given elapsed time */
function gapXAt(row: SlalomRow, elapsedSec: number): number {
  const x = row.baseX + row.amp * Math.sin(elapsedSec * row.speed + row.phaseOff)
  return Math.max(2, Math.min(100 - row.gapW - 2, x))
}

export function AttackPhase({ difficulty, homeTeamId: _homeTeamId, awayTeamId: _awayTeamId, onRoundEnd }: AttackPhaseProps) {
  const cfg = ATTACK_CFG[difficulty]
  const [tutorialDone, setTutorialDone] = useState(() => sessionStorage.getItem('brakup:tut:atk') === '1')
  const [tutorialCountdown, setTutorialCountdown] = useState(15)
  const [tutorialReady, setTutorialReady] = useState(false)
  const [phase, setPhase] = useState<'slalom' | 'pulse'>('slalom')
  const [rows] = useState<SlalomRow[]>(() => generateRows(cfg))
  const [playerX, setPlayerX] = useState(50)
  const [playerY, setPlayerY] = useState(88)
  const [remainingSeconds, setRemainingSeconds] = useState(cfg.slalomTimer)
  const [keeperX, setKeeperX] = useState(50)
  const [pulseRadius, setPulseRadius] = useState(26)
  const [inPerfect, setInPerfect] = useState(false)
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const [collisionFlash, setCollisionFlash] = useState(false)
  const [pulsePhase, setPulsePhase] = useState<'idle' | 'result'>('idle')
  const [rowComment, setRowComment] = useState<string | null>(null)
  const [showPulseIntro, setShowPulseIntro] = useState(false)
  // Current oscillated gap positions — updated every RAF tick for rendering
  const [rowGapXs, setRowGapXs] = useState<number[]>(() => rows.map((r) => r.baseX))

  const endedRef = useRef(false)
  const playerXRef = useRef(50)
  const playerYRef = useRef(88)
  const remainingMsRef = useRef(cfg.slalomTimer * 1000)
  const containerRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<'slalom' | 'pulse'>('slalom')
  const pulseTimeRef = useRef(0)
  const keeperXRef = useRef(50)
  const pulseResultSentRef = useRef(false)
  const passedRowsRef = useRef(new Set<number>())
  const lastCommentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tutorialDoneRef = useRef(false)
  // Ref copy of gap positions for collision detection inside RAF (avoids stale closure)
  const rowGapXsRef = useRef<number[]>(rows.map((r) => r.baseX))

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
    sessionStorage.setItem('brakup:tut:atk', '1')
    tutorialDoneRef.current = true
    setTutorialDone(true)
  }

  const finish = useCallback((isGoal: boolean, reason: AttackEndReason) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(isGoal, reason)
  }, [onRoundEnd])

  // Slalom RAF loop
  useEffect(() => {
    if (phase !== 'slalom' || !tutorialDone) return
    let frame = 0
    let prev: number | null = null
    const tick = (now: number) => {
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev)
      prev = now
      if (endedRef.current) return

      remainingMsRef.current = Math.max(0, remainingMsRef.current - delta)
      const seconds = remainingMsRef.current / 1000
      setRemainingSeconds(seconds)

      // Player moves BOTTOM → TOP driven by elapsed time
      const totalMs = cfg.slalomTimer * 1000
      const elapsed = totalMs - remainingMsRef.current
      const progress = Math.min(1, elapsed / totalMs)
      const newY = 88 - progress * 83  // 88% → 5%
      playerYRef.current = newY
      setPlayerY(newY)

      // Compute oscillated gap positions for this frame
      const elapsedSec = elapsed / 1000
      const newGapXs = rows.map((row) => gapXAt(row, elapsedSec))
      rowGapXsRef.current = newGapXs
      setRowGapXs(newGapXs)

      // CRITICAL: check goal arrival FIRST (before timeout)
      if (newY <= 5) {
        setShowPulseIntro(true)
        return
      }

      if (seconds <= 0) {
        finish(false, 'timeout')
        return
      }

      // Collision — check when player is within ±4% of a row y
      const px = playerXRef.current
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri]
        if (Math.abs(newY - row.y) < 4) {
          const gapX = rowGapXsRef.current[ri]
          const inGap = px >= gapX && px <= gapX + row.gapW
          if (!inGap) {
            setCollisionFlash(true)
            finish(false, 'intercepted')
            return
          }
          // Player is in gap — show comment once per row
          if (!passedRowsRef.current.has(ri)) {
            passedRowsRef.current.add(ri)
            const comment = SLALOM_COMMENTS[Math.floor(Math.random() * SLALOM_COMMENTS.length)]
            setRowComment(comment)
            if (lastCommentTimeoutRef.current) clearTimeout(lastCommentTimeoutRef.current)
            lastCommentTimeoutRef.current = setTimeout(() => setRowComment(null), 800)
          }
        }
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, cfg.slalomTimer, rows, finish, tutorialDone])

  // Pointer control for slalom
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'slalom' || endedRef.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * 100
    playerXRef.current = Math.max(2, Math.min(98, x))
    setPlayerX(playerXRef.current)
  }

  // Pulse RAF loop
  useEffect(() => {
    if (phase !== 'pulse' || showPulseIntro) return
    pulseTimeRef.current = 0
    let frame = 0
    let prev: number | null = null
    let autoTimeoutMs = 5000

    const tick = (now: number) => {
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev)
      prev = now
      if (endedRef.current) return

      pulseTimeRef.current += delta / 1000
      autoTimeoutMs -= delta

      // Keeper oscillation
      const newKeeperX = 50 + 35 * Math.sin(pulseTimeRef.current * 0.8)
      keeperXRef.current = newKeeperX
      setKeeperX(newKeeperX)

      // Pulse radius: R(t) = 26 + 22 * sin(t * pulseSpeed)
      const R = 26 + 22 * Math.sin(pulseTimeRef.current * cfg.pulseSpeed)
      setPulseRadius(R)
      const perfect = Math.abs(R - 26) < cfg.perfectRange
      setInPerfect(perfect)

      if (autoTimeoutMs <= 0 && !pulseResultSentRef.current) {
        pulseResultSentRef.current = true
        setResultLabel('RATÉ !')
        setTimeout(() => finish(false, 'miss'), 700)
        return
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, showPulseIntro, cfg.pulseSpeed, cfg.perfectRange, finish])

  const handlePulseTap = () => {
    if (endedRef.current || pulseResultSentRef.current || phase !== 'pulse') return
    pulseResultSentRef.current = true
    const R = 26 + 22 * Math.sin(pulseTimeRef.current * cfg.pulseSpeed)
    const perfect = Math.abs(R - 26) < cfg.perfectRange
    if (!perfect) {
      setResultLabel('RATÉ !')
      setTimeout(() => finish(false, 'miss'), 700)
      return
    }
    const keeperBlocking = Math.abs(keeperXRef.current - 50) < 16
    if (keeperBlocking) {
      setResultLabel('ARRÊTÉ !')
      setPulsePhase('result')
      setTimeout(() => finish(false, 'saved'), 700)
    } else {
      setResultLabel('BUT !')
      setPulsePhase('result')
      setTimeout(() => finish(true, 'goal'), 700)
    }
  }

  const countdownRatio = Math.max(0, Math.min(1, remainingSeconds / cfg.slalomTimer))
  const countdownColor = countdownRatio > 0.45
    ? `hsl(${Math.round(5 + countdownRatio * 38)} 100% 50%)`
    : '#ff334d'

  return (
    <section
      className="atk-root"
      ref={containerRef}
      onPointerMove={handlePointerMove}
      style={{ touchAction: 'none', userSelect: 'none' }}
    >
      <style>{`
        .atk-root {
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
        .atk-tutorial {
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
        .atk-tutorial__title {
          font: 900 clamp(32px,10vw,56px) 'Barlow Condensed', sans-serif;
          letter-spacing: .2em;
          color: #FFB800;
          text-shadow: 0 0 32px rgba(255,184,0,.6);
          text-transform: uppercase;
        }
        .atk-tutorial__instruction {
          font: 600 clamp(13px,4vw,17px) 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.85);
          text-align: center;
          max-width: 320px;
          line-height: 1.4;
        }
        .atk-tutorial__arrow {
          font-size: 28px;
          animation: atkArrowLR 0.8s ease-in-out infinite alternate;
          display: inline-block;
        }
        @keyframes atkArrowLR {
          from { transform: translateX(-12px); }
          to   { transform: translateX(12px); }
        }
        .atk-tutorial__btn {
          margin-top: 8px;
          padding: 12px 28px;
          border-radius: 10px;
          border: 2px solid rgba(255,184,0,.4);
          background: rgba(255,184,0,.08);
          color: rgba(255,255,255,.45);
          font: 800 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em;
          cursor: default;
          transition: background .2s, border-color .2s, color .2s;
          pointer-events: none;
        }
        .atk-tutorial__btn.is-ready {
          background: #1a4d2e;
          border-color: #2bff9a;
          color: #2bff9a;
          cursor: pointer;
          pointer-events: auto;
          box-shadow: 0 0 16px rgba(43,255,154,.35);
        }
        /* Row comment */
        .atk-row-comment {
          position: absolute;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          font: 900 clamp(16px,6vw,26px) 'Barlow Condensed', sans-serif;
          letter-spacing: .12em;
          color: #2bff9a;
          text-shadow: 0 0 16px rgba(43,255,154,.7);
          pointer-events: none;
          z-index: 30;
          white-space: nowrap;
          animation: atkCommentPop .15s ease-out both;
        }
        @keyframes atkCommentPop { from { transform: translate(-50%,-50%) scale(0.7); opacity: 0; } to { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
        /* Countdown */
        .atk-clock {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 14px;
          background: #04110a;
          box-sizing: border-box;
          z-index: 10;
        }
        .atk-clock__track {
          flex: 1;
          height: 7px;
          border-radius: 99px;
          background: rgba(255,255,255,.08);
          overflow: hidden;
        }
        .atk-clock__fill {
          display: block;
          width: 100%;
          height: 100%;
          transform-origin: left;
          transition: background .12s;
        }
        .atk-clock strong {
          min-width: 28px;
          font: 800 13px 'JetBrains Mono', monospace;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        /* Game area */
        .atk-game {
          position: relative;
          overflow: hidden;
        }
        /* Slalom pitch */
        .atk-pitch {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, #0c2e1d, #0a2618);
        }
        .atk-pitch-lines {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          opacity: .35;
        }
        /* Defender rows */
        .atk-row {
          position: absolute;
          left: 0;
          right: 0;
          height: 9px;
          pointer-events: none;
          will-change: transform;
        }
        .atk-row-obstacle {
          position: absolute;
          top: 0;
          height: 100%;
          border-radius: 3px;
          box-shadow: 0 0 10px rgba(255,68,85,.6);
        }
        .atk-row-gap-indicator {
          position: absolute;
          top: -3px;
          height: 15px;
          border-radius: 3px;
          border: 1.5px dashed rgba(43,255,154,.5);
          pointer-events: none;
        }
        /* Player dot */
        .atk-player {
          position: absolute;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #4fff9a, #13d472);
          border: 2.5px solid #fff;
          box-shadow: 0 0 14px rgba(43,255,154,.8), 0 0 28px rgba(43,255,154,.4);
          transform: translate(-50%, -50%);
          pointer-events: none;
          z-index: 10;
          transition: box-shadow .08s;
        }
        .atk-player.is-flash {
          background: #FF4455;
          box-shadow: 0 0 24px rgba(255,68,85,1);
          animation: atkCollide .3s ease-out;
        }
        /* Pulse phase */
        .atk-pulse {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 5;
        }
        .atk-pulse-instruction {
          position: absolute;
          top: 12%;
          left: 50%;
          transform: translateX(-50%);
          font: 900 15px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em;
          color: #FFB800;
          white-space: nowrap;
          text-shadow: 0 0 12px rgba(255,184,0,.6);
          animation: atkFadeIn .4s ease-out both;
          pointer-events: none;
          z-index: 6;
        }
        .atk-pulse-ball-wrap {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          z-index: 15;
          pointer-events: none;
        }
        .atk-pulse-ring {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          border: 3px dashed #f5c842;
          box-shadow: 0 0 10px rgba(245,200,66,.5), inset 0 0 10px rgba(245,200,66,.2);
          pointer-events: none;
          z-index: 8;
          width: 72px;
          height: 72px;
        }
        .atk-result-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font: 900 clamp(40px,14vw,72px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em;
          text-shadow: 0 0 36px currentColor;
          animation: atkResultIn .25s ease-out both;
          z-index: 20;
          pointer-events: none;
          padding: 0 8px;
          text-align: center;
        }
        /* Info bar */
        .atk-info {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 8px 20px;
          background: linear-gradient(180deg, #0a2618, #061a10);
          box-sizing: border-box;
          z-index: 5;
          overflow: hidden;
        }
        .atk-info-phase {
          padding: 4px 10px;
          border-radius: 6px;
          background: rgba(255,184,0,.12);
          border: 1px solid rgba(255,184,0,.4);
          font: 800 11px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em;
          color: #FFB800;
          flex-shrink: 0;
        }
        .atk-info-label {
          font: 700 11px 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.6);
          letter-spacing: .06em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Transition overlay (slalom → pulse) */
        .atk-transition {
          position: absolute;
          inset: 0;
          z-index: 40;
          background: rgba(5,11,22,0.92);
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 28px 20px;
          text-align: center;
          animation: atkFadeIn .3s ease-out both;
        }
        .atk-transition__icon { font-size: 36px; }
        .atk-transition__title {
          font: 900 clamp(28px,9vw,48px) 'Barlow Condensed', sans-serif;
          letter-spacing: .15em;
          color: #2bff9a;
          text-shadow: 0 0 28px rgba(43,255,154,.6);
          text-transform: uppercase;
        }
        .atk-transition__sub {
          font: 800 clamp(14px,5vw,20px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em;
          color: #FFB800;
        }
        .atk-transition__desc {
          font: 500 clamp(12px,3.5vw,15px) 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.7);
          max-width: 300px;
          line-height: 1.45;
        }
        .atk-transition__btn {
          margin-top: 10px;
          padding: 13px 32px;
          border-radius: 10px;
          border: 2px solid #2bff9a;
          background: rgba(43,255,154,.12);
          color: #2bff9a;
          font: 800 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em;
          cursor: pointer;
          box-shadow: 0 0 20px rgba(43,255,154,.3);
        }
        @keyframes atkCollide {
          0%,100% { transform: translate(-50%,-50%) scale(1); }
          50% { transform: translate(-50%,-50%) scale(1.4); }
        }
        @keyframes atkFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes atkResultIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        /* Goal zone indicator */
        .atk-goal-zone {
          position: absolute;
          top: 0;
          left: 10%;
          right: 10%;
          height: 8px;
          background: linear-gradient(90deg, transparent, rgba(43,255,154,.3), transparent);
          border-bottom: 2px dashed rgba(43,255,154,.4);
          pointer-events: none;
        }
      `}</style>

      {/* Tutorial overlay */}
      {!tutorialDone && (
        <div className="atk-tutorial">
          <div className="atk-tutorial__title">SLALOM</div>
          <div className="atk-tutorial__instruction">
            Glisse latéralement pour passer dans la brèche — elle bouge ! Alterne gauche et droite à chaque rang de défenseurs.
          </div>
          <span className="atk-tutorial__arrow">↔</span>
          <button
            type="button"
            className={`atk-tutorial__btn${tutorialReady ? ' is-ready' : ''}`}
            onClick={handleTutorialStart}
          >
            {tutorialReady ? 'OK — Jouer !' : `Démarrer (${tutorialCountdown})`}
          </button>
        </div>
      )}

      {/* Slalom → Pulse transition overlay */}
      {showPulseIntro && (
        <div className="atk-transition">
          <div className="atk-transition__icon">⚽</div>
          <div className="atk-transition__title">Bravo !</div>
          <div className="atk-transition__sub">Tu entres dans la zone de tir</div>
          <div className="atk-transition__desc">
            Le ballon pulse et grossit. <b style={{color:'#FFB800'}}>Tape l&apos;écran quand le ballon est dans la zone dorée</b> pour décocher un tir parfait. Le gardien bouge — vise quand il est loin du centre !
          </div>
          <button
            type="button"
            className="atk-transition__btn"
            onClick={() => { setShowPulseIntro(false); phaseRef.current = 'pulse'; setPhase('pulse') }}
          >
            ▶ Tirer !
          </button>
        </div>
      )}

      {/* TOP 5% — countdown (slalom only) */}
      <div className="atk-clock">
        <div className="atk-clock__track">
          <i className="atk-clock__fill" style={{
            transform: `scaleX(${phase === 'slalom' ? countdownRatio : 1})`,
            background: `linear-gradient(90deg,#FFB800,#ff7a1a 60%,${countdownColor})`,
          }} />
        </div>
        <strong style={{ color: phase === 'slalom' ? countdownColor : '#2bff9a' }}>
          {phase === 'slalom' ? `${Math.ceil(remainingSeconds)}s` : 'TIRER !'}
        </strong>
      </div>

      {/* 70% — game area */}
      <div className="atk-game">
        {phase === 'slalom' ? (
          <div className="atk-pitch">
            {/* Pitch lines */}
            <svg className="atk-pitch-lines" viewBox="0 0 375 420" preserveAspectRatio="none">
              <g stroke="rgba(255,255,255,.07)" strokeWidth="1">
                {[70, 140, 210, 280, 350].map((y) => (
                  <line key={y} x1="0" y1={y} x2="375" y2={y} />
                ))}
              </g>
            </svg>

            {/* Goal zone indicator at top */}
            <div className="atk-goal-zone" />

            {/* Defender rows — rendered with current oscillated gap positions */}
            {rows.map((row, ri) => {
              const gapX = rowGapXs[ri] ?? row.baseX
              const gapEnd = gapX + row.gapW
              // Left obstacle: 0 → gapX, Right obstacle: gapEnd → 100
              // Color alternates slightly per row for visual distinction
              const hue = ri % 2 === 0 ? '255,68,85' : '255,100,60'
              return (
                <div key={ri} className="atk-row" style={{ top: `${row.y}%` }}>
                  {/* Left block */}
                  {gapX > 2 && (
                    <div
                      className="atk-row-obstacle"
                      style={{
                        left: 0,
                        width: `${gapX}%`,
                        background: `rgba(${hue},.8)`,
                      }}
                    />
                  )}
                  {/* Gap indicator */}
                  <div
                    className="atk-row-gap-indicator"
                    style={{ left: `${gapX}%`, width: `${row.gapW}%` }}
                  />
                  {/* Right block */}
                  {gapEnd < 98 && (
                    <div
                      className="atk-row-obstacle"
                      style={{
                        left: `${gapEnd}%`,
                        width: `${100 - gapEnd}%`,
                        background: `rgba(${hue},.8)`,
                      }}
                    />
                  )}
                </div>
              )
            })}

            {/* Player dot */}
            <div
              className={`atk-player${collisionFlash ? ' is-flash' : ''}`}
              style={{ left: `${playerX}%`, top: `${playerY}%` }}
            />

            {/* Row comment */}
            {rowComment && (
              <div className="atk-row-comment">{rowComment}</div>
            )}
          </div>
        ) : (
          /* Pulse phase */
          <div
            className="atk-pulse"
            onPointerDown={handlePulseTap}
          >
            {/* GoalView as backdrop */}
            <GoalView difficulty={difficulty} keeperX={keeperX} interactive={false} />

            <div className="atk-pulse-instruction">
              TAPER AU BON MOMENT !
            </div>

            {/* Target ring (fixed at R=26 equivalent) */}
            <div className="atk-pulse-ring" />

            {/* Pulsing ball */}
            <div className="atk-pulse-ball-wrap">
              <svg
                viewBox="0 0 80 80"
                style={{
                  width: `${pulseRadius * 2 * 1.2}px`,
                  height: `${pulseRadius * 2 * 1.2}px`,
                  filter: inPerfect
                    ? 'drop-shadow(0 0 12px #2bff9a)'
                    : pulsePhase === 'result'
                    ? 'drop-shadow(0 0 12px #FF4455)'
                    : 'drop-shadow(0 0 6px rgba(255,255,255,.5))',
                  transition: 'filter .08s',
                  pointerEvents: 'none',
                }}
              >
                <circle cx="40" cy="40" r="34" fill="#f7f9fc" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="4" />
                <path d="M40 19 53 28 48 45H32L27 28Z" fill="none" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="3" />
                <line x1="40" y1="6" x2="40" y2="19" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="2" strokeLinecap="round" />
                <line x1="53" y1="28" x2="66" y2="22" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="2" strokeLinecap="round" />
                <line x1="48" y1="45" x2="56" y2="57" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="2" strokeLinecap="round" />
                <line x1="32" y1="45" x2="24" y2="57" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="2" strokeLinecap="round" />
                <line x1="27" y1="28" x2="14" y2="22" stroke={inPerfect ? '#2bff9a' : '#101827'} strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>

            {resultLabel && (
              <div
                className="atk-result-overlay"
                style={{ color: resultLabel === 'BUT !' ? '#2bff9a' : '#FF4455' }}
              >
                {resultLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 25% — info bar */}
      <div className="atk-info">
        <span className="atk-info-phase">
          {phase === 'slalom' ? 'SLALOM' : 'TIR'}
        </span>
        <span className="atk-info-label">
          {phase === 'slalom'
            ? 'Passe dans la brèche — elle bouge !'
            : inPerfect
            ? '✓ ZONE PARFAITE'
            : 'Timing du tir'}
        </span>
      </div>
    </section>
  )
}

export default AttackPhase
