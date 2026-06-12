# FIFA Bracket 2026 - Handoff

## Objectif

Construire une application React/Vite qui affiche :

- les groupes de la Coupe du monde FIFA 2026
- les classements en temps reel
- les matchs de groupes avec dates et scores
- la projection du bracket final
- un mode `Reel`
- un mode `Simulation`

En mode `Simulation`, modifier les scores des matchs de groupes doit recalculer :

- les classements
- les qualifies
- les meilleurs troisiemes
- les affiches du tableau final

## Etat actuel

Le projet n'est plus un starter Vite vide. Il contient deja :

- un seed JSON local avec les groupes, equipes et calendrier de groupes
- un snapshot JSON live separe
- un moteur de calcul des classements
- un moteur de projection du bracket
- une UI prototype pour consulter et simuler

Le build compile actuellement sans erreur.

Commande de verification :

```powershell
npm run build
```

Commande de lancement :

```powershell
npm run dev
```

## Structure actuelle

### Fichiers principaux

- [src/App.tsx](C:\Users\SébastienLegros\Documents\Dev\fifabracket\src\App.tsx)
  UI principale, mode reel/simulation, rendu groupes, standings, bracket.

- [src/lib/tournament.ts](C:\Users\SébastienLegros\Documents\Dev\fifabracket\src\lib\tournament.ts)
  Logique metier :
  - fusion des scores seed/live/simulation
  - calcul des classements
  - tie-breaks de base
  - selection des meilleurs troisiemes
  - generation du bracket

- [src/lib/data.ts](C:\Users\SébastienLegros\Documents\Dev\fifabracket\src\lib\data.ts)
  Chargement des fichiers JSON publics.

- [src/types.ts](C:\Users\SébastienLegros\Documents\Dev\fifabracket\src\types.ts)
  Types du domaine.

- [public/data/world-cup-2026.json](C:\Users\SébastienLegros\Documents\Dev\fifabracket\public\data\world-cup-2026.json)
  Seed principal du tournoi :
  - groupes
  - equipes
  - matchs de groupes

- [public/data/fifa-live.json](C:\Users\SébastienLegros\Documents\Dev\fifabracket\public\data\fifa-live.json)
  Snapshot live surchargeable au chargement.

- [scripts/sync-fifa.mjs](C:\Users\SébastienLegros\Documents\Dev\fifabracket\scripts\sync-fifa.mjs)
  Script de synchronisation FIFA.

- [package.json](C:\Users\SébastienLegros\Documents\Dev\fifabracket\package.json)
  Contient notamment :
  - `npm run dev`
  - `npm run build`
  - `npm run sync:fifa`

## Sources FIFA visees

Le produit doit se baser sur ces 2 pages :

- standings :
  `https://www.fifa.com/fr/tournaments/mens/worldcup/canadamexicousa2026/standings`
- scores + fixtures :
  `https://www.fifa.com/fr/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures?country=FR&wtw-filter=ALL`

## Ce qui a deja ete verifie

- les pages FIFA sont joignables depuis le script Node
- les pages ne contiennent pas directement les donnees metier server-rendered utiles
- FIFA hydrate une app frontend cote client
- le bundle FIFA expose notamment :
  - `https://cxm-api.fifa.com/fifaplusweb/api`
  - `https://gameday-prod.fifa.mangodev.co.uk/1-0`
- a ce stade, les routes exactes pour extraire standings/matchs n'ont pas encore ete reconstruites proprement

Conclusion :

- le vrai scraping/API FIFA reste la principale suite a implementer

## Fonctionnement actuel des donnees

### Seed

`world-cup-2026.json` sert de base statique. Il contient :

- les 12 groupes A a L
- les equipes
- les 72 matchs de groupes
- les dates
- les stades

### Live snapshot

`fifa-live.json` est charge au demarrage.

Il doit a terme contenir :

- `syncedAt`
- `source`
- `warnings`
- `matches`
- `standings`

Pour l'instant, il est surtout un snapshot de transition.

### Simulation

Les scores modifies en UI ne reecrivent pas les JSON.
Ils sont gardes en memoire dans l'etat React, puis fusionnes avec les donnees live pour recalculer les sorties.

## Regles metier deja implementees

- 3 points victoire
- 1 point nul
- difference de buts
- buts marques
- tentative de mini-classement pour equipes a egalite de points
- prise des 8 meilleurs troisiemes
- projection d'un tableau a elimination directe

## Limites connues

### 1. Mapping des meilleurs troisiemes

Le bracket 2026 depend de combinaisons officielles FIFA entre groupes qualifies en 3e position.

L'implementation actuelle fait une affectation logique par groupes candidats, mais ce n'est pas encore la table officielle complete des combinaisons FIFA.

Donc :

- la projection est utile visuellement
- elle n'est pas encore garantie 100% conforme au mapping officiel FIFA pour tous les cas

### 2. Scraper FIFA incomplet

`npm run sync:fifa` :

- verifie l'accessibilite des pages FIFA
- regenere un snapshot JSON local

Mais il ne parse pas encore :

- les vrais scores
- les vrais standings
- les vrais drapeaux

### 3. Drapeaux

L'UI utilise actuellement des URLs `flagcdn` a partir des codes ISO2, avec fallback emoji.

Le besoin final demande idealement :

- recuperer les drapeaux depuis FIFA si possible
- recuperer aussi les noms d'equipes depuis la source FIFA

### 4. Knockout data

Le projet gere deja une projection visuelle du tableau.
En revanche, il n'y a pas encore :

- de scores live pour les matchs a elimination
- de simulation complete des tours a elimination
- de persistance utilisateur

## Prochaine roadmap recommandee

### Priorite 1

Terminer `scripts/sync-fifa.mjs` pour remplir reellement `public/data/fifa-live.json` avec :

- vrais scores de groupes
- vrais statuts des matchs
- vrais standings
- si possible drapeaux et libelles officiels FIFA

### Priorite 2

Rendre la projection du bracket 2026 conforme au mapping officiel FIFA pour les 8 meilleurs troisiemes.

Il faut idealement une table explicite de combinaisons officielles, pas seulement une affectation generique.

### Priorite 3

Ajouter la simulation des matchs a elimination directe :

- vainqueur manuel par match
- recalcul du tour suivant
- parcours complet d'une equipe

### Priorite 4

Ameliorer l'UX :

- filtre par equipe
- highlight du parcours d'une equipe
- affichage plus riche des matchs
- meilleur responsive mobile

## Comportement attendu du futur scraper

Le comportement cible de `sync:fifa` :

1. recuperer les pages ou endpoints FIFA
2. extraire les standings par groupe
3. extraire les fixtures et scores
4. mapper les equipes FIFA vers les `team.id` internes
5. ecrire `public/data/fifa-live.json`

Format attendu de `matches` :

```json
[
  {
    "id": "A1",
    "homeScore": 2,
    "awayScore": 1,
    "status": "finished"
  }
]
```

Format attendu de `standings` :

```json
[
  {
    "groupId": "A",
    "teamId": "MEX",
    "rank": 1,
    "points": 6,
    "goalDifference": 3,
    "goalsFor": 5,
    "goalsAgainst": 2
  }
]
```

## Hypotheses importantes

- Le seed local contient deja le calendrier de groupes.
- Le live FIFA doit seulement enrichir ou corriger les valeurs dynamiques.
- Les matchs de groupes sont la base indispensable pour recalculer les 16es/32es.
- Le projet est actuellement pure frontend + script Node de sync.

## Si une autre IA reprend le projet

Ordre conseille :

1. lire [PROJECT_HANDOFF.md](C:\Users\SébastienLegros\Documents\Dev\fifabracket\PROJECT_HANDOFF.md)
2. lire [src/lib/tournament.ts](C:\Users\SébastienLegros\Documents\Dev\fifabracket\src\lib\tournament.ts)
3. lire [src/App.tsx](C:\Users\SébastienLegros\Documents\Dev\fifabracket\src\App.tsx)
4. lire [scripts/sync-fifa.mjs](C:\Users\SébastienLegros\Documents\Dev\fifabracket\scripts\sync-fifa.mjs)
5. implementer d'abord la vraie sync FIFA
6. ensuite fiabiliser le mapping officiel du bracket

## Resume court

Le projet a deja un socle solide :

- UI prototype
- seed JSON
- moteur de classement
- projection du tableau
- mode simulation

Le gros morceau restant est :

- la vraie ingestion des donnees FIFA live
- puis l'alignement exact du bracket officiel 2026
