import { useCallback, useEffect, useRef, useState } from 'react'
import type { BattleDifficulty } from '../../types'
import GoalView from './GoalView'

export type AttackEndReason = 'goal' | 'saved' | 'miss' | 'intercepted' | 'timeout'

type AttackPhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  onRoundEnd: (isGoal: boolean, reason?: AttackEndReason) => void
  isPaused?: boolean
}

const ATTACK_CFG = {
  easy:   { rowCount: 5, gapWidth: 28, slalomAmp: 8,  fallSpeed: 19, pulseSpeed: 1.2,  perfectRange: 14, keeperSpeed: 22 },
  medium: { rowCount: 6, gapWidth: 22, slalomAmp: 13, fallSpeed: 25, pulseSpeed: 0.85, perfectRange: 9,  keeperSpeed: 50 },
  hard:   { rowCount: 7, gapWidth: 17, slalomAmp: 17, fallSpeed: 33, pulseSpeed: 0.60, perfectRange: 5,  keeperSpeed: 85 },
}

const ROW_SPACING   = 30   // % between rows' initial positions
const PLAYER_Y      = 82   // fixed ball Y (%)
const PLAYER_SPEED  = 55   // %/s via keyboard

const SLALOM_COMMENTS = [
  'Beau dribble !', 'Bien joué !', 'Incroyable !', 'Quel geste !',
  'Il les passe tous !', 'Magnifique !', 'Élégant !', 'En pleine course !',
]

type SlalomRow = {
  y0: number        // initial Y (starts above screen, falls down)
  gapW: number
  baseX: number     // gap left-edge base position
  amp: number       // oscillation amplitude
  speed: number     // oscillation speed (rad/s)
  phaseOff: number  // phase offset
}

function generateRows(cfg: typeof ATTACK_CFG['easy']): SlalomRow[] {
  const rows: SlalomRow[] = []
  const { rowCount, gapWidth, slalomAmp } = cfg
  for (let i = 0; i < rowCount; i++) {
    // Strictly alternate: left zone (~18%) vs right zone (~78%)
    const isLeft = i % 2 === 0
    const center = isLeft ? 18 : 78
    const baseX = center - gapWidth / 2
    const speed   = 0.6 + Math.random() * 1.4
    const phaseOff = Math.random() * Math.PI * 2
    rows.push({
      y0: -12 - i * ROW_SPACING,   // row i starts progressively above screen
      gapW: gapWidth,
      baseX,
      amp: slalomAmp,
      speed,
      phaseOff,
    })
  }
  return rows
}

function gapXAt(row: SlalomRow, elapsedSec: number): number {
  const x = row.baseX + row.amp * Math.sin(elapsedSec * row.speed + row.phaseOff)
  return Math.max(2, Math.min(100 - row.gapW - 2, x))
}

export function AttackPhase({ difficulty, homeTeamId: _homeTeamId, awayTeamId: _awayTeayId, onRoundEnd, isPaused }: AttackPhaseProps) {
  const cfg = ATTACK_CFG[difficulty]

  const [tutorialDone, setTutorialDone] = useState(() => sessionStorage.getItem('brakup:tut:atk') === '1')
  const [phase, setPhase] = useState<'slalom' | 'pulse'>('slalom')
  const [rows]            = useState<SlalomRow[]>(() => generateRows(cfg))
  const [playerX, setPlayerX]         = useState(50)
  const [rowPositions, setRowPositions] = useState<number[]>(() => rows.map((r) => r.y0))
  const [rowGapXs, setRowGapXs]       = useState<number[]>(() => rows.map((r) => r.baseX))
  const [keeperX, setKeeperX]         = useState(50)
  const [pulseRadius, setPulseRadius]  = useState(26)
  const [inPerfect, setInPerfect]     = useState(false)
  const [resultLabel, setResultLabel]  = useState<string | null>(null)
  const [collisionFlash, setCollisionFlash] = useState(false)
  const [pulsePhase, setPulsePhase]   = useState<'idle' | 'result'>('idle')
  const [rowComment, setRowComment]   = useState<string | null>(null)
  const [showPulseIntro, setShowPulseIntro] = useState(false)

  const endedRef          = useRef(false)
  const playerXRef        = useRef(50)
  const rowPositionsRef   = useRef<number[]>(rows.map((r) => r.y0))
  const rowGapXsRef       = useRef<number[]>(rows.map((r) => r.baseX))
  const checkedRowsRef    = useRef(new Set<number>())
  const containerRef      = useRef<HTMLDivElement>(null)
  const phaseRef          = useRef<'slalom' | 'pulse'>('slalom')
  const pulseTimeRef      = useRef(0)
  const keeperXRef        = useRef(50)
  const pulseResultSentRef = useRef(false)
  const lastCommentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedRef        = useRef(0)   // seconds of active play (pauses excluded)
  const isPausedRef       = useRef(false)
  isPausedRef.current     = isPaused ?? false
  const keysRef           = useRef({ left: false, right: false })

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

  const finish = useCallback((isGoal: boolean, reason: AttackEndReason) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(isGoal, reason)
  }, [onRoundEnd])

  // ── Slalom RAF ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'slalom' || !tutorialDone) return
    let frame = 0
    let prev: number | null = null

    const tick = (now: number) => {
      if (isPausedRef.current) { prev = null; frame = requestAnimationFrame(tick); return }
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev)
      prev = now
      if (endedRef.current) return

      elapsedRef.current += delta / 1000

      // ── Keyboard movement ──
      if (keysRef.current.left) {
        playerXRef.current = Math.max(2, playerXRef.current - PLAYER_SPEED * delta / 1000)
        setPlayerX(playerXRef.current)
      }
      if (keysRef.current.right) {
        playerXRef.current = Math.min(98, playerXRef.current + PLAYER_SPEED * delta / 1000)
        setPlayerX(playerXRef.current)
      }

      // ── Move rows downward ──
      const newPositions = rowPositionsRef.current.map((y) => y + cfg.fallSpeed * delta / 1000)
      const newGapXs = rows.map((row) => gapXAt(row, elapsedRef.current))
      rowPositionsRef.current = newPositions
      rowGapXsRef.current = newGapXs
      setRowPositions([...newPositions])
      setRowGapXs([...newGapXs])

      // ── Collision check ──
      const px = playerXRef.current
      for (let ri = 0; ri < rows.length; ri++) {
        if (checkedRowsRef.current.has(ri)) continue
        const rowY = newPositions[ri]
        if (rowY < PLAYER_Y - 5) continue   // not yet at player level
        // Row reached player level — evaluate once
        checkedRowsRef.current.add(ri)
        const gapX = newGapXs[ri]
        const inGap = px >= gapX && px <= gapX + rows[ri].gapW
        if (!inGap) {
          setCollisionFlash(true)
          finish(false, 'intercepted')
          return
        }
        // Successfully passed — show comment
        const comment = SLALOM_COMMENTS[Math.floor(Math.random() * SLALOM_COMMENTS.length)]
        setRowComment(comment)
        if (lastCommentTimeoutRef.current) clearTimeout(lastCommentTimeoutRef.current)
        lastCommentTimeoutRef.current = setTimeout(() => setRowComment(null), 800)
      }

      // ── All rows passed → transition to pulse ──
      if (checkedRowsRef.current.size === rows.length) {
        setShowPulseIntro(true)
        return
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, rows, cfg.fallSpeed, finish, tutorialDone])

  // Pointer control (horizontal only for slalom)
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'slalom' || endedRef.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * 100
    playerXRef.current = Math.max(2, Math.min(98, x))
    setPlayerX(playerXRef.current)
  }

  // ── Pulse RAF ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'pulse' || showPulseIntro) return
    pulseTimeRef.current = 0
    let frame = 0
    let prev: number | null = null
    let autoTimeoutMs = 5000

    const tick = (now: number) => {
      if (isPausedRef.current) { prev = null; frame = requestAnimationFrame(tick); return }
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev)
      prev = now
      if (endedRef.current) return

      pulseTimeRef.current += delta / 1000
      autoTimeoutMs -= delta

      const newKeeperX = 50 + 35 * Math.sin(pulseTimeRef.current * 0.8)
      keeperXRef.current = newKeeperX
      setKeeperX(newKeeperX)

      const R = 26 + 22 * Math.sin(pulseTimeRef.current * cfg.pulseSpeed)
      setPulseRadius(R)
      setInPerfect(Math.abs(R - 26) < cfg.perfectRange)

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
    if (!perfect) { setResultLabel('RATÉ !'); setTimeout(() => finish(false, 'miss'), 700); return }
    const keeperBlocking = Math.abs(keeperXRef.current - 50) < 16
    if (keeperBlocking) {
      setResultLabel('ARRÊTÉ !'); setPulsePhase('result'); setTimeout(() => finish(false, 'saved'), 700)
    } else {
      setResultLabel('BUT !'); setPulsePhase('result'); setTimeout(() => finish(true, 'goal'), 700)
    }
  }

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
          grid-template-rows: 70% 30%;
          width: 100%; height: 100%;
          background: #050b16;
          font-family: 'Barlow Condensed', sans-serif;
          overflow: hidden;
          position: relative;
        }
        /* Tutorial overlay */
        .atk-tutorial {
          position: absolute; inset: 0; z-index: 50;
          background: rgba(5,11,22,0.90); backdrop-filter: blur(3px);
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 14px; padding: 24px;
        }
        .atk-tutorial__title {
          font: 900 clamp(32px,10vw,56px) 'Barlow Condensed', sans-serif;
          letter-spacing: .2em; color: #FFB800;
          text-shadow: 0 0 32px rgba(255,184,0,.6); text-transform: uppercase;
        }
        .atk-tutorial__instruction {
          font: 600 clamp(13px,4vw,17px) 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.85); text-align: center; max-width: 320px; line-height: 1.4;
        }
        .atk-tutorial__arrow { font-size: 28px; animation: atkArrowLR 0.8s ease-in-out infinite alternate; display: inline-block; }
        @keyframes atkArrowLR { from { transform: translateX(-12px); } to { transform: translateX(12px); } }
        .atk-tutorial__btn {
          margin-top: 8px; padding: 12px 28px; border-radius: 10px;
          border: 2px solid #2bff9a; background: rgba(43,255,154,.1);
          color: #2bff9a; font: 800 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em; cursor: pointer;
          box-shadow: 0 0 16px rgba(43,255,154,.35);
        }
        /* Row comment */
        .atk-row-comment {
          position: absolute; top: 35%; left: 50%; transform: translate(-50%,-50%);
          font: 900 clamp(16px,6vw,26px) 'Barlow Condensed', sans-serif;
          letter-spacing: .12em; color: #2bff9a;
          text-shadow: 0 0 16px rgba(43,255,154,.7);
          pointer-events: none; z-index: 30; white-space: nowrap;
          animation: atkCommentPop .15s ease-out both;
        }
        @keyframes atkCommentPop { from { transform:translate(-50%,-50%) scale(.7); opacity:0; } to { transform:translate(-50%,-50%) scale(1); opacity:1; } }
        /* Game area */
        .atk-game { position: relative; overflow: hidden; }
        .atk-pitch { position: absolute; inset: 0; background: linear-gradient(180deg,#0c2e1d,#0a2618); }
        .atk-pitch-lines { position: absolute; inset: 0; width:100%; height:100%; pointer-events:none; opacity:.3; }
        /* Defender rows (falling) */
        .atk-row { position: absolute; left: 0; right: 0; height: 9px; pointer-events: none; }
        .atk-row-obstacle {
          position: absolute; top: 0; height: 100%; border-radius: 3px;
          box-shadow: 0 2px 12px rgba(255,68,85,.55);
        }
        .atk-row-gap-indicator {
          position: absolute; top: -4px; height: 17px; border-radius: 3px;
          border: 1.5px dashed rgba(43,255,154,.45); pointer-events: none;
        }
        /* Player ball */
        .atk-player {
          position: absolute; width: 24px; height: 24px; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #4fff9a, #13d472);
          border: 2.5px solid #fff;
          box-shadow: 0 0 14px rgba(43,255,154,.8), 0 0 28px rgba(43,255,154,.4);
          transform: translate(-50%, -50%); pointer-events: none; z-index: 10;
        }
        .atk-player.is-flash { background:#FF4455; box-shadow:0 0 24px rgba(255,68,85,1); animation:atkCollide .3s; }
        @keyframes atkCollide { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.5)} }
        /* Pulse phase */
        .atk-pulse { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; z-index:5; }
        .atk-pulse-instruction { position:absolute; top:12%; left:50%; transform:translateX(-50%); font:900 15px 'Barlow Condensed',sans-serif; letter-spacing:.14em; color:#FFB800; white-space:nowrap; text-shadow:0 0 12px rgba(255,184,0,.6); pointer-events:none; z-index:6; }
        .atk-pulse-ball-wrap { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:15; pointer-events:none; }
        .atk-pulse-ring { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); border-radius:50%; border:3px dashed #f5c842; box-shadow:0 0 10px rgba(245,200,66,.5); pointer-events:none; z-index:8; width:72px; height:72px; }
        .atk-result-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font:900 clamp(40px,14vw,72px) 'Barlow Condensed',sans-serif; letter-spacing:.08em; text-shadow:0 0 36px currentColor; animation:atkResultIn .25s ease-out both; z-index:20; pointer-events:none; }
        @keyframes atkResultIn { from{transform:scale(.5);opacity:0} to{transform:scale(1);opacity:1} }
        /* Transition overlay */
        .atk-transition { position:absolute; inset:0; z-index:40; background:rgba(5,11,22,.92); backdrop-filter:blur(4px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:28px 20px; text-align:center; animation:atkFadeIn .3s ease-out both; }
        .atk-transition__title { font:900 clamp(28px,9vw,48px) 'Barlow Condensed',sans-serif; letter-spacing:.15em; color:#2bff9a; text-shadow:0 0 28px rgba(43,255,154,.6); text-transform:uppercase; }
        .atk-transition__sub { font:800 clamp(14px,5vw,20px) 'Barlow Condensed',sans-serif; letter-spacing:.08em; color:#FFB800; }
        .atk-transition__desc { font:500 clamp(12px,3.5vw,15px) 'Barlow Condensed',sans-serif; color:rgba(255,255,255,.7); max-width:300px; line-height:1.45; }
        .atk-transition__btn { margin-top:10px; padding:13px 32px; border-radius:10px; border:2px solid #2bff9a; background:rgba(43,255,154,.12); color:#2bff9a; font:800 16px 'Barlow Condensed',sans-serif; letter-spacing:.14em; cursor:pointer; box-shadow:0 0 20px rgba(43,255,154,.3); }
        @keyframes atkFadeIn { from{opacity:0} to{opacity:1} }
        /* Info bar */
        .atk-info { display:flex; align-items:center; justify-content:center; gap:16px; padding:10px 20px; background:linear-gradient(180deg,#0a2618,#061a10); box-sizing:border-box; z-index:5; overflow:hidden; }
        .atk-info-phase { padding:4px 10px; border-radius:6px; background:rgba(255,184,0,.12); border:1px solid rgba(255,184,0,.4); font:800 11px 'Barlow Condensed',sans-serif; letter-spacing:.12em; color:#FFB800; flex-shrink:0; }
        .atk-info-label { font:700 11px 'Barlow Condensed',sans-serif; color:rgba(255,255,255,.6); letter-spacing:.06em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        /* Row arrival arrow hint */
        .atk-arrow-hint { position:absolute; top:4%; left:50%; transform:translateX(-50%); font:900 13px 'Barlow Condensed',sans-serif; letter-spacing:.1em; color:rgba(255,68,85,.6); pointer-events:none; animation:atkArrowDown .7s ease-in-out infinite alternate; }
        @keyframes atkArrowDown { from{transform:translateX(-50%) translateY(-3px)} to{transform:translateX(-50%) translateY(3px)} }
      `}</style>

      {/* Tutorial */}
      {!tutorialDone && (
        <div className="atk-tutorial">
          <div className="atk-tutorial__title">SLALOM</div>
          <div className="atk-tutorial__instruction">
            Les défenseurs arrivent du haut ! Glisse latéralement pour passer dans la brèche — elle bouge, reste attentif !
            <br /><br />
            <span style={{ color:'rgba(255,255,255,.5)', fontSize:'0.9em' }}>⌨ Clavier : ← → pour se déplacer</span>
          </div>
          <span className="atk-tutorial__arrow">↔</span>
          <button type="button" className="atk-tutorial__btn" onClick={() => { sessionStorage.setItem('brakup:tut:atk','1'); setTutorialDone(true) }}>
            OK — Jouer !
          </button>
        </div>
      )}

      {/* Slalom → Pulse transition */}
      {showPulseIntro && (
        <div className="atk-transition">
          <div style={{fontSize:36}}>⚽</div>
          <div className="atk-transition__title">Bravo !</div>
          <div className="atk-transition__sub">Tu entres dans la zone de tir</div>
          <div className="atk-transition__desc">
            Le ballon pulse. <b style={{color:'#FFB800'}}>Tape au bon moment</b> pour décocher un tir parfait. Le gardien bouge — vise quand il s&apos;écarte !
          </div>
          <button type="button" className="atk-transition__btn" onClick={() => { setShowPulseIntro(false); phaseRef.current = 'pulse'; setPhase('pulse') }}>
            ▶ Tirer !
          </button>
        </div>
      )}

      {/* 70% — game area */}
      <div className="atk-game">
        {phase === 'slalom' ? (
          <div className="atk-pitch">
            <svg className="atk-pitch-lines" viewBox="0 0 375 420" preserveAspectRatio="none">
              <g stroke="rgba(255,255,255,.06)" strokeWidth="1">
                {[70,140,210,280,350].map((y) => <line key={y} x1="0" y1={y} x2="375" y2={y} />)}
              </g>
            </svg>

            {/* Arrow hint at top */}
            <div className="atk-arrow-hint">▼ DÉFENSEURS ▼</div>

            {/* Falling rows */}
            {rows.map((row, ri) => {
              const rowY = rowPositions[ri] ?? row.y0
              if (rowY < -8 || rowY > 108) return null
              const gapX = rowGapXs[ri] ?? row.baseX
              const gapEnd = gapX + row.gapW
              const hue = ri % 2 === 0 ? '255,68,85' : '255,100,50'
              return (
                <div key={ri} className="atk-row" style={{ top:`${rowY}%` }}>
                  {gapX > 2 && <div className="atk-row-obstacle" style={{ left:0, width:`${gapX}%`, background:`rgba(${hue},.82)` }} />}
                  <div className="atk-row-gap-indicator" style={{ left:`${gapX}%`, width:`${row.gapW}%` }} />
                  {gapEnd < 98 && <div className="atk-row-obstacle" style={{ left:`${gapEnd}%`, width:`${100-gapEnd}%`, background:`rgba(${hue},.82)` }} />}
                </div>
              )
            })}

            {/* Player dot (fixed Y, moves left/right) */}
            <div className={`atk-player${collisionFlash?' is-flash':''}`} style={{ left:`${playerX}%`, top:`${PLAYER_Y}%` }} />

            {rowComment && <div className="atk-row-comment">{rowComment}</div>}
          </div>
        ) : (
          <div className="atk-pulse" onPointerDown={handlePulseTap}>
            <GoalView difficulty={difficulty} keeperX={keeperX} interactive={false} />
            <div className="atk-pulse-instruction">TAPER AU BON MOMENT !</div>
            <div className="atk-pulse-ring" />
            <div className="atk-pulse-ball-wrap">
              <svg viewBox="0 0 80 80" style={{ width:`${pulseRadius*2*1.2}px`, height:`${pulseRadius*2*1.2}px`, filter:inPerfect?'drop-shadow(0 0 12px #2bff9a)':pulsePhase==='result'?'drop-shadow(0 0 12px #FF4455)':'drop-shadow(0 0 6px rgba(255,255,255,.5))', transition:'filter .08s', pointerEvents:'none' }}>
                <circle cx="40" cy="40" r="34" fill="#f7f9fc" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="4"/>
                <path d="M40 19 53 28 48 45H32L27 28Z" fill="none" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="3"/>
                <line x1="40" y1="6"  x2="40" y2="19" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="2" strokeLinecap="round"/>
                <line x1="53" y1="28" x2="66" y2="22" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="2" strokeLinecap="round"/>
                <line x1="48" y1="45" x2="56" y2="57" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="2" strokeLinecap="round"/>
                <line x1="32" y1="45" x2="24" y2="57" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="2" strokeLinecap="round"/>
                <line x1="27" y1="28" x2="14" y2="22" stroke={inPerfect?'#2bff9a':'#101827'} strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            {resultLabel && <div className="atk-result-overlay" style={{ color:resultLabel==='BUT !'?'#2bff9a':'#FF4455' }}>{resultLabel}</div>}
          </div>
        )}
      </div>

      {/* 30% — info bar */}
      <div className="atk-info">
        <span className="atk-info-phase">{phase === 'slalom' ? 'SLALOM' : 'TIR'}</span>
        <span className="atk-info-label">
          {phase === 'slalom' ? 'Évite les défenseurs — brèche mobile !' : inPerfect ? '✓ ZONE PARFAITE' : 'Timing du tir'}
        </span>
      </div>
    </section>
  )
}

export default AttackPhase
