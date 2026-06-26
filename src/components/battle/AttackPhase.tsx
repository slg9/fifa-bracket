import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BattleDifficulty } from '../../types'
import type { TeamKit } from '../../lib/teamKits'
import { playGameSound } from '../../lib/useGameAudio'
import GoalView, { type BallFlight, type GoalTarget } from './GoalView'

export type AttackEndReason = 'goal' | 'saved' | 'miss' | 'intercepted' | 'timeout'

type AttackPhaseProps = {
  difficulty: BattleDifficulty
  homeTeamId: string
  awayTeamId: string
  homeTeamPlayers?: string[]
  awayTeamPlayers?: string[]
  playerKit?: TeamKit
  opponentKit?: TeamKit
  onRoundEnd: (isGoal: boolean, reason?: AttackEndReason) => void
  isPaused?: boolean
  onAudioOverride?: (src: string | null) => void
  shotOnly?: boolean
  shotAudioMode?: 'normal' | 'heartOnly'
  shotTitle?: string
}

//  Config 
const ATTACK_CFG = {
  easy:   { waveCount: 12, gateWidth: 34, narrowGateWidth: 26, gdSpeed: 31, difficultyRamp: 0.32, spacing: 41, gaugeGreenPx: 28, gaugeSpeed: 0.78 },
  medium: { waveCount: 15, gateWidth: 28, narrowGateWidth: 21, gdSpeed: 39, difficultyRamp: 0.5, spacing: 37, gaugeGreenPx: 22, gaugeSpeed: 1.15 },
  hard:   { waveCount: 18, gateWidth: 23, narrowGateWidth: 17, gdSpeed: 46, difficultyRamp: 0.72, spacing: 33, gaugeGreenPx: 16, gaugeSpeed: 1.6 },
}

const KEEPER_CFG = {
  easy: { speed: 1.8, amplitudeX: 32, amplitudeY: 18, saveRadiusX: 18, saveRadiusY: 24 },
  medium: { speed: 2.45, amplitudeX: 38, amplitudeY: 22, saveRadiusX: 20, saveRadiusY: 26 },
  hard: { speed: 3.1, amplitudeX: 43, amplitudeY: 25, saveRadiusX: 22, saveRadiusY: 28 },
}

function keeperCoversTarget(
  target: { x: number; y: number },
  keeper: { x: number; y: number },
  cfg: { saveRadiusX: number; saveRadiusY: number },
  multiplier = 1,
) {
  const rx = Math.max(cfg.saveRadiusX, 18) * multiplier
  const ry = Math.max(cfg.saveRadiusY, 24) * multiplier
  const nx = (target.x - keeper.x) / rx
  const ny = (target.y - keeper.y) / ry
  return nx * nx + ny * ny <= 1
}

const SLALOM_CENTERS = [18, 30, 42, 50, 58, 70, 82]
const GD_PLAYER_Y   = 80
const WALL_FIRST_Y  = -12
const PLAYER_SPEED  = 60
const JUMP_DURATION = 620
const JUMP_ACTIVE_START = 110
const JUMP_ACTIVE_END = 500

const GD_COMMENTS = [
  'Beau dribble !', 'Petit pont !', 'Il passe !', 'Quel crochet !',
  'Magnifique !', 'Bien joue !', 'En pleine course !', 'PASSE !',
]

const GAUGE_TRACK_PX = 260

type SlalomWaveType = 'gate' | 'narrow_gate' | 'slide_wall' | 'double_slide_wall' | 'diagonal_press' | 'moving_gate' | 'bonus_choice' | 'combo_gate_slide'

type SlalomDefender = {
  id: string
  x: number
  yOffset: number
  label: string
  variant: 'normal' | 'press' | 'tackle' | 'sliding' | 'diagonal' | 'bonus_guard'
}

type SlalomWave = {
  id: string
  worldY: number
  type: SlalomWaveType
  gateCenterX: number
  gateWidth: number
  bonusGateCenterX?: number
  bonusGateWidth?: number
  defenders: SlalomDefender[]
  passed: boolean
  checked: boolean
  failed?: boolean
  requiresJump?: boolean
  hasBonus?: boolean
  bonusCollected?: boolean
  allowsJump?: boolean
  moveAmplitude?: number
  moveFrequency?: number
  movePhase?: number
}

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function createRng(seed: string) {
  let state = hashString(seed)
  return () => {
    state = Math.imul(1664525, state) + 1013904223
    return ((state >>> 0) / 4294967296)
  }
}

function pickWeighted<T extends string>(rng: () => number, weights: Array<[T, number]>) {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = rng() * total
  for (const [item, weight] of weights) {
    cursor -= weight
    if (cursor <= 0) return item
  }
  return weights[weights.length - 1][0]
}

function defenderLabel(players: string[], index: number, fallback: string) {
  if (!players.length) return fallback
  return players[index % players.length].split(' ').pop()?.slice(0, 8) ?? fallback
}

function pickGateCenter(rng: () => number, previous: number[], difficulty: BattleDifficulty) {
  const last = previous[previous.length - 1]
  const before = previous[previous.length - 2]
  const maxStep = difficulty === 'easy' ? 34 : difficulty === 'medium' ? 38 : 42
  let pool = SLALOM_CENTERS.filter((center) => {
    if (last === center && before === center) return false
    if (last != null && Math.abs(center - last) > maxStep) return false
    if (last != null && Math.abs(center - last) < (difficulty === 'hard' ? 8 : 10)) return false
    return true
  })
  if (!pool.length && last != null) pool = SLALOM_CENTERS.filter((center) => Math.abs(center - last) <= maxStep)
  if (!pool.length) pool = SLALOM_CENTERS.filter((center) => previous[previous.length - 1] !== center)
  if (!pool.length) pool = SLALOM_CENTERS
  return pool[Math.floor(rng() * pool.length)]
}

function waveWeights(difficulty: BattleDifficulty): Array<[SlalomWaveType, number]> {
  if (difficulty === 'easy') return [['gate', 50], ['narrow_gate', 20], ['slide_wall', 15], ['bonus_choice', 10], ['moving_gate', 5]]
  if (difficulty === 'medium') return [['gate', 30], ['narrow_gate', 20], ['slide_wall', 15], ['double_slide_wall', 10], ['diagonal_press', 10], ['bonus_choice', 10], ['moving_gate', 5]]
  return [['gate', 20], ['narrow_gate', 18], ['slide_wall', 18], ['double_slide_wall', 12], ['diagonal_press', 12], ['bonus_choice', 10], ['moving_gate', 5], ['combo_gate_slide', 5]]
}

function pickWaveType(rng: () => number, difficulty: BattleDifficulty, previous: SlalomWaveType[], index: number): SlalomWaveType {
  const scripted: SlalomWaveType[][] = [
    ['gate', 'bonus_choice', 'slide_wall'],
    ['narrow_gate', 'moving_gate', 'gate'],
    ['gate', 'slide_wall', 'diagonal_press'],
    ['bonus_choice', 'narrow_gate', 'moving_gate'],
    ['slide_wall', 'narrow_gate', 'combo_gate_slide'],
  ]
  if (index > 2 && rng() < 0.24) return scripted[Math.floor(rng() * scripted.length)][index % 3]
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const type = pickWeighted(rng, waveWeights(difficulty))
    const last = previous[previous.length - 1]
    const before = previous[previous.length - 2]
    if (last === type && before === type) continue
    if ((type === 'combo_gate_slide' || type === 'double_slide_wall') && last === type) continue
    if (difficulty === 'easy' && (type === 'double_slide_wall' || type === 'combo_gate_slide')) continue
    if (difficulty !== 'hard' && type === 'combo_gate_slide' && rng() < 0.65) continue
    return type
  }
  return 'gate'
}

function makeGateDefenders(i: number, center: number, gateWidth: number, players: string[], type: SlalomWaveType, rng: () => number): SlalomDefender[] {
  const half = gateWidth / 2
  const yJitter = () => Math.round((rng() - 0.5) * 16)
  const defenders: SlalomDefender[] = [
    { id: `${i}-left`, x: Math.max(7, center - half - 12 - rng() * 5), yOffset: yJitter(), label: defenderLabel(players, i * 3, String([4, 5, 6, 8, 2][i % 5])), variant: 'normal' },
    { id: `${i}-right`, x: Math.min(93, center + half + 12 + rng() * 5), yOffset: yJitter(), label: defenderLabel(players, i * 3 + 1, String([3, 7, 10, 11, 9][i % 5])), variant: type === 'diagonal_press' ? 'press' : 'normal' },
  ]
  if (type === 'diagonal_press' || type === 'combo_gate_slide' || rng() < 0.35) {
    defenders.push({ id: `${i}-third`, x: Math.max(9, Math.min(91, center + (center < 50 ? 1 : -1) * (half + 23 + rng() * 8))), yOffset: rng() < 0.5 ? -26 : 26, label: defenderLabel(players, i * 3 + 2, String([6, 8, 5, 2, 4][i % 5])), variant: type === 'combo_gate_slide' ? 'sliding' : 'press' })
  }
  return defenders
}

function makeSlideDefenders(i: number, players: string[], doubleLine: boolean): SlalomDefender[] {
  const xs = doubleLine ? [22, 45, 68, 84] : [25, 50, 75]
  return xs.map((x, index) => ({
    id: `${i}-slide-${index}`,
    x,
    yOffset: doubleLine && index % 2 ? 17 : doubleLine ? -17 : (index - 1) * 5,
    label: defenderLabel(players, i * 4 + index, String([2, 4, 5, 6][index % 4])),
    variant: 'sliding' as const,
  }))
}

function generateSlalomWaves(params: { difficulty: BattleDifficulty; seed: string; players: string[] }): SlalomWave[] {
  const cfg = ATTACK_CFG[params.difficulty]
  const rng = createRng(params.seed)
  const waves: SlalomWave[] = []
  const centers: number[] = []
  const types: SlalomWaveType[] = []

  for (let i = 0; i < cfg.waveCount; i += 1) {
    const progress = i / Math.max(1, cfg.waveCount - 1)
    const rawType = pickWaveType(rng, params.difficulty, types, i)
    const type = i < 2 && rawType !== 'gate' && rawType !== 'narrow_gate' ? 'gate' : rawType
    const center = pickGateCenter(rng, centers, params.difficulty)
    centers.push(center)
    types.push(type)

    const isSlide = type === 'slide_wall' || type === 'double_slide_wall'
    const isNarrow = type === 'narrow_gate' || type === 'combo_gate_slide'
    const isBonus = type === 'bonus_choice'
    const isMoving = type === 'moving_gate'
    const gateWidth = isBonus ? cfg.gateWidth + 2 : isNarrow ? cfg.narrowGateWidth : cfg.gateWidth + (progress < 0.25 ? 2 : 0)
    const spacing = cfg.spacing + (type === 'double_slide_wall' ? 7 : type === 'slide_wall' ? 4 : type === 'combo_gate_slide' ? 5 : 0)
    const worldY = WALL_FIRST_Y - i * spacing
    const moveAmplitude = isMoving ? (params.difficulty === 'hard' ? 8 + rng() * 4 : params.difficulty === 'medium' ? 6 + rng() * 4 : 4 + rng() * 3) : 0
    const safeCenter = Math.max(16 + moveAmplitude, Math.min(84 - moveAmplitude, center))
    const bonusDirection = safeCenter < 50 ? 1 : -1
    const bonusGateCenterX = isBonus ? Math.max(18, Math.min(82, safeCenter + bonusDirection * (24 + rng() * 10))) : undefined
    const bonusGateWidth = isBonus ? Math.max(14, cfg.narrowGateWidth - 3) : undefined
    const defenders = isSlide
      ? makeSlideDefenders(i, params.players, type === 'double_slide_wall')
      : makeGateDefenders(i, safeCenter, gateWidth, params.players, type, rng)

    if (isBonus && bonusGateCenterX != null) {
      defenders.push({
        id: `${i}-bonus-guard`,
        x: Math.max(8, Math.min(92, bonusGateCenterX + (bonusGateCenterX < 50 ? -1 : 1) * 15)),
        yOffset: 18,
        label: defenderLabel(params.players, i * 4 + 3, 'B'),
        variant: 'bonus_guard',
      })
    }

    waves.push({
      id: `wave-${i}`,
      worldY,
      type,
      gateCenterX: safeCenter,
      gateWidth,
      bonusGateCenterX,
      bonusGateWidth,
      defenders,
      passed: false,
      checked: false,
      requiresJump: isSlide || type === 'combo_gate_slide',
      hasBonus: isBonus,
      bonusCollected: false,
      allowsJump: false,
      moveAmplitude,
      moveFrequency: isMoving ? 0.75 + rng() * 0.38 : 0,
      movePhase: rng() * Math.PI * 2,
    })
  }
  return waves
}

function getWaveInstruction(wave?: SlalomWave) {
  if (wave?.type === 'slide_wall') return 'SAUTE !'
  if (wave?.type === 'double_slide_wall') return 'DOUBLE TACLE : SAUTE !'
  if (wave?.type === 'combo_gate_slide') return 'PASSE + SAUTE !'
  if (wave?.type === 'bonus_choice') return 'Vert sur / Dore bonus'
  if (wave?.type === 'moving_gate') return 'Lis la porte !'
  if (wave?.type === 'diagonal_press') return 'Evite le pressing'
  if (wave?.type === 'narrow_gate') return 'Porte serree !'
  return 'Passe dans le vert'
}

function getWaveGateCenter(wave: SlalomWave, elapsed: number) {
  if (!wave.moveAmplitude || !wave.moveFrequency) return wave.gateCenterX
  return Math.max(8, Math.min(92, wave.gateCenterX + wave.moveAmplitude * Math.sin(elapsed * wave.moveFrequency * Math.PI * 2 + (wave.movePhase ?? 0))))
}

function getJumpTone(wave: SlalomWave, now: number, jump: { isJumping: boolean; isActive: boolean; elapsed: number }) {
  if (wave.type !== 'slide_wall' && wave.type !== 'double_slide_wall' && wave.type !== 'combo_gate_slide') return 'INTERCEPTE !'
  if (!jump.isJumping) return 'TACLE !'
  if (jump.elapsed < JUMP_ACTIVE_START) return 'TROP TARD !'
  if (now && jump.elapsed > JUMP_ACTIVE_END) return 'TROP TOT !'
  return 'TACLE !'
}

function evaluateWaveSuccess(wave: SlalomWave, playerX: number, jump: { isActive: boolean }, elapsed: number): { success: boolean; bonus?: boolean; label: string } {
  const halfGate = wave.gateWidth / 2
  const center = getWaveGateCenter(wave, elapsed)
  const inGate = playerX >= center - halfGate && playerX <= center + halfGate
  const inBonusGate = wave.bonusGateCenterX != null && wave.bonusGateWidth != null
    ? playerX >= wave.bonusGateCenterX - wave.bonusGateWidth / 2 && playerX <= wave.bonusGateCenterX + wave.bonusGateWidth / 2
    : false

  if (wave.type === 'gate') return { success: inGate, label: inGate ? 'PASSE !' : 'INTERCEPTE !' }
  if (wave.type === 'narrow_gate') return { success: inGate, label: inGate ? 'PETIT PONT !' : 'HORS PORTE !' }
  if (wave.type === 'slide_wall') return { success: jump.isActive, label: jump.isActive ? 'SAUTE !' : 'TACLE !' }
  if (wave.type === 'double_slide_wall') return { success: jump.isActive, label: jump.isActive ? 'DOUBLE TACLE EVITE !' : 'TACLE !' }
  if (wave.type === 'diagonal_press') return { success: inGate, label: inGate ? 'CROCHET !' : 'PRESSE !' }
  if (wave.type === 'moving_gate') return { success: inGate, label: inGate ? 'BIEN LU !' : 'INTERCEPTE !' }
  if (wave.type === 'bonus_choice') {
    if (inBonusGate) return { success: true, bonus: true, label: 'BONUS !' }
    if (inGate) return { success: true, label: 'PASSE !' }
    return { success: false, label: 'INTERCEPTE !' }
  }
  if (wave.type === 'combo_gate_slide') return { success: inGate && jump.isActive, label: inGate && jump.isActive ? 'MAGNIFIQUE !' : 'TROP LENT !' }
  return { success: inGate, label: inGate ? 'PASSE !' : 'INTERCEPTE !' }
}

function flowGainForWave(wave: SlalomWave, bonus?: boolean) {
  if (bonus) return 22
  if (wave.type === 'gate') return 8
  if (wave.type === 'narrow_gate') return 12
  if (wave.type === 'slide_wall') return 14
  if (wave.type === 'double_slide_wall') return 18
  if (wave.type === 'diagonal_press') return 14
  if (wave.type === 'moving_gate') return 16
  if (wave.type === 'bonus_choice') return 10
  if (wave.type === 'combo_gate_slide') return 24
  return 8
}

function KawaiiFootballer({
  label,
  jerseyColor,
  accentColor,
  shortsColor,
  textColor,
  withBall = false,
  isPlayer = false,
}: {
  label: string
  jerseyColor: string
  accentColor: string
  shortsColor: string
  textColor: string
  withBall?: boolean
  isPlayer?: boolean
}) {
  return (
    <svg viewBox="0 0 80 98" width="58" height="70" className={`atk-kawaii${isPlayer ? ' is-player' : ''}`} aria-hidden="true">
      <ellipse cx="40" cy="91" rx="24" ry="6" fill="rgba(0,0,0,.28)" />
      {withBall ? (
        <>
          <circle cx="57" cy="82" r="10" fill="#f7f9fc" stroke="#101827" strokeWidth="2" />
          <path d="M57 74 l6 4 -2 7 h-8 l-2-7z" fill="none" stroke="#101827" strokeWidth="1.4" />
        </>
      ) : null}
      <rect className="atk-kawaii__leg atk-kawaii__leg--l" x="27" y="58" width="9" height="23" rx="4.5" fill={shortsColor} />
      <rect className="atk-kawaii__leg atk-kawaii__leg--r" x="44" y="58" width="9" height="23" rx="4.5" fill={shortsColor} />
      <ellipse cx="31" cy="82" rx="8" ry="5" fill="#121826" />
      <ellipse cx="48" cy="82" rx="8" ry="5" fill="#121826" />
      <path d="M16 31 q24 -10 48 0 l-4 30 q-20 6 -40 0z" fill={jerseyColor} stroke="rgba(255,255,255,.55)" strokeWidth="1.2" />
      <path d="M30 27 v31 M50 27 v31" stroke={accentColor} strokeWidth="3" opacity=".48" />
      <rect x="7" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
      <rect x="63" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
      <circle cx="12" cy="57" r="4" fill="#f3c9a0" />
      <circle cx="68" cy="57" r="4" fill="#f3c9a0" />
      <circle cx="40" cy="19" r="18" fill="#f3c9a0" stroke="rgba(255,255,255,.5)" strokeWidth="1" />
      <path d="M23 16 q17 -20 34 0 q-4 -14 -17 -16 q-13 2 -17 16z" fill="#322012" />
      <circle cx="33" cy="19" r="3.2" fill="#111" />
      <circle cx="47" cy="19" r="3.2" fill="#111" />
      <circle cx="34" cy="18" r="1" fill="#fff" />
      <circle cx="48" cy="18" r="1" fill="#fff" />
      <circle cx="28" cy="25" r="2.8" fill="#ff8a8a" opacity=".5" />
      <circle cx="52" cy="25" r="2.8" fill="#ff8a8a" opacity=".5" />
      <path d="M35 27 q5 3 10 0" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <text x="40" y="49" fontFamily="Barlow Condensed" fontWeight="900" fontSize={label.length > 6 ? '7' : '9'} fill={textColor} textAnchor="middle">{label}</text>
    </svg>
  )
}

//  Component 
export function AttackPhase({
  difficulty,
  homeTeamId,
  awayTeamId,
  homeTeamPlayers = [],
  awayTeamPlayers = [],
  playerKit,
  opponentKit,
  onRoundEnd,
  isPaused,
  onAudioOverride,
  shotOnly = false,
  shotAudioMode = 'normal',
  shotTitle,
}: AttackPhaseProps) {
  const cfg = ATTACK_CFG[difficulty]
  const slalomSeedRef = useRef(`${homeTeamId}-${awayTeamId}-${difficulty}-${Date.now()}-${Math.random()}`)
  const playerJerseyColor = playerKit?.primary ?? '#2bff9a'
  const playerAccentColor = playerKit?.secondary ?? '#0b1422'
  const playerShortsColor = playerKit?.shorts ?? '#1a0a3a'
  const playerTextColor = playerKit?.text ?? '#0b1422'
  const opponentJerseyColor = opponentKit?.primary ?? '#FF4455'
  const opponentAccentColor = opponentKit?.secondary ?? '#7dd3fc'

  //  Real player names 
  const attackerName = useRef(
    homeTeamPlayers.length > 0
      ? homeTeamPlayers[Math.floor(Math.random() * Math.min(homeTeamPlayers.length, 3))]
      : null
  ).current
  const attackerShort = attackerName ? attackerName.split(' ').pop()!.slice(0, 7) : null

  //  Tutorial 
  const [tutorialDone, setTutorialDone] = useState(
    () => shotOnly || sessionStorage.getItem('brakup:tut:atk2') === '1'
  )

  //  Top-level phase 
  const [phase, setPhase] = useState<'gd' | 'shot'>(() => shotOnly ? 'shot' : 'gd')
  const phaseRef = useRef<'gd' | 'shot'>(shotOnly ? 'shot' : 'gd')

  //  GD phase state (display only) 
  const [gdWallsDisplay, setGdWallsDisplay] = useState<SlalomWave[]>([])
  const [gdJumping, setGdJumping]     = useState(false)
  const [gdComment, setGdComment]     = useState<string | null>(null)
  const [gdFlash, setGdFlash]         = useState(false)
  const [showShotIntro, setShowShotIntro] = useState(false)

  //  GD phase refs (RAF + direct DOM) 
  const gdPlayerXRef    = useRef(50)
  const gdFallPctRef    = useRef(0)
  // DOM refs for butter-smooth position updates without React re-renders
  const wallContainerRef = useRef<HTMLDivElement>(null)
  const playerElRef      = useRef<HTMLDivElement>(null)
  const gdWallsRef      = useRef<SlalomWave[]>([])
  const isJumpingRef    = useRef(false)
  const jumpStartedAtRef = useRef<number | null>(null)
  const keysRef         = useRef({ left: false, right: false })
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gdCheckedRef    = useRef(0)  // count of walls passed
  const gdElapsedRef    = useRef(0)  // elapsed time for GD acceleration
  const crowdCueRef    = useRef(new Set<string>())
  const slalomCompletePendingRef = useRef(false)
  const slalomCompleteWorldYRef = useRef<number | null>(null)
  const comboRef       = useRef(0)
  const maxComboRef    = useRef(0)
  const flowRef        = useRef(0)
  const shotBonusRef   = useRef({ widerGreen: 0, slowKeeper: 0, powerShot: false })
  const [comboDisplay, setComboDisplay] = useState(0)
  const [flow, setFlow] = useState(0)
  const [bonusFlash, setBonusFlash] = useState(false)

  // Shot phase: aim cursor follows hold/drag; release fires.
  const aimCursorRef = useRef<{ x: number; y: number } | null>(shotOnly ? { x: 50, y: 30 } : null)
  const [aimCursorPos, setAimCursorPos] = useState<{ x: number; y: number } | null>(() => shotOnly ? { x: 50, y: 30 } : null)
  const [hasAimedTarget, setHasAimedTarget] = useState(false)
  const hasAimedTargetRef = useRef(false)
  const aimStartRef = useRef<{ x: number; y: number } | null>(null)
  const [shotAimWarning, setShotAimWarning] = useState(false)
  const aimWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shotFiredRef = useRef(false)
  const shotGameRef  = useRef<HTMLDivElement>(null)
  const isAimingRef = useRef(false)
  const [isKicking, setIsKicking] = useState(false)

  // Keeper (oscillates in shot phase)
  const [keeperX, setKeeperX] = useState(50)
  const keeperXRef            = useRef(50)

  // Keeper Y (vertical movement)
  const [keeperY, setKeeperY] = useState(70)
  const keeperYRef            = useRef(70)

  // Ball flight animation (shot phase)
  const [ballFlight, setBallFlight] = useState<BallFlight | null>(null)

  // Power gauge  cursor position managed via direct DOM ref, no React state
  const gaugeCursorRef   = useRef(0)
  const gaugeTimeRef     = useRef(0)
  const gaugeGreenLeft   = useRef(0)    // 0..1 position of green zone left edge

  // Result
  const [resultLabel, setResultLabel] = useState<string | null>(null)

  // Direct DOM refs for performance-critical shot phase elements
  const gaugeCursorElRef = useRef<HTMLDivElement>(null)

  // Common refs
  const endedRef      = useRef(false)
  const isPausedRef   = useRef(false)
  isPausedRef.current = isPaused ?? false
  const containerRef  = useRef<HTMLDivElement>(null)
  // Cache game area width for compositor-thread transform positioning (avoids layout reads in RAF)
  const gameWidthRef  = useRef(typeof window !== 'undefined' ? window.innerWidth : 400)
  // Cached rects  avoid getBoundingClientRect() in pointer-move hot path (forced layout = jank)
  const containerRectRef = useRef({ left: 0, width: typeof window !== 'undefined' ? window.innerWidth : 400 })
  const shotRectRef      = useRef({ left: 0, top: 0, width: 0, height: 0 })

  useEffect(() => {
    if (phase !== 'shot' || showShotIntro) return
    onAudioOverride?.(shotAudioMode === 'heartOnly' ? null : '/audio/final-kick-freeze.mp3')
    const heart = playGameSound('/audio/heart.mp3', { volume: shotAudioMode === 'heartOnly' ? 0.88 : 0.7, loop: true })
    return () => {
      heart?.stop()
      onAudioOverride?.(null)
    }
  }, [phase, showShotIntro, onAudioOverride, shotAudioMode])

  useEffect(() => {
    if (!shotOnly) return
    phaseRef.current = 'shot'
    setPhase('shot')
    const defaultAim = { x: 50, y: 30 }
    aimCursorRef.current = defaultAim
    setAimCursorPos(defaultAim)
    gaugeGreenLeft.current = 0.34
  }, [shotOnly])

  // Build slalom waves.
  useEffect(() => {
    if (shotOnly) return
    const waves = generateSlalomWaves({ difficulty, seed: slalomSeedRef.current, players: awayTeamPlayers })
    gdFallPctRef.current = 0
    gdCheckedRef.current = 0
    gdElapsedRef.current = 0
    gdWallsRef.current = waves
    crowdCueRef.current.clear()
    slalomCompletePendingRef.current = false
    slalomCompleteWorldYRef.current = null
    comboRef.current = 0
    maxComboRef.current = 0
    flowRef.current = 0
    shotBonusRef.current = { widerGreen: 0, slowKeeper: 0, powerShot: false }
    setComboDisplay(0)
    setFlow(0)
    setBonusFlash(false)
    setGdWallsDisplay([...waves])
    if (wallContainerRef.current) wallContainerRef.current.style.transform = 'translateY(0%)'
  }, [awayTeamPlayers, difficulty, shotOnly])

  //  Cache container rect (avoids getBoundingClientRect in hot pointer path) 
  useEffect(() => {
    const measure = () => {
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      containerRectRef.current = { left: r.left, width: r.width }
      gameWidthRef.current = r.width
    }
    measure()
    window.addEventListener('resize', measure, { passive: true })
    return () => window.removeEventListener('resize', measure)
  }, [])

  //  Cache shot game rect when entering shot phase 
  useEffect(() => {
    if (phase !== 'shot') return
    const measure = () => {
      const el = shotGameRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      shotRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    const t = setTimeout(measure, 50)  // slight delay for layout to settle after phase transition
    window.addEventListener('resize', measure, { passive: true })
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [phase])

  //  Finish callback 
  const finish = useCallback((isGoal: boolean, reason: AttackEndReason) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(isGoal, reason)
  }, [onRoundEnd])

  const getEffectiveGaugeGreenPx = useCallback(() => {
    return Math.min(110, cfg.gaugeGreenPx + shotBonusRef.current.widerGreen * 4 + (flowRef.current >= 70 ? 4 : 0) + (shotBonusRef.current.powerShot ? 4 : 0))
  }, [cfg.gaugeGreenPx])

  const registerDribbleSuccess = useCallback((wave: SlalomWave, outcome: { bonus?: boolean; label: string }) => {
    const comboIncrement = outcome.bonus ? 2 : 1
    comboRef.current += comboIncrement
    maxComboRef.current = Math.max(maxComboRef.current, comboRef.current)
    setComboDisplay(comboRef.current)

    const nextFlow = Math.min(100, flowRef.current + flowGainForWave(wave, outcome.bonus))
    const wasBelowMax = flowRef.current < 100
    flowRef.current = nextFlow
    setFlow(nextFlow)

    if (outcome.bonus) {
      wave.bonusCollected = true
      shotBonusRef.current.widerGreen += 1
      setBonusFlash(true)
      window.setTimeout(() => setBonusFlash(false), 420)
    }

    if (nextFlow >= 70 && shotBonusRef.current.slowKeeper === 0) {
      shotBonusRef.current.slowKeeper = 1
    }

    if ((nextFlow >= 100 && wasBelowMax) || comboRef.current >= cfg.waveCount) {
      shotBonusRef.current.powerShot = true
    }
  }, [cfg.waveCount])

  function getJumpState(now: number) {
    const startedAt = jumpStartedAtRef.current
    if (!startedAt) return { isJumping: false, isActive: false, elapsed: 0 }
    const elapsed = now - startedAt
    return {
      isJumping: elapsed <= JUMP_DURATION,
      isActive: elapsed >= JUMP_ACTIVE_START && elapsed <= JUMP_ACTIVE_END,
      elapsed,
    }
  }

  //  Jump handler 
  const handleJump = () => {
    if (isJumpingRef.current) return
    jumpStartedAtRef.current = performance.now()
    isJumpingRef.current = true
    setGdJumping(true)
    setTimeout(() => {
      isJumpingRef.current = false
      jumpStartedAtRef.current = null
      setGdJumping(false)
    }, JUMP_DURATION)
  }

  //  Keyboard handler 
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

  //  GD RAF  walls fall from top 
  useEffect(() => {
    if (phase !== 'gd' || !tutorialDone || showShotIntro) return
    let frame = 0
    let prev: number | null = null
    gdElapsedRef.current = 0

    // Measure game area width once before RAF loop  used for compositor-thread transform positioning
    gameWidthRef.current = wallContainerRef.current?.offsetWidth ?? window.innerWidth

    const tick = (now: number) => {
      if (isPausedRef.current) { prev = null; frame = requestAnimationFrame(tick); return }
      if (prev === null) prev = now
      const delta = Math.min(50, now - prev) / 1000
      prev = now
      if (endedRef.current) return

      gdElapsedRef.current += delta

      // Move player X via keyboard  direct DOM, no React re-render
      if (keysRef.current.left) {
        gdPlayerXRef.current = Math.max(3, gdPlayerXRef.current - PLAYER_SPEED * delta)
      }
      if (keysRef.current.right) {
        gdPlayerXRef.current = Math.min(97, gdPlayerXRef.current + PLAYER_SPEED * delta)
      }
      if (playerElRef.current) {
        // transform: compositor thread only  no layout, no paint
        const x = (gdPlayerXRef.current / 100) * gameWidthRef.current - 29
        playerElRef.current.style.transform = `translateX(${x}px)`
        playerElRef.current.style.setProperty('--atk-player-x', `${x}px`)
      }

      const progress = gdCheckedRef.current / Math.max(1, cfg.waveCount)
      const speed = cfg.gdSpeed * (1 + progress * cfg.difficultyRamp)

      // Walls fall: update ONE container transform  GPU composited, zero layout reflow
      gdFallPctRef.current += speed * delta
      if (wallContainerRef.current) {
        wallContainerRef.current.style.transform = `translateY(${gdFallPctRef.current}%)`
      }

      // Collision / pass check  fire once per wall when it reaches player Y
      const walls   = gdWallsRef.current
      const playerX = gdPlayerXRef.current
      const fall    = gdFallPctRef.current
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i]
        if (wall.checked) continue
        // Wall screen Y = worldY + fall (worldY is negative  starts above screen)
        const screenY = wall.worldY + fall
        const isJumpCue = wall.type === 'slide_wall' || wall.type === 'double_slide_wall' || wall.type === 'combo_gate_slide'
        if (isJumpCue && screenY > -4 && !crowdCueRef.current.has(wall.id)) {
          crowdCueRef.current.add(wall.id)
          playGameSound('/audio/crowd.mp3', { volume: 0.78 })
        }

        // Trigger when wall top edge reaches PLAYER_Y band
        if (screenY < GD_PLAYER_Y - 4) continue

        wall.checked = true
        const jump = getJumpState(now)
        const outcome = evaluateWaveSuccess(wall, playerX, jump, gdElapsedRef.current)

        if (outcome.success) {
          wall.passed = true
          registerDribbleSuccess(wall, outcome)
          gdCheckedRef.current++
          setGdWallsDisplay([...gdWallsRef.current])
          const comboLabel = comboRef.current >= 10 ? 'INARRETABLE !' : comboRef.current >= 7 ? 'FLOW !' : comboRef.current >= 5 ? 'DRIBBLE FOU !' : comboRef.current >= 3 ? 'CROCHET !' : outcome.label
          const comment = outcome.bonus ? 'BONUS !' : comboLabel || GD_COMMENTS[Math.floor(Math.random() * GD_COMMENTS.length)]
          setGdComment(comment)
          if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
          commentTimerRef.current = setTimeout(() => setGdComment(null), 800)

          if (gdCheckedRef.current >= cfg.waveCount) {
            slalomCompletePendingRef.current = true
            slalomCompleteWorldYRef.current = wall.worldY
            if (comboRef.current >= cfg.waveCount) {
              shotBonusRef.current.powerShot = true
              setGdComment('DRIBBLE PARFAIT !')
            } else if (flowRef.current >= 70) {
              setGdComment('FACE AU GARDIEN - TIR BOOSTE !')
            } else {
              setGdComment('FACE AU GARDIEN !')
            }
            if (commentTimerRef.current) {
              clearTimeout(commentTimerRef.current)
              commentTimerRef.current = null
            }
          }
        } else {
          wall.failed = true
          setGdWallsDisplay([...gdWallsRef.current])
          setGdFlash(true)
          comboRef.current = 0
          setComboDisplay(0)
          setGdComment(outcome.label || getJumpTone(wall, now, jump))
          setTimeout(() => setGdFlash(false), 300)
          setTimeout(() => finish(false, 'intercepted'), 260)
          return
        }
      }

      if (slalomCompletePendingRef.current && slalomCompleteWorldYRef.current != null) {
        const finalScreenY = slalomCompleteWorldYRef.current + gdFallPctRef.current
        if (finalScreenY >= GD_PLAYER_Y + 26) {
          slalomCompletePendingRef.current = false
          setShowShotIntro(true)
          return
        }
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, tutorialDone, showShotIntro, cfg.gdSpeed, cfg.difficultyRamp, cfg.waveCount, finish, registerDribbleSuccess])

  //  Pointer move for GD (drag ball left/right)  direct DOM, no re-render, no getBCR 
  const handleGdPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== 'gd' || endedRef.current) return
    const { left, width } = containerRectRef.current
    if (!width) return
    gdPlayerXRef.current = Math.max(3, Math.min(97, ((e.clientX - left) / width) * 100))
    if (playerElRef.current) {
      const x = (gdPlayerXRef.current / 100) * (gameWidthRef.current || width) - 29
      playerElRef.current.style.transform = `translateX(${x}px)`
      playerElRef.current.style.setProperty('--atk-player-x', `${x}px`)
    }
  }

  //  Shot RAF  keeper + aim cursor + gauge all oscillate simultaneously 
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

      const keeperCfg = KEEPER_CFG[difficulty]
      const keeperSpeedMultiplier = shotBonusRef.current.slowKeeper > 0 || flowRef.current >= 70 ? 0.85 : 1
      const keeperSpeed = keeperCfg.speed * keeperSpeedMultiplier
      const kx = Math.max(8, Math.min(92,
        50 +
          keeperCfg.amplitudeX * Math.sin(shotTime * keeperSpeed) +
          7 * Math.sin(shotTime * keeperSpeed * 1.8 + 0.7)
      ))
      const ky = Math.max(18, Math.min(82,
        50 + keeperCfg.amplitudeY * Math.sin(shotTime * keeperSpeed * 0.78 + 1.0)
      ))
      keeperXRef.current = kx
      keeperYRef.current = ky
      setKeeperX(kx)
      setKeeperY(ky)

      // Gauge oscillates  direct DOM, no React re-render
      gaugeTimeRef.current += delta
      const raw = Math.sin(gaugeTimeRef.current * Math.PI * 2 * cfg.gaugeSpeed)
      const cursor = (raw + 1) / 2
      gaugeCursorRef.current = cursor
      if (gaugeCursorElRef.current) {
        gaugeCursorElRef.current.style.left = `${cursor * 100}%`
      }

      // Auto-miss after ~12s: still show the ball leaving the frame before the label.
      if (gaugeTimeRef.current > 12) {
        shotFiredRef.current = true
        const FLIGHT_MS = 700
        const KICK_DELAY_MS = 120
        setIsKicking(true)
        window.setTimeout(() => setIsKicking(false), 240)
        window.setTimeout(() => {
          setBallFlight({ id: Date.now(), target: { x: 118, y: -18, clientX: 0, clientY: 0 }, state: 'miss', duration: FLIGHT_MS })
          window.setTimeout(() => setResultLabel('RATE !'), FLIGHT_MS)
          window.setTimeout(() => finish(false, 'miss'), FLIGHT_MS + 700)
        }, KICK_DELAY_MS)
        return
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, showShotIntro, cfg.gaugeSpeed, difficulty, finish])

  //  Map screen pointer to goal-normalized coords (0-100), clamped inside goal 
  const pointerToGoalTarget = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = shotRectRef.current
    if (!rect.width) return { x: 50, y: 30 }
    const svgX = (clientX - rect.left) / rect.width   // 0-1
    const svgY = (clientY - rect.top)  / rect.height  // 0-1

    // Compact goal metrics (must match goalFrameMetrics in GoalView)
    const topY = 0.11, bottomY = 0.275
    const topLeft = 0.20, topRight = 0.80
    const bottomLeft = 0.14, bottomRight = 0.86

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

  // Shot aiming: hold to aim, release to kick.
  const handleShotPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (shotFiredRef.current || endedRef.current || phase !== 'shot' || ballFlight) return
    if (!isAimingRef.current) return

    const pos = pointerToGoalTarget(e.clientX, e.clientY)
    const start = aimStartRef.current
    if (start && Math.hypot(pos.x - start.x, pos.y - start.y) > 2.5) {
      hasAimedTargetRef.current = true
      setHasAimedTarget(true)
      setShotAimWarning(false)
    }
    aimCursorRef.current = pos
    setAimCursorPos(pos)
  }

  const fireShot = () => {
    if (shotFiredRef.current || endedRef.current) return

    shotFiredRef.current = true
    setIsKicking(true)

    const cursor = gaugeCursorRef.current
    const greenL = gaugeGreenLeft.current
    const greenR = greenL + getEffectiveGaugeGreenPx() / GAUGE_TRACK_PX
    const inGreen = cursor >= greenL && cursor <= greenR

    const at = aimCursorRef.current ?? { x: 50, y: 50 }
    const keeperCfg = KEEPER_CFG[difficulty]
    const saveRadiusMultiplier = shotBonusRef.current.powerShot ? 0.9 : 1
    const keeperBlocking = inGreen && keeperCoversTarget(
      at,
      { x: keeperXRef.current, y: keeperYRef.current },
      keeperCfg,
      saveRadiusMultiplier,
    )

    const FLIGHT_MS = 700
    const KICK_DELAY_MS = 120
    const aimTarget: GoalTarget = { x: at.x, y: at.y, clientX: 0, clientY: 0 }
    const missTarget: GoalTarget = { x: cursor < greenL ? -18 : 118, y: -18, clientX: 0, clientY: 0 }

    window.setTimeout(() => setIsKicking(false), 240)

    window.setTimeout(() => {
      if (!inGreen) {
        setBallFlight({ id: Date.now(), target: missTarget, state: 'miss', duration: FLIGHT_MS })
        window.setTimeout(() => setResultLabel('RATE !'), FLIGHT_MS)
        window.setTimeout(() => finish(false, 'miss'), FLIGHT_MS + 700)
        return
      }

      if (keeperBlocking) {
        setBallFlight({ id: Date.now(), target: aimTarget, state: 'saved', duration: FLIGHT_MS })
        window.setTimeout(() => setResultLabel('ARRETE !'), FLIGHT_MS)
        window.setTimeout(() => finish(false, 'saved'), FLIGHT_MS + 800)
        return
      }

      setBallFlight({ id: Date.now(), target: aimTarget, state: 'goal', duration: FLIGHT_MS })
      window.setTimeout(() => setResultLabel('BUT !'), FLIGHT_MS)
      window.setTimeout(() => finish(true, 'goal'), FLIGHT_MS + 800)
    }, KICK_DELAY_MS)
  }

  const handleShotPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (shotFiredRef.current || endedRef.current || phase !== 'shot' || ballFlight) return

    isAimingRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }

    const pos = pointerToGoalTarget(e.clientX, e.clientY)
    aimStartRef.current = pos
    setShotAimWarning(false)
    aimCursorRef.current = pos
    setAimCursorPos(pos)
  }

  const handleShotPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (shotFiredRef.current || endedRef.current || phase !== 'shot' || ballFlight) return
    if (!isAimingRef.current) return

    isAimingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }

    const pos = pointerToGoalTarget(e.clientX, e.clientY)
    const start = aimStartRef.current
    const hasMovedAim = hasAimedTargetRef.current || !start || Math.hypot(pos.x - start.x, pos.y - start.y) > 2.5
    aimCursorRef.current = pos
    setAimCursorPos(pos)
    aimStartRef.current = null

    if (!hasMovedAim) {
      setShotAimWarning(true)
      if (aimWarningTimerRef.current) clearTimeout(aimWarningTimerRef.current)
      aimWarningTimerRef.current = setTimeout(() => setShotAimWarning(false), 1500)
      return
    }

    hasAimedTargetRef.current = true
    setHasAimedTarget(true)
    fireShot()
  }

  const handleShotPointerCancel = () => {
    isAimingRef.current = false
    aimStartRef.current = null
  }

  //  Transition from GD to shot 
  const handleStartShot = () => {
    setShowShotIntro(false)
    phaseRef.current = 'shot'
    setPhase('shot')
    // Default cursor at center of goal so the player always sees their aim point
    const defaultAim = { x: 50, y: 30 }
    aimCursorRef.current = defaultAim
    setAimCursorPos(defaultAim)
    aimStartRef.current = null
    hasAimedTargetRef.current = false
    setHasAimedTarget(false)
    setShotAimWarning(false)
    shotFiredRef.current = false
    isAimingRef.current = false
    setIsKicking(false)
    setBallFlight(null)
    setResultLabel(null)
    const maxLeft = 1 - getEffectiveGaugeGreenPx() / GAUGE_TRACK_PX
    gaugeGreenLeft.current = Math.random() * maxLeft * 0.6 + 0.2
  }

  //  Derived display values 
  const effectiveGaugeGreenPx = getEffectiveGaugeGreenPx()
  const gaugeGreenLeftPct = gaugeGreenLeft.current * 100  // % of track
  const nextGdWave = gdWallsDisplay.find((wave) => !wave.checked)
  const gdInstruction = getWaveInstruction(nextGdWave)
  const gdBadgeClass = nextGdWave?.type === 'slide_wall' || nextGdWave?.type === 'double_slide_wall' ? ' is-jump' : nextGdWave?.type === 'combo_gate_slide' ? ' is-combo' : nextGdWave?.type === 'bonus_choice' ? ' is-bonus' : nextGdWave?.moveAmplitude ? ' is-moving' : ''

  return (
    <section
      className={`atk-root is-${phase}`}
      ref={containerRef}
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerMove={(e) => {
        // Section-level: handles both phases so finger can roam anywhere (GD: no inner-div boundary)
        if (phase === 'gd') handleGdPointerMove(e)
        else if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerMove(e)
      }}
      onPointerDown={(e) => {
        if (phase === 'gd') {
          handleGdPointerMove(e)
          const rect = containerRectRef.current
          if (rect.width && e.clientY > window.innerHeight * 0.58) handleJump()
        }
        else if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerDown(e)
      }}
      onPointerUp={(e) => {
        if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerUp(e)
      }}
      onPointerCancel={() => {
        if (phase === 'shot') handleShotPointerCancel()
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
        .atk-root.is-gd { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
        .atk-root.is-shot { display: flex; flex-direction: column; }
        /* GD game area */
        .atk-game { position: relative; overflow: hidden; flex: 1; }

        /*  Tutorial overlay  */
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

        /*  Comment popup  */
        .atk-row-comment {
          position: absolute; top: 35%; left: 50%; transform: translate(-50%,-50%);
          max-width: calc(100% - 28px); box-sizing: border-box;
          padding: 0 6px .08em;
          font: 900 clamp(14px,5vw,24px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em; line-height: 1.08; color: #2bff9a;
          text-align: center; text-shadow: 0 0 16px rgba(43,255,154,.7);
          pointer-events: none; z-index: 30; white-space: nowrap; overflow: visible;
          animation: atkCommentPop .15s ease-out both;
        }
        @keyframes atkCommentPop {
          from { transform: translate(-50%,-50%) scale(.7); opacity: 0; }
          to   { transform: translate(-50%,-50%) scale(1);  opacity: 1; }
        }


        /*  GD pitch (top-down)  */
        .atk-gd {
          position: absolute; inset: 0;
          background:
            radial-gradient(ellipse at 50% 100%, rgba(43,255,154,.16), transparent 34%),
            linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 20%),
            repeating-linear-gradient(90deg, #0a351c 0px, #0a351c 54px, #0d4223 54px, #0d4223 108px);
        }
        .atk-gd::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse at 50% 50%, transparent 46%, rgba(2,8,10,.38) 100%);
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

        /*  GD pitch SVG markings  */
        .atk-gd-pitch-svg {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          pointer-events: none; overflow: visible;
        }
        .atk-dribble-hud {
          position: absolute; top: max(106px, calc(env(safe-area-inset-top) + 96px)); left: 14px; right: 14px; z-index: 24;
          display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: start;
          pointer-events: none;
        }
        .atk-dribble-title { color:#eafff5; font:900 13px 'Barlow Condensed',sans-serif; letter-spacing:.14em; text-shadow:0 0 12px rgba(43,255,154,.42); }
        .atk-dribble-title small { display:block; margin-top:2px; color:rgba(255,255,255,.6); font:800 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .atk-flow-bar { width:min(210px,58vw); height:7px; margin-top:7px; border-radius:999px; background:rgba(255,255,255,.13); overflow:hidden; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }
        .atk-flow-bar__fill { height:100%; width:0%; border-radius:999px; background:linear-gradient(90deg,#2bff9a,#b8ff6a,#ffb800); box-shadow:0 0 12px rgba(43,255,154,.52); transition:width .22s ease-out; }
        .atk-combo-badge { min-width:72px; padding:7px 9px; border-radius:12px; text-align:center; color:#dfffee; background:rgba(5,16,21,.68); border:1px solid rgba(43,255,154,.32); font:900 12px 'Barlow Condensed',sans-serif; letter-spacing:.12em; box-shadow:0 0 18px rgba(43,255,154,.14); }
        .atk-combo-badge.is-hot { color:#201300; background:linear-gradient(180deg,#ffdc73,#ffb800); border-color:rgba(255,255,255,.48); box-shadow:0 0 22px rgba(255,184,0,.42); }
        .atk-bonus-flash { position:absolute; inset:0; z-index:23; pointer-events:none; background:radial-gradient(circle at 50% 72%, rgba(255,184,0,.34), transparent 42%); animation:atkBonusFlash .42s ease-out both; }

        /*  GD speed indicator  */
        .atk-gd-speed {
          position: absolute; top: max(138px, calc(env(safe-area-inset-top) + 128px)); right: 14px; z-index: 20;
          font: 700 9px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em; color: rgba(255,255,255,.35);
          transition: color .3s;
        }
        .atk-gd-speed.is-fast { color: #FF4455; text-shadow: 0 0 8px rgba(255,68,85,.6); }

        /*  GD player token (kawaii avatar)  */
        .atk-gd-player {
          position: absolute;
          left: 0;
          top: calc(${GD_PLAYER_Y}% - 34px);
          width: 58px;
          height: 76px;
          pointer-events: none; z-index: 10;
          will-change: transform;
        }
        .atk-player-inner { position:relative;width:100%;height:100%;transform-origin:50% 70%;transition:transform .12s ease-out,filter .12s ease-out;filter:drop-shadow(0 0 14px rgba(43,255,154,.52)); }
        .atk-player-shadow { position:absolute;left:50%;bottom:2px;width:42px;height:14px;border-radius:999px;background:rgba(0,0,0,.38);transform:translateX(-50%);transition:transform .12s ease-out,opacity .12s ease-out;z-index:-1; }
        .atk-gd-player--flash .atk-player-inner { filter: drop-shadow(0 0 14px rgba(255,68,85,1)); }
        .atk-gd-player--pass .atk-player-inner { transform:scale(1.28);filter:drop-shadow(0 0 18px rgba(43,255,154,.65)); }
        .atk-gd-player--pass .atk-player-shadow { transform:translateX(-50%) scale(1.55);opacity:.18; }
        .atk-player-whoosh { position:absolute;left:50%;top:46%;width:62px;height:62px;border-radius:50%;border:2px solid rgba(43,255,154,.34);transform:translate(-50%,-50%) scale(.7);opacity:0;pointer-events:none; }
        .atk-gd-player--pass .atk-player-whoosh { animation:atkJumpWhoosh .34s ease-out both; }
        .atk-gd-player.is-flowing .atk-player-inner { filter:drop-shadow(0 0 18px rgba(43,255,154,.82)); }
        .atk-gd-player.is-max-flow .atk-player-inner { filter:drop-shadow(0 0 22px rgba(255,184,0,.9)) drop-shadow(0 0 16px rgba(43,255,154,.62)); }
        .atk-gd-player.is-max-flow::after { content:'TIR BOOSTE'; position:absolute; left:50%; top:-22px; transform:translateX(-50%); color:#ffdd73; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; white-space:nowrap; text-shadow:0 0 12px rgba(255,184,0,.8); }

        .atk-slalom-wave.is-moving { animation: atkWaveDrift var(--atk-wave-duration,1.4s) ease-in-out var(--atk-wave-delay,0s) infinite alternate; }
        @keyframes atkWaveDrift { from{ transform:translateX(calc(var(--atk-wave-shift,0%) * -1)); } to{ transform:translateX(var(--atk-wave-shift,0%)); } }
        .atk-slalom-gate {
          position: absolute;
          transform: translate(-50%, -50%);
          min-width: 94px;
          height: 56px;
          border: 2px solid rgba(43,255,154,.9);
          border-radius: 999px;
          background: radial-gradient(ellipse at center, rgba(43,255,154,.16), rgba(43,255,154,.045) 72%, transparent 100%);
          box-shadow: 0 0 24px rgba(43,255,154,.34), inset 0 0 18px rgba(43,255,154,.18);
          animation: atkGatePulse 1.2s ease-in-out infinite;
          z-index: 5;
        }
        .atk-slalom-gate.is-passed { border-color:#b8ff6a; background:rgba(43,255,154,.2); animation: atkGatePass .42s ease-out both; }
        .atk-slalom-gate.is-failed { border-color:#FF4455; background:rgba(255,68,85,.14); box-shadow:0 0 28px rgba(255,68,85,.45); }
        .atk-slalom-gate.is-combo { border-color:#FFB800;background:radial-gradient(ellipse at center,rgba(255,184,0,.18),rgba(43,255,154,.07) 72%,transparent);box-shadow:0 0 24px rgba(255,184,0,.3),inset 0 0 18px rgba(43,255,154,.18); }
        .atk-slalom-gate.is-narrow { height:50px; border-style:dashed; }
        .atk-slalom-gate.is-moving { border-color:#19d3ff; box-shadow:0 0 24px rgba(25,211,255,.34), inset 0 0 18px rgba(25,211,255,.14); }
        .atk-slalom-gate.is-bonus { border-color:#FFB800; color:#2b1800; background:radial-gradient(ellipse at center,rgba(255,184,0,.28),rgba(255,184,0,.08) 72%,transparent 100%); box-shadow:0 0 30px rgba(255,184,0,.48), inset 0 0 18px rgba(255,255,255,.18); }
        .atk-slalom-gate.is-bonus .atk-slalom-gate__label { color:#fff2bf; text-shadow:0 0 12px rgba(255,184,0,.95); }
        .atk-bonus-choice-label { position:absolute; left:50%; top:34px; transform:translateX(-50%); color:#ffdf73; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.14em; text-shadow:0 0 10px rgba(255,184,0,.8); white-space:nowrap; }
        .atk-slalom-gate__label { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.16em; color:#dfffee; text-shadow:0 0 10px rgba(43,255,154,.8); }
        .atk-slide-wall { position:absolute;left:0;right:0;height:74px;top:0;transform:translateY(-50%);pointer-events:none;z-index:4; }
        .atk-slide-danger { position:absolute;left:4%;right:4%;top:50%;height:34px;transform:translateY(-50%);border-radius:999px;background:rgba(255,184,0,.14);border:1px solid rgba(255,184,0,.55);box-shadow:0 0 18px rgba(255,184,0,.28);animation:slideDangerPulse .45s ease-in-out infinite alternate; }
        .atk-slide-wall.is-failed .atk-slide-danger { background:rgba(255,68,85,.18);border-color:rgba(255,68,85,.7);box-shadow:0 0 24px rgba(255,68,85,.42); }
        .atk-slide-label { position:absolute;left:50%;top:-16px;transform:translateX(-50%);color:#FFB800;font:900 12px 'Barlow Condensed',sans-serif;letter-spacing:.13em;text-shadow:0 0 12px rgba(255,184,0,.85);white-space:nowrap; }
        .atk-slalom-defender { position:absolute; transform:translate(-50%,-50%); z-index:9; filter:drop-shadow(0 10px 12px rgba(0,0,0,.44)); animation: atkRunnerBob .42s ease-in-out infinite alternate; }
        .atk-slalom-defender.is-tackle { animation: atkTackle .62s ease-in-out infinite alternate; }
        .atk-slalom-defender.is-sliding { transform:translate(-50%,-50%) rotate(-68deg) scale(1.04);filter:drop-shadow(0 8px 10px rgba(0,0,0,.45));animation:atkSlideSkid .38s ease-in-out infinite alternate; }
        .atk-slalom-defender.is-press,.atk-slalom-defender.is-diagonal { filter:drop-shadow(0 0 14px rgba(25,211,255,.34)) drop-shadow(0 10px 12px rgba(0,0,0,.44)); }
        .atk-slalom-defender.is-bonus_guard { filter:drop-shadow(0 0 14px rgba(255,184,0,.48)) drop-shadow(0 10px 12px rgba(0,0,0,.44)); }
        .atk-slalom-defender::before { content:''; position:absolute; left:50%; top:-20px; width:3px; height:34px; transform:translateX(-50%); border-radius:999px; background:linear-gradient(rgba(255,255,255,.18), transparent); }
        .atk-slalom-defender__name { margin-top:-5px; text-align:center; color:rgba(255,255,255,.78); font:800 9px 'Barlow Condensed',sans-serif; letter-spacing:.06em; text-shadow:0 2px 8px rgba(0,0,0,.7); }
        .atk-kawaii { display:block; overflow:visible; }
        .atk-kawaii__leg--l { animation: atkLegL .34s ease-in-out infinite alternate; transform-origin:31px 60px; }
        .atk-kawaii__leg--r { animation: atkLegR .34s ease-in-out infinite alternate; transform-origin:48px 60px; }
        .atk-pass-pop { position:absolute; left:50%; top:-48px; transform:translateX(-50%); color:#2bff9a; font:900 15px 'Barlow Condensed',sans-serif; letter-spacing:.12em; text-shadow:0 0 12px rgba(43,255,154,.8); animation: atkPassPop .55s ease-out both; white-space:nowrap; }
        @keyframes atkGatePulse { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.9} 50%{transform:translate(-50%,-50%) scale(1.06);opacity:1} }
        @keyframes atkGatePass { from{transform:translate(-50%,-50%) scale(1);opacity:1} to{transform:translate(-50%,-50%) scale(1.35);opacity:.2} }
        @keyframes atkRunnerBob { from{translate:0 -2px} to{translate:0 3px} }
        @keyframes slideDangerPulse { from{opacity:.45} to{opacity:1} }
        @keyframes atkSlideSkid { from{translate:-1px -1px} to{translate:2px 2px} }
        @keyframes atkJumpWhoosh { 0%{opacity:.75;transform:translate(-50%,-50%) scale(.55)} 100%{opacity:0;transform:translate(-50%,-50%) scale(1.35)} }
        @keyframes atkTackle { from{rotate:-7deg; translate:0 -1px} to{rotate:7deg; translate:0 4px} }
        @keyframes atkLegL { from{transform:rotate(-6deg)} to{transform:rotate(8deg)} }
        @keyframes atkLegR { from{transform:rotate(8deg)} to{transform:rotate(-6deg)} }
        @keyframes atkPassPop { from{opacity:0;transform:translate(-50%,8px) scale(.8)} 20%{opacity:1} to{opacity:0;transform:translate(-50%,-18px) scale(1.1)} }
        @keyframes atkBonusFlash { from{opacity:1; transform:scale(.92)} to{opacity:0; transform:scale(1.08)} }
        @keyframes atkJumpButtonAlert { from{ transform:translateY(0); filter:brightness(1); } to{ transform:translateY(-2px); filter:brightness(1.18); } }

        .atk-controls { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"stat phase" "buttons buttons"; align-items:center; gap:9px 12px; padding:10px 14px max(18px, calc(env(safe-area-inset-bottom) + 12px)); background:linear-gradient(180deg,rgba(7,23,15,.94),#030b08); border-top:1px solid rgba(255,255,255,.1); box-shadow:0 -18px 34px rgba(0,0,0,.34); }
        .atk-controls__stat { grid-area:stat; color:#dffef0; font:900 12px 'Barlow Condensed',sans-serif; letter-spacing:.1em; text-transform:uppercase; }
        .atk-controls__stat small { display:inline; color:rgba(255,255,255,.5); font:800 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; margin-left:7px; }
        .atk-controls__buttons { grid-area:buttons; display:grid; grid-template-columns:minmax(70px,1fr) minmax(108px,1.22fr) minmax(70px,1fr); gap:10px; width:min(100%,430px); justify-self:center; }
        .atk-ctrl-btn { min-height:64px; border:1px solid rgba(255,255,255,.18); border-radius:16px; background:linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.045)); color:#fff; font:900 32px 'Barlow Condensed',sans-serif; line-height:1; box-shadow:0 12px 26px rgba(0,0,0,.32); touch-action:none; cursor:pointer; }
        .atk-ctrl-btn:active { transform:translateY(2px); background:rgba(43,255,154,.18); }
        .atk-ctrl-btn--evade { color:#1c1300; background:linear-gradient(180deg,#ffd96a,#ff9f1a); border-color:rgba(255,255,255,.42); font-size:13px; letter-spacing:.12em; }
        .atk-ctrl-btn--evade b { display:block; font-size:26px; line-height:.95; }
        .atk-ctrl-btn--evade.is-jumping { filter:brightness(.82);box-shadow:inset 0 0 0 2px rgba(0,0,0,.18); }
        .atk-ctrl-btn--evade.is-danger { animation: atkJumpButtonAlert .48s ease-in-out infinite alternate; box-shadow:0 0 20px rgba(255,184,0,.58), 0 12px 26px rgba(0,0,0,.32); }
        .atk-controls__phase { grid-area:phase; min-width:112px; text-align:right; color:#2bff9a; font:900 12px 'Barlow Condensed',sans-serif; letter-spacing:.14em; }
        .atk-controls__phase.is-jump { color:#FFB800; }
        .atk-controls__phase.is-combo { color:#FF4455; }
        .atk-controls__phase.is-moving { color:#19d3ff; }
        .atk-controls__phase.is-bonus { color:#FFB800; }
        .atk-controls__phase small { display:block; color:rgba(255,255,255,.62); font:800 10px 'Barlow Condensed',sans-serif; letter-spacing:.08em; margin-top:2px; max-width:132px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        /*  Shot game area  */
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
        .atk-shot-title {
          position: absolute;
          top: max(106px, calc(env(safe-area-inset-top) + 96px));
          left: 50%;
          transform: translateX(-50%);
          z-index: 28;
          width: max-content;
          max-width: calc(100% - 28px);
          padding: 7px 12px;
          border: 1px solid rgba(255,184,0,.38);
          border-radius: 999px;
          background: rgba(2,8,16,.58);
          color: #FFB800;
          font: 900 12px 'Barlow Condensed',sans-serif;
          letter-spacing: .14em;
          text-transform: uppercase;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
          backdrop-filter: blur(8px);
        }

        /*  Gauge at bottom of shot scene  */
        .atk-gauge-bottom {
          position: absolute; top: 52%; left: 0; right: 0; z-index: 20;
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 0 20px;
          transform: translateY(-50%);
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
          width: 78%; max-width: ${GAUGE_TRACK_PX}px; height: 28px;
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

        .atk-aim-hint {
          position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
          z-index: 25; pointer-events: none; text-align: center;
          padding: 8px 12px; border-radius: 999px;
          background: rgba(4, 12, 22, .72); border: 1px solid rgba(43,255,154,.34);
          color: #dfffee; font: 900 13px 'Barlow Condensed',sans-serif;
          letter-spacing: .13em; text-transform: uppercase;
          box-shadow: 0 0 20px rgba(43,255,154,.18);
          animation: atkBlink 0.72s ease-in-out infinite alternate;
        }
        .atk-aim-warning {
          position: absolute; top: 31%; left: 50%; transform: translate(-50%, -50%);
          z-index: 29; pointer-events: none; text-align: center;
          width: min(82%, 330px); padding: 12px 14px; border-radius: 16px;
          background: rgba(255, 68, 85, .18); border: 1.5px solid rgba(255, 68, 85, .72);
          color: #fff; font: 900 14px 'Barlow Condensed',sans-serif;
          letter-spacing: .11em; text-transform: uppercase; line-height: 1.18;
          box-shadow: 0 0 26px rgba(255,68,85,.34);
          animation: atkWarningPop 1.5s ease-out both;
        }
        @keyframes atkWarningPop { 0%{opacity:0;scale:.86} 12%{opacity:1;scale:1.04} 72%{opacity:1;scale:1} 100%{opacity:0;scale:.96} }
        /*  Result overlay  */
        .atk-result-overlay {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font: 900 clamp(40px,14vw,72px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em; text-shadow: 0 0 36px currentColor;
          animation: atkResultIn .25s ease-out both; z-index: 30; pointer-events: none;
        }
        @keyframes atkResultIn { from{transform:scale(.5);opacity:0} to{transform:scale(1);opacity:1} }

        /*  Shot intro transition overlay  */
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

        /*  Info bar (GD phase only)  */
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

      {/*  Tutorial overlay  */}
      {!tutorialDone && (
        <div className="atk-tutorial">
          <div className="atk-tutorial__title">DRIBBLE RUSH</div>
          <div className="atk-tutorial__instruction">
            Passe dans les portes vertes entre les defenseurs.
            <br /><br />
            Utilise <b style={{ color:'#2bff9a' }}>Gauche / Esquive / Droite</b> pour slalomer.
            <br /><br />
            <span style={{ color:'rgba(255,255,255,.5)', fontSize:'0.9em' }}> Clavier :   pour se deplacer  Espace pour sauter</span>
          </div>
          <span className="atk-tutorial__arrow"></span>
          <button
            type="button"
            className="atk-tutorial__btn"
            onClick={() => {
              sessionStorage.setItem('brakup:tut:atk2', '1')
              setTutorialDone(true)
            }}
          >
            OK  Jouer !
          </button>
        </div>
      )}

      {/*  Shot intro transition  */}
      {showShotIntro && (
        <div className="atk-transition">
          <div style={{ fontSize: 36 }}></div>
          <div className="atk-transition__title">ZONE DE TIR</div>
          <div className="atk-transition__sub">{flow >= 70 || shotBonusRef.current.powerShot ? 'TIR BOOSTE' : 'Maintiens, vise, relache'}</div>
          <div className="atk-transition__desc">
            Maintiens la cible dans la cage, vise un coin, puis relache quand la jauge est dans le vert.<br /><br />
            <b style={{ color:'#2bff9a' }}>Vert = tir cadre</b>  Gardien proche = arret  Hors vert = rate
          </div>
          <button type="button" className="atk-transition__btn" onClick={handleStartShot}>
             Tirer !
          </button>
        </div>
      )}

      {/*  GD game area  */}
      {phase === 'gd' && (
      <div
        className="atk-game"
      >
        {/*  GD Phase  */}
        {phase === 'gd' && (
          <div className="atk-gd">
            <div className="atk-gd-stripe-overlay" />
            {bonusFlash ? <div className="atk-bonus-flash" /> : null}
            <div className="atk-dribble-hud">
              <div>
                <div className="atk-dribble-title">DRIBBLE RUSH<small>Vague {gdCheckedRef.current + 1}/{cfg.waveCount} - {gdInstruction}</small></div>
                <div className="atk-flow-bar"><div className="atk-flow-bar__fill" style={{ width: `${flow}%` }} /></div>
              </div>
              <div className={`atk-combo-badge${comboDisplay >= 5 ? ' is-hot' : ''}`}>COMBO x{comboDisplay}</div>
            </div>

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

            {/* Wall container  translateY driven by RAF, single GPU composite per frame */}
            <div
              ref={wallContainerRef}
              style={{ position: 'absolute', inset: 0, willChange: 'transform', transform: 'translateY(0%)' }}
            >
              {gdWallsDisplay.map((wave, wi) => {
                const screenY = wave.worldY + gdFallPctRef.current
                if (screenY < -24 || screenY > 118) return null

                const gatePxWidth = `${wave.gateWidth}%`
                const bonusGatePxWidth = wave.bonusGateWidth ? `${wave.bonusGateWidth}%` : '0%' 
                const isSlideWave = wave.type === 'slide_wall' || wave.type === 'double_slide_wall'
                const isComboWave = wave.type === 'combo_gate_slide'
                const moveAmp = wave.moveAmplitude ?? 0
                const moveDur = wave.moveFrequency ? `${1 / wave.moveFrequency}s` : '1.4s'
                const moveDelay = wave.movePhase && wave.moveFrequency ? `${-(wave.movePhase / (Math.PI * 2)) / wave.moveFrequency}s` : '0s'
                const waveMotionStyle = {
                  position: 'absolute',
                  top: `${wave.worldY}%`,
                  left: 0,
                  right: 0,
                  height: 0,
                  pointerEvents: 'none',
                  '--atk-wave-shift': `${moveAmp}%`,
                  '--atk-wave-duration': moveDur,
                  '--atk-wave-delay': moveDelay,
                } as CSSProperties
                return (
                  <div key={wi} className={`atk-slalom-wave is-${wave.type}${moveAmp ? ' is-moving' : ''}`} style={waveMotionStyle}>
                    {isSlideWave || isComboWave ? (
                      <div className={`atk-slide-wall${wave.failed ? ' is-failed' : ''}${wave.passed ? ' is-passed' : ''}`}>
                        <div className="atk-slide-danger" />
                        <span className="atk-slide-label">{wave.type === 'double_slide_wall' ? 'DOUBLE TACLE : SAUTE !' : isComboWave ? 'PLACE-TOI + SAUTE !' : 'SAUTE !'}</span>
                      </div>
                    ) : null}
                    {!isSlideWave ? (
                      <div className={`atk-slalom-gate${wave.passed ? ' is-passed' : ''}${wave.failed ? ' is-failed' : ''}${isComboWave ? ' is-combo' : ''}${wave.type === 'narrow_gate' ? ' is-narrow' : ''}${wave.type === 'moving_gate' ? ' is-moving' : ''}`} style={{ left: `${wave.gateCenterX}%`, width: gatePxWidth }}>
                        <span className="atk-slalom-gate__label">VERT</span>
                        {wave.passed && !wave.bonusCollected ? <span className="atk-pass-pop">PASSE !</span> : null}
                      </div>
                    ) : wave.passed ? <span className="atk-pass-pop atk-pass-pop--slide">SAUTE !</span> : null}
                    {wave.hasBonus && wave.bonusGateCenterX != null && wave.bonusGateWidth != null ? (
                      <div className={`atk-slalom-gate is-bonus${wave.bonusCollected ? ' is-passed' : ''}${wave.failed ? ' is-failed' : ''}`} style={{ left: `${wave.bonusGateCenterX}%`, width: bonusGatePxWidth }}>
                        <span className="atk-slalom-gate__label">BONUS</span>
                        <span className="atk-bonus-choice-label">RISQUE = BONUS</span>
                        {wave.bonusCollected ? <span className="atk-pass-pop">BONUS !</span> : null}
                      </div>
                    ) : null}
                    {wave.defenders.map((defender) => (
                      <div key={defender.id} className={`atk-slalom-defender is-${defender.variant}`} style={{ left: `${defender.x}%`, top: defender.yOffset }}>
                        <KawaiiFootballer
                          label={defender.label}
                          jerseyColor={opponentJerseyColor}
                          accentColor={opponentAccentColor}
                          shortsColor={opponentKit?.shorts ?? '#1a0a3a'}
                          textColor={opponentKit?.text ?? '#ffffff'}
                        />
                        <div className="atk-slalom-defender__name">{defender.label}</div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Player token  kawaii avatar, top set in CSS, X via compositor transform */}
            <div
              ref={playerElRef}
              className={[
                'atk-gd-player',
                gdJumping ? 'atk-gd-player--pass' : '',
                gdFlash   ? 'atk-gd-player--flash' : '',
                flow >= 40 ? 'is-flowing' : '',
                flow >= 100 ? 'is-max-flow' : '',
              ].join(' ')}
              style={{ transform: `translateX(${(gdPlayerXRef.current / 100) * gameWidthRef.current - 29}px)`, '--atk-player-x': `${(gdPlayerXRef.current / 100) * gameWidthRef.current - 29}px` } as CSSProperties}
            >
              <div className="atk-player-shadow" />
              <div className="atk-player-inner">
                <KawaiiFootballer
                  label={attackerShort ?? '9'}
                  jerseyColor={playerJerseyColor}
                  accentColor={playerAccentColor}
                  shortsColor={playerShortsColor}
                  textColor={playerTextColor}
                  withBall
                  isPlayer
                />
                <span className="atk-player-whoosh" />
              </div>
            </div>

            {/* Comment popup */}
            {gdComment && (
              <div className="atk-row-comment">{gdComment}</div>
            )}
          </div>
        )}
      </div>
      )}

      {/*  Shot Phase  full screen  */}
      {phase === 'shot' && (
        <div
          className="atk-shot-game"
          ref={shotGameRef}
        >
          {shotTitle ? <div className="atk-shot-title">{shotTitle}</div> : null}
          <GoalView
            compact
            difficulty={difficulty}
            keeperX={keeperX}
            keeperY={keeperY}
            target={!ballFlight && aimCursorPos ? { x: aimCursorPos.x, y: aimCursorPos.y, clientX: 0, clientY: 0 } : null}
            ballFlight={ballFlight}
            showAimGuide={!ballFlight}
            interactive={false}
            goalkeeperColor={opponentJerseyColor}
            goalkeeperSecondaryColor={opponentAccentColor}
            isKicking={isKicking}
            targetActive={hasAimedTarget}
          />
          {/* Hint when no aim yet */}
          {!hasAimedTarget && !ballFlight && !resultLabel && (
            <div className="atk-aim-hint">MAINTIENS ET DEPLACE LA CIBLE</div>
          )}
          {shotAimWarning && !ballFlight && !resultLabel && (
            <div className="atk-aim-warning">DEPLACE LA CIBLE POUR VISER AVANT PUIS RELACHE AU BON MOMENT</div>
          )}

          {/* Gauge  visible until tir fired */}
          {!resultLabel && (
            <div className="atk-gauge-bottom">
              <div className="atk-gauge-label">RELACHE DANS LE VERT !</div>
              <div className="atk-gauge-track">
                <div className="atk-gauge-green" style={{ left: `${gaugeGreenLeftPct}%`, width: `${(effectiveGaugeGreenPx / GAUGE_TRACK_PX) * 100}%` }} />
                <div ref={gaugeCursorElRef} className="atk-gauge-cursor" />
              </div>
            </div>
          )}

          {/* Result overlay */}
          {resultLabel && (
            <div className="atk-result-overlay" style={{ color: resultLabel === 'BUT !' ? '#2bff9a' : resultLabel === 'ARRETE !' ? '#FFB800' : '#FF4455' }}>
              {resultLabel}
            </div>
          )}
        </div>
      )}

      {phase === 'gd' && (
        <div className="atk-controls">
          <div className="atk-controls__stat">FLOW {flow}<small>Combo x{comboDisplay}</small></div>
          <div className="atk-controls__buttons">
            <button type="button" className="atk-ctrl-btn" data-control="left" aria-label="Gauche" onPointerDown={(e) => { e.stopPropagation(); keysRef.current.left = true }} onPointerUp={() => { keysRef.current.left = false }} onPointerCancel={() => { keysRef.current.left = false }} onPointerLeave={() => { keysRef.current.left = false }}>←</button>
            <button type="button" className={`atk-ctrl-btn atk-ctrl-btn--evade${gdJumping ? ' is-jumping' : ''}${nextGdWave?.requiresJump ? ' is-danger' : ''}`} data-control="jump" aria-label="Saut" onPointerDown={(e) => { e.stopPropagation(); handleJump() }}><b>↑</b>SAUT</button>
            <button type="button" className="atk-ctrl-btn" data-control="right" aria-label="Droite" onPointerDown={(e) => { e.stopPropagation(); keysRef.current.right = true }} onPointerUp={() => { keysRef.current.right = false }} onPointerCancel={() => { keysRef.current.right = false }} onPointerLeave={() => { keysRef.current.right = false }}>→</button>
          </div>
          <div className={`atk-controls__phase${gdBadgeClass}`}>SLALOM<small>{gdInstruction}</small></div>
        </div>
      )}
    </section>
  )
}

export default AttackPhase
