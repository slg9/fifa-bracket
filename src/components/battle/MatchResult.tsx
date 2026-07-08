import { useEffect, useState } from 'react'
import type { BattleDifficulty, BattleResult } from '../../types'
import { publishResultShare } from '../../lib/challengeData'
import { blobToDataUrl, blobToShareFile, shareFile, shareLink } from '../../challenge/shareImage'
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
  ownerPseudo?: string
  difficulty?: BattleDifficulty
  onContinue: () => void
  onRestart: () => void
}

const CONFETTI_COLORS = ['#ffb800', '#2bff9a', '#ff4455', '#a855f7', '#3b82f6', '#ff6b35']
const DIFFICULTY_LABELS: Record<BattleDifficulty, { label: string; detail: string }> = {
  easy: { label: 'Facile', detail: 'rythme plus cool' },
  medium: { label: 'Moyen', detail: 'pression équilibrée' },
  hard: { label: 'Difficile', detail: 'mode arcade intense' },
}

function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.8 13.4 15.2 17M15.2 7 8.8 10.6" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="5.5" r="3" /><circle cx="18" cy="18.5" r="3" /></svg>
}

function ContinueIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
}

function RestartIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v6h-6" /></svg>
}

export function MatchResult({ result, playerWon, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeFlag, awayFlag, ownerPseudo, difficulty, onContinue, onRestart }: MatchResultProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'working' | 'ready' | 'done' | 'error'>('idle')
  const [preparedShareUrl, setPreparedShareUrl] = useState<string | null>(null)
  const [preparedShareBlob, setPreparedShareBlob] = useState<Blob | null>(null)
  const [sharePreviewUrl, setSharePreviewUrl] = useState<string | null>(null)
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false)
  const [showRoundDetails, setShowRoundDetails] = useState(false)
  const [showScorers, setShowScorers] = useState(false)
  const homeName = homeTeamName ?? homeTeamId
  const awayName = awayTeamName ?? awayTeamId
  const matchLabel = `${homeName} - ${awayName}`
  const scoreLabel = `${result.homeScore}-${result.awayScore}`
  const scorerNames = result.scorers?.map((scorer) => scorer.name) ?? []
  const difficultyMeta = difficulty ? DIFFICULTY_LABELS[difficulty] : null
  const shareText = playerWon
    ? `Brakup ${matchLabel}: j'ai gagné mon duel ${scoreLabel}${difficultyMeta ? ` en difficulté ${difficultyMeta.label}` : ''}${scorerNames.length ? ` avec ${scorerNames.join(', ')} buteur` : ''}. Et toi, tu veux tenter ton prono ?`
    : `Brakup ${matchLabel}: j'ai tenté mon duel ${scoreLabel}${difficultyMeta ? ` en difficulté ${difficultyMeta.label}` : ''}${scorerNames.length ? ` avec ${scorerNames.join(', ')} buteur` : ''}. À toi de faire mieux ?`

  const shareRows = result.scorers?.length
    ? result.scorers.slice(0, 4).map((scorer) => ({ label: `Buteur: ${scorer.name}`, tone: 'win' as const }))
    : [{ label: playerWon ? 'Duel gagné' : 'Duel joué', tone: playerWon ? 'win' as const : 'neutral' as const }]

  useEffect(() => {
    setShareStatus('idle')
    setPreparedShareUrl(null)
    setPreparedShareBlob(null)
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
        if (preparedShareBlob) {
          await shareFile(blobToShareFile(preparedShareBlob, 'brakup-result.png'), {
            title: 'Brakup Challenge',
            text: `${shareText}\n${preparedShareUrl}`,
            url: preparedShareUrl,
          })
        } else {
          await shareLink({
            title: 'Brakup Challenge',
            text: shareText,
            url: preparedShareUrl,
          })
        }
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
        boomLabel: playerWon ? 'VICTOIRE' : 'MATCH JOUÉ',
        headline: playerWon ? 'Victoire Brakup' : 'Bien essayé',
        subline: `${homeName} ${scoreLabel} ${awayName}`,
        messageLines: [
          `Match ${matchLabel}`,
          `Score Brakup: ${homeName} ${scoreLabel} ${awayName}`,
          difficultyMeta ? `Difficulté: ${difficultyMeta.label}` : scorerNames.length ? `Buteur: ${scorerNames.slice(0, 3).join(', ')}` : '',
        ],
        pointsLabel: playerWon ? 'Duel gagné' : 'Résultat partagé',
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
      setPreparedShareBlob(blob)
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
      <style>{`
        .battle-match-result__actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
          margin: 14px 0 10px;
        }
        .battle-match-action.is-continue {
          grid-column: 1 / -1;
        }
        .battle-match-action {
          min-width: 0;
          min-height: 62px;
          display: grid;
          place-items: center;
          gap: 4px;
          padding: 8px 6px;
          border-radius: 13px;
          border: 1.5px solid rgba(255,255,255,.16);
          background: rgba(255,255,255,.07);
          color: #eef6ff;
          font: 900 10px 'Barlow Condensed', sans-serif;
          letter-spacing: .1em;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(0,0,0,.22);
        }
        .battle-match-action svg {
          width: 24px;
          height: 24px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2.3;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .battle-match-action:active { transform: scale(.97); }
        .battle-match-action:disabled { opacity: .6; cursor: wait; }
        .battle-match-action.is-share {
          color: #1b1200;
          background: linear-gradient(135deg, #fff4c4, #FFB800 62%, #ff9a00);
          border-color: rgba(255,255,255,.5);
          box-shadow: 0 12px 26px rgba(255,184,0,.3), inset 0 1px 0 rgba(255,255,255,.42);
        }
        .battle-match-action.is-continue {
          color: #031209;
          background: linear-gradient(135deg, #2bff9a, #1cd6c4);
          border-color: rgba(255,255,255,.38);
        }
        .battle-match-action.is-restart {
          color: #ffdf73;
          border-color: rgba(255,184,0,.35);
          background: rgba(255,184,0,.08);
        }
        .battle-match-result__details {
          margin-top: 8px;
        }
        .battle-match-scorers-toggle {
          display: flex;
          width: 100%;
          justify-content: center;
          align-items: center;
          gap: 8px;
          margin: 8px 0 0;
          padding: 10px 14px;
          border: 1px solid rgba(255,184,0,.28);
          border-radius: 12px;
          background: rgba(255,184,0,.08);
          color: #ffdf73;
          font: 900 12px 'Barlow Condensed', sans-serif;
          letter-spacing: .12em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .battle-match-scorers-toggle svg {
          width: 18px;
          height: 18px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2.2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .battle-match-scorers-toggle svg .is-open {
          display: none;
        }
      `}</style>
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
          <>
            <button type="button" className="battle-match-scorers-toggle" onClick={() => setShowScorers((open) => !open)} aria-expanded={showScorers}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /><path d="M12 4v16" className={showScorers ? 'is-open' : ''} /></svg>
              {showScorers ? 'Masquer buteurs Brakup' : 'Voir buteurs Brakup'}
            </button>
            {showScorers ? (
              <div className="battle-match-scorers">
                <span>Buteurs Brakup</span>
                <div>
                  {result.scorers.map((scorer, index) => (
                    <b key={`${scorer.teamId}-${scorer.name}-${index}`}>#{scorer.number ?? 9} {scorer.name}</b>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {difficultyMeta ? (
          <div className={`battle-match-result__difficulty is-${difficulty}`}>
            <span>Difficulté jouée</span>
            <strong>{difficultyMeta.label}</strong>
            <small>{difficultyMeta.detail}</small>
          </div>
        ) : null}
        <div className="battle-match-result__actions" aria-label="Actions du match">
          <button type="button" className="battle-match-action is-share" onClick={() => { sharePreviewUrl ? setSharePreviewOpen(true) : void handleShare() }} disabled={shareStatus === 'working'} aria-label="Partager">
            <ShareIcon />
            <span>{shareStatus === 'working' ? 'Prep...' : shareStatus === 'ready' ? 'Visuel' : 'Partager'}</span>
          </button>
          <button type="button" className="battle-match-action is-restart" onClick={onRestart} aria-label="Recommencer">
            <RestartIcon />
            <span>Recommencer</span>
          </button>
          <button type="button" className="battle-match-action is-continue" onClick={onContinue} aria-label="Continuer">
            <ContinueIcon />
            <span>Continuer</span>
          </button>
        </div>
        {shareStatus === 'ready' ? <small className="battle-share__feedback">Image prête. Ouvre le visuel pour partager.</small> : null}
        {shareStatus === 'done' ? <small className="battle-share__feedback">Partage lancé.</small> : null}
        {shareStatus === 'error' ? <small className="battle-share__feedback is-error">Partage indisponible. Retente.</small> : null}
        <div className="battle-match-result__details">
          <button type="button" className="battle-round-details-toggle" onClick={() => setShowRoundDetails((open) => !open)} aria-expanded={showRoundDetails}>
            {showRoundDetails ? 'Masquer les détails des rounds' : 'Voir détails des rounds'}
          </button>
          {showRoundDetails ? <div className="battle-breakdown"><header><span>Round</span><span>Phase</span><span>Résultat</span></header>{result.rounds.length ? result.rounds.map((round, index) => <div key={`${round.type}-${index}`}><b>{index + 1}</b><span>{round.scorer ? `${round.type === 'attack' ? 'Attaque' : round.type === 'fruit_ninja' ? 'Tirs massifs' : 'Défense'} · ${round.scorer.name}` : round.type === 'attack' ? 'Attaque' : round.type === 'fruit_ninja' ? 'Tirs massifs' : 'Défense'}</span><strong className={round.success ? 'is-success' : 'is-fail'}>{round.success ? 'RÉUSSI' : 'ÉCHEC'}</strong></div>) : <div><b>SIM</b><span>Simulation directe</span><strong className="is-success">VALIDÉ</strong></div>}</div> : null}
        </div>
      </div>
      {(shareStatus === 'working' || (sharePreviewUrl && sharePreviewOpen)) ? (
        <div className="brakup-share-preview" role="dialog" aria-modal="true">
          <div className="brakup-share-preview__panel">
            <div className={`brakup-share-preview__frame${sharePreviewUrl ? '' : ' is-loading'}`}>
              {sharePreviewUrl ? (
                <img src={sharePreviewUrl} alt="Aperçu du partage Brakup" />
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
