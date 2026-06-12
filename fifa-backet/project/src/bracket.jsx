/* bracket.jsx — tableau à élimination directe converge (window.Bracket) */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

function BMatch({ m, refCb, onPick, onAuto, onClear, focusId, side }) {
  const A = m.a ? window.WC.byId[m.a] : null;
  const B = m.b ? window.WC.byId[m.b] : null;
  const ready = A && B;
  const played = m.played;
  const onPath = focusId && (m.a === focusId || m.b === focusId);
  const winA = played && m.winner === m.a;
  const winB = played && m.winner === m.b;

  const Team = ({ team, isWin, isLose, score, which }) => (
    <button
      className={"bm__team" + (isWin ? " is-win" : "") + (isLose ? " is-lose" : "") +
        (focusId && team && team.id === focusId ? " is-focus" : "")}
      disabled={!ready}
      onClick={() => ready && onPick(m.id, team.id)}
      title={team ? `Qualifier ${team.name}` : ""}>
      {side === "right" ? (
        <>
          <span className="bm__score">{played ? score : ""}</span>
          <span className="bm__name">{team ? team.name : window.slotLabel(which === "a" ? m.slotA : m.slotB)}</span>
          <span className="flag" style={{ fontSize: 17 }}>{team ? team.flag : "·"}</span>
        </>
      ) : (
        <>
          <span className="flag" style={{ fontSize: 17 }}>{team ? team.flag : "·"}</span>
          <span className="bm__name">{team ? team.name : window.slotLabel(which === "a" ? m.slotA : m.slotB)}</span>
          <span className="bm__score">{played ? score : ""}</span>
        </>
      )}
    </button>
  );

  return (
    <div className={"bm" + (onPath ? " is-onpath" : "") + (ready ? "" : " is-tbd") + (played ? " is-played" : "")}
      ref={(el) => refCb(m.id, el)}>
      <Team team={A} which="a" isWin={winA} isLose={played && !winA} score={m.sa} />
      <div className="bm__mid">
        {ready && !played && (
          <button className="bm__auto" title="Simulation auto" onClick={() => onAuto(m.id)}>⚂</button>
        )}
        {played && (
          <>
            {m.pens && <span className="bm__pens">tab</span>}
            <button className="bm__clear" title="Effacer" onClick={() => onClear(m.id)}>×</button>
          </>
        )}
      </div>
      <Team team={B} which="b" isWin={winB} isLose={played && !winB} score={m.sb} />
    </div>
  );
}

function Bracket({ bracket, onPick, onAuto, onClear, focusId }) {
  const refs = useRef({});
  const wrapRef = useRef(null);
  const fitRef = useRef(null);
  const scaleRef = useRef(1);
  const [lines, setLines] = useState([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);

  const setRef = useCallback((id, el) => { if (el) refs.current[id] = el; else delete refs.current[id]; }, []);

  // parent d'un match (par id) pour tracer les connecteurs
  function parentOf(id) {
    const [rk, iStr] = id.split("-"); const i = +iStr;
    const order = window.ENG.ROUND_KEYS;
    const ri = order.indexOf(rk);
    if (ri >= order.length - 1) return null;
    return order[ri + 1] + "-" + Math.floor(i / 2);
  }

  function sideOf(rk, idx) {
    const n = window.ENG.ROUND_SIZE[rk];
    if (rk === "F") return "center";
    return idx < n / 2 ? "left" : "right";
  }

  // ajuste l'échelle pour que TOUT le tableau tienne dans la largeur dispo (zéro scroll)
  const fit = useCallback(() => {
    const wrap = wrapRef.current, fitEl = fitRef.current;
    if (!wrap || !fitEl) return;
    const naturalW = wrap.scrollWidth;
    const naturalH = wrap.scrollHeight;
    const avail = fitEl.clientWidth;
    const sc = naturalW > 0 ? Math.min(1, avail / naturalW) : 1;
    scaleRef.current = sc;
    setScale((p) => (Math.abs(p - sc) < 0.0015 ? p : sc));
    setBox((p) => (p.w === naturalW && p.h === naturalH ? p : { w: naturalW, h: naturalH }));
  }, []);

  const measure = useCallback(() => {
    const wrap = wrapRef.current; if (!wrap) return;
    const sc = scaleRef.current || 1;
    const wb = wrap.getBoundingClientRect();
    const next = [];
    Object.keys(refs.current).forEach((id) => {
      const pid = parentOf(id);
      if (!pid || !refs.current[pid]) return;
      const c = refs.current[id].getBoundingClientRect();
      const p = refs.current[pid].getBoundingClientRect();
      const [rk, iStr] = id.split("-");
      const side = sideOf(rk, +iStr);
      let x1, y1, x2, y2;
      y1 = (c.top + c.height / 2 - wb.top) / sc;
      y2 = (p.top + p.height / 2 - wb.top) / sc;
      if (side === "left") { x1 = (c.right - wb.left) / sc; x2 = (p.left - wb.left) / sc; }
      else { x1 = (c.left - wb.left) / sc; x2 = (p.right - wb.left) / sc; }
      const midX = (x1 + x2) / 2;
      const m = bracket.rounds[rk][+iStr];
      const onPath = focusId && m.winner === focusId && (m.a === focusId || m.b === focusId);
      next.push({ id, d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`, onPath });
    });
    setLines(next);
  }, [bracket, focusId]);

  // 1) échelle (resize / contenu)
  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    if (fitRef.current) ro.observe(fitRef.current);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [fit, bracket]);

  // 2) connecteurs une fois l'échelle appliquée
  useEffect(() => {
    const timers = [];
    const run = () => measure();
    const raf = requestAnimationFrame(run);
    timers.push(setTimeout(run, 90), setTimeout(run, 320), setTimeout(run, 680));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, [measure, scale]);

  if (!bracket.ready) {
    return (
      <div className="bracket-empty">
        <div className="bracket-empty__ico">🗺️</div>
        <h3>Le tableau se débloque après la phase de groupes</h3>
        <p>Termine les 12 groupes (ou lance « Tout simuler ») pour générer les 16es de finale avec les 32 qualifiés.</p>
      </div>
    );
  }

  const R = bracket.rounds;
  const cols = [
    { key: "R32", items: R.R32.slice(0, 8), side: "left", label: "16es de finale" },
    { key: "R16", items: R.R16.slice(0, 4), side: "left", label: "8es de finale" },
    { key: "QF", items: R.QF.slice(0, 2), side: "left", label: "Quarts" },
    { key: "SF", items: [R.SF[0]], side: "left", label: "Demi-finale" },
    { key: "F", items: [R.F[0]], side: "center", label: "Finale" },
    { key: "SF", items: [R.SF[1]], side: "right", label: "Demi-finale" },
    { key: "QF", items: R.QF.slice(2, 4), side: "right", label: "Quarts" },
    { key: "R16", items: R.R16.slice(4, 8), side: "right", label: "8es de finale" },
    { key: "R32", items: R.R32.slice(8, 16), side: "right", label: "16es de finale" },
  ];

  const champ = bracket.champion ? window.WC.byId[bracket.champion] : null;

  return (
    <div className="bracket-fit" ref={fitRef} style={{ height: box.h ? Math.ceil(box.h * scale) : undefined }}>
      <div className="bracket" ref={wrapRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <svg className="bracket__links" width={box.w} height={box.h} aria-hidden="true">
          {lines.map((l) => (
            <path key={l.id} d={l.d} className={"link" + (l.onPath ? " link--lit" : "")} />
          ))}
        </svg>

        {cols.map((col, ci) => (
          <div className={"bcol bcol--" + col.side} key={ci}>
            <div className="bcol__label">{col.label}</div>
            <div className="bcol__matches">
              {col.key === "F" ? (
                <div className="finalwrap">
                  <BMatch m={col.items[0]} refCb={setRef} onPick={onPick} onAuto={onAuto} onClear={onClear} focusId={focusId} side="center" />
                  <div className={"champ" + (champ ? " is-set" : "")}>
                    <div className="champ__trophy">🏆</div>
                    {champ ? (
                      <>
                        <div className="champ__flag">{champ.flag}</div>
                        <div className="champ__name">{champ.name}</div>
                        <div className="champ__cap">Championne du monde</div>
                      </>
                    ) : (
                      <div className="champ__cap champ__cap--tbd">Le champion s'affiche ici</div>
                    )}
                  </div>
                </div>
              ) : (
                col.items.map((m) => (
                  <BMatch key={m.id} m={m} refCb={setRef} onPick={onPick} onAuto={onAuto} onClear={onClear} focusId={focusId} side={col.side} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Bracket });
