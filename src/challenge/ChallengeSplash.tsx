import { useEffect, useMemo, useState } from 'react'
import { sfx } from '../lib/sfx'
import type { Locale } from '../lib/i18n'
import { playTrack } from '../lib/useGameAudio'

interface ChallengeSplashProps {
  onPlay: () => void
  onMiniGames?: () => void
  skipDialogue?: boolean
  locale?: Locale
}

type DialogueStep = {
  image: string
  eyebrow: Record<Locale, string>
  fr: string
  en: string
  action: Record<Locale, string>
  final?: boolean
}

const DIALOGUE_STEPS: DialogueStep[] = [
  {
    image: '/challenge-splash-oups.png',
    eyebrow: { fr: 'Ton aventure', en: 'Your run' },
    fr: "Choisis ton pays et vis sa Coupe du Monde depuis les groupes. Trois matchs pour survivre, puis chaque tour peut devenir le dernier.",
    en: "Choose your country and play its World Cup from the group stage. Three matches to survive, then every knockout round can be the last.",
    action: { fr: 'Continuer', en: 'Continue' },
  },
  {
    image: '/challenge-splash-explain.png',
    eyebrow: { fr: 'La pression monte', en: 'Pressure rises' },
    fr: "Les autres matchs sont simulés, les classements bougent, les meilleurs troisièmes sont calculés et ton prochain adversaire apparaît quand tu te qualifies.",
    en: "Other matches are simulated, standings move, best third-placed teams are calculated and your next opponent appears when you qualify.",
    action: { fr: 'Continuer', en: 'Continue' },
  },
  {
    image: '/challenge-splash-letsgo.png',
    eyebrow: { fr: 'À toi de jouer', en: 'Your move' },
    fr: "Marque des points aventure, consulte les classements et garde le mode officiel à portée pour rejouer les vrais matchs du jour.",
    en: "Score adventure points, check the standings and keep official mode close to replay today's real fixtures.",
    action: { fr: 'Jouer', en: 'Play' },
    final: true,
  },
]

export const CHALLENGE_DIALOGUE_IMAGES = DIALOGUE_STEPS.map((step) => step.image)

export function ChallengeSplash({ onPlay, onMiniGames, skipDialogue = false, locale = 'fr' }: ChallengeSplashProps) {
  const [dialogueStarted, setDialogueStarted] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [visibleChars, setVisibleChars] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const step = DIALOGUE_STEPS[stepIndex]
  const fullText = useMemo(() => step[locale], [locale, step])
  const typedText = fullText.slice(0, visibleChars)
  const textDone = visibleChars >= fullText.length

  useEffect(() => {
    if (!dialogueStarted || leaving) return
    setVisibleChars(0)
  }, [dialogueStarted, leaving, stepIndex])

  useEffect(() => {
    if (!dialogueStarted || leaving || textDone) return
    const timeoutId = window.setTimeout(() => {
      setVisibleChars((count) => Math.min(fullText.length, count + 2))
      sfx.dialogueBlip()
    }, 28)
    return () => window.clearTimeout(timeoutId)
  }, [dialogueStarted, fullText.length, leaving, textDone, visibleChars])

  const startDialogue = () => {
    if (dialogueStarted || leaving) return
    sfx.start()
    playTrack('/audio/kickoff-carnival.mp3')
    if (skipDialogue) {
      setLeaving(true)
      window.setTimeout(onPlay, 560)
      return
    }
    setDialogueStarted(true)
  }

  const openMiniGames = () => {
    if (leaving) return
    sfx.tab()
    playTrack('/audio/kickoff-carnival.mp3')
    setLeaving(true)
    window.setTimeout(() => onMiniGames?.(), 360)
  }

  const advanceDialogue = () => {
    if (!textDone) {
      setVisibleChars(fullText.length)
      return
    }
    if (!step.final) {
      sfx.tab()
      setStepIndex((index) => Math.min(DIALOGUE_STEPS.length - 1, index + 1))
      return
    }
    sfx.start()
    setLeaving(true)
    window.setTimeout(onPlay, 560)
  }

  return (
    <div className={`splash${leaving ? ' is-leaving' : ''}${dialogueStarted ? ` is-dialogue splash--step-${stepIndex + 1}` : ''}`}>
      <div className="splash__frame">
        <div className="splash__bg" />
        {!dialogueStarted ? (
          <div className="splash__content">
            <div className="splash__actions">
              <button type="button" className="splash__mode-button is-primary" onClick={startDialogue}>
                <span className="splash__mode-icon" aria-hidden="true">
                  <svg className="splash__cta-ball" viewBox="0 0 40 40">
                    <ellipse className="splash__cta-ball-shadow" cx="20" cy="37" rx="11" ry="2.6" fill="rgba(0,0,0,.3)" />
                    <g className="splash__cta-ball-body">
                      <circle cx="20" cy="20" r="15" fill="#f8fbff" stroke="#0a1a12" strokeWidth="2.4" />
                      <path d="M20 11 L28 17 L25 26 H15 L12 17 Z" fill="#0a1a12" opacity=".88" />
                      <path d="M20 5 V11 M28 17 L34 14 M25 26 L29 32 M15 26 L11 32 M12 17 L6 14" stroke="#0a1a12" strokeWidth="1.8" strokeLinecap="round" />
                    </g>
                  </svg>
                </span>
                <span className="splash__mode-copy">
                  <b>{locale === 'en' ? 'Adventure' : 'Aventure'}</b>
                  <small>{locale === 'en' ? 'Group stage to final' : "Groupes jusqu'à la finale"}</small>
                </span>
              </button>
              {onMiniGames ? (
                <button type="button" className="splash__mode-button" onClick={openMiniGames}>
                  <span className="splash__mode-icon" aria-hidden="true">MJ</span>
                  <span className="splash__mode-copy">
                    <b>{locale === 'en' ? 'Mini games' : 'Mini jeux'}</b>
                    <small>{locale === 'en' ? 'Survival modes' : 'Modes survie'}</small>
                  </span>
                </button>
              ) : null}
            </div>
            <p className="splash__sub">World Cup Challenge 2026</p>
            <p className="splash__hint">{locale === 'en' ? 'Choose a country · Survive the World Cup' : 'Choisis un pays · Survis à la Coupe du Monde'}</p>
          </div>
        ) : (
          <div className={`splash-dialogue splash-dialogue--${stepIndex + 1}`}>
            <div className="splash-dialogue__box" role="dialog" aria-live="polite">
              <div className="splash-dialogue__head">
                <span>{step.eyebrow[locale]}</span>
                <b>{stepIndex + 1}/3</b>
              </div>
              <p>
                {typedText.split('\n').map((line, index) => (
                  <span key={index}>
                    {line}
                    {index < typedText.split('\n').length - 1 ? <br /> : null}
                  </span>
                ))}
                {!textDone ? <i className="splash-dialogue__cursor" aria-hidden="true" /> : null}
              </p>
              {textDone ? (
                <button type="button" className={`splash-dialogue__next${step.final ? ' is-final' : ''}`} onClick={advanceDialogue}>
                  {step.action[locale]}
                </button>
              ) : (
                <button type="button" className="splash-dialogue__skip" onClick={advanceDialogue}>
                  {locale === 'en' ? 'Show' : 'Afficher'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChallengeSplash
