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
  pointsLabel: string
  homeFlag?: string
  awayFlag?: string
  exactLabel?: string
  scorerLabel?: string
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
}: ShareCardProps) {
  return (
    <div ref={captureRef} className={`brakup-share-card is-${variant}`}>
      <img className="brakup-share-card__bg" src="/brakup-share-bg-brakup.png" alt="" aria-hidden="true" />
      <img className="brakup-share-card__logo" src="/brakup-logo.png" alt="Brakup" />
      <div className="brakup-share-card__brand">BRAKUP</div>
      <div className="brakup-share-card__kicker">{kicker}</div>
      <div className="brakup-share-card__headline">{headline}</div>
      <div className="brakup-share-card__boom">{boomLabel}</div>
      <div className="brakup-share-card__score">{scoreLabel}</div>
      <div className="brakup-share-card__ticket">
        <div>
          <span>{homeFlag ?? '⚽'}</span>
          <strong>{matchLabel}</strong>
          <span>{awayFlag ?? '🏆'}</span>
        </div>
        <p>{detailLabel}</p>
        <div className="brakup-share-card__badges">
          <b>{pointsLabel}</b>
          {exactLabel ? <b>{exactLabel}</b> : null}
          {scorerLabel ? <b>{scorerLabel}</b> : null}
        </div>
      </div>
      <div className="brakup-share-card__cta">A toi de tenter ton prono sur Brakup</div>
    </div>
  )
}

export default ShareCard
