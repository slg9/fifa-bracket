import { useEffect, useState } from 'react'
import { getLeaderboard } from '../lib/challengeData'
import type { ChallengeEntry } from '../types'
import type { ProgressSummary } from './progress'

export interface LeaderboardProps {
  entries?: ChallengeEntry[]
  currentEntry?: ChallengeEntry | null
  currentStats?: ProgressSummary
  onBackToGame?: () => void
  onViewBracket?: (entry: ChallengeEntry) => void
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#3B82F6,#2bff9a)',
  'linear-gradient(135deg,#FF4455,#FFB800)',
  'linear-gradient(135deg,#8b5cf6,#3B82F6)',
]

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function breakdownStats(entry: ChallengeEntry): Pick<ProgressSummary, 'correct' | 'exact' | 'scorers'> {
  return Object.values(entry.breakdown ?? {}).reduce((stats, item) => ({
    correct: stats.correct + (item.correct ? 1 : 0),
    exact: stats.exact + (item.exact ? 1 : 0),
    scorers: stats.scorers + (item.scorerHits ?? 0),
  }), { correct: 0, exact: 0, scorers: 0 })
}

export function Leaderboard({ entries, currentEntry = null, currentStats, onBackToGame, onViewBracket }: LeaderboardProps) {
  const [board, setBoard] = useState<ChallengeEntry[]>(entries ?? [])
  const [loading, setLoading] = useState(!entries)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (entries) return
    getLeaderboard().then(setBoard).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Classement indisponible.')).finally(() => setLoading(false))
  }, [entries])

  const sourceBoard = entries ?? board
  const displayedBoard = currentEntry && !sourceBoard.some((entry) => entry.id === currentEntry.id)
    ? [...sourceBoard, currentEntry].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : sourceBoard.map((entry) => currentEntry && entry.id === currentEntry.id ? { ...entry, score: Math.max(entry.score ?? 0, currentEntry.score ?? 0) } : entry)
  const rankedBoard = [...displayedBoard].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.createdAt.localeCompare(b.createdAt))
  const currentInTop = currentEntry ? rankedBoard.slice(0, 50).some((entry) => entry.id === currentEntry.id) : true
  const top50 = currentEntry && !currentInTop
    ? [...rankedBoard.slice(0, 49), currentEntry]
    : rankedBoard.slice(0, 50)
  const podium = top50.slice(0, 3)
  const rest = top50.slice(3)
  const maxScore = top50.length > 0 ? Math.max(...top50.map(e => e.score ?? 0)) : 1

  return (
    <section className="brakup-page brakup-leaderboard">
      <style>{`
        .lb-podium {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 12px;
          margin: 32px 0 40px;
        }
        .lb-podium__slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .lb-podium__name {
          font-family: 'Barlow Condensed','Arial Narrow',sans-serif;
          font-size: 14px;
          font-weight: 700;
          text-align: center;
          color: #eef3ff;
          max-width: 80px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lb-podium__score {
          font: 800 15px 'JetBrains Mono',monospace;
          color: #FFB800;
        }
        .lb-podium__badges, .lb-row__badges {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .lb-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 3px 6px;
          border-radius: 999px;
          font: 900 10px 'Barlow Condensed','Arial Narrow',sans-serif;
          letter-spacing: .06em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .lb-badge--correct {
          color: #2bff9a;
          background: rgba(43,255,154,.12);
          border: 1px solid rgba(43,255,154,.38);
        }
        .lb-badge--exact {
          color: #FFB800;
          background: rgba(255,184,0,.12);
          border: 1px solid rgba(255,184,0,.4);
        }
        .lb-podium__bar {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          padding-top: 12px;
          border-radius: 10px 10px 0 0;
          width: 90px;
        }
        .lb-podium__bar--1 {
          height: 130px;
          background: linear-gradient(180deg,rgba(255,184,0,.3),rgba(255,184,0,.05));
          border: 1px solid rgba(255,184,0,.4);
          box-shadow: 0 0 30px rgba(255,184,0,.25);
        }
        .lb-podium__bar--2, .lb-podium__bar--3 {
          background: linear-gradient(180deg,rgba(192,198,212,.25),rgba(192,198,212,.05));
          border: 1px solid rgba(255,255,255,.1);
        }
        .lb-podium__bar--2 { height: 90px; }
        .lb-podium__bar--3 { height: 72px; }
        .lb-podium__rank {
          font-family: 'Barlow Condensed','Arial Narrow',sans-serif;
          font-size: 18px;
          font-weight: 900;
          color: rgba(255,255,255,.5);
        }
        .lb-avatar {
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-family: 'Barlow Condensed','Arial Narrow',sans-serif;
          font-weight: 800;
          color: #050b16;
          flex-shrink: 0;
        }
        .lb-avatar--1 {
          width: 66px;
          height: 66px;
          font-size: 22px;
          background: linear-gradient(135deg,#FFB800,#ff8a00);
          box-shadow: 0 0 30px rgba(255,184,0,.6);
        }
        .lb-avatar--2 {
          width: 56px;
          height: 56px;
          font-size: 18px;
          background: linear-gradient(135deg,#c0c6d4,#8a90a0);
        }
        .lb-avatar--3 {
          width: 56px;
          height: 56px;
          font-size: 18px;
          background: linear-gradient(135deg,#cd7f4d,#a05a2c);
        }
        .lb-rows {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .lb-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 12px 18px;
          border-radius: 12px;
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.08);
        }
        .lb-row__rank {
          font-family: 'Barlow Condensed','Arial Narrow',sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #68768c;
          width: 28px;
          text-align: right;
          flex-shrink: 0;
        }
        .lb-row__avatar {
          width: 36px;
          height: 36px;
          font-size: 12px;
          flex-shrink: 0;
        }
        .lb-row__info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .lb-row__name {
          font-family: 'Barlow Condensed','Arial Narrow',sans-serif;
          font-size: 15px;
          font-weight: 700;
          color: #eef3ff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lb-row__bar-track {
          height: 4px;
          border-radius: 99px;
          background: rgba(255,255,255,.08);
          overflow: hidden;
        }
        .lb-row__bar-fill {
          height: 100%;
          border-radius: 99px;
          background: #2bff9a;
          transition: width .4s;
        }
        .lb-row__score {
          font: 800 16px 'JetBrains Mono',monospace;
          color: #FFB800;
          flex-shrink: 0;
        }
        .lb-row.is-current {
          border-color: rgba(255,184,0,.45);
          background: rgba(255,184,0,.08);
        }
        .lb-back-game {
          position: fixed;
          right: max(14px, env(safe-area-inset-right));
          top: max(14px, env(safe-area-inset-top));
          z-index: 8;
          min-height: 42px;
          padding: 0 14px;
          border: 1px solid rgba(255,184,0,.48);
          border-radius: 999px;
          background: rgba(255,184,0,.14);
          color: #FFB800;
          font: 900 12px 'Barlow Condensed','Arial Narrow',sans-serif;
          letter-spacing: .1em;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 0 12px 30px rgba(0,0,0,.35);
          backdrop-filter: blur(10px);
        }
        .lb-row__view {
          flex-shrink: 0;
          padding: 6px 10px;
          border: 1px solid rgba(43,255,154,.38);
          border-radius: 8px;
          background: rgba(43,255,154,.12);
          color: #2bff9a;
          font: 900 12px 'Barlow Condensed','Arial Narrow',sans-serif;
          cursor: pointer;
          transition: background-color .2s ease;
        }
        .lb-row__view:hover {
          background: rgba(43,255,154,.2);
        }
      `}</style>
      {onBackToGame ? <button type="button" className="lb-back-game" onClick={onBackToGame}>Retour jeu</button> : null}
      <div className="brakup-page__heading">
        <div>
          <span className="brakup-eyebrow">Top 50 public</span>
          <h1>Leaderboard</h1>
          <p>Les meilleurs sélectionneurs Brakup.</p>
        </div>
      </div>
      {loading ? (
        <p>Chargement du classement…</p>
      ) : error ? (
        <p className="brakup-form-error">{error}</p>
      ) : displayedBoard.length === 0 ? (
        <div className="brakup-empty"><span>🥇</span><h2>Le terrain est encore vide</h2><p>Le classement apparaîtra après les premières validations.</p></div>
      ) : (
        <>
          {podium.length > 0 && (
            <div className="lb-podium">
              {/* Order: #2 left, #1 center, #3 right */}
              {[1, 0, 2].map((idx) => {
                const entry = podium[idx]
                if (!entry) return null
                const rank = idx + 1
                const stats = currentEntry && entry.id === currentEntry.id && currentStats ? currentStats : breakdownStats(entry)
                return (
                  <div key={entry.id} className="lb-podium__slot">
                    <div className={`lb-avatar lb-avatar--${rank}`}>{initials(entry.pseudo)}</div>
                    <div className="lb-podium__name">{entry.pseudo}</div>
                    <div className="lb-podium__score">{entry.score ?? 0}</div>
                    <div className="lb-podium__badges">
                      <span className="lb-badge lb-badge--correct">★ {stats.correct}</span>
                      <span className="lb-badge lb-badge--exact">◎ {stats.exact}</span>
                      <span className="lb-badge lb-badge--exact">⚽ {stats.scorers}</span>
                    </div>
                    <div className={`lb-podium__bar lb-podium__bar--${rank}`}>
                      <span className="lb-podium__rank">#{rank}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {rest.length > 0 && (
            <div className="lb-rows">
              {rest.map((entry, i) => {
                const rank = entry.rank ?? i + 4
                const score = entry.score ?? 0
                const pct = maxScore > 0 ? (score / maxScore) * 100 : 0
                const grad = AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length]
                const isCurrent = Boolean(currentEntry && entry.id === currentEntry.id)
                const stats = isCurrent && currentStats ? currentStats : breakdownStats(entry)
                return (
                  <div key={entry.id} className={`lb-row${isCurrent ? ' is-current' : ''}`}>
                    <span className="lb-row__rank">#{rank}</span>
                    <div className="lb-avatar lb-row__avatar" style={{ background: grad }}>{initials(entry.pseudo)}</div>
                    <div className="lb-row__info">
                      <div className="lb-row__name">{entry.pseudo}</div>
                      <div className="lb-row__badges">
                        <span className="lb-badge lb-badge--correct">★ {stats.correct} pronos</span>
                        <span className="lb-badge lb-badge--exact">◎ {stats.exact} exacts</span>
                        <span className="lb-badge lb-badge--exact">⚽ {stats.scorers} buteurs</span>
                      </div>
                      <div className="lb-row__bar-track">
                        <div className="lb-row__bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="lb-row__score">{score}</span>
                    {onViewBracket && !isCurrent && (
                      <button type="button" className="lb-row__view" onClick={() => onViewBracket(entry)} title="Voir le bracket">
                        👁️
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default Leaderboard
