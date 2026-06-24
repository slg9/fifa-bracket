import type { BattleRoundType } from '../../types'

export type RoundOutcome = 'goal' | 'saved' | 'intercepted' | 'miss' | 'defense_perfect' | 'goal_conceded'

type RoundResultProps = {
  outcome: RoundOutcome
  roundType: BattleRoundType
  playerScore: number
  opponentScore: number
}

export function RoundResult({ outcome, roundType, playerScore, opponentScore }: RoundResultProps) {
  const successful = outcome === 'goal' || outcome === 'saved' || outcome === 'defense_perfect'
  const title = outcome === 'goal'
    ? 'BUUUT !'
    : outcome === 'saved'
      ? 'ARRETE !'
      : outcome === 'defense_perfect'
        ? 'Defense parfaite !'
        : outcome === 'goal_conceded'
          ? 'BUT ENCAISSE !'
          : outcome === 'intercepted'
            ? 'Interception !'
            : 'Manque !'

  return (
    <section className={`battle-round-result is-${outcome}`}>
      <style>{`
        .battle-round-result{font-family:'Barlow Condensed',sans-serif;background:#050b16;overflow:hidden}
        .battle-round-result.is-goal{background:radial-gradient(90% 50% at 50% 28%,rgba(255,184,0,.16),rgba(5,11,22,0) 60%),#050b16}
        .battle-round-result.is-defense_perfect{background:radial-gradient(90% 50% at 50% 32%,rgba(255,184,0,.18),rgba(5,11,22,0) 62%),#050b16}
        /* Screen flash overlay */
        .battle-round-result::before{content:"";position:absolute;inset:0;pointer-events:none;animation:bk-flash 1.6s ease-out both;z-index:5}
        .battle-round-result.is-goal::before{background:#FFB800}
        .battle-round-result.is-saved::before,.battle-round-result.is-intercepted::before{background:#FF4455}
        .battle-round-result.is-defense_perfect::before{background:#2bff9a}
        .battle-round-result.is-miss::before,.battle-round-result.is-goal_conceded::before{background:rgba(255,255,255,.3)}
        /* Confetti — only on goal / perfect */
        .rr-confetti{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:4}
        .rr-confetti div{position:absolute;top:0;width:7px;height:15px;animation:bk-conf linear infinite}
        /* Visual icon */
        .battle-round-result__visual{position:relative;width:180px;height:180px;z-index:6}
        .battle-round-result__visual svg{width:100%;height:100%;overflow:visible}
        /* Goal rings */
        .battle-result-ring{fill:none;stroke:#FFB800;stroke-width:5;transform-origin:100px 100px;animation:battleResultRing .8s both}
        .battle-result-ray{stroke:#FFB800;stroke-width:5;stroke-linecap:round;stroke-dasharray:90;animation:battleResultRay .7s both}
        /* Keeper glove */
        .battle-result-keeper{display:grid;width:140px;height:140px;place-items:center;margin:20px;border-radius:50%;background:rgba(255,68,85,.2);border:2px solid #FF4455;font-size:72px;animation:battleKeeperJump .8s both;box-shadow:0 0 40px rgba(255,68,85,.35)}
        /* Perfect defense shield */
        .rr-shield{filter:drop-shadow(0 0 24px rgba(255,184,0,.6));animation:bk-pulse 1.6s ease-in-out infinite}
        /* Goal-conceded net */
        .battle-round-result.is-goal_conceded svg circle{fill:#f4f7ff}
        .battle-round-result.is-goal_conceded svg path{fill:#0b1422}
        /* Intercepted badge */
        .battle-round-result.is-intercepted svg circle{fill:#d8aa83}
        .battle-round-result.is-intercepted svg path{fill:#FF4455}
        .battle-result-ball{fill:#f4f7ff!important;stroke:#101827;stroke-width:4;animation:battleCaughtBall .7s both}
        .battle-result-miss{color:#8794a7;font-size:160px;line-height:1;animation:battleMiss .7s both;font-family:'Barlow Condensed',sans-serif}
        /* Text */
        .battle-round-result>span{font:700 11px 'Barlow Condensed',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.45);z-index:6;position:relative}
        .battle-round-result h2{margin:4px 0;font:900 clamp(48px,16vw,96px) 'Barlow Condensed',sans-serif;letter-spacing:.02em;line-height:.9;z-index:6;position:relative}
        .battle-round-result.is-goal h2{color:#FFB800;text-shadow:0 0 4px #FFB800,0 0 24px rgba(255,184,0,.7),3px 3px 0 rgba(255,184,0,.5)}
        .battle-round-result.is-saved h2{color:#FF4455;text-shadow:0 0 24px rgba(255,68,85,.5)}
        .battle-round-result.is-defense_perfect h2{color:#FFB800;text-shadow:0 0 30px rgba(255,184,0,.55)}
        .battle-round-result.is-intercepted h2{color:#2bff9a;text-shadow:0 0 18px rgba(43,255,154,.5)}
        .battle-round-result.is-miss h2,.battle-round-result.is-goal_conceded h2{color:rgba(255,255,255,.55)}
        .battle-round-result p{margin:8px;font:500 13px 'Barlow',sans-serif;color:rgba(255,255,255,.5);z-index:6;position:relative}
        .battle-round-result__score{display:flex;gap:18px;align-items:center;margin-top:16px;z-index:6;position:relative}
        .battle-round-result__score strong{font:800 40px 'JetBrains Mono',monospace}
        .battle-round-result.is-goal .battle-round-result__score strong:first-child,
        .battle-round-result.is-saved .battle-round-result__score strong:first-child,
        .battle-round-result.is-defense_perfect .battle-round-result__score strong:first-child{color:#FFB800;animation:bk-heart 1s ease-in-out infinite;display:inline-block}
        .battle-round-result__score i{color:rgba(255,255,255,.4);font-style:normal;font:400 26px 'JetBrains Mono',monospace}
      `}</style>

      {/* Confetti — only on positive outcomes */}
      {(outcome === 'goal' || outcome === 'defense_perfect') ? (
        <div className="rr-confetti" aria-hidden="true">
          <div style={{ left: '16%', background: '#FFB800', animationDuration: '2.3s' }} />
          <div style={{ left: '38%', background: '#fff', animationDuration: '2.7s', animationDelay: '.3s' }} />
          <div style={{ left: '60%', background: '#FFB800', animationDuration: '2.1s', animationDelay: '.6s' }} />
          <div style={{ left: '78%', background: '#2bff9a', animationDuration: '2.5s', animationDelay: '.15s' }} />
          <div style={{ left: '88%', background: '#FFB800', animationDuration: '2.4s', animationDelay: '.5s' }} />
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
          <div className="battle-result-keeper">{'\uD83E\uDDE4'}</div>
        ) : null}

        {outcome === 'defense_perfect' ? (
          // Design-spec shield with golden ring rays + checkmark
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

        {outcome === 'miss' ? <div className="battle-result-miss">x</div> : null}
      </div>

      <span>{roundType === 'attack' ? "Phase d'attaque" : 'Phase defensive'}</span>
      <h2>{title}</h2>
      <p>{successful ? 'Action reussie !' : "L'adversaire prend le dessus"}</p>
      <div className="battle-round-result__score">
        <strong>{playerScore}</strong>
        <i>—</i>
        <strong>{opponentScore}</strong>
      </div>
    </section>
  )
}

export default RoundResult
