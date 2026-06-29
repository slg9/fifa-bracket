import { useRef, useState } from 'react'
import type { BattleResult } from '../../types'
import ShareCard from '../../challenge/ShareCard'
import { safeFilePart, shareElementImage } from '../../challenge/shareImage'
import '../../challenge/challenge.css'

type MatchResultProps = {
  result: BattleResult
  playerWon: boolean
  homeTeamId: string
  awayTeamId: string
  homeTeamName?: string
  awayTeamName?: string
  homeFlag?: string
  awayFlag?: string
  syncStatusLabel?: string
  onContinue: () => void
}

const CONFETTI_COLORS = ['#ffb800', '#2bff9a', '#ff4455', '#a855f7', '#3b82f6', '#ff6b35']

export function MatchResult({ result, playerWon, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeFlag, awayFlag, syncStatusLabel, onContinue }: MatchResultProps) {
  const shareRef = useRef<HTMLDivElement>(null)
  const [shareStatus, setShareStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const homeName = homeTeamName ?? homeTeamId
  const awayName = awayTeamName ?? awayTeamId
  const shareMatchLabel = `${homeName} vs ${awayName}`

  const handleShare = async () => {
    if (!shareRef.current) return
    setShareStatus('working')
    try {
      // Attendre que les images de fond soient chargees
      await new Promise(resolve => setTimeout(resolve, 150))
      await shareElementImage(shareRef.current, {
        fileName: `brakup-match-${safeFilePart(homeName)}-${safeFilePart(awayName)}.png`,
        title: 'Brakup Challenge',
        text: playerWon
          ? "J'ai gagne mon duel Brakup. Et toi, tu veux tenter ton prono ?"
          : "J'ai tente mon duel Brakup. A toi de faire mieux ?",
        url: `${window.location.origin}/?challenge`,
        backgroundColor: '#050b16',
      })
      setShareStatus('done')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setShareStatus('idle')
        return
      }
      console.error('Match result share failed:', error)
      setShareStatus('error')
    }
  }

  return (
    <section className={`battle-match-result${playerWon ? ' is-win' : ' is-loss'}`}>
      {playerWon ? <svg className="battle-match-confetti" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 44 }, (_, index) => <rect key={index} className="battle-match-confetti__piece" x={(index * 67) % 390} y={-60 - (index * 47) % 620} width="8" height="15" rx="2" fill={CONFETTI_COLORS[index % CONFETTI_COLORS.length]} style={{ animationDelay: `${(index % 14) * -.18}s`, animationDuration: `${2.9 + (index % 7) * .18}s` }} />)}</svg> : null}
      <div className="battle-match-result__content">
        {playerWon ? <img className="battle-match-result__logo" src="/brakup-logo.png" alt="Brakup" /> : null}
        <span className="battle-match-result__eyebrow">MATCH TERMINÉ</span>
        <div className="battle-match-result__trophy">{playerWon ? '🏆' : '◌'}</div>
        <h1>{playerWon ? 'VICTOIRE !' : 'Bien essayé'}</h1>
        <p>{result.commentary ?? (playerWon ? `${homeName} remporte le duel !` : `${awayName} s'impose cette fois`)}</p>
        <div className="battle-match-result__score">
          {homeFlag ? <span className="battle-match-result__score-flag">{homeFlag}</span> : null}
          <strong>{result.homeScore}</strong><i>-</i><strong>{result.awayScore}</strong>
          {awayFlag ? <span className="battle-match-result__score-flag">{awayFlag}</span> : null}
        </div>
        {result.scorers?.length ? (
          <div className="battle-match-scorers">
            <span>Buteurs Brakup</span>
            <div>
              {result.scorers.map((scorer, index) => (
                <b key={`${scorer.teamId}-${scorer.name}-${index}`}>#{scorer.number ?? 9} {scorer.name}</b>
              ))}
            </div>
          </div>
        ) : null}
        {syncStatusLabel ? <div className="battle-match-result__sync">{syncStatusLabel}</div> : null}
        <p className="battle-match-result__share-copy">Invite tes potes a tenter leur prono sur Brakup.</p>
        <button type="button" className="battle-share" onClick={() => void handleShare()} disabled={shareStatus === 'working'}>
          {shareStatus === 'working' ? "Generation de l'image..." : "Partager l'image"}
        </button>
        {shareStatus === 'done' ? <small className="battle-share__feedback">Image prete a partager.</small> : null}
        {shareStatus === 'error' ? <small className="battle-share__feedback is-error">Partage indisponible pour le moment.</small> : null}
        <button type="button" className="battle-continue" onClick={onContinue}>Continuer <span>→</span></button>
        <div className="battle-breakdown"><header><span>Round</span><span>Phase</span><span>Résultat</span></header>{result.rounds.length ? result.rounds.map((round, index) => <div key={`${round.type}-${index}`}><b>{index + 1}</b><span>{round.scorer ? `${round.type === 'attack' ? 'Attaque' : round.type === 'fruit_ninja' ? 'Tirs massifs' : 'Defense'} · ${round.scorer.name}` : round.type === 'attack' ? 'Attaque' : round.type === 'fruit_ninja' ? 'Tirs massifs' : 'Defense'}</span><strong className={round.success ? 'is-success' : 'is-fail'}>{round.success ? 'REUSSI' : 'ECHEC'}</strong></div>) : <div><b>SIM</b><span>Simulation directe</span><strong className="is-success">VALIDE</strong></div>}</div>
      </div>
      <div className="brakup-share-capture" aria-hidden="true">
        <ShareCard
          captureRef={shareRef}
          variant={playerWon ? 'win' : 'loss'}
          kicker={playerWon ? 'Bien joue' : 'Bien tente'}
          headline={playerWon ? 'Victoire Brakup' : 'Defaite Brakup'}
          boomLabel={playerWon ? 'BOOOOOM' : 'REMATCH'}
          scoreLabel={playerWon ? 'MATCH GAGNE' : 'A REJOUER'}
          matchLabel={shareMatchLabel}
          detailLabel={`${homeFlag ?? ''} ${result.homeScore} - ${result.awayScore} ${awayFlag ?? ''}`}
          pointsLabel={playerWon ? 'Duel valide' : 'Revanche ouverte'}
          homeFlag={homeFlag}
          awayFlag={awayFlag}
        />
      </div>
    </section>
  )
}

export default MatchResult
