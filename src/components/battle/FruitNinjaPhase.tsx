import { useEffect, useRef, useState } from 'react'
import type { BattleDifficulty } from '../../types'

type FruitNinjaPhaseProps = {
  attackersInZone: number
  difficulty: BattleDifficulty
  onResult: (saved: boolean) => void
}

type NinjaKind = 'ball' | 'card' | 'cone' | 'sonic'
type NinjaState = 'waiting' | 'active' | 'intercepted' | 'missed'

type NinjaObject = {
  id: string
  kind: NinjaKind
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

function randomUnit() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] / 0xffffffff
}

function randomRange(minimum: number, maximum: number) {
  return minimum + randomUnit() * (maximum - minimum)
}

function randomPath() {
  const edge = Math.floor(randomUnit() * 4)
  if (edge === 0) return { startX: -10, startY: randomRange(12, 88), endX: 110, endY: randomRange(12, 88) }
  if (edge === 1) return { startX: 110, startY: randomRange(12, 88), endX: -10, endY: randomRange(12, 88) }
  if (edge === 2) return { startX: randomRange(12, 88), startY: -10, endX: randomRange(12, 88), endY: 110 }
  return { startX: randomRange(12, 88), startY: 110, endX: randomRange(12, 88), endY: -10 }
}

function createObjects(attackersInZone: number, difficulty: BattleDifficulty) {
  const ballCount = attackersInZone === 1 ? 3 : attackersInZone === 2 ? 5 : 7
  const sonicCount = difficulty === 'easy' ? 0 : difficulty === 'medium' ? 1 : 2
  const kinds: NinjaKind[] = [
    ...Array.from({ length: ballCount }, () => 'ball' as const),
    ...(attackersInZone >= 3 ? ['card' as const, 'cone' as const] : []),
    ...Array.from({ length: sonicCount }, () => 'sonic' as const),
  ]
  for (let index = kinds.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomUnit() * (index + 1))
    const current = kinds[index]
    kinds[index] = kinds[swapIndex]
    kinds[swapIndex] = current
  }

  const rawDelays: number[] = []
  let delay = 100
  for (let index = 0; index < kinds.length; index += 1) {
    rawDelays.push(delay)
    delay += randomRange(400, 900)
  }
  const scale = delay > 4500 ? 4200 / delay : 1

  // Slower durations so balls are easier to track and slice on desktop
  const zoneDuration = attackersInZone === 1 ? 3800 : attackersInZone === 2 ? 3000 : 2400
  const difficultyFactor = difficulty === 'easy' ? 1.15 : difficulty === 'hard' ? 0.92 : 1

  return kinds.map<NinjaObject>((kind, index) => {
    const path = randomPath()
    const sonicDuration = difficulty === 'easy' ? 900 : difficulty === 'medium' ? 700 : 550
    return {
      id: crypto.randomUUID(),
      kind,
      delay: rawDelays[index] * scale,
      duration: kind === 'sonic' ? sonicDuration : zoneDuration * difficultyFactor * randomRange(.9, 1.1),
      ...path,
      x: path.startX,
      y: path.startY,
      state: 'waiting',
      hitAt: null,
    }
  })
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const projection = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + projection * dx), py - (y1 + projection * dy))
}

// Pure visual — no event handlers (slashing is tracked globally on the arena)
function NinjaObjectVisual({ object, now }: { object: NinjaObject; now: number }) {
  const burstVisible = object.state === 'intercepted' && object.hitAt !== null && now - object.hitAt < 250
  const diameter = object.kind === 'ball' ? 58 : object.kind === 'sonic' ? 44 : 52
  const hidden = object.state === 'waiting' || (object.state === 'intercepted' && !burstVisible) || object.state === 'missed'
  return (
    <svg
      viewBox="0 0 80 80"
      className={`fruit-ninja-object is-${object.kind}${burstVisible ? ' is-burst' : ''}`}
      style={{ left: `${object.x}%`, top: `${object.y}%`, width: diameter, height: diameter, opacity: hidden ? 0 : 1, pointerEvents: 'none' }}
    >
      {object.kind === 'ball' ? (
        <>
          <circle cx="40" cy="40" r="34" fill="#f7f9fc" stroke="#101827" strokeWidth="4" />
          <path d="M40 19 53 28 48 45H32L27 28Z M32 45 20 57M48 45 60 57M27 28 15 24M53 28 65 24M40 19V7" fill="none" stroke="#101827" strokeWidth="4" />
        </>
      ) : null}
      {object.kind === 'card' ? (
        <>
          <rect x="17" y="8" width="46" height="64" rx="5" fill="#ed2039" stroke="#ff8795" strokeWidth="4" />
          <text x="40" y="48" textAnchor="middle" fontSize="25" fill="#fff" fontWeight="900" fontFamily="Barlow Condensed,sans-serif">!</text>
        </>
      ) : null}
      {object.kind === 'cone' ? (
        <>
          <path d="M40 7 65 64H15Z" fill="#ff8a16" stroke="#ffc166" strokeWidth="4" />
          <path d="M28 37H53" stroke="#fff" strokeWidth="6" />
          <rect x="9" y="63" width="62" height="9" rx="4" fill="#ff8a16" />
        </>
      ) : null}
      {object.kind === 'sonic' ? (
        <>
          <circle cx="40" cy="40" r="34" fill="#00DDCC" stroke="rgba(0,255,220,.9)" strokeWidth="4" />
          <path d="M52 14 36 42h16L28 70 44 44H30Z" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.9)" strokeWidth="2.5" strokeLinejoin="round" />
        </>
      ) : null}
      {burstVisible ? (
        <g className="fruit-ninja-burst">
          {Array.from({ length: 8 }, (_, index) => (
            <circle key={index} cx={40 + Math.cos(index * Math.PI / 4) * 26} cy={40 + Math.sin(index * Math.PI / 4) * 26} r="5" fill={object.kind === 'sonic' ? '#00FFCC' : '#ffcf32'} />
          ))}
        </g>
      ) : null}
    </svg>
  )
}

export function FruitNinjaPhase({ attackersInZone, difficulty, onResult }: FruitNinjaPhaseProps) {
  const arenaRef = useRef<HTMLElement | null>(null)
  const [objects, setObjects] = useState<NinjaObject[]>(() => createObjects(attackersInZone, difficulty))
  const objectsRef = useRef(objects)
  const startAtRef = useRef<number | null>(null)
  const resultAtRef = useRef<number | null>(null)
  const resultSentRef = useRef(false)
  const [trails, setTrails] = useState<NinjaTrail[]>([])
  const [now, setNow] = useState(0)
  const nowRef = useRef(0)
  const [redFlashUntil, setRedFlashUntil] = useState(0)
  const [result, setResult] = useState<boolean | null>(null)
  const ballCount = attackersInZone === 1 ? 3 : attackersInZone === 2 ? 5 : 7
  const threshold = ballCount === 3 ? 2 : ballCount === 5 ? 3 : 4
  const intercepted = objects.filter((object) => object.kind === 'ball' && object.state === 'intercepted').length

  // Global pointer tracking for slash detection
  const isPointerDownRef = useRef(false)
  const lastPointerPxRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let frame = 0
    const animate = (timestamp: number) => {
      if (startAtRef.current === null) startAtRef.current = timestamp
      const elapsed = timestamp - startAtRef.current
      nowRef.current = timestamp
      setNow(timestamp)
      setTrails((current) => current.filter((trail) => timestamp - trail.createdAt < 350))

      if (resultAtRef.current !== null) {
        if (!resultSentRef.current && timestamp - resultAtRef.current >= 1000 && result !== null) {
          resultSentRef.current = true
          onResult(result)
          return
        }
        frame = requestAnimationFrame(animate)
        return
      }

      const nextObjects = objectsRef.current.map((object) => {
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
      objectsRef.current = nextObjects
      setObjects(nextObjects)

      if (nextObjects.every((object) => object.state === 'intercepted' || object.state === 'missed')) {
        const savedBalls = nextObjects.filter((object) => object.kind === 'ball' && object.state === 'intercepted').length
        const decoyPenalties = nextObjects.filter((object) => object.kind !== 'ball' && object.state === 'intercepted').length
        const saved = savedBalls >= threshold && ballCount - savedBalls + decoyPenalties <= ballCount - threshold
        setResult(saved)
        resultAtRef.current = timestamp
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [ballCount, onResult, result, threshold])

  const performSlash = (px1: number, py1: number, px2: number, py2: number) => {
    const rect = arenaRef.current?.getBoundingClientRect()
    if (!rect || resultAtRef.current !== null) return

    // Add trail in % coords for the SVG overlay
    setTrails((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        x1: (px1 / rect.width) * 100,
        y1: (py1 / rect.height) * 100,
        x2: (px2 / rect.width) * 100,
        y2: (py2 / rect.height) * 100,
        createdAt: nowRef.current,
      },
    ])

    // Hit detection in pixel coords
    let changed = false
    const nextObjects = objectsRef.current.map((object) => {
      if (object.state !== 'active') return object
      const objPx = (object.x / 100) * rect.width
      const objPy = (object.y / 100) * rect.height
      // Hit radius = actual sprite radius + generous tolerance
      const hitRadius = (object.kind === 'ball' ? 58 : 52) / 2 + 14
      if (distanceToSegment(objPx, objPy, px1, py1, px2, py2) > hitRadius) return object
      changed = true
      if (object.kind !== 'ball') setRedFlashUntil(nowRef.current + 200)
      return { ...object, state: 'intercepted' as const, hitAt: nowRef.current }
    })
    if (changed) {
      objectsRef.current = nextObjects
      setObjects(nextObjects)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
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
      onPointerLeave={handlePointerUp}
    >
      <style>{`
        .fruit-ninja-phase{position:fixed;z-index:1200;inset:0;overflow:hidden;color:#fff;background:#03070d;touch-action:none;cursor:crosshair;user-select:none}
        .fruit-ninja-grid{position:absolute;inset:0;pointer-events:none;opacity:.05}
        .fruit-ninja-counter{position:absolute;z-index:20;top:max(54px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
        .fruit-ninja-counter-title{font:900 40px 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:#fff}
        .fruit-ninja-counter-title span{color:rgba(255,255,255,.35)}
        .fruit-ninja-counter small{font:600 12px 'Barlow',sans-serif;color:rgba(255,255,255,.5)}
        .fruit-ninja-counter-bar{width:180px;height:5px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
        .fruit-ninja-counter-fill{height:100%;background:linear-gradient(90deg,#FFB800,#ff9a00);box-shadow:0 0 8px rgba(255,184,0,.7);transition:width .2s}
        .fruit-ninja-hint{position:absolute;z-index:20;bottom:max(40px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:rgba(255,255,255,.35);text-transform:uppercase;pointer-events:none;white-space:nowrap}
        .fruit-ninja-object{position:absolute;z-index:8;overflow:visible;transform:translate(-50%,-50%);filter:drop-shadow(0 8px 8px rgba(0,0,0,.6));will-change:left,top}
        .fruit-ninja-object text{fill:#fff;font-weight:950;font-family:'Barlow Condensed',sans-serif}
        .fruit-ninja-object.is-burst{animation:fnObjectBurst .25s both}
        .fruit-ninja-burst circle{transform-origin:40px 40px;animation:fnParticle .25s both}
        .fruit-ninja-trails{position:absolute;z-index:15;inset:0;width:100%;height:100%;pointer-events:none}
        .fruit-ninja-trails line{stroke:#fff;stroke-width:5;stroke-linecap:round;filter:drop-shadow(0 0 10px rgba(255,255,255,.9));animation:fnSlash .35s both}
        .fruit-ninja-object.is-sonic{filter:drop-shadow(0 0 10px rgba(0,221,204,.9)) drop-shadow(0 8px 8px rgba(0,0,0,.6));animation:fnSonicPulse .3s ease-in-out infinite alternate}
        .fruit-ninja-flash{position:absolute;z-index:30;inset:0;background:rgba(255,20,45,.48);pointer-events:none;animation:fnFlash .2s both}
        .fruit-ninja-result{position:absolute;z-index:40;inset:0;display:grid;place-items:center;align-content:center;background:rgba(2,7,14,.82);animation:fnResultIn .2s both}
        .fruit-ninja-result h2{margin:0;font:900 clamp(60px,20vw,120px) 'Barlow Condensed',sans-serif;letter-spacing:.02em;line-height:.9}
        .fruit-ninja-result.is-saved h2{color:#FFB800;text-shadow:0 0 36px rgba(255,184,0,.6),0 4px 0 rgba(176,125,0,.8)}
        .fruit-ninja-result.is-goal h2{color:#FF4455;text-shadow:0 0 36px rgba(255,68,85,.6)}
        .fruit-ninja-result p{font:500 14px 'Barlow',sans-serif;color:rgba(255,255,255,.5);margin-top:12px}
        @keyframes fnSlash{0%{opacity:0}20%{opacity:1}100%{opacity:0}}
        @keyframes fnFlash{from{opacity:1}to{opacity:0}}
        @keyframes fnObjectBurst{to{transform:translate(-50%,-50%) scale(1.8);opacity:0}}
        @keyframes fnParticle{to{transform:scale(2.5);opacity:0}}
        @keyframes fnResultIn{from{opacity:0;transform:scale(1.1)}to{opacity:1;transform:none}}
        @keyframes fnSonicPulse{from{filter:drop-shadow(0 0 6px rgba(0,221,204,.6)) drop-shadow(0 8px 8px rgba(0,0,0,.6))}to{filter:drop-shadow(0 0 16px rgba(0,255,220,1)) drop-shadow(0 8px 8px rgba(0,0,0,.6))}}
      `}</style>

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
          {'\u26BD'} {intercepted} <span>/ {ballCount}</span>
        </div>
        <small>intercepte {threshold} pour arreter</small>
        <div className="fruit-ninja-counter-bar">
          <div className="fruit-ninja-counter-fill" style={{ width: `${Math.min(100, intercepted / ballCount * 100)}%` }} />
        </div>
      </div>

      {/* Hint for desktop */}
      <div className="fruit-ninja-hint">Glisser pour intercepter les ballons</div>

      {/* Objects (pure visual, pointer-events:none) */}
      {objects.map((object) => (
        <NinjaObjectVisual key={object.id} object={object} now={now} />
      ))}

      {/* Slash trails */}
      <svg className="fruit-ninja-trails" viewBox="0 0 100 100" preserveAspectRatio="none">
        {trails.map((trail) => (
          <line key={trail.id} x1={trail.x1} y1={trail.y1} x2={trail.x2} y2={trail.y2} />
        ))}
      </svg>

      {now < redFlashUntil ? <div className="fruit-ninja-flash" /> : null}

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
