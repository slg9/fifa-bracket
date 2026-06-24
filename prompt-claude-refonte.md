# BRAKUP — Refonte phases Attaque & Défense

## Résumé
- **Attaque** : remplacer "swipe défenseurs + gonflage + gardien" par **Slalom rangées → Pulse timing**
- **Défense** : remplacer "swipe attaquants + FruitNinja" par **Space Invaders** (tirer sur ballons) → si 3 passent → **Fruit Ninja goal save**
- **RESTAURER** `FruitNinjaDefense.tsx` dans `src/challenge/` (supprimé par erreur avant)

---

## NE PAS TOUCHER
- BattleEngine.tsx, RoundResult.tsx, MatchResult.tsx
- battle.css, config.ts, types.ts, battleEngine.ts, commentary.ts
- BrakupHub.tsx, MatchBattle.tsx, MobileBracketFlow.tsx
- BalloonShot.tsx, BracketChallenge.tsx, ScorePanel.tsx
- Tout ce qui est dans challenge/ **sauf** FruitNinjaDefense.tsx à restaurer

Les props des composants AttackPhase/DefensePhase doivent rester identiques, BattleEngine ne change pas.

---

## 1. RESTAURER FruitNinjaDefense.tsx

**Fichier** : `src/challenge/FruitNinjaDefense.tsx`

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { sfx } from '../lib/sfx'

export interface FruitNinjaDefenseProps {
  balloonCount: number
  hasSonic: boolean
  onResult: (blocked: number, total: number, sonicBlocked: boolean) => void
}

type Balloon = {
  id: string
  type: 'normal' | 'sonic'
  x: number
  spawnDelay: number
  speed: number
  radius: number
}

type SwipeStart = { x: number; y: number; time: number }

function createBalloons(balloonCount: number, hasSonic: boolean): Balloon[] {
  const sonicIndex = hasSonic ? Math.max(0, balloonCount - 1 - Math.floor(Math.random() * Math.min(2, balloonCount))) : -1
  let delay = 0
  return Array.from({ length: balloonCount }, (_, index) => {
    if (index > 0) delay += Math.random() * 800
    const type = index === sonicIndex ? 'sonic' : 'normal'
    return {
      id: crypto.randomUUID(), type,
      x: 10 + Math.random() * 80,
      spawnDelay: delay,
      speed: 800 + Math.random() * 1000,
      radius: type === 'sonic' ? 22 : 26,
    }
  })
}

export function FruitNinjaDefense({ balloonCount, hasSonic, onResult }: FruitNinjaDefenseProps) {
  const [balloons] = useState<Balloon[]>(() => createBalloons(balloonCount, hasSonic))
  const [blockedIds, setBlockedIds] = useState<Set<string>>(() => new Set())
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set())
  const swipeStarts = useRef(new Map<string, SwipeStart>())
  const resultSent = useRef(false)

  const block = useCallback((id: string) => {
    setBlockedIds((current) => new Set(current).add(id))
    setResolvedIds((current) => new Set(current).add(id))
  }, [])

  useEffect(() => {
    const timers = balloons.map((balloon) =>
      window.setTimeout(() => setResolvedIds((current) => new Set(current).add(balloon.id)), balloon.spawnDelay + balloon.speed))
    return () => timers.forEach(window.clearTimeout)
  }, [balloons])

  useEffect(() => {
    if (resolvedIds.size !== balloons.length || resultSent.current) return
    resultSent.current = true
    const sonic = balloons.find((b) => b.type === 'sonic')
    const sonicBlocked = sonic ? blockedIds.has(sonic.id) : false
    const normalBalloons = balloons.filter((b) => b.type === 'normal')
    const normalBlocked = normalBalloons.filter((b) => blockedIds.has(b.id)).length
    const success = normalBlocked === normalBalloons.length && (!hasSonic || sonicBlocked)
    window.setTimeout(() => onResult(blockedIds.size, balloons.length, sonicBlocked), 250)
  }, [balloons, blockedIds, hasSonic, onResult, resolvedIds])

  const pointerDown = useCallback((balloon: Balloon, event: React.PointerEvent<SVGSVGElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (balloon.type === 'normal') { block(balloon.id); sfx.block() }
    else swipeStarts.current.set(balloon.id, { x: event.clientX, y: event.clientY, time: event.timeStamp })
  }, [block])

  const pointerUp = useCallback((balloon: Balloon, event: React.PointerEvent<SVGSVGElement>) => {
    if (balloon.type !== 'sonic') return
    const start = swipeStarts.current.get(balloon.id)
    if (!start) return
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (distance > 30 && event.timeStamp - start.time < 300) { block(balloon.id); sfx.sonic() }
    swipeStarts.current.delete(balloon.id)
  }, [block])

  return (
    <div className="brakup-defense" aria-label="Touchez les ballons et balayez le ballon Sonic">
      <div className="brakup-defense__hint">Touchez chaque ballon · Balayez le ⚡</div>
      {balloons.map((balloon) => (
        <svg key={balloon.id} viewBox="0 0 80 80"
          className={`brakup-fruit brakup-fruit--${balloon.type}${blockedIds.has(balloon.id) ? ' is-blocked' : ''}`}
          style={{ left:`${balloon.x}%`, width:balloon.radius*2, height:balloon.radius*2, animationDelay:`${balloon.spawnDelay}ms`, animationDuration:`${balloon.speed}ms` }}
          onPointerDown={(e) => pointerDown(balloon, e)} onPointerUp={(e) => pointerUp(balloon, e)}>
          <circle cx="40" cy="40" r="35" fill={balloon.type==='sonic'?'#3B82F6':'#fff'} stroke={balloon.type==='sonic'?'#60A5FA':'rgba(255,255,255,.3)'} strokeWidth="4" />
          {balloon.type==='sonic'
            ? <path d="M45 8 25 43h14l-5 29 22-39H42z" fill="#fff" />
            : <path d="M40 18 50 26 47 40 33 40 30 26z M33 40 23 52M47 40 57 52" stroke="#07101e" strokeWidth="4" fill="none" />}
          {blockedIds.has(balloon.id) && Array.from({length:8}, (_,i) =>
            <circle key={i} className="brakup-fruit-particle" cx={40+Math.cos(i*Math.PI/4)*24} cy={40+Math.sin(i*Math.PI/4)*24} r="4" fill="#FFB800" />)}
        </svg>
      ))}
    </div>
  )
}
export default FruitNinjaDefense
```

---

## 2. REFONTE AttackPhase.tsx

### Supprimer (tout l'ancien mécanisme)
- swipe sur les défenseurs (`handlePitchPointerMove`, `distanceToSegment`, `AttackDefenderSprite`)
- `RuntimeDefender`, `WAVES`, `DefenderSeed`, défenseurs
- charge du ballon (`startCharge`, `releaseShot`, `chargeDiameter`, `chargeDiameterRef`)
- `PERFECT_MIN`, `PERFECT_MAX`, `OVERSHOOT_DIAMETER`
- `GoalView` avec keeper/target/flight
- bouton PASS, player badge, score pill round dots
- `defenderColor`, `homeTeamId` unused
- Tout le CSS inline lié aux défenseurs et à l'arc power meter

### Garder
- Les props `AttackPhaseProps` (inchangées)
- La boucle `requestAnimationFrame` pour le timer
- `remainingMsRef`, `endedRef`
- `finish()` / `onRoundEnd`

### Implémenter Phase 1 — Slalom

**Mécanique** :
- Joueur (cercle/icône) descend automatiquement du haut vers le bas
- Le joueur **swipe latéralement** pour déplacer le cercle horizontalement
- Des rangées horizontales (6-8) apparaissent avec 1-4 espaces/trous par rangée
- Le joueur doit passer dans les trous
- **Collision avec un obstacle** → échec immédiat (tir raté, round perdu)
- **Timer** visible (barre qui descend en 5-8s selon difficulté)
- Le timer expire → timeout (tir raté)
- Si le joueur traverse toutes les rangées dans le temps → **Phase 2**

**Détails d'implémentation** :
- Utiliser `requestAnimationFrame` pour animer la descente continue
- Les rangées sont générées aléatoirement au début de la phase slalom
- Chaque rangée définit des trous : `{ y: number, holes: Array<{x: number, w: number}> }`
- Le joueur est représenté par un cercle (rayon ~8% de la largeur)
- Collision = le cercle overlap avec un obstacle
- Layout : ratio 3:4, centré

### Implémenter Phase 2 — Pulse Timing (slow-mo tir)

**Mécanique** :
- Écran : **but vu de face + ballon au centre qui pulse** (grossit/rétrécit en boucle comme battement cœur)
- Anneau cible doré fixe (rayon ~42)
- Le joueur doit **taper** quand le ballon est à la bonne taille (dans la zone de l'anneau)
- Fenêtre de tir parfait : 8-15% du rayon total selon difficulté
- Si réussi → animation ballon file vers le fond du but = **BUT**
- Si raté → animation ballon file à côté = **ARRÊTÉ**
- Utiliser `GoalView` existant mais **sans le gardien qui bouge**, juste comme décor
- La mécanique de pulse : `requestAnimationFrame` avec `pulseSpeed` qui fait osciller le rayon

### Config difficulté (à mettre en constantes dans AttackPhase)
```ts
const ATTACK_CONFIG = {
  easy:   { slalomTimer: 8,   slalomSpeed: 100, pulseSpeed: 1.4, perfectRange: 0.15 },
  medium: { slalomTimer: 6,   slalomSpeed: 150, pulseSpeed: 1.0, perfectRange: 0.10 },
  hard:   { slalomTimer: 4.5, slalomSpeed: 200, pulseSpeed: 0.7, perfectRange: 0.06 },
}
```

### Layout
```
┌─────────────────────────┐
│  ⏱ Barre de temps       │  5%
├─────────────────────────┤
│                         │
│  ┌─── PHASE JEU ────┐   │  70%
│  │  (slalom ou pulse) │  │
│  └───────────────────┘  │
├─────────────────────────┤
│  ⚔️ Score / Infos       │  10%
├─────────────────────────┤
│  📋 Infos round         │  15%
└─────────────────────────┘
```

---

## 3. REFONTE DefensePhase.tsx

### Supprimer (tout l'ancien mécanisme)
- `RuntimeAttacker`, `DEFENSE_WAVES`, `AttackerSprite`
- `SHOOTING_ZONE_Y`, `lockedAttackers`, `lockedAttackers`
- bouton **DÉFENDRE**, `beginFruitNinja`, `fruitAttackers`
- `GoalView` dans la zone de tir
- `FruitNinjaPhase` import
- Tout le CSS inline lié aux attaquants, locked badges, zone de tir

### Garder
- Les props `DefensePhaseProps` (inchangées)
- Le countdown, le `requestAnimationFrame` loop
- `endedRef`, `finish()`

### Implémenter Phase 1 — Space Invaders

**Mécanique** :
- Ballons de foot (SVG motif pentagone) descendent du haut vers le bas
- Le joueur **tape directement sur les ballons** pour les détruire
- **Hitbox individuelle** par ballon (pas de sweep général)
- Si **3 ballons atteignent le bas** de l'écran → Phase 2
- Timer 8-12s selon difficulté
- Ballons arrivent par vagues (3-5 vagues)
- Vitesse et fréquence augmentent à chaque vague

**Détails d'implémentation** :
- Chaque ballon : position x aléatoire, descend à vitesse linéaire avec légère oscillation horizontale
- Tap sur un ballon = il disparaît avec animation d'explosion (particules)
- Décors : ballons classiques blancs motif pentagone, pas de sonic/costaud
- Timer barre visible en haut

### Implémenter Phase 2 — Goal Save (Fruit Ninja gardien)

**Déclenché UNIQUEMENT si 3+ ballons passent en phase 1**

**Mécanique** :
- Reprend le concept du `FruitNinjaDefense.tsx` restauré dans `src/challenge/`
- Des ballons traversent l'écran rapidement
- Le joueur doit les swiper/toucher avant qu'ils passent
- Version **gardien** : ballons viennent vers le but (perspective, de bas en haut)
- Fenêtre très courte : 0.6-0.8s par ballon
- 3-5 ballons selon le nombre d'attaquants passés
- Si UN ballon passe → but encaissé
- Si tous arrêtés → défense réussie

**Détails d'implémentation** :
- Import `FruitNinjaDefense` depuis `../challenge/FruitNinjaDefense`
- Adapter pour mode gardien : trajectoires venant vers le centre (remonter de bas en haut)
- Visuels : but en fond (goal frame), ballons foot SVG

### Config difficulté (à mettre en constantes dans DefensePhase)
```ts
const DEFENSE_CONFIG = {
  easy:   { waveTimer: 12, balloonSpeed: 80,  waveCount: 3, balloonsPerWave: 4 },
  medium: { waveTimer: 10, balloonSpeed: 120, waveCount: 4, balloonsPerWave: 5 },
  hard:   { waveTimer: 8,  balloonSpeed: 160, waveCount: 5, balloonsPerWave: 7 },
}
```

### Layout Phase 1
```
┌─────────────────────────┐
│  ⏱ Barre de temps       │  5%
├─────────────────────────┤
│  ┌─── SPACE INVADERS ─┐ │  70%
│  │  ballons descendent  │ │
│  │  le joueur tape     │ │
│  └─────────────────────┘ │
├─────────────────────────┤
│  ⚽ Ballons : 3/7 · Passés│ 10%
├─────────────────────────┤
│  📋 Infos round         │  15%
└─────────────────────────┘
```

### Layout Phase 2
```
┌─────────────────────────┐
│  ⏱ URGENCE              │  5%
├─────────────────────────┤
│  ┌── FRUIT NINJA GOAL ─┐│  75%
│  │ ballons traversent   ││
│  │ le but, swipe       ││
│  └─────────────────────┘│
├─────────────────────────┤
│  ⚽ Arrêtés : 2/4       │  20%
└─────────────────────────┘
```

---

## 4. Changement de type DefenseOutcome

Dans DefensePhase.tsx et types.ts, remplacer :

```ts
// ANCIEN
export type DefenseOutcome =
  | { path: 'clean_sweep' }
  | { path: 'fruit_ninja'; attackersInZone: number; saved: boolean }

// NOUVEAU
export type DefenseOutcome =
  | { path: 'space_invaders'; blocked: number; total: number }
  | { path: 'goal_save'; blocked: number; total: number; saved: boolean }
```

Mettre à jour `handleDefenseEnd` dans `BattleEngine.tsx` pour matcher le nouveau type.

---

## 5. CSS

- Injecter les styles via des blocs `<style>{}</style>` dans chaque composant (comme fait actuellement)
- **NE PAS modifier** `battle.css`

### Styles à ajouter dans AttackPhase
- `.battle-attack-slalom` : fond du terrain, caméra centrée
- `.battle-row` : rangée d'obstacles
- `.battle-player-dot` : cercle du joueur
- `.battle-pulse-timing` : overlay de la phase pulse
- Keyframes pour animation de descente, collision flash, pulse

### Styles à ajouter dans DefensePhase
- `.battle-defense-invaders` : fond noir
- `.battle-invader-ball` : ballon foot qui descend
- `.battle-goal-save` : overlay Fruit Ninja gardien
- Keyframes pour descente, explosion, swipe trail

---

## 6. Vérifications finales

```bash
npx tsc --noEmit    # zéro erreur
npm run build       # compile sans erreur
```
