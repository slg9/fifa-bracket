// Design tokens extracted from Brakup Battle.dc.html
export const colors = {
  // Backgrounds
  screenBg: '#050b16',
  pitchBg: '#0c2e1d',
  pitchBgDark: '#0a2618',
  pitchBgDarker: '#061a10',
  controlsBg: '#04110a',
  fruitNinjaBg: '#03070d',
  // Red tint backgrounds (defense)
  defensePitchBg: '#140a0d',
  defenseShotZoneBg: 'rgba(255,68,85,.2)',
  defenseOriginBg: '#1a0d10',

  // Neons / accents
  neon: '#2bff9a',
  gold: '#FFB800',
  red: '#FF4455',
  blue: '#3B82F6',
  white: '#EEF3FF',
  goldenRing: '#f5c842',

  // Defender types
  defenderNormalBorder: 'rgba(255,255,255,.85)',
  defenderCostaudBg: '#FF4455',
  defenderAgileBg: '#3B82F6',

  // Glove
  glovePrimary: '#FF4455',

  // Typography on dark
  dimText: 'rgba(255,255,255,.4)',
  mutedText: 'rgba(255,255,255,.5)',
} as const

export const timing = {
  pulse: '3.4s',
  walk: '1s',
  charge: '1.2s',
  flash: '1.6s',
  conf: '2.4s',
  heart: '1s',
  burst: '1.2s',
  ripple: '1.2s',
} as const

export const fonts = {
  condensed: "'Barlow Condensed'",
  body: 'Barlow',
  mono: "'JetBrains Mono'",
} as const
