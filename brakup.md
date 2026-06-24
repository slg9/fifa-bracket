# BRAKUP — Implémentation complète P1 à P8
                                              
  ## Contexte projet
                                              
  Tu travailles sur /Users/sebastienlegros/Doc
  uments/dev/front/fifa-bracket
  Application React 19 + Vite + TypeScript.   
  Pas de router installé.                     
  Navigation par URLSearchParams. Pas de
  librairie d'animation externe.              
  Déploiement Vercel. Vercel Blob déjà      
  configuré pour le cache FIFA.               
                                            
  ## Stack existante à conserver intacte      
  - src/App.tsx — app principale (groupes + 
  bracket simulateur)                         
  - src/lib/tournament.ts — knockoutTemplates
  M73-M104, computeStandings                  
  - src/lib/data.ts — loadSeed,             
  loadLiveSnapshot, fetchMatchStats           
  - src/types.ts — Team, GroupMatch,        
  KnockoutEntrant, RankedStandingRow          
  - src/App.css — design system dark, --neon
  #2bff9a, --text, fond #050b16               
  - api/sync.ts — endpoint Vercel sync FIFA 
  (existant)                                  
                                            
  NE PAS modifier ces fichiers sauf pour      
  ajouter des imports/exports nécessaires.  
                                              
  ## Route Brakup                           
  /?challenge → mode challenge Brakup
  /?challenge&match=M73 → combat direct       
  /?challenge&brackets → mes brackets         
  /?challenge&board → leaderboard             
                                              
  Détection dans App.tsx :                  
  const params = new                          
  URLSearchParams(window.location.search)     
  const challengeMode =
  params.has('challenge')                     
                                            
  ## Ce que tu dois créer

  ### FICHIERS NOUVEAUX                       
  src/challenge/
    BrakupHub.tsx           — page d'entrée   
  (?challenge)                                
    BracketChallenge.tsx    — bracket avec
  boutons Jouer/Choisir                       
    MatchBattle.tsx         — écran de combat
  complet                                     
    BalloonShot.tsx         — mécanique tir 
  (P1)                                        
    FruitNinjaDefense.tsx   — mécanique     
  défense (P2)                                
    Commentary.tsx          — commentaires  
  scénarisés animés                           
    ScorePanel.tsx          — panneau score 
  desktop                                     
    MobileBracketFlow.tsx   — flow vertical 
  mobile swipeable                            
    WinAnimation.tsx        — 6 animations SVG
   aléatoires                                 
    Leaderboard.tsx         — top 50 public 
    MyBrackets.tsx          — brackets        
  sauvegardés par l'utilisateur             
    EmailEntry.tsx          — saisie email +  
  pseudo                                      
    challenge.css           — styles Brakup
                                              
  src/lib/                                  
    challengeData.ts        — API calls vers  
  /api/challenge                            
    scoring.ts              — calcul des
  scores et bonus                             
    commentary.ts           — pool de
  templates commentaires                      
    battleEngine.ts         — logique rounds
  attaque/défense                             
   
  api/                                        
    challenge.ts            — endpoint Vercel
  multi-action                                
   
  ---                                         
                                            
  ## P1 — MÉCANIQUE BALLON (BalloonShot.tsx)  
   
  Composant React qui gère le tir au but via  
  presse & maintien.                        
                                              
  ### Props                                 
  interface BalloonShotProps {
    difficulty: 'easy' | 'medium' | 'hard'    
    onResult: (result: 'goal' | 'saved' |
  'wide' | 'weak') => void                    
    teamColor?: string                      
  }                                           
                                            
  ### Logique
  - Au mount : générer targetRadius aléatoire
  entre 40% et 75% du maxRadius               
  - maxRadius = 80px sur mobile, 100px sur
  desktop                                     
  - Tolérance de réussite : ±8% du          
  targetRadius                                
  - ballRadius démarre à 8px, grossit à     
  4px/16ms tant que l'utilisateur presse      
  - Si relâché dans tolérance → 'goal'      
  - Si relâché trop petit (< target - 8%) →   
  'weak'                                      
  - Si relâché trop grand (> target + 8%) →   
  'wide'                                      
  - Si timeout 3000ms sans relâcher → 'saved'
  (gardien attrape)                           
  - Jauge de temps : arc SVG strokeDashoffset
  qui se remplit en 3s                        
                                            
  ### SVG à rendre                            
  Tout en SVG inline, viewBox="0 0 200 200" :
  1. Fond sombre semi-transparent             
  2. Cercle ballon (cx=100, cy=100,           
  r={ballRadius}) avec gradient radial        
    - Noir/blanc type ballon football avec    
  pattern hexagone SVG                        
  3. Anneau doré cible (r={targetRadius})   
  stroke="#FFB800" stroke-width="3"           
    - Animation CSS pulse 1s ease-in-out    
  infinite opacity 0.6-1                      
  4. Arc timer (r=90) stroke="#2bff9a"      
  strokeDasharray autour du tout              
  5. Texte central "APPUIE" qui disparaît dès
  le premier appui                            
                                            
  ### CSS animations nécessaires (dans        
  challenge.css)                            
  @keyframes ringPulse { 0%,100% { opacity:0.5
   } 50% { opacity:1 } }                      
  @keyframes ballGrow { utilise transform
  scale pour feedback visuel }                
                                            
  ### Events                                  
  onPointerDown → setIsPressing(true)
  onPointerUp / onPointerLeave → calculer     
  résultat et appeler onResult                
  Sur mobile : touch-action: none sur le
  container pour éviter scroll                
                                            
  ---                                         
                                            
  ## P2 — MÉCANIQUE DÉFENSE
  (FruitNinjaDefense.tsx)

  ### Props                                   
  interface FruitNinjaProps {
    balloonCount: number   // 1-5, fourni par 
  le battleEngine                             
    hasSonic: boolean      // si vrai, un des
  ballons est de type Sonic                   
    onResult: (blocked: number, total: number,
   sonicBlocked: boolean) => void             
  }                                         
                                              
  ### Types de ballons                      
  type Balloon = {
    id: string
    type: 'normal' | 'sonic'
    x: number          // position X aléatoire
   10%-90% du container                       
    spawnDelay: number // délai avant         
  apparition (0-1200ms entre chaque)          
    speed: number      // durée de traversée
  1500-3000ms                                 
    radius: number     // 28px normal, 22px 
  sonic                                       
  }                                         
                                              
  ### Logique                               
  - Générer les ballons à l'init selon
  balloonCount et hasSonic                    
  - Le ballon Sonic est toujours dans les 2
  derniers                                    
  - Chaque ballon monte du bas vers le haut 
  (translateY animation)                      
  - Si le ballon atteint le haut sans être  
  touché → compte comme raté                  
  - Normal : onPointerDown sur le cercle SVG =
   bloqué (explosion particules)              
  - Sonic : nécessite un swipe (distance >  
  30px en <200ms) sur le cercle               
  - Si swipe mais pas assez vite → ne compte
  pas                                         
  - Zone de jeu = hauteur 70vh, largeur 100%
                                              
  ### Rendu SVG
  Chaque ballon = <circle> absolu animé par   
  CSS                                         
  Normal : fill="#ffffff",
  stroke="rgba(255,255,255,0.3)"              
  Sonic : fill="#3B82F6", stroke="#60A5FA",
  glow filter drop-shadow                     
    + icône éclair ⚡ SVG inline au centre du
  cercle                                      
    + animation vibrate CSS              
                                              
  ### Résultat                           
  Si hasSonic et sonic non bloqué → but
  adverse automatique                         
  Sinon : blocked/total >= 0.6 → défense
  réussie                                     
                                         
  ---                                         
                                         
  ## P3 — BACKEND SAUVEGARDE
  (api/challenge.ts)

  Endpoint Vercel serverless multi-action.    
                  
  ### Structure Vercel Blob                   
  Les brackets sont stockés dans Vercel Blob :
  - Clé : challenge/{emailHash}/brackets.json
  - Contenu : tableau de ChallengeEntry[]     
  - Leaderboard : challenge/leaderboard.json  
                                              
  ### Types (à mettre dans src/types.ts en    
  ajout)                                 
  interface ChallengeEntry {                  
    id: string                    //          
  crypto.randomUUID()          
    emailHash: string             // SHA-256  
  de l'email normalisé                        
    pseudo: string                 
    bracketName: string                       
    picks: Record<string, string> // matchId →
   teamId                                     
    score: number                   
    rank: number | null                       
    submittedAt: string | null    // null =
  brouillon                                   
    breakdown: Record<string, {       
      points: number                          
      correct: boolean                   
      played: boolean                         
      stage: string                    
    }>                                        
    battleBonuses: number         // bonus
  gagnés en jouant les matchs                 
    createdAt: string                    
  }                                           
                                         
  ### Actions de l'endpoint                   
  export default async function handler(req,
  res) {                                      
    const { action } = await req.json()  
                                              
    switch(action) {                      
      case 'submit':   // POST — crée/met à   
  jour un bracket                             
      case 'get':      // GET — récupère    
  brackets par token JWT                      
      case 'board':    // GET — top 50      
  leaderboard public                          
      case 'resend':   // POST — renvoie magic
   link email                                 
      case 'score':    // POST — recalcule  
  scores (appelé depuis /api/sync)            
    }                                         
  }                                         
                                              
  ### Auth                                  
  Token JWT signé avec process.env.JWT_SECRET 
  Payload : { emailHash, exp: now + 30jours }
  Pas de librairie JWT — implémenter avec   
  crypto.subtle Web API (disponible dans    
  Vercel Edge)                                
                                              
  ### Email via Resend                        
  fetch('https://api.resend.com/emails', {    
    method: 'POST',                           
    headers: { Authorization: `Bearer         
  ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({                    
      from: 'brakup@ton-domaine.com',       
      to: email,                              
      subject: 'Ton lien Brakup 🏆',
      html: `<a                               
  href=".../?challenge&token=JWT">Accéder à 
  mes brackets</a>`                           
    })                                      
  })                                          
                                            
  Si RESEND_API_KEY absent → log warning,     
  continuer sans email (dev mode)             
                                  
  ---                                         
                                            
  ## P4 — SCORING (src/lib/scoring.ts)
                                            
  ### Points par stage                      
  const STAGE_POINTS: Record<string, number> =
   {                              
    'Round of 32':   3,                       
    'Round of 16':   6,                     
    'Quarter-final': 10,                      
    'Semi-final':    15,                    
    'Finale':        20,                      
  }                                           
  const CHAMPION_BONUS = 30       
                                              
  ### Bonus                                 
  - earlyBird (soumis 48h avant               
  2026-06-28T22:00:00Z) : +10     
  - perfectR32 (16/16 corrects en R32) : +25  
  - streak5 (5 corrects consécutifs) : ×1.5 
  sur les 5                                   
  - battleBonus : accumulé depuis les combats
  joués (max 40)                              
                                              
  ### Fonction principale                     
  export function calculateScore(             
    entry: ChallengeEntry,                  
    realResults: Record<string, string>  //   
  matchId → winning teamId                  
  ): { score: number; breakdown:            
  ChallengeEntry['breakdown'] }             
                                              
  ### Recalcul leaderboard                  
  export async function                       
  recalculateLeaderboard(                   
    realResults: Record<string, string>       
  ): Promise<void>                          
  // Lit tous les brackets de Vercel Blob     
  // Recalcule chaque score       
  // Trie et écrit challenge/leaderboard.json 
  // Appelé depuis api/sync.ts à la fin du  
  handler existant                          
                                              
  ---                                         
                                              
  ## P5 — WIN ANIMATIONS (WinAnimation.tsx)   
                                              
  ### Props                                 
  interface WinAnimationProps {             
    variant?: 'confetti' | 'explosion' |    
  'stars' | 'lightning' | 'crown' |           
  'shockwave' | 'random'                    
    onComplete?: () => void                   
    size?: number  // viewBox size, défaut 200
  }                               
                                              
  Si variant='random' → Math.random() pour  
  choisir                                     
                                            
  ### Les 6 variants — TOUT en SVG + CSS      
  animations, zero dépendance               
                                              
  #### confetti                               
  24 <rect> avec x aléatoire, animation
  confettiFall + confettiSpin                 
  Colors: ['#FFB800','#2bff9a','#FF4455','#A85
  5F7','#3B82F6','#FF6B35']                 
  Durées: 0.8s-1.4s, delays: 0-0.6s           
  @keyframes confettiFall { from            
  {transform:translateY(-20px)} to            
  {transform:translateY(220px)} }           
  @keyframes confettiSpin { to                
  {transform:rotate(360deg)} }                
                                              
  #### explosion                              
  3 rings concentriques + 8 rayons depuis   
  centre
  Rings: stroke="#FFB800", r anime de 0 à   
  80/60/40, opacity 1→0                     
  Rayons: lignes qui s'étendent depuis        
  cx=100,cy=100 vers extérieur              
                                              
  #### stars                                
  5 étoiles <polygon points="..."> qui        
  orbitent                                  
  Utiliser transform rotate sur un groupe +   
  scale pulse                               
                                              
  #### lightning                            
  2 <path> zigzag depuis gauche et droite vers
   centre                                   
  stroke="#FFB800" stroke-dashoffset animé    
  (draw effect)                             
  + flash blanc sur tout le SVG (rect opacity 
  0.8→0)                                    
                                              
  #### crown                                
  <path d="M30,80 L20,30 L45,55 L65,15 L85,55 
  L110,30 L100,80 Z">                       
  fill="#FFB800" + translateY de -100% à 0 en 
  cubic-bezier ressort                      
                                              
  #### shockwave                            
  Cercle qui s'élargit (r: 10 → 90) avec      
  stroke opacity 1→0                        
  Répété 2x avec delay, + inner fill flash    
                                            
  ### useEffect pour appeler onComplete après 
  1200ms                                    
                                              
  ---                                         
                                              
  ## P6 — COMMENTAIRES + NOMS JOUEURS         
  (src/lib/commentary.ts)                   
                                            
  ### Pool de templates                       
  Export COMMENTARY_TEMPLATES:    
  Record<CommentaryPhase,                     
  CommentaryTemplate[]>                     
                                            
  Type CommentaryPhase = 'pre_attack' |       
  'attack_success' | 'attack_fail' |        
  'pre_defense' | 'defense_success' |         
  'defense_fail'                              
                                  
  ### Templates (minimum 6 par phase)         
  Utiliser {attacker}, {defender}, {team},  
  {opponent} comme tokens                   
  Remplacer par vrais noms si team.players    
  disponible, sinon fallback générique      
                                              
  Exemples obligatoires à inclure :         
  pre_attack:                                 
  - "{attacker} déborde côté droit, entre dans
   la surface... IL ARME !"                   
  - "Une-deux parfait, {attacker} se retrouve
  seul face au gardien..."                    
  - "Coup franc à 20m, {attacker} prend son   
  élan, le mur saute..."                      
  - "{attacker} feinte, élimine son adversaire
   d'un crochet, il vise..."                
  - "Le {team} presse haut, {attacker}        
  récupère le ballon et fonce !"            
  - "Passe en profondeur lumineuse, {attacker}
   surgit dans le dos de la défense..."     
  [funny] "{attacker} regarde le gardien dans 
  les yeux. Le gardien transpire."          
                                              
  pre_defense:                              
  - "{attacker} de {opponent} surgit de nulle 
  part, frappe croisée !"                   
  - "Corner pour {opponent}, {attacker} monte,
   attention au duel aérien !"              
  - "Contre-éclair de {opponent}, {attacker}  
  fonce seul vers le but..."                
  [funny] "{attacker} a mangé des épinards ce 
  matin. Ça se voit."                       
                                              
  ### Composant Commentary.tsx              
  - Affiche le texte avec typewriter effect   
  (un caractère toutes les 25ms)            
  - Les {tokens} remplacés apparaissent en    
  gras et couleur --neon                    
  - Slide-in depuis la gauche en 300ms        
  - Disparaît après displayDuration (défaut 
  2000ms) avec fade-out                       
                                            
  ---                                         
                                              
  ## P7 — INTERFACES (ScorePanel +
  MobileBracketFlow)                          
                                            
  ### ScorePanel.tsx                          
  - Affiché sur desktop (>= 1024px) en sidebar
   droite du bracket                          
  - Props: brackets: ChallengeEntry[],      
  activeBracketId, onSelect, realResults    
  - Affiche: score total, rang, breakdown par 
  stage avec progress bars SVG              
  - Barre de progression SVG: <rect> animé en 
  width%                                    
  - Max 3 brackets affichés avec onglets      
                                            
  ### MobileBracketFlow.tsx                   
  - Affiché sur mobile (<= 680px) à la place
  du bracket visuel                           
  - Un match à la fois, navigation swipe    
  gauche/droite                               
  - Barre de progression en haut : matchs     
  joués / total                             
  - Pour chaque match : nom des équipes +     
  drapeaux + [Jouer] + [→ Choisir]          
  - Pas de librairie de swipe — utiliser      
  onTouchStart/onTouchEnd natif             
  - Seuil swipe : deltaX > 50px → navigate    
                                            
  ---                                         
                                            
  ## P8 — MOMENTUM + BATTLE ENGINE            
  (src/lib/battleEngine.ts)                 
                                              
  ### Génération de rounds                    
  export function generateBattleRounds(params:
   {                                          
    homeTeam: Team                            
    awayTeam: Team                
    playerSide: 'home' | 'away'               
  }): BattleRound[]                         
                                            
  Nombre de rounds : 6 à 8 (aléatoire)      
  Alternance : commence par attaque,          
  alternance régulière                      
  Quelques doubles attaque ou double défense  
  pour surprendre                           
  Difficultés : easy(30%), medium(50%),       
  hard(20%) — ajustées par momentum         
                                              
  ### Système momentum                      
  State: number entre -3 et +3                
  +1 après réussite joueur                  
  -1 après échec joueur                       
  Momentum > 1 → difficulty des prochains   
  rounds baisse                               
  Momentum < -1 → difficulty augmente         
  Momentum >= 3 → "PRESSION" mode (anneau +15%
   plus large, ballons -20% plus lents)       
                                            
  ### Export                                  
  export type BattleRound = {                 
    type: 'attack' | 'defense'    
    commentaryPhase: CommentaryPhase          
    balloonCount?: number    // pour defense
    hasSonic?: boolean       // pour defense
    difficulty: 'easy' | 'medium' | 'hard'  
  }                                           
                                            
  export type BattleResult = {                
    homeScore: number                         
    awayScore: number             
    winnerId: string                          
    playerScore: number     // score de jeu 
  (0-100) pour battleBonus                    
    rounds: Array<{ type: string; success:  
  boolean; isGoal: boolean }>                 
  }                                           
                                            
  ---                                         
                                            
  ## INTÉGRATION DANS App.tsx                 
                                            
  En haut de App.tsx, ajouter :
  const params = new                        
  URLSearchParams(window.location.search)   
  const challengeMode =                       
  params.has('challenge')         
                                              
  Dans le return final, AVANT le return     
  existant :                                  
  if (challengeMode) {            
    return <BrakupHub ... />                  
  }                                         
                                            
  Passer les props nécessaires : seed,        
  liveSource, standings, teamsById          
                                              
  ---                                         
                                  
  ## FICHIER challenge.css                    
                                            
  Créer src/challenge/challenge.css importé 
  dans BrakupHub.tsx.                         
  Contient tous les styles Brakup, n'importe
  PAS dans App.css existant.                  
  Variables CSS à utiliser depuis :root     
  existant (--neon, --text, etc.)           
  Ajouter dans ce fichier :                   
  - .brakup-* préfixes pour tous les        
  composants challenge                        
  - Animations : confettiFall, confettiSpin,
  expandBlast, rayShoot, crownDrop, ringPulse,
   shockwaveRing, fruitAppear, fruitExplode,  
  balloonFloat, typewriter                  
  - Media queries : mobile-first, breakpoint  
  680px                                     
                                              
  ---                                       
                                              
  ## VARIABLES D'ENVIRONNEMENT NÉCESSAIRES
  RESEND_API_KEY=re_xxx     (email envoi)     
  JWT_SECRET=xxx            (32 chars random)
  Ces variables doivent être documentées dans
  .env.example (créer ce fichier)           
  Si absentes → mode dégradé sans email, JWT  
  statique pour dev                           
                                              
  ---                                         
                                              
  ## CONTRAINTES TECHNIQUES                 
  - Zero nouvelle dépendance npm (pas         
  framer-motion, gsap, etc.)                
  - Toutes les animations : CSS @keyframes +
  SVG <animate>                             
  - Pas de useLayoutEffect (SSR safe)         
  - Tous les composants : functional        
  components avec hooks                       
  - TypeScript strict — pas de 'any' sauf si
  inévitable avec les API Vercel              
  - touch-action: none sur les zones de jeu 
  pour éviter le scroll mobile                
  - pointer-events correctement gérés pour le 
  multi-touch                               
                                              
  ---                                       
                                              
  ## ORDRE D'IMPLÉMENTATION OBLIGATOIRE     
  1. src/types.ts — ajouter ChallengeEntry,   
  BattleRound, BattleResult                 
  2. src/lib/battleEngine.ts                
  3. src/lib/commentary.ts                  
  4. src/lib/scoring.ts                       
  5. src/lib/challengeData.ts     
  6. api/challenge.ts                         
  7. src/challenge/challenge.css            
  8. src/challenge/WinAnimation.tsx         
  9. src/challenge/BalloonShot.tsx            
  10. src/challenge/FruitNinjaDefense.tsx   
  11. src/challenge/Commentary.tsx            
  12. src/challenge/MatchBattle.tsx           
  13. src/challenge/BracketChallenge.tsx
  14. src/challenge/ScorePanel.tsx            
  15. src/challenge/MobileBracketFlow.tsx   
  16. src/challenge/EmailEntry.tsx            
  17. src/challenge/MyBrackets.tsx          
  18. src/challenge/Leaderboard.tsx           
  19. src/challenge/BrakupHub.tsx             
  20. Modifier src/App.tsx — ajouter
  challengeMode check                         
  21. .env.example                          
                                              
  Après chaque fichier créé : npx tsc --noEmit
   pour valider les types.                    
  Corriger immédiatement toute erreur         
  TypeScript avant de passer au suivant.      
  À la fin de tout : npm run build pour     
  valider le bundle complet.  