import { useState } from 'react'
import { sfx } from '../lib/sfx'
import { playTrack } from '../lib/useGameAudio'

interface ChallengeSplashProps {
  onPlay: () => void
}

export function ChallengeSplash({ onPlay }: ChallengeSplashProps) {
  const [leaving, setLeaving] = useState(false)

  const handlePlay = () => {
    if (leaving) return
    sfx.start()
    // Force-start music inside the click handler → browser autoplay unlocked
    playTrack('/audio/kickoff-carnival.mp3')
    setLeaving(true)
    setTimeout(onPlay, 680)
  }

  return (
    <div className={`splash${leaving ? ' is-leaving' : ''}`}>
      <div className="splash__frame">
        <div className="splash__bg" />
        <a className="splash__close" href="/" aria-label="Retour à l'accueil">
          ×
        </a>
        <div className="splash__content">
          <button type="button" className={`splash__cta${leaving ? ' is-pressed' : ''}`} onClick={handlePlay}>
            <span className="splash__ring" />
            <span className="splash__ring splash__ring--2" />
            <span className="splash__ring splash__ring--3" />
            <span className="splash__cta-shine" aria-hidden="true" />
            <span className="splash__cta-inner">
              <svg className="splash__cta-ball" viewBox="0 0 40 40" aria-hidden="true">
                <ellipse className="splash__cta-ball-shadow" cx="20" cy="37" rx="11" ry="2.6" fill="rgba(0,0,0,.3)" />
                <g className="splash__cta-ball-body">
                  <circle cx="20" cy="20" r="15" fill="#f8fbff" stroke="#0a1a12" strokeWidth="2.4" />
                  <path d="M20 11 L28 17 L25 26 H15 L12 17 Z" fill="#0a1a12" opacity=".88" />
                  <path d="M20 5 V11 M28 17 L34 14 M25 26 L29 32 M15 26 L11 32 M12 17 L6 14" stroke="#0a1a12" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="14.5" cy="13.5" r="3.4" fill="rgba(255,255,255,.65)" />
                </g>
              </svg>
              <span className="splash__cta-label">JOUER</span>
            </span>
            {leaving ? (
              <span className="splash__burst" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <i key={index} style={{ '--burst-angle': `${index * 36}deg`, '--burst-delay': `${(index % 3) * 30}ms` } as React.CSSProperties} />
                ))}
              </span>
            ) : null}
          </button>
          <p className="splash__sub">World Cup Challenge 2026</p>
          <p className="splash__hint">Construis ton bracket · Joue les matchs</p>
        </div>
      </div>
    </div>
  )
}

export default ChallengeSplash
