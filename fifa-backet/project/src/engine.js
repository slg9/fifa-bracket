/* ===================================================================
   engine.js — logique pure du simulateur (window.ENG)
   standings • simulation • qualification • bracket • odds • buteurs
   =================================================================== */
(function () {
  const WC = window.WC;
  const LETTERS = WC.LETTERS;

  // ---------- proba & scores ----------
  function winProb(sa, sb) { return 1 / (1 + Math.pow(10, (sb - sa) / 16)); }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // distribution de buts du vainqueur / perdant
  const WIN_GOALS = [1, 1, 1, 2, 2, 2, 2, 3, 3, 4];
  function loserGoals(wg) {
    const opts = [];
    for (let i = 0; i < wg; i++) opts.push(i, Math.max(0, i - 1));
    opts.push(0, 0);
    return pick(opts);
  }
  const DRAW_GOALS = [0, 1, 1, 1, 2, 2, 3];

  // simule un match de groupe (nul autorisé) -> {hs, as}
  function simGroupMatch(home, away) {
    const p = winProb(home.strength, away.strength);
    let dr = 0.26 * (1 - Math.abs(p - 0.5) * 1.4);
    if (dr < 0.05) dr = 0.05;
    const pA = (1 - dr) * p, pB = (1 - dr) * (1 - p);
    const r = Math.random();
    if (r < pA) { const wg = pick(WIN_GOALS); return { hs: wg, as: loserGoals(wg) }; }
    if (r < pA + pB) { const wg = pick(WIN_GOALS); return { hs: loserGoals(wg), as: wg }; }
    const g = pick(DRAW_GOALS); return { hs: g, as: g };
  }

  // force un vainqueur (clic) -> score gagnant réaliste
  function forceWin(winnerStrongerLikely) {
    const wg = pick(WIN_GOALS); return { wg, lg: loserGoals(wg) };
  }

  // match à élimination : pas de nul (penalties si besoin)
  function simKO(a, b) {
    const p = winProb(a.strength, b.strength);
    const r = Math.random();
    let aWin = r < p;
    let wg = pick(WIN_GOALS), lg = loserGoals(wg);
    // 22% de chance de passer par les tirs au but (score nul + (pen))
    const pens = Math.random() < 0.22;
    if (pens) {
      const g = pick(DRAW_GOALS);
      return { as: aWin ? g : g, bs: g, winner: aWin ? "a" : "b", pens: true,
               sa: aWin ? g : g, sb: g };
    }
    return aWin
      ? { sa: wg, sb: lg, winner: "a", pens: false }
      : { sa: lg, sb: wg, winner: "b", pens: false };
  }

  // ---------- buteurs ----------
  function makeScorers(team, goals) {
    const pl = team.players || [team.code + " 9", team.code + " 10", team.code + " 7"];
    const w = [0.5, 0.3, 0.2];
    const out = [];
    for (let i = 0; i < goals; i++) {
      const r = Math.random();
      let idx = r < w[0] ? 0 : r < w[0] + w[1] ? 1 : 2;
      out.push({ player: pl[idx] || pl[0], teamId: team.id, teamCode: team.code, flag: team.flag });
    }
    return out;
  }

  // produit l'objet résultat complet d'un match de groupe
  function groupResult(home, away, forcedWinnerId) {
    let hs, as;
    if (forcedWinnerId) {
      const { wg, lg } = forceWin();
      if (forcedWinnerId === home.id) { hs = wg; as = lg; }
      else { hs = lg; as = wg; }
    } else {
      const r = simGroupMatch(home, away); hs = r.hs; as = r.as;
    }
    const scorers = [...makeScorers(home, hs), ...makeScorers(away, as)];
    return { hs, as, played: true, scorers };
  }

  function koResult(a, b, forcedWinnerId) {
    if (forcedWinnerId) {
      const winnerIsA = forcedWinnerId === a.id;
      const { wg, lg } = forceWin();
      const sa = winnerIsA ? wg : lg, sb = winnerIsA ? lg : wg;
      const win = winnerIsA ? a : b, lose = winnerIsA ? b : a;
      const scorers = [...makeScorers(a, sa), ...makeScorers(b, sb)];
      return { sa, sb, winner: forcedWinnerId, pens: false, scorers };
    }
    const r = simKO(a, b);
    const winId = r.winner === "a" ? a.id : b.id;
    const scorers = [...makeScorers(a, r.sa), ...makeScorers(b, r.sb)];
    return { sa: r.sa, sb: r.sb, winner: winId, pens: r.pens, scorers };
  }

  // ---------- classements ----------
  function standings(group, results) {
    const rows = group.teams.map((t) => ({
      team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0,
    }));
    const idx = {}; rows.forEach((r) => (idx[r.team.id] = r));
    WC.SCHEDULE.forEach((pair, mi) => {
      const id = "G" + group.letter + mi;
      const res = results[id];
      if (!res || !res.played) return;
      const home = group.teams[pair[0]], away = group.teams[pair[1]];
      const rh = idx[home.id], ra = idx[away.id];
      rh.P++; ra.P++; rh.GF += res.hs; rh.GA += res.as; ra.GF += res.as; ra.GA += res.hs;
      if (res.hs > res.as) { rh.W++; ra.L++; rh.Pts += 3; }
      else if (res.hs < res.as) { ra.W++; rh.L++; ra.Pts += 3; }
      else { rh.D++; ra.D++; rh.Pts++; ra.Pts++; }
    });
    rows.forEach((r) => (r.GD = r.GF - r.GA));
    rows.sort((a, b) =>
      b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF ||
      b.team.strength - a.team.strength || a.team.code.localeCompare(b.team.code));
    rows.forEach((r, i) => (r.rank = i + 1));
    const done = WC.SCHEDULE.every((_, mi) => {
      const res = results["G" + group.letter + mi]; return res && res.played;
    });
    return { rows, complete: done };
  }

  function allGroupsComplete(results) {
    return WC.groups.every((g) => standings(g, results).complete);
  }

  // ---------- qualification & seeding ----------
  function qualifiers(results) {
    // renvoie map slot -> teamId  (slots: 1A..1L, 2A..2L, T1..T8)
    const map = {};
    const thirds = [];
    WC.groups.forEach((g) => {
      const s = standings(g, results);
      if (!s.complete) return;
      map["1" + g.letter] = s.rows[0].team.id;
      map["2" + g.letter] = s.rows[1].team.id;
      thirds.push(s.rows[2]);
    });
    thirds.sort((a, b) =>
      b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || b.team.strength - a.team.strength);
    thirds.slice(0, 8).forEach((r, i) => (map["T" + (i + 1)] = r.team.id));
    return map;
  }

  // ---------- bracket ----------
  const ROUND_KEYS = ["R32", "R16", "QF", "SF", "F"];
  const ROUND_LABEL = { R32: "16es de finale", R16: "8es de finale", QF: "Quarts", SF: "Demi-finales", F: "Finale" };
  const ROUND_SIZE = { R32: 16, R16: 8, QF: 4, SF: 2, F: 1 };

  function buildBracket(results, ko) {
    const ready = allGroupsComplete(results);
    const q = ready ? qualifiers(results) : {};
    const rounds = {};

    // R32 depuis le gabarit
    const r32 = WC.r32Template.map((slots, i) => {
      const a = ready ? q[slots[0]] : null;
      const b = ready ? q[slots[1]] : null;
      return mkMatch("R32-" + i, a, b, slots[0], slots[1], ko);
    });
    rounds.R32 = r32;

    let prev = r32;
    ["R16", "QF", "SF", "F"].forEach((rk) => {
      const arr = [];
      for (let i = 0; i < ROUND_SIZE[rk]; i++) {
        const m1 = prev[2 * i], m2 = prev[2 * i + 1];
        const a = m1.winner, b = m2.winner;
        arr.push(mkMatch(rk + "-" + i, a, b, m1.label || "", m2.label || "", ko));
      }
      rounds[rk] = arr;
      prev = arr;
    });

    const champion = rounds.F[0].winner || null;
    return { ready, rounds, champion, qualifiers: q };
  }

  function mkMatch(id, a, b, slotA, slotB, ko) {
    const rec = ko[id] || {};
    let winner = rec.winner || null;
    // valide le vainqueur stocké : doit être un des deux participants présents
    if (winner && winner !== a && winner !== b) winner = null;
    return {
      id, a, b, slotA, slotB,
      sa: rec.sa, sb: rec.sb, pens: !!rec.pens,
      winner,
      played: winner != null,
      label: winner, // pour propager
    };
  }

  // ---------- odds / pronostics communauté ----------
  // probabilité de titre (live, basée force + profondeur), normalisée à 100%
  function titleOdds(results, ko) {
    const br = buildBracket(results, ko);
    const teams = WC.allTeams;
    // ensemble encore en vie
    let alive = new Set(teams.map((t) => t.id));
    if (br.ready) {
      // seuls les 32 qualifiés sont en vie
      const qset = new Set(Object.values(br.qualifiers));
      alive = new Set([...alive].filter((id) => qset.has(id)));
      // retirer les éliminés des tours joués
      ROUND_KEYS.forEach((rk) => {
        br.rounds[rk].forEach((m) => {
          if (m.winner) {
            if (m.a && m.a !== m.winner) alive.delete(m.a);
            if (m.b && m.b !== m.winner) alive.delete(m.b);
          }
        });
      });
    }
    if (br.champion) {
      return teams.map((t) => ({ team: t, pct: t.id === br.champion ? 100 : 0, alive: t.id === br.champion }))
        .sort((a, b) => b.pct - a.pct);
    }
    // profondeur atteinte par équipe
    const depth = {};
    ROUND_KEYS.forEach((rk, ri) => {
      br.rounds[rk].forEach((m) => {
        [m.a, m.b].forEach((id) => { if (id) depth[id] = Math.max(depth[id] || 0, ri); });
      });
    });
    const scale = 6.5;
    let sum = 0;
    const raw = teams.map((t) => {
      if (!alive.has(t.id)) return { team: t, base: 0, alive: false };
      const d = depth[t.id] || 0;
      const base = Math.exp(t.strength / scale) * (1 + 0.18 * d);
      sum += base;
      return { team: t, base, alive: true };
    });
    return raw.map((r) => ({ team: r.team, alive: r.alive, pct: sum ? (r.base / sum) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }

  // ---------- buteurs (classement) ----------
  function topScorers(results, ko) {
    const tally = {};
    const add = (list) => (list || []).forEach((s) => {
      const k = s.player + "|" + s.teamCode;
      if (!tally[k]) tally[k] = { player: s.player, teamCode: s.teamCode, flag: s.flag, goals: 0 };
      tally[k].goals++;
    });
    WC.groups.forEach((g) => WC.SCHEDULE.forEach((_, mi) => {
      const r = results["G" + g.letter + mi]; if (r) add(r.scorers);
    }));
    Object.values(ko).forEach((r) => add(r.scorers));
    return Object.values(tally).sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player));
  }

  // ---------- snapshot "réaliste" pour le bouton Synchroniser ----------
  // remplit toute la phase de groupes par simulation pondérée (= données "officielles")
  function syncSnapshot() {
    const results = {};
    WC.groups.forEach((g) => WC.SCHEDULE.forEach((pair, mi) => {
      const home = g.teams[pair[0]], away = g.teams[pair[1]];
      results["G" + g.letter + mi] = groupResult(home, away, null);
    }));
    return results;
  }

  window.ENG = {
    winProb, simGroupMatch, simKO, makeScorers, groupResult, koResult,
    standings, allGroupsComplete, qualifiers, buildBracket, titleOdds, topScorers,
    syncSnapshot, ROUND_KEYS, ROUND_LABEL, ROUND_SIZE,
  };
})();
