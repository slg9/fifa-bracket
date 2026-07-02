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
        <a className="splash__close" href="/" aria-label="Retour a l'accueil">
          ×
        </a>
        <div className="splash__content">
          <button type="button" className={`splash__cta${leaving ? ' is-pressed' : ''}`} onClick={handlePlay}>
            <span className="splash__ring" />
            <span className="splash__ring splash__ring--2" />
            <span className="splash__ring splash__ring--3" />
            <span className="splash__cta-inner">JOUER</span>
          </button>
          <p className="splash__sub">World Cup Challenge 2026</p>
          <p className="splash__hint">Construis ton bracket - Joue les matchs</p>
        </div>
      </div>
    </div>
  )
}

export default ChallengeSplash
