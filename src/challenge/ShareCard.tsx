import type { Ref } from 'react'

export type ShareCardProps = {
  captureRef?: Ref<HTMLDivElement>
  variant: 'win' | 'loss'
  kicker: string
  headline: string
  boomLabel: string
  scoreLabel: string
  matchLabel: string
  detailLabel: string
  pointsLabel?: string
  homeFlag?: string
  awayFlag?: string
  exactLabel?: string
  scorerLabel?: string
  theme?: 'brakup' | 'prono'
  realScoreLabel?: string
  playedScoreLabel?: string
  playedScoreStruck?: boolean
}

export function ShareCard({
  captureRef,
  variant,
  kicker,
  headline,
  boomLabel,
  scoreLabel,
  matchLabel,
  detailLabel,
  pointsLabel,
  homeFlag,
  awayFlag,
  exactLabel,
  scorerLabel,
  theme = 'brakup',
  realScoreLabel,
  playedScoreLabel,
  playedScoreStruck = false,
}: ShareCardProps) {
  const backgroundSrc = '/brakup-share-bg-brakup.png'
  const hasBadges = Boolean(pointsLabel || exactLabel || scorerLabel)
  const badgeClass = (label: string) => (
    /non trouve|aucun|retente|revanche/i.test(label) ? 'is-lost' : 'is-won'
  )

  return (
    <div ref={captureRef} className={`brakup-share-card is-${variant} is-${theme}`}>
      <img className="brakup-share-card__bg" src={backgroundSrc} alt="" aria-hidden="true" />
      <img className="brakup-share-card__logo" src="/brakup-logo.png" alt="Brakup" />
      <div className="brakup-share-card__brand">BRAKUP</div>
      <div className="brakup-share-card__kicker">{kicker}</div>
      <div className="brakup-share-card__headline">{headline}</div>
      <div className="brakup-share-card__boom">{boomLabel}</div>
      <div className="brakup-share-card__score">{scoreLabel}</div>
      <div className="brakup-share-card__ticket">
        {theme === 'prono' ? (
          <div className="brakup-share-card__match-title">
            <strong>{matchLabel}</strong>
          </div>
        ) : (
          <div>
            {homeFlag ? <span>{homeFlag}</span> : null}
            <strong>{matchLabel}</strong>
            {awayFlag ? <span>{awayFlag}</span> : null}
          </div>
        )}
        {realScoreLabel && playedScoreLabel ? (
          <div className="brakup-share-card__scorelines">
            <span className="is-real">{realScoreLabel}</span>
            <span className={playedScoreStruck ? 'is-played is-struck' : 'is-played'}>{playedScoreLabel}</span>
          </div>
        ) : (
          <p>{detailLabel}</p>
        )}
        {hasBadges ? (
          <div className="brakup-share-card__badges">
            {pointsLabel ? <b className={badgeClass(pointsLabel)}>{pointsLabel}</b> : null}
            {exactLabel ? <b className={badgeClass(exactLabel)}>{exactLabel}</b> : null}
            {scorerLabel ? <b className={badgeClass(scorerLabel)}>{scorerLabel}</b> : null}
          </div>
        ) : null}
      </div>
      <div className="brakup-share-card__cta">A toi de tenter ton prono sur Brakup</div>
    </div>
  )
}

export default ShareCard
