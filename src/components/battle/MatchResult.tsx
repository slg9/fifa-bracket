import { useEffect, useState } from 'react'
import type { BattleDifficulty, BattleResult } from '../../types'
import { publishResultShare } from '../../lib/challengeData'
import { blobToDataUrl, shareLink } from '../../challenge/shareImage'
import { renderResultShareCanvas } from '../../challenge/shareCanvas'
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
  ownerPseudo?: string
  difficulty?: BattleDifficulty
  onContinue: () => void
}

const CONFETTI_COLORS = ['#ffb800', '#2bff9a', '#ff4455', '#a855f7', '#3b82f6', '#ff6b35']
const DIFFICULTY_LABELS: Record<BattleDifficulty, { label: string; detail: string }> = {
  easy: { label: 'Facile', detail: 'rythme plus cool' },
  medium: { label: 'Moyen', detail: 'pression equilibree' },
  hard: { label: 'Difficile', detail: 'mode arcade intense' },
}

export function MatchResult({ result, playerWon, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeFlag, awayFlag, syncStatusLabel, ownerPseudo, difficulty, onContinue }: MatchResultProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'working' | 'ready' | 'done' | 'error'>('idle')
  const [preparedShareUrl, setPreparedShareUrl] = useState<string | null>(null)
  const [sharePreviewUrl, setSharePreviewUrl] = useState<string | null>(null)
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false)
  const homeName = homeTeamName ?? homeTeamId
  const awayName = awayTeamName ?? awayTeamId
  const matchLabel = `${homeName} - ${awayName}`
  const scoreLabel = `${result.homeScore}-${result.awayScore}`
  const scorerNames = result.scorers?.map((scorer) => scorer.name) ?? []
  const difficultyMeta = difficulty ? DIFFICULTY_LABELS[difficulty] : null
  const shareText = playerWon
    ? `Brakup ${matchLabel}: j'ai gagne mon duel ${scoreLabel}${difficultyMeta ? ` en difficulte ${difficultyMeta.label}` : ''}${scorerNames.length ? ` avec ${scorerNames.join(', ')} buteur` : ''}. Et toi, tu veux tenter ton prono ?`
    : `Brakup ${matchLabel}: j'ai tente mon duel ${scoreLabel}${difficultyMeta ? ` en difficulte ${difficultyMeta.label}` : ''}${scorerNames.length ? ` avec ${scorerNames.join(', ')} buteur` : ''}. A toi de faire mieux ?`

  const shareRows = result.scorers?.length
    ? result.scorers.slice(0, 4).map((scorer) => ({ label: `Buteur: ${scorer.name}`, tone: 'win' as const }))
    : [{ label: playerWon ? 'Duel gagne' : 'Duel joue', tone: playerWon ? 'win' as const : 'neutral' as const }]

  useEffect(() => {
    setShareStatus('idle')
    setPreparedShareUrl(null)
    if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl)
    setSharePreviewUrl(null)
    setSharePreviewOpen(false)
  }, [homeName, awayName, result.homeScore, result.awayScore, playerWon])

  useEffect(() => () => {
    if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl)
  }, [sharePreviewUrl])

  const handleShare = async () => {
    if (preparedShareUrl) {
      setShareStatus('working')
      try {
        await shareLink({
          title: 'Brakup Challenge',
          text: shareText,
          url: preparedShareUrl,
        })
        setSharePreviewOpen(false)
        setShareStatus('done')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setShareStatus('ready')
          return
        }
        console.error('Match result native share failed:', error)
        setShareStatus('error')
      }
      return
    }
    setShareStatus('working')
    try {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const blob = await renderResultShareCanvas({
        backgroundSrc: '/brakup-share-bg-brakup.png',
        logoSrc: '/brakup-logo.png',
        ownerPseudo,
        matchup: {
          homeFlag,
          awayFlag,
          homeLabel: homeName,
          awayLabel: awayName,
        },
        boomLabel: playerWon ? 'VICTOIRE' : 'MATCH JOUE',
        headline: playerWon ? 'Victoire Brakup' : 'Bien essaye',
        subline: `${homeName} ${scoreLabel} ${awayName}`,
        messageLines: [
          `Match ${matchLabel}`,
          `Score Brakup: ${homeName} ${scoreLabel} ${awayName}`,
          difficultyMeta ? `Difficulte: ${difficultyMeta.label}` : scorerNames.length ? `Buteur: ${scorerNames.slice(0, 3).join(', ')}` : '',
        ],
        pointsLabel: playerWon ? 'Duel gagne' : 'Resultat partage',
        rows: shareRows,
        cta: 'Tente ta chance avec ton prono.',
      })
      const published = await publishResultShare({
        title: playerWon ? `Victoire Brakup - ${matchLabel}` : `Resultat Brakup - ${matchLabel}`,
        description: shareText,
        redirectUrl: `${window.location.origin}/challenge`,
        imageDataUrl: await blobToDataUrl(blob),
        pseudo: ownerPseudo || 'Brakup',
      })
      if (sharePreviewUrl) URL.revokeObjectURL(sharePreviewUrl)
      setSharePreviewUrl(URL.createObjectURL(blob))
      setSharePreviewOpen(true)
      setPreparedShareUrl(published.shareUrl)
      setShareStatus('ready')
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
        {difficultyMeta ? (
          <div className={`battle-match-result__difficulty is-${difficulty}`}>
            <span>Difficulte jouee</span>
            <strong>{difficultyMeta.label}</strong>
            <small>{difficultyMeta.detail}</small>
          </div>
        ) : null}
        <p className="battle-match-result__share-copy">Invite tes potes a tenter leur prono sur Brakup.</p>
        <button type="button" className="battle-share" onClick={() => { sharePreviewUrl ? setSharePreviewOpen(true) : void handleShare() }} disabled={shareStatus === 'working'}>
          {shareStatus === 'working' ? 'Preparation...' : shareStatus === 'ready' ? 'Voir le visuel' : 'Partager'}
        </button>
        {shareStatus === 'ready' ? <small className="battle-share__feedback">Image prete. Ouvre le visuel pour partager.</small> : null}
        {shareStatus === 'done' ? <small className="battle-share__feedback">Partage lance.</small> : null}
        {shareStatus === 'error' ? <small className="battle-share__feedback is-error">Partage indisponible. Retente.</small> : null}
        <button type="button" className="battle-continue" onClick={onContinue}>Continuer <span>→</span></button>
        <div className="battle-breakdown"><header><span>Round</span><span>Phase</span><span>Résultat</span></header>{result.rounds.length ? result.rounds.map((round, index) => <div key={`${round.type}-${index}`}><b>{index + 1}</b><span>{round.scorer ? `${round.type === 'attack' ? 'Attaque' : round.type === 'fruit_ninja' ? 'Tirs massifs' : 'Defense'} · ${round.scorer.name}` : round.type === 'attack' ? 'Attaque' : round.type === 'fruit_ninja' ? 'Tirs massifs' : 'Defense'}</span><strong className={round.success ? 'is-success' : 'is-fail'}>{round.success ? 'REUSSI' : 'ECHEC'}</strong></div>) : <div><b>SIM</b><span>Simulation directe</span><strong className="is-success">VALIDE</strong></div>}</div>
      </div>
      {(shareStatus === 'working' || (sharePreviewUrl && sharePreviewOpen)) ? (
        <div className="brakup-share-preview" role="dialog" aria-modal="true">
          <div className="brakup-share-preview__panel">
            <div className={`brakup-share-preview__frame${sharePreviewUrl ? '' : ' is-loading'}`}>
              {sharePreviewUrl ? (
                <img src={sharePreviewUrl} alt="Apercu du partage Brakup" />
              ) : (
                <div className="brakup-share-loader">
                  <div className="boot-loader__mark boot-loader__mark--sm" aria-hidden="true">
                    <span className="boot-loader__orbit boot-loader__orbit--outer" />
                    <span className="boot-loader__orbit boot-loader__orbit--inner" />
                    <img className="boot-loader__logo" src="/brakup-loader.svg" alt="" />
                  </div>
                  <strong>Brakup loading</strong>
                  <span>Construction du visuel</span>
                  <span>On prepare tout</span>
                  <span>Derniere passe</span>
                </div>
              )}
            </div>
            <div className="brakup-share-preview__actions">
              <button type="button" className="brakup-share-preview__ghost" onClick={() => setSharePreviewOpen(false)}>Retour</button>
              <button type="button" className="brakup-share-preview__primary" onClick={() => void handleShare()} disabled={!preparedShareUrl || shareStatus === 'working'}>
                {shareStatus === 'working' ? 'Preparation...' : 'Partager'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default MatchResult
