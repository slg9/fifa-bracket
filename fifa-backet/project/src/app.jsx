/* app.jsx — shell, état, persistance, synchro, export (window.App) */
const { useState, useEffect, useRef, useMemo } = React;

const STORE_KEY = "wc2026:sim:v1";
const byId = window.WC.byId;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}

function App() {
  const saved = useRef(load()).current;
  const [results, setResults] = useState(saved.results || {});
  const [ko, setKo] = useState(saved.ko || {});
  const [view, setView] = useState(saved.view || "groups");
  const [focusId, setFocusId] = useState(null);
  const [source, setSource] = useState(saved.source || "sim");
  const [syncedAt, setSyncedAt] = useState(saved.syncedAt || null);
  const [syncing, setSyncing] = useState(false);
  const [oddsSyncing, setOddsSyncing] = useState(false);
  const [oddsTick, setOddsTick] = useState(0);
  const [flash, setFlash] = useState(null);
  const captureRef = useRef(null);

  // ---- persistance ----
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ results, ko, view, source, syncedAt }));
  }, [results, ko, view, source, syncedAt]);

  const bracket = useMemo(() => window.ENG.buildBracket(results, ko), [results, ko]);
  const qSet = useMemo(() => new Set(Object.values(bracket.qualifiers || {})), [bracket]);

  const groupsDone = useMemo(() =>
    window.WC.groups.filter((g) => window.ENG.standings(g, results).complete).length, [results]);

  const koPlayed = useMemo(() => {
    const out = {};
    window.ENG.ROUND_KEYS.forEach((rk) => bracket.rounds[rk].forEach((m) => {
      if (m.played && ko[m.id]) out[m.id] = ko[m.id];
    }));
    return out;
  }, [bracket, ko]);

  const champ = bracket.champion ? byId[bracket.champion] : null;

  function toast(msg) { setFlash(msg); clearTimeout(toast._t); toast._t = setTimeout(() => setFlash(null), 2200); }

  // ---- handlers groupes ----
  const idOf = (g, mi) => "G" + g.letter + mi;
  function onPick(g, mi, winnerId) {
    const pair = window.WC.SCHEDULE[mi];
    const home = g.teams[pair[0]], away = g.teams[pair[1]];
    setResults((r) => ({ ...r, [idOf(g, mi)]: window.ENG.groupResult(home, away, winnerId) }));
  }
  function onAuto(g, mi) {
    const pair = window.WC.SCHEDULE[mi];
    const home = g.teams[pair[0]], away = g.teams[pair[1]];
    setResults((r) => ({ ...r, [idOf(g, mi)]: window.ENG.groupResult(home, away, null) }));
  }
  function onClear(g, mi) {
    setResults((r) => { const n = { ...r }; delete n[idOf(g, mi)]; return n; });
  }
  function onSimGroup(g) {
    setResults((r) => {
      const n = { ...r };
      window.WC.SCHEDULE.forEach((pair, mi) => {
        n[idOf(g, mi)] = window.ENG.groupResult(g.teams[pair[0]], g.teams[pair[1]], null);
      });
      return n;
    });
  }

  // ---- handlers KO ----
  function koMatch(id) {
    for (const rk of window.ENG.ROUND_KEYS) { const m = bracket.rounds[rk].find((x) => x.id === id); if (m) return m; }
    return null;
  }
  function onPickKO(id, teamId) {
    const m = koMatch(id); if (!m || !m.a || !m.b) return;
    setKo((k) => ({ ...k, [id]: window.ENG.koResult(byId[m.a], byId[m.b], teamId) }));
  }
  function onAutoKO(id) {
    const m = koMatch(id); if (!m || !m.a || !m.b) return;
    setKo((k) => ({ ...k, [id]: window.ENG.koResult(byId[m.a], byId[m.b], null) }));
  }
  function onClearKO(id) {
    setKo((k) => { const n = { ...k }; delete n[id]; return n; });
  }

  // ---- actions globales ----
  function simGroupsAll() {
    setResults(() => window.ENG.syncSnapshot());
    setKo({}); setSource("sim");
    toast("Phase de groupes simulée");
  }
  function simWholeTournament() {
    const r = window.ENG.syncSnapshot();
    let k = {};
    window.ENG.ROUND_KEYS.forEach((rk) => {
      const br = window.ENG.buildBracket(r, k);
      br.rounds[rk].forEach((m) => {
        if (m.a && m.b) k[m.id] = window.ENG.koResult(byId[m.a], byId[m.b], null);
      });
    });
    setResults(r); setKo(k); setSource("sim");
    setView("bracket");
    toast("Tournoi complet simulé 🏆");
  }
  function resetAll() {
    setResults({}); setKo({}); setSource("sim"); setSyncedAt(null); setFocusId(null);
    toast("Réinitialisé");
  }

  // ---- synchro (API-ready, fallback snapshot) ----
  async function syncData() {
    if (syncing) return;
    setSyncing(true);
    const ep = window.WC.config.syncEndpoint;
    let live = null;
    if (ep) {
      try {
        const res = await fetch(ep, { headers: { Accept: "application/json" } });
        if (res.ok) live = await res.json(); // l'utilisateur mappe son API ici
      } catch (e) { live = null; }
    }
    await new Promise((r) => setTimeout(r, 900)); // anim
    if (live && live.results) {
      setResults(live.results); setSource("live");
    } else {
      setResults(window.ENG.syncSnapshot());
      setSource(ep ? "sim" : "live"); // pas d'endpoint -> snapshot étiqueté "synchronisé (démo)"
    }
    setKo({});
    setSyncedAt(Date.now());
    setSyncing(false);
    toast(ep && live ? "Résultats réels synchronisés" : "Synchronisé (snapshot démo)");
  }

  function syncOdds() {
    setOddsSyncing(true);
    setTimeout(() => { setOddsTick((t) => t + 1); setOddsSyncing(false); }, 700);
  }

  // ---- export image ----
  async function exportImg() {
    if (!window.html2canvas) { toast("Export indisponible"); return; }
    toast("Génération de l'image…");
    const node = captureRef.current;
    try {
      const canvas = await window.html2canvas(node, {
        backgroundColor: "#070b14", scale: 2, useCORS: true,
        windowWidth: node.scrollWidth, width: node.scrollWidth, height: node.scrollHeight,
      });
      const a = document.createElement("a");
      a.download = (view === "bracket" ? "tableau" : "groupes") + "-mondial-2026.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
      toast("Image exportée ✓");
    } catch (e) { toast("Échec de l'export"); }
  }

  function toggleFocus(id) { setFocusId((f) => (f === id ? null : id)); }

  const focusTeam = focusId ? byId[focusId] : null;
  const oddsKey = oddsTick; // force recalcul cosmétique

  return (
    <div className="app">
      <FloodLights />
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <div className="brand">
          <div className="brand__mark"><span>26</span></div>
          <div className="brand__txt">
            <div className="brand__title">MONDIAL <b>2026</b></div>
            <div className="brand__sub">Simulateur de bracket · USA · Canada · Mexique</div>
          </div>
        </div>

        <div className="syncbox">
          <button className={"syncbtn" + (syncing ? " is-busy" : "")} onClick={syncData}>
            <span className="syncbtn__pulse" />
            <span className="syncbtn__ico">{syncing ? "◌" : "⟳"}</span>
            <span className="syncbtn__lbl">{syncing ? "Synchronisation…" : "Synchroniser les résultats"}</span>
          </button>
          <div className="syncmeta">
            {syncedAt
              ? <><span className={"srcdot srcdot--" + (source === "live" ? "live" : "sim")} /> {source === "live" ? "Synchronisé" : "Simulé"} · {timeAgo(syncedAt)}</>
              : <span className="syncmeta--idle">Récupère scores & classements en un clic</span>}
          </div>
        </div>

        <div className="topactions">
          <Btn kind="ghost" onClick={simGroupsAll} title="Simuler toute la phase de groupes">⚂ Groupes</Btn>
          <Btn kind="neon" onClick={simWholeTournament} title="Simuler tout le tournoi jusqu'au sacre">⚡ Tout le tournoi</Btn>
          <Btn kind="ghost" onClick={exportImg} title="Exporter en image">⤓ Image</Btn>
          <Btn kind="danger-ghost" onClick={resetAll} title="Tout réinitialiser">↺</Btn>
        </div>
      </header>

      {/* ---------- control strip ---------- */}
      <div className="controls">
        <Segmented value={view} onChange={setView} options={[
          { id: "groups", label: "Phase de groupes", icon: "▦" },
          { id: "bracket", label: "Tableau final", icon: "🏆" },
        ]} />
        <div className="controls__right">
          <div className="progresschip" title="Groupes terminés">
            <span className="progresschip__n">{groupsDone}<i>/12</i></span>
            <span className="progresschip__bar"><span style={{ width: (groupsDone / 12 * 100) + "%" }} /></span>
            <span className="progresschip__lbl">groupes</span>
          </div>
          {focusTeam && (
            <div className="focuschip">
              <span className="flag" style={{ fontSize: 16 }}>{focusTeam.flag}</span>
              Parcours de {focusTeam.name}
              <button onClick={() => setFocusId(null)} title="Retirer">×</button>
            </div>
          )}
        </div>
      </div>

      {/* ---------- main board ---------- */}
      <div className={"board" + (view === "bracket" ? " board--wide" : "")} ref={captureRef}>
        <main className="board__main">
          {view === "groups"
            ? <GroupStage results={results} onPick={onPick} onAuto={onAuto} onClear={onClear}
                onSimGroup={onSimGroup} focusId={focusId} qSet={groupsDone === 12 ? qSet : null} onFocus={toggleFocus} />
            : <Bracket bracket={bracket} onPick={onPickKO} onAuto={onAutoKO} onClear={onClearKO} focusId={focusId} />}
        </main>

        <aside className="board__side">
          <OddsPanel key={oddsKey} results={results} ko={ko} focusId={focusId} onFocus={toggleFocus}
            source={source} onSyncOdds={syncOdds} syncing={oddsSyncing} />
          <ScorersPanel results={results} ko={koPlayed} onFocus={toggleFocus} />
        </aside>
      </div>

      {champ && <ChampBurst champ={champ} />}
      {flash && <div className="toast">{flash}</div>}
    </div>
  );
}

function FloodLights() {
  return <div className="floods" aria-hidden="true"><i /><i /><i /></div>;
}

function ChampBurst({ champ }) {
  const [show, setShow] = useState(false);
  const last = useRef(null);
  useEffect(() => {
    if (last.current !== champ.id) { last.current = champ.id; setShow(true); const t = setTimeout(() => setShow(false), 2600); return () => clearTimeout(t); }
  }, [champ.id]);
  if (!show) return null;
  const bits = Array.from({ length: 70 });
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((_, i) => (
        <i key={i} style={{
          left: Math.random() * 100 + "%",
          animationDelay: Math.random() * 0.5 + "s",
          background: ["#2bff9a", "#19d3ff", "#ffd24a", "#ff4d6d", "#fff"][i % 5],
          transform: `rotate(${Math.random() * 360}deg)`,
        }} />
      ))}
    </div>
  );
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h";
  return Math.floor(s / 86400) + " j";
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
