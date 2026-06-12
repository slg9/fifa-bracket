/* groups.jsx — phase de groupes (window.GroupStage) */

function MatchRow({ group, mi, res, onPick, onAuto, onClear, dim }) {
  const pair = window.WC.SCHEDULE[mi];
  const home = group.teams[pair[0]], away = group.teams[pair[1]];
  const played = res && res.played;
  const homeWin = played && res.hs > res.as;
  const awayWin = played && res.as > res.hs;
  return (
    <div className={"mrow" + (played ? " is-played" : "") + (dim ? " is-dim" : "")}>
      <button className={"mrow__team mrow__team--home" + (homeWin ? " is-win" : played ? " is-lose" : "")}
        onClick={() => onPick(group, mi, home.id)} title={`Faire gagner ${home.name}`}>
        <span className="mrow__name">{home.name}</span>
        <span className="flag" style={{ fontSize: 19 }}>{home.flag}</span>
      </button>

      <div className="mrow__score">
        {played
          ? <><b>{res.hs}</b><span className="mrow__sep">:</span><b>{res.as}</b></>
          : <span className="mrow__vs">v</span>}
      </div>

      <button className={"mrow__team mrow__team--away" + (awayWin ? " is-win" : played ? " is-lose" : "")}
        onClick={() => onPick(group, mi, away.id)} title={`Faire gagner ${away.name}`}>
        <span className="flag" style={{ fontSize: 19 }}>{away.flag}</span>
        <span className="mrow__name">{away.name}</span>
      </button>

      <div className="mrow__tools">
        <button className="ibtn" title="Simulation auto" onClick={() => onAuto(group, mi)}>⚂</button>
        {played && <button className="ibtn ibtn--x" title="Effacer" onClick={() => onClear(group, mi)}>×</button>}
      </div>
    </div>
  );
}

function GroupCard({ group, results, onPick, onAuto, onClear, onSimGroup, focusId, qSet, onFocus }) {
  const s = window.ENG.standings(group, results);
  return (
    <section className={"gcard" + (s.complete ? " is-complete" : "")}>
      <header className="gcard__head">
        <div className="gcard__badge">{group.letter}</div>
        <div className="gcard__title">Groupe {group.letter}</div>
        <button className="gcard__sim" onClick={() => onSimGroup(group)} title="Simuler tout le groupe">
          Simuler ⚂
        </button>
      </header>

      <table className="stand">
        <thead>
          <tr><th className="stand__pos">#</th><th className="stand__team">Équipe</th>
            <th>J</th><th>G</th><th>N</th><th>P</th><th>+/-</th><th className="stand__pts">Pts</th></tr>
        </thead>
        <tbody>
          {s.rows.map((r) => {
            const q = r.rank <= 2 ? "q1" : r.rank === 3 ? "q3" : "q0";
            const isFocus = focusId && r.team.id === focusId;
            const qual = qSet && qSet.has(r.team.id);
            return (
              <tr key={r.team.id} className={`stand__row stand__row--${q}` + (isFocus ? " is-focus" : "") + (qual ? " is-qual" : "")}>
                <td className="stand__pos">{r.rank}</td>
                <td className="stand__team" onClick={() => onFocus && onFocus(r.team.id)} title="Surligner le parcours">
                  <span className="flag" style={{ fontSize: 17 }}>{r.team.flag}</span>
                  <span className="stand__name">{r.team.name}</span>
                  {qual && <span className="stand__check" title="Qualifié">✓</span>}
                </td>
                <td>{r.P}</td><td>{r.W}</td><td>{r.D}</td><td>{r.L}</td>
                <td className={r.GD > 0 ? "pos" : r.GD < 0 ? "neg" : ""}>{r.GD > 0 ? "+" + r.GD : r.GD}</td>
                <td className="stand__pts">{r.Pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="gcard__matches">
        {window.WC.SCHEDULE.map((_, mi) => (
          <MatchRow key={mi} group={group} mi={mi} res={results["G" + group.letter + mi]}
            onPick={onPick} onAuto={onAuto} onClear={onClear}
            dim={focusId && !involves(group, mi, focusId)} />
        ))}
      </div>
    </section>
  );
}

function involves(group, mi, teamId) {
  const pair = window.WC.SCHEDULE[mi];
  return group.teams[pair[0]].id === teamId || group.teams[pair[1]].id === teamId;
}

function GroupStage({ results, onPick, onAuto, onClear, onSimGroup, focusId, qSet, onFocus }) {
  return (
    <div className="groups">
      {window.WC.groups.map((g) => (
        <GroupCard key={g.letter} group={g} results={results}
          onPick={onPick} onAuto={onAuto} onClear={onClear} onSimGroup={onSimGroup}
          focusId={focusId} qSet={qSet} onFocus={onFocus} />
      ))}
    </div>
  );
}

Object.assign(window, { GroupStage });
