import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import type { BattleDifficulty, BattleScorer, DefenseOutcome, Team } from '../types'
import { resolveTeamKit } from '../lib/teamKits'
import { splitTeamPlayerRoles } from '../lib/playerRoles'
import { setGameAudioVolume, setGameMuted, useGameAudio, useGameAudioVolume, useGameMuted } from '../lib/useGameAudio'
import { sfx } from '../lib/sfx'
import AttackPhase, { type AttackEndReason, type ShotPrecisionBonus, type SurvivalDribbleStats } from '../components/battle/AttackPhase'
import DefensePhase from '../components/battle/DefensePhase'
import FruitNinjaPhase from '../components/battle/FruitNinjaPhase'
import GoalSave from '../components/battle/GoalSave'

type SurvivalMiniStats = {
  units: number
  score: number
}

type SurvivalShotStats = {
  precisionScore: number
  multiplierTotal: number
}

type SurvivalGameId = 'attack' | 'shot' | 'defense' | 'fruit_ninja' | 'goal_save'

type SurvivalScore = {
  id: string
  gameId: SurvivalGameId
  pseudo: string
  score: number
  seconds: number
  rounds: number
  createdAt: string
}

type SurvivalGame = {
  id: SurvivalGameId
  title: string
  short: string
  hook: string
  ramp: string
  accent: string
  icon: 'boot' | 'target' | 'shield' | 'slash' | 'glove'
}

type SurvivalArcadeProps = {
  teamsById: Map<string, Team>
  playerName?: string
  onBack: () => void
}

const STORAGE_KEY = 'brakup:survival-scores'
const GAMES: SurvivalGame[] = [
  { id: 'attack', title: 'Attaque seule', short: 'ATT', hook: 'Dribble sans fin.', ramp: 'Portes plus serrées, défenseurs plus rapides, bonus pénalisants.', accent: '#2bff9a', icon: 'boot' },
  { id: 'shot', title: 'Phase de tir seule', short: 'TIR', hook: 'Un tir, pas de slalom.', ramp: 'Gardien plus vif, jauge plus courte, timing plus strict.', accent: '#FFB800', icon: 'target' },
  { id: 'defense', title: 'Défense seule', short: 'DEF', hook: 'Stoppe les attaquants.', ramp: 'Courses plus rapides, profils géants et zigzags plus fréquents.', accent: '#19d3ff', icon: 'shield' },
  { id: 'fruit_ninja', title: 'Tirs massifs', short: 'TM', hook: 'Swipe les ballons, évite les bombes.', ramp: 'Plus de ballons, trajectoires plus rapides, bombes plus présentes.', accent: '#FF4455', icon: 'slash' },
  { id: 'goal_save', title: 'Goal save', short: 'GK', hook: 'Sauve les frappes sur la ligne.', ramp: 'Plus de ballons, trajectoires courbes, fenêtre de swipe réduite.', accent: '#bdfcff', icon: 'glove' },
]

const CAROUSEL_LOOP_OFFSET = GAMES.length
const CAROUSEL_ITEMS = [...GAMES, ...GAMES, ...GAMES].map((game, index) => ({
  game,
  realIndex: index % GAMES.length,
  virtualIndex: index,
}))

const DIFFICULTY_META: Record<BattleDifficulty, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Hard',
}

function readScores(): SurvivalScore[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SurvivalScore => {
      const row = item as Partial<SurvivalScore>
      return typeof row.id === 'string'
        && GAMES.some((game) => game.id === row.gameId)
        && typeof row.pseudo === 'string'
        && typeof row.score === 'number'
        && typeof row.seconds === 'number'
        && typeof row.rounds === 'number'
        && typeof row.createdAt === 'string'
    })
  } catch {
    return []
  }
}

function writeScores(scores: SurvivalScore[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, 120)))
  } catch {
    // Local scores are optional.
  }
}

function difficultyForLevel(level: number): BattleDifficulty {
  if (level < 2) return 'easy'
  if (level < 5) return 'medium'
  return 'hard'
}

function difficultyForAttackWaves(waves: number): BattleDifficulty {
  if (waves < 28) return 'easy'
  if (waves < 78) return 'medium'
  return 'hard'
}

function difficultyForSurvivalUnits(units: number): BattleDifficulty {
  if (units < 18) return 'easy'
  if (units < 52) return 'medium'
  return 'hard'
}

function scoreFor(seconds: number, rounds: number, level: number) {
  return Math.round(seconds * 10 + rounds * 180 + level * 45)
}

function scoreForAttackSurvival(seconds: number, stats: SurvivalDribbleStats) {
  return Math.max(0, Math.round(seconds * 10 + stats.score))
}

function scoreForMiniSurvival(seconds: number, stats: SurvivalMiniStats) {
  return Math.max(0, Math.round(seconds * 10 + stats.score))
}

function scoreForShotSurvival(goals: number, stats: SurvivalShotStats) {
  if (goals <= 0) return 0
  return Math.max(0, Math.round(goals * 1000 + goals * goals * 130 + stats.precisionScore * stats.multiplierTotal))
}

function splitPlayers(team?: Team) {
  const roles = splitTeamPlayerRoles(team)
  return {
    attackers: roles.attackers.length ? roles.attackers : ['Buteur'],
    defenders: roles.defenders.length ? roles.defenders : ['Defenseur'],
    keeper: roles.keepers[0] ?? 'Gardien',
  }
}

function pickArcadeTeams(teamsById: Map<string, Team>) {
  const preferredHome = teamsById.get('FRA') ?? teamsById.get('BRA') ?? teamsById.values().next().value
  const preferredAway = teamsById.get('ARG') ?? teamsById.get('ENG') ?? [...teamsById.values()].find((team) => team.id !== preferredHome?.id)
  return {
    home: preferredHome as Team | undefined,
    away: preferredAway as Team | undefined,
  }
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function unitLabel(gameId: SurvivalGameId, count: number) {
  if (gameId === 'attack') return `${count} vagues`
  if (gameId === 'shot') return `${count} buts d'affilée`
  if (gameId === 'defense') return `${count} stops`
  if (gameId === 'fruit_ninja') return `${count} ballons`
  if (gameId === 'goal_save') return `${count} arrêts`
  return `${count} manches`
}

function MiniGameCrest({ game }: { game: SurvivalGame }) {
  return (
    <svg className="survival-crest" viewBox="0 0 96 112" aria-hidden="true">
      <path className="survival-crest__plate" d="M48 5 84 18v35c0 26-16 43-36 54C28 96 12 79 12 53V18Z" fill={game.accent} />
      <path d="M48 12 77 23v30c0 21-12 35-29 45C31 88 19 74 19 53V23Z" fill="rgba(3,9,18,.82)" />
      <g className="survival-crest__fireball">
        <path className="survival-crest__flame survival-crest__flame--back" d="M31 57c-6-15 1-25 11-31-1 8 6 12 8 19 4-8 12-13 20-15-4 11 4 17 3 29-1 17-14 29-29 28-12-1-22-11-13-30Z" fill="#FF4455" />
        <path className="survival-crest__flame survival-crest__flame--mid" d="M36 60c-3-11 3-18 11-24 1 8 8 11 9 19 3-5 7-8 12-10-1 9 2 12 1 20-1 11-10 19-21 19-10 0-17-8-12-24Z" fill="#FFB800" />
        <path className="survival-crest__flame survival-crest__flame--front" d="M43 64c-1-7 4-11 8-15 1 6 5 8 6 14 2-3 4-5 7-6 1 12-6 20-14 20-6 0-10-5-7-13Z" fill="#fff4a8" />
        <g className="survival-crest__ball">
          <circle cx="48" cy="58" r="18" fill="#f8fbff" stroke="#08111f" strokeWidth="4" />
          <path d="M48 46 57 53 54 64H42L39 53Z" fill="#08111f" />
          <path d="M48 40v6M57 53l8-4M54 64l6 8M42 64l-6 8M39 53l-8-4" stroke="#08111f" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="42" cy="50" r="3" fill="rgba(255,255,255,.7)" />
        </g>
      </g>
    </svg>
  )
}

export function SurvivalArcade({ teamsById, playerName, onBack }: SurvivalArcadeProps) {
  const [selectedId, setSelectedId] = useState<SurvivalGameId>('attack')
  const [mode, setMode] = useState<'menu' | 'playing' | 'result'>('menu')
  const [runKey, setRunKey] = useState(0)
  const [level, setLevel] = useState(0)
  const [rounds, setRounds] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [attackDribbleStats, setAttackDribbleStats] = useState<SurvivalDribbleStats>({ waves: 0, combo: 0, bonusesUsed: 0, goldenBalls: 0, score: 0 })
  const [miniStats, setMiniStats] = useState<SurvivalMiniStats>({ units: 0, score: 0 })
  const [shotStats, setShotStats] = useState<SurvivalShotStats>({ precisionScore: 0, multiplierTotal: 1 })
  const [shotStreakShooterName, setShotStreakShooterName] = useState<string | null>(null)
  const [lastScore, setLastScore] = useState<SurvivalScore | null>(null)
  const [scores, setScores] = useState<SurvivalScore[]>(readScores)
  const [audioOverride, setAudioOverride] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const savedRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])
  const dragRef = useRef({ active: false, startX: 0, baseX: 0, lastX: 0, lastAt: 0, velocity: 0 })
  const carouselIndexRef = useRef(CAROUSEL_LOOP_OFFSET)
  const [carouselIndex, setCarouselIndex] = useState(CAROUSEL_LOOP_OFFSET)
  const selected = GAMES.find((game) => game.id === selectedId) ?? GAMES[0]
  const selectedIndex = Math.max(0, GAMES.findIndex((game) => game.id === selectedId))
  const difficulty = difficultyForLevel(level)
  const displayedDifficulty = selectedId === 'attack'
    ? difficultyForAttackWaves(attackDribbleStats.waves)
    : selectedId === 'defense' || selectedId === 'fruit_ninja' || selectedId === 'goal_save'
      ? difficultyForSurvivalUnits(miniStats.units)
      : difficulty
  const usesDirectSurvivalStats = selectedId === 'attack' || selectedId === 'defense' || selectedId === 'fruit_ninja' || selectedId === 'goal_save'
  const score = selectedId === 'attack'
    ? scoreForAttackSurvival(elapsed, attackDribbleStats)
    : selectedId === 'shot'
      ? scoreForShotSurvival(rounds, shotStats)
    : usesDirectSurvivalStats
      ? scoreForMiniSurvival(elapsed, miniStats)
      : scoreFor(elapsed, rounds, level)
  const { home, away } = useMemo(() => pickArcadeTeams(teamsById), [teamsById])
  const homeRoles = useMemo(() => splitPlayers(home), [home])
  const awayRoles = useMemo(() => splitPlayers(away), [away])
  const homeKit = useMemo(() => resolveTeamKit(home, home?.id), [home])
  const awayKit = useMemo(() => resolveTeamKit(away, away?.id), [away])
  const leaderboard = scores.filter((item) => item.gameId === selectedId).sort((a, b) => b.score - a.score).slice(0, 5)
  const audioSrc = audioOverride ?? (mode === 'playing' ? '/audio/kickoff-carnival.mp3' : '/audio/kickoff-carnival.mp3')
  const audioMuted = useGameMuted()
  const audioVolume = useGameAudioVolume()
  useGameAudio(audioSrc)

  const carouselMetrics = useCallback(() => {
    const viewport = viewportRef.current
    const firstCard = cardRefs.current[0]
    if (!viewport || !firstCard) return null
    const gap = 14
    const cardWidth = firstCard.offsetWidth
    const step = cardWidth + gap
    const centerOffset = viewport.clientWidth / 2 - cardWidth / 2
    return { cardWidth, step, centerOffset }
  }, [])

  const paintCarousel = useCallback((activeIndex: number) => {
    cardRefs.current.forEach((card, index) => {
      if (!card) return
      const distance = Math.abs(index - activeIndex)
      const direction = index === activeIndex ? 0 : index < activeIndex ? -1 : 1
      gsap.to(card, {
        y: distance === 0 ? -12 : distance === 1 ? 8 : 20,
        scale: distance === 0 ? 1 : distance === 1 ? 0.88 : 0.76,
        rotate: direction === 0 ? 0 : direction < 0 ? -5 : 5,
        opacity: distance > 1 ? 0.52 : 1,
        duration: 0.46,
        ease: 'back.out(1.7)',
        overwrite: true,
      })
    })
  }, [])

  const snapCarousel = useCallback((index: number, velocity = 0, immediate = false) => {
    const metrics = carouselMetrics()
    const track = trackRef.current
    if (!metrics || !track) return
    const realIndex = ((index % GAMES.length) + GAMES.length) % GAMES.length
    let targetIndex = index
    while (targetIndex < 0) targetIndex += GAMES.length
    while (targetIndex >= CAROUSEL_ITEMS.length) targetIndex -= GAMES.length
    const x = metrics.centerOffset - targetIndex * metrics.step
    carouselIndexRef.current = targetIndex
    setCarouselIndex(targetIndex)
    setSelectedId(GAMES[realIndex].id)
    const recenter = () => {
      if (targetIndex >= CAROUSEL_LOOP_OFFSET && targetIndex < CAROUSEL_LOOP_OFFSET + GAMES.length) return
      const centeredIndex = CAROUSEL_LOOP_OFFSET + realIndex
      const centeredX = metrics.centerOffset - centeredIndex * metrics.step
      carouselIndexRef.current = centeredIndex
      setCarouselIndex(centeredIndex)
      gsap.set(track, { x: centeredX })
      paintCarousel(centeredIndex)
    }
    if (immediate) {
      gsap.set(track, { x })
      paintCarousel(targetIndex)
      recenter()
      return
    }
    gsap.to(track, {
      x,
      duration: Math.min(0.78, 0.44 + Math.abs(velocity) * 0.0012),
      ease: 'elastic.out(1, 0.72)',
      overwrite: true,
      onComplete: recenter,
    })
    paintCarousel(targetIndex)
  }, [carouselMetrics, paintCarousel])

  useEffect(() => {
    if (mode !== 'menu') return
    const id = window.requestAnimationFrame(() => snapCarousel(CAROUSEL_LOOP_OFFSET + selectedIndex, 0, true))
    const onResize = () => snapCarousel(carouselIndexRef.current, 0, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('resize', onResize)
    }
  }, [mode, snapCarousel])

  const handleCarouselDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'menu') return
    const track = trackRef.current
    if (!track) return
    const currentX = Number(gsap.getProperty(track, 'x')) || 0
    dragRef.current = { active: true, startX: event.clientX, baseX: currentX, lastX: event.clientX, lastAt: performance.now(), velocity: 0 }
    gsap.killTweensOf(track)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* noop */ }
  }

  const handleCarouselMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag.active) return
    const track = trackRef.current
    if (!track) return
    const now = performance.now()
    const dx = event.clientX - drag.startX
    const dt = Math.max(16, now - drag.lastAt)
    drag.velocity = (event.clientX - drag.lastX) / dt
    drag.lastX = event.clientX
    drag.lastAt = now
    gsap.set(track, { x: drag.baseX + dx })
  }

  const handleCarouselUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag.active) return
    const metrics = carouselMetrics()
    const track = trackRef.current
    drag.active = false
    if (!metrics || !track) return
    const x = Number(gsap.getProperty(track, 'x')) || 0
    const projected = x + drag.velocity * 220
    const rawIndex = (metrics.centerOffset - projected) / metrics.step
    snapCarousel(Math.round(rawIndex), drag.velocity)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* noop */ }
  }

  useEffect(() => {
    if (mode !== 'playing' || startedAt === null) return
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((performance.now() - startedAt) / 1000)))
    }, 250)
    return () => window.clearInterval(id)
  }, [mode, startedAt])

  const start = useCallback((gameId = selectedId) => {
    sfx.start()
    setSelectedId(gameId)
    setMode('playing')
    setLevel(0)
    setRounds(0)
    setElapsed(0)
    setAttackDribbleStats({ waves: 0, combo: 0, bonusesUsed: 0, goldenBalls: 0, score: 0 })
    setMiniStats({ units: 0, score: 0 })
    setShotStats({ precisionScore: 0, multiplierTotal: 1 })
    setShotStreakShooterName((current) => gameId === 'shot' ? current : null)
    setStartedAt(null)
    setRunKey((value) => value + 1)
    setLastScore(null)
    savedRef.current = false
  }, [selectedId])

  const armGameplayTimer = useCallback(() => {
    if (mode !== 'playing') return
    setStartedAt((current) => current ?? performance.now())
  }, [mode])

  const continueRun = useCallback(() => {
    setRounds((value) => value + 1)
    setLevel((value) => value + 1)
    setRunKey((value) => value + 1)
  }, [])

  const endRun = useCallback(() => {
    if (savedRef.current) return
    savedRef.current = true
    const finalSeconds = startedAt === null ? elapsed : Math.max(elapsed, Math.floor((performance.now() - startedAt) / 1000))
    const finalRounds = selectedId === 'attack' ? attackDribbleStats.waves : usesDirectSurvivalStats ? miniStats.units : rounds
    const finalScoreValue = selectedId === 'attack'
      ? scoreForAttackSurvival(finalSeconds, attackDribbleStats)
      : selectedId === 'shot'
        ? scoreForShotSurvival(rounds, shotStats)
      : usesDirectSurvivalStats
        ? scoreForMiniSurvival(finalSeconds, miniStats)
      : scoreFor(finalSeconds, rounds, level)
    const finalScore: SurvivalScore = {
      id: crypto.randomUUID(),
      gameId: selectedId,
      pseudo: playerName?.trim() || 'Invite',
      score: finalScoreValue,
      seconds: finalSeconds,
      rounds: finalRounds,
      createdAt: new Date().toISOString(),
    }
    const nextScores = [finalScore, ...scores].sort((a, b) => b.score - a.score)
    setScores(nextScores)
    writeScores(nextScores)
    setLastScore(finalScore)
    setElapsed(finalSeconds)
    setMode('result')
    setAudioOverride(null)
  }, [attackDribbleStats, elapsed, level, miniStats, playerName, rounds, scores, selectedId, shotStats, startedAt, usesDirectSurvivalStats])

  const handleAttackEnd = (isGoal: boolean, reason?: AttackEndReason, scorer?: BattleScorer) => {
    if (selectedId === 'attack') {
      endRun()
      return
    }
    if (selectedId === 'shot' && scorer?.name) {
      setShotStreakShooterName(scorer.name)
    }
    if (isGoal && reason === 'goal') {
      setShotStreakShooterName((current) => current ?? scorer?.name ?? null)
      continueRun()
      return
    }
    endRun()
  }

  const handleShotPrecisionBonus = useCallback((bonus: ShotPrecisionBonus) => {
    setShotStats((current) => ({
      precisionScore: current.precisionScore + bonus.points,
      multiplierTotal: Math.round((current.multiplierTotal + bonus.multiplier) * 10) / 10,
    }))
  }, [])

  const handleDefenseEnd = (outcome: DefenseOutcome) => {
    const blocked = outcome.blocked ?? 0
    setMiniStats({ units: blocked, score: blocked * 130 })
    if (outcome.path === 'goal_save' ? outcome.saved : blocked >= Math.max(1, outcome.total)) continueRun()
    else endRun()
  }

  const handleFruitEnd = (saved: boolean) => {
    setMiniStats((current) => {
      const units = current.units + (saved ? 1 : 0)
      return { units, score: units * 240 }
    })
    if (saved) continueRun()
    else endRun()
  }

  const handleGoalSaveEnd = (saved: boolean) => {
    setMiniStats((current) => {
      const units = current.units + (saved ? 1 : 0)
      return { units, score: units * 220 }
    })
    if (saved) continueRun()
    else endRun()
  }

  const activeGame = selectedId

  return (
    <main className={`survival-arcade is-${mode}`}>
      <style>{`
        .survival-arcade{position:fixed;inset:0;width:100vw;height:100dvh;background:radial-gradient(circle at 50% 0,rgba(43,255,154,.16),transparent 28%),linear-gradient(180deg,#061426,#050812 58%,#030509);color:#fff;font-family:'Barlow Condensed',sans-serif;overflow:hidden;display:grid;place-items:center}
        .survival-menu{position:relative;width:min(100vw,calc(100dvh * 9 / 16));height:min(100dvh,calc(100vw * 16 / 9));max-width:480px;max-height:854px;overflow:hidden;padding:max(58px,calc(env(safe-area-inset-top) + 50px)) 0 max(100px,calc(env(safe-area-inset-bottom) + 92px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:12px;background:radial-gradient(circle at 50% 14%,rgba(255,184,0,.18),transparent 25%),linear-gradient(180deg,rgba(8,18,32,.9),rgba(3,5,9,.96));box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 70px rgba(0,0,0,.44)}
        .survival-menu:before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 1px,transparent 1px 22px);pointer-events:none}.survival-ui-menu{position:absolute;z-index:8;top:max(12px,env(safe-area-inset-top));right:12px;width:42px;height:42px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:rgba(2,8,16,.58);color:#fff;display:grid;place-items:center;gap:3px;backdrop-filter:blur(8px)}.survival-ui-menu i{width:18px;height:2px;border-radius:99px;background:currentColor;display:block}.survival-back,.survival-ghost{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;border-radius:12px;padding:9px 12px;font:900 12px 'Barlow Condensed';letter-spacing:.12em;text-transform:uppercase;backdrop-filter:blur(8px)}.survival-title{position:relative;z-index:2;text-align:center;padding:0 20px}.survival-title h1{margin:0;font:900 clamp(38px,12vw,62px) 'Barlow Condensed';letter-spacing:.08em;text-transform:uppercase}.survival-title p{margin:3px auto 0;max-width:310px;color:rgba(255,255,255,.68);font:700 12px/1.25 Barlow,sans-serif}.survival-carousel-viewport{position:relative;z-index:2;overflow:hidden;touch-action:pan-y;cursor:grab;display:grid;align-items:center}.survival-carousel-viewport:active{cursor:grabbing}.survival-carousel-track{display:flex;gap:14px;align-items:center;will-change:transform;padding:28px 0 18px}.survival-card{flex:0 0 min(68vw,270px);height:min(48dvh,390px);max-height:390px;min-height:330px;border:1px solid rgba(255,255,255,.14);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,.035));color:#fff;text-align:center;padding:18px 16px;display:grid;grid-template-rows:auto auto auto minmax(0,1fr);justify-items:center;gap:10px;box-shadow:0 18px 40px rgba(0,0,0,.34);transform-origin:center bottom;will-change:transform,opacity}.survival-card.is-active{border-color:var(--accent);box-shadow:0 0 34px color-mix(in srgb,var(--accent) 34%,transparent),0 24px 52px rgba(0,0,0,.4)}.survival-crest{width:min(42vw,142px);max-width:142px;filter:drop-shadow(0 14px 18px rgba(0,0,0,.42)) drop-shadow(0 0 18px color-mix(in srgb,var(--accent) 42%,transparent))}.survival-crest__plate{filter:drop-shadow(0 0 16px color-mix(in srgb,var(--accent) 64%,transparent))}.survival-crest__fireball{transform-box:fill-box;transform-origin:center bottom;animation:survivalFireballBounce .72s cubic-bezier(.34,.02,.64,1) infinite alternate}.survival-crest__ball{transform-box:fill-box;transform-origin:center;animation:survivalBallSpin 1.15s linear infinite;filter:drop-shadow(0 0 12px rgba(255,184,0,.8))}.survival-crest__flame{transform-box:fill-box;transform-origin:center bottom;filter:drop-shadow(0 0 10px rgba(255,68,85,.78))}.survival-crest__flame--back{animation:survivalFlameBack .34s ease-in-out infinite alternate}.survival-crest__flame--mid{animation:survivalFlameMid .28s ease-in-out infinite alternate}.survival-crest__flame--front{animation:survivalFlameFront .22s ease-in-out infinite alternate}.survival-card h2{margin:0;font:900 30px/1 'Barlow Condensed';letter-spacing:.05em;text-transform:uppercase}.survival-card p{margin:0;color:rgba(255,255,255,.82);font:800 13px/1.28 Barlow,sans-serif}.survival-card small{align-self:end;color:rgba(255,255,255,.56);font:800 11px/1.25 Barlow,sans-serif}.survival-board{position:relative;z-index:2;margin:0 14px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(2,8,16,.54);padding:10px 12px;min-height:126px;max-height:150px;overflow:hidden}.survival-board h3{margin:0 0 5px;font:900 13px 'Barlow Condensed';letter-spacing:.14em;color:#2bff9a;text-transform:uppercase}.survival-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:center;padding:5px 0;border-top:1px solid rgba(255,255,255,.06)}.survival-row:first-of-type{border-top:0}.survival-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.survival-row span{font:800 11px Barlow;color:rgba(255,255,255,.58)}.survival-row b{font:900 14px 'JetBrains Mono',monospace;color:#FFB800}.survival-start{position:absolute;z-index:7;left:14px;right:14px;bottom:max(18px,calc(env(safe-area-inset-bottom) + 14px));width:auto;min-height:64px;border:0;border-radius:18px;background:linear-gradient(180deg,#7dffc4,#2bff9a);color:#03120a;font:900 24px 'Barlow Condensed';letter-spacing:.16em;text-transform:uppercase;box-shadow:0 0 34px rgba(43,255,154,.45),0 16px 34px rgba(0,0,0,.38)}
        .survival-start small{display:block;font:800 10px Barlow,sans-serif;letter-spacing:.12em;opacity:.68}
        .survival-stage{position:fixed;inset:0;z-index:80;background:radial-gradient(circle at 50% 0,rgba(43,255,154,.12),transparent 32%),#030509;display:grid;place-items:center}.survival-game-frame{position:relative;width:min(100vw,calc(100dvh * 9 / 16));height:min(100dvh,calc(100vw * 16 / 9));max-width:480px;max-height:854px;overflow:hidden;background:#030509;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 70px rgba(0,0,0,.5)}.survival-hud{position:absolute;z-index:1301;top:max(10px,env(safe-area-inset-top));left:10px;right:10px;display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;pointer-events:none}.survival-hud button{pointer-events:auto}.survival-pill{min-width:0;padding:8px 10px;border:1px solid rgba(255,255,255,.16);border-radius:13px;background:rgba(2,8,16,.64);backdrop-filter:blur(8px);display:grid;gap:1px}.survival-pill span{font:800 9px Barlow,sans-serif;letter-spacing:.14em;color:rgba(255,255,255,.54);text-transform:uppercase}.survival-pill strong{font:900 18px 'Barlow Condensed';line-height:1;color:#fff}.survival-pill em{display:block;margin-top:2px;color:#2bff9a;font:900 10px 'Barlow Condensed';letter-spacing:.12em;text-transform:uppercase;font-style:normal;text-shadow:0 0 12px rgba(43,255,154,.5)}.survival-pill.is-score{text-align:right}.survival-result{width:min(100vw,calc(100dvh * 9 / 16));height:min(100dvh,calc(100vw * 16 / 9));max-width:480px;max-height:854px;padding:max(86px,calc(env(safe-area-inset-top) + 78px)) 18px max(26px,env(safe-area-inset-bottom));display:grid;align-content:center;gap:16px;background:linear-gradient(180deg,#081426,#030509)}.survival-result__panel{border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(2,8,16,.72);padding:20px;text-align:center;box-shadow:0 22px 48px rgba(0,0,0,.34)}.survival-result h1{margin:0;color:#FF4455;font:900 clamp(46px,15vw,80px) 'Barlow Condensed';letter-spacing:.1em}.survival-result strong{display:block;color:#FFB800;font:900 44px 'JetBrains Mono',monospace}.survival-result p{margin:8px 0;color:rgba(255,255,255,.72);font:700 14px Barlow}.survival-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.survival-actions button{min-height:50px;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font:900 15px 'Barlow Condensed';letter-spacing:.12em;text-transform:uppercase}.survival-actions button:first-child{background:#2bff9a;color:#03120a;border-color:#2bff9a}
        .survival-modal{position:fixed;inset:0;z-index:1500;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:18px}.survival-modal__panel{width:min(92vw,360px);max-height:calc(100dvh - 36px);overflow-y:auto;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(4,10,20,.94);box-shadow:0 24px 70px rgba(0,0,0,.5);padding:14px;display:grid;gap:10px}.survival-modal__panel h2{margin:0;font:900 26px 'Barlow Condensed';letter-spacing:.1em;text-transform:uppercase}.survival-modal__panel button{min-height:46px;border-radius:13px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#fff;font:900 14px 'Barlow Condensed';letter-spacing:.12em;text-transform:uppercase}.survival-modal__panel button.is-primary{background:#2bff9a;color:#03120a;border-color:#2bff9a}.survival-modal__leaderboard{border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.06);padding:10px 12px;display:grid;gap:2px}.survival-modal__leaderboard h3{margin:0 0 3px;color:#2bff9a;font:900 13px 'Barlow Condensed';letter-spacing:.14em;text-transform:uppercase}.survival-modal__leaderboard p{margin:0;color:rgba(255,255,255,.64);font:800 12px Barlow,sans-serif}.survival-volume{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;color:rgba(255,255,255,.78);font:800 12px Barlow,sans-serif}.survival-volume input{width:100%}
        @media (max-width:699px){.survival-menu,.survival-game-frame,.survival-result{width:100vw;height:100dvh;max-width:none;max-height:none;aspect-ratio:auto;box-shadow:none}.survival-menu{padding-top:max(58px,calc(env(safe-area-inset-top) + 50px));padding-bottom:max(96px,calc(env(safe-area-inset-bottom) + 86px))}.survival-card{height:min(56dvh,430px);max-height:430px}.survival-modal{padding:14px}.survival-modal__panel{width:min(94vw,380px)}}
        @keyframes survivalFireballBounce{0%{transform:translateY(6px) scale(1.03,.95)}58%{transform:translateY(-7px) scale(.98,1.05)}100%{transform:translateY(-10px) scale(1)}}@keyframes survivalBallSpin{to{transform:rotate(360deg)}}@keyframes survivalFlameBack{to{transform:scale(1.08,1.18) skewX(-3deg);opacity:.9}}@keyframes survivalFlameMid{to{transform:translateY(-2px) scale(.94,1.16) skewX(4deg);opacity:.96}}@keyframes survivalFlameFront{to{transform:translateY(-3px) scale(1.08,1.12);opacity:.9}}
      `}</style>
      {mode === 'menu' ? (
        <section className="survival-menu">
          <button type="button" className="survival-ui-menu" aria-label="Menu mini jeux" onClick={() => { sfx.click(); setMenuOpen(true) }}><i /><i /><i /></button>
          <div className="survival-title">
            <h1>Mini jeux</h1>
            <p>Mode survie séparé du Brakup principal. Tiens le plus longtemps possible.</p>
          </div>
          <div
            className="survival-carousel-viewport"
            ref={viewportRef}
            aria-label="Choix du mini jeu"
            onPointerDown={handleCarouselDown}
            onPointerMove={handleCarouselMove}
            onPointerUp={handleCarouselUp}
            onPointerCancel={handleCarouselUp}
          >
            <div className="survival-carousel-track" ref={trackRef}>
              {CAROUSEL_ITEMS.map(({ game, virtualIndex }) => (
                <button
                  key={`${game.id}-${virtualIndex}`}
                  ref={(node) => { cardRefs.current[virtualIndex] = node }}
                  type="button"
                  className={`survival-card${virtualIndex === carouselIndex ? ' is-active' : ''}`}
                  style={{ '--accent': game.accent } as React.CSSProperties}
                  onClick={() => { sfx.tab(); snapCarousel(virtualIndex) }}
                >
                  <MiniGameCrest game={game} />
                  <h2>{game.title}</h2>
                  <p>{game.hook}</p>
                  <small>{game.ramp}</small>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="survival-start" onClick={() => start()}>
            Jouer
            <small>{selected.title}</small>
          </button>
        </section>
      ) : null}

      {mode === 'playing' ? (
        <section className="survival-stage">
          <div className="survival-game-frame">
            <div className="survival-hud">
              <button type="button" className="survival-back" onClick={() => { sfx.click(); setAudioOverride(null); onBack() }}>Quitter</button>
              <div className="survival-pill"><span>{selected.title}</span><strong>{formatTime(elapsed)} - {DIFFICULTY_META[displayedDifficulty]}</strong></div>
              <div className="survival-pill is-score">
                <span>Score</span>
                <strong>{score}</strong>
                {selectedId === 'shot' ? <em>Buts {rounds} · Coef x{shotStats.multiplierTotal.toFixed(1).replace('.', ',')}</em> : null}
              </div>
            </div>
            {activeGame === 'attack' ? (
              <AttackPhase key={runKey} difficulty="easy" homeTeamId={home?.id ?? 'HOME'} awayTeamId={away?.id ?? 'AWAY'} homeTeamPlayers={homeRoles.attackers} homeTeamPlayerNumbers={home?.playerNumbers} awayTeamPlayers={awayRoles.defenders} playerKit={homeKit} opponentKit={awayKit} onRoundEnd={handleAttackEnd} onAudioOverride={setAudioOverride} onGameplayStart={armGameplayTimer} roundIntroComment="Survie attaque : dribble le plus longtemps possible." survivalDribbleOnly onSurvivalDribbleScore={setAttackDribbleStats} />
            ) : null}
            {activeGame === 'shot' ? (
              <AttackPhase key={runKey} difficulty={difficulty} homeTeamId={home?.id ?? 'HOME'} awayTeamId={away?.id ?? 'AWAY'} homeTeamPlayers={homeRoles.attackers} homeTeamPlayerNumbers={home?.playerNumbers} awayTeamPlayers={awayRoles.defenders} playerKit={homeKit} opponentKit={awayKit} onRoundEnd={handleAttackEnd} onAudioOverride={setAudioOverride} onGameplayStart={armGameplayTimer} shotOnly shotTitle={shotStreakShooterName && rounds > 0 ? `SÉRIE x${rounds}` : 'SURVIE TIR'} shotGoalCount={rounds} shotResultGoalCount={rounds + 1} shotMultiplierTotal={shotStats.multiplierTotal} onShotPrecisionBonus={handleShotPrecisionBonus} showShotDoubleGoalCopy={false} roundIntroComment={shotStreakShooterName && rounds > 0 ? `${shotStreakShooterName} enchaîne. Buts d'affilée : ${rounds}.` : "Choisis ton tireur. La série continue tant que tu marques."} fixedShooterName={rounds > 0 ? shotStreakShooterName : null} rememberedShooterName={rounds === 0 ? shotStreakShooterName : null} skipShotShooterSelect={Boolean(shotStreakShooterName && rounds > 0)} skipShotTutorial={Boolean(shotStreakShooterName && rounds > 0)} />
            ) : null}
            {activeGame === 'defense' ? (
              <DefensePhase
                key={runKey}
                difficulty={difficulty}
                homeTeamId={home?.id ?? 'HOME'}
                awayTeamId={away?.id ?? 'AWAY'}
                awayTeamPlayers={awayRoles.attackers}
                defenderName={homeRoles.defenders[0]}
                keeperName={homeRoles.keeper}
                playerKit={homeKit}
                opponentKit={awayKit}
                onRoundEnd={handleDefenseEnd}
                onAudioOverride={setAudioOverride}
                onGameplayStart={armGameplayTimer}
                roundIntroComment="Mini-jeu défense : stoppe les attaquants."
                survivalMode
              />
            ) : null}
            {activeGame === 'fruit_ninja' ? (
              <FruitNinjaPhase
                key={runKey}
                attackersInZone={3}
                difficulty={difficulty}
                keeperName={homeRoles.keeper}
                opponentKit={awayKit}
                onResult={handleFruitEnd}
                onAudioOverride={setAudioOverride}
                onGameplayStart={armGameplayTimer}
                roundIntroComment="Mini-jeu tirs massifs : coupe les ballons, évite les bombes."
                survivalMode
              />
            ) : null}
            {activeGame === 'goal_save' ? (
              <GoalSave
                key={runKey}
                ballCount={Math.min(8, 3 + level)}
                difficulty={difficulty}
                playerKit={homeKit}
                opponentKit={awayKit}
                opponentName={away?.name}
                opponentFlag={away?.flagEmoji}
                keeperName={homeRoles.keeper}
                alertNames={awayRoles.attackers.slice(0, 3)}
                mode="goal_save"
                onResult={handleGoalSaveEnd}
                survivalMode
                onSurvivalStats={(saves) => setMiniStats({ units: saves, score: saves * 220 })}
                onAudioOverride={setAudioOverride}
                onGameplayStart={armGameplayTimer}
                roundIntroComment="Mini-jeu goal save : sauve les frappes sur la ligne."
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {mode === 'result' && lastScore ? (
        <section className="survival-result">
          <div className="survival-result__panel">
            <h1>Terminé</h1>
            <strong>{lastScore.score}</strong>
            <p>{selected.title} - {formatTime(lastScore.seconds)} - {unitLabel(lastScore.gameId, lastScore.rounds)}.</p>
            <div className="survival-actions">
              <button type="button" onClick={() => start(selectedId)}>Rejouer</button>
              <button type="button" onClick={() => setMode('menu')}>Mini jeux</button>
            </div>
          </div>
        </section>
      ) : null}
      {menuOpen ? (
        <div className="survival-modal" role="dialog" aria-modal="true" aria-label="Menu mini jeux">
          <div className="survival-modal__panel">
            <h2>Menu</h2>
            <button type="button" className="is-primary" onClick={() => { sfx.tab(); setMenuOpen(false); onBack() }}>Jeu Coupe du Monde</button>
            <div className="survival-modal__leaderboard">
              <h3>Classement local - {selected.title}</h3>
              {leaderboard.length ? leaderboard.map((row, index) => (
                <div className="survival-row" key={row.id}>
                  <span>#{index + 1}</span>
                  <strong>{row.pseudo} <span>{formatTime(row.seconds)} - {unitLabel(selectedId, row.rounds)}</span></strong>
                  <b>{row.score}</b>
                </div>
              )) : <p>Aucun score pour ce mini jeu.</p>}
            </div>
            <button type="button" onClick={() => { sfx.click(); setGameMuted(!audioMuted) }}>{audioMuted ? 'Activer le son' : 'Couper le son'}</button>
            <label className="survival-volume">
              <span>Volume</span>
              <input type="range" min="0" max="100" value={Math.round(audioVolume * 100)} onChange={(event) => setGameAudioVolume(Number(event.currentTarget.value) / 100)} />
              <strong>{Math.round(audioVolume * 100)}</strong>
            </label>
            <button type="button" onClick={() => { sfx.click(); setMenuOpen(false) }}>Fermer</button>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default SurvivalArcade
