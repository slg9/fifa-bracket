export type KawaiiRole = 'player' | 'enemy' | 'defender' | 'keeper' | 'kicker'
export type KawaiiMotion = 'run' | 'idle' | 'ready'

type KawaiiSpriteProps = {
  label?: string
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

function CrowdSprite({
  label,
  jerseyColor,
  accentColor,
  shortsColor,
  textColor,
  withBall,
  width,
  height,
  className,
}: Required<Pick<KawaiiSpriteProps, 'jerseyColor' | 'accentColor' | 'shortsColor' | 'textColor' | 'width' | 'height' | 'className'>> & Pick<KawaiiSpriteProps, 'label' | 'withBall'>) {
  return (
    <svg viewBox="0 0 80 98" width={width} height={height} className={`kw-sprite kw-sprite--crowd ${className}`.trim()} aria-hidden="true">
      <ellipse cx="40" cy="91" rx="20" ry="5" fill="rgba(0,0,0,.26)" />
      {withBall ? <circle cx="58" cy="82" r="8" fill="#f7f9fc" stroke="#101827" strokeWidth="2" /> : null}
      <rect className="kw-leg kw-leg--l" x="28" y="58" width="8" height="22" rx="4" fill={shortsColor} />
      <rect className="kw-leg kw-leg--r" x="44" y="58" width="8" height="22" rx="4" fill={shortsColor} />
      <path d="M17 33 Q40 25 63 33 L58 61 Q40 66 22 61 Z" fill={jerseyColor} stroke="rgba(255,255,255,.42)" strokeWidth="1" />
      <path d="M31 31 V59 M49 31 V59" stroke={accentColor} strokeWidth="2.4" opacity=".45" />
      <circle cx="40" cy="20" r="17" fill="#f3c9a0" />
      <path d="M24 17 Q40 1 56 17 Q49 8 40 7 Q31 8 24 17 Z" fill="#2c1c10" />
      <circle cx="34" cy="22" r="2.5" fill="#111" />
      <circle cx="46" cy="22" r="2.5" fill="#111" />
      <path d="M36 29 Q40 31 44 29" stroke="#111" strokeWidth="1.6" fill="none" strokeLinecap="round" />
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
}: Omit<KawaiiSpriteProps, 'seed'> & { label: string; accentColor: string; shortsColor: string; textColor: string; role: KawaiiRole; withBall: boolean; width: number; height: number; className: string; gloveColor: string }) {
  const resolvedMotion: KawaiiMotion = motion ?? (role === 'keeper' || role === 'defender' ? 'ready' : 'run')
  const armsUp = role === 'keeper' || role === 'defender'
  const determined = role === 'keeper' || role === 'kicker'

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
            <circle cx="22.5" cy="16" r={role === 'keeper' ? 6.5 : 4.3} fill={role === 'keeper' ? gloveColor : '#f3c9a0'} stroke="rgba(255,255,255,.45)" />
          </g>
          <g className="kw-arm kw-arm--r kw-arm--up" style={{ transformOrigin: '56px 38px' }}>
            <rect x="53" y="17" width="9" height="32" rx="4.5" fill={jerseyColor} stroke="rgba(0,0,0,.18)" />
            <circle cx="57.5" cy="16" r={role === 'keeper' ? 6.5 : 4.3} fill={role === 'keeper' ? gloveColor : '#f3c9a0'} stroke="rgba(255,255,255,.45)" />
          </g>
        </>
      ) : (
        <>
          <g className="kw-arm kw-arm--l" style={{ transformOrigin: '22px 39px' }}>
            <rect x="7" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
            <circle cx="12" cy="57" r="4" fill="#f3c9a0" />
          </g>
          <g className="kw-arm kw-arm--r" style={{ transformOrigin: '58px 39px' }}>
            <rect x="63" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
            <circle cx="68" cy="57" r="4" fill="#f3c9a0" />
          </g>
        </>
      )}

      <g className="kw-head" style={{ transformOrigin: '40px 30px' }}>
        <circle cx="40" cy="19" r="18.5" fill="#f3c9a0" stroke="rgba(255,255,255,.55)" strokeWidth="1" />
        <path d="M23 16 Q40 -5 57 16 Q53 3 40 0 Q27 3 23 16 Z" fill="#322012" />
        <path d="M25 15 Q32 6 39 8 Q47 3 55 15 Q47 10 40 12 Q32 10 25 15 Z" fill="rgba(255,255,255,.12)" />
        {determined ? (
          <g stroke="#111" strokeWidth="1.5" strokeLinecap="round">
            <path d="M29 17 L36 19" />
            <path d="M51 17 L44 19" />
          </g>
        ) : null}
        <ellipse cx="33" cy="21" rx="3.3" ry="4" fill="#111" />
        <ellipse cx="47" cy="21" rx="3.3" ry="4" fill="#111" />
        <circle cx="34.2" cy="19.6" r="1.15" fill="#fff" />
        <circle cx="48.2" cy="19.6" r="1.15" fill="#fff" />
        <circle cx="28" cy="26" r="2.8" fill="#ff8a8a" opacity=".5" />
        <circle cx="52" cy="26" r="2.8" fill="#ff8a8a" opacity=".5" />
        <path d="M35 28 Q40 31.5 45 28" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="round" />
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
  jerseyColor,
  accentColor = '#ffffff',
  shortsColor = '#1a2338',
  textColor = '#ffffff',
  role = 'player',
  motion,
  withBall = false,
  width = 58,
  height = 70,
  className = '',
  gloveColor = '#ffe9a8',
}: KawaiiSpriteProps) {
  if (role === 'enemy') {
    return (
      <CrowdSprite
        label={label}
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