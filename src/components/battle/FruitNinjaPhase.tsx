import { useEffect, useRef, useState } from 'react'
import type { BattleDifficulty, Team } from '../../types'

type FruitNinjaPhaseProps = {
  attackersInZone: number
  difficulty: BattleDifficulty
  onResult: (saved: boolean) => void
  isPaused?: boolean
  awayTeam?: Team
}

type NinjaKind = 'ball' | 'decoy'
type NinjaState = 'waiting' | 'active' | 'intercepted' | 'missed'

type NinjaObject = {
  id: string
  kind: NinjaKind
  wave: 1 | 2 | 3
  delay: number
  duration: number
  startX: number
  startY: number
  endX: number
  endY: number
  x: number
  y: number
  state: NinjaState
  hitAt: number | null
}

type NinjaTrail = { id: string; x1: number; y1: number; x2: number; y2: number; createdAt: number }

type InterceptionComment = { id: string; text: string; x: number; y: number; createdAt: number }

const INTERCEPTION_COMMENTS = ['ARRÊTÉ !', 'SUPERBE !', 'QUELLE RÉFLEXE !', 'INCROYABLE !', 'LE MUR !', 'PARÉ !', 'MAGNIFIQUE !']

// Wave timing (ms elapsed since start)

const WAVE_2_START = 2500
const WAVE_3_START = 5000
const TOTAL_DURATION = 8500

const BALL_COUNT = 17
const THRESHOLD = 11

function randomUnit() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] / 0xffffffff
}

function randomRange(minimum: number, maximum: number) {
  return minimum + randomUnit() * (maximum - minimum)
}

function edgePoint(edge: number): { x: number; y: number } {
  if (edge === 0) return { x: randomRange(2, 8),   y: randomRange(5, 95) }   // left
  if (edge === 1) return { x: randomRange(92, 98), y: randomRange(5, 95) }   // right
  if (edge === 2) return { x: randomRange(5, 95),  y: randomRange(2, 8) }    // top
  return              { x: randomRange(5, 95),  y: randomRange(92, 98) }     // bottom
}
function randomPath() {
  const startEdge = Math.floor(randomUnit() * 4)
  // End on any of the OTHER 3 edges (including adjacent → diagonal paths)
  const endEdge = (startEdge + 1 + Math.floor(randomUnit() * 3)) % 4
  const s = edgePoint(startEdge)
  const e = edgePoint(endEdge)
  return { startX: s.x, startY: s.y, endX: e.x, endY: e.y }
}

function createAllObjects(difficulty: BattleDifficulty): NinjaObject[] {
  const hasDecoy = difficulty === 'hard'
  // Wave 1: 4 balls, delays 200–1800ms
  // Wave 2: 5 balls, delays 3500–5500ms
  // Wave 3: 5 balls, delays 7200–9500ms
  const waveDefs: Array<{ count: number; minDelay: number; maxDelay: number; wave: 1 | 2 | 3 }> = [
    { count: 5,  minDelay: 150,  maxDelay: 1400, wave: 1 },
    { count: 6,  minDelay: 2500, maxDelay: 4000, wave: 2 },
    { count: 6,  minDelay: 5000, maxDelay: 7200, wave: 3 },
  ]

  const difficultyDuration = difficulty === 'easy' ? 1900 : difficulty === 'medium' ? 1450 : 1050

  const objects: NinjaObject[] = []
  for (const { count, minDelay, maxDelay, wave } of waveDefs) {
    // Space delays evenly within the range
    const ballDelays: number[] = Array.from({ length: count }, (_, i) => {
      return minDelay + (i / Math.max(count - 1, 1)) * (maxDelay - minDelay) + randomRange(-80, 80)
    }).sort((a, b) => a - b)

    for (let i = 0; i < count; i++) {
      const path = randomPath()
      objects.push({
        id: crypto.randomUUID(),
        kind: 'ball',
        wave,
        delay: ballDelays[i],
        duration: difficultyDuration * randomRange(0.85, 1.15),
        ...path,
        x: path.startX,
        y: path.startY,
        state: 'waiting',
        hitAt: null,
      })
    }

    // Add 1 decoy per wave for hard difficulty
    if (hasDecoy) {
      const path = randomPath()
      const decoyDelay = randomRange(minDelay, maxDelay)
      objects.push({
        id: crypto.randomUUID(),
        kind: 'decoy',
        wave,
        delay: decoyDelay,
        duration: difficultyDuration * 0.75,
        ...path,
        x: path.startX,
        y: path.startY,
        state: 'waiting',
        hitAt: null,
      })
    }
  }
  return objects
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const projection = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + projection * dx), py - (y1 + projection * dy))
}

function NinjaObjectVisual({ object, now }: { object: NinjaObject; now: number }) {
  const burstVisible = object.state === 'intercepted' && object.hitAt !== null && now - object.hitAt < 250
  const hidden = object.state === 'waiting' || (object.state === 'intercepted' && !burstVisible) || object.state === 'missed'

  if (object.kind === 'decoy') {
    return (
      <svg
        viewBox="0 0 80 80"
        className={`fruit-ninja-object is-decoy${burstVisible ? ' is-burst' : ''}`}
        style={{ left: `${object.x}%`, top: `${object.y}%`, width: 52, height: 52, opacity: hidden ? 0 : 1, pointerEvents: 'none' }}
      >
        <circle cx="40" cy="40" r="34" fill="#00DDCC" stroke="rgba(0,255,220,.9)" strokeWidth="4" />
        <path d="M52 14 36 42h16L28 70 44 44H30Z" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" strokeLinejoin="round" />
        {burstVisible && (
          <g className="fruit-ninja-burst">
            {Array.from({ length: 8 }, (_, i) => (
              <circle key={i} cx={40 + Math.cos(i * Math.PI / 4) * 26} cy={40 + Math.sin(i * Math.PI / 4) * 26} r="5" fill="#00FFCC" />
            ))}
          </g>
        )}
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 80 80"
      className={`fruit-ninja-object is-ball${burstVisible ? ' is-burst' : ''}`}
      style={{ left: `${object.x}%`, top: `${object.y}%`, width: 52, height: 52, opacity: hidden ? 0 : 1, pointerEvents: 'none' }}
    >
      <circle cx="40" cy="40" r="34" fill="#f7f9fc" stroke="#101827" strokeWidth="4" />
      <path d="M40 19 53 28 48 45H32L27 28Z M32 45 20 57M48 45 60 57M27 28 15 24M53 28 65 24M40 19V7" fill="none" stroke="#101827" strokeWidth="4" />
      {burstVisible && (
        <g className="fruit-ninja-burst">
          {Array.from({ length: 8 }, (_, i) => (
            <circle key={i} cx={40 + Math.cos(i * Math.PI / 4) * 34} cy={40 + Math.sin(i * Math.PI / 4) * 34} r="5" fill="#ffcf32" />
          ))}
        </g>
      )}
    </svg>
  )
}

export function FruitNinjaPhase({ attackersInZone: _attackersInZone, difficulty, onResult, isPaused, awayTeam }: FruitNinjaPhaseProps) {
  const [attackerName] = useState(() => {
    const players = awayTeam?.players?.length
      ? awayTeam.players
      : awayTeam ? [`${awayTeam.shortName} 9`, `${awayTeam.shortName} 10`, `${awayTeam.shortName} 11`] : ['L\'attaquant']
    return players[Math.floor(Math.random() * Math.min(3, players.length))]
  })
  const arenaRef = useRef<HTMLElement | null>(null)
  const [tutorialDone, setTutorialDone] = useState(
    () => sessionStorage.getItem('brakup:tut:ninja') === '1'
  )
  const [preCountdownNum, setPreCountdownNum] = useState<number | null>(null)
  const [objects, setObjects] = useState<NinjaObject[]>(() => createAllObjects(difficulty))
  const objectsRef = useRef(objects)
  const startAtRef = useRef<number | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const totalPausedRef = useRef<number>(0)
  const resultAtRef = useRef<number | null>(null)
  const resultSentRef = useRef(false)
  const isPausedRef = useRef(isPaused ?? false)

  const [trails, setTrails] = useState<NinjaTrail[]>([])
  const [now, setNow] = useState(0)
  const nowRef = useRef(0)
  const [redFlashUntil, setRedFlashUntil] = useState(0)
  const [result, setResult] = useState<boolean | null>(null)
  const [comments, setComments] = useState<InterceptionComment[]>([])
  const [waveAnnouncement, setWaveAnnouncement] = useState<{ text: string; key: number } | null>(null)
  const waveAnnouncedRef = useRef<Set<number>>(new Set())
  const [missedCount, setMissedCount] = useState(0)
  const missedCountRef = useRef(0)
  const [missMessage, setMissMessage] = useState<string | null>(null)

  const intercepted = objects.filter((o) => o.kind === 'ball' && o.state === 'intercepted').length

  // Current wave based on elapsed time
  const elapsedForDisplay = startAtRef.current !== null ? Math.max(0, nowRef.current - startAtRef.current - totalPausedRef.current) : 0
  const currentWave = elapsedForDisplay < WAVE_2_START ? 1 : elapsedForDisplay < WAVE_3_START ? 2 : 3

  // Global pointer tracking for slash detection
  const isPointerDownRef = useRef(false)
  const lastPointerPxRef = useRef<{ x: number; y: number } | null>(null)

  // Sync isPausedRef
  useEffect(() => {
    const wasPaused = isPausedRef.current
    isPausedRef.current = isPaused ?? false
    if (wasPaused && !(isPaused ?? false) && pausedAtRef.current !== null) {
      // Unpausing: add duration of pause to total
      totalPausedRef.current += (performance.now() - pausedAtRef.current)
      pausedAtRef.current = null
    }
    if (!wasPaused && (isPaused ?? false)) {
      // Pausing: record when we paused
      pausedAtRef.current = performance.now()
    }
  }, [isPaused])

  useEffect(() => {
    if (!tutorialDone) return
    let frame = 0
    const animate = (timestamp: number) => {
      if (isPausedRef.current) {
        frame = requestAnimationFrame(animate)
        return
      }
      if (startAtRef.current === null) startAtRef.current = timestamp
      const elapsed = timestamp - startAtRef.current - totalPausedRef.current
      nowRef.current = timestamp
      setNow(timestamp)
      setTrails((current) => current.filter((trail) => timestamp - trail.createdAt < 450))
      setComments((current) => current.filter((c) => timestamp - c.createdAt < 600))

      if (resultAtRef.current !== null) {
        if (!resultSentRef.current && timestamp - resultAtRef.current >= 1000 && result !== null) {
          resultSentRef.current = true
          onResult(result)
          return
        }
        frame = requestAnimationFrame(animate)
        return
      }

      // Wave announcements
      if (elapsed >= WAVE_2_START && !waveAnnouncedRef.current.has(2)) {
        waveAnnouncedRef.current.add(2)
        setWaveAnnouncement({ text: 'VAGUE 2 !', key: Date.now() })
        setTimeout(() => setWaveAnnouncement(null), 1200)
      }
      if (elapsed >= WAVE_3_START && !waveAnnouncedRef.current.has(3)) {
        waveAnnouncedRef.current.add(3)
        setWaveAnnouncement({ text: 'VAGUE FINALE !', key: Date.now() })
        setTimeout(() => setWaveAnnouncement(null), 1200)
      }

      const prevObjects = objectsRef.current
      const nextObjects = prevObjects.map((object) => {
        if (object.state === 'intercepted' || object.state === 'missed') return object
        if (elapsed < object.delay) return object
        const progress = (elapsed - object.delay) / object.duration
        if (progress >= 1) return { ...object, x: object.endX, y: object.endY, state: 'missed' as const }
        return {
          ...object,
          x: object.startX + (object.endX - object.startX) * progress,
          y: object.startY + (object.endY - object.startY) * progress,
          state: 'active' as const,
        }
      })

      // Detect newly missed balls → red flash + miss message
      let newMisses = 0
      for (let i = 0; i < nextObjects.length; i++) {
        if (nextObjects[i].kind === 'ball' && nextObjects[i].state === 'missed' && prevObjects[i].state === 'active') {
          newMisses++
        }
      }
      if (newMisses > 0) {
        missedCountRef.current += newMisses
        setMissedCount(missedCountRef.current)
        setRedFlashUntil(timestamp + 500)
        const msgs = ['Ouille !', 'Ça fait mal !', 'Aïe !', 'On va encaisser un but !', 'Danger !!', 'Au but ! 😱', 'Trop rapide !']
        setMissMessage(msgs[Math.floor(randomUnit() * msgs.length)])
        setTimeout(() => setMissMessage(null), 1400)
      }

      objectsRef.current = nextObjects
      setObjects(nextObjects)

      // Check done: all objects settled OR time exceeded
      const allSettled = nextObjects.every((o) => o.state === 'intercepted' || o.state === 'missed')
      const timeUp = elapsed >= TOTAL_DURATION + 1500
      if (allSettled || timeUp) {
        const savedBalls = nextObjects.filter((o) => o.kind === 'ball' && o.state === 'intercepted').length
        const saved = savedBalls >= THRESHOLD
        setResult(saved)
        resultAtRef.current = timestamp
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResult, result, tutorialDone])

  const performSlash = (px1: number, py1: number, px2: number, py2: number) => {
    const rect = arenaRef.current?.getBoundingClientRect()
    if (!rect || resultAtRef.current !== null) return

    // Add trail in px coords
    setTrails((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        x1: px1,
        y1: py1,
        x2: px2,
        y2: py2,
        createdAt: nowRef.current,
      },
    ])

    // Hit detection in pixel coords
    let changed = false
    const nextObjects = objectsRef.current.map((object) => {
      if (object.state !== 'active') return object
      const objPx = (object.x / 100) * rect.width
      const objPy = (object.y / 100) * rect.height
      const hitRadius = (object.kind === 'ball' ? 52 : 52) / 2 + 22
      if (distanceToSegment(objPx, objPy, px1, py1, px2, py2) > hitRadius) return object
      changed = true
      if (object.kind === 'decoy') {
        setRedFlashUntil(nowRef.current + 200)
      } else {
        // Show interception comment near ball position
        const comment = INTERCEPTION_COMMENTS[Math.floor(randomUnit() * INTERCEPTION_COMMENTS.length)]
        setComments((current) => [
          ...current,
          { id: crypto.randomUUID(), text: comment, x: object.x, y: object.y, createdAt: nowRef.current },
        ])
      }
      return { ...object, state: 'intercepted' as const, hitAt: nowRef.current }
    })
    if (changed) {
      objectsRef.current = nextObjects
      setObjects(nextObjects)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!tutorialDone) return
    e.currentTarget.setPointerCapture(e.pointerId)
    isPointerDownRef.current = true
    const rect = arenaRef.current?.getBoundingClientRect()
    if (rect) lastPointerPxRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!isPointerDownRef.current) return
    const rect = arenaRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const last = lastPointerPxRef.current
    if (last) performSlash(last.x, last.y, x, y)
    lastPointerPxRef.current = { x, y }
  }

  const handlePointerUp = () => {
    isPointerDownRef.current = false
    lastPointerPxRef.current = null
  }

  return (
    <section
      className="fruit-ninja-phase"
      ref={arenaRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <style>{`
        .fruit-ninja-phase{position:absolute;z-index:1200;inset:0;overflow:hidden;color:#fff;background:#03070d;touch-action:none;cursor:crosshair;user-select:none}
        .fn-pre-countdown{position:absolute;inset:0;z-index:65;background:rgba(3,7,14,.75);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;pointer-events:none}
        .fn-pre-countdown__num{font:900 clamp(80px,25vw,140px) 'Barlow Condensed',sans-serif;color:#fff;letter-spacing:.06em;line-height:1;text-shadow:0 0 40px rgba(255,255,255,.5);animation:fnCdnPop .85s cubic-bezier(.22,1,.36,1) both}
        .fn-pre-countdown__num.is-go{color:#2bff9a;text-shadow:0 0 60px rgba(43,255,154,.9);animation:fnCdnGo .55s cubic-bezier(.22,1,.36,1) both}
        @keyframes fnCdnPop{0%{transform:scale(2.2);opacity:0}25%{opacity:1}80%{transform:scale(1);opacity:1}100%{transform:scale(.8);opacity:0}}
        @keyframes fnCdnGo{0%{transform:scale(.4);opacity:0}40%{transform:scale(1.1);opacity:1}100%{transform:scale(1.5);opacity:0}}
        .fruit-ninja-grid{position:absolute;inset:0;pointer-events:none;opacity:.05}
        .fruit-ninja-counter{position:absolute;z-index:20;top:max(54px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
        .fruit-ninja-counter-title{font:900 40px 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:#fff}
        .fruit-ninja-counter-title span{color:rgba(255,255,255,.35)}
        .fruit-ninja-counter small{font:600 12px 'Barlow',sans-serif;color:rgba(255,255,255,.5)}
        .fruit-ninja-counter-bar{width:180px;height:5px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
        .fruit-ninja-counter-fill{height:100%;background:linear-gradient(90deg,#2bff9a,#00c97a);box-shadow:0 0 8px rgba(43,255,154,.7);transition:width .2s}
        .fruit-ninja-wave-badge{font:700 11px 'Barlow Condensed',sans-serif;letter-spacing:.18em;color:rgba(43,255,154,.7);text-transform:uppercase;margin-top:-2px}
        .fruit-ninja-hint{position:absolute;z-index:20;bottom:max(40px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:rgba(255,255,255,.35);text-transform:uppercase;pointer-events:none;white-space:nowrap}
        .fruit-ninja-object{position:absolute;z-index:8;overflow:visible;transform:translate(-50%,-50%);filter:drop-shadow(0 8px 8px rgba(0,0,0,.6));will-change:left,top}
        .fruit-ninja-object text{fill:#fff;font-weight:950;font-family:'Barlow Condensed',sans-serif}
        .fruit-ninja-object.is-burst{animation:fnObjectBurst .25s both}
        .fruit-ninja-burst circle{transform-origin:40px 40px;animation:fnParticle .25s both}
        .fruit-ninja-object.is-decoy{filter:drop-shadow(0 0 10px rgba(0,221,204,.9)) drop-shadow(0 8px 8px rgba(0,0,0,.6));animation:fnSonicPulse .3s ease-in-out infinite alternate}
        .fruit-ninja-trails{position:absolute;z-index:15;inset:0;pointer-events:none}
        .fruit-ninja-trails line{stroke:#2bff9a;stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 6px rgba(43,255,154,.9)) drop-shadow(0 0 12px rgba(43,255,154,.5));animation:fnSlash .45s both}
        .fruit-ninja-flash{position:absolute;z-index:30;inset:0;background:rgba(255,20,45,.55);pointer-events:none;animation:fnFlash .5s both}
        .fruit-ninja-comment{position:absolute;z-index:25;transform:translate(-50%,-100%);font:900 18px 'Barlow Condensed',sans-serif;color:#2bff9a;text-shadow:0 0 8px rgba(43,255,154,.9);pointer-events:none;animation:fnComment .6s both;letter-spacing:.06em;white-space:nowrap}
        .fn-miss-message{position:absolute;z-index:36;top:38%;left:50%;transform:translate(-50%,-50%);font:900 clamp(24px,8vw,40px) 'Barlow Condensed',sans-serif;color:#FF4455;text-shadow:0 0 24px rgba(255,68,85,.9);pointer-events:none;white-space:nowrap;animation:fnMissMsg .6s cubic-bezier(.22,1,.36,1) both;text-align:center}
        @keyframes fnMissMsg{0%{transform:translate(-50%,-50%) scale(.6);opacity:0}20%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}80%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.9)}}
        .fn-miss-counter{position:absolute;z-index:20;top:max(54px,env(safe-area-inset-top));right:16px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;pointer-events:none}
        .fn-miss-counter__num{font:900 28px 'Barlow Condensed',sans-serif;color:#FF4455;text-shadow:0 0 12px rgba(255,68,85,.7);line-height:1}
        .fn-miss-counter__label{font:600 10px 'Barlow',sans-serif;color:rgba(255,68,85,.6);text-transform:uppercase;letter-spacing:.1em}
        .fruit-ninja-wave-announce{position:absolute;z-index:35;inset:0;display:grid;place-items:center;pointer-events:none}
        .fruit-ninja-wave-announce span{font:900 clamp(48px,14vw,80px) 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:#2bff9a;text-shadow:0 0 24px rgba(43,255,154,.8),0 0 48px rgba(43,255,154,.4);animation:fnWaveAnnounce 1.2s both}
        .fruit-ninja-result{position:absolute;z-index:40;inset:0;display:grid;place-items:center;align-content:center;background:rgba(2,7,14,.82);animation:fnResultIn .2s both}
        .fruit-ninja-result h2{margin:0;font:900 clamp(60px,20vw,120px) 'Barlow Condensed',sans-serif;letter-spacing:.02em;line-height:.9}
        .fruit-ninja-result.is-saved h2{color:#2bff9a;text-shadow:0 0 36px rgba(43,255,154,.6),0 4px 0 rgba(0,140,80,.8)}
        .fruit-ninja-result.is-goal h2{color:#FF4455;text-shadow:0 0 36px rgba(255,68,85,.6)}
        .fruit-ninja-result p{font:500 14px 'Barlow',sans-serif;color:rgba(255,255,255,.5);margin-top:12px}
        @keyframes fnSlash{from{opacity:1}to{opacity:0}}
        @keyframes fnFlash{from{opacity:1}to{opacity:0}}
        @keyframes fnObjectBurst{to{transform:translate(-50%,-50%) scale(1.8);opacity:0}}
        @keyframes fnParticle{to{transform:scale(2.5);opacity:0}}
        @keyframes fnResultIn{from{opacity:0;transform:scale(1.1)}to{opacity:1;transform:none}}
        @keyframes fnSonicPulse{from{filter:drop-shadow(0 0 6px rgba(0,221,204,.6)) drop-shadow(0 8px 8px rgba(0,0,0,.6))}to{filter:drop-shadow(0 0 16px rgba(0,255,220,1)) drop-shadow(0 8px 8px rgba(0,0,0,.6))}}
        @keyframes fnComment{0%{opacity:1;transform:translate(-50%,-100%)}80%{opacity:1;transform:translate(-50%,-130%)}100%{opacity:0;transform:translate(-50%,-140%)}}
        @keyframes fnWaveAnnounce{0%{opacity:0;transform:scale(.8)}15%{opacity:1;transform:scale(1.05)}30%{transform:scale(1)}85%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.95)}}
        .fn-tutorial{position:absolute;inset:0;z-index:60;background:rgba(3,7,14,.85);backdrop-filter:blur(4px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:28px 24px;text-align:center}
        .fn-tutorial__title{font:900 clamp(36px,12vw,58px) 'Barlow Condensed',sans-serif;letter-spacing:.18em;color:#2bff9a;text-shadow:0 0 36px rgba(43,255,154,.6);text-transform:uppercase}
        .fn-tutorial__emoji{font-size:52px;animation:fnTutSwipe .8s ease-in-out infinite alternate}
        @keyframes fnTutSwipe{from{transform:translateX(-18px) rotate(-10deg)}to{transform:translateX(18px) rotate(10deg)}}
        .fn-tutorial__text{font:600 clamp(14px,4.5vw,17px) 'Barlow Condensed',sans-serif;color:rgba(255,255,255,.85);max-width:300px;line-height:1.45}
        .fn-tutorial__sub{font:500 clamp(11px,3.5vw,13px) 'Barlow',sans-serif;color:rgba(255,255,255,.4);max-width:280px;line-height:1.4}
        .fn-tutorial__btn{margin-top:8px;padding:13px 32px;border-radius:12px;border:2px solid #2bff9a;background:rgba(43,255,154,.12);color:#2bff9a;font:800 17px 'Barlow Condensed',sans-serif;letter-spacing:.14em;cursor:pointer;box-shadow:0 0 20px rgba(43,255,154,.3)}
      `}</style>

      {/* Tutorial overlay */}
      {!tutorialDone && preCountdownNum === null && (
        <div className="fn-tutorial">
          <div className="fn-tutorial__title">ALERTE ROUGE !</div>
          <div className="fn-tutorial__emoji">⚠️</div>
          <div className="fn-tutorial__text">
            <b style={{color:'#FF4455'}}>{attackerName}</b>{awayTeam ? ` (${awayTeam.shortName})` : ''} et ses équipiers chargent leur frappe en <b style={{color:'#2bff9a'}}>3 vagues</b> !<br/><br/>
            <b style={{color:'#FFB800'}}>Glisse rapidement</b> sur les ballons pour les intercepter avant qu'ils atteignent le but.<br/>
            Arrête <b style={{color:'#2bff9a'}}>{THRESHOLD}/{BALL_COUNT}</b> tirs pour défendre.
          </div>
          <div className="fn-tutorial__sub">
            ⚡ Les ballons cyan <b>sont des feintes</b> — ne les touche pas !
          </div>
          <button
            type="button"
            className="fn-tutorial__btn"
            onClick={() => {
              sessionStorage.setItem('brakup:tut:ninja', '1')
              setPreCountdownNum(3)
              setTimeout(() => setPreCountdownNum(2), 900)
              setTimeout(() => setPreCountdownNum(1), 1800)
              setTimeout(() => setPreCountdownNum(0), 2700)
              setTimeout(() => { setPreCountdownNum(null); setTutorialDone(true) }, 3300)
            }}
          >
            🧤 Je défends !
          </button>
        </div>
      )}

      {/* Pre-game countdown (after tutorial dismiss) */}
      {!tutorialDone && preCountdownNum !== null && (
        <div className="fn-pre-countdown">
          <div key={preCountdownNum} className={`fn-pre-countdown__num${preCountdownNum === 0 ? ' is-go' : ''}`}>
            {preCountdownNum === 0 ? 'GO !' : preCountdownNum}
          </div>
        </div>
      )}

      {/* Faint grid lines */}
      <svg className="fruit-ninja-grid" viewBox="0 0 375 812" preserveAspectRatio="none">
        <g stroke="#2bff9a" strokeWidth="1">
          <line x1="0" y1="200" x2="375" y2="200" />
          <line x1="0" y1="400" x2="375" y2="400" />
          <line x1="0" y1="600" x2="375" y2="600" />
          <line x1="187" y1="0" x2="187" y2="812" />
        </g>
      </svg>

      {/* Counter */}
      <div className="fruit-ninja-counter">
        <div className="fruit-ninja-counter-title">
          \uD83E\uDDE4 {intercepted} <span>/ {BALL_COUNT}</span>
        </div>
        <div className="fruit-ninja-wave-badge">VAGUE {currentWave}/3</div>
        <small>arr\u00EAte {THRESHOLD} tirs pour d\u00E9fendre</small>
        <div className="fruit-ninja-counter-bar">
          <div className="fruit-ninja-counter-fill" style={{ width: `${Math.min(100, intercepted / BALL_COUNT * 100)}%` }} />
        </div>
      </div>

      {/* Attacker name reminder */}
      <div className="fruit-ninja-hint">
        <span style={{color:'#FF4455'}}>{attackerName}</span> arme sa frappe \u2014 intercepte !
      </div>

      {/* Objects (pure visual, pointer-events:none) */}
      {objects.map((object) => (
        <NinjaObjectVisual key={object.id} object={object} now={now} />
      ))}

      {/* Slash trails — no viewBox so coords are CSS px */}
      <svg className="fruit-ninja-trails" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {trails.map((trail) => (
          <line key={trail.id} x1={trail.x1} y1={trail.y1} x2={trail.x2} y2={trail.y2} />
        ))}
      </svg>

      {/* Interception comments */}
      {comments.map((c) => (
        <div key={c.id} className="fruit-ninja-comment" style={{ left: `${c.x}%`, top: `${c.y}%` }}>
          {c.text}
        </div>
      ))}

      {/* Miss counter (top right) */}
      {missedCount > 0 && (
        <div className="fn-miss-counter">
          <div className="fn-miss-counter__num">-{missedCount}</div>
          <div className="fn-miss-counter__label">ratés</div>
        </div>
      )}

      {now < redFlashUntil ? <div className="fruit-ninja-flash" /> : null}

      {/* Miss message */}
      {missMessage ? <div key={missMessage + missedCount} className="fn-miss-message">{missMessage}</div> : null}

      {/* Wave announcement overlay */}
      {waveAnnouncement ? (
        <div className="fruit-ninja-wave-announce" key={waveAnnouncement.key}>
          <span>{waveAnnouncement.text}</span>
        </div>
      ) : null}

      {result !== null ? (
        <div className={`fruit-ninja-result ${result ? 'is-saved' : 'is-goal'}`}>
          <h2>{result ? 'ARRETE !' : 'BUT !'}</h2>
          <p>{intercepted} ballon{intercepted > 1 ? 's' : ''} intercepte{intercepted > 1 ? 's' : ''}</p>
        </div>
      ) : null}
    </section>
  )
}

export default FruitNinjaPhase
