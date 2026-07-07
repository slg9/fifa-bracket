import { useEffect, useMemo, useState } from 'react'
import { sfx } from '../lib/sfx'
import type { Locale } from '../lib/i18n'
import { playTrack } from '../lib/useGameAudio'

interface ChallengeSplashProps {
  onPlay: () => void
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
    eyebrow: { fr: 'Oups...', en: 'Oops...' },
    fr: "Mais t'étais où ? Tu as raté les premiers matchs de la phase finale de la Coupe du Monde. Oups... Pas grave, champion, on va rattraper ça ensemble !",
    en: "Where were you? You missed the first knockout matches of the World Cup. No worries, champ, we can still catch up together!",
    action: { fr: 'Continuer', en: 'Continue' },
  },
  {
    image: '/challenge-splash-explain.png',
    eyebrow: { fr: 'Comment ça marche', en: 'How it works' },
    fr: "Ici, tu ne fais pas juste un pronostic : tu joues le match en mini-jeu. À la fin, tu obtiens un score, des buteurs et un vainqueur. Si la réalité te donne raison, tu gagnes des points, tu grimpes au classement et tu peux viser le top 3. Tu peux aussi rejouer les matchs déjà joués et tenter de reproduire leur scénario.",
    en: "Here, you do not just predict: you play the match as a mini-game. At the end, you get a score, scorers and a winner. If reality matches your call, you earn points, climb the leaderboard and can chase the top 3. You can also replay finished matches and try to recreate the real scenario.",
    action: { fr: 'Continuer', en: 'Continue' },
  },
  {
    image: '/challenge-splash-letsgo.png',
    eyebrow: { fr: 'À toi de jouer', en: 'Your move' },
    fr: "Prêt à disputer ton premier match ? Tu peux jouer le prochain match ou rejouer ceux déjà passés. À toi, champion !",
    en: "Ready for your first match? You can play the next match or replay the ones already finished. Your move, champion!",
    action: { fr: 'Jouer', en: 'Play' },
    final: true,
  },
]

export const CHALLENGE_DIALOGUE_IMAGES = DIALOGUE_STEPS.map((step) => step.image)

export function ChallengeSplash({ onPlay, locale = 'fr' }: ChallengeSplashProps) {
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
    setDialogueStarted(true)
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
        <a className="splash__close" href="/" aria-label={locale === 'en' ? 'Back to home' : "Retour à l'accueil"}>
          x
        </a>
        {!dialogueStarted ? (
          <div className="splash__content">
            <button type="button" className="splash__cta" onClick={startDialogue}>
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
                <span className="splash__cta-label">{locale === 'en' ? 'PLAY' : 'JOUER'}</span>
              </span>
            </button>
            <p className="splash__sub">World Cup Challenge 2026</p>
            <p className="splash__hint">{locale === 'en' ? 'Build your bracket · Play the matches' : 'Construis ton bracket · Joue les matchs'}</p>
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
