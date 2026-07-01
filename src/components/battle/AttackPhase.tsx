import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BattleDifficulty, BattleScorer } from '../../types'
import type { TeamKit } from '../../lib/teamKits'
import { playGameSound } from '../../lib/useGameAudio'
import { sfx } from '../../lib/sfx'
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
  onRoundEnd: (isGoal: boolean, reason?: AttackEndReason, scorer?: BattleScorer) => void
  isPaused?: boolean
  onAudioOverride?: (src: string | null) => void
  shotOnly?: boolean
  shotAudioMode?: 'normal' | 'heartOnly'
  shotTitle?: string
  showControls?: boolean
}

//  Config 
const ATTACK_CFG = {
  easy:   { waveCount: 18, gateWidth: 34, narrowGateWidth: 26, gdSpeed: 28, difficultyRamp: 0.34, spacing: 42, gaugeGreenPx: 42, gaugeSpeed: 0.78 },
  medium: { waveCount: 22, gateWidth: 28, narrowGateWidth: 21, gdSpeed: 35, difficultyRamp: 0.52, spacing: 40, gaugeGreenPx: 36, gaugeSpeed: 1.15 },
  hard:   { waveCount: 26, gateWidth: 23, narrowGateWidth: 17, gdSpeed: 41, difficultyRamp: 0.74, spacing: 37, gaugeGreenPx: 30, gaugeSpeed: 1.6 },
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
const DASH_DISTANCE = 18
const DASH_DURATION = 210
const DASH_COOLDOWN = 620
const FEVER_DURATION = 3600

const GD_COMMENTS = [
  'Beau dribble !', 'Petit pont !', 'Il passe !', 'Quel crochet !',
  'Magnifique !', 'Bien joue !', 'En pleine course !', 'PASSE !',
]

const GAUGE_TRACK_PX = 260
const FALLBACK_ATTACKER_NUMBERS = [9, 10, 11, 7, 20, 19, 21, 18, 14, 17]
const KNOWN_PLAYER_NUMBERS: Record<string, number> = {
  'kylian mbappe': 10,
  'ousmane dembele': 11,
  'marcus thuram': 9,
  'lionel messi': 10,
  'julian alvarez': 9,
  'lautaro martinez': 22,
  'vinicius junior': 7,
  rodrygo: 10,
  endrick: 9,
  'harry kane': 9,
  'jude bellingham': 10,
  'phil foden': 11,
  'jonathan david': 9,
  'alphonso davies': 19,
  'cyle larin': 17,
}

type SlalomWaveType = 'gate' | 'narrow_gate' | 'slide_wall' | 'double_slide_wall' | 'diagonal_press' | 'moving_gate' | 'bonus_choice' | 'combo_gate_slide'
type BonusKind = 'coin' | 'boots' | 'whistle'
type DribbleQuality = 'clean' | 'perfect'

type SlalomDefender = {
  id: string
  x: number
  yOffset: number
  label: string
  variant: 'normal' | 'press' | 'tackle' | 'sliding' | 'diagonal' | 'bonus_guard'
  moveAmplitude?: number
  moveDuration?: number
  moveDelay?: number
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
  bonusKind?: BonusKind
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

function normalizePlayerName(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function playerLastName(value: string) {
  const parts = value.trim().split(/\s+/)
  return parts[parts.length - 1] || value
}

function buildShooterOptions(players: string[], teamId: string): BattleScorer[] {
  const uniquePlayers = Array.from(new Set(players.map((name) => name.trim()).filter(Boolean)))
  const source = uniquePlayers.length ? uniquePlayers.reverse() : [`Buteur ${teamId.toUpperCase()}`]

  return source.map((name, index) => ({
    name,
    teamId,
    number: KNOWN_PLAYER_NUMBERS[normalizePlayerName(name)] ?? FALLBACK_ATTACKER_NUMBERS[index % FALLBACK_ATTACKER_NUMBERS.length],
    controlled: true,
  }))
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
  if (difficulty === 'easy') return [['gate', 36], ['narrow_gate', 18], ['slide_wall', 14], ['diagonal_press', 10], ['bonus_choice', 16], ['moving_gate', 6]]
  if (difficulty === 'medium') return [['gate', 22], ['narrow_gate', 18], ['slide_wall', 14], ['double_slide_wall', 10], ['diagonal_press', 16], ['bonus_choice', 14], ['moving_gate', 10], ['combo_gate_slide', 6]]
  return [['gate', 14], ['narrow_gate', 16], ['slide_wall', 16], ['double_slide_wall', 12], ['diagonal_press', 18], ['bonus_choice', 14], ['moving_gate', 12], ['combo_gate_slide', 8]]
}

function pickWaveType(rng: () => number, difficulty: BattleDifficulty, previous: SlalomWaveType[], index: number): SlalomWaveType {
  const scripted: SlalomWaveType[][] = [
    ['gate', 'bonus_choice', 'slide_wall'],
    ['narrow_gate', 'moving_gate', 'gate'],
    ['gate', 'slide_wall', 'diagonal_press'],
    ['bonus_choice', 'narrow_gate', 'moving_gate'],
    ['slide_wall', 'narrow_gate', 'combo_gate_slide'],
  ]
  if (index > 2 && rng() < 0.34) return scripted[Math.floor(rng() * scripted.length)][index % 3]
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const type = pickWeighted(rng, waveWeights(difficulty))
    const last = previous[previous.length - 1]
    const before = previous[previous.length - 2]
    if (last === type && before === type) continue
    if ((type === 'combo_gate_slide' || type === 'double_slide_wall') && last === type) continue
    if (difficulty === 'easy' && (type === 'double_slide_wall' || type === 'combo_gate_slide')) continue
    if (difficulty === 'easy' && type === 'combo_gate_slide') continue
    if (difficulty === 'medium' && type === 'combo_gate_slide' && rng() < 0.35) continue
    return type
  }
  return 'gate'
}

function makeGateDefenders(i: number, center: number, gateWidth: number, players: string[], type: SlalomWaveType, rng: () => number, bonusGate?: { center: number; width: number }): SlalomDefender[] {
  const half = gateWidth / 2
  const yJitter = (index: number) => [-18, 12, -4, 20][index % 4] + Math.round((rng() - 0.5) * 6)
  const gates = [{ left: center - half, right: center + half }]
  if (bonusGate) gates.push({ left: bonusGate.center - bonusGate.width / 2, right: bonusGate.center + bonusGate.width / 2 })
  gates.sort((a, b) => a.left - b.left)

  const blockers: number[] = []
  const addBlocker = (x: number) => {
    const clamped = Math.max(7, Math.min(93, x))
    if (blockers.every((existing) => Math.abs(existing - clamped) >= 9)) blockers.push(clamped)
  }

  addBlocker(gates[0].left - 9 - rng() * 2)
  addBlocker(gates[gates.length - 1].right + 9 + rng() * 2)

  for (let g = 0; g < gates.length - 1; g += 1) {
    const gap = gates[g + 1].left - gates[g].right
    if (gap > 15) addBlocker((gates[g].right + gates[g + 1].left) / 2)
  }

  if (!bonusGate && (type === 'diagonal_press' || type === 'combo_gate_slide' || type === 'moving_gate' || rng() < 0.68)) {
    addBlocker(center + (center < 50 ? 1 : -1) * (half + 23 + rng() * 7))
  }

  return blockers.slice(0, 4).map((x, index) => ({
    id: `${i}-block-${index}`,
    x,
    yOffset: yJitter(index),
    label: defenderLabel(players, i * 4 + index, String([4, 5, 6, 8, 2, 3, 7, 10][(i + index) % 8])),
    variant: type === 'combo_gate_slide' && index === blockers.length - 1 ? 'sliding' : type === 'diagonal_press' || index === 2 ? 'press' : 'normal',
    moveAmplitude: type === 'diagonal_press' || type === 'moving_gate' || type === 'combo_gate_slide' || index === 2 ? 5 + rng() * 7 : rng() < 0.55 ? 3 + rng() * 4 : 0,
    moveDuration: 0.58 + rng() * 0.48,
    moveDelay: -rng() * 0.9,
  }))
}

function makeSlideDefenders(i: number, players: string[], doubleLine: boolean): SlalomDefender[] {
  const xs = doubleLine ? [22, 45, 68, 84] : [25, 50, 75]
  return xs.map((x, index) => ({
    id: `${i}-slide-${index}`,
    x,
    yOffset: doubleLine && index % 2 ? 17 : doubleLine ? -17 : (index - 1) * 5,
    label: defenderLabel(players, i * 4 + index, String([2, 4, 5, 6][index % 4])),
    variant: 'sliding' as const,
    moveAmplitude: doubleLine ? 8 : 5,
    moveDuration: doubleLine ? 0.52 : 0.66,
    moveDelay: index * -0.12,
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
    const bonusEvery = params.difficulty === 'easy' ? 5 : params.difficulty === 'medium' ? 4 : 4
    const forceBonus = i > 2 && i < cfg.waveCount - 2 && i % bonusEvery === 1
    const forceDiagonal = i > 3 && params.difficulty !== 'easy' && i % 6 === 3
    const rawType = forceBonus ? 'bonus_choice' : forceDiagonal ? 'diagonal_press' : pickWaveType(rng, params.difficulty, types, i)
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
    const moveAmplitude = isMoving ? (params.difficulty === 'hard' ? 11 + rng() * 5 : params.difficulty === 'medium' ? 8 + rng() * 5 : 5 + rng() * 4) : 0
    const safeCenter = Math.max(16 + moveAmplitude, Math.min(84 - moveAmplitude, center))
    const bonusDirection = safeCenter < 50 ? 1 : -1
    const minBonusGap = gateWidth / 2 + Math.max(14, cfg.narrowGateWidth - 2) / 2 + 18
    const bonusGateCenterX = isBonus ? Math.max(18, Math.min(82, safeCenter + bonusDirection * (minBonusGap + rng() * 6))) : undefined
    const bonusGateWidth = isBonus ? Math.max(16, cfg.narrowGateWidth - 2) : undefined
    const bonusKind = isBonus ? (['coin', 'boots', 'whistle', 'boots'] as const)[Math.floor(rng() * 4)] : undefined
    const defenders = isSlide
      ? makeSlideDefenders(i, params.players, type === 'double_slide_wall')
      : makeGateDefenders(i, safeCenter, gateWidth, params.players, type, rng, bonusGateCenterX != null && bonusGateWidth != null ? { center: bonusGateCenterX, width: bonusGateWidth } : undefined)

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
      bonusKind,
      bonusCollected: false,
      allowsJump: false,
      moveAmplitude,
      moveFrequency: isMoving ? 0.9 + rng() * 0.48 : 0,
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

function evaluateWaveSuccess(wave: SlalomWave, playerX: number, jump: { isActive: boolean }, elapsed: number, dashActive = false): { success: boolean; bonus?: boolean; label: string; quality?: DribbleQuality } {
  const halfGate = wave.gateWidth / 2 + (dashActive && isGatePassWave(wave) ? 3 : 0)
  const center = getWaveGateCenter(wave, elapsed)
  const inGate = playerX >= center - halfGate && playerX <= center + halfGate
  const perfectGate = inGate && Math.abs(playerX - center) <= Math.max(3.2, wave.gateWidth * 0.16)
  const inBonusGate = wave.bonusGateCenterX != null && wave.bonusGateWidth != null
    ? playerX >= wave.bonusGateCenterX - wave.bonusGateWidth / 2 - (dashActive ? 2 : 0) && playerX <= wave.bonusGateCenterX + wave.bonusGateWidth / 2 + (dashActive ? 2 : 0)
    : false
  const perfectBonus = inBonusGate && wave.bonusGateCenterX != null && wave.bonusGateWidth != null
    ? Math.abs(playerX - wave.bonusGateCenterX) <= Math.max(2.8, wave.bonusGateWidth * 0.16)
    : false
  const quality: DribbleQuality = perfectGate || perfectBonus ? 'perfect' : 'clean'

  if (wave.type === 'gate') return { success: inGate, label: inGate ? perfectGate ? 'PERFECT !' : 'PASSE !' : 'INTERCEPTE !', quality }
  if (wave.type === 'narrow_gate') return { success: inGate, label: inGate ? perfectGate ? 'PETIT PONT PARFAIT !' : 'PETIT PONT !' : 'HORS PORTE !', quality }
  if (wave.type === 'slide_wall') return { success: jump.isActive, label: jump.isActive ? 'SAUTE !' : 'TACLE !' }
  if (wave.type === 'double_slide_wall') return { success: jump.isActive, label: jump.isActive ? 'DOUBLE TACLE EVITE !' : 'TACLE !' }
  if (wave.type === 'diagonal_press') return { success: inGate, label: inGate ? perfectGate ? 'CROCHET PARFAIT !' : 'CROCHET !' : 'PRESSE !', quality }
  if (wave.type === 'moving_gate') return { success: inGate, label: inGate ? perfectGate ? 'TIMING PARFAIT !' : 'BIEN LU !' : 'INTERCEPTE !', quality }
  if (wave.type === 'bonus_choice') {
    if (inBonusGate) return { success: true, bonus: true, label: perfectBonus ? 'BONUS PERFECT !' : 'BONUS !', quality }
    if (inGate) return { success: true, label: perfectGate ? 'PERFECT !' : 'PASSE !', quality }
    return { success: false, label: 'INTERCEPTE !' }
  }
  if (wave.type === 'combo_gate_slide') return { success: inGate && jump.isActive, label: inGate && jump.isActive ? perfectGate ? 'COMBO PERFECT !' : 'MAGNIFIQUE !' : 'TROP LENT !', quality }
  return { success: inGate, label: inGate ? perfectGate ? 'PERFECT !' : 'PASSE !' : 'INTERCEPTE !', quality }
}

function isGatePassWave(wave: SlalomWave) {
  return wave.type === 'gate'
    || wave.type === 'narrow_gate'
    || wave.type === 'diagonal_press'
    || wave.type === 'moving_gate'
    || wave.type === 'bonus_choice'
    || wave.type === 'combo_gate_slide'
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
  showControls = false,
}: AttackPhaseProps) {
  const cfg = ATTACK_CFG[difficulty]
  const slalomSeedRef = useRef(`${homeTeamId}-${awayTeamId}-${difficulty}-${Date.now()}-${Math.random()}`)
  const playerJerseyColor = playerKit?.primary ?? '#2bff9a'
  const playerAccentColor = playerKit?.secondary ?? '#0b1422'
  const playerShortsColor = playerKit?.shorts ?? '#1a0a3a'
  const playerTextColor = playerKit?.text ?? '#0b1422'
  const opponentJerseyColor = opponentKit?.primary ?? '#FF4455'
  const opponentAccentColor = opponentKit?.secondary ?? '#7dd3fc'

  // Utiliser tous les joueurs de l'equipe (plus de limite a 6)
  // Pour commencer par les attaquants, il faudrait avoir les roles dans les donnees
  const forwardPlayers = useMemo(() => [...homeTeamPlayers], [homeTeamPlayers])
  const shooterOptions = useMemo(() => buildShooterOptions(forwardPlayers, homeTeamId), [homeTeamId, forwardPlayers])
  const [shooterIndex, setShooterIndex] = useState(0)
  const selectedShooterIndex = shooterIndex % shooterOptions.length
  const selectedShooter = shooterOptions[selectedShooterIndex] ?? shooterOptions[0]
  const selectedShooterRef = useRef<BattleScorer>(selectedShooter)
  selectedShooterRef.current = selectedShooter
  const attackerName = selectedShooter.name
  const attackerShort = playerLastName(attackerName).slice(0, 7)

  //  Tutorial 
  const [tutorialDone, setTutorialDone] = useState(
    () => shotOnly
  )
  const [preCountdownNum, setPreCountdownNum] = useState<number | null>(null)

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
  const dashUntilRef     = useRef(0)
  const dashCooldownUntilRef = useRef(0)
  const dashDirectionRef = useRef<1 | -1>(1)
  const dribbleBoostUntilRef = useRef(0)
  const keysRef         = useRef({ left: false, right: false })
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gdCheckedRef    = useRef(0)  // count of walls passed
  const gdElapsedRef    = useRef(0)  // elapsed time for GD acceleration
  const crowdCueRef    = useRef(new Set<string>())
  const slalomCompletePendingRef = useRef(false)
  const slalomCompleteWorldYRef = useRef<number | null>(null)
  const comboRef       = useRef(0)
  const maxComboRef    = useRef(0)
  const perfectStreakRef = useRef(0)
  const feverUntilRef  = useRef(0)
  const flowRef        = useRef(0)
  const shotBonusRef   = useRef({ widerGreen: 0, slowKeeper: 0, powerShot: false })
  const [comboDisplay, setComboDisplay] = useState(0)
  const [flow, setFlow] = useState(0)
  const [bonusFlash, setBonusFlash] = useState(false)
  const [dashActive, setDashActive] = useState(false)
  const [powerupLabel, setPowerupLabel] = useState<string | null>(null)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [feverActive, setFeverActive] = useState(false)

  const startTutorialCountdown = useCallback(() => {
    sfx.click()
    sfx.countdownTick()
    setPreCountdownNum(3)
    const t1 = window.setTimeout(() => { setPreCountdownNum(2); sfx.countdownTick() }, 800)
    const t2 = window.setTimeout(() => { setPreCountdownNum(1); sfx.countdownTick() }, 1600)
    const t3 = window.setTimeout(() => { setPreCountdownNum(0); sfx.countdownGo() }, 2400)
    const t4 = window.setTimeout(() => {
      setPreCountdownNum(null)
      setTutorialDone(true)
    }, 3050)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
    }
  }, [])

  // Shot phase: aim cursor follows hold/drag; release fires.
  const aimCursorRef = useRef<{ x: number; y: number } | null>(shotOnly ? { x: 50, y: 30 } : null)
  const [aimCursorPos, setAimCursorPos] = useState<{ x: number; y: number } | null>(() => shotOnly ? { x: 50, y: 30 } : null)
  const [hasAimedTarget, setHasAimedTarget] = useState(false)
  const hasAimedTargetRef = useRef(false)
  const aimStartRef = useRef<{ x: number; y: number } | null>(null)
  const [shotAimWarning, setShotAimWarning] = useState(false)
  const [shooterSelectionDone, setShooterSelectionDone] = useState(false)
  const [shotTutorialDone, setShotTutorialDone] = useState(false)
  const [shotJoystick, setShotJoystick] = useState<{
    pullX: number
    pullY: number
    distance: number
    angle: number
    power: number
  } | null>(null)
  const aimWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shotFiredRef = useRef(false)
  const shotGameRef  = useRef<HTMLDivElement>(null)
  const isAimingRef = useRef(false)

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
    if (phase !== 'shot' || showShotIntro || !shooterSelectionDone || !shotTutorialDone) return
    onAudioOverride?.(shotAudioMode === 'heartOnly' ? null : '/audio/final-kick-freeze.mp3')
    const heart = playGameSound('/audio/heart.mp3', { volume: shotAudioMode === 'heartOnly' ? 0.88 : 0.7, loop: true, kind: 'ambience' })
    return () => {
      heart?.stop()
      onAudioOverride?.(null)
    }
  }, [phase, showShotIntro, onAudioOverride, shotAudioMode, shooterSelectionDone, shotTutorialDone])

  useEffect(() => {
    if (!shotOnly) return
    phaseRef.current = 'shot'
    setPhase('shot')
    const defaultAim = { x: 50, y: 30 }
    aimCursorRef.current = defaultAim
    setAimCursorPos(defaultAim)
    setShooterSelectionDone(false)
    setShotTutorialDone(false)
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
    perfectStreakRef.current = 0
    feverUntilRef.current = 0
    flowRef.current = 0
    dashUntilRef.current = 0
    dashCooldownUntilRef.current = 0
    dribbleBoostUntilRef.current = 0
    shotBonusRef.current = { widerGreen: 0, slowKeeper: 0, powerShot: false }
    setComboDisplay(0)
    setFlow(0)
    setBonusFlash(false)
    setDashActive(false)
    setPowerupLabel(null)
    setPerfectStreak(0)
    setFeverActive(false)
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
  const finish = useCallback((isGoal: boolean, reason: AttackEndReason, scorer?: BattleScorer) => {
    if (endedRef.current) return
    endedRef.current = true
    onRoundEnd(isGoal, reason, scorer)
  }, [onRoundEnd])

  const getEffectiveGaugeGreenPx = useCallback(() => {
    return Math.min(110, cfg.gaugeGreenPx + shotBonusRef.current.widerGreen * 4 + (flowRef.current >= 70 ? 4 : 0) + (shotBonusRef.current.powerShot ? 4 : 0))
  }, [cfg.gaugeGreenPx])

  const registerDribbleSuccess = useCallback((wave: SlalomWave, outcome: { bonus?: boolean; label: string; quality?: DribbleQuality }) => {
    const comboIncrement = outcome.bonus ? 2 : 1
    comboRef.current += comboIncrement
    maxComboRef.current = Math.max(maxComboRef.current, comboRef.current)
    setComboDisplay(comboRef.current)

    if (outcome.quality === 'perfect') {
      perfectStreakRef.current += 1
      setPerfectStreak(perfectStreakRef.current)
      shotBonusRef.current.widerGreen += 0.35
      if (perfectStreakRef.current > 0 && perfectStreakRef.current % 3 === 0) {
        feverUntilRef.current = performance.now() + FEVER_DURATION
        shotBonusRef.current.widerGreen += 1
        shotBonusRef.current.slowKeeper += 1
        setFeverActive(true)
        setPowerupLabel('FEVER MODE')
        window.setTimeout(() => setFeverActive(false), FEVER_DURATION)
        window.setTimeout(() => setPowerupLabel(null), 1250)
      }
    } else if (!outcome.bonus) {
      perfectStreakRef.current = 0
      setPerfectStreak(0)
    }

    const qualityGain = outcome.quality === 'perfect' ? 6 : 0
    const feverGain = performance.now() < feverUntilRef.current ? 3 : 0
    const nextFlow = Math.min(100, flowRef.current + flowGainForWave(wave, outcome.bonus) + qualityGain + feverGain)
    const wasBelowMax = flowRef.current < 100
    flowRef.current = nextFlow
    setFlow(nextFlow)

    if (outcome.bonus) {
      wave.bonusCollected = true
      const bonusKind = wave.bonusKind ?? 'coin'
      if (bonusKind === 'coin') {
        shotBonusRef.current.widerGreen += 1
        setPowerupLabel('PIECE + ZONE VERTE')
      } else if (bonusKind === 'boots') {
        dribbleBoostUntilRef.current = performance.now() + 3200
        shotBonusRef.current.widerGreen += 0.5
        setPowerupLabel('CRAMPONS TURBO')
      } else {
        shotBonusRef.current.slowKeeper += 1
        setPowerupLabel('SIFFLET - GARDIEN RALENTI')
      }
      setBonusFlash(true)
      window.setTimeout(() => setBonusFlash(false), 420)
      window.setTimeout(() => setPowerupLabel(null), 1150)
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
    sfx.jump()
    jumpStartedAtRef.current = performance.now()
    isJumpingRef.current = true
    setGdJumping(true)
    setTimeout(() => {
      isJumpingRef.current = false
      jumpStartedAtRef.current = null
      setGdJumping(false)
    }, JUMP_DURATION)
  }

  const handleDash = (direction?: -1 | 1) => {
    const now = performance.now()
    if (now < dashCooldownUntilRef.current) return
    const inferredDirection: -1 | 1 = direction
      ?? (keysRef.current.left && !keysRef.current.right ? -1 : keysRef.current.right && !keysRef.current.left ? 1 : gdPlayerXRef.current < 50 ? 1 : -1)
    dashDirectionRef.current = inferredDirection
    dashUntilRef.current = now + DASH_DURATION
    dashCooldownUntilRef.current = now + (now < feverUntilRef.current ? DASH_COOLDOWN * 0.58 : DASH_COOLDOWN)
    gdPlayerXRef.current = Math.max(3, Math.min(97, gdPlayerXRef.current + inferredDirection * DASH_DISTANCE))
    if (playerElRef.current) {
      const width = gameWidthRef.current || containerRectRef.current.width
      const x = (gdPlayerXRef.current / 100) * width - 29
      playerElRef.current.style.transform = `translateX(${x}px)`
      playerElRef.current.style.setProperty('--atk-player-x', `${x}px`)
    }
    sfx.jump()
    setDashActive(true)
    setGdComment(now < feverUntilRef.current ? 'FEVER DASH !' : 'ESQUIVE !')
    if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
    commentTimerRef.current = setTimeout(() => setGdComment(null), 520)
    window.setTimeout(() => setDashActive(false), DASH_DURATION)
  }

  const handleEvade = () => {
    const nextWave = gdWallsRef.current.find((wave) => !wave.checked)
    if (nextWave?.requiresJump) {
      handleJump()
      return
    }
    handleDash()
  }

  //  Keyboard handler 
  useEffect(() => {
    if (!tutorialDone) return
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { keysRef.current.left  = true; e.preventDefault() }
      if (e.key === 'ArrowRight') { keysRef.current.right = true; e.preventDefault() }
      if (e.key === ' ')          { handleJump(); e.preventDefault() }
      if (e.key === 'Shift')      { handleDash(); e.preventDefault() }
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

      const isTurboActive = now < dribbleBoostUntilRef.current
      const isFeverActive = now < feverUntilRef.current
      const playerSpeed = PLAYER_SPEED * (isTurboActive ? 1.22 : 1) * (flowRef.current >= 70 ? 1.08 : 1) * (isFeverActive ? 1.14 : 1)
      const dashActiveNow = now < dashUntilRef.current

      // Move player X via keyboard  direct DOM, no React re-render
      if (keysRef.current.left) {
        gdPlayerXRef.current = Math.max(3, gdPlayerXRef.current - playerSpeed * delta)
      }
      if (keysRef.current.right) {
        gdPlayerXRef.current = Math.min(97, gdPlayerXRef.current + playerSpeed * delta)
      }
      if (dashActiveNow) {
        gdPlayerXRef.current = Math.max(3, Math.min(97, gdPlayerXRef.current + dashDirectionRef.current * 48 * delta))
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
          playGameSound('/audio/crowd.mp3', { volume: 0.78, kind: 'ambience' })
        }

        // Trigger when wall top edge reaches PLAYER_Y band
        if (screenY < GD_PLAYER_Y - 4) continue

        wall.checked = true
        const jump = getJumpState(now)
        const outcome = evaluateWaveSuccess(wall, playerX, jump, gdElapsedRef.current, dashActiveNow)

        if (outcome.success) {
          wall.passed = true
          registerDribbleSuccess(wall, outcome)
          if (isGatePassWave(wall)) sfx.gatePass()
          gdCheckedRef.current++
          setGdWallsDisplay([...gdWallsRef.current])
          const comboLabel = outcome.quality === 'perfect'
            ? perfectStreakRef.current >= 3 ? `PERFECT x${perfectStreakRef.current}` : 'PERFECT !'
            : comboRef.current >= 10 ? 'INARRETABLE !' : comboRef.current >= 7 ? 'FLOW !' : comboRef.current >= 5 ? 'DRIBBLE FOU !' : comboRef.current >= 3 ? 'CROCHET !' : outcome.label
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
    if (phase !== 'shot' || showShotIntro || !shooterSelectionDone || !shotTutorialDone) return
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
        window.setTimeout(() => {
          setBallFlight({ id: Date.now(), target: { x: 118, y: -18, clientX: 0, clientY: 0 }, state: 'miss', duration: FLIGHT_MS })
          window.setTimeout(() => setResultLabel('RATE !'), FLIGHT_MS)
          window.setTimeout(() => finish(false, 'miss', selectedShooterRef.current), FLIGHT_MS + 700)
        }, KICK_DELAY_MS)
        return
      }

      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, showShotIntro, shooterSelectionDone, shotTutorialDone, cfg.gaugeSpeed, difficulty, finish])

  const isGoalTargetInsideFrame = (target: { x: number; y: number }) => (
    target.x >= 0 && target.x <= 100 && target.y >= 0 && target.y <= 100
  )

  // Angry Birds style shot: pull the ball down from the player's foot.
  // The release target can be inside or outside the goal frame.
  const pointerToShotTarget = (clientX: number, clientY: number): { target: { x: number; y: number }; pullX: number; pullY: number; distance: number; angle: number; power: number } => {
    const rect = shotRectRef.current
    if (!rect.width || !rect.height) {
      return { target: { x: 50, y: 82 }, pullX: 0, pullY: 0, distance: 0, angle: 90, power: 0 }
    }

    const originX = rect.left + rect.width * 0.5
    const originY = rect.top + rect.height * 0.86
    const maxPullX = Math.max(72, rect.width * 0.34)
    const maxPullY = Math.max(92, rect.height * 0.32)
    const pullX = Math.max(-maxPullX, Math.min(maxPullX, clientX - originX))
    const pullY = Math.max(0, Math.min(maxPullY, clientY - originY))
    const power = Math.max(0, Math.min(1, pullY / maxPullY))
    const target = {
      x: 50 - (pullX / maxPullX) * 92,
      y: 92 - power * 132,
    }
    const distance = Math.hypot(pullX, pullY)
    const angle = Math.atan2(pullY, pullX) * 180 / Math.PI
    return { target, pullX, pullY, distance, angle, power }
  }

  // Shot aiming: hold to aim, release to kick.
  const handleShotPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (shotFiredRef.current || endedRef.current || phase !== 'shot' || !shooterSelectionDone || !shotTutorialDone || ballFlight) return
    if (!isAimingRef.current) return

    const aim = pointerToShotTarget(e.clientX, e.clientY)
    if (aim.power > 0.08 || Math.abs(aim.pullX) > 10) {
      hasAimedTargetRef.current = true
      setHasAimedTarget(true)
      setShotAimWarning(false)
    }
    aimCursorRef.current = aim.target
    setAimCursorPos(aim.target)
    setShotJoystick({
      pullX: aim.pullX,
      pullY: aim.pullY,
      distance: aim.distance,
      angle: aim.angle,
      power: aim.power,
    })
  }

  const fireShot = () => {
    if (shotFiredRef.current || endedRef.current) return

    shotFiredRef.current = true
    setShotJoystick(null)
    playGameSound('/audio/ball-kick.mp3', { volume: 0.9 })

    const cursor = gaugeCursorRef.current
    const greenL = gaugeGreenLeft.current
    const greenR = greenL + getEffectiveGaugeGreenPx() / GAUGE_TRACK_PX
    const inGreen = cursor >= greenL && cursor <= greenR

    const at = aimCursorRef.current ?? { x: 50, y: 50 }
    const keeperCfg = KEEPER_CFG[difficulty]
    const saveRadiusMultiplier = shotBonusRef.current.powerShot ? 0.9 : 1
    const targetInsideFrame = isGoalTargetInsideFrame(at)
    const keeperBlocking = inGreen && targetInsideFrame && keeperCoversTarget(
      at,
      { x: keeperXRef.current, y: keeperYRef.current },
      keeperCfg,
      saveRadiusMultiplier,
    )

    const FLIGHT_MS = 700
    const KICK_DELAY_MS = 120
    const aimTarget: GoalTarget = { x: at.x, y: at.y, clientX: 0, clientY: 0 }
    const missTarget: GoalTarget = targetInsideFrame
      ? { x: cursor < greenL ? -18 : 118, y: -18, clientX: 0, clientY: 0 }
      : aimTarget

    window.setTimeout(() => {
      if (!inGreen || !targetInsideFrame) {
        setBallFlight({ id: Date.now(), target: missTarget, state: 'miss', duration: FLIGHT_MS })
        window.setTimeout(() => setResultLabel('RATE !'), FLIGHT_MS)
        window.setTimeout(() => finish(false, 'miss', selectedShooterRef.current), FLIGHT_MS + 700)
        return
      }

      if (keeperBlocking) {
        setBallFlight({ id: Date.now(), target: aimTarget, state: 'saved', duration: FLIGHT_MS })
        window.setTimeout(() => setResultLabel('ARRETE !'), FLIGHT_MS)
        window.setTimeout(() => finish(false, 'saved', selectedShooterRef.current), FLIGHT_MS + 800)
        return
      }

      setBallFlight({ id: Date.now(), target: aimTarget, state: 'goal', duration: FLIGHT_MS })
      window.setTimeout(() => setResultLabel('BUT !'), FLIGHT_MS)
      window.setTimeout(() => finish(true, 'goal', selectedShooterRef.current), FLIGHT_MS + 800)
    }, KICK_DELAY_MS)
  }

  const handleShotPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (shotFiredRef.current || endedRef.current || phase !== 'shot' || !shooterSelectionDone || !shotTutorialDone || ballFlight) return

    isAimingRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }

    const aim = pointerToShotTarget(e.clientX, e.clientY)
    aimStartRef.current = { x: aim.pullX, y: aim.pullY }
    setShotAimWarning(false)
    aimCursorRef.current = aim.target
    setAimCursorPos(aim.target)
    setShotJoystick({
      pullX: aim.pullX,
      pullY: aim.pullY,
      distance: aim.distance,
      angle: aim.angle,
      power: aim.power,
    })
  }

  const handleShotPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (shotFiredRef.current || endedRef.current || phase !== 'shot' || !shooterSelectionDone || !shotTutorialDone || ballFlight) return
    if (!isAimingRef.current) return

    isAimingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }

    const aim = pointerToShotTarget(e.clientX, e.clientY)
    const start = aimStartRef.current
    const hasMovedAim = hasAimedTargetRef.current || !start || aim.power > 0.1 || Math.hypot(aim.pullX - start.x, aim.pullY - start.y) > 18
    aimCursorRef.current = aim.target
    setAimCursorPos(aim.target)
    aimStartRef.current = null

    if (!hasMovedAim) {
      setShotJoystick(null)
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
    setShotJoystick(null)
  }

  const changeShooter = (direction: -1 | 1) => {
    sfx.nav()
    setShooterIndex((index) => (index + direction + shooterOptions.length) % shooterOptions.length)
  }

  const confirmShooter = () => {
    sfx.pick()
    setShooterSelectionDone(true)
    setShotTutorialDone(false)
  }

  //  Transition from GD to shot 
  const handleStartShot = () => {
    sfx.click()
    setShowShotIntro(false)
    phaseRef.current = 'shot'
    setPhase('shot')
    setShooterSelectionDone(false)
    setShotTutorialDone(false)
    // Default cursor low in the goal while the visible control starts on the ball.
    const defaultAim = { x: 50, y: 82 }
    aimCursorRef.current = defaultAim
    setAimCursorPos(defaultAim)
    setShotJoystick(null)
    aimStartRef.current = null
    hasAimedTargetRef.current = false
    setHasAimedTarget(false)
    setShotAimWarning(false)
    shotFiredRef.current = false
    isAimingRef.current = false
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
          if (rect.width && e.clientY > window.innerHeight * 0.58) handleEvade()
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
        .atk-pre-countdown {
          position: absolute; inset: 0; z-index: 75;
          display: flex; align-items: center; justify-content: center;
          background: rgba(5,11,22,.78); backdrop-filter: blur(2px);
          pointer-events: none;
        }
        .atk-pre-countdown__num {
          font: 900 clamp(78px,24vw,136px) 'Barlow Condensed', sans-serif;
          color: #fff; text-shadow: 0 0 40px rgba(255,255,255,.55);
          animation: atkCountdownPop .8s both;
        }
        .atk-pre-countdown__num.is-go { color: #2bff9a; text-shadow: 0 0 40px rgba(43,255,154,.75); }
        @keyframes atkCountdownPop { 0%{transform:scale(2.1);opacity:0} 24%{opacity:1} 82%{transform:scale(1)} 100%{transform:scale(.82);opacity:0} }

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
          position: absolute; top: max(106px, calc(env(safe-area-inset-top) + 96px)); left: 14px; right: auto; width: min(270px, 72vw); z-index: 24;
          display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; align-items: start;
          pointer-events: none;
        }
        .atk-dribble-title { color:#eafff5; font:900 13px 'Barlow Condensed',sans-serif; letter-spacing:.14em; text-shadow:0 0 12px rgba(43,255,154,.42); }
        .atk-dribble-title small { display:block; margin-top:2px; color:rgba(255,255,255,.6); font:800 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .atk-flow-bar { width:min(210px,58vw); height:7px; margin-top:7px; border-radius:999px; background:rgba(255,255,255,.13); overflow:hidden; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }
        .atk-flow-bar__fill { height:100%; width:0%; border-radius:999px; background:linear-gradient(90deg,#2bff9a,#b8ff6a,#ffb800); box-shadow:0 0 12px rgba(43,255,154,.52); transition:width .22s ease-out; }
        .atk-flow-bar.is-fever .atk-flow-bar__fill { background:linear-gradient(90deg,#19d3ff,#2bff9a,#ffb800,#ff5f7c); box-shadow:0 0 20px rgba(255,184,0,.72); animation:atkFeverPulse .32s ease-in-out infinite alternate; }
        .atk-powerup-label { margin-top:5px; width:max-content; max-width:min(220px,58vw); padding:4px 8px; border-radius:999px; background:rgba(255,184,0,.16); border:1px solid rgba(255,184,0,.42); color:#ffdf73; font:900 9px 'Barlow Condensed',sans-serif; letter-spacing:.12em; text-transform:uppercase; box-shadow:0 0 14px rgba(255,184,0,.24); animation:atkPowerupPop .42s ease-out both; }
        .atk-combo-badge { margin-top:5px; width:max-content; min-width:0; padding:4px 7px; border-radius:999px; text-align:center; color:rgba(223,255,238,.86); background:rgba(5,16,21,.52); border:1px solid rgba(43,255,154,.24); font:900 9px 'Barlow Condensed',sans-serif; letter-spacing:.1em; box-shadow:0 0 12px rgba(43,255,154,.1); opacity:.82; }
        .atk-combo-badge.is-hot { color:#201300; background:linear-gradient(180deg,#ffdc73,#ffb800); border-color:rgba(255,255,255,.48); box-shadow:0 0 22px rgba(255,184,0,.42); }
        .atk-perfect-badge { margin-top:7px; width:max-content; padding:4px 8px; border-radius:999px; color:#03131d; background:linear-gradient(90deg,#bdfcff,#2bff9a); font:900 9px 'Barlow Condensed',sans-serif; letter-spacing:.12em; box-shadow:0 0 14px rgba(43,255,154,.38); }
        .atk-perfect-badge.is-fever { background:linear-gradient(90deg,#ffdf73,#ff5f7c); box-shadow:0 0 20px rgba(255,184,0,.54); animation:atkFeverPulse .36s ease-in-out infinite alternate; }
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
        .atk-gd-player.is-dashing .atk-player-inner { transform:scale(1.18) skewX(-8deg); filter:drop-shadow(0 0 20px rgba(25,211,255,.82)); }
        .atk-gd-player.is-dashing::before { content:''; position:absolute; right:38px; top:22px; width:58px; height:18px; border-radius:999px; background:linear-gradient(90deg, transparent, rgba(25,211,255,.55)); transform:scaleX(calc(var(--atk-dash-dir, 1))); opacity:.86; animation:atkDashTrail .2s ease-out both; }
        .atk-player-whoosh { position:absolute;left:50%;top:46%;width:62px;height:62px;border-radius:50%;border:2px solid rgba(43,255,154,.34);transform:translate(-50%,-50%) scale(.7);opacity:0;pointer-events:none; }
        .atk-gd-player--pass .atk-player-whoosh { animation:atkJumpWhoosh .34s ease-out both; }
        .atk-gd-player.is-flowing .atk-player-inner { filter:drop-shadow(0 0 18px rgba(43,255,154,.82)); }
        .atk-gd-player.is-max-flow .atk-player-inner { filter:drop-shadow(0 0 22px rgba(255,184,0,.9)) drop-shadow(0 0 16px rgba(43,255,154,.62)); }
        .atk-gd-player.is-max-flow::after { content:'TIR BOOSTE'; position:absolute; left:50%; top:-22px; transform:translateX(-50%); color:#ffdd73; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; white-space:nowrap; text-shadow:0 0 12px rgba(255,184,0,.8); }
        .atk-gd-player.is-fever .atk-player-inner { filter:drop-shadow(0 0 26px rgba(255,184,0,.9)) drop-shadow(0 0 20px rgba(25,211,255,.62)); animation:atkFeverPlayer .32s ease-in-out infinite alternate; }
        .atk-control-ghost { position:absolute; left:50%; bottom:max(28px,calc(env(safe-area-inset-bottom) + 18px)); z-index:18; display:grid; justify-items:center; gap:8px; width:148px; transform:translateX(-50%); pointer-events:none; opacity:.44; filter:drop-shadow(0 0 16px rgba(43,255,154,.28)); }
        .atk-control-ghost__player { width:44px; height:54px; border-radius:999px 999px 18px 18px; background:linear-gradient(180deg,rgba(43,255,154,.38),rgba(43,255,154,.12)); border:1px solid rgba(43,255,154,.42); box-shadow:inset 0 0 18px rgba(255,255,255,.12); animation:atkGhostPlayer 1.75s ease-in-out infinite; }
        .atk-control-ghost__trail { position:relative; width:132px; height:7px; border-radius:999px; background:linear-gradient(90deg,transparent,rgba(43,255,154,.72),transparent); }
        .atk-control-ghost__trail::after { content:''; position:absolute; left:50%; top:50%; width:18px; height:18px; border-radius:50%; transform:translate(-50%,-50%); background:rgba(255,255,255,.82); box-shadow:0 0 14px rgba(43,255,154,.72); animation:atkGhostFinger 1.75s ease-in-out infinite; }

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
        .atk-slalom-gate::before {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          width: 38%;
          min-width: 44px;
          height: 4px;
          border-radius: 999px;
          transform: translate(-50%,-50%);
          background: #2bff9a;
          box-shadow: 0 0 16px rgba(43,255,154,.85);
          opacity: .78;
        }
        .atk-slalom-gate.is-passed { border-color:#b8ff6a; background:rgba(43,255,154,.2); animation: atkGatePass .42s ease-out both; }
        .atk-slalom-gate.is-failed { border-color:#FF4455; background:rgba(255,68,85,.14); box-shadow:0 0 28px rgba(255,68,85,.45); }
        .atk-slalom-gate.is-combo { border-color:#FFB800;background:radial-gradient(ellipse at center,rgba(255,184,0,.18),rgba(43,255,154,.07) 72%,transparent);box-shadow:0 0 24px rgba(255,184,0,.3),inset 0 0 18px rgba(43,255,154,.18); }
        .atk-slalom-gate.is-narrow { height:50px; border-style:dashed; }
        .atk-slalom-gate.is-moving { border-color:#19d3ff; box-shadow:0 0 24px rgba(25,211,255,.34), inset 0 0 18px rgba(25,211,255,.14); }
        .atk-slalom-gate.is-bonus { border-color:#FFB800; color:#2b1800; background:radial-gradient(ellipse at center,rgba(255,184,0,.28),rgba(255,184,0,.08) 72%,transparent 100%); box-shadow:0 0 30px rgba(255,184,0,.48), inset 0 0 18px rgba(255,255,255,.18); }
        .atk-slalom-gate.is-bonus::before { background:#FFB800; box-shadow:0 0 16px rgba(255,184,0,.9); }
        .atk-slalom-gate.is-bonus .atk-slalom-gate__label { color:#fff2bf; text-shadow:0 0 12px rgba(255,184,0,.95); }
        .atk-bonus-orb { position:absolute; left:50%; top:-18px; transform:translateX(-50%); min-width:30px; height:30px; padding:0 5px; border-radius:999px; display:grid; place-items:center; background:linear-gradient(180deg,#fff2b6,#ffb800); color:#1e1300; font:900 9px 'Barlow Condensed',sans-serif; letter-spacing:.05em; border:2px solid rgba(255,255,255,.72); box-shadow:0 0 20px rgba(255,184,0,.72); animation:atkBonusOrb 1s ease-in-out infinite alternate; }
        .atk-bonus-orb.is-boots { background:linear-gradient(180deg,#bdfcff,#19d3ff); color:#01141b; box-shadow:0 0 20px rgba(25,211,255,.72); }
        .atk-bonus-orb.is-whistle { background:linear-gradient(180deg,#d8ffba,#2bff9a); color:#03160c; box-shadow:0 0 20px rgba(43,255,154,.72); }
        .atk-bonus-choice-label { position:absolute; left:50%; top:34px; transform:translateX(-50%); color:#ffdf73; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.14em; text-shadow:0 0 10px rgba(255,184,0,.8); white-space:nowrap; }
        .atk-slalom-gate__label { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:1; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.16em; color:#dfffee; text-shadow:0 0 10px rgba(43,255,154,.8); }
        .atk-slide-wall { position:absolute;left:0;right:0;height:74px;top:0;transform:translateY(-50%);pointer-events:none;z-index:4; }
        .atk-slide-danger { position:absolute;left:4%;right:4%;top:50%;height:34px;transform:translateY(-50%);border-radius:999px;background:rgba(255,184,0,.14);border:1px solid rgba(255,184,0,.55);box-shadow:0 0 18px rgba(255,184,0,.28);animation:slideDangerPulse .45s ease-in-out infinite alternate; }
        .atk-slide-wall.is-failed .atk-slide-danger { background:rgba(255,68,85,.18);border-color:rgba(255,68,85,.7);box-shadow:0 0 24px rgba(255,68,85,.42); }
        .atk-slide-label { position:absolute;left:50%;top:-16px;transform:translateX(-50%);color:#FFB800;font:900 12px 'Barlow Condensed',sans-serif;letter-spacing:.13em;text-shadow:0 0 12px rgba(255,184,0,.85);white-space:nowrap; }
        .atk-slalom-defender { position:absolute; transform:translate(-50%,-50%); z-index:9; filter:drop-shadow(0 10px 12px rgba(0,0,0,.44)); animation: atkRunnerBob .42s ease-in-out infinite alternate; }
        .atk-slalom-defender.is-mobile { animation: atkRunnerBob .42s ease-in-out infinite alternate, atkDefenderPatrol var(--atk-defender-duration,.9s) ease-in-out var(--atk-defender-delay,0s) infinite alternate; }
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
        @keyframes atkDefenderPatrol { from{ margin-left:calc(var(--atk-defender-patrol,0%) * -1); } to{ margin-left:var(--atk-defender-patrol,0%); } }
        @keyframes slideDangerPulse { from{opacity:.45} to{opacity:1} }
        @keyframes atkSlideSkid { from{translate:-1px -1px} to{translate:2px 2px} }
        @keyframes atkJumpWhoosh { 0%{opacity:.75;transform:translate(-50%,-50%) scale(.55)} 100%{opacity:0;transform:translate(-50%,-50%) scale(1.35)} }
        @keyframes atkTackle { from{rotate:-7deg; translate:0 -1px} to{rotate:7deg; translate:0 4px} }
        @keyframes atkLegL { from{transform:rotate(-6deg)} to{transform:rotate(8deg)} }
        @keyframes atkLegR { from{transform:rotate(8deg)} to{transform:rotate(-6deg)} }
        @keyframes atkPassPop { from{opacity:0;transform:translate(-50%,8px) scale(.8)} 20%{opacity:1} to{opacity:0;transform:translate(-50%,-18px) scale(1.1)} }
        @keyframes atkBonusFlash { from{opacity:1; transform:scale(.92)} to{opacity:0; transform:scale(1.08)} }
        @keyframes atkFeverPulse { from{ filter:brightness(1); } to{ filter:brightness(1.32); } }
        @keyframes atkFeverPlayer { from{ transform:scale(1.02) rotate(-1deg); } to{ transform:scale(1.1) rotate(1deg); } }
        @keyframes atkBonusOrb { from{ transform:translateX(-50%) translateY(0) scale(.95); } to{ transform:translateX(-50%) translateY(-4px) scale(1.08); } }
        @keyframes atkPowerupPop { from{ opacity:0; transform:translateY(6px) scale(.92); } to{ opacity:1; transform:none; } }
        @keyframes atkDashTrail { from{ opacity:.9; transform:translateX(0); } to{ opacity:0; transform:translateX(-22px); } }
        @keyframes atkJumpButtonAlert { from{ transform:translateY(0); filter:brightness(1); } to{ transform:translateY(-2px); filter:brightness(1.18); } }
        @keyframes atkGhostPlayer { 0%,100%{ transform:translateX(-42px); } 50%{ transform:translateX(42px); } }
        @keyframes atkGhostFinger { 0%,100%{ transform:translate(-62px,-50%); opacity:.35; } 50%{ transform:translate(44px,-50%); opacity:.9; } }

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
          top: max(14px, calc(env(safe-area-inset-top) + 10px));
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

        .atk-shot-shooter {
          position: absolute;
          left: clamp(66px, 22%, 118px);
          bottom: max(84px, calc(env(safe-area-inset-bottom) + 72px));
          z-index: 24;
          display: grid;
          justify-items: center;
          gap: 2px;
          width: 92px;
          pointer-events: none;
          filter: drop-shadow(0 12px 20px rgba(0,0,0,.46));
          animation: atkShotShooterIn .24s ease-out both;
        }
        .atk-shot-shooter .atk-kawaii {
          width: 72px;
          height: auto;
          filter: drop-shadow(0 0 16px rgba(43,255,154,.42));
        }
        .atk-shot-shooter__name {
          max-width: 110px;
          padding: 3px 7px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.18);
          background: rgba(3,10,18,.7);
          color: #fff;
          font: 900 9px 'Barlow Condensed',sans-serif;
          letter-spacing: .08em;
          line-height: 1;
          text-align: center;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          backdrop-filter: blur(6px);
        }
        .atk-shot-shooter.is-kicking .atk-kawaii {
          animation: atkShotKick .42s cubic-bezier(.2,1.1,.3,1) both;
        }
        @keyframes atkShotShooterIn {
          from { transform: translate(-10px, 18px) scale(.86); opacity: 0; }
          to { transform: translate(0, 0) scale(1); opacity: 1; }
        }
        @keyframes atkShotKick {
          0% { transform: translateY(0) rotate(0deg) scale(1); }
          44% { transform: translate(10px, -7px) rotate(-7deg) scale(1.08); }
          100% { transform: translate(18px, 3px) rotate(4deg) scale(.98); }
        }

        /*  Gauge above the goal in shot scene  */
        .atk-gauge-bottom {
          position: absolute; top: max(58px, calc(env(safe-area-inset-top) + 50px)); left: 0; right: 0; z-index: 20;
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 0 20px;
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
          width: 86%; max-width: ${GAUGE_TRACK_PX}px; height: 36px;
          background: #c0392b; border-radius: 14px;
          border: 2px solid rgba(255,255,255,.3);
          overflow: hidden;
          box-shadow: 0 10px 24px rgba(0,0,0,.36), inset 0 0 0 1px rgba(0,0,0,.22);
        }
        .atk-gauge-green {
          position: absolute; top: 0; bottom: 0;
          background: #2bff9a;
          border-radius: 8px;
          box-shadow: 0 0 18px rgba(43,255,154,.72), inset 0 0 0 2px rgba(255,255,255,.34);
        }
        .atk-gauge-cursor {
          position: absolute; top: -7px; bottom: -7px;
          width: 12px; background: #fff; border-radius: 8px;
          box-shadow: 0 0 12px rgba(255,255,255,.96), 0 0 22px rgba(43,255,154,.48);
          transform: translateX(-50%);
        }

        .atk-aim-hint {
          position: absolute; top: 70%; left: 50%; transform: translate(-50%, -50%);
          z-index: 25; pointer-events: none; text-align: center;
          padding: 8px 12px; border-radius: 999px;
          background: rgba(4, 12, 22, .72); border: 1px solid rgba(43,255,154,.34);
          color: #dfffee; font: 900 13px 'Barlow Condensed',sans-serif;
          letter-spacing: .13em; text-transform: uppercase;
          box-shadow: 0 0 20px rgba(43,255,154,.18);
          animation: atkBlink 0.72s ease-in-out infinite alternate;
        }
        .atk-shot-joystick {
          position: absolute;
          left: 50%;
          top: 86%;
          z-index: 26;
          width: 0;
          height: 0;
          pointer-events: none;
          filter: drop-shadow(0 0 16px rgba(255,184,0,.34));
        }
        .atk-shot-joystick__base,
        .atk-shot-joystick__thumb,
        .atk-shot-joystick__rope {
          position: absolute;
          left: 0;
          top: 0;
          transform-origin: 0 50%;
        }
        .atk-shot-joystick__base {
          width: 86px;
          height: 86px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          border: 2px solid rgba(255,184,0,.86);
          background: radial-gradient(circle, rgba(255,216,74,.22), rgba(255,216,74,.08) 46%, rgba(255,184,0,.02) 72%);
          box-shadow: inset 0 0 18px rgba(255,184,0,.22), 0 0 24px rgba(255,184,0,.24);
          animation: atkShotJoystickPulse 0.88s ease-in-out infinite alternate;
        }
        .atk-shot-joystick.is-dragging .atk-shot-joystick__base {
          animation: none;
          opacity: .82;
        }
        .atk-shot-joystick__thumb {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid #fff;
          background: rgba(255,184,0,.32);
          box-shadow: 0 0 18px rgba(255,184,0,.7), inset 0 0 12px rgba(255,255,255,.2);
        }
        .atk-shot-joystick__thumb:after {
          content: '';
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          background: #f7f9fc;
          border: 2px solid #101827;
          box-shadow: 0 0 10px rgba(255,255,255,.52);
        }
        .atk-shot-joystick__rope {
          height: 4px;
          width: calc(var(--pull-distance, 0) * 1px);
          transform: rotate(calc(var(--pull-angle, 90) * 1deg));
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(255,184,0,.9), rgba(255,255,255,.55));
          opacity: .82;
        }
        .atk-shot-joystick__power {
          position: absolute;
          left: 50%;
          top: 58px;
          transform: translateX(-50%);
          width: 78px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,.14);
          overflow: hidden;
        }
        .atk-shot-joystick__power i {
          display: block;
          height: 100%;
          width: calc(var(--pull-power, 0) * 100%);
          background: linear-gradient(90deg, #FFB800, #2bff9a);
        }
        @keyframes atkShotJoystickPulse {
          from { transform: translate(-50%, -50%) scale(.94); opacity: .72; }
          to { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
        }
        .atk-aim-warning {
          position: absolute; top: 66%; left: 50%; transform: translate(-50%, -50%);
          z-index: 29; pointer-events: none; text-align: center;
          width: min(82%, 330px); padding: 12px 14px; border-radius: 16px;
          background: rgba(255, 68, 85, .18); border: 1.5px solid rgba(255, 68, 85, .72);
          color: #fff; font: 900 14px 'Barlow Condensed',sans-serif;
          letter-spacing: .11em; text-transform: uppercase; line-height: 1.18;
          box-shadow: 0 0 26px rgba(255,68,85,.34);
          animation: atkWarningPop 1.5s ease-out both;
        }
        @keyframes atkWarningPop { 0%{opacity:0;scale:.86} 12%{opacity:1;scale:1.04} 72%{opacity:1;scale:1} 100%{opacity:0;scale:.96} }
        .atk-shooter-select {
          position: absolute; inset: 0; z-index: 46;
          display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 12px; padding: max(24px, env(safe-area-inset-top)) 22px max(24px, calc(env(safe-area-inset-bottom) + 18px));
          text-align: center;
          background:
            radial-gradient(circle at 50% 42%, rgba(43,255,154,.18), transparent 35%),
            linear-gradient(180deg, rgba(5,11,22,.95), rgba(9,4,28,.92));
          backdrop-filter: blur(4px);
        }
        .atk-shooter-select__title {
          display: grid; gap: 4px; justify-items: center;
          color: rgba(255,255,255,.76);
          font: 900 13px 'Barlow Condensed',sans-serif;
          letter-spacing: .2em; text-transform: uppercase;
        }
        .atk-shooter-select__title strong {
          color: #FFB800;
          font-size: clamp(30px,9vw,50px);
          line-height: .9;
          text-shadow: 0 0 28px rgba(255,184,0,.46);
        }
        .atk-shooter-select__stage {
          min-height: 0;
          display: grid;
          grid-template-columns: 50px minmax(0,1fr) 50px;
          align-items: center;
          gap: 8px;
        }
        .atk-shooter-select__arrow {
          width: 46px; height: 58px; border-radius: 16px;
          border: 1px solid rgba(255,255,255,.18);
          background: rgba(255,255,255,.08);
          color: #fff;
          font: 900 32px/1 'Barlow Condensed',sans-serif;
          cursor: pointer;
          box-shadow: 0 12px 30px rgba(0,0,0,.26);
        }
        .atk-shooter-select__arrow:active { transform: translateY(2px); background: rgba(43,255,154,.16); }
        .atk-shooter-select__card {
          min-width: 0;
          display: grid; justify-items: center; align-content: center; gap: 12px;
        }
        .atk-shooter-select__avatar {
          width: min(58vw, 230px);
          aspect-ratio: 1 / 1.16;
          display: grid; place-items: center;
          filter: drop-shadow(0 0 32px rgba(43,255,154,.34));
          animation: atkShooterPop .46s cubic-bezier(.2,1.28,.32,1) both;
        }
        .atk-shooter-select__avatar .atk-kawaii {
          width: min(48vw, 190px);
          height: auto;
        }
        .atk-shooter-select__name {
          max-width: 100%;
          margin: 0;
          color: #fff;
          font: 900 clamp(28px,8.2vw,44px)/.9 'Barlow Condensed',sans-serif;
          letter-spacing: .04em;
          text-transform: uppercase;
          text-shadow: 0 0 22px rgba(43,255,154,.34);
          overflow-wrap: anywhere;
        }
        .atk-shooter-select__meta {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 7px 12px; border-radius: 999px;
          border: 1px solid rgba(43,255,154,.36);
          color: #2bff9a;
          background: rgba(43,255,154,.08);
          font: 900 12px 'Barlow Condensed',sans-serif;
          letter-spacing: .14em;
          text-transform: uppercase;
        }
        .atk-shooter-select__btn {
          min-height: 58px;
          width: min(100%, 360px);
          justify-self: center;
          border: 0;
          border-radius: 16px;
          background: linear-gradient(90deg,#2bff9a,#FFB800);
          color: #061013;
          font: 900 18px 'Barlow Condensed',sans-serif;
          letter-spacing: .18em;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 0 0 34px rgba(43,255,154,.32), 0 18px 38px rgba(0,0,0,.34);
        }
        @keyframes atkShooterPop { from{opacity:0; transform:scale(.82)} to{opacity:1; transform:scale(1)} }
        .atk-shot-tutorial {
          position: absolute; inset: 0; z-index: 44;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 14px; padding: 24px; text-align: center;
          background: rgba(5,11,22,.82); backdrop-filter: blur(3px);
        }
        .atk-shot-tutorial__title {
          font: 900 clamp(34px,11vw,58px) 'Barlow Condensed', sans-serif;
          color: #FFB800; letter-spacing: .18em; text-transform: uppercase;
          text-shadow: 0 0 30px rgba(255,184,0,.58);
        }
        .atk-shot-tutorial__text {
          max-width: 330px; color: rgba(255,255,255,.86);
          font: 700 clamp(13px,4vw,17px) 'Barlow Condensed', sans-serif;
          line-height: 1.42;
        }
        .atk-shot-tutorial__btn {
          margin-top: 4px; padding: 12px 30px; border-radius: 12px;
          border: 2px solid #2bff9a; background: rgba(43,255,154,.12);
          color: #2bff9a; font: 900 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em; cursor: pointer; box-shadow: 0 0 18px rgba(43,255,154,.28);
        }

        /*  Result overlay  */
        .atk-result-overlay {
          position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 4px;
          font: 900 clamp(40px,14vw,72px) 'Barlow Condensed', sans-serif;
          letter-spacing: .08em; text-shadow: 0 0 36px currentColor;
          animation: atkResultIn .25s ease-out both; z-index: 30; pointer-events: none;
        }
        .atk-result-overlay small {
          max-width: min(86%, 320px);
          color: #fff;
          font: 900 clamp(15px,4.4vw,22px) 'Barlow Condensed',sans-serif;
          letter-spacing: .08em;
          text-align:center;
          text-transform:uppercase;
          text-shadow: 0 0 18px rgba(0,0,0,.65);
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
      {!tutorialDone && preCountdownNum === null && (
        <div className="atk-tutorial">
          <div className="atk-tutorial__title">DRIBBLE RUSH</div>
          <div className="atk-tutorial__instruction">
            Passe dans les portes vertes entre les defenseurs.
            <br /><br />
            Utilise <b style={{ color:'#2bff9a' }}>Gauche / Esquive / Droite</b> pour slalomer.
            <br />
            Les portes peuvent etre etroites, mobiles, diagonales ou protegees par des murs.
            <br /><br />
            Garde le <b style={{ color:'#FFB800' }}>FLOW</b> : les combos agrandissent la zone verte, ralentissent le gardien ou boostent la frappe.
            <br /><br />
            <span style={{ color:'rgba(255,255,255,.5)', fontSize:'0.9em' }}>Clavier : fleches pour se deplacer, Espace pour sauter, Shift pour esquiver</span>
          </div>
          <span className="atk-tutorial__arrow"></span>
          <button
            type="button"
            className="atk-tutorial__btn"
            onClick={startTutorialCountdown}
          >
            OK  Jouer !
          </button>
        </div>
      )}

      {!tutorialDone && preCountdownNum !== null ? (
        <div className="atk-pre-countdown">
          <div key={preCountdownNum} className={`atk-pre-countdown__num${preCountdownNum === 0 ? ' is-go' : ''}`}>
            {preCountdownNum === 0 ? 'GO !' : preCountdownNum}
          </div>
        </div>
      ) : null}

      {/*  Shot intro transition  */}
      {showShotIntro && (
        <div className="atk-transition">
          <div style={{ fontSize: 36 }}></div>
          <div className="atk-transition__title">ZONE DE TIR</div>
          <div className="atk-transition__sub">{flow >= 70 || shotBonusRef.current.powerShot ? perfectStreak >= 3 ? `TIR BOOSTE - PERFECT x${perfectStreak}` : 'TIR BOOSTE' : 'Maintiens, vise, relache'}</div>
          <div className="atk-transition__desc">
            Maintiens la balle au pied, tire vers le bas comme un lance-pierre, vise une zone de l'ecran, puis relache quand la jauge est dans le vert.<br /><br />
            <b style={{ color:'#2bff9a' }}>Vert = tir cadre</b>  Hors cage = rate  Gardien sur la route = arret<br />
            Plus ton FLOW est haut, plus le tir devient favorable.
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
                <div className={`atk-flow-bar${feverActive ? ' is-fever' : ''}`}><div className="atk-flow-bar__fill" style={{ width: `${flow}%` }} /></div>
                {perfectStreak > 0 ? <div className={`atk-perfect-badge${feverActive ? ' is-fever' : ''}`}>{feverActive ? 'FEVER' : 'PERFECT'} x{perfectStreak}</div> : null}
                {powerupLabel ? <div className="atk-powerup-label">{powerupLabel}</div> : null}
                {comboDisplay > 0 ? <div className={`atk-combo-badge${comboDisplay >= 5 || feverActive ? ' is-hot' : ''}`}>COMBO x{comboDisplay}</div> : null}
              </div>
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
                        <span className="atk-slalom-gate__label">PASSAGE</span>
                        {wave.passed && !wave.bonusCollected ? <span className="atk-pass-pop">PASSE !</span> : null}
                      </div>
                    ) : wave.passed ? <span className="atk-pass-pop atk-pass-pop--slide">SAUTE !</span> : null}
                    {wave.hasBonus && wave.bonusGateCenterX != null && wave.bonusGateWidth != null ? (
                      <div className={`atk-slalom-gate is-bonus${wave.bonusCollected ? ' is-passed' : ''}${wave.failed ? ' is-failed' : ''}`} style={{ left: `${wave.bonusGateCenterX}%`, width: bonusGatePxWidth }}>
                        <span className={`atk-bonus-orb is-${wave.bonusKind ?? 'coin'}`}>
                          {wave.bonusKind === 'boots' ? 'SPD' : wave.bonusKind === 'whistle' ? 'STOP' : '$'}
                        </span>
                        <span className="atk-slalom-gate__label">{wave.bonusKind === 'boots' ? 'TURBO' : wave.bonusKind === 'whistle' ? 'SIFFLET' : 'PIECE'}</span>
                        <span className="atk-bonus-choice-label">RISQUE = BONUS</span>
                        {wave.bonusCollected ? <span className="atk-pass-pop">BONUS !</span> : null}
                      </div>
                    ) : null}
                    {wave.defenders.map((defender) => (
                      <div
                        key={defender.id}
                        className={`atk-slalom-defender is-${defender.variant}${defender.moveAmplitude ? ' is-mobile' : ''}`}
                        style={{
                          left: `${defender.x}%`,
                          top: defender.yOffset,
                          '--atk-defender-patrol': `${defender.moveAmplitude ?? 0}%`,
                          '--atk-defender-duration': `${defender.moveDuration ?? 0.9}s`,
                          '--atk-defender-delay': `${defender.moveDelay ?? 0}s`,
                        } as CSSProperties}
                      >
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
                dashActive ? 'is-dashing' : '',
                gdFlash   ? 'atk-gd-player--flash' : '',
                flow >= 40 ? 'is-flowing' : '',
                feverActive ? 'is-fever' : '',
                flow >= 100 ? 'is-max-flow' : '',
              ].join(' ')}
              style={{
                transform: `translateX(${(gdPlayerXRef.current / 100) * gameWidthRef.current - 29}px)`,
                '--atk-player-x': `${(gdPlayerXRef.current / 100) * gameWidthRef.current - 29}px`,
                '--atk-dash-dir': dashDirectionRef.current,
              } as CSSProperties}
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
            {!showControls && tutorialDone ? (
              <div className="atk-control-ghost" aria-hidden="true">
                <i className="atk-control-ghost__player" />
                <i className="atk-control-ghost__trail" />
              </div>
            ) : null}
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
            targetActive={hasAimedTarget}
          />
          {shooterSelectionDone && shotTutorialDone && !resultLabel ? (
            <div className={`atk-shot-shooter${ballFlight ? ' is-kicking' : ''}`} aria-hidden="true">
              <KawaiiFootballer
                label={String(selectedShooter.number ?? 9)}
                jerseyColor={playerJerseyColor}
                accentColor={playerAccentColor}
                shortsColor={playerShortsColor}
                textColor={playerTextColor}
                withBall={!ballFlight}
                isPlayer
              />
              <span className="atk-shot-shooter__name">{playerLastName(selectedShooter.name)}</span>
            </div>
          ) : null}
          {!shooterSelectionDone && !ballFlight && !resultLabel ? (
            <div
              className="atk-shooter-select"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
            >
              <div className="atk-shooter-select__title">
                <span>Choisis ton</span>
                <strong>TIREUR</strong>
              </div>
              <div className="atk-shooter-select__stage">
                <button type="button" className="atk-shooter-select__arrow" onClick={() => changeShooter(-1)} aria-label="Tireur precedent">&lt;</button>
                <div className="atk-shooter-select__card" key={`${selectedShooter.name}-${selectedShooter.number}`}>
                  <div className="atk-shooter-select__avatar">
                    <KawaiiFootballer
                      label={String(selectedShooter.number ?? 9)}
                      jerseyColor={playerJerseyColor}
                      accentColor={playerAccentColor}
                      shortsColor={playerShortsColor}
                      textColor={playerTextColor}
                      withBall
                      isPlayer
                    />
                  </div>
                  <h3 className="atk-shooter-select__name">{selectedShooter.name}</h3>
                  <div className="atk-shooter-select__meta">#{selectedShooter.number ?? 9} · {selectedShooterIndex + 1}/{shooterOptions.length}</div>
                </div>
                <button type="button" className="atk-shooter-select__arrow" onClick={() => changeShooter(1)} aria-label="Tireur suivant">&gt;</button>
              </div>
              <button type="button" className="atk-shooter-select__btn" onClick={confirmShooter}>
                Tirer
              </button>
            </div>
          ) : null}
          {shooterSelectionDone && !shotTutorialDone && !ballFlight && !resultLabel ? (
            <div className="atk-shot-tutorial">
              <div className="atk-shot-tutorial__title">PHASE DE TIR</div>
              <div className="atk-shot-tutorial__text">
                {selectedShooter.name} attend ton geste.
                <br /><br />
                Maintiens le rond jaune sur la balle au pied du joueur.
                <br /><br />
                Tire vers le bas avec le doigt ou la souris pour viser comme dans Angry Birds. La cible peut aller dans la cage ou dehors.
                <br /><br />
                Relache quand le curseur est dans le <b style={{ color: '#2bff9a' }}>vert</b>. Vert + cage + gardien pas sur la route = but. Hors vert, hors cage ou gardien devant = echec.
              </div>
              <button type="button" className="atk-shot-tutorial__btn" onClick={() => { sfx.click(); setShotTutorialDone(true) }}>
                OK TIRER
              </button>
            </div>
          ) : null}

          {shooterSelectionDone && shotTutorialDone && !ballFlight && !resultLabel ? (
            <div
              className={`atk-shot-joystick${isAimingRef.current ? ' is-dragging' : ''}`}
              style={{
                '--pull-distance': `${shotJoystick?.distance ?? 0}`,
                '--pull-angle': `${shotJoystick?.angle ?? 90}`,
                '--pull-power': `${shotJoystick?.power ?? 0}`,
              } as CSSProperties}
              aria-hidden="true"
            >
              <span className="atk-shot-joystick__rope" />
              <span className="atk-shot-joystick__base" />
              <span
                className="atk-shot-joystick__thumb"
                style={{ transform: `translate(calc(-50% + ${shotJoystick?.pullX ?? 0}px), calc(-50% + ${shotJoystick?.pullY ?? 0}px))` }}
              >
                <span className="atk-shot-joystick__power"><i /></span>
              </span>
            </div>
          ) : null}
          {/* Hint when no aim yet */}
          {shooterSelectionDone && shotTutorialDone && !hasAimedTarget && !ballFlight && !resultLabel && (
            <div className="atk-aim-hint">MAINTIENS LA BALLE, TIRE VERS LE BAS</div>
          )}
          {shooterSelectionDone && shotTutorialDone && shotAimWarning && !ballFlight && !resultLabel && (
            <div className="atk-aim-warning">TIRE LE ROND JAUNE VERS LE BAS, VISE, PUIS RELACHE DANS LE VERT</div>
          )}

          {/* Gauge  visible until tir fired */}
          {shooterSelectionDone && shotTutorialDone && !resultLabel && (
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
              <span>{resultLabel}</span>
              <small>
                {resultLabel === 'BUT !'
                  ? `${selectedShooter.name} marque`
                  : resultLabel === 'ARRETE !'
                    ? `${selectedShooter.name} tombe sur le gardien`
                    : `${selectedShooter.name} rate sa frappe`}
              </small>
            </div>
          )}
        </div>
      )}

      {phase === 'gd' && showControls && (
        <div className="atk-controls">
          <div className="atk-controls__stat">FLOW {flow}<small>Combo x{comboDisplay}</small></div>
          <div className="atk-controls__buttons">
            <button type="button" className="atk-ctrl-btn" data-control="left" aria-label="Gauche" onPointerDown={(e) => { e.stopPropagation(); keysRef.current.left = true }} onPointerUp={() => { keysRef.current.left = false }} onPointerCancel={() => { keysRef.current.left = false }} onPointerLeave={() => { keysRef.current.left = false }}>←</button>
            <button type="button" className={`atk-ctrl-btn atk-ctrl-btn--evade${gdJumping || dashActive ? ' is-jumping' : ''}${nextGdWave?.requiresJump ? ' is-danger' : ''}`} data-control="jump" aria-label="Esquive" onPointerDown={(e) => { e.stopPropagation(); handleEvade() }}><b>{nextGdWave?.requiresJump ? '↑' : '↯'}</b>{nextGdWave?.requiresJump ? 'SAUT' : 'ESQUIVE'}</button>
            <button type="button" className="atk-ctrl-btn" data-control="right" aria-label="Droite" onPointerDown={(e) => { e.stopPropagation(); keysRef.current.right = true }} onPointerUp={() => { keysRef.current.right = false }} onPointerCancel={() => { keysRef.current.right = false }} onPointerLeave={() => { keysRef.current.right = false }}>→</button>
          </div>
          <div className={`atk-controls__phase${gdBadgeClass}`}>SLALOM<small>{gdInstruction}</small></div>
        </div>
      )}
    </section>
  )
}

export default AttackPhase
