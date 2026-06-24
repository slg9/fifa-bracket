import { useEffect, useMemo, useState } from 'react'

type WinVariant = 'confetti' | 'explosion' | 'stars' | 'lightning' | 'crown' | 'shockwave'

export interface WinAnimationProps {
  variant?: WinVariant | 'random'
  onComplete?: () => void
  size?: number
}

const VARIANTS: WinVariant[] = ['confetti', 'explosion', 'stars', 'lightning', 'crown', 'shockwave']
const COLORS = ['#FFB800', '#2bff9a', '#FF4455', '#A855F7', '#3B82F6', '#FF6B35']

export function WinAnimation({ variant = 'random', onComplete, size = 200 }: WinAnimationProps) {
  const [resolvedVariant] = useState<WinVariant>(() => variant === 'random'
    ? VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
    : variant)
  const confetti = useMemo(() => Array.from({ length: 24 }, (_, index) => ({
    id: index,
    x: 8 + ((index * 73) % 184),
    y: -20 - ((index * 17) % 30),
    color: COLORS[index % COLORS.length],
    duration: 0.8 + ((index * 11) % 6) / 10,
    delay: ((index * 7) % 6) / 10,
    rotation: (index * 47) % 180,
  })), [])

  useEffect(() => {
    const timer = window.setTimeout(() => onComplete?.(), 1200)
    return () => window.clearTimeout(timer)
  }, [onComplete])

  return (
    <svg className={`brakup-win brakup-win--${resolvedVariant}`} width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      {resolvedVariant === 'confetti' && confetti.map((piece) => (
        <rect key={piece.id} className="brakup-confetti" x={piece.x} y={piece.y} width="7" height="13" rx="2" fill={piece.color}
          style={{ animationDuration: `${piece.duration}s`, animationDelay: `${piece.delay}s`, transform: `rotate(${piece.rotation}deg)`, transformOrigin: `${piece.x}px ${piece.y}px` }} />
      ))}
      {resolvedVariant === 'explosion' && (
        <g>
          {[40, 60, 80].map((radius, index) => <circle key={radius} className="brakup-blast-ring" cx="100" cy="100" r={radius} style={{ animationDelay: `${index * 0.12}s` }} />)}
          {Array.from({ length: 8 }, (_, index) => {
            const angle = index * Math.PI / 4
            return <line key={index} className="brakup-blast-ray" x1="100" y1="100" x2={100 + Math.cos(angle) * 85} y2={100 + Math.sin(angle) * 85} style={{ animationDelay: `${index * 0.03}s` }} />
          })}
        </g>
      )}
      {resolvedVariant === 'stars' && (
        <g className="brakup-star-orbit">
          {Array.from({ length: 5 }, (_, index) => {
            const angle = index * Math.PI * 2 / 5
            const x = 100 + Math.cos(angle) * 62
            const y = 100 + Math.sin(angle) * 62
            return <polygon key={index} className="brakup-star" points="0,-11 3,-3 11,-3 5,2 7,10 0,5 -7,10 -5,2 -11,-3 -3,-3" transform={`translate(${x} ${y})`} fill={COLORS[index]} />
          })}
        </g>
      )}
      {resolvedVariant === 'lightning' && (
        <g>
          <path className="brakup-lightning" d="M5 55 L55 78 L42 94 L98 100" />
          <path className="brakup-lightning" d="M195 45 L148 72 L160 92 L102 100" />
          <rect className="brakup-flash" width="200" height="200" fill="#fff" />
        </g>
      )}
      {resolvedVariant === 'crown' && <path className="brakup-crown" d="M45 125 L30 55 L67 88 L100 30 L133 88 L170 55 L155 125 Z M48 138 H152 V153 H48 Z" />}
      {resolvedVariant === 'shockwave' && (
        <g>
          <circle className="brakup-shockwave-fill" cx="100" cy="100" r="25" />
          <circle className="brakup-shockwave-ring" cx="100" cy="100" r="10" />
          <circle className="brakup-shockwave-ring" cx="100" cy="100" r="10" style={{ animationDelay: '0.25s' }} />
        </g>
      )}
    </svg>
  )
}

export default WinAnimation
