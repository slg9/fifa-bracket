import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { BattleMatchState, BattleResult, BattleRoundType, DefenseOutcome, KnockoutMatch, Team } from '../../types'
import { getCommentary } from '../../lib/commentary'
import { playGameSound, setGameMuted, useGameAudio, useGameMuted } from '../../lib/useGameAudio'
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
}

function highlightPlayerName(text: string, playerName: string): ReactNode {
  if (!playerName || !text.includes(playerName)) return text
  const idx = text.indexOf(playerName)
  return <>{text.slice(0, idx)}<b style={{ color: '#2bff9a', fontStyle: 'normal' }}>{playerName}</b>{text.slice(idx + playerName.length)}</>
}

function pickPlayer(players: string[] | undefined, start: number, fallback?: string) {
  if (!players?.length) return fallback
  const index = Math.min(start, players.length - 1)
  return players[index] ?? fallback
}

function pickDefender(players: string[] | undefined, fallback?: string) {
  if (!players?.length) return fallback
  const pool = players.slice(1, Math.min(players.length, 5))
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : players[0]
}

type NextAction = { type: 'next'; append?: BattleRoundType } | { type: 'finish' } | { type: 'coin_flip' }

const STANDARD_ROUNDS: BattleRoundType[] = ['attack', 'defense', 'fruit_ninja', 'attack', 'defense', 'fruit_ninja']
const MAX_SUDDEN_DEATH_ROUNDS = 4 // 2 full attack+defense cycles before forcing a result

const ROUND_LABELS: Record<BattleRoundType, { short: string; label: string }> = {
  attack: { short: 'ATT', label: 'Attaque' },
  defense: { short: 'DEF', label: 'Defense' },
  fruit_ninja: { short: 'TM', label: 'Tirs massifs' },
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

function makeInitialState(homeTeamId: string, awayTeamId: string, stage: string, skipIntro: boolean): BattleMatchState {
  return {
    roundIndex: 0,
    rounds: [...STANDARD_ROUNDS],
    playerScore: 0,
    opponentScore: 0,
    phase: skipIntro ? 'round_start' : 'intro',
    difficulty: difficultyForStage(stage),
    homeTeamId,
    awayTeamId,
  }
}

function roundProgressMeta(round: BattleRoundType, absoluteIndex: number) {
  if (absoluteIndex >= STANDARD_ROUNDS.length && round === 'defense') return { short: 'GS', label: 'Goal save' }
  return ROUND_LABELS[round]
}

function BattleProgressRail({ rounds, currentIndex, phase }: { rounds: BattleRoundType[]; currentIndex: number; phase: string }) {
  const suddenDeath = currentIndex >= STANDARD_ROUNDS.length
  const visibleStart = suddenDeath ? STANDARD_ROUNDS.length : 0
  const visibleRounds = suddenDeath ? (['attack', 'defense', 'attack', 'defense'] as BattleRoundType[]) : rounds.slice(0, STANDARD_ROUNDS.length)
  const activeVisibleIndex = currentIndex - visibleStart
  const progressLabel = suddenDeath ? 'Mort subite' : `Phase ${Math.min(currentIndex + 1, STANDARD_ROUNDS.length)}/${STANDARD_ROUNDS.length}`

  return (
    <div className={`battle-progress-rail${suddenDeath ? ' is-sudden' : ''}`} aria-label={progressLabel}>
      <div className="battle-progress-rail__title">{suddenDeath ? 'MS' : 'MATCH'}</div>
      <div className="battle-progress-rail__steps">
        {visibleRounds.map((round, index) => {
          const absoluteIndex = visibleStart + index
          const isDone = absoluteIndex < currentIndex || phase === 'round_result' && absoluteIndex === currentIndex
          const isActive = index === activeVisibleIndex && phase !== 'round_result'
          const meta = roundProgressMeta(round, absoluteIndex)
          return (
            <div
              key={`${absoluteIndex}-${round}`}
              className={`battle-progress-step${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}
              title={`${absoluteIndex + 1}. ${meta.label}`}
            >
              <span>{meta.short}</span>
              <i />
            </div>
          )
        })}
      </div>
      <div className="battle-progress-rail__meta">{suddenDeath ? `${Math.min(Math.max(activeVisibleIndex + 1, 1), MAX_SUDDEN_DEATH_ROUNDS)}/${MAX_SUDDEN_DEATH_ROUNDS}` : `${currentIndex + 1}/${STANDARD_ROUNDS.length}`}</div>
    </div>
  )
}

type SuddenAttempt = 'pending' | 'active' | 'goal' | 'miss'

function SuddenDeathShootout({ history, currentIndex, currentRound, phase }: { history: BattleResult['rounds']; currentIndex: number; currentRound: BattleRoundType; phase: string }) {
  const suddenHistory = history.slice(STANDARD_ROUNDS.length, STANDARD_ROUNDS.length + MAX_SUDDEN_DEATH_ROUNDS)
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

  if (currentIndex >= STANDARD_ROUNDS.length && phase !== 'round_result') {
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

export function BattleEngine({ match, teamsById, onComplete, onQuit, playerSide, showControls = false }: BattleEngineProps) {
  const rawHomeId = entrantId(match, 'home')
  const rawAwayId = entrantId(match, 'away')
  const homeTeamId = playerSide === 'away' ? rawAwayId : rawHomeId
  const awayTeamId = playerSide === 'away' ? rawHomeId : rawAwayId
  const homeTeam = teamsById.get(homeTeamId)
  const awayTeam = teamsById.get(awayTeamId)
  const homeFlag = homeTeam?.flagEmoji ?? ''
  const awayFlag = awayTeam?.flagEmoji ?? ''
  const homeKit = useMemo(() => resolveTeamKit(homeTeam, homeTeamId), [homeTeam, homeTeamId])
  const awayKit = useMemo(() => resolveTeamKit(awayTeam, awayTeamId), [awayTeam, awayTeamId])
  const skipIntro = playerSide != null
  const skipScreens = false

  const [state, setState] = useState<BattleMatchState>(() => makeInitialState(homeTeamId, awayTeamId, match.stage, skipIntro))
  const [history, setHistory] = useState<BattleResult['rounds']>([])
  const [roundOutcome, setRoundOutcome] = useState<RoundOutcome>('miss')
  const [nextAction, setNextAction] = useState<NextAction | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [countdownNum, setCountdownNum] = useState<number | null>(null)
  const [audioOverride, setAudioOverride] = useState<string | null>(null)
  const [coinFlipWinnerId, setCoinFlipWinnerId] = useState<string | null>(null)
  const [coinFlipMode, setCoinFlipMode] = useState<'sudden_death' | 'simulation'>('sudden_death')
  const [simulatedResult, setSimulatedResult] = useState<BattleResult | null>(null)
  const audioMuted = useGameMuted()

  // Pick stable player names for this match (avoid re-computing each render)
  const homeAttackerName = useMemo(() => {
    const players = homeTeam?.players
    if (!players?.length) return undefined
    return players[Math.floor(Math.random() * Math.min(players.length, 5))]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeTeamId])
  const awayAttackerName = useMemo(() => {
    const players = awayTeam?.players
    if (!players?.length) return undefined
    return players[Math.floor(Math.random() * Math.min(players.length, 5))]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awayTeamId])
  const homeDefenderName = useMemo(() => pickDefender(homeTeam?.players, homeTeam?.shortName ? `${homeTeam.shortName} DEF` : undefined), [homeTeam?.players, homeTeam?.shortName])
  const homeKeeperName = pickPlayer(homeTeam?.players, 0, homeTeam?.shortName ? `${homeTeam.shortName} GK` : undefined)
  const awayKeeperName = pickPlayer(awayTeam?.players, 0, awayTeam?.shortName ? `${awayTeam.shortName} GK` : undefined)

  const currentRound = state.rounds[state.roundIndex]
  const suddenDeath = state.roundIndex >= STANDARD_ROUNDS.length
  const isSuddenGoalSave = suddenDeath && currentRound === 'defense'
  const roundStartPlayerNumber = currentRound === 'attack' ? '9' : currentRound === 'defense' ? '10' : '1'
  const roundStartPlayerName = currentRound === 'attack' ? homeAttackerName : currentRound === 'defense' ? awayAttackerName : awayKeeperName
  const roundStartCommentaryPlayer = roundStartPlayerName ? `${roundStartPlayerName} #${roundStartPlayerNumber}` : undefined
  const result = useMemo<BattleResult>(() => ({
    homeScore: state.playerScore,
    awayScore: state.opponentScore,
    winnerId: coinFlipWinnerId ?? (state.playerScore > state.opponentScore ? homeTeamId : awayTeamId),
    playerScore: state.playerScore,
    rounds: history,
  }), [awayTeamId, coinFlipWinnerId, history, homeTeamId, state.opponentScore, state.playerScore])
  const displayedResult = simulatedResult ?? result
  const countdownProgress = countdownNum === 3 ? '100%' : countdownNum === 2 ? '66%' : countdownNum === 1 ? '33%' : '100%'

  const startRoundCountdown = () => {
    // Pre-battle already gives the instructions; avoid phase-level tutorial countdowns.
    sessionStorage.setItem('brakup:tut:atk2', '1')
    sessionStorage.setItem('brakup:tut:def', '1')
    sessionStorage.setItem('brakup:tut:ninja', '1')
    setState((current) => ({ ...current, phase: 'countdown' }))
  }

  // Audio
  const playerWon = result.winnerId === homeTeamId
  const baseAudioSrc = (() => {
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

  const commentaryData = useMemo(() => {
    if (!homeTeam || !awayTeam) return null
    if (currentRound === 'fruit_ninja') return null
    const phase = currentRound === 'attack' ? 'pre_attack' : 'pre_defense'
    const team = homeTeam
    const opponent = awayTeam
    return getCommentary(phase, team, opponent, roundStartCommentaryPlayer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, currentRound, roundStartCommentaryPlayer])

  // Countdown 3-2-1-GO
  useEffect(() => {
    if (state.phase !== 'countdown') return
    setCountdownNum(3)
    const t1 = setTimeout(() => setCountdownNum(2), 900)
    const t2 = setTimeout(() => setCountdownNum(1), 1800)
    const t3 = setTimeout(() => setCountdownNum(0), 2700)   // 0 = "GO!"
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
      setState((current) => ({
        ...current,
        rounds: nextAction.append ? [...current.rounds, nextAction.append] : current.rounds,
        roundIndex: current.roundIndex + 1,
        phase: skipScreens ? 'countdown' : 'round_start',
      }))
    }
    setNextAction(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextAction, skipScreens])

  // Round result to next round / finish
  useEffect(() => {
    if (state.phase !== 'round_result' || !nextAction || roundResultNeedsClick(roundOutcome)) return
    const timer = window.setTimeout(advanceRound, 2000)
    return () => window.clearTimeout(timer)
  }, [advanceRound, nextAction, roundOutcome, state.phase])

  const completeRound = (success: boolean, isGoal: boolean, outcome: RoundOutcome) => {
    const isOpponentScoringRound = currentRound === 'defense' || currentRound === 'fruit_ninja'
    const nextPlayerScore = state.playerScore + Number(currentRound === 'attack' && isGoal)
    const nextOpponentScore = state.opponentScore + Number(isOpponentScoringRound && isGoal)
    const nextHistory = [...history, { type: currentRound, success, isGoal }]
    let action: NextAction

    if (!suddenDeath && state.roundIndex < STANDARD_ROUNDS.length - 1) {
      action = { type: 'next' }
    } else if (!suddenDeath) {
      action = nextPlayerScore === nextOpponentScore ? { type: 'next', append: 'attack' } : { type: 'finish' }
    } else {
      const suddenDeathCompleted = state.roundIndex - STANDARD_ROUNDS.length + 1
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

    setHistory(nextHistory)
    setRoundOutcome(outcome)
    setNextAction(action)
    setState((current) => ({ ...current, playerScore: nextPlayerScore, opponentScore: nextOpponentScore, phase: 'round_result' }))
  }

  const handleAttackEnd = (isGoal: boolean, reason: AttackEndReason = isGoal ? 'goal' : 'miss') => {
    const outcome: RoundOutcome = isGoal ? 'goal' : reason === 'intercepted' ? 'intercepted' : 'miss'
    if (isGoal) {
      playGameSound('/audio/goal.mp3', { volume: 1 })
      sfx.goal()
    } else {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
    }
    completeRound(isGoal, isGoal, outcome)
  }

  const handleDefenseEnd = (outcome: DefenseOutcome) => {
    if (outcome.path === 'space_invaders') {
      const success = outcome.blocked === outcome.total
      if (!success) {
        playGameSound('/audio/sad.mp3', { volume: 0.95 })
        sfx.concede()
      }
      completeRound(success, !success, success ? 'defense_perfect' : 'goal_conceded')
      return
    }
    if (!outcome.saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }
    completeRound(outcome.saved, !outcome.saved, outcome.saved ? 'saved' : 'goal_conceded')
  }

  const handleSuddenGoalSaveEnd = (saved: boolean) => {
    if (!saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }
    completeRound(saved, !saved, saved ? 'saved' : 'goal_conceded')
  }

  const handleFruitNinjaEnd = (saved: boolean) => {
    if (!saved) {
      playGameSound('/audio/sad.mp3', { volume: 0.95 })
      sfx.concede()
    }
    completeRound(saved, !saved, saved ? 'defense_perfect' : 'goal_conceded')
  }

  const handleCoinFlipEnd = (winnerId: string, score?: { home: number; away: number }, commentary?: string) => {
    setCoinFlipWinnerId(winnerId)
    if (coinFlipMode === 'simulation' && score) {
      setSimulatedResult({
        homeScore: score.home,
        awayScore: score.away,
        winnerId,
        playerScore: score.home,
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
    ? (nextAction.append ?? state.rounds[state.roundIndex + 1] ?? null)
    : null
  const roundStartKit = currentRound === 'attack' ? homeKit : awayKit
  const roundStartAccent = roundStartKit.secondary ?? '#0b1422'
  const roundStartShorts = roundStartKit.shorts ?? '#101a2c'
  const roundStartText = roundStartKit.text ?? '#0b1422'
  const roundStartPrimary = roundStartKit.primary ?? (currentRound === 'attack' ? '#2bff9a' : '#FF4455')

  const handleRestart = () => {
    setIsPaused(false)
    setHistory([])
    setNextAction(null)
    setRoundOutcome('miss')
    setCoinFlipWinnerId(null)
    setSimulatedResult(null)
    setCoinFlipMode('sudden_death')
    setState(makeInitialState(homeTeamId, awayTeamId, match.stage, skipIntro))
  }


  return (
    <>
    <div className="battle-desktop-bg" aria-hidden="true" />
    <div className="battle-engine" role="dialog" aria-modal="true" aria-label={`Combat ${match.label}`} onContextMenu={(e) => e.preventDefault()}>

      {/* Persistent score pill: same compact format as the pre-battle screen */}
      {state.phase !== 'intro' && state.phase !== 'match_result' ? (
        <>
        <div className="battle-score-strip battle-score-pill" aria-label="Score">
          <span className="battle-score-strip__flag">{homeFlag || homeTeam?.shortName?.slice(0, 2).toUpperCase() || homeTeamId.slice(0, 2).toUpperCase()}</span>
          <strong>{state.playerScore}</strong>
          <em>-</em>
          <strong>{state.opponentScore}</strong>
          <span className="battle-score-strip__flag">{awayFlag || awayTeam?.shortName?.slice(0, 2).toUpperCase() || awayTeamId.slice(0, 2).toUpperCase()}</span>
        </div>
        {suddenDeath ? <SuddenDeathShootout history={history} currentIndex={state.roundIndex} currentRound={currentRound} phase={state.phase} /> : <BattleProgressRail rounds={state.rounds} currentIndex={state.roundIndex} phase={state.phase} />}
        </>
      ) : null}

      {/* Intro */}
      {state.phase === 'intro' ? <section className="battle-intro">
        <div className="battle-intro__meta">{match.stage} - {match.label} - {match.dateLabel}</div>
        <div className="battle-intro__matchup">
          <div className="battle-intro__team">
            <div className="battle-intro__badge is-home">{homeFlag ? <span style={{ fontSize: 36 }}>{homeFlag}</span> : (homeTeam?.shortName?.toUpperCase() ?? rawHomeId.slice(0, 3).toUpperCase())}</div>
            <strong>{homeTeam?.shortName?.toUpperCase() ?? rawHomeId.toUpperCase()}</strong>
          </div>
          <div className="battle-intro__vs">VS</div>
          <div className="battle-intro__team is-away">
            <div className="battle-intro__badge">{awayFlag ? <span style={{ fontSize: 36 }}>{awayFlag}</span> : (awayTeam?.shortName?.toUpperCase() ?? rawAwayId.slice(0, 3).toUpperCase())}</div>
            <strong>{awayTeam?.shortName?.toUpperCase() ?? rawAwayId.toUpperCase()}</strong>
          </div>
        </div>
        <div className="battle-intro__spacer" />
        <div className="battle-intro__sequence">
          {STANDARD_ROUNDS.map((round, index) => (
            <div key={index}>
              <b>{round === 'fruit_ninja' ? 'TM' : round === 'attack' ? 'ATT' : 'DEF'}</b>
              <small>{round === 'fruit_ninja' ? 'TIRS' : round === 'attack' ? 'ATT' : 'DEF'}</small>
            </div>
          ))}
        </div>
        <div className="battle-intro__actions">
          <button type="button" className="battle-intro__cta" onClick={() => { sfx.battle(); startRoundCountdown() }}>
            Jouer ce match
          </button>
          <button type="button" className="battle-intro__simulate" onClick={() => { sfx.click(); setCoinFlipMode('simulation'); setState((current) => ({ ...current, phase: 'coin_flip' })) }}>
            Simuler
          </button>
        </div>
      </section> : null}

      {/* Round start */}
      {state.phase === 'round_start' ? <section className="battle-round-start" key={state.roundIndex}>
        <div className="battle-round-start__card">
          <p>{commentaryData
            ? highlightPlayerName(commentaryData.text, commentaryData.tokens[0])
            : currentRound === 'attack'
              ? <><b>{roundStartCommentaryPlayer ?? homeTeam?.name ?? homeTeamId}</b> part en slalom - passe les portes vertes puis arme la frappe !</>
              : currentRound === 'defense'
                ? isSuddenGoalSave
                  ? <><b>{roundStartCommentaryPlayer ?? awayTeam?.name ?? awayTeamId}</b> frappe en mort subite. Ton gardien doit sortir le ballon !</>
                  : <><b>{roundStartCommentaryPlayer ?? awayTeam?.name ?? awayTeamId}</b> attaque en force - protege ta surface !</>
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
          {currentRound === 'attack' ? "Pret ? Joue l'attaque >" : currentRound === 'defense' ? isSuddenGoalSave ? 'Pret ? Goal save ! >' : 'Pret ? Defends ! >' : 'Pret ? Tirs massifs ! >'}
        </button>
      </section> : null}

      {/* Game phases */}
      {/* Show during countdown too so the player can preview the game layout */}
      {(state.phase === 'playing' || state.phase === 'countdown') && currentRound === 'attack' && !suddenDeath
        ? <AttackPhase key={`attack-${state.roundIndex}`} difficulty={state.difficulty} homeTeamId={homeTeamId} awayTeamId={awayTeamId} homeTeamPlayers={homeTeam?.players} awayTeamPlayers={awayTeam?.players} playerKit={homeKit} opponentKit={awayKit} onRoundEnd={handleAttackEnd} isPaused={isPaused || state.phase === 'countdown'} onAudioOverride={setAudioOverride} showControls={showControls} />
        : null}
      {state.phase === 'playing' && currentRound === 'attack' && suddenDeath
        ? <AttackPhase
            key={`sudden-shot-${state.roundIndex}`}
            difficulty={state.difficulty}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamPlayers={homeTeam?.players}
            awayTeamPlayers={awayTeam?.players}
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
        ? <DefensePhase key={`defense-${state.roundIndex}`} difficulty={state.difficulty} homeTeamId={homeTeamId} awayTeamId={awayTeamId} playerKit={homeKit} opponentKit={awayKit} awayTeamPlayers={awayTeam?.players} defenderName={homeDefenderName} keeperName={homeKeeperName} onRoundEnd={handleDefenseEnd} isPaused={isPaused || state.phase === 'countdown'} onAudioOverride={setAudioOverride} showControls={showControls} />
        : null}
      {state.phase === 'playing' && currentRound === 'defense' && suddenDeath
        ? <GoalSave
            key={`sudden-goal-save-${state.roundIndex}`}
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
      {(state.phase === 'playing' || state.phase === 'countdown') && currentRound === 'fruit_ninja'
        ? <FruitNinjaPhase
            key={`ninja-${state.roundIndex}`}
            attackersInZone={2}
            difficulty={state.difficulty}
            onResult={handleFruitNinjaEnd}
            isPaused={isPaused || state.phase === 'countdown'}
            homeTeam={homeTeam}
            keeperName={homeKeeperName}
            opponentKit={awayKit}
            onAudioOverride={setAudioOverride}
          />
        : null}

      {state.phase === 'round_result' ? (
        <RoundResult
          outcome={roundOutcome}
          roundType={currentRound}
          playerScore={state.playerScore}
          opponentScore={state.opponentScore}
          homeFlag={homeFlag}
          awayFlag={awayFlag}
          scorerName={currentRound === 'attack' ? homeAttackerName : undefined}
          keeperName={currentRound === 'defense' || currentRound === 'fruit_ninja' ? homeKeeperName : awayKeeperName}
          opponentName={awayTeam?.name}
          nextRoundType={nextRoundType}
          onContinue={advanceRound}
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
          onComplete={handleCoinFlipEnd}
        />
      ) : null}
      {state.phase === 'match_result' ? <MatchResult result={displayedResult} playerWon={displayedResult.winnerId === homeTeamId} homeTeamId={homeTeamId} awayTeamId={awayTeamId} homeTeamName={homeTeam?.name} awayTeamName={awayTeam?.name} homeFlag={homeFlag} awayFlag={awayFlag} onContinue={() => onComplete(displayedResult)} /> : null}

      {/* Countdown overlay */}
      {state.phase === 'countdown' && countdownNum !== null ? (
        <div className="battle-countdown" aria-live="polite">
          <div className={`battle-countdown__circle${countdownNum === 0 ? ' is-go' : ''}`} style={{ '--countdown-progress': countdownProgress } as CSSProperties & Record<'--countdown-progress', string>}>
            <span>{countdownNum === 0 ? 'GO' : countdownNum}</span>
          </div>
        </div>
      ) : null}

      {/* Pause button (visible during playing) */}
      {state.phase === 'playing' && !isPaused ? (
        <button
          type="button"
          className="battle-pause-btn"
          onClick={() => setIsPaused(true)}
          aria-label="Pause"
        >⏸</button>
      ) : null}

      {/* Pause modal */}
      {isPaused ? (
        <div className="battle-pause-modal">
          <div className="battle-pause-modal__inner">
            <div className="battle-pause-modal__title">PAUSE</div>
            <button type="button" className="battle-pause-modal__btn battle-pause-modal__btn--resume" onClick={() => setIsPaused(false)}>
              Reprendre
            </button>
            <button type="button" className={`battle-pause-modal__btn battle-pause-modal__btn--sound${audioMuted ? ' is-muted' : ''}`} onClick={() => setGameMuted(!audioMuted)}>
              {audioMuted ? 'Activer le son' : 'Mute le jeu'}
            </button>
            <button type="button" className="battle-pause-modal__btn" onClick={handleRestart}>
              Recommencer
            </button>
            {onQuit && (
              <button type="button" className="battle-pause-modal__btn battle-pause-modal__btn--quit" onClick={() => { setIsPaused(false); onQuit() }}>
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
