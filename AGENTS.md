# AGENTS.md

## 1. Project overview

- Project name from `package.json`: `fifabracket`.
- The app is a React + TypeScript web app around the 2026 FIFA World Cup.
- It has 2 main product surfaces:
  - the main simulator / tracker (`App.tsx`) for groups, live data, standings and final bracket;
  - the `?challenge` game mode (`BrakupHub`) with a mobile-first football arcade flow.
- The challenge mode is designed like a vertical 9:16 mini-game experience with a selectable match map, battle phases and bracket scoring.
- User goals:
  - follow real or simulated tournament results;
  - reorder group rankings in simulation mode;
  - pick knockout winners;
  - play arcade match phases to validate picks and earn bonuses;
  - save and compare brackets.
- High-level navigation:
  - default route: simulator / bracket shell in `App.tsx`;
  - `?challenge`: Brakup challenge shell in `src/challenge/BrakupHub.tsx`;
  - inside challenge: splash -> map of matches -> battle -> saved brackets / leaderboard.

## 2. Tech stack

- Front-end: React 19
- Language: TypeScript
- Bundler / dev server: Vite 8
- Styling:
  - global CSS in `src/App.css`, `src/index.css`, `src/challenge/challenge.css`, `src/components/battle/battle.css`
  - many battle/challenge components also embed local `<style>` blocks inside TSX
- Rendering:
  - heavy use of SVG for gameplay surfaces, goal geometry, balls, effects and bracket connectors
- Utility libs:
  - `html-to-image` for bracket export / image capture
  - `@vercel/blob` for persisted challenge data on the backend
- Audio:
  - background music via `src/lib/useGameAudio.ts`
  - synthesized UI SFX via `src/lib/sfx.ts`
- Backend/runtime edges:
  - Vite dev middleware in `vite.config.ts`
  - Vercel-style API handlers in `api/`
  - local / generated tournament data in `public/data/`

## 3. Repository structure

- `src/`
  - main front-end source.
- `src/components/battle/`
  - active football battle system used by current challenge mode.
  - this is the most sensitive gameplay area.
- `src/challenge/`
  - challenge shell, world map selector, bracket UI, save flow, leaderboard.
  - also contains some older/alternate mini-game components that are not the current active battle path.
- `src/lib/`
  - pure logic and shared services: tournament rules, scoring, data fetching, commentary, kits, audio.
- `src/types.ts`
  - shared domain and gameplay types.
- `public/data/`
  - seed tournament JSON and cached live snapshot JSON used by the app at runtime.
- `api/`
  - server endpoints for challenge persistence plus some production helpers.
- `scripts/`
  - FIFA sync and cache generation scripts.
- `dist/`
  - build output, generated.
- `node_modules/`
  - dependencies, generated.
- `README.md`
  - default Vite template, not a project source of truth.
- `PROJECT_HANDOFF.md`, `brakup.md`, design docs
  - useful historical notes, but not the runtime truth. Prefer source code.

## 4. Key files and responsibilities

### App shell and data

- `src/App.tsx`
  - main non-challenge application shell.
  - loads tournament seed and live snapshot, manages simulator mode, group standings, knockout picks, day modal, match stats modal, odds and header state.
  - switches to `BrakupHub` when `?challenge` is present.
  - do not casually change hook order or conditional returns above hooks.
  - do not break:
    - seed/bootstrap loading;
    - live polling logic;
    - simulator storage persistence;
    - bracket/fullscreen/header controls;
    - `?challenge` routing handoff.

- `src/lib/data.ts`
  - front-end data access for:
    - `/data/world-cup-2026.json`
    - `/data/fifa-live.json`
    - `/api/fifa-sync`
    - `/api/match-stats`
    - `/api/odds`
  - modify this only if API contracts change.

- `vite.config.ts`
  - Vite config plus dev/preview middleware for `/api/fifa-sync`, `/api/match-stats`, `/api/odds`.
  - important runtime boundary between UI and live data APIs.

- `public/data/world-cup-2026.json`
  - canonical tournament seed:
    - groups
    - teams
    - fixtures
    - metadata
  - team names, codes, flags and players ultimately come from here.

- `public/data/fifa-live.json`
  - cached live snapshot used for instant boot before background sync.

### Tournament and scoring logic

- `src/lib/tournament.ts`
  - group standings calculation, head-to-head tie handling, best third-placed teams, knockout bracket building, live score merging.
  - this is core business logic for both simulator and challenge bracket resolution.
  - do not break the knockout template order or entrant resolution rules.

- `src/lib/scoring.ts`
  - official bracket scoring rules by stage.
  - includes stage points, champion bonus, streak bonus, early-bird bonus and battle bonus cap.
  - update this only when scoring rules intentionally change.

- `src/lib/players.ts`
  - derives top-scorer style stats from team players plus match scores.

- `src/lib/teamKits.ts`
  - resolves jersey color palettes by FIFA/team code.
  - active battle visuals depend on this.

- `src/lib/commentary.ts`
  - commentary template pool and token replacement for attack/defense phases.
  - text is generated from stable phase names in `src/types.ts`.

### Challenge shell and map

- `src/challenge/BrakupHub.tsx`
  - active challenge entry point.
  - orchestrates:
    - splash/loading
    - challenge map
    - active battle
    - bracket overlay
    - saved brackets
    - leaderboard
    - email save flow
  - current active battle path uses `src/components/battle/BattleEngine.tsx`, not `src/challenge/MatchBattle.tsx`.

- `src/challenge/WorldCupMapMenu.tsx`
  - active mobile map-style match selector.
  - contains:
    - `MATCH_SEQUENCE`
    - node placement
    - map path SVG
    - pan/drag logic
    - node status derivation (`locked`, `live`, `completed`)
    - bottom sheet entry (`LevelEntryScreen`)
  - keep the match order sequential. Do not convert it into a grid or classic bracket.
  - do not break:
    - `handleSelectNode`
    - `handlePickTeam`
    - `handlePlay`
    - bottom-sheet open/close behavior
    - locked/live/completed logic.

- `src/challenge/BracketChallenge.tsx`
  - challenge bracket view with connectors and score sidebar.
  - used in the full-screen bracket overlay from challenge mode.

- `src/challenge/ScorePanel.tsx`
  - side panel showing score, stage progress and active bracket summary.

- `src/challenge/Leaderboard.tsx`
  - public leaderboard page for top brackets.

- `src/challenge/MyBrackets.tsx`
  - personal brackets view.

- `src/challenge/EmailEntry.tsx`
  - save/submit flow UI for brackets.

- `src/challenge/useChallengePreload.ts`
  - preloads splash assets and audio before revealing the challenge splash.

### Active battle gameplay

- `src/components/battle/BattleEngine.tsx`
  - active battle orchestrator.
  - owns round sequencing, score, phase transitions, commentary handoff, pause, round result and final result.
  - active round sequence is fixed:
    - `attack`
    - `defense`
    - `fruit_ninja`
    - `attack`
    - `defense`
  - `fruit_ninja` is treated as a defensive save round in result resolution.

- `src/components/battle/AttackPhase.tsx`
  - active attack gameplay.
  - contains the dribble/slalom subphase and the shot-on-goal subphase.
  - one of the most fragile files in the repo.

- `src/components/battle/GoalView.tsx`
  - renders the goal, target, keeper, keeper zone and animated shot path.
  - defines the geometry helpers that the shot system must stay aligned with.

- `src/components/battle/DefensePhase.tsx`
  - active defensive phase.
  - first subphase is a lane/space-invaders style interception game.
  - after 3 attackers pass the red line, it escalates to `GoalSave`.

- `src/components/battle/GoalSave.tsx`
  - active swipe-based goal-line save phase used after defensive failure threshold.
  - still part of the same defense round, not a separate match.

- `src/components/battle/FruitNinjaPhase.tsx`
  - active final defensive chaos phase where the player slashes incoming balls and avoids decoys.

- `src/components/battle/RoundResult.tsx`
  - between-round result screen and commentary.

- `src/components/battle/MatchResult.tsx`
  - end-of-match result screen.

- `src/components/battle/config.ts`
  - stage/difficulty helper config, mostly shared conventions.

- `src/components/battle/battle.tokens.ts`
  - color/font/timing design tokens for battle UX.

### Older / alternate challenge gameplay

- `src/challenge/MatchBattle.tsx`
  - older battle orchestrator based on `BalloonShot` and `FruitNinjaDefense`.
  - not the active path used by current `BrakupHub`.
  - do not edit this thinking it will fix the current challenge mode unless the active route is intentionally switched back.

- `src/challenge/BalloonShot.tsx`
  - older attack mini-game, used only by legacy `MatchBattle`.

- `src/challenge/FruitNinjaDefense.tsx`
  - older defense mini-game, used only by legacy `MatchBattle`.

- `src/challenge/MobileBracketFlow.tsx`
  - older swipe-card match selector, not the active world-map selector anymore.

## 5. Main gameplay concepts

- Player team:
  - chosen side for the currently selected knockout match.
- Opponent team:
  - the other resolved team in the same match.
- Match:
  - a knockout fixture in sequence from M73 to M104.
- Round:
  - one internal battle sequence step such as `attack`, `defense` or `fruit_ninja`.
- Attack phase:
  - player attacks through dribble/slalom, then shoots.
- Defense phase:
  - player stops attackers before they enter the shooting zone; too many leaks trigger `GoalSave`.
- Dribble phase:
  - first attack subphase where the player moves laterally through gates and obstacles.
- Shot phase:
  - second attack subphase where the player aims and times a strike.
- Fruit ninja phase:
  - slash-based defensive chaos phase with real balls and decoy balls.
- Round result:
  - success/failure summary shown before next round or final result.
- Match result:
  - final resolved battle score and winner.
- Common outcomes:
  - `goal`
  - `saved`
  - `miss`
  - `intercepted`
  - `timeout`
  - `defense_perfect`
  - `goal_conceded`
- Difficulty:
  - `easy`, `medium`, `hard`
  - affects dribble wave count, gauge size/speed, keeper save radius, defense pressure and save-chaos speed.
- Gauge:
  - attack shot timing bar. Its green zone determines shot quality.
- Keeper:
  - animated goalie in shot phase, using the same coordinate space as the target and shot curve.
- Aim target:
  - normalized goal-space target in 0..100 x/y space.
- Ball animation:
  - must visibly travel before the textual result appears.

## 6. Attack phase

### Dribble phase

- File: `src/components/battle/AttackPhase.tsx`
- Internal phase name: `gd`
- Player control:
  - pointer drag or keyboard left/right moves the attacker laterally.
  - jump is available for some wave types.
- Defenders/obstacles:
  - generated procedurally by `generateSlalomWaves(...)`.
  - wave types include:
    - `gate`
    - `narrow_gate`
    - `slide_wall`
    - `double_slide_wall`
    - `diagonal_press`
    - `combo_gate_slide`
- Motion/performance:
  - the player and wall container are updated directly through refs and DOM styles.
  - this avoids re-rendering on every frame.
- Collision/interception:
  - each wave is checked once when it reaches the player band.
  - success marks the wave as passed and moves to the next obstacle.
  - failure flashes feedback and ends the round with `intercepted`.
- Transition to shot:
  - when all waves are passed, the phase shows a short intro and then switches to shot mode.
- Do not break when editing shot behavior:
  - the dribble phase state machine
  - direct-DOM movement refs
  - jump timing windows
  - generated wave evaluation
  - the transition from `gd` -> shot intro -> `shot`

### Shot phase

- File: `src/components/battle/AttackPhase.tsx` + `src/components/battle/GoalView.tsx`
- Expected mechanic:
  - hold to aim;
  - drag to move the target inside the goal;
  - release to fire;
  - gauge timing and keeper position decide the result.

Stable rules from the current implementation:

- Pointer down / touch start begins aiming.
- Pointer move / touch move updates the target.
- Pointer up / touch end fires the shot.
- The shot must never fire on simple pointer down.
- The gauge cursor is sampled on release.
- If the gauge is outside the green zone: `miss`.
- If the gauge is in the green zone and the keeper is close enough to the target: `saved`.
- If the gauge is in the green zone and the keeper is not blocking the target: `goal`.
- `AttackEndReason` currently includes:
  - `goal`
  - `saved`
  - `miss`
  - `intercepted`
  - `timeout`
- The ball flight is animated first through `ballFlight`.
- `resultLabel` is shown only after flight time.
- `finish(...)` is delayed until after the visible shot feedback.
- There is an auto-miss timeout after a long wait in shot mode, and it still animates the miss ball before showing `RATE !`.

Practical invariants:

- Keep `pointerToGoalTarget(...)` aligned with `GoalView` geometry helpers.
- Keep gauge timing independent from aim pointer state.
- Keep the keeper save test in the same normalized coordinate system as the aim target.

## 7. Goal and coordinate system

- File: `src/components/battle/GoalView.tsx`
- This file is the geometry source of truth for shot mode.
- Core helpers:
  - `goalFrameMetrics(...)`
  - `goalEdgeAtY(...)`
  - `goalPointFromNormalized(...)`
  - `buildShotCurve(...)`
- The goal is not a simple rectangle. It uses a perspective/trapezoid frame.
- In compact mobile mode:
  - top goal edge is narrower than the bottom edge;
  - normalized target coordinates are converted into actual SVG points inside that trapezoid.

Important rule:

- The target, keeper, keeper zone, keeper halo, ball path and shot collision logic must all use the same coordinate system.

Current compact geometry conventions:

- top Y around `0.11 * height`
- bottom Y around `0.275 * height`
- top left/right around `20% / 80%`
- bottom left/right around `14% / 86%`

If you change one of these without updating the others, the following bugs appear:

- target appears in one place but the ball flies elsewhere;
- keeper visually covers a shot but logic says goal;
- saved/miss/goal feel random;
- touch mapping becomes offset in compact mode.

## 8. Visual style rules

- Mobile-first, especially for challenge gameplay.
- Challenge/game screens should preserve a vertical 9:16 feeling even on desktop.
- Visual direction:
  - football arcade
  - colorful but readable
  - neon green / gold / red accents on dark backgrounds
  - playful / kawaii character proportions
- Keep gameplay readable on small screens.
- Prefer simple SVG shapes over heavy assets for gameplay-critical visuals.
- Backgrounds can be layered gradients and subtle patterns, but gameplay surfaces must stay clear.
- Avoid clutter behind the goal or behind fast gameplay objects.
- Bracket and map UIs should stay premium/mobile, not revert to a desktop spreadsheet feel.

## 9. Animation rules

- Animations must support gameplay feedback, not delay it arbitrarily.
- A shot must visibly travel before the result text appears.
- The ball must remain visible during the shot animation.
- A goal should end with the ball reaching the cage area.
- A save should visually route the ball into a keeper/save outcome.
- A miss should clearly leave the goal frame.
- Result text should appear after impact or end-of-flight, not before.
- Do not end a round before the player can actually see the feedback.
- During hot gameplay, prefer short, clear animations over decorative long ones.

## 10. State and refs conventions

- The project mixes `useState` and `useRef` intentionally.

Use `useState` for:

- view/phase transitions;
- values that must re-render UI;
- modal open/close state;
- result labels and round summaries;
- persisted user selections.

Use `useRef` for:

- `requestAnimationFrame` loops;
- mutable positions updated every frame;
- cached DOM rects;
- timers and one-shot guards;
- audio ownership and previous values;
- drag/swipe transient state.

Existing performance pattern in battle files:

- hot loops update DOM styles directly through refs instead of calling `setState` every frame.
- geometry is cached before pointermove / RAF loops.

Precautions:

- do not convert frame-by-frame refs into React state unless necessary;
- do not introduce conditional hooks;
- do not move hooks below early returns;
- do not call `setState` from every pointermove unless the UI actually needs to re-render.

## 11. Performance rules

- Avoid heavy calculations inside `pointermove`.
- Avoid repeated `getBoundingClientRect()` inside hot paths.
- Prefer cached rect refs refreshed on resize or phase changes.
- Preserve existing `requestAnimationFrame` loops.
- Keep challenge gameplay smooth on mobile.
- Keep SVG counts reasonable in active scenes.
- Use direct DOM style updates for per-frame transforms when the component already follows that pattern.
- Be careful with timers layered on top of RAF; verify cleanup.

## 12. TypeScript rules

- Shared types live in `src/types.ts`.
- Important gameplay types:
  - `DefenseOutcome`
  - `BattleRoundType`
  - `BattlePhase`
  - `BattleRound`
  - `BattleResult`
- Important domain types:
  - `Team`
  - `GroupMatch`
  - `RankedStandingRow`
  - `KnockoutEntrant`
  - `KnockoutMatch`
  - `ChallengeEntry`
- Rules:
  - do not introduce unnecessary `any`;
  - keep union types aligned with runtime behavior;
  - if you add a new round type or result state, update all relevant unions, result screens and resolution logic;
  - if a component uses discriminated unions like `entrant.kind`, keep exhaustive handling intact.

Current nuance to remember:

- `BattleRoundType` includes `fruit_ninja`, but `BattleRound` in `src/types.ts` still models only `attack | defense`.
- The active `BattleEngine` hardcodes its round sequence and handles `fruit_ninja` outside that older `BattleRound` shape.
- Be careful when refactoring these types: the active engine and the older challenge battle code are not the same system.

## 13. Encoding and UI text rules

- This repo has already shown mojibake / encoding issues in some strings and console outputs.
- Prefer UTF-8 when editing files.
- If a tool tends to corrupt accents, prefer safe ASCII UI strings temporarily for gameplay labels:
  - `ARRETE`
  - `RATE`
  - `Deplace`
  - `Relache`
- Be extra careful with:
  - accented French labels
  - emoji flags
  - external JSON files containing team names
- After text edits, visually verify that characters are not turned into garbled sequences.

## 14. Rules for future agents

- Read this file before any modification.
- Identify the exact cause before patching.
- Make the smallest effective change.
- Do not rewrite a whole component unless explicitly asked.
- Do not break dribble logic while changing shot logic.
- Do not break goal geometry while changing visuals.
- Do not change the global style direction without a clear request.
- Do not delete existing logic until its role is understood.
- Prefer editing the active battle stack in `src/components/battle/` for current challenge gameplay.
- Do not patch legacy `src/challenge/MatchBattle.tsx` expecting current challenge gameplay to change.
- Always re-check TypeScript after changes.
- Preserve the mobile 9:16 feel in gameplay and challenge screens.
- Preserve the arcade football style.
- Keep code maintainable and explicit.

## 15. Common bug investigation checklist

### Gameplay bug

- Verify which gameplay system is active:
  - current challenge uses `src/components/battle/*`
  - older `src/challenge/MatchBattle.tsx` is legacy
- Check the responsible phase file.
- Check refs that gate one-shot completion.
- Check `useState` phase transitions.
- Check callbacks passed into `BattleEngine`.
- Check timers and delayed `finish(...)` calls.
- Check whether the round is ending too early.

### Animation bug

- Verify the animation state is actually created.
- Verify the visual component renders that state.
- Verify result text does not hide the animation too early.
- Verify `finish()` is not called before the visible feedback.
- Verify the relevant SVG/DOM node still renders.
- Verify phase conditions such as `phase === 'shot'`, `ballFlight`, `resultLabel`, `endedRef`.

### Coordinate bug

- Verify the same coordinate system is used everywhere.
- Verify pointer -> target conversion.
- Verify `GoalView` compact geometry helpers.
- Verify keeper zone computations.
- Verify clamp logic.
- Verify the shot path uses the same normalized target coordinates as the hit/save logic.

## 16. How to start a new Codex task

```txt
Lis AGENTS.md avant toute modification.

Bug / feature :
[decrire ici]

Fichiers probablement concernes :
- [fichier 1]
- [fichier 2]

Avant de modifier :
1. Identifie la cause exacte.
2. Explique le patch minimal.
3. Applique uniquement la correction necessaire.
4. Ne casse pas le reste du gameplay.
```

