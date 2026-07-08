import { useEffect, useState } from 'react'

type CoinFlipProps = {
  homeTeamName: string
  awayTeamName: string
  homeFlag: string
  awayFlag: string
  homeTeamId: string
  awayTeamId: string
  mode?: 'sudden_death' | 'simulation'
  onComplete: (winnerId: string, score?: { home: number; away: number }, commentary?: string) => void
}

const SIM_COMMENTS = [
  'Match tranche par une sequence folle en fin de rencontre.',
  'La simulation donne un vainqueur net apres un gros duel tactique.',
  "Le rythme s'emballe et une équipe finit par faire craquer la défense.",
  'Scenario serre, mais le dernier temps fort fait basculer le match.',
  'Le sort du match se joue sur quelques details et une frappe decisive.',
]

function makeSimulatedScore(homeWins: boolean) {
  const winnerGoals = Math.floor(Math.random() * 5)
  let loserGoals = Math.floor(Math.random() * 5)
  while (loserGoals === winnerGoals) {
    loserGoals = Math.floor(Math.random() * 5)
  }
  const winner = Math.max(winnerGoals, loserGoals)
  const loser = Math.min(winnerGoals, loserGoals)
  return homeWins ? { home: winner, away: loser } : { home: loser, away: winner }
}

export function CoinFlip({ homeTeamName, awayTeamName, homeFlag, awayFlag, homeTeamId, awayTeamId, mode = 'sudden_death', onComplete }: CoinFlipProps) {
  const [phase, setPhase] = useState<'spinning' | 'revealing' | 'done'>('spinning')
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [score, setScore] = useState<{ home: number; away: number } | null>(null)
  const [commentary, setCommentary] = useState('')

  useEffect(() => {
    // Pick random winner after ~2.6s of spinning
    const pickWinner = () => {
      const winner = Math.random() < 0.5 ? homeTeamId : awayTeamId
      const homeWins = winner === homeTeamId
      setWinnerId(winner)
      if (mode === 'simulation') {
        setScore(makeSimulatedScore(homeWins))
        setCommentary(SIM_COMMENTS[Math.floor(Math.random() * SIM_COMMENTS.length)])
      }
      setPhase('revealing')
    }
    const t1 = setTimeout(pickWinner, 2600)
    const t2 = setTimeout(() => setPhase('done'), 3600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [homeTeamId, awayTeamId, mode])

  const winnerName = winnerId === homeTeamId ? homeTeamName : awayTeamName
  const winnerFlag = winnerId === homeTeamId ? homeFlag : awayFlag
  const isHomeWinner = winnerId === homeTeamId

  return (
    <section className="battle-coin-flip">
      <style>{`
        .battle-coin-flip {
          position: absolute; inset: 0; z-index: 300;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 24px; padding: 40px 20px;
          background: radial-gradient(130% 50% at 50% 40%, rgba(255,184,0,.12), rgba(5,11,22,0) 60%), #050b16;
          font-family: 'Barlow Condensed', sans-serif;
          text-align: center;
        }
        .battle-coin-flip__message {
          font: 500 16px 'Barlow', sans-serif;
          color: #a8b8cc;
          max-width: 340px;
          line-height: 1.5;
          animation: coinFadeIn .5s both;
        }
        .battle-coin-flip__message b {
          color: #FFB800;
          font-weight: 700;
        }
        .battle-coin-flip__coin {
          position: relative;
          width: 130px; height: 130px;
          perspective: 600px;
        }
        .battle-coin-flip__coin-inner {
          position: relative;
          width: 100%; height: 100%;
          transform-style: preserve-3d;
          animation: coinSpin3d .55s linear infinite;
        }
        .battle-coin-flip__coin.is-revealing .battle-coin-flip__coin-inner {
          animation: coinSpin3dSlow 1s ease-out forwards;
        }
        .battle-coin-flip__coin.is-done .battle-coin-flip__coin-inner {
          animation: none;
          transform: rotateY(${isHomeWinner ? '0deg' : '180deg'});
        }
        .battle-coin-flip__coin-face {
          position: absolute; inset: 0;
          backface-visibility: hidden;
          border-radius: 50%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #FFB800 0%, #e5a600 40%, #FFB800 60%, #cc9400 100%);
          border: 6px solid #b8860b;
          box-shadow: 0 0 40px rgba(255,184,0,.45), inset 0 0 30px rgba(255,255,255,.2);
          overflow: hidden;
        }
        .battle-coin-flip__coin-face::before {
          content: '';
          position: absolute; inset: 12px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,.3);
          pointer-events: none;
        }
        .battle-coin-flip__coin-face--back {
          transform: rotateY(180deg);
        }
        .battle-coin-flip__coin-flag {
          font-size: 36px;
          line-height: 1;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,.3));
        }
        .battle-coin-flip__coin-label {
          font: 900 10px 'Barlow Condensed', sans-serif;
          color: rgba(0,0,0,.55);
          letter-spacing: .1em;
          text-transform: uppercase;
          margin-top: 2px;
        }
        .battle-coin-flip__result {
          display: flex; flex-direction: column; align-items: center;
          gap: 8px;
          animation: coinResultPop .5s cubic-bezier(.22,1,.36,1) both;
        }
        .battle-coin-flip__result-eyebrow {
          font: 700 11px 'Barlow Condensed', sans-serif;
          letter-spacing: .2em;
          color: rgba(255,255,255,.45);
          text-transform: uppercase;
        }
        .battle-coin-flip__result-name {
          font: 900 clamp(28px, 8vw, 44px) 'Barlow Condensed', sans-serif;
          color: #FFB800;
          text-shadow: 0 0 30px rgba(255,184,0,.5);
          letter-spacing: .02em;
        }
        .battle-coin-flip__result-flag {
          font-size: 48px;
          filter: drop-shadow(0 0 20px rgba(255,184,0,.3));
        }
        .battle-coin-flip__btn {
          width: min(100%, 300px);
          height: 58px;
          border: none;
          border-radius: 16px;
          background: linear-gradient(90deg, #FFB800, #ff9a00);
          color: #1a1100;
          font: 900 16px 'Barlow Condensed', sans-serif;
          letter-spacing: .06em;
          cursor: pointer;
          box-shadow: 0 4px 24px rgba(255,184,0,.35);
          animation: coinBtnIn .4s both;
        }
        @keyframes coinSpin3d {
          to { transform: rotateY(360deg); }
        }
        @keyframes coinSpin3dSlow {
          0% { transform: rotateY(var(--coin-angle, 0deg)); }
          100% { transform: rotateY(calc(var(--coin-angle, 0deg) + 720deg + ${isHomeWinner ? '0deg' : '180deg'})); }
        }
        @keyframes coinFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes coinResultPop {
          from { opacity: 0; transform: translateY(20px) scale(.9); }
          to { opacity: 1; transform: none; }
        }
        @keyframes coinBtnIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
      `}</style>

      {phase === 'spinning' && (
        <p className="battle-coin-flip__message">
          {mode === 'simulation' ? <><b>Simulation du match</b> — Le moteur lance un scénario express.<br /><b>Un vainqueur sera désigné.</b></> : <><b>Mort subite</b> — Après une bataille acharnée sans vainqueur,<br />le hasard décide. <b>On tire à pile ou face !</b></>}
        </p>
      )}

      <div className={`battle-coin-flip__coin${phase === 'revealing' || phase === 'done' ? ' is-revealing' : ''}${phase === 'done' ? ' is-done' : ''}`}
        style={phase === 'revealing' ? { ['--coin-angle' as string]: `${Math.floor(Math.random() * 360)}deg` } : undefined}>
        <div className="battle-coin-flip__coin-inner">
          <div className="battle-coin-flip__coin-face battle-coin-flip__coin-face--front">
            <span className="battle-coin-flip__coin-flag">{homeFlag}</span>
            <span className="battle-coin-flip__coin-label">{homeTeamName.slice(0, 3).toUpperCase()}</span>
          </div>
          <div className="battle-coin-flip__coin-face battle-coin-flip__coin-face--back">
            <span className="battle-coin-flip__coin-flag">{awayFlag}</span>
            <span className="battle-coin-flip__coin-label">{awayTeamName.slice(0, 3).toUpperCase()}</span>
          </div>
        </div>
      </div>

      {(phase === 'revealing' || phase === 'done') && winnerName && (
        <div className="battle-coin-flip__result">
          <span className="battle-coin-flip__result-eyebrow">Le sort a parlé</span>
          <span className="battle-coin-flip__result-flag">{winnerFlag}</span>
          <span className="battle-coin-flip__result-name">{winnerName}</span>
          {score ? <span className="battle-coin-flip__message"><b>{score.home} - {score.away}</b><br />{commentary}</span> : null}
          {phase === 'done' && (
            <button type="button" className="battle-coin-flip__btn" onClick={() => onComplete(winnerId!, score ?? undefined, commentary || undefined)}>
              Continuer <span>→</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default CoinFlip
