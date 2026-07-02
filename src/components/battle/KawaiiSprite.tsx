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
  const resolvedMotion: KawaiiMotion = motion ?? (role === 'keeper' || role === 'defender' ? 'ready' : 'run')
  const armsUp = role === 'keeper' || role === 'defender'
  const eyeTilt = role === 'enemy' || role === 'keeper' ? -1 : 1

  return (
    <svg
      viewBox="0 0 80 98"
      width={width}
      height={height}
      className={`kw-sprite kw-motion-${resolvedMotion} kw-role-${role} ${className}`.trim()}
      aria-hidden="true"
    >
      <ellipse cx="40" cy="91" rx="23" ry="5.5" fill="rgba(0,0,0,.28)" />

      {withBall ? (
        <g className="kw-ball" transform="translate(57 82)">
          <circle r="9.5" fill="#f7f9fc" stroke="#101827" strokeWidth="2" />
          <path d="M0 -6 L5 -2 L3 4 H-3 L-5 -2 Z" fill="none" stroke="#101827" strokeWidth="1.4" />
        </g>
      ) : null}

      <g className="kw-leg kw-leg--l" style={{ transformOrigin: '32px 60px' }}>
        <rect x="27" y="58" width="9" height="23" rx="4.5" fill={shortsColor} />
        <ellipse cx="31" cy="82" rx="8" ry="5" fill="#121826" />
      </g>
      <g className="kw-leg kw-leg--r" style={{ transformOrigin: '48px 60px' }}>
        <rect x="44" y="58" width="9" height="23" rx="4.5" fill={shortsColor} />
        <ellipse cx="48" cy="82" rx="8" ry="5" fill="#121826" />
      </g>

      <path d="M16 31 Q40 21 64 31 L60 61 Q40 67 20 61 Z" fill={jerseyColor} stroke="rgba(255,255,255,.55)" strokeWidth="1.2" />
      <path d="M30 28 V59 M50 28 V59" stroke={accentColor} strokeWidth="3" opacity=".48" />

      {armsUp ? (
        <>
          <g className="kw-arm kw-arm--l" style={{ transformOrigin: '24px 39px' }}>
            <rect x="18" y="18" width="9" height="32" rx="4.5" fill={jerseyColor} />
            <circle cx="22.5" cy="17" r={role === 'keeper' ? 6.5 : 4.2} fill={role === 'keeper' ? gloveColor : '#f3c9a0'} />
          </g>
          <g className="kw-arm kw-arm--r" style={{ transformOrigin: '56px 39px' }}>
            <rect x="53" y="18" width="9" height="32" rx="4.5" fill={jerseyColor} />
            <circle cx="57.5" cy="17" r={role === 'keeper' ? 6.5 : 4.2} fill={role === 'keeper' ? gloveColor : '#f3c9a0'} />
          </g>
        </>
      ) : (
        <>
          <rect className="kw-arm kw-arm--l" x="7" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
          <rect className="kw-arm kw-arm--r" x="63" y="34" width="10" height="22" rx="5" fill={jerseyColor} />
          <circle cx="12" cy="57" r="4" fill="#f3c9a0" />
          <circle cx="68" cy="57" r="4" fill="#f3c9a0" />
        </>
      )}

      <g className="kw-head" style={{ transformOrigin: '40px 30px' }}>
        <circle cx="40" cy="19" r="18" fill="#f3c9a0" stroke="rgba(255,255,255,.5)" strokeWidth="1" />
        <path d="M23 16 Q40 -4 57 16 Q53 5 40 1 Q27 5 23 16 Z" fill="#322012" />
        <path d={eyeTilt < 0 ? 'M30 18 L36 20 M50 18 L44 20' : 'M30 20 L36 18 M50 20 L44 18'} stroke="#111" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="33" cy="21" r="3" fill="#111" />
        <circle cx="47" cy="21" r="3" fill="#111" />
        <circle cx="34" cy="20" r="1" fill="#fff" />
        <circle cx="48" cy="20" r="1" fill="#fff" />
        <circle cx="28" cy="26" r="2.8" fill="#ff8a8a" opacity=".45" />
        <circle cx="52" cy="26" r="2.8" fill="#ff8a8a" opacity=".45" />
        <path d="M35 28 Q40 31 45 28" stroke="#111" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </g>

      {label ? (
        <text x="40" y="49" fontFamily="Barlow Condensed" fontWeight="900" fontSize={label.length > 6 ? 7 : 9} fill={textColor} textAnchor="middle">
          {label}
        </text>
      ) : null}
    </svg>
  )
}

export const KAWAII_SPRITE_CSS = `
  .kw-sprite { display: block; overflow: visible; contain: layout paint; }
  .kw-motion-run .kw-leg--l { animation: kwRunLegL var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-leg--r { animation: kwRunLegR var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-arm--l:not(.kw-arm--up) { animation: kwRunArmL var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-run .kw-arm--r:not(.kw-arm--up) { animation: kwRunArmR var(--kw-step, .34s) ease-in-out infinite alternate; }
  .kw-motion-ready .kw-arm--l { transform: rotate(20deg); }
  .kw-motion-ready .kw-arm--r { transform: rotate(-20deg); }
  @keyframes kwRunLegL { from { transform: rotate(-6deg); } to { transform: rotate(8deg); } }
  @keyframes kwRunLegR { from { transform: rotate(8deg); } to { transform: rotate(-6deg); } }
  @keyframes kwRunArmL { from { transform: rotate(5deg); } to { transform: rotate(-6deg); } }
  @keyframes kwRunArmR { from { transform: rotate(-6deg); } to { transform: rotate(5deg); } }
  @media (prefers-reduced-motion: reduce) {
    .kw-sprite .kw-leg, .kw-sprite .kw-arm { animation: none; }
  }
`

export default KawaiiSprite