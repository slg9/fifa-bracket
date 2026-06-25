import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BattleMatchState, BattleResult, BattleRoundType, DefenseOutcome, KnockoutMatch, Team } from '../../types'
import { getCommentary } from '../../lib/commentary'
import { useGameAudio } from '../../lib/useGameAudio'
import { sfx } from '../../lib/sfx'
import AttackPhase, { type AttackEndReason } from './AttackPhase'
import { difficultyForStage } from './config'
import DefensePhase from './DefensePhase'
import MatchResult from './MatchResult'
import RoundResult, { type RoundOutcome } from './RoundResult'
import './battle.css'

const AUDIO = {
  kickoff:  '/audio/kickoff-carnival.mp3',
  attack:   '/audio/clutch-chance.mp3',
  defense:  '/audio/goal-line-panic.mp3',
  victory:  '/audio/cup-victory-parade.mp3',
  defeat:   '/audio/final-whistle-fumble.mp3',
} as const

type BattleEngineProps = {
  match: KnockoutMatch
  teamsById: Map<string, Team>
  onComplete: (result: BattleResult) => void
  onQuit?: () => void
  playerSide?: 'home' | 'away'
}

function highlightPlayerName(text: string, playerName: string): ReactNode {
  if (!playerName || !text.includes(playerName)) return text
  const idx = text.indexOf(playerName)
  return <>{text.slice(0, idx)}<b style={{ color: '#2bff9a', fontStyle: 'normal' }}>{playerName}</b>{text.slice(idx + playerName.length)}</>
}

type NextAction = { type: 'next'; append?: BattleRoundType } | { type: 'finish' }

const STANDARD_ROUNDS: BattleRoundType[] = ['attack', 'defense', 'attack', 'defense', 'attack']

function entrantId(match: KnockoutMatch, side: 'home' | 'away') {
  const entrant = match[side]
  return entrant.kind === 'team' ? entrant.teamId : side
}

function makeInitialState(homeTeamId: string, awayTeamId: string, stage: string, skipScreens: boolean): BattleMatchState {
  return {
    roundIndex: 0,
    rounds: [...STANDARD_ROUNDS],
    playerScore: 0,
    opponentScore: 0,
    phase: skipScreens ? 'countdown' : 'intro',
    difficulty: difficultyForStage(stage),
    homeTeamId,
    awayTeamId,
  }
}

export function BattleEngine({ match, teamsById, onComplete, onQuit, playerSide }: BattleEngineProps) {
  const rawHomeId = entrantId(match, 'home')
  const rawAwayId = entrantId(match, 'away')
  const homeTeamId = playerSide === 'away' ? rawAwayId : rawHomeId
  const awayTeamId = playerSide === 'away' ? rawHomeId : rawAwayId
  const homeTeam = teamsById.get(homeTeamId)
  const awayTeam = teamsById.get(awayTeamId)
  const homeFlag = homeTeam?.flagEmoji ?? ''
  const awayFlag = awayTeam?.flagEmoji ?? ''
  const skipScreens = playerSide != null

  const [state, setState] = useState<BattleMatchState>(() => makeInitialState(homeTeamId, awayTeamId, match.stage, skipScreens))
  const [history, setHistory] = useState<BattleResult['rounds']>([])
  const [roundOutcome, setRoundOutcome] = useState<RoundOutcome>('miss')
  const [nextAction, setNextAction] = useState<NextAction | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [countdownNum, setCountdownNum] = useState<number | null>(null)

  const currentRound = state.rounds[state.roundIndex]
  const suddenDeath = state.roundIndex >= STANDARD_ROUNDS.length
  const result = useMemo<BattleResult>(() => ({
    homeScore: state.playerScore,
    awayScore: state.opponentScore,
    winnerId: state.playerScore > state.opponentScore ? homeTeamId : awayTeamId,
    playerScore: state.playerScore,
    rounds: history,
  }), [awayTeamId, history, homeTeamId, state.opponentScore, state.playerScore])

  // ── Audio ───────────────────────────────────────────────
  const playerWon = result.winnerId === homeTeamId
  const audioSrc = (() => {
    if (state.phase === 'intro') return AUDIO.kickoff
    if (state.phase === 'match_result') return playerWon ? AUDIO.victory : AUDIO.defeat
    if (state.phase === 'playing' || state.phase === 'round_result' || state.phase === 'countdown') {
      return currentRound === 'attack' ? AUDIO.attack : AUDIO.defense
    }
    return AUDIO.kickoff  // round_start
  })()
  useGameAudio(audioSrc)

  const commentaryData = useMemo(() => {
    if (!homeTeam || !awayTeam) return null
    const phase = currentRound === 'attack' ? 'pre_attack' : 'pre_defense'
    const team = currentRound === 'attack' ? homeTeam : awayTeam
    const opponent = currentRound === 'attack' ? awayTeam : homeTeam
    return getCommentary(phase, team, opponent)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, currentRound])

  // ── Countdown 3-2-1-GO ──────────────────────────────────
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

  // ── Round result → next round / finish ──────────────────
  useEffect(() => {
    if (state.phase !== 'round_result' || !nextAction) return
    const timer = window.setTimeout(() => {
      if (nextAction.type === 'finish') {
        setState((current) => ({ ...current, phase: 'match_result' }))
      } else {
        setState((current) => ({
          ...current,
          rounds: nextAction.append ? [...current.rounds, nextAction.append] : current.rounds,
          roundIndex: current.roundIndex + 1,
          phase: skipScreens ? 'countdown' : 'round_start',
        }))
      }
      setNextAction(null)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [nextAction, state.phase, skipScreens])

  const completeRound = (success: boolean, isGoal: boolean, outcome: RoundOutcome) => {
    const nextPlayerScore = state.playerScore + Number(currentRound === 'attack' && isGoal)
    const nextOpponentScore = state.opponentScore + Number(currentRound === 'defense' && isGoal)
    const nextHistory = [...history, { type: currentRound, success, isGoal }]
    let action: NextAction

    if (!suddenDeath && state.roundIndex < STANDARD_ROUNDS.length - 1) {
      action = { type: 'next' }
    } else if (!suddenDeath) {
      action = nextPlayerScore === nextOpponentScore ? { type: 'next', append: 'attack' } : { type: 'finish' }
    } else if (currentRound === 'attack') {
      action = isGoal ? { type: 'finish' } : { type: 'next', append: 'defense' }
    } else {
      action = isGoal ? { type: 'finish' } : { type: 'next', append: 'attack' }
    }

    setHistory(nextHistory)
    setRoundOutcome(outcome)
    setNextAction(action)
    setState((current) => ({ ...current, playerScore: nextPlayerScore, opponentScore: nextOpponentScore, phase: 'round_result' }))
  }

  const handleAttackEnd = (isGoal: boolean, reason: AttackEndReason = isGoal ? 'goal' : 'miss') => {
    const outcome: RoundOutcome = isGoal ? 'goal' : reason === 'intercepted' ? 'intercepted' : 'miss'
    completeRound(isGoal, isGoal, outcome)
  }

  const handleDefenseEnd = (outcome: DefenseOutcome) => {
    if (outcome.path === 'space_invaders') {
      const success = outcome.blocked === outcome.total
      completeRound(success, !success, success ? 'defense_perfect' : 'goal_conceded')
      return
    }
    completeRound(outcome.saved, !outcome.saved, outcome.saved ? 'saved' : 'goal_conceded')
  }

  // ── Pause / Restart ─────────────────────────────────────
  const handleRestart = () => {
    setIsPaused(false)
    setHistory([])
    setNextAction(null)
    setRoundOutcome('miss')
    setState(makeInitialState(homeTeamId, awayTeamId, match.stage, skipScreens))
  }

  return (
    <>
    <div className="battle-desktop-bg" aria-hidden="true" />
    <div className="battle-engine" role="dialog" aria-modal="true" aria-label={`Combat ${match.label}`} onContextMenu={(e) => e.preventDefault()}>

      {/* ── Intro ─────────────────────────────────────────── */}
      {state.phase === 'intro' ? <section className="battle-intro">
        <div className="battle-intro__meta">{match.stage} · {match.label} · {match.dateLabel}</div>
        <div className="battle-intro__matchup">
          <div className="battle-intro__team">
            <div className="battle-intro__badge is-home">{homeFlag ? <span style={{ fontSize: 36 }}>{homeFlag}</span> : rawHomeId.slice(0, 3).toUpperCase()}</div>
            <strong>{rawHomeId.toUpperCase()}</strong>
          </div>
          <div className="battle-intro__vs">VS</div>
          <div className="battle-intro__team is-away">
            <div className="battle-intro__badge">{awayFlag ? <span style={{ fontSize: 36 }}>{awayFlag}</span> : rawAwayId.slice(0, 3).toUpperCase()}</div>
            <strong>{rawAwayId.toUpperCase()}</strong>
          </div>
        </div>
        <div className="battle-intro__spacer" />
        <div className="battle-intro__sequence">{STANDARD_ROUNDS.map((round, index) => <div key={index}><b>{round === 'attack' ? '⚽' : '🛡️'}</b><small>{round === 'attack' ? 'ATT' : 'DEF'}</small></div>)}</div>
        <button type="button" className="battle-intro__cta" onClick={() => { sfx.battle(); setState((current) => ({ ...current, phase: 'countdown' })) }}>⚔️ Jouer ce match</button>
      </section> : null}

      {/* ── Round start ───────────────────────────────────── */}
      {state.phase === 'round_start' ? <section className="battle-round-start" key={state.roundIndex}>
        <div className="battle-round-start__score">
          <em>{homeFlag} {homeTeamId.slice(0, 3).toUpperCase()}</em>
          <strong>{state.playerScore} — {state.opponentScore}</strong>
          <em>{awayTeamId.slice(0, 3).toUpperCase()} {awayFlag}</em>
        </div>
        <div className="battle-round-start__card">
          <p>{commentaryData
            ? highlightPlayerName(commentaryData.text, commentaryData.tokens[0])
            : currentRound === 'attack'
              ? <><b>{homeTeamId.toUpperCase()}</b> entre dans la surface… <b>il faut éliminer les défenseurs et armer la frappe !</b></>
              : <><b>{awayTeamId.toUpperCase()}</b> attaque en force… <b>protège ta surface, neutralise les attaquants !</b></>}
          </p>
        </div>
        <svg className="battle-round-start__player" width="128" height="148" viewBox="0 0 128 148">
          <rect x="52" y="104" width="9" height="22" rx="4.5" fill="#f3c9a0"/><rect x="67" y="104" width="9" height="22" rx="4.5" fill="#f3c9a0"/>
          <rect x="52" y="118" width="9" height="9" rx="2" fill={currentRound === 'attack' ? '#2bff9a' : '#FF4455'}/>
          <rect x="67" y="118" width="9" height="9" rx="2" fill={currentRound === 'attack' ? '#2bff9a' : '#FF4455'}/>
          <path d="M50 126 h13 v6 q0 3 -3 3 h-14 q-2 0 -1 -3z" fill="#0b1422"/><path d="M65 126 h13 v6 q0 3 3 3 h11 q2 0 1 -3z" fill="#0b1422"/>
          <rect x="46" y="92" width="36" height="18" rx="5" fill="#101a2c" stroke={currentRound === 'attack' ? '#2bff9a' : '#FF4455'} strokeWidth="1.5"/>
          <path d="M42 64 q22 -10 44 0 l-3 32 q-19 6 -38 0 z" fill={currentRound === 'attack' ? '#2bff9a' : '#FF4455'}/>
          <path d="M56 58 v40 M72 58 v40" stroke="#0b1422" strokeWidth="3.5" opacity=".5"/>
          <text x="64" y="86" fontFamily="Barlow Condensed" fontWeight="900" fontSize="16" fill="#0b1422" textAnchor="middle">{state.roundIndex + 1}</text>
          <rect x="35" y="66" width="8" height="22" rx="4" fill={currentRound === 'attack' ? '#2bff9a' : '#FF4455'}/>
          <rect x="85" y="66" width="8" height="22" rx="4" fill={currentRound === 'attack' ? '#2bff9a' : '#FF4455'}/>
          <circle cx="39" cy="90" r="4.5" fill="#f3c9a0"/><circle cx="89" cy="90" r="4.5" fill="#f3c9a0"/>
          <circle cx="64" cy="38" r="28" fill="#f3c9a0"/>
          <path d="M37 35 q3 -26 27 -26 q24 0 27 26 q-7 -12 -27 -12 q-20 0 -27 12z" fill="#3a2a1c"/>
          <circle cx="54" cy="39" r="4.2" fill="#1a1a1a"/><circle cx="74" cy="39" r="4.2" fill="#1a1a1a"/>
          <circle cx="55.5" cy="37.5" r="1.4" fill="#fff"/><circle cx="75.5" cy="37.5" r="1.4" fill="#fff"/>
          <circle cx="48" cy="47" r="3.4" fill="#ff8a8a" opacity=".55"/><circle cx="80" cy="47" r="3.4" fill="#ff8a8a" opacity=".55"/>
          <path d="M57 47 q7 7 14 0" stroke="#1a1a1a" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
          <g transform="translate(98 130)"><circle r="13" fill="#f4f7ff" stroke="#0b1422" strokeWidth="1"/><path d="M0 -7 l6.7 4.9 -2.5 7.9 -8.4 0 -2.5 -7.9z" fill="#0b1422"/></g>
        </svg>
        <button type="button" className="battle-round-start__ready" onClick={() => { sfx.click(); setState((current) => ({ ...current, phase: 'countdown' })) }}>
          {currentRound === 'attack' ? "Prêt ? Joue l'attaque \u25b6" : 'Prêt ? Défends ! \u25b6'}
        </button>
      </section> : null}

      {/* ── Game phases ───────────────────────────────────── */}
      {state.phase === 'playing' && currentRound === 'attack'
        ? <AttackPhase key={`attack-${state.roundIndex}`} difficulty={state.difficulty} homeTeamId={homeTeamId} awayTeamId={awayTeamId} onRoundEnd={handleAttackEnd} isPaused={isPaused} />
        : null}
      {state.phase === 'playing' && currentRound === 'defense'
        ? <DefensePhase key={`defense-${state.roundIndex}`} difficulty={state.difficulty} homeTeamId={homeTeamId} awayTeamId={awayTeamId} onRoundEnd={handleDefenseEnd} isPaused={isPaused} />
        : null}

      {state.phase === 'round_result' ? <RoundResult outcome={roundOutcome} roundType={currentRound} playerScore={state.playerScore} opponentScore={state.opponentScore} /> : null}
      {state.phase === 'match_result' ? <MatchResult result={result} playerWon={result.winnerId === homeTeamId} homeTeamId={homeTeamId} awayTeamId={awayTeamId} onContinue={() => onComplete(result)} /> : null}

      {/* ── Countdown overlay ─────────────────────────────── */}
      {state.phase === 'countdown' && countdownNum !== null ? (
        <div className="battle-countdown">
          <div key={countdownNum} className={`battle-countdown__num${countdownNum === 0 ? ' is-go' : ''}`}>
            {countdownNum === 0 ? 'GO !' : countdownNum}
          </div>
        </div>
      ) : null}

      {/* ── Pause button (visible during playing) ─────────── */}
      {state.phase === 'playing' && !isPaused ? (
        <button
          type="button"
          className="battle-pause-btn"
          onClick={() => setIsPaused(true)}
          aria-label="Pause"
        >⏸</button>
      ) : null}

      {/* ── Pause modal ───────────────────────────────────── */}
      {isPaused ? (
        <div className="battle-pause-modal">
          <div className="battle-pause-modal__inner">
            <div className="battle-pause-modal__title">PAUSE</div>
            <button type="button" className="battle-pause-modal__btn battle-pause-modal__btn--resume" onClick={() => setIsPaused(false)}>
              ▶ Reprendre
            </button>
            <button type="button" className="battle-pause-modal__btn" onClick={handleRestart}>
              ↺ Recommencer
            </button>
            {onQuit && (
              <button type="button" className="battle-pause-modal__btn battle-pause-modal__btn--quit" onClick={() => { setIsPaused(false); onQuit() }}>
                ✕ Quitter
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
