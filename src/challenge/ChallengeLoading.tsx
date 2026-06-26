import BootLoaderMark from '../components/BootLoaderMark'

type ChallengeLoadingProps = {
  progress: number
}

export function ChallengeLoading({ progress }: ChallengeLoadingProps) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)))

  return (
    <section className="challenge-loading" aria-live="polite" aria-label="Chargement du jeu">
      <div className="challenge-loading__frame">
        <div className="challenge-loading__bg" />
        <div className="challenge-loading__content">
          <BootLoaderMark className="challenge-loading__mark" />
          <div
            className="challenge-loading__meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={safeProgress}
          >
            <div className="challenge-loading__meter-track">
              <div className="challenge-loading__meter-fill" style={{ width: `${safeProgress}%` }} />
            </div>
            <div className="challenge-loading__meta">
              <span>Chargement</span>
              <b>{safeProgress}%</b>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ChallengeLoading
