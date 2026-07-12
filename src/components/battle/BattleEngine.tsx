import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BattleDifficulty, BattleDifficultySetting, BattleMatchState, BattleResult, BattleRoundType, BattleScorer, DefenseOutcome, KnockoutMatch, Team } from '../../types'
import { getCommentary } from '../../lib/commentary'
import { playGameSound, setGameAudioVolume, setGameMuted, setGameMusicVolumeMultiplier, useGameAudio, useGameAudioVolume, useGameMuted } from '../../lib/useGameAudio'
import { sfx } from '../../lib/sfx'
import { resolveTeamKit } from '../../lib/teamKits'
import AttackPhase, { type AttackEndReason } from './AttackPhase'
import { difficultyForStage } from './config'
import DefensePhase from './DefensePhase'
import FruitNinjaPhase from './FruitNinjaPhase'
import GoalSave from './GoalSave'
import CoinFlip from './CoinFlip'
import MatchResult from './MatchResult'
import RoundResult, { roundResultNeedsClick, type RoundOutcome } from './RoundResult'
import './battle.css'

const AUDIO = {
  kickoff:  '/audio/kickoff-carnival.mp3',
  attack:   '/audio/clutch-chance.mp3',
  defense:  '/audio/goal-line-panic.mp3',
  chaos:    '/audio/save-the-chaos.mp3',
  victory:  '/audio/cup-victory-parade.mp3',
  defeat:   '/audio/final-whistle-fumble.mp3',
} as const

type BattleEngineProps = {
  match: KnockoutMatch
  teamsById: Map<string, Team>
  onComplete: (result: BattleResult) => void
  onQuit?: () => void
  playerSide?: 'home' | 'away'
  showControls?: boolean
  ownerPseudo?: string
  existingResult?: BattleResult | null
  difficultySetting?: BattleDifficultySetting
  onDifficultyChange?: (difficulty: BattleDifficultySetting) => void
  allowDraw?: boolean
  disableSpecialDraw?: boolean
  allowRetry?: boolean
}

type RetrySnapshot = {
  state: BattleMatchState
  history: BattleResult['rounds']
  mode?: 'round' | 'shot'
}

function highlightPlayerName(text: string, playerName: string): ReactNode {
  if (!playerName || !text.includes(playerName)) return text
  const idx = text.indexOf(playerName)
  return <>{text.slice(0, idx)}<b style={{ color: '#2bff9a', fontStyle: 'normal' }}>{playerName}</b>{text.slice(idx + playerName.length)}</>
}

const ASSUMED_ATTACKER_COUNT = 8
const ASSUMED_KEEPER_COUNT = 3

function uniquePlayerNames(players: string[] | undefined) {
  return Array.from(new Set((players ?? []).map((name) => name.trim()).filter(Boolean)))
}

function splitPlayerRoles(players: string[] | undefined, roles?: Team['playerRoles']) {
  const names = uniquePlayerNames(players)
  if (!names.length) return { attackers: [] as string[], defenders: [] as string[], keepers: [] as string[] }
  const roleAttackers = uniquePlayerNames(roles?.attackers)
  const roleMidfielders = uniquePlayerNames(roles?.midfielders)
  const roleDefenders = uniquePlayerNames(roles?.defenders)
  const roleKeepers = uniquePlayerNames(roles?.keepers)

  if (roleAttackers.length || roleMidfielders.length || roleDefenders.length || roleKeepers.length) {
    const attackers = roleAttackers.length ? roleAttackers : names.slice(-ASSUMED_ATTACKER_COUNT)
    const keepers = roleKeepers.length ? roleKeepers : names.slice(0, ASSUMED_KEEPER_COUNT)
    const defenders = [...roleDefenders, ...roleMidfielders].length
      ? [...roleDefenders, ...roleMidfielders]
      : names.filter((name) => !attackers.includes(name) && !keepers.includes(name))
    return {
      attackers,
      defenders: defenders.length ? defenders : names.filter((name) => !keepers.includes(name)),
      keepers,
    }
  }

  if (names.length <= 4) {
    return {
      attackers: names.slice(0, Math.max(1, names.length - 1)),
      defenders: names.slice(1, Math.max(1, names.length - 1)),
      keepers: names.slice(-1),
    }
  }
  const keeperEnd = Math.min(ASSUMED_KEEPER_COUNT, names.length - 1)
  const attackerStart = Math.max(keeperEnd + 1, names.length - ASSUMED_ATTACKER_COUNT)
  const keepers = names.slice(0, keeperEnd)
  const attackers = names.slice(attackerStart)
  const defenders = names.slice(keeperEnd, attackerStart)
  return {
    attackers,
    defenders: defenders.length ? defenders : names.slice(keeperEnd, Math.max(keeperEnd + 1, names.length - 1)),
    keepers: keepers.length ? keepers : names.slice(0, 1),
  }
}

function pickFromPool(players: string[], fallback?: string) {
  if (!players.length) return fallback
  return players[Math.floor(Math.random() * players.length)] ?? fallback
}

function pickForward(players: string[] | undefined, fallback?: string, roles?: Team['playerRoles']) {
  const rolesSplit = splitPlayerRoles(players, roles)
  return rolesSplit.attackers[0] ?? fallback
}

function pickDefender(players: string[] | undefined, fallback?: string, roles?: Team['playerRoles']) {
  return pickFromPool(splitPlayerRoles(players, roles).defenders, fallback)
}

function pickKeeper(players: string[] | undefined, fallback?: string, roles?: Team['playerRoles']) {
  return splitPlayerRoles(players, roles).keepers[0] ?? fallback
}

type NextAction = { type: 'next'; append?: BattleRoundType; insertNext?: BattleRoundType } | { type: 'finish' } | { type: 'coin_flip' }

const DRAW_ROUND_COUNT = 3
const DRAW_POOL: BattleRoundType[] = ['attack', 'defense', 'fruit_ninja']
const STANDARD_ROUNDS: BattleRoundType[] = ['attack', 'defense', 'fruit_ninja']
const SUDDEN_DEATH_ROUNDS: BattleRoundType[] = ['attack', 'defense', 'attack', 'defense']
const DRAW_EXPLAIN_TEXT = "La machine tire 3 symboles au hasard.\n3 symboles différents : ordre du match aléatoire.\n2 symboles identiques : mort subite (rare), avec une seule relance.\n3 symboles identiques : mode hasard (très rare), avec une seule relance."
const MAX_SUDDEN_DEATH_ROUNDS = 4 // 2 full attack+defense cycles before forcing a result
// Weighted draw: the uniform 3-reel draw made sudden death land ~67% of the time
const DRAW_SUDDEN_DEATH_CHANCE = 0.15
const DRAW_COIN_FLIP_CHANCE = 0.05
type DrawOutcome = 'normal' | 'sudden_death' | 'coin_flip'

const ROUND_LABELS: Record<BattleRoundType, { short: string; label: string; tone: string }> = {
  attack: { short: 'ATT', label: 'Attaque', tone: 'attack' },
  defense: { short: 'DEF', label: 'Défense', tone: 'defense' },
  fruit_ninja: { short: 'TM', label: 'Tir massif', tone: 'massive' },
}

const DRAW_ORDER_MESSAGES: Record<BattleRoundType, string> = {
  attack: "Ok, on commence par l'attaque. Chauffe tes crampons !",
  defense: "Attention, ça démarre en défense. Protège bien ta surface !",
  fruit_ninja: "On ouvre sur une rafale de tirs à bloquer. T'es prêt ?",
}

const DIFFICULTY_META: Record<BattleDifficulty, { label: string; short: string }> = {
  easy: { label: 'Facile', short: 'EASY' },
  medium: { label: 'Moyen', short: 'MID' },
  hard: { label: 'Difficile', short: 'HARD' },
}

function resolveDifficulty(stage: string, setting: BattleDifficultySetting = 'auto'): BattleDifficulty {
  return setting === 'auto' ? difficultyForStage(stage) : setting
}

function difficultySettingLabel(setting: BattleDifficultySetting, stage: string) {
  if (setting === 'auto') return `Auto - ${DIFFICULTY_META[difficultyForStage(stage)].label}`
  return DIFFICULTY_META[setting].label
}

function audioForRound(round: BattleRoundType | undefined): string {
  if (round === 'attack') return AUDIO.attack
  if (round === 'fruit_ninja') return AUDIO.chaos
  return AUDIO.defense
}

function entrantId(match: KnockoutMatch, side: 'home' | 'away') {
  const entrant = match[side]
  return entrant.kind === 'team' ? entrant.teamId : side
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function drawRoundSequence(): BattleRoundType[] {
  const roll = Math.random()
  if (roll < DRAW_COIN_FLIP_CHANCE) {
    const type = DRAW_POOL[Math.floor(Math.random() * DRAW_POOL.length)]
    return Array.from({ length: DRAW_ROUND_COUNT }, () => type)
  }
  if (roll < DRAW_COIN_FLIP_CHANCE + DRAW_SUDDEN_DEATH_CHANCE) {
    const [doubled, single] = shuffled(DRAW_POOL)
    return shuffled([doubled, doubled, single])
  }
  return shuffled(DRAW_POOL)
}

function drawOutcome(rounds: BattleRoundType[]): DrawOutcome {
  const uniqueCount = new Set(rounds).size
  if (uniqueCount === 1) return 'coin_flip'
  if (uniqueCount === 2) return 'sudden_death'
  return 'normal'
}

function makeInitialState(homeTeamId: string, awayTeamId: string, skipIntro: boolean, difficulty: BattleDifficulty): BattleMatchState {
  const rounds = [...STANDARD_ROUNDS]
  return {
    roundIndex: 0,
    rounds,
    suddenDeathStartIndex: rounds.length,
    playerScore: 0,
    opponentScore: 0,
    phase: skipIntro ? 'draw' : 'intro',
    difficulty,
    homeTeamId,
    awayTeamId,
  }
}

function roundProgressMeta(round: BattleRoundType, absoluteIndex: number, suddenDeathStartIndex: number) {
  if (absoluteIndex >= suddenDeathStartIndex && round === 'defense') return { short: 'GS', label: 'Goal save' }
  return ROUND_LABELS[round]
}

function BattlePhaseIcon({ type, className }: { type: BattleRoundType; className?: string }) {
  if (type === 'attack') {
    return (
      <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
        <path d="M8 35 C16 20 25 16 40 11" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M31 9 H41 V19" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="15" cy="34" r="6" fill="#f7fbff" stroke="#06111f" strokeWidth="3" />
        <path d="M15 28 L20 33 L18 40 H12 L10 33 Z" fill="#06111f" opacity=".9" />
      </svg>
    )
  }
  if (type === 'defense') {
    return (
      <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 6 L38 12 V23 C38 32 32 38 24 42 C16 38 10 32 10 23 V12 Z" fill="currentColor" opacity=".22" />
        <path d="M24 6 L38 12 V23 C38 32 32 38 24 42 C16 38 10 32 10 23 V12 Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <path d="M17 24 L22 29 L32 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="17" cy="18" r="7" fill="#f7fbff" stroke="#06111f" strokeWidth="3" />
      <circle cx="31" cy="18" r="7" fill="#f7fbff" stroke="#06111f" strokeWidth="3" />
      <circle cx="24" cy="31" r="8" fill="#f7fbff" stroke="#06111f" strokeWidth="3" />
      <path d="M12 37 L36 11 M10 25 L30 8 M20 42 L40 22" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function BattleProgressRail({ rounds, currentIndex, phase, suddenDeathStartIndex }: { rounds: BattleRoundType[]; currentIndex: number; phase: string; suddenDeathStartIndex: number }) {
  const suddenDeath = currentIndex >= suddenDeathStartIndex
  const visibleStart = suddenDeath ? suddenDeathStartIndex : 0
  const visibleRounds = suddenDeath ? (['attack', 'defense', 'attack', 'defense'] as BattleRoundType[]) : rounds.slice(0, suddenDeathStartIndex)
  const activeVisibleIndex = currentIndex - visibleStart
  const progressLabel = suddenDeath ? 'Mort subite' : `Phase ${Math.min(currentIndex + 1, suddenDeathStartIndex)}/${suddenDeathStartIndex}`

  return (
    <div className={`battle-progress-rail${suddenDeath ? ' is-sudden' : ''}`} aria-label={progressLabel}>
      <div className="battle-progress-rail__title">{suddenDeath ? 'MS' : 'MATCH'}</div>
      <div className="battle-progress-rail__steps">
        {visibleRounds.map((round, index) => {
          const absoluteIndex = visibleStart + index
          const isDone = absoluteIndex < currentIndex || phase === 'round_result' && absoluteIndex === currentIndex
          const isActive = index === activeVisibleIndex && phase !== 'round_result'
          const meta = roundProgressMeta(round, absoluteIndex, suddenDeathStartIndex)
          return (
            <div
              key={`${absoluteIndex}-${round}`}
              className={`battle-progress-step is-${ROUND_LABELS[round].tone}${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}
              title={`${absoluteIndex + 1}. ${meta.label}`}
            >
              <span><BattlePhaseIcon type={round} /></span>
              <i />
            </div>
          )
        })}
      </div>
      <div className="battle-progress-rail__meta">{suddenDeath ? `${Math.min(Math.max(activeVisibleIndex + 1, 1), MAX_SUDDEN_DEATH_ROUNDS)}/${MAX_SUDDEN_DEATH_ROUNDS}` : `${currentIndex + 1}/${suddenDeathStartIndex}`}</div>
    </div>
  )
}

type SuddenAttempt = 'pending' | 'active' | 'goal' | 'miss'

function SuddenDeathShootout({ history, currentIndex, currentRound, phase, suddenDeathStartIndex }: { history: BattleResult['rounds']; currentIndex: number; currentRound: BattleRoundType; phase: string; suddenDeathStartIndex: number }) {
  const suddenHistory = history.slice(suddenDeathStartIndex, suddenDeathStartIndex + MAX_SUDDEN_DEATH_ROUNDS)
  const playerAttempts: SuddenAttempt[] = ['pending', 'pending']
  const opponentAttempts: SuddenAttempt[] = ['pending', 'pending']
  let playerSlot = 0
  let opponentSlot = 0

  suddenHistory.forEach((round) => {
    if (round.type === 'attack' && playerSlot < playerAttempts.length) {
      playerAttempts[playerSlot] = round.isGoal ? 'goal' : 'miss'
      playerSlot += 1
    } else if (round.type === 'defense' && opponentSlot < opponentAttempts.length) {
      opponentAttempts[opponentSlot] = round.isGoal ? 'goal' : 'miss'
      opponentSlot += 1
    }
  })

  if (currentIndex >= suddenDeathStartIndex && phase !== 'round_result') {
    if (currentRound === 'attack' && playerSlot < playerAttempts.length) playerAttempts[playerSlot] = 'active'
    if (currentRound === 'defense' && opponentSlot < opponentAttempts.length) opponentAttempts[opponentSlot] = 'active'
  }

  const renderDots = (items: SuddenAttempt[]) => items.map((status, index) => <i key={index} className={`battle-sd-dot is-${status}`} />)

  return (
    <div className="battle-sd-shootout" aria-label="Mort subite tirs au but">
      <div className="battle-sd-shootout__side">{renderDots(playerAttempts)}</div>
      <span>MORT SUBITE</span>
      <div className="battle-sd-shootout__side">{renderDots(opponentAttempts)}</div>
    </div>
  )
}

function teamFlagImgUrl(iso2?: string) {
  if (!iso2) return null
  return `https://flagcdn.com/w40/${iso2.toLowerCase()}.png`
}

function BattleFlag({ team, emoji }: { team?: Team; emoji: string }) {
  const [failed, setFailed] = useState(false)
  const src = teamFlagImgUrl(team?.iso2)
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={team?.name ?? ''}
        crossOrigin="anonymous"
        onError={() => setFailed(true)}
        style={{ width: 22, height: 15, objectFit: 'cover', borderRadius: 2, display: 'block', flexShrink: 0 }}
      />
    )
  }
  return <span>{emoji}</span>
}

export function BattleEngine({ match, teamsById, onComplete, onQuit, playerSide, showControls = false, ownerPseudo, existingResult, difficultySetting = 'medium', onDifficultyChange, allowDraw = false, disableSpecialDraw = false, allowRetry = true }: BattleEngineProps) {
  const rawHomeId = entrantId(match, 'home')
  const rawAwayId = entrantId(match, 'away')
  const homeTeamId = playerSide === 'away' ? rawAwayId : rawHomeId
  const awayTeamId = playerSide === 'away' ? rawHomeId : rawAwayId
  const homeTeam = teamsById.get(homeTeamId)
  const awayTeam = teamsById.get(awayTeamId)
  const controlledTeam = playerSide === 'away' ? awayTeam : homeTeam
  const controlledTeamId = playerSide === 'away' ? awayTeamId : homeTeamId
  const homeFlag = homeTeam?.flagEmoji ?? ''
  const awayFlag = awayTeam?.flagEmoji ?? ''
  const homeKit = useMemo(() => resolveTeamKit(homeTeam, homeTeamId), [homeTeam, homeTeamId])
  const awayKit = useMemo(() => resolveTeamKit(awayTeam, awayTeamId), [awayTeam, awayTeamId])
  const homeRoles = useMemo(() => splitPlayerRoles(homeTeam?.players, homeTeam?.playerRoles), [homeTeam?.players, homeTeam?.playerRoles])
  const awayRoles = useMemo(() => splitPlayerRoles(awayTeam?.players, awayTeam?.playerRoles), [awayTeam?.players, awayTeam?.playerRoles])
  const skipIntro = playerSide != null
  const skipScreens = false
  const selectedDifficulty = resolveDifficulty(match.stage, difficultySetting)

  // Si un resultat existant est fourni, commencer directement en phase match_result
  const [state, setState] = useState<BattleMatchState>(() => 
    existingResult 
      ? { ...makeInitialState(homeTeamId, awayTeamId, skipIntro, existingResult.difficulty ?? selectedDifficulty), phase: 'match_result' }
      : makeInitialState(homeTeamId, awayTeamId, skipIntro, selectedDifficulty)
  )
  const [history, setHistory] = useState<BattleResult['rounds']>([])
  const [roundOutcome, setRoundOutcome] = useState<RoundOutcome>('miss')
  const [nextAction, setNextAction] = useState<NextAction | null>(null)
  const [retrySnapshot, setRetrySnapshot] = useState<RetrySnapshot | null>(null)
  const [retryShotOnly, setRetryShotOnly] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [countdownNum, setCountdownNum] = useState<number | null>(null)
  const [audioOverride, setAudioOverride] = useState<string | null>(null)
  const [coinFlipWinnerId, setCoinFlipWinnerId] = useState<string | null>(null)
  const [coinFlipMode, setCoinFlipMode] = useState<'sudden_death' | 'simulation'>('sudden_death')
  const [simulatedResult, setSimulatedResult] = useState<BattleResult | null>(null)
  const [roundScorer, setRoundScorer] = useState<BattleScorer | null>(null)
  const [matchScorers, setMatchScorers] = useState<BattleScorer[]>([])
  const [drawPreview, setDrawPreview] = useState<BattleRoundType[]>(() => [...STANDARD_ROUNDS])
  const [drawHasStarted, setDrawHasStarted] = useState(false)
  const [isDrawingRounds, setIsDrawingRounds] = useState(false)
  const [drawComplete, setDrawComplete] = useState(false)
  const [drawRevealActive, setDrawRevealActive] = useState(false)
  const [drawJackpot, setDrawJackpot] = useState(false)
  const [drawResultMode, setDrawResultMode] = useState<DrawOutcome>('normal')
  const [drawRerollUsed, setDrawRerollUsed] = useState(false)
  const [drawLockedReels, setDrawLockedReels] = useState<[boolean, boolean, boolean]>([false, false, false])
  const [leverPulling, setLeverPulling] = useState(false)
  const [drawIntroSeen, setDrawIntroSeen] = useState(false)
  const [drawExplainChars, setDrawExplainChars] = useState(0)
  const [bonusAttackIndexes, setBonusAttackIndexes] = useState<Set<number>>(() => new Set())
  const drawStartedRef = useRef(false)
  const drawLockedRef = useRef<[boolean, boolean, boolean]>([false, false, false])

  const handleDrawIntroContinue = () => {
    sfx.start()
    setDrawIntroSeen(true)
  }
  const drawExplainDone = drawExplainChars >= DRAW_EXPLAIN_TEXT.length
  const drawExplainTyped = DRAW_EXPLAIN_TEXT.slice(0, drawExplainChars)

  useEffect(() => {
    if (drawIntroSeen || drawExplainDone || state.phase !== 'draw') return
    const id = window.setTimeout(() => {
      setDrawExplainChars((c) => Math.min(DRAW_EXPLAIN_TEXT.length, c + 2))
      sfx.dialogueBlip()
    }, 28)
    return () => window.clearTimeout(id)
  }, [drawIntroSeen, drawExplainDone, state.phase, drawExplainChars])

  const audioMuted = useGameMuted()
  const audioVolume = useGameAudioVolume()

  // Pick stable player names for this match (avoid re-computing each render)
  const homeAttackerName = useMemo(() => pickForward(homeTeam?.players, homeTeam?.shortName ? `${homeTeam.shortName} ATT` : undefined, homeTeam?.playerRoles), [homeTeam?.players, homeTeam?.shortName, homeTeam?.playerRoles])
  const awayAttackerName = useMemo(() => pickForward(awayTeam?.players, awayTeam?.shortName ? `${awayTeam.shortName} ATT` : undefined, awayTeam?.playerRoles), [awayTeam?.players, awayTeam?.shortName, awayTeam?.playerRoles])
  const homeDefenderName = useMemo(() => pickDefender(homeTeam?.players, homeTeam?.shortName ? `${homeTeam.shortName} DEF` : undefined, homeTeam?.playerRoles), [homeTeam?.players, homeTeam?.shortName, homeTeam?.playerRoles])
  const homeKeeperName = useMemo(() => pickKeeper(homeTeam?.players, homeTeam?.shortName ? `${homeTeam.shortName} GK` : undefined, homeTeam?.playerRoles), [homeTeam?.players, homeTeam?.shortName, homeTeam?.playerRoles])
  const awayKeeperName = useMemo(() => pickKeeper(awayTeam?.players, awayTeam?.shortName ? `${awayTeam.shortName} GK` : undefined, awayTeam?.playerRoles), [awayTeam?.players, awayTeam?.shortName, awayTeam?.playerRoles])

  const currentRound = state.rounds[state.roundIndex]
  const suddenDeath = state.roundIndex >= state.suddenDeathStartIndex
  const isSuddenGoalSave = suddenDeath && currentRound === 'defense'
  const previousRound = history[state.roundIndex - 1]
  const isCounterAttackRound = !suddenDeath && currentRound === 'attack' && bonusAttackIndexes.has(state.roundIndex)
  const roundStartPlayerNumber = currentRound === 'attack' ? '9' : currentRound === 'defense' ? '10' : '1'
  const roundStartPlayerName = currentRound === 'attack' ? homeAttackerName : currentRound === 'defense' ? awayAttackerName : awayKeeperName
  const roundStartCommentaryPlayer = roundStartPlayerName ? `${roundStartPlayerName} #${roundStartPlayerNumber}` : undefined
  const result = useMemo<BattleResult>(() => ({
    homeScore: state.playerScore,
    awayScore: state.opponentScore,
    winnerId: coinFlipWinnerId ?? (state.playerScore === state.opponentScore && allowDraw ? null : state.playerScore > state.opponentScore ? homeTeamId : awayTeamId),
    playerScore: state.playerScore,
    difficulty: state.difficulty,
    rounds: history,
    scorers: matchScorers,
  }), [awayTeamId, coinFlipWinnerId, history, homeTeamId, matchScorers, state.difficulty, state.opponentScore, state.playerScore])
  const displayedResult = existingResult ?? simulatedResult ?? result
  const countdownProgress = countdownNum === 3 ? '100%' : countdownNum === 2 ? '66%' : countdownNum === 1 ? '33%' : '100%'
  const displayedRoundType = roundOutcome === 'saved' && currentRound === 'attack' && history[state.roundIndex]?.type === 'defense'
    ? 'defense'
    : currentRound

  const startRoundCountdown = () => {
    setState((current) => ({ ...current, phase: 'playing' }))
  }

  const launchRoundDraw = (force = false) => {
    if (isDrawingRounds || (drawHasStarted && !force)) return
    drawStartedRef.current = true
    setDrawHasStarted(true)
    setDrawRevealActive(true)
    window.setTimeout(() => setDrawRevealActive(false), 980)

    // Lever pull animation
    setLeverPulling(true)
    window.setTimeout(() => setLeverPulling(false), 380)

    sfx.rouletteReveal()
    sfx.battle()

    const finalRounds = disableSpecialDraw ? shuffled(STANDARD_ROUNDS) : drawRoundSequence()
    const outcome = drawOutcome(finalRounds)
    const suddenDeathDraw = !disableSpecialDraw && outcome === 'sudden_death'
    const coinFlipDraw = !disableSpecialDraw && outcome === 'coin_flip'
    const playableRounds = suddenDeathDraw ? SUDDEN_DEATH_ROUNDS : finalRounds
    drawLockedRef.current = [false, false, false]
    setDrawLockedReels([false, false, false])
    setIsDrawingRounds(true)
    setDrawComplete(false)
    setDrawJackpot(false)
    setDrawResultMode('normal')
    sfx.rouletteTick()

    const shuffle = window.setInterval(() => {
      const locked = drawLockedRef.current
      setDrawPreview(prev => prev.map((r, i) => locked[i] ? r : DRAW_POOL[Math.floor(Math.random() * DRAW_POOL.length)]) as BattleRoundType[])
      sfx.rouletteTick()
    }, 90)

    ;([1200, 1650, 2100] as const).forEach((ms, i) => {
      window.setTimeout(() => {
        const newLocked = [...drawLockedRef.current] as [boolean, boolean, boolean]
        newLocked[i] = true
        drawLockedRef.current = newLocked
        setDrawLockedReels([...newLocked])
        setDrawPreview(prev => prev.map((r, idx) => idx === i ? finalRounds[idx] : r) as BattleRoundType[])
        sfx.rouletteStop()
        if (i === 2) {
          window.clearInterval(shuffle)
          setState(current => ({
            ...current,
            rounds: playableRounds,
            suddenDeathStartIndex: suddenDeathDraw ? 0 : finalRounds.length,
            roundIndex: 0,
          }))
          window.setTimeout(() => {
            setDrawJackpot(suddenDeathDraw || coinFlipDraw)
            setDrawResultMode(outcome)
            setIsDrawingRounds(false)
            setDrawComplete(true)
          }, 460)
        }
      }, ms)
    })
  }

  const rerollRoundDraw = () => {
    if (drawRerollUsed || drawResultMode === 'normal' || isDrawingRounds) return
    sfx.click()
    setDrawRerollUsed(true)
    setDrawComplete(false)
    launchRoundDraw(true)
  }

  // Audio
  const playerWon = displayedResult.winnerId === homeTeamId
  const baseAudioSrc = (() => {
    if (state.phase === 'draw') return AUDIO.kickoff
    if (suddenDeath && state.phase !== 'match_result' && state.phase !== 'coin_flip') return null
    if (state.phase === 'intro') return AUDIO.kickoff
    if (state.phase === 'match_result') return playerWon ? AUDIO.victory : AUDIO.defeat
    if (state.phase === 'round_start' || state.phase === 'playing' || state.phase === 'round_result' || state.phase === 'countdown') {
      return audioForRound(currentRound)
    }
    return AUDIO.kickoff
  })()
  const audioSrc = audioOverride ?? baseAudioSrc
  useGameAudio(audioSrc)

  useEffect(() => {
    if (existingResult) return
    setState((current) => current.difficulty === selectedDifficulty ? current : { ...current, difficulty: selectedDifficulty })
  }, [existingResult, selectedDifficulty])

  useEffect(() => {
    setGameMusicVolumeMultiplier(state.phase === 'intro' || state.phase === 'draw' || state.phase === 'match_result' ? 1 : 0.42)
    return () => setGameMusicVolumeMultiplier(1)
  }, [state.phase])

  const commentaryData = useMemo(() => {
    if (!homeTeam || !awayTeam) return null
    if (currentRound === 'fruit_ninja') return null
    if (currentRound === 'attack') return null
    if (isCounterAttackRound) return null
    return getCommentary('pre_defense', homeTeam, awayTeam, roundStartCommentaryPlayer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, currentRound, isCounterAttackRound, roundStartCommentaryPlayer])

  // Countdown 3-2-1-GO
  useEffect(() => {
    if (state.phase !== 'countdown') return
    sfx.countdownTick()
    setCountdownNum(3)
    const t1 = setTimeout(() => { setCountdownNum(2); sfx.countdownTick() }, 900)
    const t2 = setTimeout(() => { setCountdownNum(1); sfx.countdownTick() }, 1800)
    const t3 = setTimeout(() => { setCountdownNum(0); sfx.countdownGo() }, 2700)   // 0 = "GO!"
    const t4 = setTimeout(() => {
      setCountdownNum(null)
      setState((curr) => ({ ...curr, phase: 'playing' }))
    }, 3300)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [state.phase])

  // Advance to next round (called by auto-timer OR by "On se ressaisit" button)
  const advanceRound = useMemo(() => () => {
    if (!nextAction) return
    if (nextAction.type === 'finish') {
      setState((current) => ({ ...current, phase: 'match_result' }))
    } else if (nextAction.type === 'coin_flip') {
      setCoinFlipMode('sudden_death')
      setState((current) => ({ ...current, phase: 'coin_flip' }))
    } else {
      setState((current) => {
        const rounds = nextAction.insertNext
          ? [...current.rounds.slice(0, current.roundIndex + 1), nextAction.insertNext, ...current.rounds.slice(current.roundIndex + 1)]
          : nextAction.append ? [...current.rounds, nextAction.append] : current.rounds
        const roundIndex = current.roundIndex + 1
        const nextRoundType = rounds[roundIndex]
        if (nextAction.insertNext === 'attack') {
          setBonusAttackIndexes((prev) => new Set(prev).add(roundIndex))
        }
        return {
          ...current,
          rounds,
          suddenDeathStartIndex: nextAction.insertNext ? current.suddenDeathStartIndex + 1 : current.suddenDeathStartIndex,
          roundIndex,
          phase: skipScreens || nextRoundType === 'attack' || nextRoundType === 'defense' || nextRoundType === 'fruit_ninja' ? 'playing' : 'round_start',
        }
      })
    }
    setNextAction(null)
    setRetrySnapshot(null)
    setRoundScorer(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextAction, skipScreens])

  // Round result to next round / finish
  useEffect(() => {
    if (state.phase !== 'round_result' || !nextAction || roundResultNeedsClick(roundOutcome)) return
    const timer = window.setTimeout(advanceRound, 2000)
    return () => window.clearTimeout(timer)
  }, [advanceRound, nextAction, roundOutcome, state.phase])

  const completeRound = (success: boolean, isGoal: boolean, outcome: RoundOutcome, scorer?: BattleScorer, counterEligible = success, retryMode: RetrySnapshot['mode'] = 'round') => {
    const isOpponentScoringRound = currentRound === 'defense' || currentRound === 'fruit_ninja'
    const goalValue = Math.max(1, Math.round(scorer?.goals ?? 1))
    const nextPlayerScore = state.playerScore + (currentRound === 'attack' && isGoal ? goalValue : 0)
    const nextOpponentScore = state.opponentScore + (isOpponentScoringRound && isGoal ? goalValue : 0)
    const nextHistory = [...history, { type: currentRound, success, isGoal, ...(scorer ? { scorer } : {}) }]
    let action: NextAction
    const earnsCounterAttack = !suddenDeath && isOpponentScoringRound && counterEligible

    if (earnsCounterAttack) {
      action = { type: 'next', insertNext: 'attack' }
    } else if (!suddenDeath && state.roundIndex < state.suddenDeathStartIndex - 1) {
      action = { type: 'next' }
    } else if (!suddenDeath) {
      action = nextPlayerScore === nextOpponentScore && !allowDraw ? { type: 'next', append: 'attack' } : { type: 'finish' }
    } else {
      const suddenDeathCompleted = state.roundIndex - state.suddenDeathStartIndex + 1
      if (currentRound === 'attack') {
        action = { type: 'next', append: 'defense' }
      } else if (nextPlayerScore !== nextOpponentScore) {
        action = { type: 'finish' }
      } else if (suddenDeathCompleted >= MAX_SUDDEN_DEATH_ROUNDS) {
        action = { type: 'coin_flip' }
      } else {
        action = { type: 'next', append: 'attack' }
      }
    }

    setRetryShotOnly(false)
    setRetrySnapshot({ state, history, mode: retryMode })
    setRoundScorer(scorer ?? null)
    setMatchScorers(nextHistory.flatMap((round) => round.isGoal && round.scorer ? [round.scorer] : []))
    setHistory(nextHistory)
    setRoundOutcome(outcome)
    setNextAction(action)
    setState((current) => ({ ...current, playerScore: nextPlayerScore, opponentScore: nextOpponentScore, phase: 'round_result' }))
  }

  const handleAttackEnd = (isGoal: boolean, reason: AttackEndReason = isGoal ? 'goal' : 'miss', scorer?: BattleScorer) => {
    if (reason === 'intercepted') {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      setRetrySnapshot({ state, history })
      setRoundScorer({
        name: awayAttackerName ?? awayTeam?.name ?? awayTeamId,
        teamId: awayTeamId,
        teamCode: awayTeam?.fifaCode,
        number: 9,
        controlled: false,
      })
      setRoundOutcome('intercepted')
      setNextAction(null)
      setState((current) => ({ ...current, phase: 'interception_goal_save' }))
      return
    }
    const outcome: RoundOutcome = isGoal ? 'goal' : reason === 'saved' ? 'saved' : 'miss'
    if (isGoal) {
      playGameSound('/audio/goal.mp3', { volume: 1 })
      sfx.goal()
    } else {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
    }
    const retryMode: RetrySnapshot['mode'] = !isGoal && reason === 'miss' && currentRound === 'attack' && !suddenDeath ? 'shot' : 'round'
    completeRound(isGoal, isGoal, outcome, scorer, isGoal, retryMode)
  }

  const handleDefenseEnd = (outcome: DefenseOutcome) => {
    const opponentScorer: BattleScorer = {
      name: awayAttackerName ?? awayTeam?.name ?? awayTeamId,
      teamId: awayTeamId,
      teamCode: awayTeam?.fifaCode,
      number: 9,
      controlled: false,
    }
    if (outcome.path === 'space_invaders') {
      const success = outcome.blocked === outcome.total
      if (!success) {
        playGameSound('/audio/sad.mp3', { volume: 0.95 })
        sfx.concede()
      }
      completeRound(success, !success, success ? 'defense_perfect' : 'goal_conceded', success ? undefined : opponentScorer)
      return
    }
    if (!outcome.saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }
    completeRound(outcome.saved, !outcome.saved, outcome.saved ? 'saved' : 'goal_conceded', outcome.saved ? undefined : opponentScorer, false)
  }

  const handleSuddenGoalSaveEnd = (saved: boolean) => {
    const opponentScorer: BattleScorer = {
      name: awayAttackerName ?? awayTeam?.name ?? awayTeamId,
      teamId: awayTeamId,
      teamCode: awayTeam?.fifaCode,
      number: 9,
      controlled: false,
    }
    if (!saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }
    completeRound(saved, !saved, saved ? 'saved' : 'goal_conceded', saved ? undefined : opponentScorer)
  }

  const handleStartInterceptionGoalSave = () => {
    sfx.click()
    setAudioOverride(null)
    setState((current) => ({ ...current, phase: 'interception_goal_save' }))
  }

  const handleInterceptionGoalSaveEnd = (saved: boolean) => {
    const opponentScorer: BattleScorer = {
      name: roundScorer?.name ?? awayAttackerName ?? awayTeam?.name ?? awayTeamId,
      teamId: awayTeamId,
      teamCode: awayTeam?.fifaCode,
      number: 9,
      controlled: false,
    }
    if (!saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }

    const nextPlayerScore = state.playerScore
    const nextOpponentScore = state.opponentScore + Number(!saved)
    const nextHistory = [...history, { type: 'defense' as const, success: saved, isGoal: !saved, ...(!saved ? { scorer: opponentScorer } : {}) }]
    let action: NextAction
    if (!suddenDeath && state.roundIndex < state.suddenDeathStartIndex - 1) {
      action = { type: 'next' }
    } else if (!suddenDeath) {
      action = nextPlayerScore === nextOpponentScore && !allowDraw ? { type: 'next', append: 'attack' } : { type: 'finish' }
    } else if (nextPlayerScore !== nextOpponentScore) {
      action = { type: 'finish' }
    } else {
      action = { type: 'next', append: 'defense' }
    }

    setMatchScorers(nextHistory.flatMap((round) => round.isGoal && round.scorer ? [round.scorer] : []))
    setHistory(nextHistory)
    setRoundOutcome(saved ? 'saved' : 'goal_conceded')
    setNextAction(action)
    setRoundScorer(saved ? null : opponentScorer)
    setRetrySnapshot(null)
    setState((current) => ({ ...current, playerScore: nextPlayerScore, opponentScore: nextOpponentScore, phase: 'round_result' }))
  }
  const handleFruitNinjaEnd = (saved: boolean, perfect = saved) => {
    const opponentScorer: BattleScorer = {
      name: awayAttackerName ?? awayTeam?.name ?? awayTeamId,
      teamId: awayTeamId,
      teamCode: awayTeam?.fifaCode,
      number: 9,
      controlled: false,
    }
    if (!saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }
    completeRound(saved, !saved, saved ? (perfect ? 'defense_perfect' : 'saved') : 'goal_conceded', saved ? undefined : opponentScorer, perfect)
  }

  const handleCoinFlipEnd = (winnerId: string, score?: { home: number; away: number }, commentary?: string) => {
    setCoinFlipWinnerId(winnerId)
    if (coinFlipMode === 'simulation' && score) {
      setSimulatedResult({
        homeScore: score.home,
        awayScore: score.away,
        winnerId,
        playerScore: score.home,
        difficulty: state.difficulty,
        rounds: [],
        simulated: true,
        commentary,
      })
      setState((current) => ({
        ...current,
        phase: 'match_result',
        playerScore: score.home,
        opponentScore: score.away,
      }))
      return
    }
    setHistory((prev) => [...prev, { type: 'attack' as const, success: true, isGoal: true }])
    setState((current) => ({
      ...current,
      phase: 'match_result',
      playerScore: winnerId === homeTeamId ? current.playerScore + 1 : current.playerScore,
      opponentScore: winnerId === homeTeamId ? current.opponentScore : current.opponentScore + 1,
    }))
  }

  // Pause / Restart
  const nextRoundType = nextAction?.type === 'next'
    ? (nextAction.insertNext ?? nextAction.append ?? state.rounds[state.roundIndex + 1] ?? null)
    : null
  const roundStartKit = currentRound === 'attack' ? homeKit : awayKit
  const roundStartAccent = roundStartKit.secondary ?? '#0b1422'
  const roundStartShorts = roundStartKit.shorts ?? '#101a2c'
  const roundStartText = roundStartKit.text ?? '#0b1422'
  const roundStartPrimary = roundStartKit.primary ?? (currentRound === 'attack' ? '#2bff9a' : '#FF4455')

  const handleRestart = () => {
    sfx.click()
    setIsPaused(false)
    setHistory([])
    setMatchScorers([])
    setRoundScorer(null)
    setNextAction(null)
    setRetrySnapshot(null)
    setRetryShotOnly(false)
    setRoundOutcome('miss')
    setCoinFlipWinnerId(null)
    setSimulatedResult(null)
    setCoinFlipMode('sudden_death')
    setState(makeInitialState(homeTeamId, awayTeamId, skipIntro, selectedDifficulty))
    setDrawPreview([...STANDARD_ROUNDS])
    setDrawHasStarted(false)
    setIsDrawingRounds(false)
    setDrawComplete(false)
    setDrawRevealActive(false)
    setDrawJackpot(false)
    setDrawResultMode('normal')
    setDrawRerollUsed(false)
    setBonusAttackIndexes(new Set())
    drawStartedRef.current = false
  }

  const handleRetryRound = () => {
    if (!retrySnapshot) return
    sfx.click()
    setIsPaused(false)
    setHistory(retrySnapshot.history)
    setMatchScorers(retrySnapshot.history.flatMap((round) => round.isGoal && round.scorer ? [round.scorer] : []))
    setRoundScorer(null)
    setNextAction(null)
    setRoundOutcome('miss')
    setAudioOverride(null)
    setRetryShotOnly(retrySnapshot.mode === 'shot')
    setRetrySnapshot(null)
    setState({ ...retrySnapshot.state, phase: 'playing' })
  }


  return (
    <>
    <div className="battle-desktop-bg" aria-hidden="true" />
    <div className="battle-engine" role="dialog" aria-modal="true" aria-label={`Combat ${match.label}`} onContextMenu={(e) => e.preventDefault()}>

      {/* Persistent score pill: same compact format as the pre-battle screen */}
      {state.phase !== 'intro' && state.phase !== 'draw' && state.phase !== 'match_result' ? (
        <>
        <div className="battle-score-strip battle-score-pill" aria-label="Score">
          <span className="battle-score-strip__flag"><BattleFlag team={homeTeam} emoji={homeFlag || homeTeam?.shortName?.slice(0, 2).toUpperCase() || homeTeamId.slice(0, 2).toUpperCase()} /></span>
          <strong>{state.playerScore}</strong>
          <em>-</em>
          <strong>{state.opponentScore}</strong>
          <span className="battle-score-strip__flag"><BattleFlag team={awayTeam} emoji={awayFlag || awayTeam?.shortName?.slice(0, 2).toUpperCase() || awayTeamId.slice(0, 2).toUpperCase()} /></span>
        </div>
        <div className={`battle-difficulty-pill is-${state.difficulty}`} aria-label={`Difficulte ${DIFFICULTY_META[state.difficulty].label}`}>
          <span>{DIFFICULTY_META[state.difficulty].short}</span>
        </div>
        {suddenDeath
          ? <SuddenDeathShootout history={history} currentIndex={state.roundIndex} currentRound={currentRound} phase={state.phase} suddenDeathStartIndex={state.suddenDeathStartIndex} />
          : <BattleProgressRail rounds={state.rounds} currentIndex={state.roundIndex} phase={state.phase} suddenDeathStartIndex={state.suddenDeathStartIndex} />}
        </>
      ) : null}

      {/* Intro */}
      {state.phase === 'intro' ? <section className="battle-intro">
        <div className="battle-intro__meta">{match.stage} - {match.label} - {match.dateLabel}</div>
        <div className="battle-intro__matchup">
          <div className="battle-intro__team">
            <div className="battle-intro__badge is-home">
              {teamFlagImgUrl(homeTeam?.iso2)
                ? <img src={teamFlagImgUrl(homeTeam?.iso2)!} alt={homeTeam?.name ?? ''} crossOrigin="anonymous" style={{ width: 50, height: 34, objectFit: 'cover', borderRadius: 4 }} />
                : homeFlag ? <span style={{ fontSize: 36 }}>{homeFlag}</span>
                : (homeTeam?.shortName?.toUpperCase() ?? rawHomeId.slice(0, 3).toUpperCase())}
            </div>
            <strong>{homeTeam?.shortName?.toUpperCase() ?? rawHomeId.toUpperCase()}</strong>
          </div>
          <div className="battle-intro__vs">VS</div>
          <div className="battle-intro__team is-away">
            <div className="battle-intro__badge">
              {teamFlagImgUrl(awayTeam?.iso2)
                ? <img src={teamFlagImgUrl(awayTeam?.iso2)!} alt={awayTeam?.name ?? ''} crossOrigin="anonymous" style={{ width: 50, height: 34, objectFit: 'cover', borderRadius: 4 }} />
                : awayFlag ? <span style={{ fontSize: 36 }}>{awayFlag}</span>
                : (awayTeam?.shortName?.toUpperCase() ?? rawAwayId.slice(0, 3).toUpperCase())}
            </div>
            <strong>{awayTeam?.shortName?.toUpperCase() ?? rawAwayId.toUpperCase()}</strong>
          </div>
        </div>
        <div className="battle-intro__spacer" />
        <div className="battle-intro__sequence">
          {STANDARD_ROUNDS.map((round, index) => (
            <div key={index} className={`is-${ROUND_LABELS[round].tone}`}>
              <BattlePhaseIcon type={round} />
              <small>{ROUND_LABELS[round].label}</small>
            </div>
          ))}
        </div>
        <div className={`battle-intro__difficulty is-${state.difficulty}`}>
          <span>Difficulte</span>
          <strong>{DIFFICULTY_META[state.difficulty].label}</strong>
          <small>{difficultySetting === 'auto' ? 'Auto selon le stade' : 'Reglage manuel'}</small>
        </div>
        <div className="battle-intro__actions">
          <button type="button" className="battle-intro__cta" onClick={() => { sfx.click(); setState((current) => ({ ...current, phase: 'draw' })) }}>
            Lancer le tirage
          </button>
          <button type="button" className="battle-intro__simulate" onClick={() => { sfx.click(); setCoinFlipMode('simulation'); setState((current) => ({ ...current, phase: 'coin_flip' })) }}>
            Simuler
          </button>
        </div>
      </section> : null}

      {/* Pre-draw explanation dialogue — shown only once ever */}
      {state.phase === 'draw' && !drawIntroSeen ? (
        <section className="battle-draw-explain">
          {/* Background image — very transparent so image is visible */}
          <div className="battle-draw-explain__bg" aria-hidden="true">
            <img src="/challenge-splash-explain.png" className="battle-draw-explain__bg-img" alt="" />
            <div className="battle-draw-explain__bg-overlay" />
          </div>

          {/* Speech bubble at top — reuses challenge splash dialogue CSS */}
          <div className="splash-dialogue battle-draw-explain__dialogue">
            <div className="splash-dialogue__box" role="dialog" aria-live="polite">
              <div className="splash-dialogue__head">
                <span>Machine de tirage</span>
              </div>
              <p>
                {drawExplainTyped.split('\n').map((line, i, arr) => (
                  <span key={i}>
                    {line}
                    {i < arr.length - 1 ? <br /> : null}
                  </span>
                ))}
                {!drawExplainDone ? <i className="splash-dialogue__cursor" aria-hidden="true" /> : null}
              </p>
              {drawExplainDone ? (
                <div className="battle-draw-explain__icons">
                  {DRAW_POOL.map((type, i) => (
                    <div key={i} className={`battle-draw-explain__icon-item is-${ROUND_LABELS[type].tone}`}>
                      <BattlePhaseIcon type={type} />
                      <small>{ROUND_LABELS[type].label}</small>
                    </div>
                  ))}
                </div>
              ) : null}
              {drawExplainDone ? (
                <button type="button" className="splash-dialogue__next is-final" onClick={handleDrawIntroContinue}>
                  Lancer le tirage
                </button>
              ) : (
                <button type="button" className="splash-dialogue__skip" onClick={() => setDrawExplainChars(DRAW_EXPLAIN_TEXT.length)}>
                  Afficher
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Draw cabinet — shown after explanation is dismissed */}
      {state.phase === 'draw' && drawIntroSeen ? <section className={`battle-draw${drawRevealActive ? ' is-revealing' : ''}${isDrawingRounds ? ' is-drawing' : ''}${drawComplete ? ' is-complete' : ''}${drawJackpot ? ' is-jackpot' : ''}`}>
        <div className="battle-draw__meta">{match.stage} - {match.label}</div>
        {drawRevealActive ? (
          <div className="battle-draw__reveal" aria-hidden="true">
            <i className="battle-draw__smoke battle-draw__smoke--a" />
            <i className="battle-draw__smoke battle-draw__smoke--b" />
            <i className="battle-draw__smoke battle-draw__smoke--c" />
          </div>
        ) : null}
        <div className="battle-draw__matchup">
          <span><BattleFlag team={homeTeam} emoji={homeFlag || homeTeamId.slice(0, 2).toUpperCase()} /> {homeTeam?.shortName?.toUpperCase() ?? homeTeamId.toUpperCase()}</span>
          <strong>VS</strong>
          <span>{awayTeam?.shortName?.toUpperCase() ?? awayTeamId.toUpperCase()} <BattleFlag team={awayTeam} emoji={awayFlag || awayTeamId.slice(0, 2).toUpperCase()} /></span>
        </div>
        <div className="battle-draw__side-note">
          Tu joues <strong>{controlledTeam?.shortName?.toUpperCase() ?? controlledTeam?.name?.toUpperCase() ?? controlledTeamId.toUpperCase()}</strong>
        </div>

        {/* Casino cabinet — contained so lever never overflows */}
        <div className="battle-draw__cabinet-wrap">
          <div className={`battle-draw__cabinet${isDrawingRounds ? ' is-spinning' : ''}`}>
            {/* Gold marquee */}
            <div className="battle-draw__marquee">
              <div className="battle-draw__marquee-gloss" />
              <div className="battle-draw__marquee-title">Tirage du match</div>
            </div>

            {/* Bulb strip */}
            <div className="battle-draw__bulbs" aria-hidden="true">
              {(['gold','neon','gold','red','gold','neon'] as const).map((color, i) => (
                <i key={i} className={`battle-draw__bulb battle-draw__bulb--${color}`} style={{ animationDelay: `${i * 0.16}s` }} />
              ))}
            </div>

            {/* Reel assembly */}
            <div className="battle-draw__reels">
              <div className="battle-draw__reel-frame battle-draw__reel-frame--left" />
              <div className="battle-draw__reel-window" aria-label="Roulette des phases">
                {drawPreview.map((round, index) => {
                  const order: BattleRoundType[] = ['attack', 'defense', 'fruit_ninja']
                  const pos = order.indexOf(round)
                  const topType = order[(pos + 2) % 3]
                  const botType = order[(pos + 1) % 3]
                  const isSpin = isDrawingRounds && !drawLockedReels[index]
                  const isLocking = drawLockedReels[index] && isDrawingRounds
                  return (
                    <div key={index} className={`battle-draw__reel-col is-${ROUND_LABELS[round].tone}`}>
                      <div className={`battle-draw__reel-inner${isSpin ? ' is-spinning' : ''}${isLocking ? ' is-locking' : ''}`}>
                        <span className="battle-draw__reel-ghost">
                          <BattlePhaseIcon type={topType} />
                        </span>
                        <span className="battle-draw__reel-main">
                          <BattlePhaseIcon type={round} />
                        </span>
                        <span className="battle-draw__reel-ghost">
                          <BattlePhaseIcon type={botType} />
                        </span>
                      </div>
                    </div>
                  )
                })}
                <div className="battle-draw__reel-gradient" aria-hidden="true" />
                <div className="battle-draw__reel-payline" aria-hidden="true" />
              </div>
              <div className="battle-draw__reel-frame battle-draw__reel-frame--right" />
            </div>

            {/* Phase labels */}
            <div className="battle-draw__phase-labels">
              {drawPreview.map((round, index) => (
                <span key={index} className={`battle-draw__phase-label is-${ROUND_LABELS[round].tone}`}>
                  {ROUND_LABELS[round].label}
                </span>
              ))}
            </div>

            {/* Coin tray */}
            <div className="battle-draw__coin-tray" aria-hidden="true" />
          </div>

          {/* Chrome lever — positioned inside the wrap so it never overflows */}
          <div className="battle-draw__lever-mount" aria-hidden="true">
            <div className="battle-draw__lever-housing" />
            <div className="battle-draw__lever-bolt battle-draw__lever-bolt--top" />
            <div className="battle-draw__lever-bolt battle-draw__lever-bolt--bot" />
            <div className="battle-draw__lever-hub" />
            <div className="battle-draw__lever-center-bolt" />
            <button
              type="button"
              className="battle-draw__lever-btn"
              style={{
                transform: `rotate(${leverPulling ? 88 : 24}deg)`,
                transition: leverPulling ? 'transform .3s cubic-bezier(.2,.9,.2,1)' : 'transform .5s cubic-bezier(.3,1.3,.4,1)',
              }}
              onClick={() => launchRoundDraw()}
              disabled={isDrawingRounds || drawHasStarted}
              aria-label="Tirer le levier pour lancer le tirage"
            >
              <span className="battle-draw__lever-stick" />
              <span className="battle-draw__lever-ball" />
            </button>
          </div>
        </div>

        {/* Status hint */}
        {!drawHasStarted && !drawComplete ? (
          <div className="battle-draw__hint">
            Tire le levier pour lancer le tirage <span className="battle-draw__hint-arrow">→</span>
          </div>
        ) : null}
        {isDrawingRounds ? (
          <div className="battle-draw__spinning-label">Tirage en cours…</div>
        ) : null}
        {drawComplete && drawJackpot ? (
          <div className="battle-draw__jackpot" role="status">
            <strong>{drawResultMode === 'coin_flip' ? 'HASARD' : 'MORT SUBITE'}</strong>
            <span>{drawResultMode === 'coin_flip' ? '3 symboles ! Le coin decide le gagnant.' : "2 symboles ! Ouille, c'est la mort subite."}</span>
          </div>
        ) : null}
        {drawComplete && drawResultMode === 'normal' ? (
          <div className="battle-draw__order-note" role="status">{DRAW_ORDER_MESSAGES[state.rounds[0]]}</div>
        ) : null}

        {/* Actions after draw */}
        {drawComplete ? (
          <div className="battle-draw__actions">
            <button
              type="button"
              className="battle-draw__cta"
              onClick={() => {
                sfx.click()
                if (drawResultMode === 'coin_flip') {
                  setCoinFlipMode('simulation')
                  setState((current) => ({ ...current, phase: 'coin_flip' }))
                } else {
                  setState((current) => ({ ...current, phase: 'playing' }))
                }
              }}
            >
              {drawResultMode === 'coin_flip' ? 'Lancer le hasard' : drawResultMode === 'sudden_death' ? 'Jouer la mort subite' : 'Jouer ⚽'}
            </button>
            {drawResultMode !== 'normal' && !drawRerollUsed ? (
              <button type="button" className="battle-draw__reroll" onClick={rerollRoundDraw}>
                {drawResultMode === 'coin_flip' ? 'Relancer pour eviter le hasard' : 'Relancer pour eviter la mort subite'} <span>1/1</span>
              </button>
            ) : drawResultMode !== 'normal' ? (
              <div className="battle-draw__reroll-note">Relance utilisée</div>
            ) : null}
          </div>
        ) : null}
      </section> : null}

      {/* Round start */}
      {state.phase === 'round_start' ? <section className={`battle-round-start${suddenDeath ? ' is-sudden' : ''}`} key={state.roundIndex}>
        <div className="battle-round-start__card">
          <p>{commentaryData
            ? highlightPlayerName(commentaryData.text, commentaryData.tokens[0])
            : currentRound === 'attack'
              ? isCounterAttackRound
                ? previousRound?.type === 'fruit_ninja' ? <><b>Bravo !</b> Tu as bloqué tous les tirs. Tu gagnes un tir bonus !</> : <><b>Bravo !</b> Défense parfaite. Tu gagnes un tir bonus !</>
                : <><b>{roundStartCommentaryPlayer ?? homeTeam?.name ?? homeTeamId}</b> part en slalom - passe les portes vertes puis arme la frappe !</>
              : currentRound === 'defense'
                ? isSuddenGoalSave
                  ? <><b>{roundStartCommentaryPlayer ?? awayTeam?.name ?? awayTeamId}</b> frappe en mort subite. Ton gardien doit sortir le ballon !</>
                  : <><b>{roundStartCommentaryPlayer ?? awayTeam?.name ?? awayTeamId}</b> attaque en force - protège ta surface !</>
                : <><b>{awayAttackerName ?? awayTeam?.name ?? awayTeamId}</b> et ses partenaires preparent des grosses frappes. Ton gardien doit tenir face aux tirs massifs !</>}
          </p>
        </div>
        <svg className="battle-round-start__player" width="128" height="148" viewBox="0 0 128 148">
          <rect x="52" y="104" width="9" height="22" rx="4.5" fill="#f3c9a0"/><rect x="67" y="104" width="9" height="22" rx="4.5" fill="#f3c9a0"/>
          <rect x="52" y="118" width="9" height="9" rx="2" fill={roundStartPrimary}/>
          <rect x="67" y="118" width="9" height="9" rx="2" fill={roundStartPrimary}/>
          <path d="M50 126 h13 v6 q0 3 -3 3 h-14 q-2 0 -1 -3z" fill="#0b1422"/><path d="M65 126 h13 v6 q0 3 3 3 h11 q2 0 1 -3z" fill="#0b1422"/>
          <rect x="46" y="92" width="36" height="18" rx="5" fill={roundStartShorts} stroke={roundStartPrimary} strokeWidth="1.5"/>
          <path d="M42 64 q22 -10 44 0 l-3 32 q-19 6 -38 0 z" fill={roundStartPrimary}/>
          <path d="M56 58 v40 M72 58 v40" stroke={roundStartAccent} strokeWidth="3.5" opacity=".55"/>
          <text x="64" y="86" fontFamily="Barlow Condensed" fontWeight="900" fontSize="16" fill={roundStartText} textAnchor="middle">{roundStartPlayerNumber}</text>
          <rect x="35" y="66" width="8" height="22" rx="4" fill={roundStartPrimary}/>
          <rect x="85" y="66" width="8" height="22" rx="4" fill={roundStartPrimary}/>
          <circle cx="39" cy="90" r="4.5" fill="#f3c9a0"/><circle cx="89" cy="90" r="4.5" fill="#f3c9a0"/>
          <circle cx="64" cy="38" r="28" fill="#f3c9a0"/>
          <path d="M37 35 q3 -26 27 -26 q24 0 27 26 q-7 -12 -27 -12 q-20 0 -27 12z" fill="#3a2a1c"/>
          <circle cx="54" cy="39" r="4.2" fill="#1a1a1a"/><circle cx="74" cy="39" r="4.2" fill="#1a1a1a"/>
          <circle cx="55.5" cy="37.5" r="1.4" fill="#fff"/><circle cx="75.5" cy="37.5" r="1.4" fill="#fff"/>
          <circle cx="48" cy="47" r="3.4" fill="#ff8a8a" opacity=".55"/><circle cx="80" cy="47" r="3.4" fill="#ff8a8a" opacity=".55"/>
          <path d="M57 47 q7 7 14 0" stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
          <g transform="translate(98 130)"><circle r="13" fill="#f4f7ff" stroke="#0b1422" strokeWidth="1"/><path d="M0 -7 l6.7 4.9 -2.5 7.9 -8.4 0 -2.5 -7.9z" fill="#0b1422"/></g>
        </svg>
        <button type="button" className="battle-round-start__ready" onClick={() => { sfx.click(); startRoundCountdown() }}>
          {currentRound === 'attack' ? isCounterAttackRound ? 'Prêt ? Tir bonus ! >' : "Prêt ? Joue l'attaque >" : currentRound === 'defense' ? isSuddenGoalSave ? 'Prêt ? Goal save ! >' : 'Prêt ? Défends ! >' : 'Prêt ? Tirs massifs ! >'}
        </button>
      </section> : null}

      {/* Game phases */}
      {/* Show during countdown too so the player can preview the game layout */}
      {(state.phase === 'playing' || state.phase === 'countdown') && currentRound === 'attack' && !suddenDeath
        ? <AttackPhase key={`attack-${state.roundIndex}-${state.difficulty}`} difficulty={state.difficulty} homeTeamId={homeTeamId} awayTeamId={awayTeamId} homeTeamPlayers={homeRoles.attackers} homeTeamPlayerNumbers={homeTeam?.playerNumbers} awayTeamPlayers={awayRoles.defenders} playerKit={homeKit} opponentKit={awayKit} onRoundEnd={handleAttackEnd} isPaused={isPaused || state.phase === 'countdown'} onAudioOverride={setAudioOverride} showControls={showControls} shotOnly={isCounterAttackRound || retryShotOnly} shotAudioMode={isCounterAttackRound ? 'heartOnly' : undefined} shotTitle={isCounterAttackRound ? 'TIR BONUS' : retryShotOnly ? 'PHASE DE TIR' : undefined} roundIntroComment={isCounterAttackRound ? (previousRound?.type === 'fruit_ninja' ? 'Bravo ! Tu as bloqué tous les tirs. Tu gagnes un tir bonus.' : 'Bravo ! Défense parfaite. Tu gagnes un tir bonus.') : undefined} />
        : null}
      {state.phase === 'playing' && currentRound === 'attack' && suddenDeath
        ? <AttackPhase
            key={`sudden-shot-${state.roundIndex}-${state.difficulty}`}
            difficulty={state.difficulty}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamPlayers={homeRoles.attackers}
            homeTeamPlayerNumbers={homeTeam?.playerNumbers}
            awayTeamPlayers={awayRoles.defenders}
            playerKit={homeKit}
            opponentKit={awayKit}
            onRoundEnd={handleAttackEnd}
            isPaused={isPaused}
            onAudioOverride={setAudioOverride}
            shotOnly
            shotAudioMode="heartOnly"
            shotTitle="TIR DE MORT SUBITE"
            showControls={showControls}
          />
        : null}
      {(state.phase === 'playing' || state.phase === 'countdown') && currentRound === 'defense' && !suddenDeath
        ? <DefensePhase key={`defense-${state.roundIndex}-${state.difficulty}`} difficulty={state.difficulty} homeTeamId={homeTeamId} awayTeamId={awayTeamId} playerKit={homeKit} opponentKit={awayKit} awayTeamPlayers={awayRoles.attackers} defenderName={homeDefenderName} keeperName={homeKeeperName} onRoundEnd={handleDefenseEnd} isPaused={isPaused || state.phase === 'countdown'} onAudioOverride={setAudioOverride} showControls={showControls} roundIntroComment={isSuddenGoalSave ? 'Mort subite : ton gardien doit sortir le ballon.' : `${roundStartCommentaryPlayer ?? awayTeam?.name ?? awayTeamId} attaque en force. Protège ta surface !`} />
        : null}
      {state.phase === 'playing' && currentRound === 'defense' && suddenDeath
        ? <GoalSave
            key={`sudden-goal-save-${state.roundIndex}-${state.difficulty}`}
            ballCount={1}
            difficulty={state.difficulty}
            playerKit={homeKit}
            opponentKit={awayKit}
            opponentName={awayAttackerName ?? awayTeam?.name}
            opponentFlag={awayFlag}
            keeperName={homeKeeperName}
            mode="sudden_death"
            onAudioOverride={setAudioOverride}
            onResult={handleSuddenGoalSaveEnd}
          />
        : null}
      {state.phase === 'interception_goal_save'
        ? <GoalSave
            key={`interception-goal-save-${state.roundIndex}-${state.difficulty}`}
            ballCount={1}
            difficulty={state.difficulty}
            playerKit={homeKit}
            opponentKit={awayKit}
            opponentName={roundScorer?.name ?? awayAttackerName ?? awayTeam?.name}
            opponentFlag={awayFlag}
            keeperName={homeKeeperName}
            mode="goal_save"
            onAudioOverride={setAudioOverride}
            roundIntroComment={`Mince, tu t'es fait prendre la balle par ${roundScorer?.name ?? awayAttackerName ?? awayTeam?.name ?? awayTeamId}. Il arme sa frappe. Donne tout pour bloquer.`}
            onRetry={allowRetry && retrySnapshot ? handleRetryRound : undefined}
            retryLabel="Réessayer l'attaque"
            startLabel="Bloquer le tir"
            onResult={handleInterceptionGoalSaveEnd}
          />
        : null}
      {(state.phase === 'playing' || state.phase === 'countdown') && currentRound === 'fruit_ninja'
        ? <FruitNinjaPhase
            key={`ninja-${state.roundIndex}-${state.difficulty}`}
            attackersInZone={2}
            difficulty={state.difficulty}
            onResult={handleFruitNinjaEnd}
            isPaused={isPaused || state.phase === 'countdown'}
            homeTeam={homeTeam}
            keeperName={homeKeeperName}
            opponentKit={awayKit}
            onAudioOverride={setAudioOverride}
            roundIntroComment={`${awayAttackerName ?? awayTeam?.name ?? awayTeamId} prépare des grosses frappes. Ton gardien doit tenir face aux tirs massifs !`}
          />
        : null}

      {state.phase === 'round_result' ? (
        <RoundResult
          outcome={roundOutcome}
          roundType={displayedRoundType}
          playerScore={state.playerScore}
          opponentScore={state.opponentScore}
          homeFlag={homeFlag}
          awayFlag={awayFlag}
          scorerName={roundOutcome === 'intercepted' ? roundScorer?.name : displayedRoundType === 'attack' ? roundScorer?.name ?? homeAttackerName : undefined}
          keeperName={displayedRoundType === 'defense' || displayedRoundType === 'fruit_ninja' ? homeKeeperName : awayKeeperName}
          playerKit={homeKit}
          opponentName={awayTeam?.name}
          nextRoundType={nextRoundType}
          onContinue={roundOutcome === 'intercepted' ? handleStartInterceptionGoalSave : () => { sfx.click(); advanceRound() }}
          onRetry={allowRetry && retrySnapshot ? handleRetryRound : undefined}
        />
      ) : null}
      {state.phase === 'coin_flip' ? (
        <CoinFlip
          homeTeamId={homeTeamId}
          awayTeamId={awayTeamId}
          homeTeamName={homeTeam?.name ?? homeTeamId}
          awayTeamName={awayTeam?.name ?? awayTeamId}
          homeFlag={homeFlag || homeTeam?.shortName?.slice(0, 2).toUpperCase() || homeTeamId.slice(0, 2).toUpperCase()}
          awayFlag={awayFlag || awayTeam?.shortName?.slice(0, 2).toUpperCase() || awayTeamId.slice(0, 2).toUpperCase()}
          mode={coinFlipMode}
          onComplete={(winnerId, score, commentary) => { sfx.click(); handleCoinFlipEnd(winnerId, score, commentary) }}
        />
      ) : null}
      {state.phase === 'match_result' ? <MatchResult result={displayedResult} playerWon={displayedResult.winnerId === homeTeamId} homeTeamId={homeTeamId} awayTeamId={awayTeamId} homeTeamName={homeTeam?.name} awayTeamName={awayTeam?.name} homeFlag={homeFlag} awayFlag={awayFlag} ownerPseudo={ownerPseudo} difficulty={existingResult ? existingResult.difficulty : displayedResult.difficulty ?? state.difficulty} onContinue={() => { sfx.click(); existingResult ? onQuit?.() : onComplete(displayedResult) }} onRestart={handleRestart} /> : null}

      {/* Countdown overlay */}
      {state.phase === 'countdown' && countdownNum !== null ? (
        <div className="battle-countdown" aria-live="polite">
          <div key={countdownNum} className={`battle-countdown__circle${countdownNum === 0 ? ' is-go' : ''}`} style={{ '--countdown-progress': countdownProgress } as CSSProperties & Record<'--countdown-progress', string>}>
            <span key={countdownNum}>{countdownNum === 0 ? 'GO' : countdownNum}</span>
          </div>
        </div>
      ) : null}

      {/* Pause button */}
      {state.phase !== 'match_result' && !isPaused ? (
        <button
          type="button"
          className="battle-pause-btn"
          onClick={() => { sfx.click(); setIsPaused(true) }}
          aria-label="Menu"
        >
          <span className="battle-pause-btn__icon" aria-hidden="true"><i /></span>
          <span>Menu</span>
        </button>
      ) : null}

      {/* Pause modal */}
      {isPaused ? (
        <div className="battle-pause-modal">
          <div className="battle-pause-modal__inner">
            <div className="battle-pause-modal__title">PAUSE</div>
            <button type="button" className="battle-pause-modal__btn battle-pause-modal__btn--resume" onClick={() => { sfx.click(); setIsPaused(false) }}>
              Reprendre
            </button>
            <button type="button" className={`battle-pause-modal__btn battle-pause-modal__btn--sound${audioMuted ? ' is-muted' : ''}`} onClick={() => { sfx.click(); setGameMuted(!audioMuted) }}>
              {audioMuted ? 'Activer le son' : 'Mute le jeu'}
            </button>
            <label className="battle-pause-modal__volume">
              <span>Volume</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(audioVolume * 100)}
                onChange={(event) => setGameAudioVolume(Number(event.currentTarget.value) / 100)}
              />
              <strong>{Math.round(audioVolume * 100)}</strong>
            </label>
            <div className="battle-pause-modal__difficulty" aria-label="R?glage difficult?">
              <span>Difficulte</span>
              <strong>{difficultySettingLabel(difficultySetting, match.stage)}</strong>
              <div>
                {(['auto', 'easy', 'medium', 'hard'] as BattleDifficultySetting[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={difficultySetting === option ? 'is-active' : ''}
                    onClick={() => { sfx.click(); onDifficultyChange?.(option) }}
                  >
                    {option === 'auto' ? 'AUTO' : DIFFICULTY_META[option].short}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="battle-pause-modal__btn" onClick={handleRestart}>
              Recommencer
            </button>
            {onQuit && (
              <button type="button" className="battle-pause-modal__btn battle-pause-modal__btn--quit" onClick={() => { sfx.click(); setIsPaused(false); onQuit() }}>
                Quitter
              </button>
            )}
          </div>
        </div>
      ) : null}

    </div>
    </>
  )
}

export default BattleEngine
