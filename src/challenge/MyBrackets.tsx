import type { ChallengeEntry } from '../types'

export interface MyBracketsProps {
  brackets: ChallengeEntry[]
  loading?: boolean
  onOpen: (entry: ChallengeEntry) => void
  onCreate: () => void
}

export function MyBrackets({ brackets, loading = false, onOpen, onCreate }: MyBracketsProps) {
  return (
    <section className="brakup-page brakup-my-brackets">
      <style>{`
        .mb-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 40px;
        }
        .mb-new-btn {
          padding: 9px 16px;
          border-radius: 99px;
          background: rgba(255,184,0,.12);
          border: 1px solid rgba(255,184,0,.5);
          color: #FFB800;
          font: 700 13px Barlow,sans-serif;
          cursor: pointer;
        }
        .mb-card {
          padding: 20px;
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 16px;
          background: var(--brakup-panel, rgba(10,20,37,.88));
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .mb-card__top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .mb-card__status {
          font: 700 12px Barlow,sans-serif;
          color: #2bff9a;
        }
        .mb-card__date {
          font: 500 11px Barlow,sans-serif;
          color: rgba(255,255,255,.4);
        }
        .mb-card__name {
          font: 800 17px 'Barlow Condensed','Arial Narrow',sans-serif;
          letter-spacing: .03em;
          text-transform: uppercase;
          color: #eef3ff;
          margin: 0;
        }
        .mb-card__score-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .mb-card__score {
          font: 800 22px 'JetBrains Mono',monospace;
          color: #FFB800;
        }
        .mb-card__score-denom {
          font: 600 13px Barlow,sans-serif;
          color: rgba(255,255,255,.4);
        }
        .mb-card__rank {
          font: 700 12px Barlow,sans-serif;
          color: #2bff9a;
          margin-left: auto;
        }
        .mb-card__finale {
          font: 500 11px Barlow,sans-serif;
          color: rgba(255,255,255,.45);
          border-top: 1px solid rgba(255,255,255,.07);
          padding-top: 10px;
        }
        .mb-card__finale strong {
          color: #eef3ff;
          font-weight: 700;
        }
        .mb-card__footer {
          display: flex;
          justify-content: flex-end;
        }
        .mb-view-btn {
          padding: 7px 16px;
          border-radius: 99px;
          background: transparent;
          border: 1px solid rgba(255,255,255,.2);
          color: rgba(255,255,255,.7);
          font: 700 12px Barlow,sans-serif;
          cursor: pointer;
        }
      `}</style>
      <div className="mb-heading">
        <div>
          <span className="brakup-eyebrow">Espace personnel</span>
          <h1>Mes brackets</h1>
        </div>
        <button type="button" className="mb-new-btn" onClick={onCreate}>+ Nouveau</button>
      </div>
      {loading ? (
        <p>Chargement…</p>
      ) : brackets.length === 0 ? (
        <div className="brakup-empty">
          <span>🏆</span>
          <h2>Aucun bracket sauvegardé</h2>
          <p>Compose tes choix puis sauvegarde-les ici.</p>
          <button type="button" className="brakup-button" onClick={onCreate}>Créer mon bracket</button>
        </div>
      ) : (
        <div className="brakup-card-grid">
          {brackets.map((entry) => {
            const finalistId = entry.picks['M104'] ?? null
            return (
              <article className="mb-card" key={entry.id}>
                <div className="mb-card__top">
                  <span className="mb-card__status">{entry.submittedAt ? 'Validé' : 'Brouillon'}</span>
                  <small className="mb-card__date">{new Date(entry.createdAt).toLocaleDateString('fr-FR')}</small>
                </div>
                <h2 className="mb-card__name">{entry.bracketName}</h2>
                <div className="mb-card__score-row">
                  <span className="mb-card__score">{entry.score}</span>
                  <span className="mb-card__score-denom">/280</span>
                  {entry.rank && <span className="mb-card__rank">#{entry.rank} mondial</span>}
                </div>
                {finalistId && (
                  <div className="mb-card__finale">
                    Ta finale · <strong>{finalistId}</strong>
                  </div>
                )}
                <div className="mb-card__footer">
                  <button type="button" className="mb-view-btn" onClick={() => onOpen(entry)}>Voir →</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default MyBrackets
