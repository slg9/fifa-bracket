import { useCallback, useEffect, useRef, useState } from 'react'
import type { BattleDifficulty } from '../../types'
import GoalView, { type BallFlight, type GoalTarget } from './GoalView'

export type AttackEndReason = 'goal' | 'saved' | 'miss' | 'intercepted' | 'timeout'

type AttackPhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  homeTeamPlayers?: string[]
  awayTeamPlayers?: string[]
  onRoundEnd: (isGoal: boolean, reason?: AttackEndReason) => void
  isPaused?: boolean
}

// ── Config ───────────────────────────────────────────────
const ATTACK_CFG = {
  easy:   { wallCount: 10, wallGap: 34, gdSpeed: 36, gaugeGreenPx: 28, gaugeSpeed: 0.78 },
  medium: { wallCount: 13, wallGap: 28, gdSpeed: 46, gaugeGreenPx: 22, gaugeSpeed: 1.15 },
  hard:   { wallCount: 16, wallGap: 22, gdSpeed: 56, gaugeGreenPx: 16, gaugeSpeed: 1.6 },
}

// Wall gap zone centers (% of game-area WIDTH) — 5 positions for variety
const GAP_ZONE_CENTERS = [18, 82, 50, 30, 70]

// GD constants — walls fall FROM TOP
const GD_PLAYER_Y   = 80     // fixed Y % where ball sits
const WALL_FIRST_Y  = -12    // first wall starts above screen (negative %)
const WALL_SPACING  = 38     // vertical spacing between walls (%)
const WALL_HEIGHT   = 4      // wall bar height in % of game area
const PLAYER_SPEED  = 60     // %/s via keyboard (left/right)
const JUMP_DURATION = 700    // ms

const KEEPER_SPEED_FACTOR = 0.85  // sin frequency multiplier

const GD_COMMENTS = [
  'Beau dribble !', 'Bien joué !', 'Incroyable !', 'Quel geste !',
  'Il les passe tous !', 'Magnifique !', 'Élégant !', 'En pleine course !',
]

// Gauge track total width in px (rendered via CSS width 70% max 260px – we use a normalized 0-1 cursor)
const GAUGE_TRACK_PX = 260

type GdWall = {
  worldY: number       // top edge world-Y (%) — negative = above screen
  gapZoneIdx: number   // which zone preset (cycles 0,1,2,0,…)
  passed: boolean
  checked: boolean
}

// ── Component ────────────────────────────────────────────
export function AttackPhase({
  difficulty,
  homeTeamId: _homeTeamId,
  awayTeamId: _awayTeamId,
  homeTeamPlayers = [],
  awayTeamPlayers = [],
  onRoundEnd,
  isPaused,
}: AttackPhaseProps) {
  const cfg = ATTACK_CFG[difficulty]

  // ── Real player names ──
  const attackerName = useRef(
    homeTeamPlayers.length > 0
      ? homeTeamPlayers[Math.floor(Math.random() * Math.min(homeTeamPlayers.length, 3))]
      : null
  ).current
  const attackerShort = attackerName ? attackerName.split(' ').pop()!.slice(0, 7) : null

  // ── Tutorial ──
  const [tutorialDone, setTutorialDone] = useState(
    () => sessionStorage.getItem('brakup:tut:atk2') === '1'
  )

  // ── Top-level phase ──
  const [phase, setPhase] = useState<'gd' | 'shot'>('gd')
  const phaseRef = useRef<'gd' | 'shot'>('gd')

  // ── GD phase state (display only) ──
  const [gdWallsDisplay, setGdWallsDisplay] = useState<GdWall[]>([])
  const [gdJumping, setGdJumping]     = useState(false)
  const [gdComment, setGdComment]     = useState<string | null>(null)
  const [gdFlash, setGdFlash]         = useState(false)
  const [showShotIntro, setShowShotIntro] = useState(false)

  // ── GD phase refs (RAF + direct DOM) ──
  const gdPlayerXRef    = useRef(50)
  const gdFallPctRef    = useRef(0)
  // DOM refs for butter-smooth position updates without React re-renders
  const wallContainerRef = useRef<HTMLDivElement>(null)
  const playerElRef      = useRef<HTMLDivElement>(null)
  const gdWallsRef      = useRef<GdWall[]>([])
  const isJumpingRef    = useRef(false)
  const keysRef         = useRef({ left: false, right: false })
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gdCheckedRef    = useRef(0)  // count of walls passed
  const gdElapsedRef    = useRef(0)  // elapsed time for GD acceleration

  // ── Shot phase — aim cursor follows pointer, single tap fires ──
  const aimCursorRef = useRef<{ x: number; y: number } | null>(null)
  const [aimCursorPos, setAimCursorPos] = useState<{ x: number; y: number } | null>(null)
  const shotFiredRef = useRef(false)
  const shotGameRef  = useRef<HTMLDivElement>(null)

  // Keeper (oscillates in shot phase)
  const [keeperX, setKeeperX] = useState(50)
  const keeperXRef            = useRef(50)

  // Keeper Y (vertical movement)
  const [keeperY, setKeeperY] = useState(70)
  const keeperYRef            = useRef(70)

  // Ball flight animation (shot phase)
  const [ballFlight, setBallFlight] = useState<BallFlight | null>(null)

  // Power gauge
  const [gaugeCursor, setGaugeCursor] = useState(0)   // 0..1 position in track
  const gaugeCursorRef   = useRef(0)
  const gaugeTimeRef     = useRef(0)
  const gaugeGreenLeft   = useRef(0)    // 0..1 position of green zone left edge

  // Result
  const [resultLabel, setResultLabel] = useState<string | null>(null)

  // Common refs
  const endedRef      = useRef(false)
  const isPausedRef   = useRef(false)
  isPausedRef.current = isPaused ?? false
  const containerRef  = useRef<HTMLDivElement>(null)

  // ── Init GD walls ──
  useEffect(() => {
    // Shuffle gap zone order so defenders don't cycle predictably
    const zoneOrder = Array.from({ length: cfg.wallCount }, (_, i) => i % GAP_ZONE_CENTERS.length)
    for (let j = zoneOrder.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [zoneOrder[j], zoneOrder[k]] = [zoneOrder[k], zoneOrder[j]]
    }
    const walls: GdWall[] = []
    for (let i = 0; i < cfg.wallCount; i++) {
      walls.push({
        worldY: WALL_FIRST_Y - i * WALL_SPACING,
        gapZoneIdx: zoneOrder[i],
        passed: false,
        checked: false,
      })
    }
    gdWallsRef.current = walls
    setGdWallsDisplay([...walls])
  }, [cfg.wallCount])

  // ── Finish callback ──
  const finish = useCallback((isGoal: boolean, reason: AttackEndReason) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(isGoal, reason)
  }, [onRoundEnd])

  // ── Jump handler ──
  const handleJump = () => {
    if (isJumpingRef.current) return
    isJumpingRef.current = true
    setGdJumping(true)
    setTimeout(() => {
      isJumpingRef.current = false
      setGdJumping(false)
    }, JUMP_DURATION)
  }

  // ── Keyboard handler ──
  useEffect(() => {
    if (!tutorialDone) return
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { keysRef.current.left  = true; e.preventDefault() }
      if (e.key === 'ArrowRight') { keysRef.current.right = true; e.preventDefault() }
      if (e.key === ' ')          { handleJump(); e.preventDefault() }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  keysRef.current.left  = false
      if (e.key === 'ArrowRight') keysRef.current.right = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup',   onUp)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorialDone])

  // ── GD RAF — walls fall from top ──
  useEffect(() => {
    if (phase !== 'gd' || !tutorialDone || showShotIntro) return
    let frame = 0
    let prev: number | null = null
    gdElapsedRef.current = 0

    const tick = (now: number) => {
      if (isPausedRef.current) { prev = null; frame = requestAnimationFrame(tick); return }
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev) / 1000
      prev = now
      if (endedRef.current) return

      gdElapsedRef.current += delta

      // Move player X via keyboard — direct DOM, no React re-render
      if (keysRef.current.left) {
        gdPlayerXRef.current = Math.max(3, gdPlayerXRef.current - PLAYER_SPEED * delta)
      }
      if (keysRef.current.right) {
        gdPlayerXRef.current = Math.min(97, gdPlayerXRef.current + PLAYER_SPEED * delta)
      }
      if (playerElRef.current) {
        playerElRef.current.style.left = `${gdPlayerXRef.current}%`
      }

      // Speed ramps up more aggressively toward the end of the slalom
      const speed = cfg.gdSpeed * (0.92 + (gdElapsedRef.current / 6.5) * 1.05)
      const clampedSpeed = Math.min(speed, cfg.gdSpeed * 1.95)

      // Walls fall: update ONE container transform — GPU composited, zero layout reflow
      gdFallPctRef.current += clampedSpeed * delta
      if (wallContainerRef.current) {
        wallContainerRef.current.style.transform = `translateY(${gdFallPctRef.current}%)`
      }

      // Collision / pass check — fire once per wall when it reaches player Y
      const walls   = gdWallsRef.current
      const playerX = gdPlayerXRef.current
      const fall    = gdFallPctRef.current
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i]
        if (wall.checked) continue
        // Wall screen Y = worldY + fall (worldY is negative → starts above screen)
        const screenY = wall.worldY + fall
        // Trigger when wall top edge reaches PLAYER_Y band
        if (screenY < GD_PLAYER_Y - 4) continue

        wall.checked = true
        const center  = GAP_ZONE_CENTERS[wall.gapZoneIdx % GAP_ZONE_CENTERS.length]
        // Use same halfGap as visual rendering — no hidden narrowing (was causing "ghost" intercepts)
        const halfGap = cfg.wallGap / 2
        const inGap   = playerX >= center - halfGap && playerX <= center + halfGap

        if (inGap || isJumpingRef.current) {
          wall.passed = true
          gdCheckedRef.current++
          setGdWallsDisplay([...gdWallsRef.current])  // update only on state change
          const comment = GD_COMMENTS[Math.floor(Math.random() * GD_COMMENTS.length)]
          setGdComment(comment)
          if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
          commentTimerRef.current = setTimeout(() => setGdComment(null), 800)

          if (gdCheckedRef.current >= cfg.wallCount) {
            setShowShotIntro(true)
            return
          }
        } else {
          setGdFlash(true)
          setTimeout(() => setGdFlash(false), 300)
          finish(false, 'intercepted')
          return
        }
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, tutorialDone, showShotIntro, cfg.gdSpeed, cfg.wallCount, cfg.wallGap, finish])

  // ── Pointer move for GD (drag ball left/right) — direct DOM, no re-render ──
  const handleGdPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== 'gd' || endedRef.current) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    gdPlayerXRef.current = Math.max(3, Math.min(97, ((e.clientX - rect.left) / rect.width) * 100))
    if (playerElRef.current) {
      playerElRef.current.style.left = `${gdPlayerXRef.current}%`
    }
  }

  // ── Shot RAF — keeper + aim cursor + gauge all oscillate simultaneously ──
  useEffect(() => {
    if (phase !== 'shot' || showShotIntro) return
    shotFiredRef.current = false
    gaugeTimeRef.current = 0
    let frame = 0
    let prev: number | null = null
    let shotTime = 0

    const tick = (now: number) => {
      if (isPausedRef.current) { prev = null; frame = requestAnimationFrame(tick); return }
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev) / 1000
      prev = now
      if (endedRef.current || shotFiredRef.current) return

      shotTime += delta

      // Keeper oscillates in the goal
      const kx = Math.max(5, Math.min(95,
        50 + 40 * Math.sin(shotTime * KEEPER_SPEED_FACTOR) + 9 * Math.sin(shotTime * 2.9 + 0.7)
      ))
      const ky = Math.max(20, Math.min(80,
        50 + 28 * Math.sin(shotTime * 1.15 + 1.0)
      ))
      keeperXRef.current = kx; setKeeperX(kx)
      keeperYRef.current = ky; setKeeperY(ky)

      // Gauge oscillates
      gaugeTimeRef.current += delta
      const raw = Math.sin(gaugeTimeRef.current * Math.PI * 2 * cfg.gaugeSpeed)
      const cursor = (raw + 1) / 2
      gaugeCursorRef.current = cursor
      setGaugeCursor(cursor)

      // Auto-miss after ~12s (more time to aim)
      if (gaugeTimeRef.current > 12) {
        shotFiredRef.current = true
        setResultLabel('RATÉ !')
        setTimeout(() => finish(false, 'miss'), 700)
        return
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, showShotIntro, cfg.gaugeSpeed, finish])

  // ── Map screen pointer to goal-normalized coords (0-100), clamped inside goal ──
  const pointerToGoalTarget = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = shotGameRef.current?.getBoundingClientRect()
    if (!rect) return { x: 50, y: 30 }
    const svgX = (clientX - rect.left) / rect.width   // 0-1
    const svgY = (clientY - rect.top)  / rect.height  // 0-1

    // Compact goal metrics (must match goalFrameMetrics in GoalView)
    const topY = 0.04, bottomY = 0.33
    const topLeft = 0.12, topRight = 0.88
    const bottomLeft = 0.06, bottomRight = 0.94

    // Clamp Y into goal
    const cy = Math.max(topY, Math.min(bottomY, svgY))
    const normY = (cy - topY) / (bottomY - topY)  // 0-1 within goal height

    // Left/right edges at this Y
    const leftEdge  = topLeft  + (bottomLeft  - topLeft)  * normY
    const rightEdge = topRight + (bottomRight - topRight) * normY

    // Clamp X into goal edges
    const cx = Math.max(leftEdge, Math.min(rightEdge, svgX))
    const normX = (cx - leftEdge) / (rightEdge - leftEdge)  // 0-1 within goal width

    return { x: normX * 100, y: normY * 100 }
  }

  // ── Pointer move in shot area → move aim cursor ──
  const handleShotPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (shotFiredRef.current || phase !== 'shot' || ballFlight) return
    const pos = pointerToGoalTarget(e.clientX, e.clientY)
    aimCursorRef.current = pos
    setAimCursorPos(pos)
  }

  // ── Single tap → freeze gauge and fire ──
  const handleShotPointerDown = () => {
    if (shotFiredRef.current || endedRef.current || resultLabel) return
    shotFiredRef.current = true

    const cursor = gaugeCursorRef.current
    const greenL = gaugeGreenLeft.current
    const greenR = greenL + cfg.gaugeGreenPx / GAUGE_TRACK_PX
    const inGreen = cursor >= greenL && cursor <= greenR

    const at = aimCursorRef.current ?? { x: 50, y: 30 }
    const keeperBlocking = inGreen &&
      Math.abs(at.x - keeperXRef.current) < 14 &&
      Math.abs(at.y - keeperYRef.current) < 18

    const aimTarget:  GoalTarget = { x: at.x,  y: at.y,   clientX: 0, clientY: 0 }
    // Miss: ball exits above the crossbar (y = -30 = off-screen above goal)
    const missTarget: GoalTarget = { x: at.x,  y: -30,    clientX: 0, clientY: 0 }
    const FLIGHT_MS = 380

    if (!inGreen) {
      // Ball flies out over the bar
      setBallFlight({ id: Date.now(), target: missTarget, state: 'flying', duration: FLIGHT_MS })
      setTimeout(() => {
        setResultLabel('RATÉ !')
      }, FLIGHT_MS)
      setTimeout(() => finish(false, 'miss'), FLIGHT_MS + 700)
    } else if (keeperBlocking) {
      setBallFlight({ id: Date.now(), target: aimTarget, state: 'flying', duration: FLIGHT_MS })
      setTimeout(() => {
        setBallFlight({ id: Date.now(), target: aimTarget, state: 'saved', duration: FLIGHT_MS })
        setResultLabel('ARRÊTÉ !')
      }, FLIGHT_MS)
      setTimeout(() => finish(false, 'saved'), FLIGHT_MS + 900)
    } else {
      setBallFlight({ id: Date.now(), target: aimTarget, state: 'flying', duration: FLIGHT_MS })
      setTimeout(() => {
        setBallFlight({ id: Date.now(), target: aimTarget, state: 'goal', duration: FLIGHT_MS })
        setResultLabel('BUT !')
      }, FLIGHT_MS)
      setTimeout(() => finish(true, 'goal'), FLIGHT_MS + 800)
    }
  }

  // ── Transition from GD to shot ──
  const handleStartShot = () => {
    setShowShotIntro(false)
    phaseRef.current = 'shot'
    setPhase('shot')
    // Default cursor at center of goal so the player always sees their aim point
    const defaultAim = { x: 50, y: 30 }
    aimCursorRef.current = defaultAim
    setAimCursorPos(defaultAim)
    shotFiredRef.current = false
    const maxLeft = 1 - cfg.gaugeGreenPx / GAUGE_TRACK_PX
    gaugeGreenLeft.current = Math.random() * maxLeft * 0.6 + 0.2
  }

  // ── Derived display values ──
  const gaugeGreenLeftPct = gaugeGreenLeft.current * 100  // % of track

  return (
    <section
      className={`atk-root is-${phase}`}
      ref={containerRef}
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerMove={(e) => {
        if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerMove(e)
      }}
      onPointerDown={(e) => {
        if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerDown()
        else if (phase === 'gd') handleGdPointerMove(e)
      }}
    >
      <style>{`
        .atk-root {
          display: flex; flex-direction: column;
          width: 100%; height: 100%;
          background: #050b16;
          font-family: 'Barlow Condensed', sans-serif;
          overflow: hidden;
          position: relative;
        }
        .atk-root.is-gd { display: grid; grid-template-rows: 70% 30%; }
        .atk-root.is-shot { display: flex; flex-direction: column; }
        /* GD game area */
        .atk-game { position: relative; overflow: hidden; flex: 1; }

        /* ── Tutorial overlay ── */
        .atk-tutorial {
          position: absolute; inset: 0; z-index: 50;
          background: rgba(5,11,22,0.78); backdrop-filter: blur(3px);
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
          margin-top: 8px; padding: 12px 28px; border-radius: 10px;
          border: 2px solid #2bff9a; background: rgba(43,255,154,.1);
          color: #2bff9a; font: 800 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em; cursor: pointer;
          box-shadow: 0 0 16px rgba(43,255,154,.35);
        }

        /* ── Comment popup ── */
        .atk-row-comment {
          position: absolute; top: 35%; left: 50%; transform: translate(-50%,-50%);
          font: 900 clamp(16px,6vw,26px) 'Barlow Condensed', sans-serif;
          letter-spacing: .12em; color: #2bff9a;
          text-shadow: 0 0 16px rgba(43,255,154,.7);
          pointer-events: none; z-index: 30; white-space: nowrap;
          animation: atkCommentPop .15s ease-out both;
        }
        @keyframes atkCommentPop {
          from { transform: translate(-50%,-50%) scale(.7); opacity: 0; }
          to   { transform: translate(-50%,-50%) scale(1);  opacity: 1; }
        }


        /* ── GD pitch (top-down) ── */
        .atk-gd {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(
            90deg,
            #0a3a1e 0px, #0a3a1e 60px,
            #0b4022 60px, #0b4022 120px
          );
        }
        .atk-gd-stripe-overlay {
          position: absolute; inset: 0;
          background:
            repeating-linear-gradient(
              0deg,
              transparent 0px, transparent 38px,
              rgba(255,255,255,.025) 38px, rgba(255,255,255,.025) 39px
            ),
            repeating-linear-gradient(
              90deg,
              transparent 0px, transparent 55px,
              rgba(255,255,255,.018) 55px, rgba(255,255,255,.018) 56px
            );
          pointer-events: none;
        }

        /* ── GD pitch SVG markings ── */
        .atk-gd-pitch-svg {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          pointer-events: none; overflow: visible;
        }

        /* ── GD speed indicator ── */
        .atk-gd-speed {
          position: absolute; top: 8px; right: 10px; z-index: 20;
          font: 700 9px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em; color: rgba(255,255,255,.35);
          transition: color .3s;
        }
        .atk-gd-speed.is-fast { color: #FF4455; text-shadow: 0 0 8px rgba(255,68,85,.6); }

        /* ── GD defender bubbles ── */
        .atk-gd-defender {
          position: absolute;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font: 900 17px 'Barlow Condensed', sans-serif;
          color: #fff;
          transform: translate(-50%, -50%);
          pointer-events: none; z-index: 8;
        }
        .atk-gd-defender--normal {
          width: 48px; height: 48px;
          background: rgba(255,255,255,.10);
          border: 2px solid rgba(255,255,255,.85);
          box-shadow: 0 6px 14px rgba(0,0,0,.5);
          animation: atkDefWalk 1s ease-in-out infinite alternate;
        }
        .atk-gd-defender--costaud {
          width: 60px; height: 60px;
          background: #FF4455;
          border: 3px solid rgba(255,255,255,.85);
          box-shadow: 0 8px 18px rgba(0,0,0,.55);
          font-size: 22px;
        }
        .atk-gd-defender--agile {
          width: 44px; height: 44px;
          background: #3B82F6;
          border: 2px solid rgba(255,255,255,.85);
          box-shadow: 0 6px 14px rgba(0,0,0,.5);
        }
        .atk-gd-def-ring {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          transform: translate(-50%, -50%);
        }
        @keyframes atkDefWalk {
          from { transform: translate(-50%, -46%); }
          to   { transform: translate(-50%, -54%); }
        }
        /* pass zone arrow hint */
        .atk-gd-pass-hint {
          position: absolute;
          border-radius: 50%;
          pointer-events: none; z-index: 6;
          transform: translate(-50%, -50%);
          border: 1.5px dashed rgba(43,255,154,.35);
        }

        /* ── GD player token (kawaii avatar) ── */
        .atk-gd-player {
          position: absolute;
          transform: translate(-50%, -50%);
          pointer-events: none; z-index: 10;
          filter: drop-shadow(0 0 10px rgba(43,255,154,.7));
          transition: left 0.04s linear;
        }
        .atk-gd-player--flash { filter: drop-shadow(0 0 14px rgba(255,68,85,1)); }
        .atk-gd-player--pass  { filter: drop-shadow(0 0 14px rgba(255,184,0,.9)); }

        /* ── Pass button ── */
        .atk-gd-pass-btn {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          touch-action: none;
        }
        .atk-gd-pass-btn button {
          width: 56px; height: 56px; border-radius: 16px;
          background: rgba(255,184,0,.1);
          border: 1.5px solid rgba(255,184,0,.6);
          box-shadow: 0 0 16px rgba(255,184,0,.25);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .atk-gd-pass-btn button:active { background: rgba(255,184,0,.22); }
        .atk-gd-pass-btn span {
          font: 600 10px 'Barlow Condensed', sans-serif;
          letter-spacing: .08em; color: rgba(255,255,255,.5);
        }

        /* ── Shot game area ── */
        .atk-shot-game {
          position: relative; flex: 1;
          cursor: pointer; overflow: hidden;
        }
        .atk-shot-game .goal-arcade {
          width: 100%; height: 100%; border-radius: 0;
        }
        .atk-shot-game .goal-arcade > svg {
          min-height: unset; aspect-ratio: unset; height: 100%;
        }

        /* ── Gauge at bottom of shot scene ── */
        .atk-gauge-bottom {
          position: absolute; bottom: 0; left: 0; right: 0; z-index: 20;
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 10px 20px 16px;
          background: linear-gradient(to top, rgba(5,11,22,.92) 0%, rgba(5,11,22,.0) 100%);
          pointer-events: none;
        }
        .atk-gauge-label {
          font: 900 clamp(13px,4.5vw,18px) 'Barlow Condensed', sans-serif;
          letter-spacing: .18em; color: #FFB800;
          text-shadow: 0 0 16px rgba(255,184,0,.6);
          animation: atkBlink 1s ease-in-out infinite alternate;
        }
        @keyframes atkBlink { from{opacity:.65} to{opacity:1} }
        .atk-gauge-track {
          position: relative;
          width: 70%; max-width: ${GAUGE_TRACK_PX}px; height: 24px;
          background: #c0392b; border-radius: 12px;
          border: 2px solid rgba(255,255,255,.3);
          overflow: hidden;
        }
        .atk-gauge-green {
          position: absolute; top: 0; bottom: 0;
          background: #2bff9a;
          border-radius: 0;
        }
        .atk-gauge-cursor {
          position: absolute; top: -3px; bottom: -3px;
          width: 5px; background: #fff; border-radius: 3px;
          box-shadow: 0 0 8px rgba(255,255,255,.9);
          transform: translateX(-50%);
        }

        /* ── Result overlay ── */
        .atk-result-overlay {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font: 900 clamp(40px,14vw,72px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em; text-shadow: 0 0 36px currentColor;
          animation: atkResultIn .25s ease-out both; z-index: 30; pointer-events: none;
        }
        @keyframes atkResultIn { from{transform:scale(.5);opacity:0} to{transform:scale(1);opacity:1} }

        /* ── Shot intro transition overlay ── */
        .atk-transition {
          position: absolute; inset: 0; z-index: 40;
          background: rgba(5,11,22,0.78); backdrop-filter: blur(3px);
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; padding: 28px 20px;
          text-align: center; animation: atkFadeIn .3s ease-out both;
        }
        .atk-transition__title {
          font: 900 clamp(28px,9vw,48px) 'Barlow Condensed', sans-serif;
          letter-spacing: .15em; color: #2bff9a;
          text-shadow: 0 0 28px rgba(43,255,154,.6); text-transform: uppercase;
        }
        .atk-transition__sub { font: 800 clamp(14px,5vw,20px) 'Barlow Condensed', sans-serif; letter-spacing: .08em; color: #FFB800; }
        .atk-transition__desc { font: 500 clamp(12px,3.5vw,15px) 'Barlow Condensed', sans-serif; color: rgba(255,255,255,.7); max-width: 300px; line-height: 1.45; }
        .atk-transition__btn {
          margin-top: 10px; padding: 13px 32px; border-radius: 10px;
          border: 2px solid #2bff9a; background: rgba(43,255,154,.12);
          color: #2bff9a; font: 800 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em; cursor: pointer; box-shadow: 0 0 20px rgba(43,255,154,.3);
        }
        @keyframes atkFadeIn { from{opacity:0} to{opacity:1} }

        /* ── Info bar (GD phase only) ── */
        .atk-info {
          display: flex; align-items: center; justify-content: center;
          gap: 16px; padding: 10px 20px;
          background: linear-gradient(180deg,#0a2618,#061a10);
          box-sizing: border-box; z-index: 5; overflow: hidden;
        }
        .atk-info-phase {
          padding: 4px 10px; border-radius: 6px;
          background: rgba(255,184,0,.12); border: 1px solid rgba(255,184,0,.4);
          font: 800 11px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em; color: #FFB800; flex-shrink: 0;
        }
        .atk-info-label {
          font: 700 11px 'Barlow Condensed', sans-serif;
          color: rgba(255,255,255,.6); letter-spacing: .06em;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
      `}</style>

      {/* ── Tutorial overlay ── */}
      {!tutorialDone && (
        <div className="atk-tutorial">
          <div className="atk-tutorial__title">DRIBBLE</div>
          <div className="atk-tutorial__instruction">
            Les défenseurs arrivent par le haut ! Déplace-toi à gauche ou à droite pour passer dans la brèche.
            <br /><br />
            Appuie sur <b style={{ color:'#2bff9a' }}>SAUT</b> (ou Espace) pour sauter par-dessus un mur !
            <br /><br />
            <span style={{ color:'rgba(255,255,255,.5)', fontSize:'0.9em' }}>⌨ Clavier : ← → pour se déplacer · Espace pour sauter</span>
          </div>
          <span className="atk-tutorial__arrow">↔</span>
          <button
            type="button"
            className="atk-tutorial__btn"
            onClick={() => {
              sessionStorage.setItem('brakup:tut:atk2', '1')
              setTutorialDone(true)
            }}
          >
            OK — Jouer !
          </button>
        </div>
      )}

      {/* ── Shot intro transition ── */}
      {showShotIntro && (
        <div className="atk-transition">
          <div style={{ fontSize: 36 }}>⚽</div>
          <div className="atk-transition__title">Bravo !</div>
          <div className="atk-transition__sub">Tu entres dans la zone de tir</div>
          <div className="atk-transition__desc">
            Vise avec le curseur · Frappe au bon moment sur la jauge.<br /><br />
            <b style={{ color:'#2bff9a' }}>UN seul tap</b> suffit !
          </div>
          <button type="button" className="atk-transition__btn" onClick={handleStartShot}>
            ▶ Tirer !
          </button>
        </div>
      )}

      {/* ── GD game area ── */}
      {phase === 'gd' && (
      <div
        className="atk-game"
        onPointerMove={handleGdPointerMove}
      >
        {/* ════ GD Phase ════ */}
        {phase === 'gd' && (
          <div className="atk-gd">
            <div className="atk-gd-stripe-overlay" />

            {/* Faint pitch markings SVG */}
            <svg className="atk-gd-pitch-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              {/* Center line */}
              <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,.12)" strokeWidth=".4" />
              {/* Center circle */}
              <ellipse cx="50" cy="50" rx="16" ry="10" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth=".35" />
              {/* Top penalty area */}
              <rect x="25" y="0" width="50" height="22" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth=".35" />
              {/* Bottom penalty area */}
              <rect x="25" y="78" width="50" height="22" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth=".35" />
            </svg>

            {/* Wall container — translateY driven by RAF, single GPU composite per frame */}
            <div
              ref={wallContainerRef}
              style={{ position: 'absolute', inset: 0, willChange: 'transform', transform: 'translateY(0%)' }}
            >
              {gdWallsDisplay.map((wall, wi) => {
                // Early cull: skip walls too far above/below visible range using current fall
                const screenY = wall.worldY + gdFallPctRef.current
                if (screenY < -18 || screenY > 112) return null

                const center = GAP_ZONE_CENTERS[wall.gapZoneIdx % GAP_ZONE_CENTERS.length]
                const halfGap = cfg.wallGap / 2  // visual width (collision uses dynamic value)
                const gapL = center - halfGap
                const gapR = center + halfGap
                const type = wi % 3 === 2 ? 'costaud' : wi % 3 === 1 ? 'agile' : 'normal'
                const defNames = awayTeamPlayers.length > 0 ? awayTeamPlayers : null
                const defLabelL = defNames ? defNames[(wi * 2) % defNames.length].split(' ').pop()!.slice(0, 8) : String([4, 8, 5, 11, 9, 7, 6, 3, 2, 10][wi % 10])
                const defLabelR = defNames ? defNames[(wi * 2 + 1) % defNames.length].split(' ').pop()!.slice(0, 8) : String([4, 8, 5, 11, 9, 7, 6, 3, 2, 10][(wi + 1) % 10])
                const leftX = gapL > 6 ? gapL * 0.5 : null
                const rightX = gapR < 94 ? (gapR + 100) * 0.5 : null

                return (
                  // Wall at FIXED worldY within container — container translateY does the falling
                  <div key={wi} style={{ position: 'absolute', top: `${wall.worldY}%`, left: 0, right: 0, height: 0, pointerEvents: 'none' }}>
                    <div className="atk-gd-pass-hint" style={{ left: `${center}%`, width: `${(gapR - gapL) * 0.85}%`, height: 0, paddingBottom: `${(gapR - gapL) * 0.85}%`, top: 0, borderColor: wall.passed ? 'rgba(43,255,154,.6)' : 'rgba(43,255,154,.32)' }} />
                    {leftX !== null && (
                      <div className={`atk-gd-defender atk-gd-defender--${type}`} style={{ left: `${leftX}%`, top: 0 }}>
                        {type === 'normal' && <>
                          <div className="atk-gd-def-ring" style={{ position:'absolute', left:'50%', top:'50%', width:30, height:30, background:'rgba(255,255,255,.06)', marginLeft:-15, marginTop:-15 }} />
                          <div className="atk-gd-def-ring" style={{ position:'absolute', left:'50%', top:'50%', width:38, height:38, background:'rgba(255,255,255,.09)', marginLeft:-19, marginTop:-19 }} />
                          <div className="atk-gd-def-ring" style={{ position:'absolute', left:'50%', top:'50%', width:46, height:46, background:'rgba(255,255,255,.13)', marginLeft:-23, marginTop:-23 }} />
                        </>}
                        {defLabelL}
                      </div>
                    )}
                    {rightX !== null && (
                      <div className={`atk-gd-defender atk-gd-defender--${type}`} style={{ left: `${rightX}%`, top: 0 }}>
                        {type === 'normal' && <>
                          <div className="atk-gd-def-ring" style={{ position:'absolute', left:'50%', top:'50%', width:30, height:30, background:'rgba(255,255,255,.06)', marginLeft:-15, marginTop:-15 }} />
                          <div className="atk-gd-def-ring" style={{ position:'absolute', left:'50%', top:'50%', width:38, height:38, background:'rgba(255,255,255,.09)', marginLeft:-19, marginTop:-19 }} />
                          <div className="atk-gd-def-ring" style={{ position:'absolute', left:'50%', top:'50%', width:46, height:46, background:'rgba(255,255,255,.13)', marginLeft:-23, marginTop:-23 }} />
                        </>}
                        {defLabelR}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Player token — kawaii avatar, fixed bottom Y, left managed by DOM ref */}
            <div
              ref={playerElRef}
              className={[
                'atk-gd-player',
                gdJumping ? 'atk-gd-player--pass' : '',
                gdFlash   ? 'atk-gd-player--flash' : '',
              ].join(' ')}
              style={{ left: `${gdPlayerXRef.current}%`, top: `${GD_PLAYER_Y}%` }}
            >
              <svg viewBox="0 0 80 90" width="50" height="56" style={{ display:'block' }}>
                <ellipse cx="38" cy="85" rx="22" ry="5" fill="rgba(0,0,0,.3)"/>
                {/* Ball at right foot */}
                <circle cx="56" cy="76" r="11" fill="#f7f9fc" stroke="#101827" strokeWidth="2"/>
                <path d="M56 67 l5 4-2 6h-6l-2-6z" fill="none" stroke="#101827" strokeWidth="1.5"/>
                {/* Legs */}
                <rect x="24" y="54" width="9" height="22" rx="4.5" fill="#1a0a3a"/>
                <rect x="38" y="54" width="9" height="22" rx="4.5" fill="#1a0a3a"/>
                {/* Boots */}
                <ellipse cx="28" cy="76" rx="8" ry="5" fill="#222"/>
                <ellipse cx="42" cy="76" rx="8" ry="5" fill="#222"/>
                {/* Jersey */}
                <path d="M15 27 q23-9 46 0 l-3 29 q-20 5-40 0z" fill={gdFlash ? '#FF4455' : gdJumping ? '#FFB800' : '#2bff9a'}/>
                <path d="M28 22 v31 M48 22 v31" stroke="rgba(0,0,0,.25)" strokeWidth="3"/>
                {/* Arms */}
                <rect x="7" y="30" width="9" height="20" rx="4.5" fill={gdFlash ? '#FF4455' : gdJumping ? '#FFB800' : '#2bff9a'}/>
                <rect x="64" y="30" width="9" height="20" rx="4.5" fill={gdFlash ? '#FF4455' : gdJumping ? '#FFB800' : '#2bff9a'}/>
                {/* Hands */}
                <circle cx="11" cy="51" r="4" fill="#f3c9a0"/>
                <circle cx="68" cy="51" r="4" fill="#f3c9a0"/>
                {/* Head */}
                <circle cx="38" cy="16" r="18" fill="#f3c9a0"/>
                {/* Hair */}
                <path d="M21 12 q17-20 34 0 q-4-14-17-16 q-13 2-17 16z" fill="#2a1a0e"/>
                {/* Eyes */}
                <circle cx="31" cy="16" r="3.6" fill="#1a1a1a"/>
                <circle cx="45" cy="16" r="3.6" fill="#1a1a1a"/>
                <circle cx="32.2" cy="14.8" r="1.2" fill="#fff"/>
                <circle cx="46.2" cy="14.8" r="1.2" fill="#fff"/>
                {/* Blush */}
                <circle cx="24" cy="22" r="2.8" fill="#ff8a8a" opacity=".55"/>
                <circle cx="52" cy="22" r="2.8" fill="#ff8a8a" opacity=".55"/>
                {/* Mouth */}
                <path d="M34 24 q4 3 8 0" stroke="#1a1a1a" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
                <text x="38" y="44" fontFamily="Barlow Condensed" fontWeight="900" fontSize={attackerShort && attackerShort.length > 5 ? '7' : '10'} fill="rgba(0,0,0,.8)" textAnchor="middle">{attackerShort ?? '9'}</text>
              </svg>
            </div>

            {/* Pass button (bottom left) */}
            <div
              className="atk-gd-pass-btn"
              style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 20 }}
            >
              <button
                type="button"
                onPointerDown={(e) => { e.stopPropagation(); handleJump() }}
                aria-label="Passe"
              >
                <svg width="30" height="22" viewBox="0 0 34 24" fill="none">
                  <circle cx="6" cy="12" r="5" fill="#FFB800"/>
                  <circle cx="28" cy="12" r="5" fill="#FFB800"/>
                  <path d="M12 12 H24 M20 8 l4 4 -4 4" stroke="#FFB800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <span>Passes: {Math.max(0, 2 - (gdCheckedRef.current > 0 ? 0 : 0))}</span>
            </div>

            {/* Comment popup */}
            {gdComment && (
              <div className="atk-row-comment">{gdComment}</div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ════ Shot Phase — full screen ════ */}
      {phase === 'shot' && (
        <div
          className="atk-shot-game"
          ref={shotGameRef}
        >
          <GoalView
            compact
            difficulty={difficulty}
            keeperX={keeperX}
            keeperY={keeperY}
            target={!ballFlight && aimCursorPos ? { x: aimCursorPos.x, y: aimCursorPos.y, clientX: 0, clientY: 0 } : null}
            ballFlight={ballFlight}
            showAimGuide={!ballFlight}
            interactive={false}
          />
          {/* Hint when no aim yet */}
          {!aimCursorPos && !ballFlight && !resultLabel && (
            <div style={{
              position: 'absolute', bottom: '40%', left: 0, right: 0,
              textAlign: 'center', pointerEvents: 'none', zIndex: 25,
              font: '700 13px "Barlow Condensed",sans-serif',
              letterSpacing: '.14em', color: 'rgba(255,255,255,.45)',
              animation: 'atkBlink 1s ease-in-out infinite alternate',
            }}>
              ☝ TOUCHE L'ÉCRAN POUR VISER
            </div>
          )}

          {/* Gauge — visible until tir fired */}
          {!resultLabel && !ballFlight && (
            <div className="atk-gauge-bottom">
              <div className="atk-gauge-label">APPUIE AU BON MOMENT !</div>
              <div className="atk-gauge-track">
                <div className="atk-gauge-green" style={{ left: `${gaugeGreenLeftPct}%`, width: `${(cfg.gaugeGreenPx / GAUGE_TRACK_PX) * 100}%` }} />
                <div className="atk-gauge-cursor" style={{ left: `${gaugeCursor * 100}%` }} />
              </div>
            </div>
          )}

          {/* Result overlay */}
          {resultLabel && (
            <div className="atk-result-overlay" style={{ color: resultLabel === 'BUT !' ? '#2bff9a' : '#FF4455' }}>
              {resultLabel}
            </div>
          )}
        </div>
      )}

      {/* ── Controls bar — GD phase only ── */}
      {phase === 'gd' && (
        <div className="atk-info" style={{ justifyContent: 'space-between', padding: '0 20px' }}>
          {/* Left spacer (pass btn is in the game area) */}
          <div style={{ width: 68 }} />

          {/* Active player badge (center) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#0b1626', border: '2px solid #2bff9a', boxShadow: '0 0 22px rgba(43,255,154,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '900 20px "Barlow Condensed",sans-serif', color: '#2bff9a' }}>9</div>
            <span style={{ font: '700 10px "Barlow Condensed",sans-serif', letterSpacing: '.1em', color: '#2bff9a' }}>Joueur 9</span>
          </div>

          {/* Score + round dots (right) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span className="atk-info-phase">DRIBBLE</span>
            <span className="atk-info-label">Évite les défenseurs !</span>
          </div>
        </div>
      )}
    </section>
  )
}

export default AttackPhase
