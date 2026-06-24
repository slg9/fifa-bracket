You have been given a ZIP file named "Brakup
   World Cup Bracket-handoff.zip" from Claude 
  Design                                      
  containing visual mockups for the Brakup    
  battle mini-game.                           
                                              
  Start by unzipping it:                      
    unzip "Brakup World Cup                   
  Bracket-handoff.zip" -d brakup-design       
                                              
  Then list all files inside to understand the
   structure before doing anything else.      
                                              
  The ZIP contains design screens for:        
  - Attack phase (defenders walking down)   
  - Pass moment (player swap)                 
  - Shooting window (emergency)               
  - Defense phase (attackers walking down)    
  - Zone de tir envahie + bouton DÉFENDRE     
  - Fruit Ninja phase                         
  - Défense parfaite result                   
  - GoalView normal state (large goal +       
  goalkeeper glove)                           
  - GoalView slow-motion + golden ring      
  - GoalView save state                       
                                              
  Your job is to implement these designs      
  pixel-faithfully into the existing          
  React/TypeScript components. The game logic 
  (P9–P18) is already implemented.            
  You are only improving visual fidelity — no 
  logic changes.                              
                                              
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
  STEP 1 — AUDIT THE DESIGN FILES             
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 
                                              
  After unzipping, for each file found:       
    - Open and analyze every screen mockup    
    - Extract exact color hex values (use an  
  image color picker if needed)               
    - Note all font sizes, weights,           
  letter-spacing, border-radius values        
    - Note all SVG shapes, their dimensions,  
  opacities, and effects                      
    - Note all spacing between elements       
  (padding, margin, gap)                      
    - Note all animation hints (trails, glows,
   overlays described in the design)          
    - If a CSS/style spec file exists, read it
   fully before writing any code              
                                              
  Do not write any code until you have fully  
  audited all design files.                   
                                            
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
  STEP 2 — EXTRACT DESIGN TOKENS            
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
                                              
  Create                                  
  src/components/battle/battle.tokens.ts with 
  all values                                  
  extracted from the design files:
                                              
    export const BATTLE_TOKENS = {          
      colors: {
        pitch: '',                            
        pitchLines: '',
        gold: '',                             
        danger: '',                         
        slowMoOverlay: '',
        goalPost: '',                         
        goalNet: '',
        swipeTrail: '',                       
        defenderNormal: '',                 
        defenderCostaud: '',
        defenderAgile: '',                    
        glowSave: '',                         
      },                                      
      sizes: {                              
        goalWidthPercent: 0,                  
        goalHeightPx: 0,                      
        gloveWidthPx: 0,                      
        gloveHeightPx: 0,                   
        goldenRingDiameter: 0,                
        ballInitialSize: 0,                   
        ballTargetSize: 0,                    
        defenderNormalSize: 0,              
        defenderCostaudSize: 0,               
        defenderAgileSize: 0,             
        touchTargetMin: 48,                   
      },                                      
      animation: {                        
        slowMoSpeedMultiplier: 0.25,          
        gloveTrailCount: 3,                   
        ringPulseDurationMs: 0,               
        saveFlashDurationMs: 0,               
        defenderNeutralizeDurationMs: 300,  
      },                                      
      typography: {                           
        slowMoLabelSize: '',                  
        dangerLabelSize: '',                  
        scoreSize: '',                      
        countdownSize: '',                    
      }                                       
    } as const                                
                                              
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
  STEP 3 — IMPLEMENT PER COMPONENT            
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                              
  For each component, update ONLY the visual  
  layer to match the design.                  
  Do not change props, state, or game logic.  
                                              
  ────────────────────────────────            
  src/components/battle/GoalView.tsx          
  ────────────────────────────────          
    - Goal SVG: match exact dimensions,       
  perspective trapezoid shape,                
      post thickness, net grid density from   
  the design                                  
    - Goalkeeper glove: SVG primitives only   
        · Cuff: rounded rect, team color      
        · Palm: wider rect above cuff         
        · 4 fingers: individual rects, slight
  fan spread                                  
        · Thumb: rotated rect on left side    
        · Grip lines: 3 horizontal lines at   
  30% white opacity                           
    - Golden ring: exact stroke width, gold 
  glow filter, pulse timing                   
    - Slow-mo overlay: exact                  
  saturate/brightness filter values + vignette
    - Save state: glove rotation angle, flash 
  intensity, burst particles                  
                                              
  ────────────────────────────────
  src/components/battle/AttackPhase.tsx       
  ────────────────────────────────          
    - Pitch background: exact color + texture 
  line treatment                              
    - Defender circles: exact sizes per type
  (normal/costaud/agile),
      border treatment, jersey number         
  typography                                  
    - Costaud damage state: crack/mark visual 
    - Motion trails: ghost count, opacity   
  steps, spacing                              
    - Swipe trail: color, width, fade duration
    - PASSE button: size, icon, glow,         
  disabled/active states                      
    - Player badge: size, color, label    
    - Score pill + round dots: exact shape and
   typography                                 
    - Countdown bar: height, gradient,    
  position                                    
                                              
  ────────────────────────────────
  src/components/battle/DefensePhase.tsx      
  ────────────────────────────────          
    - Same pitch as attack but red tint
  palette                                     
    - Shooting zone: red overlay opacity, 
  dashed border,
      "ZONE DE TIR" label treatment           
    - DÉFENDRE button: red glow, shield icon, 
  disabled vs active states                   
    - Attacker in zone: crouched SVG pose,  
  pulsation                                   
    - DANGER text: position, size, blink  
  treatment                                   
                                              
  ────────────────────────────────
  src/components/battle/FruitNinjaPhase.tsx   
  ────────────────────────────────            
    - Background: darkness level, pitch   
  texture at correct opacity
    - Ball SVG: pentagon pattern, motion trail
    - Decoys: carton rouge (rectangle SVG) +
  cône orange (triangle SVG)                  
      exact shapes and sizes from design    
    - Swipe slash: white trail, width, fade   
  timing                                      
    - Intercept burst: particle count, spread
  radius, color                               
    - Counter: typography, position, progress
  bar                                         
                                            
  ────────────────────────────────
  src/components/battle/RoundResult.tsx       
  ────────────────────────────────
    - "Défense parfaite" screen: gold shield  
  SVG, confetti                               
    - All result texts: exact size, weight,
  color per outcome
    - Screen flash: exact color per outcome   
  (gold/red/white)
                                              
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
  STEP 4 — CSS                            
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                              
  Create src/components/battle/battle.css if
  it doesn't exist.                           
  Move all battle-specific CSS here. Import   
  once in BattleEngine.tsx.                   
                                              
  Define all keyframe animations:           
    @keyframes defender-neutralize { }        
    @keyframes ring-appear { }                
    @keyframes ring-pulse { }                 
    @keyframes glove-save { }               
    @keyframes slash-fade { }                 
    @keyframes ball-charge { }
    @keyframes danger-pulse { }               
    @keyframes confetti-fall { }              
    @keyframes slow-mo-in { }             
    @keyframes burst-particles { }
                                              
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   
  CONSTRAINTS                                 
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 
  - Design file is the source of truth — if it
   differs from previous prompts,         
    follow the design file                    
  - All SVG built with primitives only (rect, 
  circle, path, line, filter)                 
  - No new npm dependencies                   
  - No new image or font files              
  - Do not change any game logic, props,      
  state, or event handlers                
  - Run `npx tsc --noEmit` → zero errors      
  required   