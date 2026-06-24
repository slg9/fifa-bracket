import { useMemo, useState } from 'react'
import { adjustDifficulty, generateBattleRounds, updateMomentum } from '../lib/battleEngine'
import { getCommentary } from '../lib/commentary'
import type { BattleResult, Team } from '../types'
import BalloonShot from './BalloonShot'
import Commentary from './Commentary'
import FruitNinjaDefense from './FruitNinjaDefense'
import WinAnimation from './WinAnimation'

export interface MatchBattleProps {
  matchId: string
  homeTeam: Team
  awayTeam: Team
  playerSide?: 'home' | 'away'
  onComplete: (result: BattleResult) => void
  onExit?: () => void
}

export function MatchBattle({ matchId, homeTeam, awayTeam, playerSide = 'home', onComplete, onExit }: MatchBattleProps) {
  const rounds = useMemo(() => generateBattleRounds({ homeTeam, awayTeam, playerSide }), [awayTeam, homeTeam, playerSide])
  const [roundIndex, setRoundIndex] = useState(0)
  const [momentum, setMomentum] = useState(0)
  const [homeScore, setHomeScore] = useState(0)
  const [awayScore, setAwayScore] = useState(0)
  const [roundResults, setRoundResults] = useState<BattleResult['rounds']>([])
  const [finished, setFinished] = useState(false)
  const playerTeam = playerSide === 'home' ? homeTeam : awayTeam
  const opponentTeam = playerSide === 'home' ? awayTeam : homeTeam
  const round = rounds[roundIndex]
  const commentary = useMemo(() => round ? getCommentary(round.commentaryPhase, round.type === 'attack' ? playerTeam : opponentTeam, round.type === 'attack' ? opponentTeam : playerTeam) : null, [opponentTeam, playerTeam, round])
  const difficulty = round ? adjustDifficulty(round.difficulty, momentum) : 'medium'

  const finishRound = (success: boolean, isGoal: boolean) => {
    const nextMomentum = updateMomentum(momentum, success)
    const playerGoal = round.type === 'attack' && isGoal
    const opponentGoal = round.type === 'defense' && isGoal
    const nextHome = homeScore + (playerSide === 'home' ? Number(playerGoal) : Number(opponentGoal))
    const nextAway = awayScore + (playerSide === 'away' ? Number(playerGoal) : Number(opponentGoal))
    const nextResults = [...roundResults, { type: round.type, success, isGoal }]
    setMomentum(nextMomentum)
    setHomeScore(nextHome)
    setAwayScore(nextAway)
    setRoundResults(nextResults)

    if (roundIndex === rounds.length - 1) {
      const resolvedHome = nextHome === nextAway ? nextHome + (playerSide === 'home' ? 1 : 0) : nextHome
      const resolvedAway = nextHome === nextAway ? nextAway + (playerSide === 'away' ? 1 : 0) : nextAway
      const winnerId = resolvedHome > resolvedAway ? homeTeam.id : awayTeam.id
      const successes = nextResults.filter((result) => result.success).length
      const result: BattleResult = {
        homeScore: resolvedHome,
        awayScore: resolvedAway,
        winnerId,
        playerScore: Math.round(successes / nextResults.length * 100),
        rounds: nextResults,
      }
      setHomeScore(resolvedHome)
      setAwayScore(resolvedAway)
      setFinished(true)
      window.setTimeout(() => onComplete(result), 1200)
    } else {
      window.setTimeout(() => setRoundIndex((index) => index + 1), 450)
    }
  }

  return (
    <main className={`brakup-battle${momentum >= 3 ? ' is-pressure' : ''}`}>
      <header className="brakup-battle__header">
        <button type="button" className="brakup-icon-button" onClick={onExit} aria-label="Quitter le match">←</button>
        <div><span>{matchId}</span><strong>Combat direct</strong></div>
        <div className="brakup-momentum" aria-label={`Momentum ${momentum}`}><i style={{ width: `${((momentum + 3) / 6) * 100}%` }} /></div>
      </header>
      <section className="brakup-scoreboard">
        <div className={playerSide === 'home' ? 'is-player' : ''}><span>{homeTeam.flagEmoji}</span><strong>{homeTeam.shortName}</strong><b>{homeScore}</b></div>
        <em>—</em>
        <div className={playerSide === 'away' ? 'is-player' : ''}><span>{awayTeam.flagEmoji}</span><strong>{awayTeam.shortName}</strong><b>{awayScore}</b></div>
      </section>
      {!finished && round ? (
        <section className="brakup-battle__round" key={roundIndex}>
          <div className="brakup-battle__roundmeta"><span>Round {roundIndex + 1}/{rounds.length}</span><b>{round.type === 'attack' ? 'ATTAQUE' : 'DÉFENSE'}</b><small>{difficulty}</small></div>
          {commentary && <Commentary text={commentary.text} tokens={commentary.tokens} displayDuration={900} />}
          {round.type === 'attack'
            ? <BalloonShot difficulty={difficulty} onResult={(result) => finishRound(result === 'goal', result === 'goal')} />
            : <FruitNinjaDefense balloonCount={round.balloonCount ?? 3} hasSonic={round.hasSonic ?? false} onResult={(blocked, total, sonicBlocked) => {
              const success = blocked / total >= 0.6 && (!round.hasSonic || sonicBlocked)
              finishRound(success, !success)
            }} />}
        </section>
      ) : (
        <section className="brakup-battle__victory">
          <WinAnimation variant="random" />
          <h2>{homeScore > awayScore ? homeTeam.name : awayTeam.name} gagne !</h2>
          <p>{homeScore} — {awayScore}</p>
        </section>
      )}
    </main>
  )
}

export default MatchBattle
