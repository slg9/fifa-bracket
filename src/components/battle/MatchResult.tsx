import type { BattleResult } from '../../types'

type MatchResultProps = {
  result: BattleResult
  playerWon: boolean
  homeTeamId: string
  awayTeamId: string
  onContinue: () => void
}

const CONFETTI_COLORS = ['#ffb800', '#2bff9a', '#ff4455', '#a855f7', '#3b82f6', '#ff6b35']

export function MatchResult({ result, playerWon, homeTeamId, awayTeamId, onContinue }: MatchResultProps) {
  return (
    <section className={`battle-match-result${playerWon ? ' is-win' : ' is-loss'}`}>
      {playerWon ? <svg className="battle-match-confetti" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 30 }, (_, index) => <rect key={index} className="battle-match-confetti__piece" x={(index * 67) % 390} y={-20 - (index * 31) % 200} width="8" height="15" rx="2" fill={CONFETTI_COLORS[index % CONFETTI_COLORS.length]} style={{ animationDelay: `${(index % 10) * .08}s`, animationDuration: `${1.2 + (index % 6) * .1}s` }} />)}</svg> : null}
      <div className="battle-match-result__content">
        <span className="battle-match-result__eyebrow">MATCH TERMINÉ</span>
        <div className="battle-match-result__trophy">{playerWon ? '🏆' : '◌'}</div>
        <h1>{playerWon ? 'VICTOIRE!' : 'Bien essayé'}</h1>
        <p>{playerWon ? `${homeTeamId.toUpperCase()} remporte le duel` : `${awayTeamId.toUpperCase()} s’impose cette fois`}</p>
        <div className="battle-match-result__score"><strong>{result.homeScore}</strong><i>—</i><strong>{result.awayScore}</strong></div>
        <div className="battle-breakdown"><header><span>Round</span><span>Phase</span><span>Résultat</span></header>{result.rounds.map((round, index) => <div key={`${round.type}-${index}`}><b>{index + 1}</b><span>{round.type === 'attack' ? '⚽ Attaque' : '🛡️ Défense'}</span><strong className={round.success ? 'is-success' : 'is-fail'}>{round.success ? 'RÉUSSI' : 'ÉCHEC'}</strong></div>)}</div>
        <button type="button" className="battle-continue" onClick={onContinue}>Continuer <span>→</span></button>
      </div>
    </section>
  )
}

export default MatchResult
