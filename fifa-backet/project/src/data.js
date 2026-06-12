/* ===================================================================
   data.js — Coupe du Monde 2026
   48 équipes, 12 groupes (A→L), joueurs notables, config de synchro.
   Exposé sur window.WC
   =================================================================== */
(function () {
  // strength ~ proxy ranking FIFA (sert aux probas + odds)
  // pot = pour info visuelle
  const T = (name, code, flag, strength, conf, pot, players) =>
    ({ name, code, flag, strength, conf, pot, players: players || null });

  // ---- Pot 1 (hôtes + têtes de série) ----
  const pot1 = [
    T("Mexique", "MEX", "🇲🇽", 74, "CONCACAF", 1, ["R. Jiménez", "H. Lozano", "S. Giménez"]),
    T("Canada", "CAN", "🇨🇦", 71, "CONCACAF", 1, ["A. Davies", "J. David", "C. Larin"]),
    T("États-Unis", "USA", "🇺🇸", 75, "CONCACAF", 1, ["C. Pulisic", "F. Balogun", "T. Weah"]),
    T("Argentine", "ARG", "🇦🇷", 96, "CONMEBOL", 1, ["L. Messi", "J. Álvarez", "L. Martínez"]),
    T("France", "FRA", "🇫🇷", 95, "UEFA", 1, ["K. Mbappé", "O. Dembélé", "M. Thuram"]),
    T("Angleterre", "ENG", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", 90, "UEFA", 1, ["J. Bellingham", "H. Kane", "P. Foden"]),
    T("Brésil", "BRA", "🇧🇷", 90, "CONMEBOL", 1, ["Vinícius Jr", "Rodrygo", "Endrick"]),
    T("Portugal", "POR", "🇵🇹", 89, "UEFA", 1, ["C. Ronaldo", "B. Fernandes", "R. Leão"]),
    T("Espagne", "ESP", "🇪🇸", 93, "UEFA", 1, ["L. Yamal", "N. Williams", "Á. Morata"]),
    T("Pays-Bas", "NED", "🇳🇱", 87, "UEFA", 1, ["C. Gakpo", "M. Depay", "X. Simons"]),
    T("Belgique", "BEL", "🇧🇪", 84, "UEFA", 1, ["K. De Bruyne", "R. Lukaku", "J. Doku"]),
    T("Allemagne", "GER", "🇩🇪", 86, "UEFA", 1, ["F. Wirtz", "J. Musiala", "K. Havertz"]),
  ];
  // ---- Pot 2 ----
  const pot2 = [
    T("Croatie", "CRO", "🇭🇷", 82, "UEFA", 2, ["L. Modrić", "A. Kramarić", "A. Budimir"]),
    T("Maroc", "MAR", "🇲🇦", 80, "CAF", 2, ["A. Hakimi", "Y. En-Nesyri", "B. Diaz"]),
    T("Colombie", "COL", "🇨🇴", 79, "CONMEBOL", 2, ["J. Rodríguez", "L. Díaz", "J. Córdoba"]),
    T("Uruguay", "URU", "🇺🇾", 80, "CONMEBOL", 2, ["D. Núñez", "F. Valverde", "F. Pellistri"]),
    T("Suisse", "SUI", "🇨🇭", 78, "UEFA", 2, ["G. Xhaka", "B. Embolo", "D. Ndoye"]),
    T("Japon", "JPN", "🇯🇵", 76, "AFC", 2, ["T. Kubo", "K. Mitoma", "A. Ueda"]),
    T("Sénégal", "SEN", "🇸🇳", 77, "CAF", 2, ["S. Mané", "N. Jackson", "I. Sarr"]),
    T("Iran", "IRN", "🇮🇷", 70, "AFC", 2, ["M. Taremi", "S. Azmoun", "A. Jahanbakhsh"]),
    T("Corée du Sud", "KOR", "🇰🇷", 71, "AFC", 2, ["Son Heung-min", "Lee Kang-in", "Hwang Hee-chan"]),
    T("Équateur", "ECU", "🇪🇨", 72, "CONMEBOL", 2, ["E. Valencia", "M. Caicedo", "K. Rodríguez"]),
    T("Autriche", "AUT", "🇦🇹", 74, "UEFA", 2, ["M. Sabitzer", "M. Gregoritsch", "P. Wimmer"]),
    T("Australie", "AUS", "🇦🇺", 68, "AFC", 2, ["M. Duke", "C. Goodwin", "R. McGree"]),
  ];
  // ---- Pot 3 ----
  const pot3 = [
    T("Ukraine", "UKR", "🇺🇦", 71, "UEFA", 3, ["M. Mudryk", "A. Dovbyk", "H. Sudakov"]),
    T("Suède", "SWE", "🇸🇪", 70, "UEFA", 3, ["A. Isak", "V. Gyökeres", "D. Kulusevski"]),
    T("Pays de Galles", "WAL", "🏴󠁧󠁢󠁷󠁬󠁳󠁿", 69, "UEFA", 3, ["H. Wilson", "B. Johnson", "K. Moore"]),
    T("Serbie", "SRB", "🇷🇸", 73, "UEFA", 3, ["A. Mitrović", "D. Vlahović", "D. Tadić"]),
    T("Égypte", "EGY", "🇪🇬", 68, "CAF", 3, ["M. Salah", "O. Marmoush", "T. Trezeguet"]),
    T("Algérie", "ALG", "🇩🇿", 70, "CAF", 3, ["R. Mahrez", "M. Amoura", "I. Bennacer"]),
    T("Nigéria", "NGA", "🇳🇬", 72, "CAF", 3, ["V. Osimhen", "A. Lookman", "S. Chukwueze"]),
    T("Côte d'Ivoire", "CIV", "🇨🇮", 71, "CAF", 3, ["S. Haller", "N. Pépé", "F. Diakité"]),
    T("Qatar", "QAT", "🇶🇦", 64, "AFC", 3, ["A. Ali", "A. Afif", "H. Al-Haydos"]),
    T("Arabie saoudite", "KSA", "🇸🇦", 63, "AFC", 3, ["S. Al-Dawsari", "F. Al-Buraikan", "S. Al-Shehri"]),
    T("Pologne", "POL", "🇵🇱", 71, "UEFA", 3, ["R. Lewandowski", "P. Zieliński", "N. Zalewski"]),
    T("Danemark", "DEN", "🇩🇰", 78, "UEFA", 3, ["R. Højlund", "C. Eriksen", "M. Damsgaard"]),
  ];
  // ---- Pot 4 ----
  const pot4 = [
    T("Norvège", "NOR", "🇳🇴", 75, "UEFA", 4, ["E. Haaland", "M. Ødegaard", "A. Sørloth"]),
    T("Turquie", "TUR", "🇹🇷", 73, "UEFA", 4, ["A. Güler", "K. Aktürkoğlu", "B. Yılmaz"]),
    T("Grèce", "GRE", "🇬🇷", 68, "UEFA", 4, ["K. Fortounis", "V. Pavlidis", "G. Masouras"]),
    T("Tchéquie", "CZE", "🇨🇿", 69, "UEFA", 4, ["P. Schick", "A. Hložek", "T. Souček"]),
    T("Panama", "PAN", "🇵🇦", 60, "CONCACAF", 4, ["C. Martínez", "I. Fajardo", "J. Rodríguez"]),
    T("Ghana", "GHA", "🇬🇭", 67, "CAF", 4, ["M. Kudus", "I. Williams", "A. Semenyo"]),
    T("Cameroun", "CMR", "🇨🇲", 68, "CAF", 4, ["A. Onana", "B. Mbeumo", "V. Aboubakar"]),
    T("Tunisie", "TUN", "🇹🇳", 66, "CAF", 4, ["W. Khazri", "Y. Msakni", "H. Jaziri"]),
    T("Nouvelle-Zélande", "NZL", "🇳🇿", 58, "OFC", 4, ["C. Wood", "B. Waine", "M. Garbett"]),
    T("Jamaïque", "JAM", "🇯🇲", 62, "CONCACAF", 4, ["M. Antonio", "L. Bailey", "D. Gray"]),
    T("Cap-Vert", "CPV", "🇨🇻", 60, "CAF", 4, ["G. Mendes", "R. Mendes", "Bebé"]),
    T("Ouzbékistan", "UZB", "🇺🇿", 62, "AFC", 4, ["E. Shomurodov", "A. Masharipov", "O. Fayzullaev"]),
  ];

  const pots = [pot1, pot2, pot3, pot4];

  // ---- Groupes A→L : un par pot ----
  const LETTERS = "ABCDEFGHIJKL".split("");
  const groups = LETTERS.map((L, gi) => ({
    letter: L,
    teams: pots.map((p) => p[gi]),
  }));

  // donne un id stable à chaque équipe : "A0".."L3"
  groups.forEach((g) => g.teams.forEach((t, ti) => {
    t.id = g.letter + ti;
    t.group = g.letter;
  }));

  // index global id->équipe
  const byId = {};
  groups.forEach((g) => g.teams.forEach((t) => { byId[t.id] = t; }));

  // ---- Buteurs génériques pour compléter (jamais utilisé ici car tous ont des stars) ----
  const SURN = ["Silva", "Kovač", "Traoré", "Santos", "Hassan", "Park", "Müller", "Rossi",
    "Andersen", "Popović", "Okafor", "Tanaka", "Méndez", "Haddad", "Novak", "Costa"];
  groups.forEach((g) => g.teams.forEach((t) => {
    if (!t.players) {
      t.players = [SURN[(t.strength) % SURN.length], SURN[(t.strength + 5) % SURN.length], SURN[(t.strength + 9) % SURN.length]];
    }
  }));

  // ---- Calendrier round-robin (indices d'équipe 0..3) : 3 journées, 6 matchs ----
  const SCHEDULE = [
    [0, 1], [2, 3],   // J1
    [0, 2], [3, 1],   // J2
    [3, 0], [1, 2],   // J3
  ];

  // ---- Structure du tableau final (gabarit simplifié 2026) ----
  // R32 : 12 matchs 1er vs 2e (décalage +6 pour éviter un re-match de groupe)
  //       + 4 matchs entre 3es. Slots interleavés pour un bracket équilibré.
  // Référence par "code de slot" résolu après la phase de groupes.
  function buildR32Template() {
    const wr = []; // [winnerSlot, runnerSlot]
    for (let g = 0; g < 12; g++) {
      const A = "1" + LETTERS[g];
      const B = "2" + LETTERS[(g + 6) % 12];
      wr.push([A, B]);
    }
    const tt = [["T1", "T8"], ["T2", "T7"], ["T3", "T6"], ["T4", "T5"]];
    const order = [];
    let wi = 0, ti = 0;
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 3 && ti < 4) order.push(tt[ti++]);
      else order.push(wr[wi++]);
    }
    return order; // 16 paires de slots
  }

  const config = {
    // Endpoint de synchro : laisse vide -> snapshot réaliste local.
    // Colle ici l'URL de ton API (doit autoriser le CORS) pour brancher du live.
    syncEndpoint: "",
    oddsEndpoint: "",
    season: "Coupe du Monde FIFA 2026™",
    hosts: ["USA", "CAN", "MEX"],
  };

  window.WC = {
    groups, byId, LETTERS, SCHEDULE,
    r32Template: buildR32Template(),
    config,
    allTeams: groups.flatMap((g) => g.teams),
  };
})();
