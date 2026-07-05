import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BattleDifficulty, BattleScorer } from '../../types'
import type { TeamKit } from '../../lib/teamKits'
import { playGameSound } from '../../lib/useGameAudio'
import { sfx } from '../../lib/sfx'
import { hasSeenBattleTutorial, markBattleTutorialSeen } from './tutorialPrefs'
import GoalView, { type BallFlight, type GoalTarget } from './GoalView'
import KawaiiSprite, { KAWAII_SPRITE_CSS } from './KawaiiSprite'

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
  roundIntroComment?: string
  showControls?: boolean
}

//  Config 
const ATTACK_CFG = {
  easy:   { waveCount: 36, gateWidth: 42, narrowGateWidth: 32, gdSpeed: 28, difficultyRamp: 0.34, spacing: 42, gaugeGreenPx: 42, gaugeSpeed: 0.78 },
  medium: { waveCount: 44, gateWidth: 36, narrowGateWidth: 28, gdSpeed: 35, difficultyRamp: 0.52, spacing: 40, gaugeGreenPx: 38, gaugeSpeed: 0.96 },
  hard:   { waveCount: 52, gateWidth: 31, narrowGateWidth: 24, gdSpeed: 41, difficultyRamp: 0.74, spacing: 37, gaugeGreenPx: 33, gaugeSpeed: 1.34 },
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
const ROULETTE_DURATION = 820
const ROULETTE_ACTIVE_START = 90
const ROULETTE_ACTIVE_END = 720
const ROULETTE_COOLDOWN = 760
const FEVER_DURATION = 3600
const SUPER_ATTACKER_DURATION = 4300
const POWER_SHOT_FLOW_THRESHOLD = 92
const ATTACK_MAX_LIVES = 3
const ATTACK_GHOST_DURATION = 1550
const SHOT_ORIGIN_Y_FRAC = 0.66
const DRIBBLE_RENDER_BACKTRACK = 3
const DRIBBLE_RENDER_LOOKAHEAD = 12

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

type SlalomWaveType = 'gate' | 'narrow_gate' | 'slide_wall' | 'double_slide_wall' | 'diagonal_press' | 'moving_gate' | 'bonus_choice' | 'combo_gate_slide' | 'roulette_wall'
type BonusKind = 'coin' | 'boots' | 'whistle' | 'slowmo' | 'wide' | 'blast'
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
  superBlasted?: boolean
  requiresJump?: boolean
  requiresRoulette?: boolean
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
  const source = uniquePlayers.length ? uniquePlayers : [`Buteur ${teamId.toUpperCase()}`]

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
  if (difficulty === 'easy') return [['gate', 32], ['narrow_gate', 17], ['slide_wall', 14], ['diagonal_press', 9], ['bonus_choice', 18], ['moving_gate', 6], ['roulette_wall', 4]]
  if (difficulty === 'medium') return [['gate', 20], ['narrow_gate', 17], ['slide_wall', 13], ['double_slide_wall', 9], ['diagonal_press', 15], ['bonus_choice', 16], ['moving_gate', 9], ['combo_gate_slide', 6], ['roulette_wall', 7]]
  return [['gate', 13], ['narrow_gate', 15], ['slide_wall', 15], ['double_slide_wall', 11], ['diagonal_press', 17], ['bonus_choice', 16], ['moving_gate', 11], ['combo_gate_slide', 7], ['roulette_wall', 8]]
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
    const recentEvade = [last, before].some((item) => item === 'slide_wall' || item === 'double_slide_wall' || item === 'combo_gate_slide' || item === 'roulette_wall')
    if (last === type && before === type) continue
    if ((type === 'combo_gate_slide' || type === 'double_slide_wall') && last === type) continue
    if ((type === 'slide_wall' || type === 'double_slide_wall' || type === 'combo_gate_slide' || type === 'roulette_wall') && recentEvade) continue
    if (difficulty === 'easy' && (type === 'double_slide_wall' || type === 'combo_gate_slide')) continue
    if (difficulty === 'easy' && type === 'combo_gate_slide') continue
    if (difficulty === 'medium' && type === 'combo_gate_slide' && rng() < 0.35) continue
    if (type === 'roulette_wall' && index < 3) continue
    return type
  }
  return 'gate'
}

function makeGateDefenders(i: number, center: number, gateWidth: number, players: string[], type: SlalomWaveType, rng: () => number, bonusGate?: { center: number; width: number }): SlalomDefender[] {
  const half = gateWidth / 2
  const yJitter = (index: number) => [-16, 10, -3][index % 3] + Math.round((rng() - 0.5) * 5)
  const gates = [{ left: center - half, right: center + half }]
  if (bonusGate) gates.push({ left: bonusGate.center - bonusGate.width / 2, right: bonusGate.center + bonusGate.width / 2 })
  gates.sort((a, b) => a.left - b.left)

  const gateSafetyMargin = type === 'narrow_gate' || type === 'combo_gate_slide' ? 5 : 6
  const segments: Array<{ left: number; right: number; side: 'left' | 'right' | 'middle' }> = []
  let cursor = 7
  for (let gateIndex = 0; gateIndex < gates.length; gateIndex += 1) {
    const gate = gates[gateIndex]
    const left = Math.max(7, gate.left - gateSafetyMargin)
    const right = Math.min(93, gate.right + gateSafetyMargin)
    if (left - cursor >= 10) {
      segments.push({
        left: cursor,
        right: left,
        side: gateIndex === 0 ? 'left' : 'middle',
      })
    }
    cursor = Math.max(cursor, right)
  }
  if (93 - cursor >= 10) segments.push({ left: cursor, right: 93, side: 'right' })

  const primaryGateIsLeft = center < 50
  const preferredSide: 'left' | 'right' = primaryGateIsLeft ? 'right' : 'left'
  const secondarySide: 'left' | 'right' = primaryGateIsLeft ? 'left' : 'right'
  const orderedSegments = [...segments].sort((a, b) => {
    const score = (segment: { left: number; right: number; side: 'left' | 'right' | 'middle' }) => {
      const width = segment.right - segment.left
      if (segment.side === preferredSide) return 300 + width
      if (segment.side === secondarySide) return 180 + width
      return 120 + width
    }
    return score(b) - score(a)
  })

  const picked: Array<{ x: number; segment: { left: number; right: number; side: 'left' | 'right' | 'middle' } }> = []
  const addFromSegment = (segment: { left: number; right: number; side: 'left' | 'right' | 'middle' }, slot: number) => {
    const width = segment.right - segment.left
    if (width < 10 || picked.length >= 2) return
    const preferredT = slot === 0 ? 0.5 : slot === 1 ? 0.28 : 0.72
    const jitter = (rng() - 0.5) * Math.min(4, width * 0.1)
    const x = Math.max(segment.left + 5, Math.min(segment.right - 5, segment.left + width * preferredT + jitter))
    if (picked.every((item) => Math.abs(item.x - x) >= 9)) picked.push({ x, segment })
  }

  const preferredSegments = orderedSegments.filter((segment) => segment.side === preferredSide)
  const otherSegments = orderedSegments.filter((segment) => segment.side !== preferredSide)
  if (preferredSegments[0]) addFromSegment(preferredSegments[0], 0)
  if (preferredSegments[0]) addFromSegment(preferredSegments[0], 1)
  if (otherSegments[0]) addFromSegment(otherSegments[0], 0)

  for (const segment of orderedSegments) {
    addFromSegment(segment, picked.length)
    if (picked.length >= 2) break
  }

  const fallbackSegments = orderedSegments.length
    ? orderedSegments
    : [
      { left: 7, right: Math.max(17, gates[0].left - gateSafetyMargin), side: 'left' as const },
      { left: Math.min(83, gates[gates.length - 1].right + gateSafetyMargin), right: 93, side: 'right' as const },
    ].filter((segment) => segment.right - segment.left >= 8)

  for (let attempt = 0; picked.length < 2 && fallbackSegments.length && attempt < 12; attempt += 1) {
    const segment = fallbackSegments[attempt % fallbackSegments.length]
    const width = segment.right - segment.left
    const slot = picked.length
    const t = slot === 0 ? 0.5 : slot === 1 ? (segment.side === preferredSide ? 0.25 : 0.72) : (segment.side === preferredSide ? 0.72 : 0.25)
    const x = Math.max(segment.left + 4, Math.min(segment.right - 4, segment.left + width * t + (rng() - 0.5) * 2))
    if (picked.every((item) => Math.abs(item.x - x) >= 6)) picked.push({ x, segment })
  }

  return picked.slice(0, 2).map(({ x, segment }, index) => {
    const patrolRoom = Math.min(x - segment.left - 4, segment.right - x - 4)
    const moveAmplitude = Math.max(8, Math.min(18, Math.max(9, (segment.right - segment.left) / 2 - 5), Math.max(8, patrolRoom + 3)))
    return {
      id: `${i}-block-${index}`,
      x,
      yOffset: yJitter(index),
      label: defenderLabel(players, i * 3 + index, String([4, 5, 6][(i + index) % 3])),
      variant: type === 'combo_gate_slide' && index === 1 ? 'sliding' : type === 'diagonal_press' || type === 'moving_gate' || index === 1 ? 'press' : 'normal',
      moveAmplitude,
      moveDuration: 0.72 + rng() * 0.42,
      moveDelay: index * -0.18 - rng() * 0.24,
    }
  })
}

function makeSlideDefenders(i: number, players: string[], doubleLine: boolean): SlalomDefender[] {
  return [{
    id: `${i}-slide-0`,
    x: 50,
    yOffset: 0,
    label: defenderLabel(players, i * 3, doubleLine ? '4' : '2'),
    variant: 'sliding' as const,
    moveAmplitude: doubleLine ? 42 : 38,
    moveDuration: doubleLine ? 0.68 : 0.72,
    moveDelay: -0.08,
  }]
}

function generateSlalomWaves(params: { difficulty: BattleDifficulty; seed: string; players: string[] }): SlalomWave[] {
  const cfg = ATTACK_CFG[params.difficulty]
  const rng = createRng(params.seed)
  const waves: SlalomWave[] = []
  const centers: number[] = []
  const types: SlalomWaveType[] = []
  let nextWorldY = WALL_FIRST_Y

  for (let i = 0; i < cfg.waveCount; i += 1) {
    const progress = i / Math.max(1, cfg.waveCount - 1)
    const bonusEvery = params.difficulty === 'easy' ? 7 : params.difficulty === 'medium' ? 6 : 6
    const forceBonus = i > 2 && i < cfg.waveCount - 2 && i % bonusEvery === 1
    const forceRoulette = i === 4 || (params.difficulty !== 'easy' && i > 7 && i % 7 === 4)
    const forceDiagonal = i > 3 && params.difficulty !== 'easy' && i % 6 === 3
    const rawType = forceRoulette ? 'roulette_wall' : forceBonus ? 'bonus_choice' : forceDiagonal ? 'diagonal_press' : pickWaveType(rng, params.difficulty, types, i)
    const recentEvade = types.slice(-2).some((item) => item === 'slide_wall' || item === 'double_slide_wall' || item === 'combo_gate_slide' || item === 'roulette_wall')
    const rawNeedsEvade = rawType === 'slide_wall' || rawType === 'double_slide_wall' || rawType === 'combo_gate_slide' || rawType === 'roulette_wall'
    const type = i < 2 && rawType !== 'gate' && rawType !== 'narrow_gate'
      ? 'gate'
      : rawNeedsEvade && recentEvade
        ? (forceBonus ? 'bonus_choice' : rng() < 0.45 ? 'narrow_gate' : 'gate')
        : rawType
    const center = pickGateCenter(rng, centers, params.difficulty)
    centers.push(center)
    types.push(type)

    const isSlide = type === 'slide_wall' || type === 'double_slide_wall'
    const isRoulette = type === 'roulette_wall'
    const isNarrow = type === 'narrow_gate' || type === 'combo_gate_slide'
    const isBonus = type === 'bonus_choice'
    const isMoving = type === 'moving_gate'
    const gateWidth = isBonus ? cfg.gateWidth + 2 : isNarrow ? cfg.narrowGateWidth : cfg.gateWidth + (progress < 0.25 ? 2 : 0)
    const spacing = cfg.spacing + (type === 'double_slide_wall' ? 16 : type === 'slide_wall' ? 12 : type === 'combo_gate_slide' ? 18 : type === 'roulette_wall' ? 18 : 0) + (recentEvade ? 10 : 0)
    const worldY = nextWorldY
    nextWorldY -= spacing
    const moveAmplitude = isMoving ? (params.difficulty === 'hard' ? 11 + rng() * 5 : params.difficulty === 'medium' ? 8 + rng() * 5 : 5 + rng() * 4) : 0
    const safeCenter = Math.max(16 + moveAmplitude, Math.min(84 - moveAmplitude, center))
    const bonusDirection = safeCenter < 50 ? 1 : -1
    const minBonusGap = gateWidth / 2 + Math.max(14, cfg.narrowGateWidth - 2) / 2 + 18
    const bonusGateCenterX = isBonus ? Math.max(18, Math.min(82, safeCenter + bonusDirection * (minBonusGap + rng() * 6))) : undefined
    const bonusGateWidth = isBonus ? Math.max(16, cfg.narrowGateWidth - 2) : undefined
    const bonusPool: BonusKind[] = ['coin', 'boots', 'whistle', 'slowmo', 'wide', 'blast', 'blast']
    const bonusKind = isBonus ? bonusPool[Math.floor(rng() * bonusPool.length)] : undefined
    const defenders = isSlide
      ? makeSlideDefenders(i, params.players, type === 'double_slide_wall')
      : isRoulette
        ? makeSlideDefenders(i, params.players, true).map((defender) => ({ ...defender, id: `${i}-roulette-0`, variant: 'press' as const, moveAmplitude: 38, moveDuration: 0.7 }))
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
      requiresRoulette: isRoulette,
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
  if (wave?.type === 'double_slide_wall') return 'SAUTE !'
  if (wave?.type === 'combo_gate_slide') return 'PASSE + SAUTE !'
  if (wave?.type === 'roulette_wall') return 'ROULETTE !'
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

function evaluateWaveSuccess(wave: SlalomWave, playerX: number, jump: { isActive: boolean }, elapsed: number, dashActive = false, rouletteActive = false, wideActive = false): { success: boolean; bonus?: boolean; label: string; quality?: DribbleQuality } {
  const halfGate = wave.gateWidth / 2 + (dashActive && isGatePassWave(wave) ? 3 : 0) + (wideActive && isGatePassWave(wave) ? 6 : 0)
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
  if (wave.type === 'double_slide_wall') return { success: jump.isActive, label: jump.isActive ? 'SAUTE !' : 'TACLE !' }
  if (wave.type === 'diagonal_press') return { success: inGate, label: inGate ? perfectGate ? 'CROCHET PARFAIT !' : 'CROCHET !' : 'PRESSE !', quality }
  if (wave.type === 'moving_gate') return { success: inGate, label: inGate ? perfectGate ? 'TIMING PARFAIT !' : 'BIEN LU !' : 'INTERCEPTE !', quality }
  if (wave.type === 'bonus_choice') {
    if (inBonusGate) return { success: true, bonus: true, label: perfectBonus ? 'BONUS PERFECT !' : 'BONUS !', quality }
    if (inGate) return { success: true, label: perfectGate ? 'PERFECT !' : 'PASSE !', quality }
    return { success: false, label: 'INTERCEPTE !' }
  }
  if (wave.type === 'combo_gate_slide') return { success: inGate && jump.isActive, label: inGate && jump.isActive ? perfectGate ? 'COMBO PERFECT !' : 'MAGNIFIQUE !' : 'TROP LENT !', quality }
  if (wave.type === 'roulette_wall') return { success: rouletteActive, label: rouletteActive ? 'ROULETTE !' : 'DRIBBLE FORCE !' }
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
  if (wave.type === 'roulette_wall') return 20
  return 8
}

function DribbleDefenderSprite({
  label,
  jerseyColor,
  accentColor,
  shortsColor,
  textColor,
  withBall = false,
}: {
  label: string
  jerseyColor: string
  accentColor: string
  shortsColor: string
  textColor: string
  withBall?: boolean
}) {
  return (
    <svg viewBox="0 0 80 98" width="58" height="70" className="atk-kawaii atk-kawaii--defender" aria-hidden="true">
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

function KawaiiFootballer({
  label,
  jerseyColor,
  accentColor,
  shortsColor,
  textColor,
  withBall = false,
  isPlayer = false,
  motion,
}: {
  label: string
  jerseyColor: string
  accentColor: string
  shortsColor: string
  textColor: string
  withBall?: boolean
  isPlayer?: boolean
  motion?: 'run' | 'idle' | 'ready'
}) {
  if (!isPlayer) {
    return <DribbleDefenderSprite label={label} jerseyColor={jerseyColor} accentColor={accentColor} shortsColor={shortsColor} textColor={textColor} withBall={withBall} />
  }

  return (
    <KawaiiSprite
      label={label}
      jerseyColor={jerseyColor}
      accentColor={accentColor}
      shortsColor={shortsColor}
      textColor={textColor}
      withBall={withBall}
      role="player"
      motion={motion}
      seed={label}
      className="atk-kawaii is-player"
    />
  )
}

function BonusPowerIcon({ kind }: { kind: BonusKind | 'shot' }) {
  if (kind === 'boots') {
    return <svg viewBox="0 0 64 64"><path d="M21 9c7 7 3 13 10 18 4-6 9-8 9-16 8 7 13 16 9 27l8 7-6 9-20-11-20 1c-5 0-8-4-6-9l4-10c7 5 15 5 21 2-8-4-12-10-9-18z" fill="#ff5a44"/><path d="M11 35h20l20 11-4 7-20-10H9c-3 0-4-3-3-5l2-5c1 1 2 2 3 2z" fill="#101827" stroke="#fff" strokeWidth="3" strokeLinejoin="round"/><path d="M22 34c8-1 14 1 21 6" stroke="#2bff9a" strokeWidth="4" strokeLinecap="round"/></svg>
  }
  if (kind === 'wide') {
    return <svg viewBox="0 0 64 64"><g className="atk-dribble-demo__wide-arrows"><path d="M20 14 8 32l12 18M44 14l12 18-12 18" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></g><g className="atk-dribble-demo__wide-gate"><path d="M18 18v28M46 18v28" stroke="#2bff9a" strokeWidth="7" strokeLinecap="round"/><path d="M18 32h28" stroke="#2bff9a" strokeWidth="4" strokeLinecap="round" opacity=".55"/></g><circle cx="32" cy="32" r="5" fill="#FFB800"/></svg>
  }
  if (kind === 'blast') {
    return <svg viewBox="0 0 64 64"><path d="M32 4 39 23 58 14 47 32 60 47 40 43 32 60 24 43 4 47 17 32 6 14 25 23z" fill="#FFB800" stroke="#fff" strokeWidth="3" strokeLinejoin="round"/><circle className="atk-dribble-demo__blast-def" cx="22" cy="34" r="6" fill="#FF4455" stroke="#101827" strokeWidth="2"/><circle className="atk-dribble-demo__blast-def atk-dribble-demo__blast-def--2" cx="32" cy="28" r="6" fill="#FF4455" stroke="#101827" strokeWidth="2"/><circle className="atk-dribble-demo__blast-def atk-dribble-demo__blast-def--3" cx="42" cy="34" r="6" fill="#FF4455" stroke="#101827" strokeWidth="2"/></svg>
  }
  if (kind === 'whistle') {
    return <svg viewBox="0 0 64 64"><path d="M18 36c0-10 8-18 18-18h10v14H36c-3 0-6 3-6 6s3 6 6 6h4" fill="none" stroke="#2bff9a" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="47" cy="25" r="8" fill="#fff" stroke="#101827" strokeWidth="3"/><path d="M10 20 4 14M13 12l-3-8M54 44l7 5" stroke="#ffdf73" strokeWidth="4" strokeLinecap="round"/></svg>
  }
  if (kind === 'slowmo') {
    return <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="rgba(168,85,247,.35)" stroke="#e7d5ff" strokeWidth="4"/><path d="M32 16v17l12 7" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 50h40" stroke="#a855f7" strokeWidth="5" strokeLinecap="round"/><path d="M17 55h30" stroke="#e7d5ff" strokeWidth="3" strokeLinecap="round"/></svg>
  }
  return <svg viewBox="0 0 64 64"><g className="atk-dribble-demo__fire-flame"><path d="M19 42C8 27 20 18 18 7c9 5 9 13 16 18 5-8 12-12 12-23 12 10 17 23 9 39 4 1 7 4 8 8-12 7-31 8-44-7z" fill="#ff5a44"/><path d="M27 44c-5-8 1-13 0-19 6 4 6 9 11 12 3-5 7-7 7-14 7 7 9 15 3 24-6 3-14 3-21-3z" fill="#FFB800"/></g><g className="atk-dribble-demo__fire-ball"><circle cx="32" cy="38" r="14" fill="#fff" stroke="#101827" strokeWidth="4"/><path d="M20 36c8-6 16-7 24 0M25 49c5-5 10-5 15 0M32 24v28" fill="none" stroke="#101827" strokeWidth="3" strokeLinecap="round"/><path d="M18 25 10 17M47 24l8-8" stroke="#ffdf73" strokeWidth="4" strokeLinecap="round"/></g></svg>
}

function bonusPowerText(kind: BonusKind) {
  if (kind === 'boots') return { short: 'BOUCLIER', pickup: 'BOUCLIER - 1 ERREUR PROTEGEE', hint: 'protege 1 erreur' }
  if (kind === 'whistle') return { short: 'GARDIEN LENT', pickup: 'GARDIEN RALENTI', hint: 'gardien lent' }
  if (kind === 'slowmo') return { short: 'SLOWMO', pickup: 'SLOWMO - JEU RALENTI', hint: 'ralenti' }
  if (kind === 'wide') return { short: 'PORTES LARGES', pickup: 'PORTES LARGES - PASSAGE AGRANDI', hint: 'rond vert = portes + larges' }
  if (kind === 'blast') return { short: 'SUPER ATTAQUANT', pickup: 'SUPER ATTAQUANT - DEFENSE EXPLOSEE', hint: 'explose la ligne' }
  return { short: 'TIR FACILE', pickup: 'TIR FACILE - ZONE VERTE +', hint: 'zone verte +' }
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
  roundIntroComment,
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
  const opponentShortsColor = opponentKit?.shorts ?? '#2b0508'
  const opponentTextColor = opponentKit?.text ?? '#ffffff'
  const isSuddenDeathShot = shotTitle === 'TIR DE MORT SUBITE'

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
  const [tutorialDone, setTutorialDone] = useState(() => shotOnly)
  const [showDribbleTutorial, setShowDribbleTutorial] = useState(() => !shotOnly)
  const [showDribbleDemo, setShowDribbleDemo] = useState(() => !hasSeenBattleTutorial('attack-dribble'))
  const [preCountdownNum, setPreCountdownNum] = useState<number | null>(null)
  const [countdownDone, setCountdownDone] = useState(() => shotOnly)

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
  const dashTargetXRef = useRef<number | null>(null)
  const gdPointerRef = useRef<{ id: number | null; x: number; y: number; dragging: boolean }>({ id: null, x: 0, y: 0, dragging: false })
  const rouletteUntilRef = useRef(0)
  const rouletteCooldownUntilRef = useRef(0)
  const rouletteStartedAtRef = useRef<number | null>(null)
  const shieldChargesRef = useRef(0)
  const slowmoUntilRef = useRef(0)
  const wideGateUntilRef = useRef(0)
  const blastNextWaveRef = useRef(false)
  const superAttackerUntilRef = useRef(0)
  const attackLivesRef = useRef(ATTACK_MAX_LIVES)
  const ghostUntilRef = useRef(0)
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
  const bonusAuraTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const wideGateTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const bonusFxTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const [comboDisplay, setComboDisplay] = useState(0)
  const [flow, setFlow] = useState(0)
  const [bonusFlash, setBonusFlash] = useState(false)
  const [bonusAuraActive, setBonusAuraActive] = useState(false)
  const [wideGateActive, setWideGateActive] = useState(false)
  const [activeBonusFx, setActiveBonusFx] = useState<BonusKind | null>(null)
  const [superAttackerActive, setSuperAttackerActive] = useState(false)
  const [dashActive, setDashActive] = useState(false)
  const [rouletteActive, setRouletteActive] = useState(false)
  const [attackLives, setAttackLives] = useState(ATTACK_MAX_LIVES)
  const [ghostActive, setGhostActive] = useState(false)
  const [powerupLabel, setPowerupLabel] = useState<string | null>(null)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [feverActive, setFeverActive] = useState(false)

  const startTutorialCountdown = useCallback(() => {
    sfx.click()
    markBattleTutorialSeen('attack-dribble')
    setShowDribbleTutorial(false)
    setTutorialDone(true)
    setCountdownDone(false)
    sfx.countdownTick()
    setPreCountdownNum(3)
    const t1 = window.setTimeout(() => { setPreCountdownNum(2); sfx.countdownTick() }, 800)
    const t2 = window.setTimeout(() => { setPreCountdownNum(1); sfx.countdownTick() }, 1600)
    const t3 = window.setTimeout(() => { setPreCountdownNum(0); sfx.countdownGo() }, 2400)
    const t4 = window.setTimeout(() => {
      setPreCountdownNum(null)
      setCountdownDone(true)
    }, 3050)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
    }
  }, [])

  useEffect(() => () => {
    if (bonusAuraTimeoutRef.current) window.clearTimeout(bonusAuraTimeoutRef.current)
    if (wideGateTimeoutRef.current) window.clearTimeout(wideGateTimeoutRef.current)
    if (bonusFxTimeoutRef.current) window.clearTimeout(bonusFxTimeoutRef.current)
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
  const [showShotTutorial, setShowShotTutorial] = useState(true)
  const [showShotDemo, setShowShotDemo] = useState(() => !hasSeenBattleTutorial('attack-shot'))
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
    setShowShotTutorial(true)
    setShowShotDemo(!hasSeenBattleTutorial('attack-shot'))
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
    dashTargetXRef.current = null
    rouletteUntilRef.current = 0
    rouletteCooldownUntilRef.current = 0
    rouletteStartedAtRef.current = null
    shieldChargesRef.current = 0
    slowmoUntilRef.current = 0
    wideGateUntilRef.current = 0
    if (wideGateTimeoutRef.current) {
      window.clearTimeout(wideGateTimeoutRef.current)
      wideGateTimeoutRef.current = null
    }
    setWideGateActive(false)
    if (bonusFxTimeoutRef.current) {
      window.clearTimeout(bonusFxTimeoutRef.current)
      bonusFxTimeoutRef.current = null
    }
    setActiveBonusFx(null)
    blastNextWaveRef.current = false
    superAttackerUntilRef.current = 0
    attackLivesRef.current = ATTACK_MAX_LIVES
    ghostUntilRef.current = 0
    shotBonusRef.current = { widerGreen: 0, slowKeeper: 0, powerShot: false }
    setComboDisplay(0)
    setFlow(0)
    setBonusFlash(false)
    setSuperAttackerActive(false)
    setDashActive(false)
    setRouletteActive(false)
    setAttackLives(ATTACK_MAX_LIVES)
    setGhostActive(false)
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
    return Math.min(110, cfg.gaugeGreenPx + shotBonusRef.current.widerGreen * 4 + (flowRef.current >= POWER_SHOT_FLOW_THRESHOLD ? 3 : 0) + (shotBonusRef.current.powerShot ? 4 : 0))
  }, [cfg.gaugeGreenPx])

  const activateBonusAura = useCallback((durationMs: number) => {
    setBonusAuraActive(true)
    if (bonusAuraTimeoutRef.current) window.clearTimeout(bonusAuraTimeoutRef.current)
    bonusAuraTimeoutRef.current = window.setTimeout(() => {
      setBonusAuraActive(false)
      bonusAuraTimeoutRef.current = null
    }, durationMs)
  }, [])

  const activateBonusFieldFx = useCallback((kind: BonusKind, durationMs: number) => {
    setActiveBonusFx(kind)
    if (bonusFxTimeoutRef.current) window.clearTimeout(bonusFxTimeoutRef.current)
    bonusFxTimeoutRef.current = window.setTimeout(() => {
      setActiveBonusFx(null)
      bonusFxTimeoutRef.current = null
    }, durationMs)
  }, [])
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
      const bonusText = bonusPowerText(bonusKind)
      let auraDuration = 1400
      if (bonusKind === 'coin') {
        sfx.bonusCoin()
        shotBonusRef.current.widerGreen += 1
        setPowerupLabel(bonusText.pickup)
      } else if (bonusKind === 'boots') {
        sfx.bonusCoin()
        shieldChargesRef.current = Math.min(2, shieldChargesRef.current + 1)
        shotBonusRef.current.widerGreen += 0.5
        setPowerupLabel(bonusText.pickup)
        auraDuration = 4200
      } else if (bonusKind === 'whistle') {
        sfx.whistle()
        shotBonusRef.current.slowKeeper += 1
        setPowerupLabel(bonusText.pickup)
        auraDuration = 2600
      } else if (bonusKind === 'slowmo') {
        sfx.slowmo()
        slowmoUntilRef.current = performance.now() + 3600
        shotBonusRef.current.slowKeeper += 0.5
        setPowerupLabel(bonusText.pickup)
        auraDuration = 3600
      } else if (bonusKind === 'wide') {
        wideGateUntilRef.current = performance.now() + 4200
        if (wideGateTimeoutRef.current) window.clearTimeout(wideGateTimeoutRef.current)
        setWideGateActive(true)
        wideGateTimeoutRef.current = window.setTimeout(() => {
          setWideGateActive(false)
          wideGateTimeoutRef.current = null
        }, 4200)
        sfx.wideGate()
        shotBonusRef.current.widerGreen += 0.75
        setPowerupLabel(bonusText.pickup)
        auraDuration = 4200
      } else {
        sfx.blastPower()
        const now = performance.now()
        blastNextWaveRef.current = false
        superAttackerUntilRef.current = now + SUPER_ATTACKER_DURATION
        shotBonusRef.current.widerGreen += 0.35
        setSuperAttackerActive(true)
        window.setTimeout(() => {
          if (performance.now() >= superAttackerUntilRef.current) setSuperAttackerActive(false)
        }, SUPER_ATTACKER_DURATION + 60)
        setPowerupLabel(bonusText.pickup)
        auraDuration = SUPER_ATTACKER_DURATION
      }
      activateBonusAura(auraDuration)
      activateBonusFieldFx(bonusKind, auraDuration)
      setBonusFlash(true)
      window.setTimeout(() => setBonusFlash(false), 420)
      window.setTimeout(() => setPowerupLabel(null), 1150)
    }
    if (nextFlow >= 70 && shotBonusRef.current.slowKeeper === 0) {
      shotBonusRef.current.slowKeeper = 1
    }

    if (((nextFlow >= 100 && wasBelowMax) || comboRef.current >= cfg.waveCount) && !shotBonusRef.current.powerShot) {
      shotBonusRef.current.powerShot = true
      sfx.powerShot()
      setPowerupLabel('TIR BOOSTE CHARGE')
      activateBonusFieldFx('coin', 1300)
      window.setTimeout(() => setPowerupLabel(null), 1250)
    }
  }, [activateBonusAura, activateBonusFieldFx, cfg.waveCount])

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

  function getRouletteState(now: number) {
    const startedAt = rouletteStartedAtRef.current
    if (!startedAt) return { isActive: false, elapsed: 0 }
    const elapsed = now - startedAt
    return {
      isActive: elapsed >= ROULETTE_ACTIVE_START && elapsed <= ROULETTE_ACTIVE_END,
      elapsed,
    }
  }

  const absorbDribbleHit = useCallback((label: string) => {
    if (shieldChargesRef.current > 0) {
      shieldChargesRef.current -= 1
      ghostUntilRef.current = performance.now() + ATTACK_GHOST_DURATION
      setGhostActive(true)
      window.setTimeout(() => setGhostActive(false), ATTACK_GHOST_DURATION)
      setGdFlash(true)
      setGdComment('BOUCLIER CASSE - ERREUR PROTEGEE')
      window.setTimeout(() => setGdFlash(false), 300)
      return attackLivesRef.current
    }
    const nextLives = Math.max(0, attackLivesRef.current - 1)
    attackLivesRef.current = nextLives
    setAttackLives(nextLives)
    ghostUntilRef.current = performance.now() + ATTACK_GHOST_DURATION
    setGhostActive(true)
    window.setTimeout(() => setGhostActive(false), ATTACK_GHOST_DURATION)
    comboRef.current = 0
    perfectStreakRef.current = 0
    flowRef.current = Math.max(0, flowRef.current - 18)
    setComboDisplay(0)
    setPerfectStreak(0)
    setFlow(flowRef.current)
    setGdFlash(true)
    setGdComment(nextLives > 0 ? `${label} - ${nextLives} VIE${nextLives > 1 ? 'S' : ''}` : 'PLUS DE VIES !')
    window.setTimeout(() => setGdFlash(false), 300)
    return nextLives
  }, [])

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

  const moveDribblePlayerTo = (nextX: number) => {
    gdPlayerXRef.current = Math.max(3, Math.min(97, nextX))
    if (playerElRef.current) {
      const width = gameWidthRef.current || containerRectRef.current.width
      const x = (gdPlayerXRef.current / 100) * width - 29
      playerElRef.current.style.transform = `translateX(${x}px)`
      playerElRef.current.style.setProperty('--atk-player-x', `${x}px`)
    }
  }

  const getEvadeTargetX = (wave?: SlalomWave) => {
    if (!wave || !isGatePassWave(wave)) return null
    const gateCenter = getWaveGateCenter(wave, gdElapsedRef.current)
    if (wave.bonusGateCenterX != null && wave.bonusGateWidth != null) {
      const playerX = gdPlayerXRef.current
      const regularDistance = Math.abs(playerX - gateCenter)
      const bonusDistance = Math.abs(playerX - wave.bonusGateCenterX)
      return bonusDistance + 5 < regularDistance ? wave.bonusGateCenterX : gateCenter
    }
    return gateCenter
  }

  const handleDash = (direction?: -1 | 1, targetX?: number | null) => {
    const now = performance.now()
    if (now < dashCooldownUntilRef.current) return
    const currentX = gdPlayerXRef.current
    const hasTarget = targetX != null && Math.abs(targetX - currentX) > 1
    const inferredDirection: -1 | 1 = hasTarget
      ? targetX > currentX ? 1 : -1
      : direction
        ?? (keysRef.current.left && !keysRef.current.right ? -1 : keysRef.current.right && !keysRef.current.left ? 1 : currentX < 50 ? 1 : -1)
    dashDirectionRef.current = inferredDirection
    dashUntilRef.current = now + DASH_DURATION
    dashCooldownUntilRef.current = now + (now < feverUntilRef.current ? DASH_COOLDOWN * 0.58 : DASH_COOLDOWN)
    dashTargetXRef.current = hasTarget ? targetX : null
    const nextX = hasTarget
      ? currentX + Math.max(-DASH_DISTANCE, Math.min(DASH_DISTANCE, targetX - currentX))
      : currentX + inferredDirection * DASH_DISTANCE
    moveDribblePlayerTo(nextX)
    sfx.jump()
    setDashActive(true)
    setGdComment(hasTarget ? 'VERS LA PORTE !' : now < feverUntilRef.current ? 'FEVER DASH !' : 'ESQUIVE !')
    if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
    commentTimerRef.current = setTimeout(() => setGdComment(null), 520)
    window.setTimeout(() => {
      dashTargetXRef.current = null
      setDashActive(false)
    }, DASH_DURATION)
  }

  const handleRoulette = () => {
    const now = performance.now()
    if (now < rouletteCooldownUntilRef.current) return
    rouletteStartedAtRef.current = now
    rouletteUntilRef.current = now + ROULETTE_DURATION
    rouletteCooldownUntilRef.current = now + (now < feverUntilRef.current ? ROULETTE_COOLDOWN * 0.62 : ROULETTE_COOLDOWN)
    sfx.jump()
    setRouletteActive(true)
    setGdComment('ROULETTE !')
    if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
    commentTimerRef.current = setTimeout(() => setGdComment(null), 560)
    window.setTimeout(() => {
      rouletteStartedAtRef.current = null
      setRouletteActive(false)
    }, ROULETTE_DURATION)
  }

  const handleEvade = () => {
    const nextWave = gdWallsRef.current.find((wave) => !wave.checked)
    if (nextWave?.requiresRoulette) {
      handleRoulette()
      return
    }
    if (nextWave?.requiresJump) {
      handleJump()
      return
    }
    handleDash(undefined, getEvadeTargetX(nextWave))
  }

  //  Keyboard handler 
  useEffect(() => {
    if (!tutorialDone || !countdownDone) return
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { keysRef.current.left  = true; e.preventDefault() }
      if (e.key === 'ArrowRight') { keysRef.current.right = true; e.preventDefault() }
      if (e.key === ' ')          { handleEvade(); e.preventDefault() }
      if (e.key === 'Shift')      { handleEvade(); e.preventDefault() }
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
  }, [countdownDone, tutorialDone])

  //  GD RAF  walls fall from top 
  useEffect(() => {
    if (phase !== 'gd' || !tutorialDone || !countdownDone || showShotIntro) return
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

      const isFeverActive = now < feverUntilRef.current
      const isSlowmoActive = now < slowmoUntilRef.current
      const superAttackerNow = now < superAttackerUntilRef.current
      const playerSpeed = PLAYER_SPEED * (flowRef.current >= POWER_SHOT_FLOW_THRESHOLD ? 1.05 : 1) * (isFeverActive ? 1.12 : 1)
      const dashActiveNow = now < dashUntilRef.current
      const rouletteActiveNow = now < rouletteUntilRef.current

      // Move player X via keyboard  direct DOM, no React re-render
      if (keysRef.current.left) {
        gdPlayerXRef.current = Math.max(3, gdPlayerXRef.current - playerSpeed * delta)
      }
      if (keysRef.current.right) {
        gdPlayerXRef.current = Math.min(97, gdPlayerXRef.current + playerSpeed * delta)
      }
      if (dashActiveNow) {
        const dashTarget = dashTargetXRef.current
        if (dashTarget != null) {
          const diff = dashTarget - gdPlayerXRef.current
          const step = Math.sign(diff) * Math.min(Math.abs(diff), 88 * delta)
          gdPlayerXRef.current = Math.max(3, Math.min(97, gdPlayerXRef.current + step))
          if (Math.abs(diff) <= 0.8) dashTargetXRef.current = null
        } else {
          gdPlayerXRef.current = Math.max(3, Math.min(97, gdPlayerXRef.current + dashDirectionRef.current * 48 * delta))
        }
      }
      if (playerElRef.current) {
        // transform: compositor thread only  no layout, no paint
        const x = (gdPlayerXRef.current / 100) * gameWidthRef.current - 29
        playerElRef.current.style.transform = `translateX(${x}px)`
        playerElRef.current.style.setProperty('--atk-player-x', `${x}px`)
      }

      const progress = gdCheckedRef.current / Math.max(1, cfg.waveCount)
      const speed = cfg.gdSpeed * (1 + progress * cfg.difficultyRamp) * (isSlowmoActive ? 0.68 : 1) * (superAttackerNow ? 1.5 : 1)

      // Walls fall: update ONE container transform  GPU composited, zero layout reflow
      gdFallPctRef.current += speed * delta
      if (wallContainerRef.current) {
        wallContainerRef.current.style.transform = `translateY(${gdFallPctRef.current}%)`
      }

      // Collision / pass check  fire once per wall when it reaches player Y
      const walls   = gdWallsRef.current
      const playerX = gdPlayerXRef.current
      const fall    = gdFallPctRef.current
      const markSlalomCompleteIfNeeded = (wall: SlalomWave) => {
        if (slalomCompletePendingRef.current || gdCheckedRef.current < walls.length) return
        slalomCompletePendingRef.current = true
        slalomCompleteWorldYRef.current = wall.worldY
        if (comboRef.current >= walls.length) {
          shotBonusRef.current.powerShot = true
          setGdComment('DRIBBLE PARFAIT !')
        } else if (flowRef.current >= POWER_SHOT_FLOW_THRESHOLD) {
          setGdComment('FACE AU GARDIEN - TIR BOOSTE !')
        } else {
          setGdComment('FACE AU GARDIEN !')
        }
        if (commentTimerRef.current) {
          clearTimeout(commentTimerRef.current)
          commentTimerRef.current = null
        }
      }
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
        const roulette = getRouletteState(now)
        const ghostActiveNow = now < ghostUntilRef.current

        if ((superAttackerNow || blastNextWaveRef.current) && wall.type !== 'bonus_choice') {
          if (!superAttackerNow) blastNextWaveRef.current = false
          wall.passed = true
          wall.superBlasted = true
          registerDribbleSuccess(wall, { label: 'EXPLOSION !', quality: 'perfect' })
          gdCheckedRef.current++
          setGdWallsDisplay([...gdWallsRef.current])
          sfx.kamikaze()
          setGdComment(superAttackerNow ? 'SUPER ATTAQUANT !' : 'RANGEE EXPLOSEE !')
          if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
          commentTimerRef.current = setTimeout(() => setGdComment(null), 760)
          markSlalomCompleteIfNeeded(wall)
          continue
        }

        const outcome = evaluateWaveSuccess(wall, playerX, jump, gdElapsedRef.current, dashActiveNow, roulette.isActive || rouletteActiveNow, now < wideGateUntilRef.current)

        if (outcome.success || ghostActiveNow) {
          wall.passed = true
          registerDribbleSuccess(wall, ghostActiveNow && !outcome.success ? { label: 'GHOST !' } : outcome)
          if (isGatePassWave(wall)) sfx.gatePass()
          gdCheckedRef.current++
          setGdWallsDisplay([...gdWallsRef.current])
          const comboLabel = outcome.quality === 'perfect'
            ? perfectStreakRef.current >= 3 ? `PERFECT x${perfectStreakRef.current}` : 'PERFECT !'
            : comboRef.current >= 10 ? 'INARRETABLE !' : comboRef.current >= 7 ? 'FLOW !' : comboRef.current >= 5 ? 'DRIBBLE FOU !' : comboRef.current >= 3 ? 'CROCHET !' : outcome.label
          const comment = outcome.bonus ? bonusPowerText(wall.bonusKind ?? 'coin').short : comboLabel || GD_COMMENTS[Math.floor(Math.random() * GD_COMMENTS.length)]
          setGdComment(comment)
          if (commentTimerRef.current) clearTimeout(commentTimerRef.current)
          commentTimerRef.current = setTimeout(() => setGdComment(null), 800)

          markSlalomCompleteIfNeeded(wall)
        } else {
          wall.failed = true
          setGdWallsDisplay([...gdWallsRef.current])
          const nextLives = absorbDribbleHit(outcome.label || getJumpTone(wall, now, jump))
          gdCheckedRef.current++
          markSlalomCompleteIfNeeded(wall)
          if (nextLives <= 0) {
            setTimeout(() => finish(false, 'intercepted'), 420)
            return
          }
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
  }, [phase, tutorialDone, countdownDone, showShotIntro, cfg.gdSpeed, cfg.difficultyRamp, cfg.waveCount, finish, registerDribbleSuccess, absorbDribbleHit])

  //  Pointer move for GD: desktop follows cursor, touch keeps drag-only control.
  const handleGdPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== 'gd' || endedRef.current) return
    const pointer = gdPointerRef.current
    if (e.pointerType !== 'mouse') {
      if (pointer.id !== e.pointerId) return
      const moved = Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y)
      if (!pointer.dragging && moved < 8) return
      pointer.dragging = true
    }
    const { left, width } = containerRectRef.current
    if (!width) return
    gdPlayerXRef.current = Math.max(3, Math.min(97, ((e.clientX - left) / width) * 100))
    if (playerElRef.current) {
      const x = (gdPlayerXRef.current / 100) * (gameWidthRef.current || width) - 29
      playerElRef.current.style.transform = `translateX(${x}px)`
      playerElRef.current.style.setProperty('--atk-player-x', `${x}px`)
    }
  }

  const handleGdPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (phaseRef.current !== 'gd' || endedRef.current) return
    gdPointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }
  }

  const handleGdPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const pointer = gdPointerRef.current
    if (pointer.id !== e.pointerId) return
    const wasTap = !pointer.dragging && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 10
    gdPointerRef.current = { id: null, x: 0, y: 0, dragging: false }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (!wasTap || phaseRef.current !== 'gd' || endedRef.current) return
    const nextWave = gdWallsRef.current.find((wave) => !wave.checked)
    if (nextWave?.requiresRoulette || nextWave?.requiresJump) handleEvade()
  }

  const handleGdPointerCancel = (e?: React.PointerEvent<HTMLElement>) => {
    if (e && gdPointerRef.current.id === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    gdPointerRef.current = { id: null, x: 0, y: 0, dragging: false }
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
      const keeperSpeedMultiplier = shotBonusRef.current.slowKeeper > 0 || flowRef.current >= POWER_SHOT_FLOW_THRESHOLD ? 0.85 : 1
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
    const originY = rect.top + rect.height * SHOT_ORIGIN_Y_FRAC
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
  }

  //  Transition from GD to shot 
  function handleStartShot(withClickSound = true) {
    if (withClickSound) sfx.click()
    setShowShotIntro(false)
    phaseRef.current = 'shot'
    setPhase('shot')
    setShooterSelectionDone(false)
    setShotTutorialDone(false)
    setShowShotTutorial(true)
    setShowShotDemo(!hasSeenBattleTutorial('attack-shot'))
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
  const shotBoostReady = shotBonusRef.current.powerShot || flow >= POWER_SHOT_FLOW_THRESHOLD
  const nextGdWave = gdWallsDisplay.find((wave) => !wave.checked)
  const gdInstruction = getWaveInstruction(nextGdWave)
  const gdBadgeClass = nextGdWave?.type === 'slide_wall' || nextGdWave?.type === 'double_slide_wall' ? ' is-jump' : nextGdWave?.type === 'roulette_wall' ? ' is-roulette' : nextGdWave?.type === 'combo_gate_slide' ? ' is-combo' : nextGdWave?.type === 'bonus_choice' ? ' is-bonus' : nextGdWave?.moveAmplitude ? ' is-moving' : ''
  const firstPendingGdWaveIndex = gdWallsDisplay.findIndex((wave) => !wave.checked)
  const visibleGdWalls = phase === 'gd' && firstPendingGdWaveIndex >= 0
    ? gdWallsDisplay.slice(
      Math.max(0, firstPendingGdWaveIndex - DRIBBLE_RENDER_BACKTRACK),
      Math.min(gdWallsDisplay.length, firstPendingGdWaveIndex + DRIBBLE_RENDER_LOOKAHEAD),
    )
    : gdWallsDisplay
  const shotTutorialComment = roundIntroComment ?? `${selectedShooter.name} est prêt. Choisis ta zone, puis frappe quand la jauge passe au vert.`

  return (
    <section
      className={`atk-root is-${phase}${superAttackerActive ? ' is-super-attacker' : ''}${activeBonusFx ? ` is-bonus-${activeBonusFx}` : ''}` }
      ref={containerRef}
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerMove={(e) => {
        // Section-level: handles both phases so finger can roam anywhere (GD: no inner-div boundary)
        if (phase === 'gd' && tutorialDone && countdownDone && !showShotIntro) handleGdPointerMove(e)
        else if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerMove(e)
      }}
      onPointerDown={(e) => {
        if (phase === 'gd' && tutorialDone && countdownDone && !showShotIntro) {
          handleGdPointerDown(e)
        }
        else if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerDown(e)
      }}
      onPointerUp={(e) => {
        if (phase === 'gd' && tutorialDone && countdownDone && !showShotIntro) handleGdPointerUp(e)
        else if (phase === 'shot' && !showShotIntro && !ballFlight) handleShotPointerUp(e)
      }}
      onPointerCancel={(e) => {
        if (phase === 'gd' && tutorialDone && countdownDone && !showShotIntro) handleGdPointerCancel(e)
        else if (phase === 'shot') handleShotPointerCancel()
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
          background:
            linear-gradient(180deg, rgba(255,255,255,.055), transparent 34%),
            #030509;
          backdrop-filter: blur(3px) grayscale(1);
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 14px; padding: 24px;
          color: #fff;
        }
        .atk-tutorial__title {
          font: 900 clamp(32px,10vw,56px) 'Barlow Condensed', sans-serif;
          letter-spacing: .18em; color: #fff;
          text-shadow: 0 0 24px rgba(255,255,255,.28); text-transform: uppercase;
          text-align: center;
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
          margin-top: 8px; min-height: 50px; padding: 0 28px; border-radius: 14px;
          border: 1.5px solid rgba(255,255,255,.86); background: rgba(255,255,255,.92);
          color: #030509; font: 900 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em; text-transform: uppercase; cursor: pointer;
          box-shadow: 0 12px 28px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.65);
          transition: transform .12s ease;
        }
        .atk-tutorial__btn:active { transform: scale(.97); }
        .atk-tutorial-open {
          position: absolute;
          z-index: 44;
          top: max(76px, calc(env(safe-area-inset-top) + 54px));
          right: 12px;
          min-height: 34px;
          padding: 0 13px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.62);
          background: rgba(3,5,9,.74);
          color: #fff;
          font: 900 11px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em;
          text-transform: uppercase;
          box-shadow: 0 0 18px rgba(255,255,255,.1);
          backdrop-filter: blur(8px);
          cursor: pointer;
        }
        .atk-tutorial__comment { display:grid; grid-template-columns:50px minmax(0,1fr); align-items:center; gap:10px; width:min(86vw,340px); padding:8px 10px; border:1px solid rgba(255,255,255,.22); border-left:3px solid #fff; border-radius:14px; background:rgba(255,255,255,.06); color:#fff; font:800 13px 'Barlow Condensed',sans-serif; letter-spacing:.04em; text-align:left; }
        .atk-tutorial__avatar { width:50px; height:58px; display:grid; place-items:center; overflow:visible; }
        .atk-tutorial__avatar .atk-kawaii { width:48px; height:60px; filter:drop-shadow(0 8px 10px rgba(0,0,0,.45)); animation:battleOrbFloat .72s ease-in-out infinite alternate; }
        .atk-dribble-demo { position:relative; width:min(86vw,340px); height:min(46vh,330px); min-height:292px; overflow:hidden; border:1px solid rgba(43,255,154,.26); border-radius:18px; background:linear-gradient(180deg,#07351d 0%,#0a2518 100%); box-shadow:inset 0 0 28px rgba(255,255,255,.06),0 18px 36px rgba(0,0,0,.34); perspective:520px; }
        .atk-dribble-demo:before { content:''; position:absolute; inset:0; background:repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 1px,transparent 1px 20%),repeating-linear-gradient(0deg,transparent 0 38px,rgba(255,255,255,.045) 38px 40px); opacity:.82; }
        .atk-dribble-demo__row { position:absolute; left:6%; right:6%; height:74px; z-index:4; opacity:0; animation-duration:9s; animation-timing-function:linear; animation-iteration-count:infinite; }
        .atk-dribble-demo__row--gate-a { top:-24%; animation-name:atkDemoRowA; }
        .atk-dribble-demo__row--gate-b { top:-24%; animation-name:atkDemoRowB; }
        .atk-dribble-demo__row--jump { top:-24%; animation-name:atkDemoRowC; }
        .atk-dribble-demo__row--jump-b { top:-24%; animation-name:atkDemoRowD; }
        .atk-dribble-demo__lane { position:absolute; left:30%; top:6px; width:34%; height:48px; transform:translateX(-50%); border:3px solid #2bff9a; border-block-color:transparent; border-radius:999px; box-shadow:inset 0 0 18px rgba(43,255,154,.18),0 0 18px rgba(43,255,154,.72); }
        .atk-dribble-demo__lane:after { content:'PORTE'; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:#2bff9a; font:900 10px 'Barlow Condensed'; letter-spacing:.16em; text-shadow:0 0 10px rgba(43,255,154,.9); }
        .atk-dribble-demo__wall { position:absolute; left:4%; right:4%; top:24px; height:7px; border-radius:999px; background:linear-gradient(90deg,rgba(255,184,0,.2),rgba(255,68,85,.82),rgba(255,184,0,.2)); box-shadow:0 0 18px rgba(255,68,85,.52); }
        .atk-dribble-demo__row--jump-b .atk-dribble-demo__wall { background:linear-gradient(90deg,rgba(255,184,0,.2),rgba(255,68,85,.82),rgba(255,184,0,.2)); box-shadow:0 0 18px rgba(255,68,85,.52); }
        .atk-dribble-demo__def { position:absolute; top:0; width:42px; height:54px; transform:translateX(-50%); filter:drop-shadow(0 8px 10px rgba(0,0,0,.42)); animation:atkDemoDefBob .62s ease-in-out infinite alternate; }
        .atk-dribble-demo__def .atk-defender { width:42px; height:54px; }
        .atk-dribble-demo__def--l { left:18%; }
        .atk-dribble-demo__def--m { left:50%; }
        .atk-dribble-demo__def--r { left:82%; }
        .atk-dribble-demo__row--gate-a .atk-dribble-demo__lane { left:30%; }
        .atk-dribble-demo__row--gate-a .atk-dribble-demo__def--l { left:58%; }
        .atk-dribble-demo__row--gate-a .atk-dribble-demo__def--r { left:84%; }
        .atk-dribble-demo__row--gate-b .atk-dribble-demo__lane { left:70%; }
        .atk-dribble-demo__row--gate-b .atk-dribble-demo__def--l { left:16%; }
        .atk-dribble-demo__row--gate-b .atk-dribble-demo__def--r { left:42%; }
        .atk-dribble-demo__row--jump .atk-dribble-demo__def { top:2px; }
        .atk-dribble-demo__row--jump-b .atk-dribble-demo__def { top:2px; }
        .atk-dribble-demo__row--jump .atk-dribble-demo__def--l,
        .atk-dribble-demo__row--jump .atk-dribble-demo__def--r,
        .atk-dribble-demo__row--jump-b .atk-dribble-demo__def--l,
        .atk-dribble-demo__row--jump-b .atk-dribble-demo__def--r { display:none; }
        .atk-dribble-demo__row--jump .atk-dribble-demo__def--m,
        .atk-dribble-demo__row--jump-b .atk-dribble-demo__def--m { left:50%; animation:atkDemoDefBob .62s ease-in-out infinite alternate, atkDemoDefPatrolWide 1.05s ease-in-out infinite alternate; }
        .atk-dribble-demo__row--gate-a .atk-dribble-demo__def,
        .atk-dribble-demo__row--gate-b .atk-dribble-demo__def { animation:atkDemoDefBob .62s ease-in-out infinite alternate, atkDemoDefPatrol 1.15s ease-in-out infinite alternate; }
        .atk-dribble-demo__row--gate-a .atk-dribble-demo__def--r,
        .atk-dribble-demo__row--gate-b .atk-dribble-demo__def--r { animation-delay:0s,-.55s; }
        .atk-dribble-demo__player { position:absolute; left:50%; bottom:9%; z-index:10; width:54px; height:66px; transform:translateX(-50%); transform-style:preserve-3d; animation:atkDemoPlayerMove 9s ease-in-out infinite; }
        .atk-dribble-demo__player .atk-kawaii { width:54px; height:66px; filter:drop-shadow(0 0 16px rgba(43,255,154,.5)); }
        .atk-dribble-demo__player:before { content:''; position:absolute; left:50%; top:54%; width:62px; height:62px; margin:-31px 0 0 -31px; border-radius:999px; border:3px solid rgba(255,184,0,.82); box-shadow:0 0 18px rgba(255,184,0,.62); opacity:0; pointer-events:none; }
        .atk-dribble-demo__player:before { animation:atkDemoPlayerHaloJump 9s linear infinite; }
        .atk-dribble-demo__finger { position:absolute; z-index:16; left:50%; bottom:6%; width:42px; height:58px; transform:translate(-50%,0); animation:atkDemoFingerMove 9s ease-in-out infinite; filter:drop-shadow(0 0 12px rgba(43,255,154,.75)); }
        .atk-dribble-demo__finger svg { position:relative; z-index:2; width:100%; height:100%; overflow:visible; }
        .atk-dribble-demo__tap { position:absolute; z-index:1; left:15px; top:2px; display:block; width:8px; height:8px; border-radius:999px; border:0; color:transparent; background:transparent; font-size:0; box-shadow:none; opacity:1; transform-origin:50% 50%; pointer-events:none; overflow:visible; }
        .atk-dribble-demo__tap:before, .atk-dribble-demo__tap:after { content:''; position:absolute; left:50%; top:50%; width:10px; height:10px; margin:-5px 0 0 -5px; border-radius:999px; border:3px solid rgba(255,184,0,.95); box-shadow:0 0 22px rgba(255,184,0,.7); opacity:0; }
        .atk-dribble-demo__tap:after { border-color:rgba(255,255,255,.8); box-shadow:0 0 26px rgba(255,255,255,.45); }
        .atk-dribble-demo__tap--jump:before, .atk-dribble-demo__tap--jump2:before { animation:atkDemoTapHalo 9s linear infinite; }
        .atk-dribble-demo__tap--jump:after, .atk-dribble-demo__tap--jump2:after { animation:atkDemoTapWave 9s linear infinite; }
        .atk-dribble-demo__tap--jump:before, .atk-dribble-demo__tap--jump:after { animation-delay:4.9s; }
        .atk-dribble-demo__tap--jump2:before, .atk-dribble-demo__tap--jump2:after { animation-delay:6.5s; }
        .atk-dribble-demo__tap--jump { animation:atkDemoTap 9s linear infinite 4.9s; }
        .atk-dribble-demo__tap--jump2 { animation:atkDemoTap 9s linear infinite 6.5s; }
        .atk-dribble-demo__jump-arc { display:none; }
        .atk-dribble-demo__caption { position:absolute; left:10px; right:10px; bottom:8px; z-index:18; display:flex; justify-content:space-between; gap:6px; color:rgba(255,255,255,.78); font:900 10px 'Barlow Condensed'; letter-spacing:.08em; text-transform:uppercase; }
        .atk-dribble-demo__caption b { color:#2bff9a; }
        .atk-dribble-demo__bonus-tip { display:grid; grid-template-columns:1fr; justify-items:center; gap:7px; width:min(86vw,340px); color:rgba(255,255,255,.78); font:900 10px 'Barlow Condensed'; letter-spacing:.06em; text-transform:uppercase; text-align:center; }
        .atk-dribble-demo__bonus-icons { display:grid; grid-template-columns:repeat(4,minmax(48px,62px)); align-items:start; justify-content:center; gap:10px; width:100%; }
        .atk-dribble-demo__bonus-item { display:grid; justify-items:center; gap:4px; min-width:0; }
        .atk-dribble-demo__bonus-item small { max-width:64px; color:rgba(255,255,255,.76); font:900 8px/1 'Barlow Condensed'; letter-spacing:.06em; text-align:center; }
        .atk-dribble-demo__bonus-icon { width:42px; height:42px; display:grid; place-items:center; border-radius:999px; border:2px solid rgba(255,255,255,.72); background:rgba(5,11,22,.72); box-shadow:0 0 18px rgba(255,184,0,.32); animation:atkBonusOrb .46s ease-in-out infinite alternate; }
        .atk-dribble-demo__bonus-icon svg { width:30px; height:30px; display:block; overflow:visible; }
        .atk-dribble-demo__bonus-icon--boot { box-shadow:0 0 20px rgba(255,68,85,.46); }
        .atk-dribble-demo__bonus-icon--wide { box-shadow:0 0 20px rgba(43,255,154,.44); }
        .atk-dribble-demo__bonus-icon--shot { box-shadow:0 0 22px rgba(255,216,74,.54); }
        .atk-dribble-demo__fire-ball { animation:atkDemoFireBall .58s ease-in-out infinite alternate; transform-origin:center; }
        .atk-dribble-demo__fire-flame { animation:atkDemoFireFlame .42s ease-in-out infinite alternate; transform-origin:center bottom; }
        .atk-dribble-demo__wide-gate { transform-origin:32px 32px; animation:atkDemoWideGate 1.05s ease-in-out infinite alternate; }
        .atk-dribble-demo__wide-arrows { animation:atkDemoWideArrows 1.05s ease-in-out infinite alternate; }
        .atk-dribble-demo__bonus-icon--blast { box-shadow:0 0 20px rgba(255,184,0,.5); }
        .atk-dribble-demo__blast-def { animation:atkDemoBlastDef .7s ease-out infinite; transform-origin:center; }
        .atk-dribble-demo__blast-def--2 { animation-delay:.12s; }
        .atk-dribble-demo__blast-def--3 { animation-delay:.24s; }
        .atk-dribble-demo__tap-hint { position:absolute; z-index:17; left:calc(100% + 3px); top:-8px; color:#FFB800; font:900 9px 'Barlow Condensed'; letter-spacing:.12em; text-shadow:0 0 10px rgba(255,184,0,.9); opacity:0; animation:atkDemoTapHint 9s linear infinite; }
        .atk-dribble-demo__tap-hint--jump { animation-delay:4.45s; }
        .atk-dribble-demo__tap-hint--jump2 { animation-delay:6.05s; }
        @keyframes atkDemoDefBob { from{transform:translateX(-50%) translateY(-1px)} to{transform:translateX(-50%) translateY(2px)} }
        @keyframes atkDemoDefPatrol { from{margin-left:-10px} to{margin-left:10px} }
        @keyframes atkDemoDefPatrolWide { from{margin-left:-42px} to{margin-left:42px} }
        @keyframes atkDemoRowA { 0%{transform:translateY(-180px);opacity:0} 5%{opacity:1} 20%{transform:translateY(250px);opacity:1} 34%{transform:translateY(520px);opacity:0} 100%{transform:translateY(520px);opacity:0} }
        @keyframes atkDemoRowB { 0%,16%{transform:translateY(-180px);opacity:0} 20%{opacity:1} 38%{transform:translateY(250px);opacity:1} 52%{transform:translateY(520px);opacity:0} 100%{transform:translateY(520px);opacity:0} }
        @keyframes atkDemoRowC { 0%,34%{transform:translateY(-180px);opacity:0} 38%{opacity:1} 56%{transform:translateY(250px);opacity:1} 70%{transform:translateY(520px);opacity:0} 100%{transform:translateY(520px);opacity:0} }
        @keyframes atkDemoRowD { 0%,52%{transform:translateY(-180px);opacity:0} 56%{opacity:1} 74%{transform:translateY(250px);opacity:1} 88%{transform:translateY(520px);opacity:0} 100%{transform:translateY(520px);opacity:0} }
        @keyframes atkDemoPlayerMove { 0%,13%{left:50%;bottom:9%;transform:translateX(-50%) scale(1)} 17%,29%{left:30%;bottom:9%;transform:translateX(-50%) scale(1.04)} 32%,34%{left:50%;bottom:9%;transform:translateX(-50%) scale(1)} 36%,48%{left:70%;bottom:9%;transform:translateX(-50%) scale(1.04)} 51%,53%{left:50%;bottom:9%;transform:translateX(-50%) scale(1)} 54%,64%{left:50%;bottom:9%;transform:translateX(-50%) translateY(-34px) scale(1.26)} 67%,70%{left:50%;bottom:9%;transform:translateX(-50%) scale(1)} 72%,82%{left:50%;bottom:9%;transform:translateX(-50%) translateY(-34px) scale(1.26)} 85%,100%{left:50%;bottom:9%;transform:translateX(-50%) scale(1)} }
        @keyframes atkDemoFingerMove { 0%,13%{left:50%;bottom:4%;opacity:.85;transform:translate(-50%,0) scale(1)} 17%,29%{left:30%;bottom:6%;opacity:1;transform:translate(-50%,0) scale(1)} 32%,34%{left:50%;bottom:4%;opacity:.9;transform:translate(-50%,0) scale(1)} 36%,48%{left:70%;bottom:6%;opacity:1;transform:translate(-50%,0) scale(1)} 51%,53%{left:50%;bottom:5%;opacity:.95;transform:translate(-50%,0) scale(1)} 54%,60%{left:50%;bottom:10%;opacity:1;transform:translate(-50%,0) scale(1.26)} 63%,70%{left:50%;bottom:10%;opacity:1;transform:translate(-50%,0) scale(1)} 72%,78%{left:50%;bottom:10%;opacity:1;transform:translate(-50%,0) scale(1.26)} 81%,100%{left:50%;bottom:4%;opacity:.7;transform:translate(-50%,0) scale(1)} }
        @keyframes atkDemoTap { 0%,100%{opacity:1;transform:scale(1)} }
        @keyframes atkDemoTapHalo { 0%,5%{opacity:0;transform:scale(.25)} 8%{opacity:.95;transform:scale(.7)} 18%{opacity:0;transform:scale(2.2)} 100%{opacity:0;transform:scale(2.2)} }
        @keyframes atkDemoTapWave { 0%,6%{opacity:0;transform:scale(.25)} 10%{opacity:.78;transform:scale(.9)} 22%{opacity:0;transform:scale(2.8)} 100%{opacity:0;transform:scale(2.8)} }
        @keyframes atkDemoPlayerHaloJump { 0%,52%{opacity:0;transform:scale(.45)} 55%{opacity:.9;transform:scale(.82)} 64%{opacity:.7;transform:scale(1.58)} 68%{opacity:0;transform:scale(1.85)} 70%{opacity:0;transform:scale(.45)} 73%{opacity:.9;transform:scale(.82)} 82%{opacity:.7;transform:scale(1.58)} 86%,100%{opacity:0;transform:scale(1.85)} }
        @keyframes atkDemoWideGate { from{transform:scaleX(.58)} to{transform:scaleX(1.18)} }
        @keyframes atkDemoFireBall { from{transform:scale(.96) rotate(-6deg)} to{transform:scale(1.08) rotate(8deg)} }
        @keyframes atkDemoFireFlame { from{transform:scale(.86) translateY(2px);opacity:.72} to{transform:scale(1.16) translateY(-2px);opacity:1} }
        @keyframes atkDemoWideArrows { from{transform:scaleX(.76);opacity:.72} to{transform:scaleX(1.18);opacity:1} }
        @keyframes atkDemoBlastDef { 0%{opacity:1;transform:translateY(0) scale(1)} 42%{opacity:1;transform:translateY(0) scale(1)} 100%{opacity:0;transform:translateY(-7px) scale(1.75)} }
        @keyframes atkDemoTapHint { 0%,4%{opacity:0;transform:translateY(5px) scale(.9)} 8%,20%{opacity:1;transform:translateY(0) scale(1)} 30%,100%{opacity:0;transform:translateY(-5px) scale(1.04)} }
        
        @keyframes atkDemoArc { 0%,10%{opacity:0;transform:translateY(8px) scale(.8)} 18%,38%{opacity:1;transform:translateY(0) scale(1)} 54%,100%{opacity:0;transform:translateY(-8px) scale(1.05)} }
        @keyframes atkDemoRoulette { 0%,10%{opacity:0;transform:translateX(-50%) scale(.4) rotateY(0)} 18%,42%{opacity:1;transform:translateX(-50%) scale(1) rotateY(300deg)} 58%,100%{opacity:0;transform:translateX(-50%) scale(1.25) rotateY(720deg)} }
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
        .atk-life-badge { margin-top:5px;display:flex;gap:4px;width:max-content;padding:4px 7px;border-radius:999px;background:rgba(5,16,21,.5);border:1px solid rgba(255,255,255,.14); }
        .atk-life-badge i { width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.2);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18); }
        .atk-life-badge i.is-on { background:#FF4455;box-shadow:0 0 10px rgba(255,68,85,.72); }
        .atk-perfect-badge { margin-top:7px; width:max-content; padding:4px 8px; border-radius:999px; color:#03131d; background:linear-gradient(90deg,#bdfcff,#2bff9a); font:900 9px 'Barlow Condensed',sans-serif; letter-spacing:.12em; box-shadow:0 0 14px rgba(43,255,154,.38); }
        .atk-perfect-badge.is-fever { background:linear-gradient(90deg,#ffdf73,#ff5f7c); box-shadow:0 0 20px rgba(255,184,0,.54); animation:atkFeverPulse .36s ease-in-out infinite alternate; }
        .atk-bonus-flash { position:absolute; inset:0; z-index:23; pointer-events:none; background:radial-gradient(circle at 50% 72%, rgba(255,184,0,.34), transparent 42%); animation:atkBonusFlash .42s ease-out both; }
        .atk-bonus-field-fx { position:absolute; inset:0; z-index:4; pointer-events:none; mix-blend-mode:screen; opacity:.9; animation:atkBonusFieldFade .9s ease-out both; }
        .atk-bonus-field-fx.is-coin { background:radial-gradient(circle at 50% 70%,rgba(255,216,74,.34),transparent 30%),radial-gradient(circle at 50% 70%,rgba(255,184,0,.18),transparent 55%); }
        .atk-bonus-field-fx.is-boots { background:radial-gradient(circle at 50% 62%,rgba(125,211,252,.34),transparent 28%),radial-gradient(circle at 50% 62%,transparent 30%,rgba(125,211,252,.24) 31%,transparent 48%); animation:atkWhistleField .72s ease-out infinite; }
        .atk-bonus-field-fx.is-whistle { background:radial-gradient(circle at 50% 62%,rgba(43,255,154,.34),transparent 24%),radial-gradient(circle at 50% 62%,transparent 28%,rgba(43,255,154,.22) 29%,transparent 45%); animation:atkWhistleField .72s ease-out infinite; }
        .atk-bonus-field-fx.is-slowmo { background:linear-gradient(180deg,rgba(168,85,247,.18),transparent 44%,rgba(168,85,247,.16)); backdrop-filter:saturate(.8); animation:atkSlowmoField .9s ease-in-out infinite alternate; }
        .atk-bonus-field-fx.is-wide { background:radial-gradient(ellipse at 50% 52%,rgba(184,255,106,.26),transparent 42%),linear-gradient(90deg,rgba(184,255,106,.14),transparent 28%,transparent 72%,rgba(184,255,106,.14)); animation:atkWideField .62s ease-in-out infinite alternate; }
        .atk-bonus-field-fx.is-blast { background:radial-gradient(circle at 50% 62%,rgba(255,184,0,.36),transparent 24%),radial-gradient(circle at 50% 62%,rgba(255,68,85,.26),transparent 48%); animation:atkBlastField .38s ease-out infinite alternate; }
        .atk-gd.is-bonus-boots .atk-gd-player .atk-player-inner { filter:drop-shadow(0 0 24px rgba(125,211,252,.92)); }
        .atk-gd.is-bonus-slowmo .atk-slalom-wave { filter:hue-rotate(18deg) saturate(.82); }
        .atk-gd.is-bonus-whistle .atk-slalom-defender { filter:drop-shadow(0 0 16px rgba(43,255,154,.72)) grayscale(.2); }
        @keyframes atkBonusFieldFade { from{opacity:1} to{opacity:.35} }
        @keyframes atkTurboField { from{background-position:0 0,0 0} to{background-position:46px 0,0 -18px} }
        @keyframes atkWhistleField { from{transform:scale(.92);opacity:.95} to{transform:scale(1.1);opacity:.45} }
        @keyframes atkSlowmoField { from{opacity:.34;filter:blur(0)} to{opacity:.72;filter:blur(1.5px)} }
        @keyframes atkWideField { from{transform:scaleX(.96);opacity:.52} to{transform:scaleX(1.06);opacity:.94} }
        @keyframes atkBlastField { from{transform:scale(.96);filter:brightness(1)} to{transform:scale(1.04);filter:brightness(1.35)} }
        @keyframes atkTurboPlayer { from{transform:scale(1.04) skewX(-4deg)} to{transform:scale(1.14) skewX(5deg)} }

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
        .atk-player-inner { position:relative;width:100%;height:100%;transform-origin:50% 70%;transition:transform .12s ease-out,filter .12s ease-out;filter:drop-shadow(0 0 14px rgba(43,255,154,.52));transform-style:preserve-3d; }
        .atk-gd-player .atk-kawaii { width:58px;height:70px; }
        .atk-player-shadow { position:absolute;left:50%;bottom:2px;width:42px;height:14px;border-radius:999px;background:rgba(0,0,0,.38);transform:translateX(-50%);transition:transform .12s ease-out,opacity .12s ease-out;z-index:-1; }
        .atk-gd-player--flash .atk-player-inner { filter: drop-shadow(0 0 14px rgba(255,68,85,1)); }
        .atk-gd-player--pass .atk-player-inner { transform:scale(1.28);filter:drop-shadow(0 0 18px rgba(43,255,154,.65)); }
        .atk-gd-player--pass .atk-player-shadow { transform:translateX(-50%) scale(1.55);opacity:.18; }
        .atk-gd-player.is-dashing .atk-player-inner { transform:scale(1.18) skewX(-8deg); filter:drop-shadow(0 0 20px rgba(25,211,255,.82)); }
        .atk-gd-player.is-dashing::before { content:''; position:absolute; right:38px; top:22px; width:58px; height:18px; border-radius:999px; background:linear-gradient(90deg, transparent, rgba(25,211,255,.55)); transform:scaleX(calc(var(--atk-dash-dir, 1))); opacity:.86; animation:atkDashTrail .2s ease-out both; }
        .atk-gd-player.is-ghost .atk-player-inner { opacity:.48;filter:drop-shadow(0 0 24px rgba(189,252,255,.95));animation:atkGhostBlink .18s linear infinite alternate; }
        .atk-gd-player.is-bonus-aura::before { content:''; position:absolute; left:50%; top:44%; width:104px; height:124px; border-radius:999px; transform:translate(-50%,-50%); z-index:-1; pointer-events:none; background:radial-gradient(ellipse, rgba(255,216,74,.42), rgba(255,184,0,.2) 42%, transparent 72%); box-shadow:0 0 34px rgba(255,184,0,.74), inset 0 0 32px rgba(255,255,255,.22); animation:atkBonusAura .58s ease-in-out infinite alternate; }
        .atk-gd-player.is-bonus-aura .atk-player-inner { filter:drop-shadow(0 0 22px rgba(255,216,74,.95)) drop-shadow(0 0 14px rgba(255,184,0,.72)); }
        .atk-gd-player.is-roulette .atk-player-inner { animation:atkRouletteSpin .82s cubic-bezier(.16,.92,.22,1) both;filter:drop-shadow(0 0 30px rgba(255,184,0,.95)) drop-shadow(0 0 18px rgba(43,255,154,.72)); }
        .atk-player-whoosh { position:absolute;left:50%;top:46%;width:62px;height:62px;border-radius:50%;border:2px solid rgba(43,255,154,.34);transform:translate(-50%,-50%) scale(.7);opacity:0;pointer-events:none; }
        .atk-gd-player--pass .atk-player-whoosh { animation:atkJumpWhoosh .34s ease-out both; }
        .atk-gd-player.is-roulette .atk-player-whoosh { width:128px;height:128px;border-color:rgba(255,184,0,.72);box-shadow:0 0 26px rgba(255,184,0,.42), inset 0 0 24px rgba(43,255,154,.18);animation:atkRouletteRing .82s ease-out both; }
        .atk-gd-player.is-roulette::after { content:'ROULETTE'; position:absolute; left:50%; top:-26px; transform:translateX(-50%); color:#FFB800; font:900 12px 'Barlow Condensed',sans-serif; letter-spacing:.14em; white-space:nowrap; text-shadow:0 0 14px rgba(255,184,0,.9); animation:atkPowerupPop .2s ease-out both; }
        .atk-gd-player.is-flowing .atk-player-inner { filter:drop-shadow(0 0 18px rgba(43,255,154,.82)); }
        .atk-gd-player.is-max-flow .atk-player-inner { filter:drop-shadow(0 0 22px rgba(255,184,0,.9)) drop-shadow(0 0 16px rgba(43,255,154,.62)); }
        .atk-gd-player.is-max-flow::after { content:'TIR BOOSTE'; position:absolute; left:50%; top:-22px; transform:translateX(-50%); color:#ffdd73; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.1em; white-space:nowrap; text-shadow:0 0 12px rgba(255,184,0,.8); }
        @keyframes atkBonusAura { from{ opacity:.62; transform:translate(-50%,-50%) scale(.92); filter:blur(.2px); } to{ opacity:1; transform:translate(-50%,-50%) scale(1.08); filter:blur(1px); } }
        @keyframes atkWideGatePulse { from{ transform:translate(-50%,-50%) scaleX(.92); filter:brightness(1); } to{ transform:translate(-50%,-50%) scaleX(1.08); filter:brightness(1.16); } }
        @keyframes atkWideGateBar { from{ transform:translate(-50%,-50%) scaleX(.76); } to{ transform:translate(-50%,-50%) scaleX(1.18); } }
        .atk-gd-player.is-fever .atk-player-inner { filter:drop-shadow(0 0 26px rgba(255,184,0,.9)) drop-shadow(0 0 20px rgba(25,211,255,.62)); animation:atkFeverPlayer .32s ease-in-out infinite alternate; }
        .atk-gd-player.is-roulette { z-index:18; }
        .atk-gd-player.is-roulette .atk-player-inner,
        .atk-gd-player.is-roulette.is-fever .atk-player-inner { animation:atkRouletteSpin .82s cubic-bezier(.16,.92,.22,1) both;filter:drop-shadow(0 0 32px rgba(255,184,0,1)) drop-shadow(0 0 20px rgba(43,255,154,.78)); }
        .atk-gd-player.is-roulette .atk-player-whoosh { opacity:1; }
        .atk-gd-player.atk-gd-player--pass .atk-player-inner,
        .atk-gd-player.atk-gd-player--pass.is-fever .atk-player-inner,
        .atk-gd-player.atk-gd-player--pass.is-max-flow .atk-player-inner {
          transform:translateY(-16px) scale(1.34);
          filter:drop-shadow(0 0 26px rgba(43,255,154,.92)) drop-shadow(0 18px 16px rgba(0,0,0,.24));
        }
        .atk-gd-player.atk-gd-player--pass .atk-player-shadow {
          transform:translateX(-50%) scale(1.7);
          opacity:.14;
        }
        .atk-control-ghost { position:absolute; left:50%; bottom:max(28px,calc(env(safe-area-inset-bottom) + 18px)); z-index:18; display:grid; justify-items:center; gap:8px; width:148px; transform:translateX(-50%); pointer-events:none; opacity:.44; filter:drop-shadow(0 0 16px rgba(43,255,154,.28)); }
        .atk-control-ghost__player { width:44px; height:54px; border-radius:999px 999px 18px 18px; background:linear-gradient(180deg,rgba(43,255,154,.38),rgba(43,255,154,.12)); border:1px solid rgba(43,255,154,.42); box-shadow:inset 0 0 18px rgba(255,255,255,.12); animation:atkGhostPlayer 1.75s ease-in-out infinite; }
        .atk-control-ghost__trail { position:relative; width:132px; height:7px; border-radius:999px; background:linear-gradient(90deg,transparent,rgba(43,255,154,.72),transparent); }
        .atk-control-ghost__trail::after { content:''; position:absolute; left:50%; top:50%; width:18px; height:18px; border-radius:50%; transform:translate(-50%,-50%); background:rgba(255,255,255,.82); box-shadow:0 0 14px rgba(43,255,154,.72); animation:atkGhostFinger 1.75s ease-in-out infinite; }

        .atk-slalom-wave.is-moving { animation: atkWaveDrift var(--atk-wave-duration,1.4s) ease-in-out var(--atk-wave-delay,0s) infinite alternate; }
        .atk-root.is-super-attacker .atk-gd { filter:saturate(1.22) contrast(1.06); background:radial-gradient(circle at 50% 74%,rgba(255,184,0,.24),transparent 28%),linear-gradient(180deg,#020306,#06110c 55%,#0c1510); }
        .atk-root.is-super-attacker .atk-gd::after { content:'SUPER ATTAQUANT'; position:absolute; left:50%; top:18%; transform:translateX(-50%); z-index:26; color:#FFB800; font:900 22px 'Barlow Condensed',sans-serif; letter-spacing:.2em; text-shadow:0 0 28px rgba(255,184,0,.9); pointer-events:none; animation:atkSuperFocus .34s ease-in-out infinite alternate; }
        .atk-root.is-super-attacker .atk-gd-player::before { content:''; position:absolute; left:50%; top:44%; width:128px; height:150px; border-radius:999px; transform:translate(-50%,-50%); z-index:-1; pointer-events:none; background:radial-gradient(ellipse,rgba(255,216,74,.56),rgba(255,68,85,.2) 48%,transparent 72%); box-shadow:0 0 52px rgba(255,184,0,.92), inset 0 0 34px rgba(255,255,255,.24); animation:atkBonusAura .34s ease-in-out infinite alternate; }
        .atk-root.is-super-attacker .atk-player-inner { filter:drop-shadow(0 0 30px rgba(255,216,74,1)) drop-shadow(0 0 22px rgba(255,68,85,.74)); }
        .atk-slalom-wave.is-super-blasted .atk-slalom-gate,
        .atk-slalom-wave.is-super-blasted .atk-slide-wall { animation:atkSuperGateBlast .54s cubic-bezier(.12,.78,.22,1) both; }
        .atk-slalom-wave.is-super-blasted .atk-slalom-defender { animation:atkSuperDefenderBlast .58s cubic-bezier(.14,.84,.22,1) both; filter:drop-shadow(0 0 26px rgba(255,184,0,.95)); }
        .atk-slalom-wave.is-super-blasted::after { content:'BOOM'; position:absolute; left:50%; top:-24px; transform:translateX(-50%); z-index:18; color:#fff; font:900 24px 'Barlow Condensed',sans-serif; letter-spacing:.18em; text-shadow:0 0 28px rgba(255,184,0,1); animation:atkSuperBoom .55s ease-out both; }
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
        .atk-slalom-gate.is-wide-power { border-color:#b8ff6a; background:radial-gradient(ellipse at center,rgba(184,255,106,.24),rgba(43,255,154,.08) 74%,transparent); box-shadow:0 0 34px rgba(184,255,106,.52), inset 0 0 24px rgba(43,255,154,.24); animation:atkWideGatePulse .62s ease-in-out infinite alternate; }
        .atk-slalom-gate.is-wide-power::before { width:62%; background:#b8ff6a; box-shadow:0 0 20px rgba(184,255,106,.95); animation:atkWideGateBar .62s ease-in-out infinite alternate; }
        .atk-slalom-gate.is-bonus { border-color:#FFB800; color:#2b1800; background:radial-gradient(ellipse at center,rgba(255,184,0,.28),rgba(255,184,0,.08) 72%,transparent 100%); box-shadow:0 0 30px rgba(255,184,0,.48), inset 0 0 18px rgba(255,255,255,.18); }
        .atk-slalom-gate.is-bonus::before { background:#FFB800; box-shadow:0 0 16px rgba(255,184,0,.9); }
        .atk-slalom-gate.is-bonus .atk-slalom-gate__label { color:#fff2bf; text-shadow:0 0 12px rgba(255,184,0,.95); }
        .atk-bonus-orb { position:absolute; left:50%; top:-26px; transform:translateX(-50%); min-width:44px; height:44px; padding:0 7px; border-radius:999px; display:grid; place-items:center; background:linear-gradient(180deg,#fff9c7,#ffb800); color:#1e1300; font:900 11px 'Barlow Condensed',sans-serif; letter-spacing:.06em; border:3px solid rgba(255,255,255,.88); box-shadow:0 0 0 8px rgba(255,184,0,.14),0 0 34px rgba(255,184,0,.9),0 0 72px rgba(255,184,0,.44); animation:atkBonusOrb 0.46s ease-in-out infinite alternate; }
        .atk-bonus-orb::before { content:''; position:absolute; inset:-15px; border-radius:inherit; border:2px solid rgba(255,216,74,.72); box-shadow:0 0 34px rgba(255,184,0,.76), inset 0 0 24px rgba(255,255,255,.2); animation:atkBonusHalo .72s ease-out infinite; }
        .atk-bonus-orb svg { position:relative; z-index:1; width:34px; height:34px; display:block; overflow:visible; }
        .atk-bonus-orb.is-coin { box-shadow:0 0 22px rgba(255,216,74,.72),0 0 54px rgba(255,68,85,.34); }
        .atk-bonus-orb.is-boots { background:linear-gradient(180deg,#dff7ff,#7dd3fc); color:#031525; box-shadow:0 0 20px rgba(125,211,252,.72); }
        .atk-bonus-orb.is-whistle { background:linear-gradient(180deg,#d8ffba,#2bff9a); color:#03160c; box-shadow:0 0 20px rgba(43,255,154,.72); }
        .atk-bonus-orb.is-slowmo { background:linear-gradient(180deg,#e7d5ff,#a855f7); color:#17051f; box-shadow:0 0 20px rgba(168,85,247,.72); }
        .atk-bonus-orb.is-wide { background:linear-gradient(180deg,#d8ffba,#b8ff6a); color:#132100; box-shadow:0 0 20px rgba(184,255,106,.72); }
        .atk-bonus-orb.is-blast { background:linear-gradient(180deg,#fff4a8,#FF4455); color:#210305; box-shadow:0 0 24px rgba(255,68,85,.72); }
        .atk-bonus-choice-label { position:absolute; left:50%; top:42px; transform:translateX(-50%); color:#ffdf73; font:900 11px 'Barlow Condensed',sans-serif; letter-spacing:.14em; text-shadow:0 0 14px rgba(255,184,0,.95); white-space:nowrap; }
        .atk-slalom-gate__label { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:1; font:900 10px 'Barlow Condensed',sans-serif; letter-spacing:.16em; color:#dfffee; text-shadow:0 0 10px rgba(43,255,154,.8); }
        .atk-slide-wall { position:absolute;left:0;right:0;height:74px;top:0;transform:translateY(-50%);pointer-events:none;z-index:4; }
        .atk-slide-danger { position:absolute;left:4%;right:4%;top:50%;height:34px;transform:translateY(-50%);border-radius:999px;background:rgba(255,184,0,.14);border:1px solid rgba(255,184,0,.55);box-shadow:0 0 18px rgba(255,184,0,.28);animation:slideDangerPulse .45s ease-in-out infinite alternate; }
        .atk-slide-wall.is-failed .atk-slide-danger { background:rgba(255,68,85,.18);border-color:rgba(255,68,85,.7);box-shadow:0 0 24px rgba(255,68,85,.42); }
        .atk-slide-wall.is-roulette .atk-slide-danger { height:46px;background:repeating-linear-gradient(90deg,rgba(255,184,0,.22) 0 18px,rgba(255,68,85,.18) 18px 36px);border-color:rgba(255,184,0,.78);box-shadow:0 0 28px rgba(255,184,0,.36); }
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
        ${KAWAII_SPRITE_CSS}
        .atk-gd-player .kw-sprite { --kw-step: .26s; }
        .atk-shooter-select__avatar .kw-sprite { --kw-step: .5s; }
        .atk-kawaii--defender .atk-kawaii__leg--l { animation: atkLegL .34s ease-in-out infinite alternate; transform-origin:31px 60px; }
        .atk-kawaii--defender .atk-kawaii__leg--r { animation: atkLegR .34s ease-in-out infinite alternate; transform-origin:48px 60px; }
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
        @keyframes atkGhostBlink { from{ opacity:.36; } to{ opacity:.72; } }
        @keyframes atkRouletteSpin { 0%{ transform:perspective(420px) rotateY(0deg) scale(1); } 20%{ transform:perspective(420px) rotateY(82deg) scale(1.12); } 44%{ transform:perspective(420px) rotateY(180deg) scale(1.2); filter:brightness(.55) drop-shadow(0 0 30px rgba(255,184,0,.95)); } 68%{ transform:perspective(420px) rotateY(278deg) scale(1.12); } 100%{ transform:perspective(420px) rotateY(360deg) scale(1); } }
        @keyframes atkRouletteRing { 0%{ opacity:0;transform:translate(-50%,-50%) scale(.35) rotate(0deg); } 22%{ opacity:.95; } 100%{ opacity:0;transform:translate(-50%,-50%) scale(1.45) rotate(420deg); } }
        @keyframes atkBonusOrb { from{ transform:translateX(-50%) translateY(0) scale(.95); } to{ transform:translateX(-50%) translateY(-4px) scale(1.08); } }
        @keyframes atkBonusHalo { from{ opacity:.95; transform:scale(.82); } to{ opacity:0; transform:scale(1.38); } }
        @keyframes atkSuperFocus { from{ opacity:.72; scale:.98; } to{ opacity:1; scale:1.04; } }
        @keyframes atkSuperGateBlast { 0%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0)} 42%{opacity:1;filter:brightness(1.8)} 100%{opacity:0;transform:translate(-50%,-120%) scale(1.65) rotate(-12deg);filter:blur(2px)} }
        @keyframes atkSuperDefenderBlast { 0%{opacity:1;transform:translate(-50%,-50%) scale(1)} 100%{opacity:0;transform:translate(calc(-50% + var(--atk-defender-patrol,0%) + 26px),-142%) scale(.76) rotate(24deg)} }
        @keyframes atkSuperBoom { 0%{opacity:0;scale:.62} 18%{opacity:1;scale:1.2} 100%{opacity:0;translate:0 -32px;scale:1.42} }
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
        .atk-controls__phase.is-roulette { color:#FFB800; text-shadow:0 0 12px rgba(255,184,0,.45); }
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
        .atk-shot-game.is-boosted { background:radial-gradient(circle at 50% 64%,rgba(255,184,0,.18),transparent 32%),linear-gradient(180deg,#06172a,#082d1e 62%,#0a1419); }
        .atk-shot-game.is-boosted::after { content:'TIR BOOSTE'; position:absolute; left:50%; top:max(72px,calc(env(safe-area-inset-top) + 54px)); transform:translateX(-50%); z-index:12; color:#ffdf73; font:900 13px 'Barlow Condensed',sans-serif; letter-spacing:.18em; text-shadow:0 0 18px rgba(255,184,0,.9); pointer-events:none; animation:atkPowerupPop .42s ease-out both, atkFeverPulse .46s ease-in-out .42s infinite alternate; }
        .atk-shot-game.is-boosted .atk-gauge-green { background:linear-gradient(90deg,#2bff9a,#ffdf73); box-shadow:0 0 22px rgba(255,184,0,.85),0 0 12px rgba(43,255,154,.72); }
        .atk-shot-game.is-boosted .atk-shot-shooter .atk-kawaii { filter:drop-shadow(0 0 22px rgba(255,184,0,.86)) drop-shadow(0 0 12px rgba(43,255,154,.6)); }
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
        .atk-shot-game.is-sudden-shot .atk-shot-title {
          top: max(82px, calc(env(safe-area-inset-top) + 74px));
        }

        .atk-shot-shooter {
          position: absolute;
          left: 50%;
          top: 66%;
          bottom: auto;
          transform: translate(-50%, -50%);
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
          animation: atkShotKick .5s cubic-bezier(.2,1.1,.3,1) both;
        }
        .atk-shot-shooter.is-kicking .atk-kawaii .kw-leg--r {
          animation: atkShotKickLeg .5s cubic-bezier(.2,1.1,.3,1) both;
        }
        @keyframes atkShotShooterIn {
          from { transform: translate(calc(-50% - 10px), calc(-50% + 18px)) scale(.86); opacity: 0; }
          to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @keyframes atkShotKick {
          0% { transform: translateY(0) rotate(0deg) scale(1); }
          22% { transform: translate(-6px, 2px) rotate(6deg) scale(.96, 1.04); }
          52% { transform: translate(12px, -8px) rotate(-9deg) scale(1.12, .98); }
          74% { transform: translate(18px, 1px) rotate(2deg) scale(1.02); }
          100% { transform: translate(16px, 3px) rotate(4deg) scale(.98); }
        }
        @keyframes atkShotKickLeg {
          0% { transform: rotate(0deg); }
          24% { transform: rotate(38deg); }
          56% { transform: rotate(-52deg); }
          100% { transform: rotate(-10deg); }
        }

        /*  Gauge above the goal in shot scene  */
        .atk-gauge-bottom {
          position: absolute; top: max(58px, calc(env(safe-area-inset-top) + 50px)); left: 0; right: 0; z-index: 20;
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 0 20px;
          pointer-events: none;
        }
        .atk-shot-game.is-sudden-shot .atk-gauge-bottom {
          top: max(118px, calc(env(safe-area-inset-top) + 108px));
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
          position: absolute; top: 73%; left: 50%; transform: translate(-50%, -50%);
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
          top: 66%;
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
          width:min(86vw,340px); color: rgba(255,255,255,.86);
          font: 800 clamp(13px,4vw,17px) 'Barlow Condensed', sans-serif;
          line-height: 1.3; display:grid; gap:7px;
        }
        .atk-shot-step { opacity:.38; transform:translateY(3px) scale(.98); transition:none; }
        .atk-shot-step b { color:#2bff9a; }
        .atk-shot-step--hold { animation:atkShotStepHold 6.2s linear infinite; }
        .atk-shot-step--aim { animation:atkShotStepAim 6.2s linear infinite; }
        .atk-shot-step--release { animation:atkShotStepRelease 6.2s linear infinite; }
        .atk-shot-warning { margin-top:2px; color:#ffdd73; font:900 13px 'Barlow Condensed',sans-serif; letter-spacing:.1em; text-transform:uppercase; text-shadow:0 0 12px rgba(255,184,0,.48); animation:atkShotWarning 6.2s linear infinite; }
        @keyframes atkShotStepHold { 0%,24%{opacity:1;transform:translateY(0) scale(1);color:#fff} 32%,100%{opacity:.34;transform:translateY(3px) scale(.98)} }
        @keyframes atkShotStepAim { 0%,22%{opacity:.34;transform:translateY(3px) scale(.98)} 30%,50%{opacity:1;transform:translateY(0) scale(1);color:#fff} 58%,100%{opacity:.34;transform:translateY(3px) scale(.98)} }
        @keyframes atkShotStepRelease { 0%,70%{opacity:.34;transform:translateY(3px) scale(.98)} 78%,100%{opacity:1;transform:translateY(0) scale(1);color:#fff} }
        @keyframes atkShotWarning { 0%,26%{opacity:.42} 34%,100%{opacity:1} }
        .atk-shot-tutorial__comment { display:grid; grid-template-columns:54px minmax(0,1fr); align-items:center; gap:10px; width:min(86vw,340px); padding:8px 10px; border:1px solid rgba(255,184,0,.28); border-left:3px solid #FFB800; border-radius:14px; background:rgba(2,8,16,.58); color:#fff; font:800 13px 'Barlow Condensed',sans-serif; letter-spacing:.04em; text-align:left; }
        .atk-shot-tutorial__avatar { width:54px; height:58px; display:grid; place-items:center; overflow:visible; }
        .atk-shot-tutorial__avatar .atk-kawaii { width:52px; height:63px; filter:drop-shadow(0 8px 10px rgba(0,0,0,.42)); animation:battleOrbFloat .72s ease-in-out infinite alternate; }
        .atk-shot-demo { position:relative; width:min(90vw,360px); height:min(38vh,230px); min-height:214px; border-radius:18px; border:1px solid rgba(255,255,255,.14); overflow:hidden; background:linear-gradient(180deg,#082032,#092617 64%,#101827); box-shadow:0 18px 38px rgba(0,0,0,.34), inset 0 0 30px rgba(43,255,154,.06); }
        .atk-shot-demo__goal { position:absolute; left:12%; right:12%; top:22%; height:44%; border:3px solid rgba(255,255,255,.38); border-bottom:0; border-radius:18px 18px 0 0; background:repeating-linear-gradient(90deg,rgba(255,255,255,.08) 0 1px,transparent 1px 22px),repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 1px,transparent 1px 18px); }
        .atk-shot-demo__aim { position:absolute; inset:0; z-index:3; overflow:visible; opacity:0; transform-origin:190px 163px; animation:atkDemoAim 6.2s linear infinite; filter:drop-shadow(0 0 10px rgba(43,255,154,.65)); }
        .atk-shot-demo__curve { fill:none; stroke:#FFB800; stroke-width:5; stroke-linecap:round; stroke-dasharray:230; stroke-dashoffset:230; animation:atkDemoCurveGrow 6.2s linear infinite; filter:drop-shadow(0 0 8px rgba(255,184,0,.9)); }
        .atk-shot-demo__aim-group { opacity:1; }
        .atk-shot-demo__target { fill:rgba(43,255,154,.12); stroke:#2bff9a; stroke-width:4; opacity:0; animation:atkDemoTargetPop 6.2s linear infinite; }
        .atk-shot-demo__target-dot { fill:#2bff9a; opacity:0; animation:atkDemoTargetPop 6.2s linear infinite; filter:drop-shadow(0 0 8px rgba(43,255,154,.95)); }
        .atk-shot-demo__keeper { position:absolute; left:50%; bottom:-2px; width:48px; height:58px; transform:translateX(-50%); z-index:2; animation:atkDemoKeeper 1.05s ease-in-out infinite alternate; filter:drop-shadow(0 0 12px rgba(255,68,85,.55)); }
        .atk-shot-demo__keeper .atk-kawaii { width:48px; height:58px; }
        .atk-shot-demo__player { position:absolute; z-index:5; left:43%; bottom:9%; width:56px; height:68px; transform:translate(-50%,0); filter:drop-shadow(0 8px 14px rgba(0,0,0,.42)); }
        .atk-shot-demo__player .atk-kawaii { width:56px; height:68px; }
        .atk-shot-demo__ball { position:absolute; z-index:6; left:54%; bottom:15%; width:32px; height:32px; border-radius:50%; transform:translate(-50%,0); background:#f7f9fc; border:3px solid #101827; box-shadow:0 0 14px rgba(255,184,0,.7); animation:atkDemoBall 6.2s linear infinite; }
        .atk-shot-demo__ball:before { content:''; position:absolute; inset:6px; border:3px solid #101827; border-radius:50%; clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%); }
        .atk-shot-demo__hand { position:absolute; z-index:7; left:54%; bottom:6%; width:58px; height:64px; background:transparent; border:0; transform:translate(-50%,0) rotate(-10deg); filter:drop-shadow(0 0 12px rgba(43,255,154,.55)) drop-shadow(0 8px 10px rgba(0,0,0,.38)); animation:atkDemoHand 6.2s linear infinite; }
        .atk-shot-demo__hand:before { content:''; position:absolute; left:9px; top:18px; width:38px; height:36px; border-radius:18px 18px 15px 15px; background:linear-gradient(180deg,#fff,#e9fff6); border:3px solid #101827; box-shadow:inset 0 -10px 0 rgba(43,255,154,.16); }
        .atk-shot-demo__hand:after { content:''; position:absolute; left:5px; top:3px; width:11px; height:32px; border-radius:10px; background:#fff; border:3px solid #101827; box-shadow:12px -2px 0 -1px #fff,12px -2px 0 2px #101827,24px 0 0 -1px #fff,24px 0 0 2px #101827,35px 8px 0 -2px #fff,35px 8px 0 1px #101827; transform:rotate(-7deg); transform-origin:30px 42px; }
        .atk-shot-demo__gauge { position:absolute; left:12%; right:12%; top:9px; height:11px; border-radius:999px; background:rgba(255,255,255,.14); overflow:hidden; }
        .atk-shot-demo__green { position:absolute; left:42%; width:24%; inset-block:0; background:#2bff9a; box-shadow:0 0 14px rgba(43,255,154,.85); }
        .atk-shot-demo__gauge i { position:absolute; top:-4px; left:0; width:6px; height:19px; border-radius:999px; background:#fff; box-shadow:0 0 10px rgba(255,255,255,.9); animation:atkDemoGauge 6.2s linear infinite; }
        @keyframes atkDemoKeeper { 0%{left:24%;transform:translateX(-50%)} 100%{left:76%;transform:translateX(-50%)} }
        @keyframes atkDemoHand { 0%,8%{left:54%;bottom:13%;opacity:.25;transform:translate(-50%,0) rotate(-8deg) scale(.96)} 14%{left:54%;bottom:13%;opacity:.78;transform:translate(-50%,0) rotate(-8deg) scale(1)} 30%{left:70%;bottom:2%;opacity:.82;transform:translate(-50%,0) rotate(10deg) scale(1)} 48%,82%{left:37%;bottom:3%;opacity:.82;transform:translate(-50%,0) rotate(-20deg) scale(1)} 88%,100%{left:37%;bottom:3%;opacity:0;transform:translate(-50%,0) rotate(-20deg) scale(.96)} }
        @keyframes atkDemoBall { 0%,86%{left:54%;bottom:15%;opacity:1;scale:1} 94%{left:83%;bottom:60%;opacity:1;scale:.72} 100%{left:83%;bottom:66%;opacity:1;scale:.55} }
        @keyframes atkDemoAim { 0%,8%{opacity:.22;transform:scale(1)} 16%,100%{opacity:1;transform:scale(1)} }
        @keyframes atkDemoCurveGrow { 0%,12%{stroke-dashoffset:230;opacity:.25} 30%,100%{stroke-dashoffset:0;opacity:1} }
        @keyframes atkDemoTargetPop { 0%,8%{opacity:.2;transform:scale(.68)} 16%,100%{opacity:1;transform:scale(1)} }
        @keyframes atkDemoGauge { 0%{left:0} 10%{left:100%} 20%{left:0} 30%{left:100%} 40%{left:0} 50%{left:100%} 60%{left:0} 70%{left:100%} 78%{left:0} 84%,100%{left:50%} }
        .atk-shot-tutorial__btn {
          margin-top: 4px; min-height: 50px; padding: 0 30px; border-radius: 14px;
          border: 0; background: linear-gradient(90deg,#2bff9a,#1cd6c4 55%,#16a8ff);
          color: #031209; font: 900 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .14em; text-transform: uppercase; cursor: pointer;
          box-shadow: 0 10px 26px rgba(43,255,154,.28), inset 0 1px 0 rgba(255,255,255,.35);
          transition: transform .12s ease;
        }
        .atk-shot-tutorial__btn:active { transform: scale(.97); }

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
      {showDribbleTutorial && !tutorialDone && preCountdownNum === null && (
        <div className="atk-tutorial">
          <div className="atk-tutorial__title">TUTORIEL ATTAQUE</div>
          <div className="atk-tutorial__comment">
            <div className="atk-tutorial__avatar">
              <KawaiiFootballer label={String(selectedShooter.number ?? 9)} jerseyColor={playerJerseyColor} accentColor={playerAccentColor} shortsColor={playerShortsColor} textColor={playerTextColor} withBall isPlayer motion="ready" />
            </div>
            <span><b>Tutoriel.</b> Glisse entre les portes, saute les rangées et ramasse les pouvoirs avant le tir.</span>
          </div>
          {showDribbleDemo ? (
          <div className="atk-dribble-demo" aria-hidden="true">
            <div className="atk-dribble-demo__row atk-dribble-demo__row--gate-a">
              <span className="atk-dribble-demo__lane" />
              <span className="atk-dribble-demo__def atk-dribble-demo__def--l"><KawaiiFootballer label="4" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
              <span className="atk-dribble-demo__def atk-dribble-demo__def--r"><KawaiiFootballer label="5" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
            </div>
            <div className="atk-dribble-demo__row atk-dribble-demo__row--gate-b">
              <span className="atk-dribble-demo__lane" />
              <span className="atk-dribble-demo__def atk-dribble-demo__def--l"><KawaiiFootballer label="3" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
              <span className="atk-dribble-demo__def atk-dribble-demo__def--r"><KawaiiFootballer label="6" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
            </div>
            <div className="atk-dribble-demo__row atk-dribble-demo__row--jump">
              <span className="atk-dribble-demo__wall" />
              <span className="atk-dribble-demo__def atk-dribble-demo__def--l"><KawaiiFootballer label="2" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
              <span className="atk-dribble-demo__def atk-dribble-demo__def--m"><KawaiiFootballer label="6" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
              <span className="atk-dribble-demo__def atk-dribble-demo__def--r"><KawaiiFootballer label="3" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
            </div>
            <div className="atk-dribble-demo__row atk-dribble-demo__row--jump-b">
              <span className="atk-dribble-demo__wall" />
              <span className="atk-dribble-demo__def atk-dribble-demo__def--l"><KawaiiFootballer label="8" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
              <span className="atk-dribble-demo__def atk-dribble-demo__def--m"><KawaiiFootballer label="4" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
              <span className="atk-dribble-demo__def atk-dribble-demo__def--r"><KawaiiFootballer label="5" jerseyColor={opponentJerseyColor} accentColor={opponentAccentColor} shortsColor={opponentShortsColor} textColor={opponentTextColor} /></span>
            </div>
            <span className="atk-dribble-demo__player">
              <KawaiiFootballer label={String(selectedShooter.number ?? 9)} jerseyColor={playerJerseyColor} accentColor={playerAccentColor} shortsColor={playerShortsColor} textColor={playerTextColor} withBall isPlayer motion="run" />
            </span>
            <span className="atk-dribble-demo__finger"><svg viewBox="0 0 36 54"><path d="M15 4c3.2 0 5.7 2.5 5.7 5.7v13.1l1.4-1.2c2.2-1.8 5.4-1.4 7.1.9l1.4 1.9c1.1 1.5 1.5 3.3 1.2 5.1l-2.1 12.3c-.7 4.1-4.2 7.1-8.4 7.1h-8.2c-3.2 0-6.1-1.8-7.6-4.6L2.7 37c-1.1-2-.4-4.5 1.6-5.6 1.8-1 4-.6 5.3.9V9.7C9.6 6.5 12.1 4 15 4z" fill="#fff" stroke="#101827" strokeWidth="2.2" strokeLinejoin="round"/><path d="M15.1 8.2v21.4M20.8 22.8v8.1M25.4 25.1v7.7" stroke="rgba(16,24,39,.46)" strokeWidth="1.7" strokeLinecap="round"/></svg><span className="atk-dribble-demo__tap atk-dribble-demo__tap--jump"></span><span className="atk-dribble-demo__tap atk-dribble-demo__tap--jump2"></span><span className="atk-dribble-demo__tap-hint atk-dribble-demo__tap-hint--jump">TAPE</span><span className="atk-dribble-demo__tap-hint atk-dribble-demo__tap-hint--jump2">TAPE</span></span>
            <div className="atk-dribble-demo__caption"><span><b>Glisse</b> entre les portes vertes</span><span><b>Saute</b> au-dessus des rangées</span></div>
          </div>
          ) : (
            <button type="button" className="atk-tutorial-open" onClick={() => { sfx.click(); setShowDribbleDemo(true) }}>
              Voir tutoriel
            </button>
          )}
          <div className="atk-dribble-demo__bonus-tip"><span>Ramasse les pouvoirs : ils affichent leur effet</span><div className="atk-dribble-demo__bonus-icons"><span className="atk-dribble-demo__bonus-item"><span className="atk-dribble-demo__bonus-icon atk-dribble-demo__bonus-icon--boot" aria-hidden="true"><BonusPowerIcon kind="boots" /></span><small>Bouclier</small></span><span className="atk-dribble-demo__bonus-item"><span className="atk-dribble-demo__bonus-icon atk-dribble-demo__bonus-icon--wide" aria-hidden="true"><BonusPowerIcon kind="wide" /></span><small>Portes larges</small></span><span className="atk-dribble-demo__bonus-item"><span className="atk-dribble-demo__bonus-icon atk-dribble-demo__bonus-icon--shot" aria-label="Tir facile"><BonusPowerIcon kind="shot" /></span><small>Tir facile</small></span><span className="atk-dribble-demo__bonus-item"><span className="atk-dribble-demo__bonus-icon atk-dribble-demo__bonus-icon--blast" aria-hidden="true"><BonusPowerIcon kind="blast" /></span><small>Super attaquant</small></span></div></div>
          <button
            type="button"
            className="atk-tutorial__btn"
            onClick={startTutorialCountdown}
          >
            OK - Jouer
          </button>
        </div>
      )}

      {tutorialDone && preCountdownNum !== null ? (
        <div className="atk-pre-countdown">
          <div key={preCountdownNum} className={`atk-pre-countdown__num${preCountdownNum === 0 ? ' is-go' : ''}`}>
            {preCountdownNum === 0 ? 'GO !' : preCountdownNum}
          </div>
        </div>
      ) : null}

      {!shotOnly && showShotIntro ? (
        <div className="atk-transition" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
          <div className="atk-transition__title">BRAVO !</div>
          <div className="atk-transition__sub">Tu arrives dans la zone de tir</div>
          <button
            type="button"
            className="atk-transition__btn"
            onClick={(event) => {
              event.stopPropagation()
              handleStartShot()
            }}
          >
            Continuer
          </button>
        </div>
      ) : null}
      {/*  GD game area  */}
      {phase === 'gd' && (
      <div
        className="atk-game"
      >
        {/*  GD Phase  */}
        {phase === 'gd' && (
          <div className={`atk-gd${activeBonusFx ? ` is-bonus-${activeBonusFx}` : ''}`}>
            <div className="atk-gd-stripe-overlay" />
            {activeBonusFx ? <div className={`atk-bonus-field-fx is-${activeBonusFx}`} /> : null}
            {bonusFlash ? <div className="atk-bonus-flash" /> : null}
            <div className="atk-dribble-hud">
              <div>
                <div className="atk-dribble-title">DRIBBLE RUSH<small>Vague {gdCheckedRef.current + 1}/{cfg.waveCount} - {gdInstruction}</small></div>
                <div className={`atk-flow-bar${feverActive ? ' is-fever' : ''}`}><div className="atk-flow-bar__fill" style={{ width: `${flow}%` }} /></div>
                {perfectStreak > 0 ? <div className={`atk-perfect-badge${feverActive ? ' is-fever' : ''}`}>{feverActive ? 'FEVER' : 'PERFECT'} x{perfectStreak}</div> : null}
                {powerupLabel ? <div className="atk-powerup-label">{powerupLabel}</div> : null}
                {comboDisplay > 0 ? <div className={`atk-combo-badge${comboDisplay >= 5 || feverActive ? ' is-hot' : ''}`}>COMBO x{comboDisplay}</div> : null}
                <div className="atk-life-badge" aria-label={`${attackLives} vies`}>
                  {Array.from({ length: ATTACK_MAX_LIVES }, (_, index) => <i key={index} className={index < attackLives ? 'is-on' : ''} />)}
                </div>
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
              {visibleGdWalls.map((wave) => {
                const isWideGatePower = wideGateActive && isGatePassWave(wave) && !wave.hasBonus
                const visualGateWidth = isWideGatePower ? Math.min(78, wave.gateWidth + 12) : wave.gateWidth
                const gatePxWidth = `${visualGateWidth}%`
                const bonusGatePxWidth = wave.bonusGateWidth ? `${wave.bonusGateWidth}%` : '0%' 
                const isSlideWave = wave.type === 'slide_wall' || wave.type === 'double_slide_wall'
                const isComboWave = wave.type === 'combo_gate_slide'
                const isRouletteWave = wave.type === 'roulette_wall'
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
                  <div key={wave.id} className={`atk-slalom-wave is-${wave.type}${moveAmp ? ' is-moving' : ''}${wave.superBlasted ? ' is-super-blasted' : ''}`} style={waveMotionStyle}>
                    {isSlideWave || isComboWave || isRouletteWave ? (
                      <div className={`atk-slide-wall${wave.failed ? ' is-failed' : ''}${wave.passed ? ' is-passed' : ''}${isRouletteWave ? ' is-roulette' : ''}`}>
                        <div className="atk-slide-danger" />
                        <span className="atk-slide-label">{isRouletteWave ? 'ROULETTE OBLIGATOIRE !' : isComboWave ? 'PLACE-TOI + SAUTE !' : 'SAUTE !'}</span>
                      </div>
                    ) : null}
                    {!isSlideWave && !isRouletteWave ? (
                      <div className={`atk-slalom-gate${wave.passed ? ' is-passed' : ''}${wave.failed ? ' is-failed' : ''}${isComboWave ? ' is-combo' : ''}${wave.type === 'narrow_gate' ? ' is-narrow' : ''}${wave.type === 'moving_gate' ? ' is-moving' : ''}${isWideGatePower ? ' is-wide-power' : ''}`} style={{ left: `${wave.gateCenterX}%`, width: gatePxWidth }}>
                        <span className="atk-slalom-gate__label">PASSAGE</span>
                        {wave.passed && !wave.bonusCollected ? <span className="atk-pass-pop">PASSE !</span> : null}
                      </div>
                    ) : wave.passed ? <span className="atk-pass-pop atk-pass-pop--slide">SAUTE !</span> : null}
                    {wave.hasBonus && wave.bonusGateCenterX != null && wave.bonusGateWidth != null ? (
                      <div className={`atk-slalom-gate is-bonus${wave.bonusCollected ? ' is-passed' : ''}${wave.failed ? ' is-failed' : ''}`} style={{ left: `${wave.bonusGateCenterX}%`, width: bonusGatePxWidth }}>
                        <span className={`atk-bonus-orb is-${wave.bonusKind ?? 'coin'}`}> <BonusPowerIcon kind={wave.bonusKind ?? 'coin'} /> </span>
                        <span className="atk-slalom-gate__label">{bonusPowerText(wave.bonusKind ?? 'coin').short}</span>
                        <span className="atk-bonus-choice-label">{bonusPowerText(wave.bonusKind ?? 'coin').hint}</span>
                        {wave.bonusCollected ? <span className="atk-pass-pop">{bonusPowerText(wave.bonusKind ?? 'coin').short}</span> : null}
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
                ghostActive ? 'is-ghost' : '',
                bonusAuraActive ? 'is-bonus-aura' : '',
                rouletteActive ? 'is-roulette' : '',
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
            {!showControls && tutorialDone && countdownDone ? (
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
          className={`atk-shot-game${shotBoostReady ? ' is-boosted' : ''}${isSuddenDeathShot ? ' is-sudden-shot' : ''}`}
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
            originYFrac={SHOT_ORIGIN_Y_FRAC}
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
                motion="idle"
              />
              <span className="atk-shot-shooter__name">{playerLastName(selectedShooter.name)}</span>
            </div>
          ) : null}
          {shotTutorialDone && !shooterSelectionDone && !ballFlight && !resultLabel ? (
            <div
              className="atk-shooter-select"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerMove={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
            >
              <div className="atk-shooter-select__title">
                <span>Choisis ton tireur</span>
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
                  <div className="atk-shooter-select__meta">#{selectedShooter.number ?? 9} &middot; {selectedShooterIndex + 1}/{shooterOptions.length}</div>
                </div>
                <button type="button" className="atk-shooter-select__arrow" onClick={() => changeShooter(1)} aria-label="Tireur suivant">&gt;</button>
              </div>
              <button type="button" className="atk-shooter-select__btn" onClick={confirmShooter}>
                Tirer
              </button>
            </div>
          ) : null}
          {showShotTutorial && !shotTutorialDone && !ballFlight && !resultLabel ? (
            <div className="atk-shot-tutorial">
              <div className="atk-shot-tutorial__title">{shotTitle ?? 'PHASE DE TIR'}</div>
              <div className="atk-shot-tutorial__comment"><div className="atk-shot-tutorial__avatar"><KawaiiFootballer label={String(selectedShooter.number ?? 9)} jerseyColor={playerJerseyColor} accentColor={playerAccentColor} shortsColor={playerShortsColor} textColor={playerTextColor} withBall isPlayer /></div><span>{shotTutorialComment}</span></div>
              {showShotDemo ? (
              <div className="atk-shot-demo" aria-hidden="true">
                <div className="atk-shot-demo__goal"><div className="atk-shot-demo__keeper"><KawaiiFootballer label="GK" jerseyColor="#FF4455" accentColor="#FFB800" shortsColor="#2b0508" textColor="#ffffff" motion="ready" /></div></div>
                <svg className="atk-shot-demo__aim" viewBox="0 0 350 220" aria-hidden="true">
                  <g className="atk-shot-demo__aim-group">
                    <path className="atk-shot-demo__curve" d="M190 163 C166 137 144 95 112 67">
                      <animate attributeName="d" dur="6.2s" repeatCount="indefinite" keyTimes="0;0.12;0.30;0.48;0.86;1" values="M190 163 C190 159 190 154 190 149;M190 163 C190 159 190 154 190 149;M190 163 C168 137 145 95 112 67;M190 163 C207 134 243 94 292 73;M190 163 C207 134 243 94 292 73;M190 163 C207 134 243 94 292 73" />
                    </path>
                    <circle className="atk-shot-demo__target" cx="112" cy="67" r="17">
                      <animate attributeName="cx" dur="6.2s" repeatCount="indefinite" keyTimes="0;0.12;0.30;0.48;0.86;1" values="190;190;112;292;292;292" />
                      <animate attributeName="cy" dur="6.2s" repeatCount="indefinite" keyTimes="0;0.12;0.30;0.48;0.86;1" values="149;149;67;73;73;73" />
                    </circle>
                    <circle className="atk-shot-demo__target-dot" cx="112" cy="67" r="4.5">
                      <animate attributeName="cx" dur="6.2s" repeatCount="indefinite" keyTimes="0;0.12;0.30;0.48;0.86;1" values="190;190;112;292;292;292" />
                      <animate attributeName="cy" dur="6.2s" repeatCount="indefinite" keyTimes="0;0.12;0.30;0.48;0.86;1" values="149;149;67;73;73;73" />
                    </circle>
                  </g>
                </svg>
                <div className="atk-shot-demo__player"><KawaiiFootballer label={String(selectedShooter.number ?? 9)} jerseyColor={playerJerseyColor} accentColor={playerAccentColor} shortsColor={playerShortsColor} textColor={playerTextColor} withBall isPlayer motion="idle" /></div>
                <span className="atk-shot-demo__ball" />
                <span className="atk-shot-demo__hand" />
                <div className="atk-shot-demo__gauge"><span className="atk-shot-demo__green" /><i /></div>
              </div>
              ) : (
                <button type="button" className="atk-tutorial-open" onClick={() => { sfx.click(); setShowShotDemo(true) }}>
                  Voir tutoriel
                </button>
              )}
              <div className="atk-shot-tutorial__text">
                <span className="atk-shot-step atk-shot-step--hold">Maintiens le <b>ballon</b></span>
                <span className="atk-shot-step atk-shot-step--aim">Ajuste le <b>lancer</b></span>
                <span className="atk-shot-step atk-shot-step--release">Relâche dans la <b>zone verte</b></span>
                <span className="atk-shot-warning">Attention au gardien</span>
              </div>
              <button type="button" className="atk-shot-tutorial__btn" onClick={() => { sfx.click(); markBattleTutorialSeen('attack-shot'); setShowShotTutorial(false); setShotTutorialDone(true) }}>
                Choisir mon tireur
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
          <div className="atk-controls__stat">FLOW {flow}<small>Vie {attackLives}/{ATTACK_MAX_LIVES} - Combo x{comboDisplay}</small></div>
          <div className="atk-controls__buttons">
            <button type="button" className="atk-ctrl-btn" data-control="left" aria-label="Gauche" onPointerDown={(e) => { e.stopPropagation(); keysRef.current.left = true }} onPointerUp={() => { keysRef.current.left = false }} onPointerCancel={() => { keysRef.current.left = false }} onPointerLeave={() => { keysRef.current.left = false }}>&larr;</button>
            <button type="button" className={`atk-ctrl-btn atk-ctrl-btn--evade${gdJumping || dashActive || rouletteActive ? ' is-jumping' : ''}${nextGdWave?.requiresJump || nextGdWave?.requiresRoulette ? ' is-danger' : ''}`} data-control="jump" aria-label="Esquive" onPointerDown={(e) => { e.stopPropagation(); handleEvade() }}><b>{nextGdWave?.requiresRoulette ? 'R' : nextGdWave?.requiresJump ? '\u2191' : '\u21af'}</b>{nextGdWave?.requiresRoulette ? 'ROULETTE' : nextGdWave?.requiresJump ? 'SAUT' : 'ESQUIVE'}</button>
            <button type="button" className="atk-ctrl-btn" data-control="right" aria-label="Droite" onPointerDown={(e) => { e.stopPropagation(); keysRef.current.right = true }} onPointerUp={() => { keysRef.current.right = false }} onPointerCancel={() => { keysRef.current.right = false }} onPointerLeave={() => { keysRef.current.right = false }}>&rarr;</button>
          </div>
          <div className={`atk-controls__phase${gdBadgeClass}`}>SLALOM<small>{gdInstruction}</small></div>
        </div>
      )}
    </section>
  )
}

export default AttackPhase
