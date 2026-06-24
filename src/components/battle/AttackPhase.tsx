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
  easy:   { slalomTimer: 8,   rowCount: 5, gapCount: 3, gapWidth: 26, pulseSpeed: 1.2, perfectRange: 14, keeperSpeed: 22 },
  medium: { slalomTimer: 6,   rowCount: 6, gapCount: 2, gapWidth: 21, pulseSpeed: 0.85, perfectRange: 9, keeperSpeed: 50 },
  hard:   { slalomTimer: 4.5, rowCount: 7, gapCount: 2, gapWidth: 16, pulseSpeed: 0.60, perfectRange: 5, keeperSpeed: 85 },
}

type SlalomRow = { y: number; gaps: { x: number; w: number }[] }

function generateRows(cfg: typeof ATTACK_CFG['easy']): SlalomRow[] {
  const rows: SlalomRow[] = []
  const { rowCount, gapCount, gapWidth } = cfg
  for (let i = 0; i < rowCount; i++) {
    const y = 18 + (i / (rowCount - 1)) * 65  // 18% to 83%
    const gaps: { x: number; w: number }[] = []
    const sectionWidth = 100 / gapCount
    for (let g = 0; g < gapCount; g++) {
      const sectionStart = g * sectionWidth
      const maxX = sectionWidth - gapWidth
      const x = sectionStart + Math.random() * Math.max(0, maxX)
      gaps.push({ x, w: gapWidth })
    }
    rows.push({ y, gaps })
  }
  return rows
}

function isInGap(playerX: number, gaps: { x: number; w: number }[]): boolean {
  for (const gap of gaps) {
    if (playerX >= gap.x && playerX <= gap.x + gap.w) return true
  }
  return false
}

export function AttackPhase({ difficulty, homeTeamId: _homeTeamId, awayTeamId: _awayTeamId, onRoundEnd }: AttackPhaseProps) {
  const cfg = ATTACK_CFG[difficulty]
  const [phase, setPhase] = useState<'slalom' | 'pulse'>('slalom')
  const [rows] = useState<SlalomRow[]>(() => generateRows(cfg))
  const [playerX, setPlayerX] = useState(50)
  const [playerY, setPlayerY] = useState(5)
  const [remainingSeconds, setRemainingSeconds] = useState(cfg.slalomTimer)
  const [keeperX, setKeeperX] = useState(50)
  const [pulseRadius, setPulseRadius] = useState(26)
  const [inPerfect, setInPerfect] = useState(false)
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const [collisionFlash, setCollisionFlash] = useState(false)
  const [pulsePhase, setPulsePhase] = useState<'idle' | 'result'>('idle')

  const endedRef = useRef(false)
  const playerXRef = useRef(50)
  const playerYRef = useRef(5)
  const remainingMsRef = useRef(cfg.slalomTimer * 1000)
  const containerRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<'slalom' | 'pulse'>('slalom')
  const pulseTimeRef = useRef(0)
  const keeperXRef = useRef(50)
  const pulseResultSentRef = useRef(false)

  const finish = useCallback((isGoal: boolean, reason: AttackEndReason) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(isGoal, reason)
  }, [onRoundEnd])

  // Slalom RAF loop
  useEffect(() => {
    if (phase !== 'slalom') return
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

      if (seconds <= 0) {
        finish(false, 'timeout')
        return
      }

      // Descend player from 5% to 88% over slalomTimer seconds
      const totalMs = cfg.slalomTimer * 1000
      const elapsed = totalMs - remainingMsRef.current
      const progress = Math.min(1, elapsed / totalMs)
      const newY = 5 + progress * 83  // 5% → 88%
      playerYRef.current = newY
      setPlayerY(newY)

      // Collision check — when player is within ±4% of a row y
      const px = playerXRef.current
      for (const row of rows) {
        if (Math.abs(newY - row.y) < 4) {
          if (!isInGap(px, row.gaps)) {
            setCollisionFlash(true)
            finish(false, 'intercepted')
            return
          }
        }
      }

      if (newY >= 88) {
        // Reached the goal — transition to pulse
        phaseRef.current = 'pulse'
        setPhase('pulse')
        return
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, cfg.slalomTimer, rows, finish])

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
    if (phase !== 'pulse') return
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
  }, [phase, cfg.pulseSpeed, cfg.perfectRange, finish])

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
          height: 7px;
          display: flex;
          pointer-events: none;
        }
        .atk-row-obstacle {
          background: rgba(255, 68, 85, .75);
          height: 100%;
          border-radius: 2px;
          box-shadow: 0 0 8px rgba(255,68,85,.5);
        }
        .atk-row-gap {
          height: 100%;
          background: transparent;
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
          /* ring at R=26 in SVG space of 120px diameter, scale to container */
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
        }
        .atk-info-phase {
          padding: 4px 10px;
          border-radius: 6px;
          background: rgba(255,184,0,.12);
          border: 1px solid rgba(255,184,0,.4);
          font: 800 11px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em;
          color: #FFB800;
        }
        .atk-info-label {
          font: 700 12px 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.6);
          letter-spacing: .06em;
        }
        @keyframes atkCollide {
          0%,100% { transform: translate(-50%,-50%) scale(1); }
          50% { transform: translate(-50%,-50%) scale(1.4); }
        }
        @keyframes atkFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes atkResultIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>

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

            {/* Defender rows */}
            {rows.map((row, rowIndex) => {
              // Build obstacle segments from gaps
              const segments: { x: number; w: number; isGap: boolean }[] = []
              const sorted = [...row.gaps].sort((a, b) => a.x - b.x)
              let cursor = 0
              for (const gap of sorted) {
                if (gap.x > cursor) segments.push({ x: cursor, w: gap.x - cursor, isGap: false })
                segments.push({ x: gap.x, w: gap.w, isGap: true })
                cursor = gap.x + gap.w
              }
              if (cursor < 100) segments.push({ x: cursor, w: 100 - cursor, isGap: false })

              return (
                <div
                  key={rowIndex}
                  className="atk-row"
                  style={{ top: `${row.y}%` }}
                >
                  {segments.map((seg, si) => (
                    <div
                      key={si}
                      className={seg.isGap ? 'atk-row-gap' : 'atk-row-obstacle'}
                      style={{ width: `${seg.w}%` }}
                    />
                  ))}
                </div>
              )
            })}

            {/* Player dot */}
            <div
              className={`atk-player${collisionFlash ? ' is-flash' : ''}`}
              style={{ left: `${playerX}%`, top: `${playerY}%` }}
            />
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
            ? 'Passe dans les brèches !'
            : inPerfect
            ? '✓ ZONE PARFAITE'
            : 'Timing du tir'}
        </span>
      </div>
    </section>
  )
}

export default AttackPhase
