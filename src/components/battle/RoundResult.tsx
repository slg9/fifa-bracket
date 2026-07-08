import { useMemo } from 'react'
import type { BattleRoundType } from '../../types'
import type { TeamKit } from '../../lib/teamKits'
import KawaiiSprite, { KAWAII_SPRITE_CSS } from './KawaiiSprite'

export type RoundOutcome = 'goal' | 'saved' | 'intercepted' | 'miss' | 'defense_perfect' | 'goal_conceded'

const MANUAL_CONTINUE_OUTCOMES: RoundOutcome[] = ['goal', 'saved', 'defense_perfect', 'goal_conceded', 'intercepted', 'miss']

type RoundResultProps = {
  outcome: RoundOutcome
  roundType: BattleRoundType
  playerScore: number
  opponentScore: number
  homeFlag?: string
  awayFlag?: string
  scorerName?: string
  keeperName?: string
  playerKit?: TeamKit
  opponentName?: string
  nextRoundType?: BattleRoundType | null
  onContinue?: () => void
  onRetry?: () => void
}

const GOAL_CALLS = [
  'GOOOOOOAL !', 'GOLAZO !!!', 'MAGNIFIQUE !', 'IL MARQUE !!!',
  'COUP DE MAÎTRE !', 'FANTASTIQUE !', 'INCROYABLE !!!', 'QUEL BUT !!!',
]
const GOAL_WARNINGS = [
  "But important, on reste lucide pour la suite.",
  "Avantage pris, mais le prochain duel compte encore.",
  'Le score bouge, il faut garder le contrôle.',
  "Belle finition, le match continue.",
  "L'adversaire va devoir réagir.",
  'Reste concentré, le prochain round arrive vite.',
]
const CONCEDE_CALLS = [
  'Aïe... le gardien a été battu.',
  'Quel coup dur pour la défense !',
  'Il fallait le voir venir...',
  "Le gardien n'a rien pu faire.",
  'Les filets tremblent ! Douloureux.',
  'Une frappe imparable pour le portier !',
]
const CONCEDE_ENCOURAGEMENTS = [
  "But encaissé, il faut regarder la suite du match.",
  "La défense a cédé, le prochain round dira si ça bascule.",
  "Le score change, reste focus.",
  'Coup dur, mais la séquence suivante arrive.',
  "Le match avance, chaque round compte.",
]
const MISS_ENCOURAGEMENTS = [
  'Occasion manquée, on regarde la suite.',
  'Le mouvement était là - il faut finir le travail.',
  'Tu y étais presque, le match continue.',
  'Garde le rythme pour la prochaine phase.',
]
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function phaseLabel(roundType: BattleRoundType) {
  if (roundType === 'attack') return "Phase d'attaque"
  if (roundType === 'defense') return 'Phase défense'
  return 'Tirs massifs'
}

function retryLabelFor(roundType: BattleRoundType, outcome: RoundOutcome) {
  if (roundType === 'attack' && outcome === 'miss') return 'Réessayer le tir'
  if (roundType === 'attack') return "Réessayer l'attaque"
  if (roundType === 'defense') return 'Réessayer la défense'
  return 'Réessayer les tirs massifs'
}

export function roundResultNeedsClick(outcome: RoundOutcome) {
  return MANUAL_CONTINUE_OUTCOMES.includes(outcome)
}

export function RoundResult({ outcome, roundType, playerScore, opponentScore, homeFlag, awayFlag, scorerName, keeperName, playerKit, opponentName, nextRoundType, onContinue, onRetry }: RoundResultProps) {
  const title = outcome === 'goal'
    ? 'BUT !'
    : outcome === 'saved'
      ? 'ARRÊT !'
      : outcome === 'defense_perfect'
        ? 'BRAVO !'
        : outcome === 'goal_conceded'
          ? 'BUT ENCAISSÉ !'
          : outcome === 'intercepted'
            ? 'BALLON PERDU !'
            : 'RATÉ !'

  const nextPhaseHint = useMemo(() => {
    if (!nextRoundType) return 'Coup de sifflet : le résultat du match arrive.'
    if (nextRoundType === 'attack') return "Prochaine phase : attaque. Il faut dribbler puis finir l'action."
    if (nextRoundType === 'defense') return "Prochaine phase : défense. L'adversaire lance son offensive."
    return 'Prochaine phase : Tirs massifs. Coupe les ballons.'
  }, [nextRoundType])

  const commentary = useMemo(() => {
    if (outcome === 'goal') {
      const shout = pick(GOAL_CALLS)
      const scorer = scorerName ? `${scorerName} est magistral !` : 'La finition est clinique !'
      return { accent: '#FFB800', main: shout, sub: `${scorer} ${pick(GOAL_WARNINGS)} ${nextPhaseHint}` }
    }
    if (outcome === 'goal_conceded') {
      const call = pick(CONCEDE_CALLS)
      const keeper = keeperName ? `${keeperName} s'en mord les doigts.` : 'Le portier a tout tenté.'
      return { accent: '#FF4455', main: call, sub: `${keeper} ${pick(CONCEDE_ENCOURAGEMENTS)} ${nextPhaseHint}` }
    }
    if (outcome === 'intercepted') {
      return { accent: '#FF4455', main: 'Ballon perdu.', sub: 'Tu peux rejouer cette attaque ou tenter le Goal Save.' }
    }
    if (outcome === 'miss') {
      const sub = scorerName ? `${scorerName} rate sa frappe. Tu n'as pas lâché le ballon au bon moment. ${pick(MISS_ENCOURAGEMENTS)}` : `Tu n'as pas lâché le ballon au bon moment. ${pick(MISS_ENCOURAGEMENTS)}`
      return { accent: '#8794a7', main: 'Timing manqué.', sub }
    }
    if (outcome === 'saved') {
      if (roundType === 'attack') {
        const keeper = 'Aïe, le gardien a intercepté la balle malgré ton super tir.'
        const sub = scorerName
          ? `${scorerName} avait bien frappé. ${nextPhaseHint}`
          : `${opponentName ? `${opponentName} va devoir s'y reprendre.` : "L'attaque adverse est repoussée."} ${nextPhaseHint}`
        return { accent: '#2bff9a', main: keeper, sub }
      }
      const keeper = keeperName ? `${keeperName} sort la frappe !` : 'Ton gardien sort la frappe !'
      const sub = `${opponentName ? `${opponentName} est stoppé.` : "L'attaque adverse est repoussée."} ${nextPhaseHint}`
      return { accent: '#2bff9a', main: keeper, sub }
    }
    if (outcome === 'defense_perfect') {
      return { accent: '#2bff9a', main: 'Tu as bloqué tous les tirs !', sub: `Tu gagnes un tir bonus. ${nextPhaseHint}` }
    }
    return null
  }, [keeperName, nextPhaseHint, opponentName, outcome, roundType, scorerName])

  const showButton = roundResultNeedsClick(outcome)
  const retryLabel = retryLabelFor(roundType, outcome)
  const buttonLabel = outcome === 'intercepted' ? 'Bloquer le tir' : 'Continuer'
  const isSuccessOutcome = outcome === 'goal' || outcome === 'saved' || outcome === 'defense_perfect'
  const showRetryButton = Boolean(onRetry) && !isSuccessOutcome

  return (
    <section className={`battle-round-result is-${outcome}`}>
      <style>{`
        .battle-round-result{font-family:'Barlow Condensed',sans-serif;background:#050b16;overflow-y:auto;overflow-x:hidden;justify-content:flex-start;min-height:100%;padding:clamp(18px,4.5vh,42px) 16px max(18px,env(safe-area-inset-bottom));-webkit-overflow-scrolling:touch}
        .battle-round-result.is-goal{background:radial-gradient(90% 50% at 50% 28%,rgba(255,184,0,.16),rgba(5,11,22,0) 60%),#050b16}
        .battle-round-result.is-defense_perfect{background:radial-gradient(90% 50% at 50% 32%,rgba(255,184,0,.18),rgba(5,11,22,0) 62%),#050b16}
        .battle-round-result::before{content:"";position:absolute;inset:0;pointer-events:none;animation:bk-flash 1.6s ease-out both;z-index:5}
        .battle-round-result.is-goal::before{background:#FFB800}
        .battle-round-result.is-saved::before{background:#2bff9a}
        .battle-round-result.is-intercepted::before{background:#FF4455}
        .battle-round-result.is-defense_perfect::before{background:#2bff9a}
        .battle-round-result.is-miss::before,.battle-round-result.is-goal_conceded::before{background:rgba(255,255,255,.3)}
        .rr-confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:4}
        .rr-confetti div{position:absolute;top:0;width:7px;height:15px;animation:bk-conf linear infinite}
        .battle-round-result__visual{position:relative;width:clamp(104px,22vh,160px);height:clamp(104px,22vh,160px);z-index:6;flex:0 0 auto}
        .battle-round-result__visual svg{width:100%;height:100%;overflow:visible}
        .battle-result-ring{fill:none;stroke:#FFB800;stroke-width:5;transform-origin:100px 100px;animation:battleResultRing .8s both}
        .battle-result-ray{stroke:#FFB800;stroke-width:5;stroke-linecap:round;stroke-dasharray:90;animation:battleResultRay .7s both}
        ${KAWAII_SPRITE_CSS}
        .battle-result-keeper{display:grid;width:132px;height:132px;place-items:center;margin:14px;border-radius:50%;background:radial-gradient(circle,rgba(43,255,154,.24),rgba(43,255,154,.08) 58%,transparent 72%);border:2px solid #2bff9a;color:#2bff9a;animation:battleKeeperJump .8s both;box-shadow:0 0 40px rgba(43,255,154,.32)}
        .battle-result-keeper .kw-sprite{width:92px;height:112px;filter:drop-shadow(0 10px 14px rgba(0,0,0,.44));animation:rrKeeperDance .42s ease-in-out infinite alternate}
        .rr-shield{filter:drop-shadow(0 0 24px rgba(255,184,0,.6));animation:bk-pulse 1.6s ease-in-out infinite}
        .battle-round-result.is-goal_conceded svg circle{fill:#f4f7ff}
        .battle-round-result.is-goal_conceded svg path{fill:#0b1422}
        .battle-round-result.is-intercepted svg circle{fill:#d8aa83}
        .battle-round-result.is-intercepted svg path{fill:#FF4455}
        .battle-result-ball{fill:#f4f7ff!important;stroke:#101827;stroke-width:4;animation:battleCaughtBall .7s both}
        .battle-result-miss{color:#8794a7;font-size:clamp(76px,17vh,120px);line-height:1;animation:battleMiss .7s both;font-family:'Barlow Condensed',sans-serif}
        .battle-round-result>span{font:700 11px 'Barlow Condensed',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.45);z-index:6;position:relative}
        .battle-round-result h2{box-sizing:border-box;max-width:calc(100% - 18px);margin:2px auto 10px;padding:0 .08em .08em;font:900 clamp(34px,10.2vw,66px) 'Barlow Condensed',sans-serif;letter-spacing:.01em;line-height:1.08;z-index:6;position:relative;text-align:center;white-space:nowrap;overflow:visible}
        .battle-round-result.is-defense_perfect h2{max-width:min(340px,calc(100% - 20px));font-size:clamp(32px,8.8vw,56px);white-space:normal;line-height:.96}
        .battle-round-result.is-goal h2{color:#FFB800;text-shadow:0 0 4px #FFB800,0 0 24px rgba(255,184,0,.7),3px 3px 0 rgba(255,184,0,.5)}
        .battle-round-result.is-saved h2{color:#2bff9a;text-shadow:0 0 24px rgba(43,255,154,.55)}
        .battle-round-result.is-defense_perfect h2{color:#FFB800;text-shadow:0 0 30px rgba(255,184,0,.55)}
        .battle-round-result.is-intercepted h2{color:#2bff9a;text-shadow:0 0 18px rgba(43,255,154,.5)}
        .battle-round-result.is-miss h2,.battle-round-result.is-goal_conceded h2{color:rgba(255,255,255,.72)}
        .battle-round-result.is-goal_conceded h2{white-space:normal;font-size:clamp(30px,8vw,54px);line-height:.96;max-width:min(330px,calc(100% - 16px))}
        .rr-commentary{z-index:6;position:relative;max-width:320px;display:grid;gap:8px;margin-top:4px;padding:14px 16px;border-left:3px solid var(--rr-accent, rgba(255,255,255,.35));border-radius:0 12px 12px 0;background:rgba(10,21,38,.86);animation:commentaryIn .3s both}
        .rr-commentary__main{font:700 clamp(14px,4vw,17px) 'Barlow Condensed',sans-serif;color:#fff;line-height:1.35}
        .rr-commentary__sub{font:500 clamp(11px,3.5vw,13px) 'Barlow',sans-serif;color:rgba(255,255,255,.58);line-height:1.45}
        .rr-shot-gauge{z-index:6;position:relative;width:min(260px,78vw);display:grid;gap:6px;margin-top:8px;color:rgba(255,255,255,.72);font:900 10px 'Barlow Condensed',sans-serif;letter-spacing:.13em;text-align:center;text-transform:uppercase}
        .rr-shot-gauge__track{position:relative;height:13px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;border:1px solid rgba(255,255,255,.12)}
        .rr-shot-gauge__green{position:absolute;left:42%;top:0;bottom:0;width:24%;background:#2bff9a;box-shadow:0 0 16px rgba(43,255,154,.72)}
        .rr-shot-gauge__cursor{position:absolute;top:-4px;bottom:-4px;left:0;width:8px;border-radius:999px;background:#fff;box-shadow:0 0 12px rgba(255,255,255,.9);animation:rrGaugeStop 1.05s cubic-bezier(.2,.88,.22,1) both}
        .rr-actions{z-index:6;position:relative;display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:14px}
        .rr-continue-btn,.rr-retry-btn{padding:11px 24px;border-radius:12px;font:800 15px 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer}
        .rr-continue-btn{border:1.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.07);color:#fff;animation:bk-btn 2s ease-in-out infinite}
        .rr-retry-btn{border:1.5px solid rgba(255,184,0,.9);background:linear-gradient(180deg,rgba(255,184,0,.24),rgba(255,184,0,.08));color:#FFB800;box-shadow:0 0 26px rgba(255,184,0,.38);animation:rrRetryGold .82s ease-in-out infinite alternate}
        .battle-round-result__score{display:flex;gap:14px;align-items:center;margin-top:12px;z-index:6;position:relative}
        .battle-round-result__score strong{font:800 36px 'JetBrains Mono',monospace}
        .battle-round-result__score-flag{display:grid;place-items:center;min-width:30px;font-size:28px;line-height:1;filter:drop-shadow(0 0 10px rgba(255,255,255,.22))}
        .battle-round-result.is-goal .battle-round-result__score strong:first-child,
        .battle-round-result.is-saved .battle-round-result__score strong:first-child,
        .battle-round-result.is-defense_perfect .battle-round-result__score strong:first-child{color:#FFB800;animation:bk-heart 1s ease-in-out infinite;display:inline-block}
        .battle-round-result__score i{color:rgba(255,255,255,.4);font-style:normal;font:400 26px 'JetBrains Mono',monospace}
        @media (max-height: 680px) {
          .battle-round-result{padding-top:14px;gap:4px}
          .battle-round-result__visual{width:96px;height:96px}
          .battle-result-keeper{width:82px;height:82px;margin:7px;font-size:42px}
          .battle-round-result h2{margin:0 auto 4px;font-size:clamp(30px,8vw,48px)}
          .battle-round-result.is-goal_conceded h2{font-size:clamp(28px,7.8vw,42px)}
          .rr-commentary{max-width:min(310px,calc(100% - 18px));padding:10px 12px;gap:5px}
          .rr-commentary__main{font-size:14px;line-height:1.18}
          .rr-commentary__sub{font-size:11px;line-height:1.26}
          .battle-round-result__score{margin-top:6px}
          .battle-round-result__score strong{font-size:28px}
          .rr-actions{margin-top:8px;gap:7px}
          .rr-continue-btn,.rr-retry-btn{padding:10px 16px;font-size:13px}
        }
        @keyframes rrRetryGold{from{filter:brightness(.92);box-shadow:0 0 14px rgba(255,184,0,.26)}to{filter:brightness(1.25);box-shadow:0 0 34px rgba(255,184,0,.72)}}
        @keyframes rrKeeperDance{from{transform:translateY(5px) rotate(-4deg) scale(1)}to{transform:translateY(-8px) rotate(4deg) scale(1.04)}}
        @keyframes rrGaugeStop{0%{left:4%}34%{left:94%}68%{left:18%}100%{left:54%}}
      `}</style>

      {(outcome === 'goal' || outcome === 'defense_perfect') ? (
        <div className="rr-confetti" aria-hidden="true">
          {[
            { left: '8%',  bg: '#FFB800', dur: '2.1s', delay: '0s' },
            { left: '18%', bg: '#2bff9a', dur: '2.5s', delay: '.12s' },
            { left: '30%', bg: '#fff',    dur: '1.9s', delay: '.28s' },
            { left: '42%', bg: '#FFB800', dur: '2.3s', delay: '.08s' },
            { left: '54%', bg: '#ff4455', dur: '2.6s', delay: '.44s' },
            { left: '64%', bg: '#FFB800', dur: '2.0s', delay: '.2s' },
            { left: '74%', bg: '#2bff9a', dur: '2.4s', delay: '.36s' },
            { left: '84%', bg: '#fff',    dur: '2.2s', delay: '.56s' },
            { left: '92%', bg: '#FFB800', dur: '1.8s', delay: '.16s' },
          ].map((c, i) => (
            <div key={i} style={{ left: c.left, background: c.bg, animationDuration: c.dur, animationDelay: c.delay }} />
          ))}
        </div>
      ) : null}

      <div className="battle-round-result__visual" aria-hidden="true">
        {outcome === 'goal' ? (
          <svg viewBox="0 0 200 200">
            {[20, 42, 68].map((radius, index) => (
              <circle key={radius} className="battle-result-ring" cx="100" cy="100" r={radius} style={{ animationDelay: `${index * .1}s` }} />
            ))}
            {Array.from({ length: 12 }, (_, index) => (
              <line key={index} className="battle-result-ray" x1="100" y1="100"
                x2={100 + Math.cos(index * Math.PI / 6) * 90} y2={100 + Math.sin(index * Math.PI / 6) * 90} />
            ))}
          </svg>
        ) : null}

        {outcome === 'saved' ? (
          <div className="battle-result-keeper">
            <KawaiiSprite
              label={keeperName?.split(' ').pop()?.slice(0, 7).toUpperCase() ?? 'GK'}
              jerseyColor={playerKit?.primary ?? '#2bff9a'}
              accentColor={playerKit?.secondary ?? '#FFB800'}
              shortsColor={playerKit?.shorts ?? '#101827'}
              textColor={playerKit?.text ?? '#ffffff'}
              role="keeper"
              motion="ready"
              seed={keeperName ?? 'round-result-keeper'}
              width={92}
              height={112}
            />
          </div>
        ) : null}

        {outcome === 'defense_perfect' ? (
          <svg viewBox="0 0 200 200" className="rr-shield">
            <g stroke="#FFB800" strokeWidth="2.5" strokeLinecap="round" opacity=".7">
              <path d="M100 12 V2 M100 198 V188 M12 100 H2 M198 100 H188 M28 28 l-7 -7 M172 28 l7 -7 M28 172 l-7 7 M172 172 l7 7" />
            </g>
            <path d="M100 20 L156 42 V90 C156 130 100 158 100 158 C100 158 44 130 44 90 V42 Z" fill="rgba(255,184,0,.12)" stroke="#FFB800" strokeWidth="3" />
            <path d="M76 98 l16 18 32 -38" stroke="#FFB800" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}

        {outcome === 'goal_conceded' ? (
          <svg viewBox="0 0 200 200">
            <path d="M25 155V35H175V155M25 65H175M55 35V155M95 35V155M135 35V155" fill="none" stroke="#9aa8ba" strokeWidth="5" opacity=".65" />
            <circle cx="115" cy="118" r="28" fill="#f4f7ff" stroke="#111827" strokeWidth="6" />
            <path d="m115 96 13 9-5 16h-16l-5-16Z" fill="#111827" />
          </svg>
        ) : null}

        {outcome === 'intercepted' ? (
          <svg viewBox="0 0 160 160">
            <circle cx="80" cy="52" r="22" />
            <path d="M42 78 Q80 58 118 78 L106 135H54Z" />
            <circle className="battle-result-ball" cx="80" cy="125" r="15" />
          </svg>
        ) : null}

        {outcome === 'miss' ? <div className="battle-result-miss">X</div> : null}
      </div>

      <span>{phaseLabel(roundType)}</span>
      <h2>{title}</h2>

      {commentary ? (
        <div className="rr-commentary" style={{ ['--rr-accent' as string]: commentary.accent }}>
          <div className="rr-commentary__main">{commentary.main}</div>
          <div className="rr-commentary__sub">{commentary.sub}</div>
        </div>
      ) : null}

      {outcome === 'miss' && roundType === 'attack' ? (
        <div className="rr-shot-gauge" aria-hidden="true">
          <span>Relâche quand le curseur est dans le vert</span>
          <div className="rr-shot-gauge__track">
            <i className="rr-shot-gauge__green" />
            <i className="rr-shot-gauge__cursor" />
          </div>
        </div>
      ) : null}

      <div className="battle-round-result__score">
        {homeFlag ? <span className="battle-round-result__score-flag">{homeFlag}</span> : null}
        <strong>{playerScore}</strong>
        <i>-</i>
        <strong>{opponentScore}</strong>
        {awayFlag ? <span className="battle-round-result__score-flag">{awayFlag}</span> : null}
      </div>

      {showButton && (onContinue || showRetryButton) ? (
        <div className="rr-actions">
          {showRetryButton ? (
            <button type="button" className="rr-retry-btn" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {onContinue ? (
            <button type="button" className="rr-continue-btn" onClick={onContinue}>
              {buttonLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default RoundResult
