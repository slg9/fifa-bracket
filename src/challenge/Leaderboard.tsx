import { useEffect, useState } from 'react'
import { getLeaderboard } from '../lib/challengeData'
import type { ChallengeEntry } from '../types'

export interface LeaderboardProps { entries?: ChallengeEntry[] }

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#3B82F6,#2bff9a)',
  'linear-gradient(135deg,#FF4455,#FFB800)',
  'linear-gradient(135deg,#8b5cf6,#3B82F6)',
]

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export function Leaderboard({ entries }: LeaderboardProps) {
  const [board, setBoard] = useState<ChallengeEntry[]>(entries ?? [])
  const [loading, setLoading] = useState(!entries)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (entries) return
    getLeaderboard().then(setBoard).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Classement indisponible.')).finally(() => setLoading(false))
  }, [entries])

  const displayedBoard = entries ?? board
  const top50 = displayedBoard.slice(0, 50)
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
      `}</style>
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
                return (
                  <div key={entry.id} className="lb-podium__slot">
                    <div className={`lb-avatar lb-avatar--${rank}`}>{initials(entry.pseudo)}</div>
                    <div className="lb-podium__name">{entry.pseudo}</div>
                    <div className="lb-podium__score">{entry.score ?? 0}</div>
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
                return (
                  <div key={entry.id} className="lb-row">
                    <span className="lb-row__rank">#{rank}</span>
                    <div className="lb-avatar lb-row__avatar" style={{ background: grad }}>{initials(entry.pseudo)}</div>
                    <div className="lb-row__info">
                      <div className="lb-row__name">{entry.pseudo}</div>
                      <div className="lb-row__bar-track">
                        <div className="lb-row__bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="lb-row__score">{score}</span>
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
