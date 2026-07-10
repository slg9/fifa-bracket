import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { sfx } from '../lib/sfx'
import type { TeamKit } from '../lib/teamKits'

export type SurvivalMiniStats = {
  units: number
  score: number
}

type CommonProps = {
  playerKit?: TeamKit
  opponentKit?: TeamKit
  keeperName?: string
  onGameplayStart?: () => void
  onStats?: (stats: SurvivalMiniStats) => void
  onGameOver: () => void
}

type Enemy = { id: string; x: number; y: number; speed: number; hp: number; maxHp: number; drift: number; phase: number; kind: 'normal' | 'fast' | 'tank' }
type Bullet = { id: string; x: number; y: number }
type SliceObject = { id: string; x: number; y: number; vx: number; vy: number; kind: 'ball' | 'bomb'; speed: number }
type SaveBall = { id: string; x: number; y: number; vx: number; vy: number; speed: number }

const COUNTDOWN = [3, 2, 1, 0]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function useCountdown(onReady?: () => void) {
  const [countdown, setCountdown] = useState(3)
  const readyRef = useRef(false)
  useEffect(() => {
    const timers = COUNTDOWN.map((value, index) => window.setTimeout(() => {
      setCountdown(value)
      if (value === 0) sfx.countdownGo()
      else sfx.countdownTick()
    }, index * 760))
    const done = window.setTimeout(() => {
      readyRef.current = true
      setCountdown(-1)
      onReady?.()
    }, COUNTDOWN.length * 760)
    return () => {
      timers.forEach(window.clearTimeout)
      window.clearTimeout(done)
    }
  }, [onReady])
  return { countdown, ready: readyRef.current }
}

function CountOverlay({ value }: { value: number }) {
  if (value < 0) return null
  return <div className="survival-mode-count"><span key={value}>{value === 0 ? 'GO !' : value}</span></div>
}

function FieldChrome({ children, tone = '#2bff9a' }: { children: React.ReactNode; tone?: string }) {
  return (
    <section className="survival-mode" style={{ '--mode-tone': tone } as CSSProperties}>
      <style>{`
        .survival-mode{position:absolute;inset:0;overflow:hidden;background:linear-gradient(180deg,#061426,#07151d 52%,#05100a);color:#fff;font-family:'Barlow Condensed',sans-serif;touch-action:none;user-select:none}
        .survival-mode:before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 18px),radial-gradient(circle at 50% 0,color-mix(in srgb,var(--mode-tone) 18%,transparent),transparent 30%);pointer-events:none}
        .survival-mode-count{position:absolute;z-index:50;inset:0;display:grid;place-items:center;background:rgba(2,8,16,.64)}
        .survival-mode-count span{font:900 clamp(78px,24vw,132px) 'Barlow Condensed';color:#fff;text-shadow:0 0 34px var(--mode-tone);animation:survivalModePop .72s both}
        .survival-mode-hint{position:absolute;left:14px;right:14px;bottom:max(16px,calc(env(safe-area-inset-bottom) + 10px));z-index:8;padding:8px 10px;border-radius:999px;background:rgba(2,8,16,.52);border:1px solid rgba(255,255,255,.1);text-align:center;font:900 11px 'Barlow Condensed';letter-spacing:.12em;color:rgba(255,255,255,.66);text-transform:uppercase;pointer-events:none}
        .survival-mode-life{position:absolute;z-index:8;top:max(82px,calc(env(safe-area-inset-top) + 72px));left:14px;display:flex;gap:6px}.survival-mode-life i{width:22px;height:22px;border-radius:50%;border:2px solid currentColor;color:#2bff9a;box-shadow:0 0 12px currentColor}.survival-mode-life i.is-lost{color:#FF4455;opacity:.45}
        @keyframes survivalModePop{0%{opacity:0;transform:scale(2.1)}24%{opacity:1}82%{transform:scale(1)}100%{opacity:0;transform:scale(.82)}}
      `}</style>
      {children}
    </section>
  )
}

export function DefenseSurvival({ playerKit, opponentKit, onGameplayStart, onStats, onGameOver }: CommonProps) {
  const [playerX, setPlayerX] = useState(50)
  const [enemies, setEnemies] = useState<Enemy[]>([])
  const [bullets, setBullets] = useState<Bullet[]>([])
  const [leaks, setLeaks] = useState(0)
  const [stops, setStops] = useState(0)
  const playerXRef = useRef(50)
  const enemiesRef = useRef<Enemy[]>([])
  const bulletsRef = useRef<Bullet[]>([])
  const leaksRef = useRef(0)
  const stopsRef = useRef(0)
  const lastSpawnRef = useRef(0)
  const lastShotRef = useRef(0)
  const startRef = useRef(0)
  const endedRef = useRef(false)
  const { countdown, ready } = useCountdown(onGameplayStart)
  const tone = playerKit?.primary ?? '#2bff9a'
  const enemyTone = opponentKit?.primary ?? '#FF4455'

  const publish = useCallback(() => {
    onStats?.({ units: stopsRef.current, score: stopsRef.current * 130 })
  }, [onStats])

  useEffect(() => {
    const keys = { left: false, right: false }
    const down = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') keys.left = true
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') keys.right = true
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') keys.left = false
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') keys.right = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    let frame = 0
    let prev = 0
    const tick = (now: number) => {
      if (!ready || endedRef.current) { frame = requestAnimationFrame(tick); return }
      if (!startRef.current) startRef.current = now
      if (!prev) prev = now
      const dt = Math.min(48, now - prev)
      prev = now
      const seconds = (now - startRef.current) / 1000
      if (keys.left || keys.right) {
        const dir = keys.right ? 1 : -1
        playerXRef.current = clamp(playerXRef.current + dir * dt * 0.065, 8, 92)
        setPlayerX(playerXRef.current)
      }
      const spawnEvery = Math.max(320, 1180 - seconds * 22)
      if (now - lastSpawnRef.current > spawnEvery) {
        lastSpawnRef.current = now
        const pressure = Math.min(1, seconds / 110)
        const count = 1 + Math.floor(Math.random() * (1 + Math.min(3, Math.floor(seconds / 28))))
        const nextEnemies = Array.from({ length: count }, () => {
          const kind: Enemy['kind'] = Math.random() < pressure * 0.25 ? 'tank' : Math.random() < 0.22 + pressure * 0.2 ? 'fast' : 'normal'
          const hp = kind === 'tank' ? 3 : 1
          return { id: crypto.randomUUID(), x: rand(10, 90), y: -10 - rand(0, 18), speed: rand(20, 33) + seconds * 0.42 + (kind === 'fast' ? 18 : 0), hp, maxHp: hp, drift: rand(-10, 10) * pressure, phase: rand(0, Math.PI * 2), kind }
        })
        enemiesRef.current = [...enemiesRef.current, ...nextEnemies]
      }
      if (now - lastShotRef.current > Math.max(90, 185 - seconds * 1.1)) {
        lastShotRef.current = now
        bulletsRef.current = [...bulletsRef.current, { id: crypto.randomUUID(), x: playerXRef.current, y: 84 }]
      }
      const movedBullets = bulletsRef.current.map((bullet) => ({ ...bullet, y: bullet.y - dt * 0.095 })).filter((bullet) => bullet.y > -6)
      let killed = 0
      const usedBullets = new Set<string>()
      const movedEnemies = enemiesRef.current.flatMap((enemy) => {
        const y = enemy.y + enemy.speed * dt / 1000
        const x = clamp(enemy.x + Math.sin(now / 360 + enemy.phase) * enemy.drift * dt / 850, 7, 93)
        const hit = movedBullets.find((bullet) => !usedBullets.has(bullet.id) && Math.abs(bullet.x - x) < (enemy.kind === 'tank' ? 9 : 7) && Math.abs(bullet.y - y) < 8)
        if (hit) {
          usedBullets.add(hit.id)
          const hp = enemy.hp - 1
          if (hp <= 0) {
            killed += 1
            return []
          }
          return [{ ...enemy, x, y, hp }]
        }
        if (y > 91) {
          leaksRef.current += 1
          return []
        }
        return [{ ...enemy, x, y }]
      })
      if (killed) {
        stopsRef.current += killed
        setStops(stopsRef.current)
        publish()
      }
      if (leaksRef.current !== leaks) {
        setLeaks(leaksRef.current)
        sfx.error()
        if (leaksRef.current >= 3) {
          endedRef.current = true
          onGameOver()
          return
        }
      }
      bulletsRef.current = movedBullets.filter((bullet) => !usedBullets.has(bullet.id))
      enemiesRef.current = movedEnemies
      setBullets(bulletsRef.current)
      setEnemies(movedEnemies)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      cancelAnimationFrame(frame)
    }
  }, [leaks, onGameOver, publish, ready])

  return (
    <FieldChrome tone={tone}>
      <CountOverlay value={countdown} />
      <div className="survival-mode-life">{[0, 1, 2].map((i) => <i key={i} className={i < leaks ? 'is-lost' : ''} />)}</div>
      <div className="survival-mode-hint">Déplace le défenseur, bloque les vagues. 3 passages = terminé.</div>
      <div style={{ position: 'absolute', top: '18%', left: 0, right: 0, zIndex: 7, textAlign: 'center', font: '900 20px Barlow Condensed', color: tone, textShadow: `0 0 18px ${tone}` }}>STOPS {stops}</div>
      <div
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          playerXRef.current = clamp((event.clientX - rect.left) / rect.width * 100, 8, 92)
          setPlayerX(playerXRef.current)
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1 && event.pointerType !== 'touch') return
          const rect = event.currentTarget.getBoundingClientRect()
          playerXRef.current = clamp((event.clientX - rect.left) / rect.width * 100, 8, 92)
          setPlayerX(playerXRef.current)
        }}
        style={{ position: 'absolute', inset: 0, zIndex: 5 }}
      />
      <div style={{ position: 'absolute', left: `${playerX}%`, top: '86%', width: 46, height: 54, transform: 'translate(-50%,-50%)', borderRadius: 16, background: tone, boxShadow: `0 0 24px ${tone}` }} />
      {bullets.map((bullet) => <i key={bullet.id} style={{ position: 'absolute', left: `${bullet.x}%`, top: `${bullet.y}%`, width: 8, height: 16, borderRadius: 999, background: '#fff', boxShadow: `0 0 14px ${tone}`, transform: 'translate(-50%,-50%)' }} />)}
      {enemies.map((enemy) => <div key={enemy.id} style={{ position: 'absolute', left: `${enemy.x}%`, top: `${enemy.y}%`, width: enemy.kind === 'tank' ? 52 : 38, height: enemy.kind === 'tank' ? 62 : 48, transform: 'translate(-50%,-50%)', borderRadius: 14, background: enemyTone, boxShadow: `0 0 18px ${enemyTone}`, border: '2px solid rgba(255,255,255,.8)' }}><span style={{ position: 'absolute', inset: -8, display: enemy.maxHp > 1 ? 'block' : 'none', color: '#fff', font: '900 10px Barlow Condensed', textAlign: 'center' }}>{enemy.hp}/{enemy.maxHp}</span></div>)}
    </FieldChrome>
  )
}

export function FruitSurvival({ opponentKit, keeperName, onGameplayStart, onStats, onGameOver }: CommonProps) {
  const [objects, setObjects] = useState<SliceObject[]>([])
  const [misses, setMisses] = useState(0)
  const [cuts, setCuts] = useState(0)
  const objectsRef = useRef<SliceObject[]>([])
  const cutsRef = useRef(0)
  const missesRef = useRef(0)
  const startRef = useRef(0)
  const lastSpawnRef = useRef(0)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const endedRef = useRef(false)
  const { countdown, ready } = useCountdown(onGameplayStart)
  const tone = '#2bff9a'
  const enemyTone = opponentKit?.primary ?? '#FF4455'

  const publish = useCallback(() => onStats?.({ units: cutsRef.current, score: cutsRef.current * 105 }), [onStats])

  useEffect(() => {
    let frame = 0
    let prev = 0
    const tick = (now: number) => {
      if (!ready || endedRef.current) { frame = requestAnimationFrame(tick); return }
      if (!startRef.current) startRef.current = now
      if (!prev) prev = now
      const dt = Math.min(48, now - prev)
      prev = now
      const seconds = (now - startRef.current) / 1000
      const spawnEvery = Math.max(250, 1120 - seconds * 24)
      if (now - lastSpawnRef.current > spawnEvery) {
        lastSpawnRef.current = now
        const count = seconds < 10 ? 1 : 1 + Math.floor(Math.random() * Math.min(4, 1 + seconds / 24))
        objectsRef.current = [...objectsRef.current, ...Array.from({ length: count }, () => ({
          id: crypto.randomUUID(),
          x: rand(12, 88),
          y: 112,
          vx: rand(-10, 10) + seconds * rand(-0.08, 0.08),
          vy: -(rand(42, 58) + seconds * 0.48),
          kind: Math.random() < Math.min(0.22, seconds / 180) ? 'bomb' as const : 'ball' as const,
          speed: 1,
        }))]
      }
      const next = objectsRef.current.flatMap((item) => {
        const x = item.x + item.vx * dt / 1000
        const y = item.y + item.vy * dt / 1000
        if (y < -12) {
          if (item.kind === 'ball') missesRef.current += 1
          return []
        }
        return [{ ...item, x, y }]
      })
      if (missesRef.current !== misses) {
        setMisses(missesRef.current)
        if (missesRef.current >= 3) {
          endedRef.current = true
          onGameOver()
          return
        }
      }
      objectsRef.current = next
      setObjects(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [misses, onGameOver, ready])

  const slashAt = (x: number, y: number, px: number, py: number) => {
    const hitIds = new Set<string>()
    objectsRef.current.forEach((item) => {
      const d = Math.abs((py - y) * item.x - (px - x) * item.y + px * y - py * x) / Math.max(1, Math.hypot(py - y, px - x))
      if (d < 7 && item.x >= Math.min(x, px) - 6 && item.x <= Math.max(x, px) + 6 && item.y >= Math.min(y, py) - 6 && item.y <= Math.max(y, py) + 6) {
        if (item.kind === 'bomb') {
          missesRef.current = 3
          endedRef.current = true
          onGameOver()
        } else {
          hitIds.add(item.id)
        }
      }
    })
    if (hitIds.size) {
      cutsRef.current += hitIds.size
      setCuts(cutsRef.current)
      publish()
      objectsRef.current = objectsRef.current.filter((item) => !hitIds.has(item.id))
      setObjects(objectsRef.current)
    }
  }

  return (
    <FieldChrome tone={tone}>
      <CountOverlay value={countdown} />
      <div className="survival-mode-life">{[0, 1, 2].map((i) => <i key={i} className={i < misses ? 'is-lost' : ''} />)}</div>
      <div className="survival-mode-hint">{keeperName ?? 'Gardien'} : swipe les ballons. Bombe ou 3 ratés = terminé.</div>
      <div style={{ position: 'absolute', top: '18%', left: 0, right: 0, zIndex: 7, textAlign: 'center', font: '900 20px Barlow Condensed', color: tone, textShadow: `0 0 18px ${tone}` }}>BALLONS {cuts}</div>
      <div onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); pointerRef.current = { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 } }} onPointerMove={(e) => { if (!pointerRef.current) return; const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 100; const y = (e.clientY - r.top) / r.height * 100; slashAt(pointerRef.current.x, pointerRef.current.y, x, y); pointerRef.current = { x, y } }} onPointerUp={() => { pointerRef.current = null }} onPointerCancel={() => { pointerRef.current = null }} style={{ position: 'absolute', inset: 0 }} />
      {objects.map((item) => <i key={item.id} style={{ position: 'absolute', left: `${item.x}%`, top: `${item.y}%`, width: item.kind === 'bomb' ? 42 : 36, height: item.kind === 'bomb' ? 42 : 36, borderRadius: '50%', background: item.kind === 'bomb' ? '#FF1F2D' : '#fff', border: `4px solid ${item.kind === 'bomb' ? '#fff' : '#101827'}`, boxShadow: `0 0 18px ${item.kind === 'bomb' ? '#FF4455' : enemyTone}`, transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} />)}
    </FieldChrome>
  )
}

export function GoalSaveSurvival({ playerKit, keeperName, onGameplayStart, onStats, onGameOver }: CommonProps) {
  const [ball, setBall] = useState<SaveBall | null>(null)
  const [saves, setSaves] = useState(0)
  const ballRef = useRef<SaveBall | null>(null)
  const savesRef = useRef(0)
  const startRef = useRef(0)
  const spawnAtRef = useRef(0)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const endedRef = useRef(false)
  const { countdown, ready } = useCountdown(onGameplayStart)
  const tone = playerKit?.primary ?? '#2bff9a'
  const publish = useCallback(() => onStats?.({ units: savesRef.current, score: savesRef.current * 150 }), [onStats])

  const spawn = useCallback((now: number) => {
    const seconds = (now - startRef.current) / 1000
    const diagonal = Math.min(34, 6 + seconds * 0.18)
    const fromLeft = Math.random() < 0.5
    const startX = fromLeft ? rand(8, 34) : rand(66, 92)
    const endX = clamp(startX + (fromLeft ? diagonal : -diagonal) + rand(-8, 8), 14, 86)
    const speed = 34 + seconds * 0.52
    ballRef.current = { id: crypto.randomUUID(), x: startX, y: 3, vx: (endX - startX) * 0.36, vy: speed, speed }
    setBall(ballRef.current)
  }, [])

  useEffect(() => {
    let frame = 0
    let prev = 0
    const tick = (now: number) => {
      if (!ready || endedRef.current) { frame = requestAnimationFrame(tick); return }
      if (!startRef.current) startRef.current = now
      if (!prev) prev = now
      const dt = Math.min(48, now - prev)
      prev = now
      if (!ballRef.current && now >= spawnAtRef.current) spawn(now)
      if (ballRef.current) {
        const next = { ...ballRef.current, x: ballRef.current.x + ballRef.current.vx * dt / 1000, y: ballRef.current.y + ballRef.current.vy * dt / 1000 }
        if (next.y >= 94) {
          endedRef.current = true
          onGameOver()
          return
        }
        ballRef.current = next
        setBall(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [onGameOver, ready, spawn])

  const test = (x1: number, y1: number, x2: number, y2: number) => {
    const current = ballRef.current
    if (!current) return
    const d = Math.abs((y2 - y1) * current.x - (x2 - x1) * current.y + x2 * y1 - y2 * x1) / Math.max(1, Math.hypot(y2 - y1, x2 - x1))
    if (d < 7) {
      savesRef.current += 1
      setSaves(savesRef.current)
      publish()
      ballRef.current = null
      setBall(null)
      spawnAtRef.current = performance.now() + Math.max(280, 920 - savesRef.current * 12)
    }
  }

  return (
    <FieldChrome tone={tone}>
      <CountOverlay value={countdown} />
      <div className="survival-mode-hint">{keeperName ?? 'Gardien'} : les ballons arrivent un par un, de plus en plus vite et en diagonale.</div>
      <div onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); pointerRef.current = { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 } }} onPointerMove={(e) => { if (!pointerRef.current) return; const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 100; const y = (e.clientY - r.top) / r.height * 100; test(pointerRef.current.x, pointerRef.current.y, x, y); pointerRef.current = { x, y } }} onPointerUp={() => { pointerRef.current = null }} onPointerCancel={() => { pointerRef.current = null }} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '2%', height: '20%', border: '3px solid rgba(255,255,255,.82)', borderBottomWidth: 7, borderRadius: '18px 18px 0 0' }} />
      {ball ? <i style={{ position: 'absolute', left: `${ball.x}%`, top: `${ball.y}%`, width: 38 + Math.min(24, ball.y * 0.22), height: 38 + Math.min(24, ball.y * 0.22), borderRadius: '50%', background: '#fff', border: '4px solid #101827', boxShadow: `0 0 18px ${tone}`, transform: 'translate(-50%,-50%)' }} /> : null}
      <div style={{ position: 'absolute', top: '18%', left: 0, right: 0, textAlign: 'center', font: '900 20px Barlow Condensed', color: tone, textShadow: `0 0 18px ${tone}` }}>ARRÊTS {saves}</div>
    </FieldChrome>
  )
}
