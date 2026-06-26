import type { Team } from '../types'

export type TeamKit = {
  primary: string
  secondary: string
  shorts: string
  socks: string
  text: string
}

const DEFAULT_KIT: TeamKit = {
  primary: '#2bff9a',
  secondary: '#0b1422',
  shorts: '#101a2c',
  socks: '#2bff9a',
  text: '#08120d',
}

const KIT_BY_CODE: Record<string, TeamKit> = {
  ALG: { primary: '#ffffff', secondary: '#006233', shorts: '#ffffff', socks: '#ffffff', text: '#006233' },
  ARG: { primary: '#75aadb', secondary: '#ffffff', shorts: '#111827', socks: '#ffffff', text: '#0b2342' },
  AUS: { primary: '#ffcd00', secondary: '#00843d', shorts: '#00843d', socks: '#ffcd00', text: '#06351f' },
  AUT: { primary: '#ef3340', secondary: '#ffffff', shorts: '#ef3340', socks: '#ef3340', text: '#ffffff' },
  BEL: { primary: '#ef3340', secondary: '#ffd100', shorts: '#111111', socks: '#ef3340', text: '#ffffff' },
  BIH: { primary: '#005baa', secondary: '#f6c800', shorts: '#005baa', socks: '#005baa', text: '#ffffff' },
  BRA: { primary: '#f7d117', secondary: '#009c3b', shorts: '#002776', socks: '#ffffff', text: '#003b1f' },
  CAN: { primary: '#d80621', secondary: '#ffffff', shorts: '#d80621', socks: '#d80621', text: '#ffffff' },
  CIV: { primary: '#f77f00', secondary: '#009e60', shorts: '#ffffff', socks: '#009e60', text: '#ffffff' },
  COL: { primary: '#fcd116', secondary: '#003893', shorts: '#003893', socks: '#ce1126', text: '#10214a' },
  COD: { primary: '#007fff', secondary: '#f7d618', shorts: '#ef3340', socks: '#007fff', text: '#ffffff' },
  CPV: { primary: '#003893', secondary: '#ffffff', shorts: '#003893', socks: '#003893', text: '#ffffff' },
  CRO: { primary: '#ffffff', secondary: '#d00000', shorts: '#ffffff', socks: '#004b9b', text: '#d00000' },
  CUW: { primary: '#005daa', secondary: '#f9d616', shorts: '#005daa', socks: '#005daa', text: '#ffffff' },
  CZE: { primary: '#d7141a', secondary: '#11457e', shorts: '#11457e', socks: '#d7141a', text: '#ffffff' },
  ECU: { primary: '#ffdd00', secondary: '#034ea2', shorts: '#034ea2', socks: '#ed1c24', text: '#10214a' },
  EGY: { primary: '#ce1126', secondary: '#ffffff', shorts: '#000000', socks: '#000000', text: '#ffffff' },
  ENG: { primary: '#ffffff', secondary: '#cf142b', shorts: '#0b1f3a', socks: '#ffffff', text: '#0b1f3a' },
  ESP: { primary: '#c60b1e', secondary: '#ffc400', shorts: '#1d2c62', socks: '#c60b1e', text: '#ffc400' },
  FRA: { primary: '#1f4fa3', secondary: '#ef3340', shorts: '#ffffff', socks: '#ef3340', text: '#ffffff' },
  GER: { primary: '#ffffff', secondary: '#111111', shorts: '#111111', socks: '#ffffff', text: '#111111' },
  GHA: { primary: '#ffffff', secondary: '#006b3f', shorts: '#ffffff', socks: '#ffffff', text: '#111111' },
  HAI: { primary: '#00209f', secondary: '#d21034', shorts: '#d21034', socks: '#00209f', text: '#ffffff' },
  IRN: { primary: '#ffffff', secondary: '#239f40', shorts: '#ffffff', socks: '#da0000', text: '#239f40' },
  IRQ: { primary: '#00843d', secondary: '#ffffff', shorts: '#ffffff', socks: '#00843d', text: '#ffffff' },
  JOR: { primary: '#ffffff', secondary: '#ce1126', shorts: '#111111', socks: '#00843d', text: '#111111' },
  JPN: { primary: '#003f8f', secondary: '#e60033', shorts: '#003f8f', socks: '#003f8f', text: '#ffffff' },
  KOR: { primary: '#e6002d', secondary: '#0b1f3a', shorts: '#e6002d', socks: '#e6002d', text: '#ffffff' },
  KSA: { primary: '#00843d', secondary: '#ffffff', shorts: '#00843d', socks: '#00843d', text: '#ffffff' },
  MAR: { primary: '#c1272d', secondary: '#006233', shorts: '#006233', socks: '#c1272d', text: '#ffffff' },
  MEX: { primary: '#006847', secondary: '#ce1126', shorts: '#ffffff', socks: '#ce1126', text: '#ffffff' },
  NED: { primary: '#ff7f00', secondary: '#003f87', shorts: '#ff7f00', socks: '#ff7f00', text: '#10214a' },
  NOR: { primary: '#ba0c2f', secondary: '#00205b', shorts: '#00205b', socks: '#ba0c2f', text: '#ffffff' },
  NZL: { primary: '#ffffff', secondary: '#111111', shorts: '#ffffff', socks: '#ffffff', text: '#111111' },
  PAN: { primary: '#d21034', secondary: '#005293', shorts: '#005293', socks: '#d21034', text: '#ffffff' },
  PAR: { primary: '#d52b1e', secondary: '#ffffff', shorts: '#0038a8', socks: '#d52b1e', text: '#ffffff' },
  POR: { primary: '#d00000', secondary: '#006600', shorts: '#006600', socks: '#d00000', text: '#ffffff' },
  QAT: { primary: '#8a1538', secondary: '#ffffff', shorts: '#8a1538', socks: '#8a1538', text: '#ffffff' },
  RSA: { primary: '#ffb81c', secondary: '#007a4d', shorts: '#007a4d', socks: '#ffb81c', text: '#10351f' },
  SCO: { primary: '#003876', secondary: '#ffffff', shorts: '#ffffff', socks: '#003876', text: '#ffffff' },
  SEN: { primary: '#ffffff', secondary: '#00853f', shorts: '#ffffff', socks: '#ffffff', text: '#00853f' },
  SUI: { primary: '#d52b1e', secondary: '#ffffff', shorts: '#d52b1e', socks: '#d52b1e', text: '#ffffff' },
  SWE: { primary: '#ffcd00', secondary: '#006aa7', shorts: '#006aa7', socks: '#ffcd00', text: '#003b6f' },
  TUN: { primary: '#ffffff', secondary: '#e70013', shorts: '#ffffff', socks: '#ffffff', text: '#e70013' },
  TUR: { primary: '#e30a17', secondary: '#ffffff', shorts: '#e30a17', socks: '#e30a17', text: '#ffffff' },
  URU: { primary: '#75aadb', secondary: '#111111', shorts: '#111111', socks: '#111111', text: '#0b2342' },
  USA: { primary: '#ffffff', secondary: '#3c3b6e', shorts: '#ffffff', socks: '#ffffff', text: '#3c3b6e' },
  UZB: { primary: '#ffffff', secondary: '#1eb4e9', shorts: '#ffffff', socks: '#ffffff', text: '#0072bc' },
}

function normalizeCode(value?: string | null) {
  return value?.trim().toUpperCase() ?? ''
}

export function resolveTeamKit(team?: Team, fallbackCode?: string): TeamKit {
  const code = normalizeCode(team?.fifaCode) || normalizeCode(team?.id) || normalizeCode(fallbackCode)
  return KIT_BY_CODE[code] ?? DEFAULT_KIT
}
