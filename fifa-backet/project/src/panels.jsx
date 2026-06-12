/* panels.jsx — pronostics (odds) + buteurs (window.OddsPanel, ScorersPanel) */
const { useMemo } = React;

function OddsPanel({ results, ko, focusId, onFocus, source, onSyncOdds, syncing }) {
  const odds = useMemo(() => window.ENG.titleOdds(results, ko), [results, ko]);
  const top = odds.filter((o) => o.pct > 0.05).slice(0, 12);
  const max = top.length ? top[0].pct : 100;

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <div className="panel__title">Pronostics de victoire</div>
          <div className="panel__sub">% de la communauté qui voit cette nation championne</div>
        </div>
        <button className={"oddsync" + (syncing ? " is-busy" : "")} onClick={onSyncOdds} title="Recalculer les cotes">
          {syncing ? "···" : "↻ Cotes"}
        </button>
      </div>
      <div className="odds">
        {top.map((o, i) => {
          const lit = focusId === o.team.id;
          return (
            <button key={o.team.id} className={"oddrow" + (lit ? " is-focus" : "")}
              onClick={() => onFocus(o.team.id)}>
              <span className="oddrow__rank">{i + 1}</span>
              <span className="flag" style={{ fontSize: 18 }}>{o.team.flag}</span>
              <span className="oddrow__name">{o.team.name}</span>
              <span className="oddrow__bar"><span className="oddrow__fill" style={{ width: Math.max(3, (o.pct / max) * 100) + "%" }} /></span>
              <span className="oddrow__pct">{o.pct >= 9.95 ? o.pct.toFixed(0) : o.pct.toFixed(1)}%</span>
            </button>
          );
        })}
        {top.length === 0 && <div className="panel__empty">Lance des simulations pour voir les cotes évoluer.</div>}
      </div>
      <div className="panel__foot">
        <span className={"srcdot srcdot--" + (source === "live" ? "live" : "sim")} />
        {source === "live" ? "Données synchronisées" : "Modèle interne (force + parcours)"}
      </div>
    </div>
  );
}

function ScorersPanel({ results, ko, onFocus }) {
  const list = useMemo(() => window.ENG.topScorers(results, ko), [results, ko]);
  const top = list.slice(0, 10);
  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <div className="panel__title">Soulier d'or</div>
          <div className="panel__sub">Meilleurs buteurs du tournoi simulé</div>
        </div>
        {top[0] && <div className="scorers__lead"><span className="scorers__leadg">{top[0].goals}</span><span>buts</span></div>}
      </div>
      <div className="scorers">
        {top.map((s, i) => (
          <div key={s.player + s.teamCode} className={"scorerrow" + (i === 0 ? " is-top" : "")}>
            <span className="scorerrow__rank">{i + 1}</span>
            <span className="flag" style={{ fontSize: 16 }}>{s.flag}</span>
            <span className="scorerrow__name">{s.player}</span>
            <span className="scorerrow__team">{s.teamCode}</span>
            <span className="scorerrow__goals">{Array.from({ length: Math.min(s.goals, 6) }).map((_, k) => <i key={k} className="ball" />)}{s.goals > 6 ? "" : ""}<b>{s.goals}</b></span>
          </div>
        ))}
        {top.length === 0 && <div className="panel__empty">Aucun but marqué pour l'instant.</div>}
      </div>
    </div>
  );
}

Object.assign(window, { OddsPanel, ScorersPanel });
