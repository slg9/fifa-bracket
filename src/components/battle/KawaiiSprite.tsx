export type KawaiiRole = 'player' | 'enemy' | 'defender' | 'keeper' | 'kicker'
export type KawaiiMotion = 'run' | 'idle' | 'ready'

type KawaiiSpriteProps = {
  label?: string
  playerName?: string
  teamId?: string
  jerseyColor: string
  accentColor?: string
  shortsColor?: string
  textColor?: string
  role?: KawaiiRole
  motion?: KawaiiMotion
  withBall?: boolean
  seed?: string | number
  width?: number
  height?: number
  className?: string
  gloveColor?: string
}

type SkinTone = 'fair' | 'light' | 'tan' | 'brown' | 'deep'
type HairStyle = 'crop' | 'fade' | 'curls' | 'parted' | 'sweep' | 'buzz' | 'shaved'
type FaceShape = 'round' | 'oval' | 'long' | 'square'
type FacialHair = 'none' | 'stubble' | 'beard' | 'goatee' | 'moustache'

type PlayerAppearance = {
  skin: string
  hair: string
  hairStyle: HairStyle
  faceShape: FaceShape
  eye: 'round' | 'narrow' | 'sharp'
  eyeColor: string
  facialHair: FacialHair
  brow: boolean
}

const SKIN_TONES: Record<SkinTone, string> = {
  fair: '#f4d1b3',
  light: '#e7b98f',
  tan: '#c88b5d',
  brown: '#9b6040',
  deep: '#5f3528',
}

const TEAM_SKIN_POOLS: Record<string, SkinTone[]> = {
  ALG: ['tan', 'brown', 'light', 'tan', 'brown'],
  ARG: ['light', 'tan', 'light', 'fair', 'brown'],
  AUS: ['fair', 'light', 'tan', 'light', 'brown'],
  AUT: ['fair', 'light', 'fair', 'light', 'tan'],
  BEL: ['fair', 'light', 'tan', 'deep', 'brown'],
  BIH: ['fair', 'light', 'tan', 'fair', 'light'],
  BRA: ['tan', 'brown', 'deep', 'light', 'brown'],
  CAN: ['light', 'tan', 'brown', 'deep', 'fair'],
  CIV: ['deep', 'brown', 'deep', 'brown', 'tan'],
  COD: ['deep', 'brown', 'deep', 'brown', 'deep'],
  COL: ['tan', 'brown', 'light', 'tan', 'brown'],
  CPV: ['brown', 'deep', 'tan', 'brown', 'deep'],
  CRO: ['fair', 'light', 'tan', 'fair', 'light'],
  CUW: ['brown', 'deep', 'tan', 'brown', 'light'],
  CZE: ['fair', 'light', 'fair', 'tan', 'light'],
  ECU: ['tan', 'brown', 'tan', 'light', 'deep'],
  EGY: ['tan', 'brown', 'light', 'tan', 'brown'],
  ENG: ['fair', 'light', 'brown', 'deep', 'tan'],
  ESP: ['light', 'tan', 'fair', 'tan', 'brown'],
  FRA: ['light', 'tan', 'brown', 'deep', 'fair'],
  GER: ['fair', 'light', 'tan', 'fair', 'brown'],
  GHA: ['deep', 'brown', 'deep', 'brown', 'tan'],
  HAI: ['deep', 'brown', 'deep', 'brown', 'tan'],
  IRN: ['light', 'tan', 'brown', 'light', 'tan'],
  IRQ: ['tan', 'brown', 'light', 'tan', 'brown'],
  JOR: ['tan', 'brown', 'light', 'tan', 'brown'],
  JPN: ['fair', 'light', 'fair', 'light', 'tan'],
  KOR: ['fair', 'light', 'fair', 'light', 'tan'],
  KSA: ['tan', 'brown', 'light', 'tan', 'brown'],
  MAR: ['tan', 'brown', 'light', 'tan', 'brown'],
  MEX: ['tan', 'brown', 'light', 'tan', 'brown'],
  NED: ['fair', 'light', 'tan', 'brown', 'fair'],
  NOR: ['fair', 'light', 'fair', 'light', 'tan'],
  NZL: ['fair', 'light', 'tan', 'brown', 'deep'],
  PAN: ['tan', 'brown', 'deep', 'tan', 'light'],
  PAR: ['tan', 'light', 'brown', 'tan', 'fair'],
  POR: ['light', 'tan', 'brown', 'fair', 'tan'],
  QAT: ['tan', 'brown', 'light', 'tan', 'brown'],
  RSA: ['deep', 'brown', 'tan', 'light', 'fair'],
  SCO: ['fair', 'light', 'fair', 'tan', 'light'],
  SEN: ['deep', 'brown', 'deep', 'brown', 'tan'],
  SUI: ['fair', 'light', 'tan', 'brown', 'fair'],
  SWE: ['fair', 'light', 'fair', 'light', 'tan'],
  TUN: ['tan', 'brown', 'light', 'tan', 'brown'],
  TUR: ['light', 'tan', 'brown', 'light', 'tan'],
  URU: ['light', 'tan', 'fair', 'brown', 'light'],
  USA: ['light', 'tan', 'brown', 'deep', 'fair'],
  UZB: ['light', 'tan', 'fair', 'brown', 'light'],
}

const TEAM_HAIR_POOLS: Record<string, string[]> = {
  ENG: ['#6b4326', '#171717', '#b98644', '#4b2e1d'],
  FRA: ['#171717', '#2c1b12', '#4b2e1d', '#b98644'],
  GER: ['#b98644', '#6b4326', '#4b2e1d', '#171717'],
  NED: ['#d8b45d', '#b98644', '#4b2e1d', '#171717'],
  SWE: ['#d8b45d', '#b98644', '#6b4326', '#171717'],
  NOR: ['#d8b45d', '#b98644', '#6b4326', '#171717'],
  JPN: ['#151515', '#171717', '#21140d', '#2c1b12'],
  KOR: ['#151515', '#171717', '#21140d', '#2c1b12'],
  EGY: ['#151515', '#21140d', '#2c1b12', '#171717'],
  MAR: ['#151515', '#21140d', '#2c1b12', '#171717'],
  TUN: ['#151515', '#21140d', '#2c1b12', '#171717'],
  SEN: ['#111', '#151515', '#21140d', '#2c1b12'],
  GHA: ['#111', '#151515', '#21140d', '#2c1b12'],
  CIV: ['#111', '#151515', '#21140d', '#2c1b12'],
  BRA: ['#151515', '#21140d', '#2c1b12', '#4b2e1d'],
  ARG: ['#2c1b12', '#4b2e1d', '#6b4326', '#171717'],
  URU: ['#2c1b12', '#4b2e1d', '#6b4326', '#171717'],
  MEX: ['#151515', '#21140d', '#2c1b12', '#4b2e1d'],
  USA: ['#171717', '#2c1b12', '#6b4326', '#b98644'],
  CAN: ['#171717', '#2c1b12', '#6b4326', '#b98644'],
}

const KNOWN_PLAYER_APPEARANCES: Record<string, Partial<PlayerAppearance> & { skinTone?: SkinTone }> = {
  kylianmbappe: { skinTone: 'deep', hair: '#171717', hairStyle: 'crop', faceShape: 'oval', eye: 'sharp', facialHair: 'stubble', brow: true },
  ousmanedembele: { skinTone: 'deep', hair: '#161616', hairStyle: 'crop', faceShape: 'long', eye: 'narrow', facialHair: 'goatee', brow: true },
  viniciusjr: { skinTone: 'deep', hair: '#151515', hairStyle: 'fade', faceShape: 'oval', eye: 'sharp', facialHair: 'stubble', brow: true },
  endrick: { skinTone: 'brown', hair: '#151515', hairStyle: 'crop', faceShape: 'round', eye: 'round', facialHair: 'none', brow: true },
  rodrygo: { skinTone: 'brown', hair: '#171717', hairStyle: 'fade', faceShape: 'oval', eye: 'sharp', facialHair: 'stubble', brow: true },
  neymar: { skinTone: 'tan', hair: '#2c1b12', hairStyle: 'fade', faceShape: 'oval', eye: 'sharp', facialHair: 'stubble', brow: true },
  lionelmessi: { skinTone: 'light', hair: '#5a3721', hairStyle: 'parted', faceShape: 'round', eye: 'round', facialHair: 'beard', brow: false },
  cristianoronaldo: { skinTone: 'tan', hair: '#1e1713', hairStyle: 'sweep', faceShape: 'long', eye: 'sharp', facialHair: 'stubble', brow: true },
  erlinghaaland: { skinTone: 'fair', hair: '#d8b45d', hairStyle: 'sweep', faceShape: 'long', eye: 'narrow', facialHair: 'none', brow: false },
  mohamedsalah: { skinTone: 'brown', hair: '#21140d', hairStyle: 'curls', faceShape: 'oval', eye: 'round', facialHair: 'beard', brow: true },
  omarmarmoush: { skinTone: 'brown', hair: '#18120f', hairStyle: 'crop', faceShape: 'oval', eye: 'sharp', facialHair: 'stubble', brow: true },
  harrykane: { skinTone: 'light', hair: '#7a5430', hairStyle: 'parted', faceShape: 'long', eye: 'round', facialHair: 'stubble', brow: false },
  bukayosaka: { skinTone: 'deep', hair: '#151515', hairStyle: 'crop', faceShape: 'round', eye: 'round', facialHair: 'none', brow: true },
  judebellingham: { skinTone: 'brown', hair: '#171717', hairStyle: 'crop', faceShape: 'oval', eye: 'sharp', facialHair: 'none', brow: true },
  lamineyamal: { skinTone: 'brown', hair: '#16110d', hairStyle: 'curls', faceShape: 'round', eye: 'round', facialHair: 'none', brow: true },
  pedri: { skinTone: 'light', hair: '#2d2118', hairStyle: 'parted', faceShape: 'oval', eye: 'round', facialHair: 'none', brow: false },
  nicowilliams: { skinTone: 'deep', hair: '#171717', hairStyle: 'crop', faceShape: 'oval', eye: 'sharp', facialHair: 'none', brow: true },
  sonheungmin: { skinTone: 'fair', hair: '#181818', hairStyle: 'parted', faceShape: 'round', eye: 'narrow', facialHair: 'none', brow: false },
  kevinbruyne: { skinTone: 'fair', hair: '#c9833f', hairStyle: 'sweep', faceShape: 'long', eye: 'round', facialHair: 'stubble', brow: false },
  romelulukaku: { skinTone: 'deep', hair: '#111', hairStyle: 'shaved', faceShape: 'square', eye: 'sharp', facialHair: 'beard', brow: true },
  sadiomane: { skinTone: 'deep', hair: '#111', hairStyle: 'crop', faceShape: 'oval', eye: 'sharp', facialHair: 'stubble', brow: true },
  achrafhakimi: { skinTone: 'tan', hair: '#151515', hairStyle: 'crop', faceShape: 'long', eye: 'sharp', facialHair: 'stubble', brow: true },
  alphonsondavies: { skinTone: 'deep', hair: '#151515', hairStyle: 'fade', faceShape: 'round', eye: 'round', facialHair: 'none', brow: true },
  pulisic: { skinTone: 'light', hair: '#6b4326', hairStyle: 'parted', faceShape: 'oval', eye: 'round', facialHair: 'stubble', brow: false },
  christianpulisic: { skinTone: 'light', hair: '#6b4326', hairStyle: 'parted', faceShape: 'oval', eye: 'round', facialHair: 'stubble', brow: false },
  lukamodric: { skinTone: 'fair', hair: '#b98644', hairStyle: 'sweep', faceShape: 'long', eye: 'round', facialHair: 'none', brow: false },
  federicovalverde: { skinTone: 'light', hair: '#4b2e1d', hairStyle: 'parted', faceShape: 'long', eye: 'sharp', facialHair: 'stubble', brow: true },
  darwinnunez: { skinTone: 'light', hair: '#3b2518', hairStyle: 'sweep', faceShape: 'long', eye: 'sharp', facialHair: 'goatee', brow: true },
  robertlewandowski: { skinTone: 'light', hair: '#4a3324', hairStyle: 'parted', faceShape: 'long', eye: 'sharp', facialHair: 'stubble', brow: true },
  maghnesakliouche: { skinTone: 'light', hair: '#19120f', hairStyle: 'curls', faceShape: 'long', eye: 'round', eyeColor: '#7ea5c8', facialHair: 'goatee', brow: true },
  jeanphilippemateta: { skinTone: 'deep', hair: '#111', hairStyle: 'shaved', faceShape: 'round', eye: 'round', facialHair: 'none', brow: false },
  bradleybarcola: { skinTone: 'deep', hair: '#111', hairStyle: 'crop', faceShape: 'long', eye: 'round', facialHair: 'none', brow: true },
  desiredoue: { skinTone: 'brown', hair: '#151515', hairStyle: 'crop', faceShape: 'round', eye: 'round', facialHair: 'none', brow: true },
}

function normalizeAppearanceName(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function appearanceHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function resolvePlayerAppearance(seedValue: string | number | undefined, playerName?: string, teamId?: string): PlayerAppearance {
  const source = String(playerName || seedValue || '')
  const normalized = normalizeAppearanceName(source)
  const known = KNOWN_PLAYER_APPEARANCES[normalized]
  const teamKey = teamId?.toUpperCase()
  const hash = appearanceHash(`${teamKey ?? 'TEAM'}:${normalized || 'player'}`)
  const fallbackSkins: SkinTone[] = TEAM_SKIN_POOLS[teamKey ?? ''] ?? ['light', 'tan', 'brown', 'fair', 'deep']
  const fallbackHair = ['#171717', '#2c1b12', '#4b2e1d', '#6b4326', '#b98644']
  const teamHair = TEAM_HAIR_POOLS[teamKey ?? ''] ?? fallbackHair
  const fallbackStyles: HairStyle[] = ['crop', 'fade', 'parted', 'curls', 'sweep', 'buzz']
  const fallbackFaces: FaceShape[] = ['oval', 'round', 'long', 'square']
  const fallbackFacialHair: FacialHair[] = ['none', 'stubble', 'none', 'goatee', 'beard', 'none']
  const skinTone = known?.skinTone ?? fallbackSkins[hash % fallbackSkins.length]

  return {
    skin: known?.skin ?? SKIN_TONES[skinTone],
    hair: known?.hair ?? teamHair[(hash >>> 3) % teamHair.length],
    hairStyle: known?.hairStyle ?? fallbackStyles[(hash >>> 6) % fallbackStyles.length],
    faceShape: known?.faceShape ?? fallbackFaces[(hash >>> 9) % fallbackFaces.length],
    eye: known?.eye ?? (((hash >>> 12) % 3 === 0) ? 'narrow' : ((hash >>> 12) % 3 === 1) ? 'sharp' : 'round'),
    eyeColor: known?.eyeColor ?? '#111',
    facialHair: known?.facialHair ?? fallbackFacialHair[(hash >>> 15) % fallbackFacialHair.length],
    brow: known?.brow ?? ((hash >>> 18) % 2 === 0),
  }
}

function faceShapeProps(shape: FaceShape) {
  if (shape === 'long') return { rx: 16.4, ry: 19.4 }
  if (shape === 'square') return { rx: 18.2, ry: 17.4 }
  if (shape === 'round') return { rx: 18.6, ry: 17.6 }
  return { rx: 17.2, ry: 18.6 }
}

function HairShape({ appearance }: { appearance: PlayerAppearance }) {
  const fill = appearance.hair
  if (appearance.hairStyle === 'shaved') {
    return null
  }
  if (appearance.hairStyle === 'buzz') {
    return <path d="M22 15 C24 3 33 -1 40 -1 C47 -1 56 3 58 15 C52 12 46 10.5 40 10.5 C34 10.5 28 12 22 15 Z" fill={fill} opacity=".84" />
  }
  return (
    <path d="M21 17 C23 2 32 -2 40 -2 C48 -2 57 2 59 17 C53 14 46 12 40 12 C34 12 27 14 21 17 Z" fill={fill} />
  )
}

function FaceDetails({ appearance, determined }: { appearance: PlayerAppearance; determined: boolean }) {
  const eyeRx = appearance.eye === 'narrow' ? 3.5 : 3.2
  const eyeRy = appearance.eye === 'narrow' ? 2.1 : appearance.eye === 'sharp' ? 3.2 : 4
  const brow = determined || appearance.brow
  const beardFill = appearance.hair

  return (
    <>
      {brow ? (
        <g stroke="#111" strokeWidth="1.5" strokeLinecap="round">
          <path d="M29 17 L36 19" />
          <path d="M51 17 L44 19" />
        </g>
      ) : null}
      <ellipse cx="33" cy="21" rx={eyeRx} ry={eyeRy} fill={appearance.eyeColor} stroke="#111" strokeWidth=".55" />
      <ellipse cx="47" cy="21" rx={eyeRx} ry={eyeRy} fill={appearance.eyeColor} stroke="#111" strokeWidth=".55" />
      <circle cx="34.2" cy="19.6" r="1.15" fill="#fff" />
      <circle cx="48.2" cy="19.6" r="1.15" fill="#fff" />
      <circle cx="28" cy="26" r="2.8" fill="#ff8a8a" opacity=".32" />
      <circle cx="52" cy="26" r="2.8" fill="#ff8a8a" opacity=".32" />
      {appearance.facialHair === 'beard' ? <path d="M29 27 Q40 38 51 27 Q48 36 40 38 Q32 36 29 27 Z" fill={beardFill} opacity=".75" /> : null}
      {appearance.facialHair === 'goatee' ? <path d="M36 31 Q40 35 44 31 Q42 38 40 38 Q38 38 36 31 Z" fill={beardFill} opacity=".78" /> : null}
      {appearance.facialHair === 'stubble' ? <path d="M31 29 Q40 35 49 29" stroke={beardFill} strokeWidth="3.2" opacity=".35" fill="none" strokeLinecap="round" /> : null}
      {appearance.facialHair === 'moustache' ? <path d="M34 27 Q40 25 46 27" stroke={beardFill} strokeWidth="2.2" fill="none" strokeLinecap="round" /> : null}
      <path d="M35 28 Q40 31.5 45 28" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  )
}

function CrowdSprite({
  label,
  appearance,
  jerseyColor,
  accentColor,
  shortsColor,
  textColor,
  withBall,
  width,
  height,
  className,
}: Required<Pick<KawaiiSpriteProps, 'jerseyColor' | 'accentColor' | 'shortsColor' | 'textColor' | 'width' | 'height' | 'className'>> & Pick<KawaiiSpriteProps, 'label' | 'withBall'> & { appearance: PlayerAppearance }) {
  const face = faceShapeProps(appearance.faceShape)
  return (
    <svg viewBox="0 0 80 98" width={width} height={height} className={`kw-sprite kw-sprite--crowd ${className}`.trim()} aria-hidden="true">
      <ellipse cx="40" cy="91" rx="20" ry="5" fill="rgba(0,0,0,.26)" />
      {withBall ? <circle cx="58" cy="82" r="8" fill="#f7f9fc" stroke="#101827" strokeWidth="2" /> : null}
      <rect className="kw-leg kw-leg--l" x="28" y="58" width="8" height="22" rx="4" fill={shortsColor} />
      <rect className="kw-leg kw-leg--r" x="44" y="58" width="8" height="22" rx="4" fill={shortsColor} />
      <path d="M17 33 Q40 25 63 33 L58 61 Q40 66 22 61 Z" fill={jerseyColor} stroke="rgba(255,255,255,.42)" strokeWidth="1" />
      <path d="M31 31 V59 M49 31 V59" stroke={accentColor} strokeWidth="2.4" opacity=".45" />
      <ellipse cx="40" cy="20" rx={face.rx * .92} ry={face.ry * .92} fill={appearance.skin} />
      <HairShape appearance={appearance} />
      <FaceDetails appearance={appearance} determined={false} />
      {label ? <text x="40" y="49" fontFamily="Barlow Condensed" fontWeight="900" fontSize={label.length > 6 ? 7 : 9} fill={textColor} textAnchor="middle">{label}</text> : null}
    </svg>
  )
}

function HeroSprite({
  label,
  jerseyColor,
  accentColor,
  shortsColor,
  textColor,
  role,
  motion,
  withBall,
  width,
  height,
  className,
  gloveColor,
  appearance,
}: Omit<KawaiiSpriteProps, 'seed' | 'playerName' | 'teamId'> & { label: string; accentColor: string; shortsColor: string; textColor: string; role: KawaiiRole; withBall: boolean; width: number; height: number; className: string; gloveColor: string; appearance: PlayerAppearance }) {
  const resolvedMotion: KawaiiMotion = motion ?? (role === 'keeper' || role === 'defender' ? 'ready' : 'run')
  const armsUp = role === 'keeper' || role === 'defender'
  const determined = role === 'keeper' || role === 'kicker'
  const face = faceShapeProps(appearance.faceShape)

  return (
    <svg viewBox="0 0 80 98" width={width} height={height} className={`kw-sprite kw-sprite--hero kw-motion-${resolvedMotion} kw-role-${role} ${className}`.trim()} aria-hidden="true">
      <ellipse className="kw-shadow" cx="40" cy="91" rx="24" ry="6" fill="rgba(0,0,0,.3)" />

      {withBall ? (
        <g className="kw-ball" transform="translate(57 82)">
          <ellipse cx="0" cy="8" rx="9" ry="2.5" fill="rgba(0,0,0,.24)" />
          <circle r="9.5" fill="#f7f9fc" stroke="#101827" strokeWidth="2" />
          <path d="M0 -6.5 L5.6 -2.4 L3.6 4.4 H-3.6 L-5.6 -2.4 Z" fill="#101827" opacity=".86" />
          <path d="M0 -9 V-6.5 M5.6 -2.4 L8.6 -4 M3.6 4.4 L5.8 7.8 M-3.6 4.4 L-5.8 7.8 M-5.6 -2.4 L-8.6 -4" stroke="#101827" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      ) : null}

      <g className="kw-leg kw-leg--l" style={{ transformOrigin: '32px 60px' }}>
        <rect x="27" y="57" width="9" height="24" rx="4.5" fill={shortsColor} />
        <ellipse cx="31" cy="82" rx="8" ry="5" fill="#121826" />
        <ellipse cx="30" cy="80.5" rx="3" ry="1.2" fill="rgba(255,255,255,.2)" />
      </g>
      <g className="kw-leg kw-leg--r" style={{ transformOrigin: '48px 60px' }}>
        <rect x="44" y="57" width="9" height="24" rx="4.5" fill={shortsColor} />
        <ellipse cx="48" cy="82" rx="8" ry="5" fill="#121826" />
        <ellipse cx="47" cy="80.5" rx="3" ry="1.2" fill="rgba(255,255,255,.2)" />
      </g>

      <path d="M16 31 Q40 20 64 31 L60 61 Q40 68 20 61 Z" fill={jerseyColor} stroke="rgba(255,255,255,.58)" strokeWidth="1.2" />
      <path d="M18 33 Q40 25 62 33 L60 40 Q40 34 20 40 Z" fill="rgba(255,255,255,.18)" />
      <path d="M30 28 V60 M50 28 V60" stroke={accentColor} strokeWidth="3" opacity=".58" />
      <path d="M34 31 Q40 35 46 31" stroke={accentColor} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".85" />

      {armsUp ? (
        <>
          <g className="kw-arm kw-arm--l kw-arm--up" style={{ transformOrigin: '24px 38px' }}>
            <rect x="18" y="17" width="9" height="32" rx="4.5" fill={jerseyColor} stroke="rgba(0,0,0,.18)" />
            <circle cx="22.5" cy="16" r={role === 'keeper' ? 6.5 : 4.3} fill={role === 'keeper' ? gloveColor : appearance.skin} stroke="rgba(255,255,255,.45)" />
          </g>
          <g className="kw-arm kw-arm--r kw-arm--up" style={{ transformOrigin: '56px 38px' }}>
            <rect x="53" y="17" width="9" height="32" rx="4.5" fill={jerseyColor} stroke="rgba(0,0,0,.18)" />
            <circle cx="57.5" cy="16" r={role === 'keeper' ? 6.5 : 4.3} fill={role === 'keeper' ? gloveColor : appearance.skin} stroke="rgba(255,255,255,.45)" />
          </g>
        </>
      ) : (
        <>
          <g className="kw-arm kw-arm--l" style={{ transformOrigin: '22px 39px' }}>
            <rect x="7" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
            <circle cx="12" cy="57" r="4" fill={appearance.skin} />
          </g>
          <g className="kw-arm kw-arm--r" style={{ transformOrigin: '58px 39px' }}>
            <rect x="63" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
            <circle cx="68" cy="57" r="4" fill={appearance.skin} />
          </g>
        </>
      )}

      <g className="kw-head" style={{ transformOrigin: '40px 30px' }}>
        <ellipse cx="40" cy="19" rx={face.rx} ry={face.ry} fill={appearance.skin} stroke="rgba(255,255,255,.55)" strokeWidth="1" />
        <HairShape appearance={appearance} />
        <FaceDetails appearance={appearance} determined={determined} />
      </g>

      {label ? (
        <text x="40" y="49" fontFamily="Barlow Condensed" fontWeight="900" fontSize={label.length > 6 ? 7 : 9} fill={textColor} textAnchor="middle" stroke="rgba(9,14,26,.35)" strokeWidth=".5" style={{ paintOrder: 'stroke' }}>
          {label}
        </text>
      ) : null}
    </svg>
  )
}

export function KawaiiSprite({
  label = '',
  playerName,
  teamId,
  jerseyColor,
  accentColor = '#ffffff',
  shortsColor = '#1a2338',
  textColor = '#ffffff',
  role = 'player',
  motion,
  withBall = false,
  seed,
  width = 58,
  height = 70,
  className = '',
  gloveColor = '#ffe9a8',
}: KawaiiSpriteProps) {
  const appearance = resolvePlayerAppearance(seed ?? label, playerName, teamId)

  if (role === 'enemy') {
    return (
      <CrowdSprite
        label={label}
        appearance={appearance}
        jerseyColor={jerseyColor}
        accentColor={accentColor}
        shortsColor={shortsColor}
        textColor={textColor}
        withBall={withBall}
        width={width}
        height={height}
        className={className}
      />
    )
  }

  return (
    <HeroSprite
      label={label}
      jerseyColor={jerseyColor}
      accentColor={accentColor}
      shortsColor={shortsColor}
      textColor={textColor}
      role={role}
      motion={motion}
      withBall={withBall}
      width={width}
      height={height}
      className={className}
      gloveColor={gloveColor}
      appearance={appearance}
    />
  )
}

export const KAWAII_SPRITE_CSS = `
  .kw-sprite { display: block; overflow: visible; contain: layout paint; }
  .kw-motion-run .kw-leg--l { animation: kwRunLegL var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-leg--r { animation: kwRunLegR var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-arm--l:not(.kw-arm--up) { animation: kwRunArmL var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-arm--r:not(.kw-arm--up) { animation: kwRunArmR var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-head { animation: kwRunHead calc(var(--kw-step, .34s) * 2) ease-in-out infinite alternate; }
  .kw-motion-ready .kw-arm--up.kw-arm--l { transform: rotate(20deg); }
  .kw-motion-ready .kw-arm--up.kw-arm--r { transform: rotate(-20deg); }
  .kw-sprite--crowd .kw-arm, .kw-sprite--crowd .kw-head { animation: none !important; }
  .kw-sprite--crowd .kw-leg--l { animation-duration: .46s; }
  .kw-sprite--crowd .kw-leg--r { animation-duration: .46s; }
  @keyframes kwRunLegL { from { transform: rotate(-7deg); } to { transform: rotate(9deg); } }
  @keyframes kwRunLegR { from { transform: rotate(9deg); } to { transform: rotate(-7deg); } }
  @keyframes kwRunArmL { from { transform: rotate(6deg); } to { transform: rotate(-8deg); } }
  @keyframes kwRunArmR { from { transform: rotate(-8deg); } to { transform: rotate(6deg); } }
  @keyframes kwRunHead { from { transform: rotate(-1.4deg) translateY(.3px); } to { transform: rotate(1.4deg) translateY(-.4px); } }
  @media (prefers-reduced-motion: reduce) {
    .kw-sprite .kw-leg, .kw-sprite .kw-arm, .kw-sprite .kw-head { animation: none; }
  }
`

export default KawaiiSprite
