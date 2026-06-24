import type { ChallengeEntry } from '../types'

export interface ScorePanelProps {
  brackets: ChallengeEntry[]
  activeBracketId: string | null
  onSelect: (id: string) => void
  realResults: Record<string, string>
}

const STAGE_CONFIG = [
  { stage: 'Round of 32', short: 'R32', total: 16 },
  { stage: 'Round of 16', short: 'R16', total: 8 },
  { stage: 'Quarter-final', short: 'QF', total: 4 },
  { stage: 'Semi-final', short: 'SF', total: 2 },
  { stage: 'Finale', short: 'F', total: 1 },
]

function initials(pseudo: string) {
  return pseudo.slice(0, 2).toUpperCase()
}

export function ScorePanel({ brackets, activeBracketId, onSelect, realResults }: ScorePanelProps) {
  const visible = brackets.slice(0, 3)
  const active = visible.find((entry) => entry.id === activeBracketId) ?? visible[0]
  const maxScore = 280

  return (
    <aside className="bksp">
      <div className="bksp__header">📊 Mon Brakup</div>
      <div className="bksp__sep" />

      {active ? <>
        <div className="bksp__user">
          <div className="bksp__avatar">{initials(active.pseudo)}</div>
          <div className="bksp__name">{active.pseudo}</div>
        </div>

        {visible.length > 1 && (
          <div className="bksp__tabs">
            {visible.map((entry) => (
              <button key={entry.id} type="button"
                className={`bksp__tab${entry.id === active.id ? ' is-active' : ''}`}
                onClick={() => onSelect(entry.id)}>
                {entry.bracketName}
              </button>
            ))}
          </div>
        )}

        <div className="bksp__score">
          <span className="bksp__pts">{active.score}<span className="bksp__max"> /{maxScore} pts</span></span>
          <div className="bksp__rank">{active.rank ? `🏅 Rang mondial #${active.rank}` : '🏅 Non classé'}</div>
        </div>

        <div className="bksp__stages">
          {STAGE_CONFIG.map(({ stage, short, total }) => {
            const rows = Object.values(active.breakdown ?? {}).filter((item) => item.stage === stage)
            const correct = rows.filter((item) => item.correct).length
            const played = rows.filter((item) => item.played).length
            const pts = rows.reduce((sum, item) => sum + (item.points ?? 0), 0)
            const pct = played > 0 ? (correct / total) * 100 : 0
            const isPending = played === 0
            return (
              <div key={stage} className="bksp__stage">
                <div className="bksp__stage-meta">
                  <span className="bksp__stage-label">{short} <span className="bksp__stage-count">{isPending ? `–/${total}` : `${correct}/${total}`}</span></span>
                  <span className="bksp__stage-pts">{isPending ? 'pending' : `+${pts} pts`}</span>
                </div>
                <div className="bksp__bar">
                  {!isPending && <div className="bksp__bar-fill" style={{ width: `${pct}%` }} />}
                </div>
              </div>
            )
          })}
        </div>

        <div className="bksp__sep" />

        <div className="bksp__badges">
          {active.submittedAt && <div className="bksp__badge is-green">✅ Early Bird +10</div>}
          {active.battleBonuses > 0 && <div className="bksp__badge is-gold">⚡ Bonus combat +{active.battleBonuses}</div>}
          <div className="bksp__badge is-dim">🏆 {Object.keys(realResults).length} résultat(s) officiel(s)</div>
        </div>

        <div className="bksp__spacer" />
        <button type="button" className="bksp__leaderboard" onClick={() => undefined}>Leaderboard →</button>
      </> : (
        <p className="bksp__empty">Crée ton premier bracket pour suivre ton score.</p>
      )}
    </aside>
  )
}

export default ScorePanel
