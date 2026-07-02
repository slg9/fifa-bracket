import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { toBlob } from 'html-to-image'
import './App.css'
import AdminDashboard from './AdminDashboard'
import BootLoaderMark from './components/BootLoaderMark'
import BrakupHub from './challenge/BrakupHub'
import BracketChallenge from './challenge/BracketChallenge'
import Leaderboard from './challenge/Leaderboard'
import LoginEntry from './challenge/LoginEntry'
import ProfileSettings from './challenge/ProfileSettings'
import { loadLiveSnapshot, loadSeed, syncLiveSnapshot as requestLiveSync, fetchMatchStats, fetchOdds } from './lib/data'
import type { MatchEventsData, MatchOdds, OddsSnapshot } from './lib/data'
import { alternateLanguageHref, getCurrentLocale, isChallengeRoute, localizedChallengeHref, useAppI18n } from './lib/i18n'
import { formatKnockoutDateTime, knockoutKickoffById } from './lib/knockoutSchedule'
import { checkEmailExists, getSimulatorLeaderboard, getProfileStatus, getPublicBracketShare, getSimulatorBracket, getSimulatorBracketByPseudo, requestOTP, resendMagicLink, saveSimulatorBracket, updateProfile, verifyLoginOTP, verifyOTP } from './lib/challengeData'
import { CHAMPION_BONUS, STAGE_POINTS } from './lib/scoring'
import { formatStageLongLabel, formatStageShortLabel } from './lib/stageLabels'
import { clearChallengeProfile, readChallengeProfile, subscribeChallengeProfile, writeChallengeProfile } from './lib/challengeProfile'
import { identifyAnalyticsProfile, initAnalytics, trackAnalytics } from './lib/analytics'
import {
  buildGroupOrderOverrides,
  buildKnockoutBracket,
  computeStandings,
  getBestThirdPlacedTeams,
  knockoutTemplates,
  mergeScores,
} from './lib/tournament'
import type {
  ChallengeEntry,
  GroupMatch,
  LiveSnapshot,
  KnockoutEntrant,
  MatchOverride,
  MatchPrediction,
  Mode,
  PublicBracketShare,
  SimulatorBracketEntry,
  RankedStandingRow,
  Team,
  TournamentSeed,
} from './types'

type View = 'groups' | 'bracket'

type LiveState = {
  syncedAt: string | null
  source: string
  warnings: string[]
  matches: Array<{ id: string; homeScore: number | null; awayScore: number | null; status: GroupMatch['status']; kickoffTime?: string | null; kickoffIso?: string | null; liveMinute?: string | null; fifaMatchPath?: string | null; winnerTeamCode?: string | null }>
  standings: RankedStandingRow[]
  predictions: MatchPrediction[]
  topScorers?: Array<{ name: string; teamCode: string; goals: number }>
}

function mergeLiveSnapshot(current: LiveState, snapshot: LiveSnapshot): LiveState {
  const hasMatches = snapshot.matches.length > 0
  const hasStandings = snapshot.standings.length > 0
  const extractionFailed = !hasMatches && !hasStandings

  return {
    syncedAt: extractionFailed ? current.syncedAt : snapshot.syncedAt,
    source: extractionFailed ? current.source : snapshot.source,
    warnings: extractionFailed ? [] : snapshot.warnings,
    matches: hasMatches ? snapshot.matches : current.matches,
    standings: hasStandings ? snapshot.standings : current.standings,
    predictions: snapshot.predictions?.length ? snapshot.predictions : current.predictions,
    topScorers: snapshot.topScorers?.length ? snapshot.topScorers : current.topScorers,
  }
}

function hasRenderableScore(match: Pick<GroupMatch, 'homeScore' | 'awayScore'>): boolean {
  return match.homeScore !== null && match.awayScore !== null
}

function ScoreLoading() {
  return (
    <div className="daymatch__score daymatch__score--loading" aria-label="Chargement du score" role="status">
      <span />
      <span />
      <span />
    </div>
  )
}

type DisplayMatch = {
  id: string
  stage: string
  label: string
  dateLabel: string
  home: KnockoutEntrant
  away: KnockoutEntrant
  qualificationStatus?: 'confirmed' | 'projected'
  winnerId: string | null
  pickedWinnerId: string | null
  realWinnerId: string | null
  played: boolean
  hasOfficialResult: boolean
  predictionState?: 'correct' | 'wrong'
}

type DayMatch = GroupMatch & {
  dayStageLabel?: string
  dayMatchLabel?: string
  homeLabel?: string
  awayLabel?: string
  isKnockout?: boolean
}

type DragState = {
  groupId: string
  teamId: string
  overTeamId: string | null
}

const simulationStorageKey = 'fifabracket:simulation'
const challengeDraftStorageKey = 'brakup:draft'
const challengeTokenStorageKey = 'brakup:token'
const challengeHadAccountStorageKey = 'brakup:hadAccount'
const simulatorOutcomeSeenStorageKey = 'fifabracket:simulator-seen-outcomes'

// Free-to-air broadcaster per match (France). Matches not listed = beIN Sports only.
// Source: M6/W9 rights + beIN Sports 2026 World Cup schedule.
const broadcasterFR: Record<string, 'M6' | 'W9'> = {
  A1: 'M6',                               // MEX vs RSA
  B1: 'M6', B2: 'W9', B5: 'M6',          // CAN-BIH, QAT-SUI, SUI-CAN
  C2: 'M6', C4: 'M6',                     // BRA-MAR, SCO-MAR
  D4: 'M6',                               // USA-AUS
  E2: 'W9', E3: 'W9', E6: 'W9',          // GER-CUW, GER-CIV, ECU-GER
  F1: 'W9', F6: 'M6',                     // NED-JPN, TUN-NED
  G2: 'M6', G3: 'M6',                     // BEL-EGY, BEL-IRN
  H1: 'M6', H2: 'W9', H4: 'W9', H6: 'M6', // KSA-URU, ESP-CPV, ESP-KSA, URU-ESP
  I1: 'M6', I4: 'M6', I5: 'M6',          // FRA-SEN, FRA-IRQ, NOR-FRA
  J3: 'M6', J5: 'M6',                     // ARG-AUT, ALG-AUT
  K3: 'W9', K5: 'M6',                     // POR-UZB, COL-POR
  L2: 'W9', L3: 'W9', L5: 'M6',          // ENG-CRO, ENG-GHA, PAN-ENG
}

function BroadcasterBadge({ matchId }: { matchId: string }) {
  const ch = broadcasterFR[matchId]
  if (ch === 'M6') return <span className="bcbadge bcbadge--m6">M6</span>
  if (ch === 'W9') return <span className="bcbadge bcbadge--w9">W9</span>
  return <span className="bcbadge bcbadge--bein">beIN</span>
}

type StoredSimulation = {
  overrides: Record<string, MatchOverride>
  knockoutPicks: Record<string, string>
}

type ChallengeProfile = {
  email: string
  pseudo: string
  bracketName: string
}

type SimulatorOutcomeNotice = {
  key: string
  match: DisplayMatch
}

type BracketReward = {
  points: number
  label: string
  combo: number
  correct: boolean
}

type BracketRewardSummary = {
  total: number
  completeBonus: number
  rewardsByMatch: Map<string, BracketReward>
  comboLinkIds: Set<string>
}

const knockoutScoringOrder = knockoutTemplates.map((template) => template.id)

function isBracketComplete(picks: Record<string, string>): boolean {
  return knockoutTemplates.every((template) => Boolean(picks[template.id]))
}

function calculateBracketRewards(matches: DisplayMatch[]): BracketRewardSummary {
  const byId = new Map(matches.map((match) => [match.id, match]))
  const rewardsByMatch = new Map<string, BracketReward>()
  const comboLinkIds = new Set<string>()
  let total = 0

  for (const matchId of knockoutScoringOrder) {
    const match = byId.get(matchId)
    if (!match?.pickedWinnerId || !match.realWinnerId) continue

    const correct = match.pickedWinnerId === match.realWinnerId
    if (!correct) {
      rewardsByMatch.set(match.id, { points: 0, label: '0', combo: 0, correct: false })
      continue
    }

    const stagePoints = STAGE_POINTS[match.stage] ?? 0
    const championBonus = match.id === 'M104' ? CHAMPION_BONUS : 0
    const points = stagePoints + championBonus
    const label = [`+${points}`]
    if (championBonus) label.push('champion')
    rewardsByMatch.set(match.id, { points, label: label.join(' / '), combo: 0, correct: true })
    total += points
  }
  const completeBonus = 0

  return { total, completeBonus, rewardsByMatch, comboLinkIds }
}

const roundColumns: Array<{ key: string; stage: string; side: 'left' | 'center' | 'right'; ids: string[] }> = [
  { key: 'R32L', stage: 'Round of 32', side: 'left', ids: ['M74', 'M77', 'M73', 'M75', 'M83', 'M84', 'M81', 'M82'] },
  { key: 'R16L', stage: 'Round of 16', side: 'left', ids: ['M89', 'M90', 'M93', 'M94'] },
  { key: 'QFL', stage: 'Quarter-final', side: 'left', ids: ['M97', 'M98'] },
  { key: 'SFL', stage: 'Semi-final', side: 'left', ids: ['M101'] },
  { key: 'F', stage: 'Finale', side: 'center', ids: ['M103', 'M104'] },
  { key: 'SFR', stage: 'Semi-final', side: 'right', ids: ['M102'] },
  { key: 'QFR', stage: 'Quarter-final', side: 'right', ids: ['M99', 'M100'] },
  { key: 'R16R', stage: 'Round of 16', side: 'right', ids: ['M91', 'M92', 'M95', 'M96'] },
  { key: 'R32R', stage: 'Round of 32', side: 'right', ids: ['M76', 'M78', 'M79', 'M80', 'M86', 'M88', 'M85', 'M87'] },
]


// Format live minute for display.
// rawToken = scraper value like "MT", "45'", "90'+2'", "45", "90+2"
// syncedAt = ISO string of when that token was scraped
function formatLiveMinute(rawToken: string | null | undefined, syncedAt: string | null): string {
  if (!rawToken) return 'En direct'
  const upper = rawToken.toUpperCase().replace(/['\u2019\u02b9\u2032]/g, '')
  if (upper === 'MT' || upper === 'MI' || upper === 'HT') return 'Mi-temps'

  // Parse numeric minute (e.g. "90+2" → base 90, extra 2)
  const m = upper.match(/^(\d+)(?:\+(\d+))?$/)
  if (!m) return rawToken // unknown token, show as-is

  let base = Number(m[1])
  const extra = m[2] ? Number(m[2]) : 0
  const scraped = base + extra

  // Add elapsed seconds since sync (capped at period max: 45 or 90)
  if (syncedAt) {
    const elapsedMin = Math.floor((Date.now() - new Date(syncedAt).getTime()) / 60_000)
    const raw = scraped + elapsedMin
    const max = scraped <= 45 ? 45 : 90
    base = Math.min(raw, max)
  } else {
    base = scraped
  }

  return `${base}'`
}

function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isMatchToday(match: Pick<GroupMatch, 'kickoffDate' | 'kickoffIso'>): boolean {
  if (!match.kickoffIso) {
    return match.kickoffDate === localDateStr()
  }

  return localDateStr(new Date(match.kickoffIso)) === localDateStr()
}

function matchLocalDateKey(match: Pick<GroupMatch, 'kickoffDate' | 'kickoffIso'>): string {
  return match.kickoffIso ? localDateStr(new Date(match.kickoffIso)) : match.kickoffDate
}

const knockoutMonthIndex: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

function dateKeyFromKnockoutDateLabel(dateLabel: string): string | null {
  const parsed = dateLabel.match(/^(\d{1,2})\s+([A-Za-z]+)$/)
  if (!parsed) return null
  const day = Number(parsed[1])
  const month = knockoutMonthIndex[parsed[2].slice(0, 3).toLowerCase()]
  if (!Number.isFinite(day) || month === undefined) return null
  return localDateStr(new Date(2026, month, day, 12))
}

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function isLiveNow(kickoffIso: string | null | undefined): boolean {
  if (!kickoffIso) return false
  const elapsed = Date.now() - new Date(kickoffIso).getTime()
  return elapsed >= 0 && elapsed < 130 * 60 * 1000
}

// If the scraper still marks a match as 'scheduled' but kickoff time has passed,
// infer the actual status from wall-clock time (no API needed).
function inferStatus(match: GroupMatch): GroupMatch['status'] {
  if (match.status !== 'scheduled' || !match.kickoffIso) return match.status
  const elapsed = Date.now() - new Date(match.kickoffIso).getTime()
  if (elapsed < 0) return 'scheduled'
  if (elapsed < 130 * 60 * 1000) return 'live'  // within 130 min → probably live
  return 'finished'
}

function formatKickoffTime(match: GroupMatch): string | null {
  if (!match.kickoffIso) return match.kickoffTime ?? null

  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(match.kickoffIso))
}

function readStoredSimulation(): StoredSimulation | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(simulationStorageKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSimulation>
    return {
      overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
      knockoutPicks:
        parsed.knockoutPicks && typeof parsed.knockoutPicks === 'object' ? parsed.knockoutPicks : {},
    }
  } catch {
    return null
  }
}

function readChallengeDraftPicks(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(challengeDraftStorageKey) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

function writeChallengeDraftPicks(picks: Record<string, string>) {
  window.localStorage.setItem(challengeDraftStorageKey, JSON.stringify(picks))
}

function writeStoredSimulation(simulation: StoredSimulation) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(simulationStorageKey, JSON.stringify(simulation))
}

function clearStoredSimulation() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(simulationStorageKey)
}

function readShareIdFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search)
  const queryId = params.get('share')
  if (queryId) return queryId

  const pathMatch = window.location.pathname.match(/\/share\/bracket\/([^/?#]+)/)
  return pathMatch ? decodeURIComponent(pathMatch[1]) : null
}

function readPublicPseudoFromLocation(): string | null {
  const match = window.location.pathname.match(/^\/@([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : null
}
function readStoredChallengeProfile(): ChallengeProfile {
  const profile = readChallengeProfile()
  return {
    email: profile.email,
    pseudo: profile.pseudo,
    bracketName: profile.bracketName,
  }
}

function rememberChallengeProfile(profile: ChallengeProfile) {
  writeChallengeProfile(profile)
}

function readSeenSimulatorOutcomeKeys() {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(simulatorOutcomeSeenStorageKey) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function simulatorOutcomeStorageKey(matchId: string, winnerId: string | null) {
  return `${matchId}:${winnerId ?? 'pending'}`
}

function flagUrl(team: Team): string {
  if (team.iso2.includes('-')) {
    return ''
  }

  return `https://flagcdn.com/w80/${team.iso2}.png`
}

function getEntrantTeamId(entrant: KnockoutEntrant): string | null {
  return entrant.kind === 'team' ? entrant.teamId : null
}

function buildConnectorPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2
  const horizontalDirection = x2 >= x1 ? 1 : -1
  const deltaY = y2 - y1
  const radius = Math.min(18, Math.abs(deltaY) / 2, Math.abs(midX - x1))

  if (radius < 1) {
    return `M ${x1} ${y1} H ${x2}`
  }

  const turnInX = midX - horizontalDirection * radius
  const turnOutX = midX + horizontalDirection * radius
  const turnInY = y1 + Math.sign(deltaY) * radius
  const turnOutY = y2 - Math.sign(deltaY) * radius

  return [
    `M ${x1} ${y1}`,
    `H ${turnInX}`,
    `Q ${midX} ${y1} ${midX} ${turnInY}`,
    `V ${turnOutY}`,
    `Q ${midX} ${y2} ${turnOutX} ${y2}`,
    `H ${x2}`,
  ].join(' ')
}

function normalizeFilePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const mobileRoundTabs = [
  { key: 'L_R32', stage: 'Round of 32' },
  { key: 'L_R16', stage: 'Round of 16' },
  { key: 'L_QF', stage: 'Quarter-final' },
  { key: 'L_SF', stage: 'Semi-final' },
  { key: 'F', stage: 'Finale' },
  { key: 'R_SF', stage: 'Semi-final' },
  { key: 'R_QF', stage: 'Quarter-final' },
  { key: 'R_R16', stage: 'Round of 16' },
  { key: 'R_R32', stage: 'Round of 32' },
] as const

const mobileRoundColumnIndex: Record<(typeof mobileRoundTabs)[number]['key'], number> = {
  L_R32: 0,
  L_R16: 1,
  L_QF: 2,
  L_SF: 3,
  F: 4,
  R_SF: 5,
  R_QF: 6,
  R_R16: 7,
  R_R32: 8,
}

function mobileRoundForColumnIndex(index: number): (typeof mobileRoundTabs)[number]['key'] {
  return mobileRoundTabs[Math.max(0, Math.min(mobileRoundTabs.length - 1, index))].key
}

function getMobileBracketColumnWidth(viewport: HTMLDivElement) {
  if (window.matchMedia('(max-width: 860px)').matches) {
    return viewport.clientWidth > 0 ? viewport.clientWidth : window.innerWidth
  }
  const firstColumn = viewport.querySelector<HTMLElement>('.bcol')
  const width = firstColumn?.getBoundingClientRect().width ?? viewport.clientWidth
  return width > 0 ? width : viewport.clientWidth
}

function formatStageLabel(stage: string): string {
  return formatStageLongLabel(stage, getCurrentLocale())
}

function TeamFocusMenu({
  teams,
  focusId,
  onFocusChange,
  className = '',
}: {
  teams: Team[]
  focusId: string | null
  onFocusChange: (teamId: string | null) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selectedTeam = focusId ? teams.find((team) => team.id === focusId) ?? null : null

  const choose = (teamId: string | null) => {
    onFocusChange(teamId)
    setOpen(false)
  }

  return (
    <div className={`bracket-team-menu${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="bracket-team-menu__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Equipe</span>
        <b>{selectedTeam ? `${selectedTeam.flagEmoji} ${selectedTeam.name}` : 'Parcours finalistes'}</b>
        <i aria-hidden="true">v</i>
      </button>

      {open ? (
        <>
          <button type="button" className="bracket-team-menu__scrim" aria-label="Fermer" onClick={() => setOpen(false)} />
          <div className="bracket-team-menu__panel" role="listbox" aria-label="Choisir une equipe">
            <button
              type="button"
              className={`bracket-team-menu__option${!focusId ? ' is-active' : ''}`}
              role="option"
              aria-selected={!focusId}
              onClick={() => choose(null)}
            >
              <span className="bracket-team-menu__flag">*</span>
              <span>
                <b>Parcours finalistes</b>
                <small>Route centrale du tableau</small>
              </span>
            </button>
            {teams.map((team) => {
              const src = flagUrl(team)
              return (
                <button
                  key={team.id}
                  type="button"
                  className={`bracket-team-menu__option${focusId === team.id ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={focusId === team.id}
                  onClick={() => choose(team.id)}
                >
                  {src ? <img src={src} alt="" className="bracket-team-menu__flag-image" crossOrigin="anonymous" /> : <span className="bracket-team-menu__flag">{team.flagEmoji}</span>}
                  <span>
                    <b>{team.name}</b>
                    <small>{team.groupId ? `Groupe ${team.groupId}` : team.fifaCode}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function KnockoutTeamBadge({
  entrant,
  teamsById,
  isWinner,
  isLoser,
  isPicked,
  pickResult,
  isFocus,
  isActivePath,
  side,
  isInteractive,
  onPick,
  onPreview,
  onStandingsHover,
}: {
  entrant: KnockoutEntrant
  teamsById: Map<string, Team>
  isWinner: boolean
  isLoser: boolean
  isPicked: boolean
  pickResult?: 'correct' | 'wrong'
  isFocus: boolean
  isActivePath: boolean
  side: 'left' | 'center' | 'right'
  isInteractive: boolean
  onPick?: (teamId: string) => void
  onPreview?: (teamId: string | null) => void
  onStandingsHover?: (teamId: string | null, event: React.MouseEvent | React.FocusEvent) => void
  onOpenDetails?: () => void
}) {
  const touchIntentRef = useRef({ x: 0, y: 0, swiping: false })

  if (entrant.kind === 'placeholder') {
    return (
      <div className="bm__team bm__team--placeholder">
        <span className="bm__name">{entrant.label}</span>
      </div>
    )
  }

  const team = teamsById.get(entrant.teamId)

  if (!team) {
    return (
      <div className="bm__team bm__team--placeholder">
        <span className="bm__name">Equipe inconnue</span>
      </div>
    )
  }

  const src = flagUrl(team)
  const outcomeIcon = pickResult === 'correct' ? '*' : pickResult === 'wrong' ? 'x' : null

  return (
    <button
      type="button"
      className={[
        'bm__team',
        isInteractive ? 'is-interactive' : '',
        isWinner ? 'is-win' : '',
        isLoser ? 'is-lose' : '',
        isPicked ? 'is-picked' : '',
        pickResult === 'correct' ? 'is-prono-correct' : '',
        pickResult === 'wrong' ? 'is-prono-wrong' : '',
        isFocus ? 'is-focus' : '',
        isActivePath ? 'is-active-path' : '',
      ].filter(Boolean).join(' ')}
      aria-disabled={!isInteractive}
      onPointerDown={(event) => {
        touchIntentRef.current = { x: event.clientX, y: event.clientY, swiping: false }
      }}
      onPointerMove={(event) => {
        const dx = Math.abs(event.clientX - touchIntentRef.current.x)
        const dy = Math.abs(event.clientY - touchIntentRef.current.y)
        if (dx > 10 && dx > dy * 1.25) {
          touchIntentRef.current.swiping = true
        }
      }}
      onPointerUp={() => {
        window.setTimeout(() => {
          touchIntentRef.current.swiping = false
        }, 0)
      }}
      onPointerCancel={() => {
        touchIntentRef.current.swiping = false
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (touchIntentRef.current.swiping) {
          event.preventDefault()
          return
        }
        if (!isInteractive) return
        onPick?.(team.id)
      }}
      onMouseEnter={(e) => { onPreview?.(team.id); onStandingsHover?.(team.id, e) }}
      onMouseLeave={(e) => { onPreview?.(null); onStandingsHover?.(null, e) }}
      onFocus={(e) => { onPreview?.(team.id); onStandingsHover?.(team.id, e) }}
      onBlur={(e) => { onPreview?.(null); onStandingsHover?.(null, e) }}
    >
      {side === 'right' ? (
        <>
          <span className="bm__name">{team.name}</span>
          {outcomeIcon ? <span className={`bm__outcome bm__outcome--${pickResult}`} aria-hidden="true">{outcomeIcon}</span> : null}
          {src ? <img src={src} alt="" className="flag-image" crossOrigin="anonymous" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
        </>
      ) : (
        <>
          {src ? <img src={src} alt="" className="flag-image" crossOrigin="anonymous" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
          <span className="bm__name">{team.name}</span>
          {outcomeIcon ? <span className={`bm__outcome bm__outcome--${pickResult}`} aria-hidden="true">{outcomeIcon}</span> : null}
        </>
      )}
    </button>
  )
}

const MatchCard = memo(function MatchCard({
  match,
  teamsById,
  side,
  simulationEnabled,
  isActive,
  isDimmed,
  isFinalCard,
  focusId,
  registerRef,
  onPick,
  onClear,
  onPreview,
  onStandingsHover,
  isLocked,
  pickBadgeLabel,
  reward,
  isToday,
  onOpenDetails,
}: {
  match: DisplayMatch
  teamsById: Map<string, Team>
  side: 'left' | 'center' | 'right'
  simulationEnabled: boolean
  isActive: boolean
  isDimmed: boolean
  isFinalCard: boolean
  isLocked: boolean
  pickBadgeLabel: string
  reward?: BracketReward
  isToday?: boolean
  focusId: string | null
  registerRef: (node: HTMLDivElement | null) => void
  onPick: (matchId: string, teamId: string) => void
  onClear: (matchId: string) => void
  onPreview: (teamId: string | null) => void
  onStandingsHover?: (teamId: string | null, event: React.MouseEvent | React.FocusEvent) => void
  onOpenDetails?: () => void
}) {
  const homeTeamId = getEntrantTeamId(match.home)
  const awayTeamId = getEntrantTeamId(match.away)
  const dateTimeLabel = formatKnockoutDateTime(match.id, match.dateLabel)
  const homePickState = match.pickedWinnerId && homeTeamId === match.pickedWinnerId ? match.predictionState : undefined
  const awayPickState = match.pickedWinnerId && awayTeamId === match.pickedWinnerId ? match.predictionState : undefined

  return (
    <article
      className={[
        'bm',
        isActive ? 'is-onpath' : '',
        isDimmed ? 'is-dimmed' : '',
        isFinalCard ? 'bm--final' : '',
        match.predictionState === 'correct' ? 'bm--prono-correct' : '',
        match.predictionState === 'wrong' ? 'bm--prono-wrong' : '',
        isLocked ? 'bm--locked' : '',
        isToday ? 'bm--today' : '',
        onOpenDetails ? 'is-clickable' : '',
      ].filter(Boolean).join(' ')}
      ref={registerRef}
      data-match-id={match.id}
      onClick={onOpenDetails}
    >
      <div className="bm__meta">
        <span>{match.label.toUpperCase()}</span>
        <span className="bm__dateblock">
          {isLocked ? <span className="bm__state-badge bm__state-badge--lock">LOCK</span> : null}
          {match.pickedWinnerId ? <span className="bm__state-badge bm__state-badge--pick">{pickBadgeLabel}</span> : null}
          {reward ? <span className={`bm__state-badge bm__state-badge--points${reward.correct ? ' is-positive' : ' is-zero'}`}>{reward.points > 0 ? `+${reward.points}` : '0'}</span> : null}
          {match.hasOfficialResult ? <span className="bm__state-badge bm__state-badge--official">OFFICIEL</span> : null}
          <span className="bm__datetime">{dateTimeLabel}</span>
        </span>
      </div>
      <KnockoutTeamBadge
        entrant={match.home}
        teamsById={teamsById}
        isWinner={match.winnerId === homeTeamId}
        isLoser={match.played && Boolean(homeTeamId) && match.winnerId !== homeTeamId}
        isPicked={match.pickedWinnerId === homeTeamId}
        pickResult={homePickState}
        isFocus={focusId === homeTeamId}
        isActivePath={isActive}
        side={side}
        isInteractive={simulationEnabled}
        onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
        onPreview={onPreview}
        onStandingsHover={onStandingsHover}
      />
      <KnockoutTeamBadge
        entrant={match.away}
        teamsById={teamsById}
        isWinner={match.winnerId === awayTeamId}
        isLoser={match.played && Boolean(awayTeamId) && match.winnerId !== awayTeamId}
        isPicked={match.pickedWinnerId === awayTeamId}
        pickResult={awayPickState}
        isFocus={focusId === awayTeamId}
        isActivePath={isActive}
        side={side}
        isInteractive={simulationEnabled}
        onPick={simulationEnabled ? (teamId) => onPick(match.id, teamId) : undefined}
        onPreview={onPreview}
        onStandingsHover={onStandingsHover}
      />
      {simulationEnabled && match.pickedWinnerId ? (
        <div className="bm__actions match-card-actions">
          <button type="button" className="bm__clear" onClick={(event) => { event.stopPropagation(); onClear(match.id) }} aria-label={`Effacer ${match.label}`}>
            x
          </button>
        </div>
      ) : null}
    </article>
  )
})

function resolveDisplayBracket(
  groupBracket: ReturnType<typeof buildKnockoutBracket>,
  picks: Record<string, string>,
  winnerTeamCodes: Map<string, string>,
  teamsById: Map<string, Team>,
): DisplayMatch[] {
  const byId = new Map(groupBracket.map((match) => [match.id, match]))
  const display = new Map<string, DisplayMatch>()

  for (const template of knockoutTemplates) {
    const source = byId.get(template.id)

    if (!source) {
      continue
    }

    const resolvedHome =
      template.home.type === 'winnerOf'
        ? (() => {
            const prev = display.get(template.home.matchId)
            return prev?.winnerId
              ? ({ kind: 'team', teamId: prev.winnerId } satisfies KnockoutEntrant)
              : ({ kind: 'placeholder', label: `Vainqueur ${template.home.matchId}` } satisfies KnockoutEntrant)
          })()
        : template.home.type === 'loserOf'
          ? (() => {
              const prev = display.get(template.home.matchId)
              if (prev?.winnerId) {
                const loser = [prev.home, prev.away].find(
                  (e) => e.kind === 'team' && e.teamId !== prev.winnerId,
                )
                return loser?.kind === 'team'
                  ? ({ kind: 'team', teamId: loser.teamId } satisfies KnockoutEntrant)
                  : ({ kind: 'placeholder', label: `Perdant ${template.home.matchId}` } satisfies KnockoutEntrant)
              }
              return { kind: 'placeholder', label: `Perdant ${template.home.matchId}` } satisfies KnockoutEntrant
            })()
          : source.home

    const resolvedAway =
      template.away.type === 'winnerOf'
        ? (() => {
            const prev = display.get(template.away.matchId)
            return prev?.winnerId
              ? ({ kind: 'team', teamId: prev.winnerId } satisfies KnockoutEntrant)
              : ({ kind: 'placeholder', label: `Vainqueur ${template.away.matchId}` } satisfies KnockoutEntrant)
          })()
        : template.away.type === 'loserOf'
          ? (() => {
              const prev = display.get(template.away.matchId)
              if (prev?.winnerId) {
                const loser = [prev.home, prev.away].find(
                  (e) => e.kind === 'team' && e.teamId !== prev.winnerId,
                )
                return loser?.kind === 'team'
                  ? ({ kind: 'team', teamId: loser.teamId } satisfies KnockoutEntrant)
                  : ({ kind: 'placeholder', label: `Perdant ${template.away.matchId}` } satisfies KnockoutEntrant)
              }
              return { kind: 'placeholder', label: `Perdant ${template.away.matchId}` } satisfies KnockoutEntrant
            })()
          : source.away

    const pickedWinnerId = picks[source.id]
    const validPick =
      pickedWinnerId &&
      [resolvedHome, resolvedAway].some(
        (entrant) => entrant.kind === 'team' && entrant.teamId === pickedWinnerId,
      )
        ? pickedWinnerId
        : null
    const winnerTeamCode = winnerTeamCodes.get(source.id)
    const realWinnerEntrant = winnerTeamCode
      ? [resolvedHome, resolvedAway].find(
          (entrant): entrant is { kind: 'team'; teamId: string } => entrant.kind === 'team' && teamsById.get(entrant.teamId)?.fifaCode === winnerTeamCode,
        )
      : undefined
    const realWinnerId = realWinnerEntrant?.teamId ?? null
    const displayedWinnerId = realWinnerId ?? validPick

    display.set(source.id, {
      ...source,
      home: resolvedHome,
      away: resolvedAway,
      winnerId: displayedWinnerId,
      pickedWinnerId: validPick,
      realWinnerId,
      played: Boolean(displayedWinnerId),
      hasOfficialResult: Boolean(realWinnerId),
      predictionState: validPick && realWinnerId ? validPick === realWinnerId ? 'correct' : 'wrong' : undefined,
    })
  }

  return knockoutTemplates
    .map((template) => display.get(template.id))
    .filter((match): match is DisplayMatch => Boolean(match))
}

function BracketBoard({
  matches,
  teamsById,
  focusId,
  picks,
  simulationEnabled,
  standings,
  groupMatches,
  lockedMatchIds,
  rewards,
  knockoutTodayMatchIds,
  knockoutDayMatchesById,
  openMatchStats,
  shareOwnerName,
  shareOwnerScore,
  existingShareUrl,
  readOnlyShare,
  createHref,
  createLabel,
  onPick,
  onClear,
  onFocusChange,
  onFullscreenChange,
}: {
  matches: DisplayMatch[]
  teamsById: Map<string, Team>
  focusId: string | null
  picks: Record<string, string>
  simulationEnabled: boolean
  standings: Record<string, RankedStandingRow[]>
  groupMatches: GroupMatch[]
  lockedMatchIds: Set<string>
  rewards: BracketRewardSummary
  knockoutTodayMatchIds: Set<string>
  knockoutDayMatchesById: Map<string, DayMatch>
  openMatchStats: (match: GroupMatch) => void
  shareOwnerName: string
  shareOwnerScore?: number | null
  existingShareUrl?: string | null
  readOnlyShare?: boolean
  createHref?: string
  createLabel?: string
  onPick: (matchId: string, teamId: string) => void
  onClear: (matchId: string) => void
  onFocusChange: (teamId: string | null) => void
  onFullscreenChange?: (isFullscreen: boolean) => void
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const fullscreenRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [visualScale, setVisualScale] = useState(1)
  const [lines, setLines] = useState<Array<{ id: string; d: string; active: boolean; tone?: 'correct' }>>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLandscape, setIsLandscape] = useState(() => window.innerWidth >= window.innerHeight)
  const [previewTeamId, setPreviewTeamId] = useState<string | null>(null)
  const [activeMobileRound, setActiveMobileRound] = useState<(typeof mobileRoundTabs)[number]['key']>('L_R32')
  const [isExporting, setIsExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const [shareSheet, setShareSheet] = useState<{ url: string; blob?: Blob } | null>(null)
  const [standingsPopup, setStandingsPopup] = useState<{ teamId: string; x: number; y: number } | null>(null)
  const isFullscreenRef = useRef(false)
  const activeMobileRoundRef = useRef<(typeof mobileRoundTabs)[number]['key']>('L_R32')

  const matchMap = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches])
  const parentLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const template of knockoutTemplates) {
      if (template.home.type === 'winnerOf') {
        lookup.set(template.home.matchId, template.id)
      }
      if (template.away.type === 'winnerOf') {
        lookup.set(template.away.matchId, template.id)
      }
    }
    return lookup
  }, [])
  const allTeams = useMemo(() => {
    const teamIds = new Set<string>()
    for (const match of matches) {
      const homeTeamId = getEntrantTeamId(match.home)
      const awayTeamId = getEntrantTeamId(match.away)
      if (homeTeamId) teamIds.add(homeTeamId)
      if (awayTeamId) teamIds.add(awayTeamId)
    }

    return [...teamIds]
      .map((teamId) => teamsById.get(teamId))
      .filter((team): team is Team => Boolean(team))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [matches, teamsById])
  const focusTeamId = previewTeamId ?? focusId
  const defaultActiveMatchIds = useMemo(() => new Set(['M101', 'M102', 'M103', 'M104'].filter((id) => matchMap.has(id))), [matchMap])
  const activeMatchIds = useMemo(() => {
    if (!focusTeamId) {
      return defaultActiveMatchIds
    }

    const highlighted = new Set<string>()
    for (const match of matches) {
      if ([match.home, match.away].some((entrant) => entrant.kind === 'team' && entrant.teamId === focusTeamId)) {
        highlighted.add(match.id)
      }
    }
    return highlighted
  }, [defaultActiveMatchIds, focusTeamId, matches])
  const activeLineIds = useMemo(() => {
    if (!focusTeamId) {
      return new Set(['M101', 'M102'])
    }

    const highlighted = new Set<string>()
    for (const [childId, parentId] of parentLookup.entries()) {
      if (activeMatchIds.has(childId) && activeMatchIds.has(parentId)) {
        highlighted.add(childId)
      }
    }
    return highlighted
  }, [activeMatchIds, focusTeamId, parentLookup])
  const finalMatch = matchMap.get('M104') ?? null
  const thirdPlaceMatch = matchMap.get('M103') ?? null
  const ownerName = shareOwnerName.trim()
  const ownerHandle = ownerName ? (ownerName.startsWith('@') ? ownerName : '@' + ownerName) : null
  const ownerScore = shareOwnerScore ?? rewards.total
  const championTeam = finalMatch?.winnerId ? teamsById.get(finalMatch.winnerId) ?? null : null
  const finalEntrantIds = finalMatch ? [getEntrantTeamId(finalMatch.home), getEntrantTeamId(finalMatch.away)].filter((teamId): teamId is string => Boolean(teamId)) : []
  const runnerUpTeamId = finalMatch?.winnerId ? finalEntrantIds.find((teamId) => teamId !== finalMatch.winnerId) ?? null : null
  const runnerUpTeam = runnerUpTeamId ? teamsById.get(runnerUpTeamId) ?? null : null
  const thirdPlaceTeam = thirdPlaceMatch?.winnerId ? teamsById.get(thirdPlaceMatch.winnerId) ?? null : null
  useEffect(() => {
    if (!exportFeedback) {
      return
    }

    const timeout = window.setTimeout(() => setExportFeedback(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [exportFeedback])

  useEffect(() => {
    isFullscreenRef.current = isFullscreen
    onFullscreenChange?.(isFullscreen)
  }, [isFullscreen, onFullscreenChange])

  useEffect(() => {
    activeMobileRoundRef.current = activeMobileRound
  }, [activeMobileRound])

  useEffect(() => {
    const handleToggleFullscreen = () => {
      void toggleFullscreen()
    }
    const handleShareRequest = () => {
      void handleShare()
    }
    const handleDownloadRequest = () => {
      void handleDownload()
    }

    window.addEventListener('bracket:toggle-fullscreen', handleToggleFullscreen)
    window.addEventListener('bracket:share', handleShareRequest)
    window.addEventListener('bracket:download', handleDownloadRequest)

    return () => {
      window.removeEventListener('bracket:toggle-fullscreen', handleToggleFullscreen)
      window.removeEventListener('bracket:share', handleShareRequest)
      window.removeEventListener('bracket:download', handleDownloadRequest)
    }
  }, [])

  useEffect(() => {
    const syncViewportState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement === fullscreenRef.current))
      setIsLandscape(window.innerWidth >= window.innerHeight)
    }

    syncViewportState()
    document.addEventListener('fullscreenchange', syncViewportState)
    window.addEventListener('resize', syncViewportState)
    window.addEventListener('orientationchange', syncViewportState)

    return () => {
      document.removeEventListener('fullscreenchange', syncViewportState)
      window.removeEventListener('resize', syncViewportState)
      window.removeEventListener('orientationchange', syncViewportState)
    }
  }, [])

  useEffect(() => {
    const updateGeometry = () => {
      if (!boardRef.current) {
        return
      }

      const nextWidth = Math.ceil(boardRef.current.scrollWidth)
      const nextHeight = Math.ceil(boardRef.current.scrollHeight)
      const viewportWidth = viewportRef.current?.clientWidth ?? 0
      const viewportHeight = viewportRef.current?.clientHeight ?? 0
      const isMobileBracket = window.matchMedia('(max-width: 860px)').matches
      const scaleByWidth = viewportWidth > 0 && nextWidth > 0 ? (viewportWidth - 24) / nextWidth : 1
      const scaleByHeight = viewportHeight > 0 && nextHeight > 0
        ? (viewportHeight - (isFullscreenRef.current ? 40 : 18)) / nextHeight
        : 1
      const maxScale = isFullscreenRef.current ? 1.8 : 1.65
      const nextScale = isMobileBracket ? 1 : Math.min(maxScale, Math.max(0.35, Math.min(scaleByWidth, scaleByHeight)))
      const boardRect = boardRef.current.getBoundingClientRect()
      const safeScale = nextScale || 1
      const nextLines: Array<{ id: string; d: string; active: boolean; tone?: 'correct' }> = []

      setBox({
        width: nextWidth,
        height: nextHeight,
      })
      setVisualScale(nextScale)

      for (const match of matches) {
        const parentId = parentLookup.get(match.id)
        const node = refs.current[match.id]
        const parentNode = parentId ? refs.current[parentId] : null

        if (!node || !parentNode) {
          continue
        }

        const matchRect = node.getBoundingClientRect()
        const parentRect = parentNode.getBoundingClientRect()
        const matchColumn = roundColumns.find((column) => column.ids.includes(match.id))
        const side = matchColumn?.side ?? 'left'
        const x1 = (side === 'right' ? matchRect.left - boardRect.left : matchRect.right - boardRect.left) / safeScale
        const x2 = (side === 'right' ? parentRect.right - boardRect.left : parentRect.left - boardRect.left) / safeScale
        const y1 = (matchRect.top + matchRect.height / 2 - boardRect.top) / safeScale
        const y2 = (parentRect.top + parentRect.height / 2 - boardRect.top) / safeScale

        nextLines.push({
          id: match.id,
          d: buildConnectorPath(x1, y1, x2, y2),
          active: activeLineIds.has(match.id),
          tone: match.predictionState === 'correct' || rewards.comboLinkIds.has(match.id) ? 'correct' : undefined,
        })
      }

      setLines(nextLines)
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateGeometry)
    })

    if (boardRef.current) {
      observer.observe(boardRef.current)
    }
    if (viewportRef.current) {
      observer.observe(viewportRef.current)
    }

    const frame = requestAnimationFrame(updateGeometry)
    const timeout = window.setTimeout(updateGeometry, 90)
    window.addEventListener('resize', updateGeometry)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      window.removeEventListener('resize', updateGeometry)
    }
  }, [activeLineIds, matches, parentLookup, picks, rewards.comboLinkIds])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let tid: ReturnType<typeof window.setTimeout> | null = null

    const handleScroll = () => {
      if (!window.matchMedia('(max-width: 860px)').matches || !viewport.clientWidth) return
      if (tid) window.clearTimeout(tid)
      tid = window.setTimeout(() => {
        const columnWidth = getMobileBracketColumnWidth(viewport)
        const index = Math.max(0, Math.min(roundColumns.length - 1, Math.round(viewport.scrollLeft / columnWidth)))
        const round = mobileRoundForColumnIndex(index)
        if (round !== activeMobileRoundRef.current) {
          activeMobileRoundRef.current = round
          setActiveMobileRound(round)
        }
      }, 70)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      if (tid) window.clearTimeout(tid)
    }
  }, [])

  function handleStandingsHover(teamId: string | null, event: React.MouseEvent | React.FocusEvent) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = 'clientX' in event ? event.clientX : rect.left + rect.width / 2
    const y = 'clientY' in event ? event.clientY : rect.bottom
    if (teamId) setStandingsPopup({ teamId, x, y })
    else setStandingsPopup(null)
  }

  function selectMobileRound(round: (typeof mobileRoundTabs)[number]['key']) {
    setActiveMobileRound(round)
    activeMobileRoundRef.current = round
    const viewport = viewportRef.current
    if (viewport && window.matchMedia('(max-width: 860px)').matches) {
      const columnWidth = getMobileBracketColumnWidth(viewport)
      viewport.scrollTo({ left: mobileRoundColumnIndex[round] * columnWidth, behavior: 'smooth' })
      return
    }
    requestAnimationFrame(() => {
      document.querySelector('.bracket-mobile-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  async function toggleFullscreen() {
    const node = fullscreenRef.current
    if (!node) {
      return
    }

    if (document.fullscreenElement === node) {
      await document.exitFullscreen()
      return
    }

    await node.requestFullscreen()

    const orientation = screen.orientation as (ScreenOrientation & { lock?: (orientation: OrientationLockType) => Promise<void> }) | undefined
    if (orientation?.lock) {
      try {
        await orientation.lock('landscape')
      } catch {
        // iOS Safari and some Android browsers ignore or block orientation lock.
      }
    }
  }

  async function generateBracketBlob() {
    if (!exportRef.current) {
      throw new Error("Zone d'export introuvable.")
    }

    setIsExporting(true)
    exportRef.current.classList.add('is-exporting')

    try {
      const blob = await toBlob(exportRef.current, {
        cacheBust: true,
        skipFonts: true,
        pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
        backgroundColor: '#050b16',
      })

      if (!blob) {
        throw new Error("La generation de l'image a echoue.")
      }

      return blob
    } finally {
      exportRef.current.classList.remove('is-exporting')
      setIsExporting(false)
    }
  }

  function getBracketFileName() {
    const homeTeamId = finalMatch ? getEntrantTeamId(finalMatch.home) : null
    const awayTeamId = finalMatch ? getEntrantTeamId(finalMatch.away) : null
    const homeTeam = homeTeamId ? teamsById.get(homeTeamId) : null
    const awayTeam = awayTeamId ? teamsById.get(awayTeamId) : null

    if (homeTeam && awayTeam) {
      return `fifa-bracket-${normalizeFilePart(homeTeam.name)}-vs-${normalizeFilePart(awayTeam.name)}.png`
    }

    const date = new Date().toISOString().slice(0, 10)
    return `fifa-bracket-${date}.png`
  }

  function downloadGeneratedBlob(blob: Blob) {
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = getBracketFileName()
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }


function getShareText(url: string) {
    return `${shareOwnerName || 'Brakup'} partage son bracket Coupe du Monde 2026: ${url}`
  }

  async function handleNativePreparedShare() {
    if (!shareSheet) return
    const file = shareSheet.blob ? new File([shareSheet.blob], getBracketFileName(), { type: 'image/png' }) : null
    const payload = {
      title: 'FIFA Bracket',
      text: getShareText(shareSheet.url),
      url: shareSheet.url,
      ...(file && navigator.canShare?.({ files: [file] }) ? { files: [file] } : {}),
    }

    if (!navigator.share) {
      await navigator.clipboard?.writeText(shareSheet.url)
      setExportFeedback('Lien copie.')
      return
    }

    await navigator.share(payload)
    setExportFeedback('Partage lance.')
  }

  async function copyPreparedShareLink() {
    if (!shareSheet) return
    await navigator.clipboard.writeText(shareSheet.url)
    setExportFeedback('Lien copie.')
  }

  function openWhatsAppShare() {
    if (!shareSheet) return
    window.open(`https://wa.me/?text=${encodeURIComponent(getShareText(shareSheet.url))}`, '_blank', 'noopener,noreferrer')
  }

  function openMailShare() {
    if (!shareSheet) return
    const subject = encodeURIComponent('Mon bracket Coupe du Monde 2026')
    const body = encodeURIComponent(getShareText(shareSheet.url))
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  async function handleDownload() {
    try {
      setExportFeedback("Generation de l'image...")
      const blob = await generateBracketBlob()
      downloadGeneratedBlob(blob)
      setExportFeedback('Image telechargee.')
    } catch (error) {
      console.error('Bracket image download failed:', error)
      setExportFeedback("Impossible de generer l'image pour le moment.")
    }
  }

  async function handleShare() {
    try {
      const publicUrl = existingShareUrl ?? (shareOwnerName.trim() ? `${window.location.origin}/@${encodeURIComponent(shareOwnerName.trim())}` : null)
      if (!publicUrl) {
        setExportFeedback('Connecte-toi pour obtenir un lien de partage.')
        return
      }

      setExportFeedback('Preparation du partage...')
      let blob: Blob | undefined
      try {
        blob = await generateBracketBlob()
      } catch (imageError) {
        console.warn('Bracket image share fallback:', imageError)
      }
      setShareSheet({ url: publicUrl, blob })
      setExportFeedback(blob ? 'Image et lien prets.' : 'Lien de partage pret.')
    } catch (error) {
      console.error('Bracket link share failed:', error)
      setExportFeedback("Impossible de preparer le partage pour le moment.")
    }
  }

  return (
    <div className={`bracket-shell${isFullscreen ? ' is-fullscreen' : ''}`} ref={fullscreenRef}>
      <div className="bracket-shell__toolbar">
        <div className="bracket-shell__copy">
          <div className="bracket-shell__title">Tableau final</div>
          <div className="bracket-shell__hint">
            {focusTeamId ? `Parcours mis en avant: ${teamsById.get(focusTeamId)?.name ?? 'Equipe'}` : null}
          </div>
        </div>

        <div className="bracket-toolbar">
          <TeamFocusMenu teams={allTeams} focusId={focusId} onFocusChange={onFocusChange} />

          {focusId ? (
            <button type="button" className="chip-btn chip-btn--sm" onClick={() => onFocusChange(null)}>
              Reinitialiser le focus
            </button>
          ) : null}

          <button type="button" className="chip-btn chip-btn--sm" disabled={isExporting} onClick={() => void handleShare()}>
            {isExporting ? "Generation de l'image..." : 'Partager'}
          </button>

          <button type="button" className="chip-btn chip-btn--sm" disabled={isExporting} onClick={() => void handleDownload()}>
            {isExporting ? "Generation de l'image..." : 'Telecharger'}
          </button>

          <button type="button" className="chip-btn chip-btn--sm bracket-shell__fullscreen" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? 'Quitter plein ecran' : 'Plein ecran'}
          </button>
        </div>
      </div>

      {exportFeedback ? <div className="bracket-shell__feedback">{exportFeedback}</div> : null}

      {shareSheet ? (
        <div className="bracket-share-sheet" role="dialog" aria-modal="true" aria-label="Partager le bracket">
          <button type="button" className="bracket-share-sheet__scrim" aria-label="Fermer" onClick={() => setShareSheet(null)} />
          <div className="bracket-share-sheet__panel">
            <div className="bracket-share-sheet__head">
              <strong>Partager le bracket</strong>
              <button type="button" onClick={() => setShareSheet(null)} aria-label="Fermer">x</button>
            </div>
            <div className="bracket-share-sheet__url">{shareSheet.url}</div>
            <div className="bracket-share-sheet__actions">
              <button type="button" onClick={() => void handleNativePreparedShare()}><span>N</span> Partage natif</button>
              <button type="button" onClick={openWhatsAppShare}><span>WA</span> WhatsApp</button>
              <button type="button" onClick={openMailShare}><span>@</span> Email</button>
              <button type="button" onClick={() => void copyPreparedShareLink()}><span>CL</span> Copier lien</button>
              {shareSheet.blob ? <button type="button" onClick={() => downloadGeneratedBlob(shareSheet.blob!)}><span>DL</span> PNG</button> : null}
            </div>
          </div>
        </div>
      ) : null}

      {isFullscreen && !isLandscape ? (
        <div className="bracket-rotate">
          <div className="bracket-rotate__icon" aria-hidden="true">R</div>
          <div className="bracket-rotate__title">Passe en paysage</div>
          <p>Le bracket complet est plus lisible en mode horizontal pendant le plein ecran.</p>
        </div>
      ) : null}

      <div className="bracket-mobile-shell">
        {readOnlyShare && ownerHandle ? (
          <div className="bracket-mobile-sharebar">
            <div className="bracket-mobile-sharebar__identity" aria-label={`Bracket de ${shareOwnerName}`}>
              <strong>{ownerHandle}</strong>
              <span>{ownerScore} pts</span>
            </div>
            <a
              href={createHref ?? '/?simulator'}
              className={`bracket-mobile-sharebar__action${createLabel?.startsWith('RETOUR') ? ' is-home' : ''}`}
              aria-label={createLabel?.startsWith('RETOUR') ? 'Retour a mon bracket' : 'Creer mon bracket'}
            >
              {createLabel?.startsWith('RETOUR') ? <span aria-hidden="true" className="bracket-mobile-sharebar__home-icon">⌂</span> : createLabel ?? 'CREER MON BRACKET'}
            </a>
          </div>
        ) : null}

        <div className="bracket-mobile-tabs" role="tablist" aria-label="Rounds du bracket">
          {mobileRoundTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeMobileRound === tab.key}
              className={`bracket-mobile-tab${activeMobileRound === tab.key ? ' is-active' : ''}`}
              onClick={() => selectMobileRound(tab.key)}
            >
              {formatStageShortLabel(tab.stage, getCurrentLocale())}
            </button>
          ))}
        </div>

      </div>

      <div className="bracket-challenge-mobile">
        <BracketChallenge
          matches={matches}
          teamsById={teamsById}
          picks={picks}
          onPick={(matchId, teamId) => teamId ? onPick(matchId, teamId) : onClear(matchId)}
          onPlay={onPick}
          readOnly={readOnlyShare || !simulationEnabled}
          ownerPseudo={ownerName || undefined}
          showScorePanel={false}
          locale={getCurrentLocale()}
        />
      </div>

      <div className="bracket-fit" ref={viewportRef}>
        <div className="bracket-fit__stage" style={{ height: box.height ? Math.ceil(box.height * visualScale) + 8 : undefined }}>
          <div
            className="bracket-fit__transform"
            style={{
              width: box.width || undefined,
              transform: Math.abs(visualScale - 1) > 0.001 ? `scale(${visualScale})` : undefined,
            }}
          >
            <div className={`bracket-export-wrapper${isExporting ? ' is-exporting' : ''}`} ref={exportRef}>
              <div className={`bracket-board${readOnlyShare ? ' is-readonly-share' : ''}`} ref={boardRef}>
                {ownerHandle ? (
                  <div className="bracket-owner-badge" aria-label={`Bracket de ${shareOwnerName}`}>
                    <strong>{ownerHandle}</strong>
                    <span className="bracket-owner-badge__score">{ownerScore} pts</span>
                  </div>
                ) : null}
            <svg className="bracket__links" width={box.width} height={box.height} aria-hidden="true">
              {lines.map((line) => (
                <path key={line.id} d={line.d} className={['link', line.active ? 'link--lit' : '', line.tone === 'correct' ? 'link--gold' : ''].filter(Boolean).join(' ')} />
              ))}
            </svg>

            {roundColumns.map((column) => (
              <div key={column.key} className={`bcol bcol--${column.side}`}>
                <div className="bcol__label">{formatStageLabel(column.stage)}</div>
                <div className="bcol__matches">
                  {column.side === 'center' ? (
                    <div className="finalwrap">
                      {column.ids.map((id) => {
                        const match = matchMap.get(id)
                        if (!match) return null

                        return (
                          <div key={match.id} className="bracket-final">
                            {match.id === 'M103' ? (
                              <div className="finale__challenge-mark">
                                <img src="/brakup-challenge-logo.png" alt="Brakup Challenge" className="finale__challenge-logo" />
                                <a href={readOnlyShare ? createHref ?? '/?simulator' : localizedChallengeHref(getCurrentLocale())} className="finale__challenge-play">
                                  {readOnlyShare ? createLabel ?? 'CREER MON BRACKET' : 'JOUER'}
                                </a>
                              </div>
                            ) : null}
                            <MatchCard
                              match={match}
                              teamsById={teamsById}
                              side="center"
                              simulationEnabled={simulationEnabled}
                              isActive={activeMatchIds.has(match.id)}
                              isDimmed={Boolean(focusTeamId) && !activeMatchIds.has(match.id)}
                              isFinalCard={match.id === 'M104'}
                              isLocked={lockedMatchIds.has(match.id)}
                              pickBadgeLabel={readOnlyShare ? 'SON PICK' : 'MON PICK'}
                              reward={rewards.rewardsByMatch.get(match.id)}
                              isToday={knockoutTodayMatchIds.has(match.id)}
                onOpenDetails={knockoutDayMatchesById.has(match.id) ? () => void openMatchStats(knockoutDayMatchesById.get(match.id)!) : undefined}
                focusId={focusId}
                              registerRef={(node) => {
                                refs.current[match.id] = node
                              }}
                              onPick={onPick}
                              onClear={onClear}
                              onPreview={setPreviewTeamId}
                              onStandingsHover={handleStandingsHover}
                            />
                            <div className="finale__caption">
                              {match.id === 'M103'
                                ? `3E PLACE / ${formatKnockoutDateTime(match.id, match.dateLabel)}`
                                : `FINALE / ${formatKnockoutDateTime(match.id, match.dateLabel)}`}
                            </div>
                          </div>
                        )
                      })}

                      <div className={`champ${championTeam ? ' is-set' : ''}`}>
                        <div className="champ__eyebrow">Champion</div>
                        {championTeam ? (
                          <>
                            {flagUrl(championTeam) ? (
                              <img src={flagUrl(championTeam)} alt="" className="champ__flag-image" crossOrigin="anonymous" />
                            ) : (
                              <div className="champ__flag">{championTeam.flagEmoji}</div>
                            )}
                            <div className="champ__name">{championTeam.name}</div>
                            <div className="champ__cap">Le trophee prend forme ici</div>
                            {runnerUpTeam || thirdPlaceTeam ? (
                              <div className="champ__podium">
                                {runnerUpTeam ? (
                                  <div className="champ__podium-item champ__podium-item--silver">
                                    <span className="champ__podium-rank">2E</span>
                                    {flagUrl(runnerUpTeam) ? (
                                      <img src={flagUrl(runnerUpTeam)} alt="" className="champ__podium-flag" crossOrigin="anonymous" />
                                    ) : (
                                      <span className="champ__podium-emoji">{runnerUpTeam.flagEmoji}</span>
                                    )}
                                    <span className="champ__podium-name">{runnerUpTeam.shortName || runnerUpTeam.name}</span>
                                  </div>
                                ) : null}
                                {thirdPlaceTeam ? (
                                  <div className="champ__podium-item champ__podium-item--bronze">
                                    <span className="champ__podium-rank">3E</span>
                                    {flagUrl(thirdPlaceTeam) ? (
                                      <img src={flagUrl(thirdPlaceTeam)} alt="" className="champ__podium-flag" crossOrigin="anonymous" />
                                    ) : (
                                      <span className="champ__podium-emoji">{thirdPlaceTeam.flagEmoji}</span>
                                    )}
                                    <span className="champ__podium-name">{thirdPlaceTeam.shortName || thirdPlaceTeam.name}</span>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="champ__trophy">CUP</div>
                            <div className="champ__cap champ__cap--tbd">Le champion s'affiche ici</div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    column.ids.map((id) => {
                      const match = matchMap.get(id)
                      if (!match) return null

                      return (
                        <MatchCard
                          key={match.id}
                          match={match}
                          teamsById={teamsById}
                          side={column.side}
                          simulationEnabled={simulationEnabled}
                          isActive={activeMatchIds.has(match.id)}
                          isDimmed={Boolean(focusTeamId) && !activeMatchIds.has(match.id)}
                          isFinalCard={false}
                          isLocked={lockedMatchIds.has(match.id)}
                          pickBadgeLabel={readOnlyShare ? 'SON PICK' : 'MON PICK'}
                          reward={rewards.rewardsByMatch.get(match.id)}
                          isToday={knockoutTodayMatchIds.has(match.id)}
                onOpenDetails={knockoutDayMatchesById.has(match.id) ? () => void openMatchStats(knockoutDayMatchesById.get(match.id)!) : undefined}
                focusId={focusId}
                          registerRef={(node) => {
                            refs.current[match.id] = node
                          }}
                          onPick={onPick}
                          onClear={onClear}
                          onPreview={setPreviewTeamId}
                          onStandingsHover={handleStandingsHover}
                        />
                      )
                    })
                  )}
                </div>
              </div>
            ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {standingsPopup && (() => {
        const popupTeam = teamsById.get(standingsPopup.teamId)
        if (!popupTeam) return null
        const groupRows = standings[popupTeam.groupId] ?? []
        const teamRow = groupRows.find((r) => r.teamId === standingsPopup.teamId)
        if (!teamRow) return null
        const recentMatches = groupMatches
          .filter((match) => match.homeTeamId === popupTeam.id || match.awayTeamId === popupTeam.id)
          .filter((match) => match.homeScore !== null && match.awayScore !== null)
          .sort((a, b) => (b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`).localeCompare(a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`))
          .slice(0, 4)
        const popupX = Math.min(standingsPopup.x + 12, window.innerWidth - 300)
        const popupY = Math.min(standingsPopup.y - 8, window.innerHeight - 340)
        return (
          <div
            className="standings-popup"
            style={{ left: popupX, top: popupY }}
            onMouseLeave={() => setStandingsPopup(null)}
          >
            <div className="standings-popup__header">
              {flagUrl(popupTeam)
                ? <img src={flagUrl(popupTeam)} alt="" className="standings-popup__flag" crossOrigin="anonymous" />
                : <span className="standings-popup__emoji">{popupTeam.flagEmoji}</span>
              }
              <span className="standings-popup__name">{popupTeam.name}</span>
              <span className="standings-popup__group">Grp {popupTeam.groupId}</span>
            </div>
            {recentMatches.length ? (
              <div className="standings-popup__recent" aria-label="Derniers matchs">
                <div className="standings-popup__recent-title">Derniers matchs</div>
                {recentMatches.map((match) => {
                  const homeTeam = teamsById.get(match.homeTeamId)
                  const awayTeam = teamsById.get(match.awayTeamId)
                  if (!homeTeam || !awayTeam) return null
                  const homeWin = match.homeScore !== null && match.awayScore !== null && match.homeScore > match.awayScore
                  const awayWin = match.homeScore !== null && match.awayScore !== null && match.awayScore > match.homeScore
                  return (
                    <div key={match.id} className="standings-popup__match">
                      {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="standings-popup__mini-flag" crossOrigin="anonymous" /> : <span className="standings-popup__mini-emoji">{homeTeam.flagEmoji}</span>}
                      <span className={`standings-popup__match-team${homeWin ? ' is-winner' : ''}`}>{homeTeam.shortName || homeTeam.name}</span>
                      <strong className="standings-popup__score">
                        <span className={homeWin ? 'is-winner' : awayWin ? 'is-loser' : ''}>{match.homeScore}</span>
                        <i>:</i>
                        <span className={awayWin ? 'is-winner' : homeWin ? 'is-loser' : ''}>{match.awayScore}</span>
                      </strong>
                      <span className={`standings-popup__match-team standings-popup__match-team--away${awayWin ? ' is-winner' : ''}`}>{awayTeam.shortName || awayTeam.name}</span>
                      {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="standings-popup__mini-flag" crossOrigin="anonymous" /> : <span className="standings-popup__mini-emoji">{awayTeam.flagEmoji}</span>}
                    </div>
                  )
                })}
              </div>
            ) : null}
            <table className="standings-popup__table">
              <thead>
                <tr>
                  <th>Equipe</th><th>J</th><th>G</th><th>N</th><th>P</th><th>+/-</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => {
                  const rowTeam = teamsById.get(row.teamId)
                  return (
                    <tr key={row.teamId} className={row.teamId === standingsPopup.teamId ? 'standings-popup__row--highlight' : ''}>
                      <td>{row.rank}. {rowTeam?.shortName ?? row.teamId}</td>
                      <td>{row.played}</td>
                      <td>{row.wins}</td>
                      <td>{row.draws}</td>
                      <td>{row.losses}</td>
                      <td>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td>
                      <td className="standings-popup__pts">{row.points}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}

function FormDots({ form, align = 'left' }: { form: string; align?: 'left' | 'right' }) {
  const chars = form.toUpperCase().split('').filter((c) => 'WDL'.includes(c)).slice(-5)
  return (
    <div className={`formdots formdots--${align}`}>
      {chars.map((c, i) => (
        <span key={i} className={`formdot formdot--${c === 'W' ? 'win' : c === 'D' ? 'draw' : 'loss'}`} title={c === 'W' ? 'Victoire' : c === 'D' ? 'Nul' : 'Défaite'} />
      ))}
    </div>
  )
}

function App() {
  const locale = useAppI18n()
  const [seed, setSeed] = useState<TournamentSeed | null>(null)
  const [liveSource, setLiveSource] = useState<LiveState>({
    syncedAt: null,
    source: 'seed',
    warnings: [],
    matches: [],
    standings: [],
    predictions: [],
  })
  const [mode, setMode] = useState<Mode>('simulation')
  const simulatorMode = useMemo(() => new URLSearchParams(window.location.search).has('simulator'), [])
  const challengeMode = useMemo(() => isChallengeRoute(), [])
  const challengeBoardMode = useMemo(() => new URLSearchParams(window.location.search).has('board'), [])
  const adminMode = useMemo(() => window.location.pathname === '/admin', [])
  const sharedBracketId = useMemo(() => readShareIdFromLocation(), [])
  const cloneShareId = useMemo(() => new URLSearchParams(window.location.search).get('cloneShare'), [])
  const publicPseudo = useMemo(() => readPublicPseudoFromLocation(), [])
  const forceNewSimulator = useMemo(() => new URLSearchParams(window.location.search).has('new'), [])
  const sharedBracketLoadId = sharedBracketId ?? cloneShareId
  const view = 'bracket' as View

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('challenge')) return
    params.delete('challenge')
    const query = params.toString()
    window.history.replaceState({}, '', `${localizedChallengeHref(locale)}${query ? `?${query}` : ''}${window.location.hash}`)
  }, [locale])

  const [overrides, setOverrides] = useState<Record<string, MatchOverride>>({})
  const [knockoutPicks, setKnockoutPicks] = useState<Record<string, string>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [isCompactGroups, setIsCompactGroups] = useState(() => window.innerWidth <= 680)
  const [selectedGroupId, setSelectedGroupId] = useState('A')
  const [showDayModal, setShowDayModal] = useState(false)
  const [initialDayModalLoading, setInitialDayModalLoading] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState(() => localDateStr())
  const [headerBracketMenuOpen, setHeaderBracketMenuOpen] = useState(false)
  const [isBracketFullscreen, setIsBracketFullscreen] = useState(false)
  const [sidePanel, setSidePanel] = useState<'brackets' | 'scorers' | 'groups' | 'results' | null>(null)
  const [matchModalGroupId, setMatchModalGroupId] = useState<string | null>(null)
  const [matchStatsModal, setMatchStatsModal] = useState<{ match: GroupMatch; homeTeam: Team; awayTeam: Team } | null>(null)
  const [matchStatsData, setMatchStatsData] = useState<MatchEventsData | null>(null)
  const [matchStatsLoading, setMatchStatsLoading] = useState(false)
  const [oddsData, setOddsData] = useState<OddsSnapshot | null>(null)
  const [sharedBracket, setSharedBracket] = useState<PublicBracketShare | null>(null)
  const [publicSimulatorBracket, setPublicSimulatorBracket] = useState<SimulatorBracketEntry | null>(null)
  const [challengeToken, setChallengeToken] = useState<string | null>(() => window.localStorage.getItem(challengeTokenStorageKey))
  const [challengeProfile, setChallengeProfile] = useState<ChallengeProfile>(readStoredChallengeProfile)
  const [showChallengeLoginEntry, setShowChallengeLoginEntry] = useState(false)
  const [challengeLoginBusy, setChallengeLoginBusy] = useState(false)
  const [challengeLoginError, setChallengeLoginError] = useState<string | null>(null)
  const [challengeLoginSent, setChallengeLoginSent] = useState(false)
  const [challengeLoginEmail, setChallengeLoginEmail] = useState<string | null>(null)
  const [challengeMenuOpen, setChallengeMenuOpen] = useState(false)
  const [classicProfileSettingsOpen, setClassicProfileSettingsOpen] = useState(false)
  const [classicProfileStatus, setClassicProfileStatus] = useState<Awaited<ReturnType<typeof getProfileStatus>> | null>(null)
  const [classicProfileBusy, setClassicProfileBusy] = useState(false)
  const [classicProfileError, setClassicProfileError] = useState<string | null>(null)
  const [completeBonusNoticeOpen, setCompleteBonusNoticeOpen] = useState(false)
  const [, setSimulatorOutcomeSeenVersion] = useState(0)
  const [publicBrackets, setPublicBrackets] = useState<SimulatorBracketEntry[]>([])
  const [publicBracketsLoading, setPublicBracketsLoading] = useState(false)
  const [publicBracketsLoaded, setPublicBracketsLoaded] = useState(false)
  const [publicBracketsError, setPublicBracketsError] = useState<string | null>(null)
  const [viewedPublicBracket, setViewedPublicBracket] = useState<SimulatorBracketEntry | null>(null)
  const [classicViewedChallengeEntry, setClassicViewedChallengeEntry] = useState<ChallengeEntry | null>(null)
  const simulatorRemoteHydratedRef = useRef(false)
  const simulatorSaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return subscribeChallengeProfile((profile) => {
      setChallengeProfile({
        email: profile.email,
        pseudo: profile.pseudo,
        bracketName: profile.bracketName,
      })
    })
  }, [])

  useEffect(() => {
    initAnalytics(adminMode ? 'admin' : challengeMode ? 'challenge' : challengeBoardMode ? 'challenge-board' : 'main')
    trackAnalytics('route_ready', {
      challengeMode,
      challengeBoardMode,
      simulatorMode,
      adminMode,
      publicPseudo: Boolean(publicPseudo),
      sharedBracket: Boolean(sharedBracketId),
    })
  }, [adminMode, challengeBoardMode, challengeMode, publicPseudo, sharedBracketId, simulatorMode])
  const initialSyncBaselineRef = useRef<string | null>(null)
  const previousCompleteBonusRef = useRef(0)
  const completeBonusArmedRef = useRef(false)
  const challengeLoginFlowRef = useRef<'existing' | 'new'>('existing')
  const challengeLoginPseudoRef = useRef('')

  const autosaveRewards = useMemo(() => {
    if (!seed) return { total: 0, completeBonus: 0, scoreBreakdown: {} as NonNullable<SimulatorBracketEntry['scoreBreakdown']> }
    const localTeamsById = new Map(seed.teams.map((team) => [team.id, team]))
    const localMergedMatches = mergeScores(seed.matches, liveSource.matches, overrides, mode)
    const localStandings = computeStandings(seed.teams, localMergedMatches)
    const localGroupBracket = buildKnockoutBracket(localStandings, localMergedMatches)
    const localWinnerCodes = new Map(liveSource.matches.flatMap((match) => match.winnerTeamCode ? [[match.id, match.winnerTeamCode] as const] : []))
    const localDisplayBracket = resolveDisplayBracket(localGroupBracket, knockoutPicks, localWinnerCodes, localTeamsById)
    const rewards = calculateBracketRewards(localDisplayBracket)
    return {
      total: rewards.total,
      completeBonus: rewards.completeBonus,
      scoreBreakdown: Object.fromEntries([...rewards.rewardsByMatch.entries()].map(([matchId, reward]) => [matchId, { points: reward.points, label: reward.label, correct: reward.correct, combo: reward.combo }])),
    }
  }, [knockoutPicks, liveSource.matches, mode, overrides, seed])

  useEffect(() => {
    const previous = previousCompleteBonusRef.current
    const isReadOnlyContext = Boolean(publicPseudo || sharedBracketLoadId || viewedPublicBracket)
    if (autosaveRewards.completeBonus > 0 && completeBonusArmedRef.current && !isReadOnlyContext) {
      setCompleteBonusNoticeOpen(true)
      completeBonusArmedRef.current = false
    }
    if (previous > 0 && autosaveRewards.completeBonus === 0) {
      setCompleteBonusNoticeOpen(false)
    }
    previousCompleteBonusRef.current = autosaveRewards.completeBonus
  }, [autosaveRewards.completeBonus, publicPseudo, sharedBracketLoadId, viewedPublicBracket])

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        // Load seed + static snapshot in parallel — show UI immediately
        const [seedData, staticSnapshot] = await Promise.all([
          loadSeed(),
          loadLiveSnapshot(),
        ])

        if (!active) return

        setSeed(seedData)
        if (publicPseudo) {
          const publicEntry = await getSimulatorBracketByPseudo(publicPseudo)
          if (!active) return
          setPublicSimulatorBracket(publicEntry)
          setOverrides(publicEntry?.overrides ?? {})
          setKnockoutPicks(publicEntry?.knockoutPicks ?? {})
          setFocusId(null)
          setMode('simulation')
        } else if (sharedBracketLoadId) {
          const share = await getPublicBracketShare(sharedBracketLoadId)
          if (!active) return
          setSharedBracket(share)
          setOverrides(share.overrides)
          setKnockoutPicks(share.knockoutPicks)
          setFocusId(null)
          setMode('simulation')
        } else if (forceNewSimulator) {
          clearStoredSimulation()
          setOverrides({})
          setKnockoutPicks({})
          setMode('simulation')
        } else {
          const storedSimulation = readStoredSimulation()
          const challengeDraftPicks = readChallengeDraftPicks()
          if (storedSimulation) {
            setOverrides(storedSimulation.overrides)
            setKnockoutPicks({ ...challengeDraftPicks, ...storedSimulation.knockoutPicks })
            if (
              Object.keys(storedSimulation.overrides).length > 0 ||
              Object.keys(storedSimulation.knockoutPicks).length > 0 ||
              Object.keys(challengeDraftPicks).length > 0
            ) {
              setMode('simulation')
            }
          } else if (Object.keys(challengeDraftPicks).length > 0) {
            setKnockoutPicks(challengeDraftPicks)
            setMode('simulation')
          }
        }

        // Show static data right away — UI is usable instantly
        if (staticSnapshot) {
          setLiveSource({
            syncedAt: staticSnapshot.syncedAt,
            source: staticSnapshot.source,
            warnings: staticSnapshot.warnings,
            matches: staticSnapshot.matches,
            standings: staticSnapshot.standings,
            predictions: staticSnapshot.predictions ?? [],
            topScorers: staticSnapshot.topScorers,
          })
        }
        setLoading(false)
        setInitialDayModalLoading(true)
        initialSyncBaselineRef.current = staticSnapshot?.syncedAt ?? null

        // Then fetch fresh scores from FIFA.com in background
        requestLiveSync().then((liveSnapshot) => {
          if (!active) return
          setLiveSource((current) => mergeLiveSnapshot(current, liveSnapshot))
        }).catch(() => {
          // Sync failed — static data already shown, nothing to do
        })

        // Fetch odds in background (cached 2h at CDN edge)
        fetchOdds().then((odds) => {
          if (!active || !odds) return
          setOddsData(odds)
        }).catch(() => {})

      } catch (caughtError) {
        if (!active) return
        setError(caughtError instanceof Error ? caughtError.message : 'Chargement impossible.')
        setLoading(false)
      }
    }

    bootstrap()
    return () => {
      active = false
    }
  }, [forceNewSimulator, publicPseudo, sharedBracketLoadId])

  useEffect(() => {
    if (sharedBracketId || publicPseudo) return
    if (Object.keys(overrides).length === 0 && Object.keys(knockoutPicks).length === 0) {
      clearStoredSimulation()
      return
    }

    writeStoredSimulation({
      overrides,
      knockoutPicks,
    })
    writeChallengeDraftPicks(knockoutPicks)
  }, [overrides, knockoutPicks])

  useEffect(() => {
    let cancelled = false
    simulatorRemoteHydratedRef.current = false

    if (forceNewSimulator || publicPseudo || sharedBracketLoadId) {
      simulatorRemoteHydratedRef.current = true
      return
    }

    if (!challengeToken) {
      simulatorRemoteHydratedRef.current = true
      return
    }

    window.localStorage.setItem(challengeTokenStorageKey, challengeToken)
    Promise.all([
      getProfileStatus(challengeToken).catch(() => null),
      getSimulatorBracket(challengeToken).catch(() => null),
    ]).then(([status, simulatorEntry]) => {
      if (cancelled) return

      if (status?.pseudo || simulatorEntry?.pseudo || simulatorEntry?.bracketName) {
        setChallengeProfile((current) => {
          const next = {
            email: current.email,
            pseudo: simulatorEntry?.pseudo || status?.pseudo || current.pseudo,
            bracketName: simulatorEntry?.bracketName || current.bracketName || 'Mon bracket',
          }
          rememberChallengeProfile(next)
          return next
        })
      }

      if (simulatorEntry) {
        setOverrides(simulatorEntry.overrides ?? {})
        setKnockoutPicks({ ...(simulatorEntry.knockoutPicks ?? {}), ...readChallengeDraftPicks() })
        setMode('simulation')
      }

      window.localStorage.setItem(challengeHadAccountStorageKey, 'true')
    }).catch(() => undefined).finally(() => {
      if (!cancelled) {
        simulatorRemoteHydratedRef.current = true
      }
    })

    return () => {
      cancelled = true
    }
  }, [challengeToken, forceNewSimulator, publicPseudo, sharedBracketLoadId])

  useEffect(() => {
    if (sharedBracketId || publicPseudo || !challengeToken || !simulatorRemoteHydratedRef.current || !challengeProfile.pseudo) {
      return
    }

    if (Object.keys(overrides).length === 0 && Object.keys(knockoutPicks).length === 0) {
      return
    }

    if (simulatorSaveTimerRef.current !== null) {
      window.clearTimeout(simulatorSaveTimerRef.current)
    }

    simulatorSaveTimerRef.current = window.setTimeout(() => {
      void saveSimulatorBracket(challengeToken, {
        pseudo: challengeProfile.pseudo,
        bracketName: challengeProfile.bracketName || 'Simulator accueil',
        overrides,
        knockoutPicks,
        score: autosaveRewards.total,
        scoreBreakdown: autosaveRewards.scoreBreakdown,
        completeBonus: autosaveRewards.completeBonus,
      }).catch(() => undefined)
    }, 500)

    return () => {
      if (Object.keys(overrides).length === 0 && Object.keys(knockoutPicks).length === 0) {
      return
    }

    if (simulatorSaveTimerRef.current !== null) {
        window.clearTimeout(simulatorSaveTimerRef.current)
        simulatorSaveTimerRef.current = null
      }
    }
  }, [autosaveRewards.completeBonus, autosaveRewards.scoreBreakdown, autosaveRewards.total, challengeProfile.bracketName, challengeProfile.pseudo, challengeToken, knockoutPicks, overrides, publicPseudo, sharedBracketId])

  useEffect(() => {
    const syncViewport = () => {
      setIsCompactGroups(window.innerWidth <= 680)
    }

    syncViewport()
    window.addEventListener('resize', syncViewport)
    return () => window.removeEventListener('resize', syncViewport)
  }, [])

  useEffect(() => {
    if (sidePanel !== 'brackets' || publicBracketsLoaded) {
      return
    }

    let cancelled = false
    let settled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled || settled) return
      settled = true
      setPublicBracketsError('Chargement trop long. Reessaie dans quelques secondes.')
      setPublicBracketsLoaded(true)
      setPublicBracketsLoading(false)
    }, 6000)

    setPublicBracketsLoading(true)
    setPublicBracketsError(null)
    getSimulatorLeaderboard()
      .then((entries) => {
        if (!cancelled && !settled) setPublicBrackets(entries)
      })
      .catch((caught) => {
        if (!cancelled && !settled) setPublicBracketsError(caught instanceof Error ? caught.message : 'Brackets communaute indisponibles.')
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (!cancelled && !settled) {
          settled = true
          setPublicBracketsLoaded(true)
          setPublicBracketsLoading(false)
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [publicBracketsLoaded, sidePanel])

  useEffect(() => {
    if (!initialDayModalLoading) {
      return
    }

    if (liveSource.syncedAt && liveSource.syncedAt !== initialSyncBaselineRef.current) {
      setInitialDayModalLoading(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setInitialDayModalLoading(false)
    }, 8000)

    return () => window.clearTimeout(timeoutId)
  }, [initialDayModalLoading, liveSource.syncedAt])

  useEffect(() => {
    if (challengeMode) return
    if (!showDayModal && !matchModalGroupId && !matchStatsModal) return

    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [challengeMode, showDayModal, matchModalGroupId, matchStatsModal])

  // Silent background sync — no spinner, no error banner
  const silentSyncRef = useRef<() => void>(() => {})
  useEffect(() => {
    silentSyncRef.current = async () => {
      try {
        const snapshot = await requestLiveSync()
        setLiveSource((current) => mergeLiveSnapshot(current, snapshot))
      } catch {
        // network hiccup — keep current data
      }
    }
  })

  // Compute how often to poll based on match schedule
  const pollingInterval = useMemo(() => {
    if (!seed) return null
    const now = Date.now()

    // Any live match → poll every 20s (Jina latency ~2-3s, avoid overlap)
    if (liveSource.matches.some((m) => m.status === 'live' || isLiveNow(m.kickoffIso))) return 20_000

    // Find closest upcoming kickoff (from live snapshot which has kickoffIso)
    const msToNext = liveSource.matches
      .filter((m) => m.kickoffIso && m.status === 'scheduled')
      .map((m) => new Date(m.kickoffIso!).getTime() - now)
      .filter((d) => d > 0)
      .sort((a, b) => a - b)[0]

    if (msToNext !== undefined) {
      if (msToNext < 15 * 60_000)  return 60_000        // < 15 min → 1 min
      if (msToNext < 2 * 3600_000) return 2 * 60_000    // < 2h    → 2 min
    }

    // Match day but nothing imminent → 5 min
    if (liveSource.matches.some((match) => {
      const seedMatch = seed.matches.find((candidate) => candidate.id === match.id)
      return seedMatch ? isMatchToday({ ...seedMatch, kickoffIso: match.kickoffIso }) : false
    })) return 5 * 60_000

    return null // no relevant match → no polling
  }, [seed, liveSource.matches])

  // Start / restart polling whenever the interval changes
  useEffect(() => {
    if (!pollingInterval) return
    const id = setInterval(() => silentSyncRef.current(), pollingInterval)
    return () => clearInterval(id)
  }, [pollingInterval])

  // Tick every 30s to keep live-minute display fresh between polls
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (view !== 'bracket') {
      setSidePanel(null)
      setHeaderBracketMenuOpen(false)
      setIsBracketFullscreen(false)
    }
  }, [view])

  useEffect(() => {
    if (isBracketFullscreen) {
      setHeaderBracketMenuOpen(false)
      setChallengeMenuOpen(false)
    }
  }, [isBracketFullscreen])

  useEffect(() => {
    if (!classicProfileSettingsOpen || !challengeToken) return
    getProfileStatus(challengeToken).then((status) => {
      setClassicProfileStatus(status)
      setClassicProfileError(null)
    }).catch((caught) => {
      setClassicProfileError(caught instanceof Error ? caught.message : 'Statut indisponible.')
    })
  }, [challengeToken, classicProfileSettingsOpen])

  function dispatchBracketAction(action: 'bracket:toggle-fullscreen' | 'bracket:share' | 'bracket:download') {
    window.dispatchEvent(new Event(action))
  }

  function closeSimulatorOutcomeNotice() {
    if (simulatorOutcomeNotices.length === 0) return
    const seen = new Set(readSeenSimulatorOutcomeKeys())
    for (const item of simulatorOutcomeNotices) {
      seen.add(item.key)
    }
    window.localStorage.setItem(simulatorOutcomeSeenStorageKey, JSON.stringify([...seen]))
    setSimulatorOutcomeSeenVersion((version) => version + 1)
  }

  function handleChallengeLogout() {
    window.localStorage.removeItem(challengeTokenStorageKey)
    clearChallengeProfile()
    setChallengeToken(null)
    setChallengeProfile({ email: '', pseudo: '', bracketName: 'Mon bracket' })
    setChallengeMenuOpen(false)
    setClassicProfileSettingsOpen(false)
  }

  async function handleClassicProfileUpdate(values: { email: string; pseudo: string }) {
    if (!challengeToken) {
      setClassicProfileError('Connecte-toi pour modifier ton pseudo.')
      return
    }
    setClassicProfileBusy(true)
    setClassicProfileError(null)
    try {
      const result = await updateProfile(challengeToken, values)
      window.localStorage.setItem(challengeTokenStorageKey, result.token)
      setChallengeToken(result.token)
      setChallengeProfile((current) => {
        const next = {
          ...current,
          email: result.profile.email,
          pseudo: result.profile.pseudo,
          bracketName: current.bracketName || result.entries[0]?.bracketName || 'Mon bracket',
        }
        rememberChallengeProfile(next)
        identifyAnalyticsProfile({ pseudo: result.profile.pseudo, hasAccount: true })
        return next
      })
      setClassicProfileStatus({
        blobConfigured: result.profile.blobConfigured,
        bracketCount: result.profile.bracketCount,
        hasEntries: result.profile.bracketCount > 0,
        emailHash: result.entries[0]?.emailHash ?? classicProfileStatus?.emailHash ?? '',
        pseudo: result.profile.pseudo,
        lastSavedAt: result.entries[0]?.createdAt ?? classicProfileStatus?.lastSavedAt ?? null,
      })
      setClassicProfileSettingsOpen(false)
      setChallengeMenuOpen(false)
    } catch (caught) {
      setClassicProfileError(caught instanceof Error ? caught.message : 'Mise a jour impossible.')
    } finally {
      setClassicProfileBusy(false)
    }
  }

  async function handleChallengeLogin(email: string) {
    setChallengeLoginBusy(true)
    setChallengeLoginError(null)
    setChallengeLoginSent(false)
    setChallengeLoginEmail(email)

    const pseudo = challengeProfile.pseudo.trim()
      || (email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
      || 'Joueur'
    challengeLoginPseudoRef.current = pseudo

    try {
      const emailExists = await checkEmailExists(email)
      if (emailExists) {
        challengeLoginFlowRef.current = 'existing'
        const result = await resendMagicLink(email)
        if (result.token) {
          window.localStorage.setItem(challengeTokenStorageKey, result.token)
          setChallengeToken(result.token)
          setShowChallengeLoginEntry(false)
          return
        }
      } else {
        challengeLoginFlowRef.current = 'new'
        await requestOTP(email, pseudo)
      }
      setChallengeLoginSent(true)
      setChallengeProfile((current) => {
        const next = { ...current, email }
        rememberChallengeProfile(next)
        return next
      })
    } catch (caught) {
      setChallengeLoginError(caught instanceof Error ? caught.message : 'Connexion impossible.')
    } finally {
      setChallengeLoginBusy(false)
    }
  }

  async function handleChallengeLoginOTP(otp: string) {
    if (!challengeLoginEmail) return
    setChallengeLoginBusy(true)
    setChallengeLoginError(null)

    const pseudo = challengeLoginPseudoRef.current || challengeProfile.pseudo.trim()
      || (challengeLoginEmail.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
      || 'Joueur'

    try {
      let token: string
      let resolvedEmail = challengeLoginEmail

      if (challengeLoginFlowRef.current === 'new') {
        token = await verifyOTP(challengeLoginEmail, pseudo, otp)
      } else {
        const result = await verifyLoginOTP(challengeLoginEmail, otp, pseudo)
        token = result.token
        resolvedEmail = result.email
      }

      window.localStorage.setItem(challengeTokenStorageKey, token)
      setChallengeToken(token)
      setChallengeProfile((current) => {
        const next = { ...current, email: resolvedEmail, pseudo: current.pseudo || pseudo }
        rememberChallengeProfile(next)
        return next
      })
      window.localStorage.setItem(challengeHadAccountStorageKey, 'true')
      setShowChallengeLoginEntry(false)
      setChallengeLoginSent(false)
    } catch (caught) {
      setChallengeLoginError(caught instanceof Error ? caught.message : 'Code OTP invalide ou expiré.')
    } finally {
      setChallengeLoginBusy(false)
    }
  }

  async function handleChallengeResend() {
    if (!challengeLoginEmail) return
    setChallengeLoginBusy(true)
    setChallengeLoginError(null)
    const pseudo = challengeLoginPseudoRef.current
    try {
      if (challengeLoginFlowRef.current === 'new') {
        await requestOTP(challengeLoginEmail, pseudo)
      } else {
        await resendMagicLink(challengeLoginEmail)
      }
      setChallengeLoginSent(false)
      window.setTimeout(() => setChallengeLoginSent(true), 50)
    } catch (caught) {
      setChallengeLoginError(caught instanceof Error ? caught.message : 'Renvoi impossible.')
    } finally {
      setChallengeLoginBusy(false)
    }
  }

  if (adminMode) {
    return <AdminDashboard />
  }

  if (loading) {
    return (
      <main className="app-shell loading">
        <div className="boot-loader">
          <BootLoaderMark />
          <div className="boot-loader__copy">
            <span className="boot-loader__label">Coupe du Monde 2026</span>
            <span className="boot-loader__status">Synchronisation du terrain</span>
          </div>
        </div>
      </main>
    )
  }

  if (error || !seed) {
    return <main className="app-shell loading">{error ?? 'Aucune donnée disponible.'}</main>
  }

  const teamsById = new Map(seed.teams.map((team) => [team.id, team]))
  const teamsByFifaCode = new Map(seed.teams.map((team) => [team.fifaCode, team]))
  const mergedMatches = mergeScores(seed.matches, liveSource.matches, overrides, mode)
  const computedStandings = computeStandings(seed.teams, mergedMatches)
  const officialStandings = liveSource.standings.reduce<Record<string, RankedStandingRow[]>>((groups, row) => {
    groups[row.groupId] ??= []
    groups[row.groupId].push(row)
    return groups
  }, {})
  const standings = mode === 'real' && liveSource.standings.length > 0
    ? officialStandings
    : computedStandings
  const challengeMergedMatches = mergeScores(seed.matches, liveSource.matches, {}, 'real')
  const challengeStandings = liveSource.standings.length > 0
    ? officialStandings
    : computeStandings(seed.teams, challengeMergedMatches)
  const challengeMatches = buildKnockoutBracket(challengeStandings, challengeMergedMatches)
  const predMap = new Map(liveSource.predictions.map((p) => [p.matchId, p]))
  const bestThirds = getBestThirdPlacedTeams(standings)
  const groupBracket = buildKnockoutBracket(standings, mergedMatches)
  const isSharedBracketView = Boolean((sharedBracketId && sharedBracket) || (publicPseudo && publicSimulatorBracket))
  const activeKnockoutPicks = mode === 'simulation' ? knockoutPicks : {}
  const displayedKnockoutPicks = viewedPublicBracket ? viewedPublicBracket.knockoutPicks : activeKnockoutPicks
  const bracketReadOnly = isSharedBracketView || Boolean(viewedPublicBracket)
  const liveMatchesById = new Map(liveSource.matches.map((match) => [match.id, match]))
  const liveWinnerCodesById = new Map(liveSource.matches.flatMap((match) => match.winnerTeamCode ? [[match.id, match.winnerTeamCode] as const] : []))
  const displayBracket = resolveDisplayBracket(groupBracket, displayedKnockoutPicks, liveWinnerCodesById, teamsById)
  const bracketRewards = calculateBracketRewards(displayBracket)
  const knockoutDayMatches: DayMatch[] = displayBracket
    .map<DayMatch | null>((match) => {
      const live = liveMatchesById.get(match.id)
      const fallbackSchedule = knockoutKickoffById[match.id]
      const kickoffIso = live?.kickoffIso ?? fallbackSchedule?.kickoffIso ?? null
      const kickoffDate = kickoffIso
        ? localDateStr(new Date(kickoffIso))
        : dateKeyFromKnockoutDateLabel(match.dateLabel)
      if (!kickoffDate) return null
      const homeTeamId = getEntrantTeamId(match.home)
      const awayTeamId = getEntrantTeamId(match.away)
      return {
        id: match.id,
        groupId: match.stage,
        matchday: 4,
        homeTeamId: homeTeamId ?? `placeholder:${match.id}:home`,
        awayTeamId: awayTeamId ?? `placeholder:${match.id}:away`,
        kickoffDate,
        kickoffTime: live?.kickoffTime ?? null,
        kickoffIso,
        liveMinute: live?.liveMinute ?? null,
        fifaMatchPath: live?.fifaMatchPath ?? null,
        venue: fallbackSchedule?.venue ?? match.label,
        homeScore: live?.homeScore ?? null,
        awayScore: live?.awayScore ?? null,
        status: live?.status ?? 'scheduled',
        dayStageLabel: formatStageLabel(match.stage),
        dayMatchLabel: `${match.label} · ${fallbackSchedule?.venue ?? 'Stade a confirmer'}`,
        homeLabel: match.home.kind === 'placeholder' ? match.home.label : undefined,
        awayLabel: match.away.kind === 'placeholder' ? match.away.label : undefined,
        isKnockout: true,
      }
    })
    .filter((match): match is DayMatch => match !== null)
  const dayScheduleMatches: DayMatch[] = [...mergedMatches, ...knockoutDayMatches]
  const knockoutTodayMatchIds = new Set(knockoutDayMatches.filter(isMatchToday).map((match) => match.id))
  const knockoutDayMatchesById = new Map(knockoutDayMatches.map((match) => [match.id, match]))
  const shouldDockBracketHeader = view === 'bracket' && !isBracketFullscreen
  const isChallengeConnected = Boolean(challengeToken && challengeProfile.pseudo)
  const sharedViewOwnerPseudo = viewedPublicBracket?.pseudo ?? publicSimulatorBracket?.pseudo ?? sharedBracket?.pseudo ?? null
  const isOwnSharedBracket = Boolean(sharedViewOwnerPseudo && challengeProfile.pseudo && sharedViewOwnerPseudo.trim().toLowerCase() === challengeProfile.pseudo.trim().toLowerCase())
  const shouldReturnToOwnBracket = Boolean(isChallengeConnected || isOwnSharedBracket)
  const createFromShareHref = shouldReturnToOwnBracket ? '/?simulator' : '/?simulator&new=1'
  const createFromShareLabel = shouldReturnToOwnBracket ? 'RETOUR A MON BRACKET' : 'CREER MON BRACKET'
  const currentShareUrl = publicPseudo && publicSimulatorBracket ? window.location.origin + '/@' + encodeURIComponent(publicSimulatorBracket.pseudo) : isSharedBracketView && sharedBracket ? window.location.origin + '/share/bracket/' + sharedBracket.id : challengeProfile.pseudo ? window.location.origin + '/@' + encodeURIComponent(challengeProfile.pseudo) : null
  const seenSimulatorOutcomeKeys = new Set(readSeenSimulatorOutcomeKeys())
  const simulatorOutcomeNotices: SimulatorOutcomeNotice[] = displayBracket
    .filter((match) => Boolean(match.pickedWinnerId && match.realWinnerId && match.predictionState))
    .map((match) => ({
      key: simulatorOutcomeStorageKey(match.id, match.realWinnerId),
      match,
    }))
    .filter((item) => !seenSimulatorOutcomeKeys.has(item.key))
  const projectedQualifiedIds = new Set<string>()
  const projectedQualifiedRows: Array<{ teamId: string; groupId: string; label: string; rank: number }> = []
  Object.values(standings).forEach((rows) => {
    rows
      .filter((row) => row.rank <= 2)
      .sort((a, b) => a.rank - b.rank)
      .forEach((row) => {
        projectedQualifiedIds.add(row.teamId)
        projectedQualifiedRows.push({
          teamId: row.teamId,
          groupId: row.groupId,
          label: `${row.rank}${row.rank === 1 ? 'er' : 'e'} ${row.groupId}`,
          rank: row.rank,
        })
      })
  })
  bestThirds.forEach((row, index) => {
    projectedQualifiedIds.add(row.teamId)
    projectedQualifiedRows.push({
      teamId: row.teamId,
      groupId: row.groupId,
      label: `3e ${row.groupId}`,
      rank: index + 25,
    })
  })

  const visibleGroups = isCompactGroups ? seed.groups.filter((group) => group.id === selectedGroupId) : seed.groups
  const matchDayKeys = [...new Set(dayScheduleMatches.map(matchLocalDateKey))].sort()
  const selectedDayIndex = matchDayKeys.indexOf(selectedDayKey)
  const activeDayIndex = selectedDayIndex >= 0
    ? selectedDayIndex
    : Math.max(0, matchDayKeys.findIndex((dateKey) => dateKey >= localDateStr()))
  const activeDayKey = matchDayKeys[activeDayIndex] ?? selectedDayKey
  const dayMatches = dayScheduleMatches
    .filter((match) => matchLocalDateKey(match) === activeDayKey)
    .sort((a, b) => {
      const aTime = a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`
      const bTime = b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`
      return aTime.localeCompare(bTime)
    })
    .slice(0, 10)
  const challengeTodayMatches = dayScheduleMatches
    .filter(isMatchToday)
    .sort((a, b) => {
      const aTime = a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`
      const bTime = b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`
      return aTime.localeCompare(bTime)
    })
    .slice(0, 10)
  const challengeOfficialScores = knockoutDayMatches.reduce<Record<string, { home: number; away: number }>>((scores, match) => {
    if (match.homeScore !== null && match.awayScore !== null) {
      scores[match.id] = { home: match.homeScore, away: match.awayScore }
    }
    return scores
  }, {})
  const challengeOfficialFinishedMatchIds = knockoutDayMatches
    .filter((match) => inferStatus(match) === 'finished')
    .map((match) => match.id)
  const lockedMatchIds = new Set(liveSource.matches
    .filter((match) => match.status === 'finished')
    .map((match) => match.id))
  const challengeOfficialResults = knockoutDayMatches.reduce<Record<string, string>>((results, match) => {
    if (inferStatus(match) !== 'finished') return results
    if (match.homeTeamId.startsWith('placeholder:') || match.awayTeamId.startsWith('placeholder:')) return results
    const live = liveMatchesById.get(match.id)
    const winnerFromFifa = live?.winnerTeamCode ? teamsByFifaCode.get(live.winnerTeamCode)?.id : null
    if (winnerFromFifa) {
      results[match.id] = winnerFromFifa
      return results
    }
    if (match.homeScore === null || match.awayScore === null || match.homeScore === match.awayScore) return results
    results[match.id] = match.homeScore > match.awayScore ? match.homeTeamId : match.awayTeamId
    return results
  }, {})
  const liveNowMatches = dayMatches.filter((match) => inferStatus(match) === 'live')
  const previousDayKey = activeDayIndex > 0 ? matchDayKeys[activeDayIndex - 1] : null
  const nextDayKey = activeDayIndex < matchDayKeys.length - 1 ? matchDayKeys[activeDayIndex + 1] : null
  const isSelectedToday = activeDayKey === localDateStr()

  function updateOverride(matchId: string, side: 'homeScore' | 'awayScore', value: string) {
    if (lockedMatchIds.has(matchId)) return
    setOverrides((current) => {
      const next = { ...current }
      const match = next[matchId] ?? { homeScore: null, awayScore: null }
      const normalized = value === '' ? null : Number(value)
      next[matchId] = {
        ...match,
        [side]: Number.isNaN(normalized) ? null : normalized,
      }
      return next
    })
  }

  function applyGroupRankingSimulation(groupId: string, orderedTeamIds: string[]) {
    if (mergedMatches.some((match) => match.groupId === groupId && lockedMatchIds.has(match.id))) return
    if (!seed) {
      return
    }

    const groupMatches = seed.matches.filter((match) => match.groupId === groupId)
    const nextGroupOverrides = buildGroupOrderOverrides(groupMatches, orderedTeamIds)

    setOverrides((current) => {
      const next = { ...current }

      for (const match of groupMatches) {
        delete next[match.id]
      }

      return {
        ...next,
        ...nextGroupOverrides,
      }
    })

    setKnockoutPicks({})
  }

  function toggleFocus(teamId: string) {
    setFocusId((current) => (current === teamId ? null : teamId))
  }

  function handlePickWinner(matchId: string, teamId: string) {
    if (lockedMatchIds.has(matchId)) return
    trackAnalytics('simulator_pick_winner', { matchId, teamId }, 'main')
    const completesBracketNow = !isBracketComplete(knockoutPicks) && isBracketComplete({ ...knockoutPicks, [matchId]: teamId })
    completeBonusArmedRef.current = true

    setKnockoutPicks((current) => {
      const next = { ...current, [matchId]: teamId }
      writeChallengeDraftPicks(next)
      return next
    })

    if (!completesBracketNow && !challengeToken && !showChallengeLoginEntry) {
      setChallengeLoginError(null)
      setChallengeLoginSent(false)
      setShowChallengeLoginEntry(true)
    }
  }

  function handleClearWinner(matchId: string) {
    if (lockedMatchIds.has(matchId)) return
    completeBonusArmedRef.current = false
    setKnockoutPicks((current) => {
      const wasComplete = isBracketComplete(current)
      const next = { ...current }
      delete next[matchId]
      writeChallengeDraftPicks(next)
      if (wasComplete) {
        previousCompleteBonusRef.current = 0
        setCompleteBonusNoticeOpen(false)
      }
      return next
    })
  }

  function handleGroupDragStart(groupId: string, teamId: string) {
    if (mode !== 'simulation') {
      return
    }

    setDragState({
      groupId,
      teamId,
      overTeamId: teamId,
    })
  }

  function handleGroupDragEnter(groupId: string, teamId: string) {
    setDragState((current) => {
      if (!current || current.groupId !== groupId || current.teamId === teamId) {
        return current
      }

      return {
        ...current,
        overTeamId: teamId,
      }
    })
  }

  function handleGroupDrop(groupId: string, targetTeamId: string, currentRows: Array<{ teamId: string }>) {
    if (!dragState || dragState.groupId !== groupId || dragState.teamId === targetTeamId) {
      setDragState(null)
      return
    }

    const orderedTeamIds = currentRows.map((row) => row.teamId)
    const fromIndex = orderedTeamIds.indexOf(dragState.teamId)
    const toIndex = orderedTeamIds.indexOf(targetTeamId)

    if (fromIndex === -1 || toIndex === -1) {
      setDragState(null)
      return
    }

    const [movedTeamId] = orderedTeamIds.splice(fromIndex, 1)
    orderedTeamIds.splice(toIndex, 0, movedTeamId)
    applyGroupRankingSimulation(groupId, orderedTeamIds)
    setDragState(null)
  }

  function closeDayModal() {
    setShowDayModal(false)
  }

  function getMatchOdds(homeId: string, awayId: string): MatchOdds | null {
    if (!oddsData) return null
    return oddsData[`${homeId}-${awayId}`] ?? oddsData[`${awayId}-${homeId}`] ?? null
  }

  async function openMatchStats(match: GroupMatch) {
    const homeTeam = teamsById.get(match.homeTeamId)
    const awayTeam = teamsById.get(match.awayTeamId)
    if (!homeTeam || !awayTeam) return
    setMatchStatsModal({ match, homeTeam, awayTeam })
    setMatchStatsData(null)
    if (match.fifaMatchPath) {
      setMatchStatsLoading(true)
      const stats = await fetchMatchStats(match.fifaMatchPath)
      setMatchStatsData(stats)
      setMatchStatsLoading(false)
    }
  }

  async function refreshMatchStats() {
    if (!matchStatsModal || !matchStatsModal.match.fifaMatchPath) return
    setMatchStatsLoading(true)
    setMatchStatsData(null)
    const stats = await fetchMatchStats(matchStatsModal.match.fifaMatchPath)
    setMatchStatsData(stats)
    setMatchStatsLoading(false)
  }

  if (challengeMode) {
    return (
      <BrakupHub
        seed={seed}
        liveSource={liveSource}
        standings={challengeStandings}
        groupMatches={challengeMergedMatches}
        teamsById={teamsById}
        todayMatches={challengeTodayMatches}
        officialResults={challengeOfficialResults}
        officialScores={challengeOfficialScores}
        officialFinishedMatchIds={challengeOfficialFinishedMatchIds}
        topScorers={liveSource.topScorers ?? []}
        locale={locale}
      />
    )
  }

  if (challengeBoardMode) {
    return (
      <main className="brakup-shell brakup-shell--classic-board">
        <header className="classic-board-topbar">
          <a href="/?simulator" className="classic-board-topbar__back">Retour bracket</a>
          <a href={localizedChallengeHref(locale)} className="classic-board-topbar__challenge">
            <img src="/brakup-challenge-logo.png" alt="" />
            Challenge
          </a>
        </header>
        <div className="classic-board-page">
          <Leaderboard onViewBracket={(entry) => setClassicViewedChallengeEntry(entry)} />
        </div>
        {classicViewedChallengeEntry ? (
          <div className="brakup-bracket-overlay">
            <div className="brakup-bracket-overlay__bar">
              <span>Bracket de {classicViewedChallengeEntry.pseudo} · lecture seule</span>
              <button type="button" className="brakup-bracket-overlay__close" onClick={() => setClassicViewedChallengeEntry(null)}>
                Retour classement
              </button>
            </div>
            <div className="brakup-bracket-overlay__body">
              <BracketChallenge
                matches={challengeMatches}
                teamsById={teamsById}
                picks={classicViewedChallengeEntry.picks ?? {}}
                scores={classicViewedChallengeEntry.battleScores}
                realResults={challengeOfficialResults}
                officialScores={challengeOfficialScores}
                onPick={() => undefined}
                onPlay={() => undefined}
                readOnly
                ownerPseudo={classicViewedChallengeEntry.pseudo}
                showScorePanel={false}
                locale={locale}
              />
            </div>
          </div>
        ) : null}
      </main>
    )
  }

  const isHomeBracketFocus = view === 'bracket' && mode === 'simulation'

  return (
    <div className={`app-shell${simulatorMode ? ' is-simulator' : ''}${isHomeBracketFocus ? ' is-home-bracket' : ''}${isSharedBracketView ? ' is-shared-bracket' : ''}`}>
      <div className="floods" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      {!isSharedBracketView ? <header className="topbar">
        <div className="brand">
          <img src="/brakup-challenge-logo-wc.png" alt="BRAKUP" className="brand__logo" />
        </div>

        <a href={localizedChallengeHref(locale)} className="topbar__mobile-play" aria-label="Jouer au Brakup Challenge">
          Jouer
        </a>

        {shouldDockBracketHeader ? <div className="topbar__center">Tableau final</div> : null}

        <div className="topactions topactions--bracket-only">
          <button
            type="button"
            className={`chip-btn chip-btn--sm chip-btn--icon topbar__daymatches${liveNowMatches.length > 0 ? ' is-live' : ''}`}
            onClick={() => setShowDayModal(true)}
            aria-label={liveNowMatches.length > 0 ? 'Match en cours' : 'Matchs du jour'}
            title={liveNowMatches.length > 0 ? 'Match en cours' : 'Matchs du jour'}
          >
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 2v3M11.5 2v3M2 7.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          {shouldDockBracketHeader ? (
            <>
              <a
                href={localizedChallengeHref(locale)}
                className="chip-btn chip-btn--sm chip-btn--challenge topbar__challenge-link"
                title="Brakup Challenge"
                aria-label="Ouvrir Brakup Challenge"
              >
                <img src="/brakup-challenge-logo.png" alt="" className="chip-btn__challenge-logo" />
                <span>Challenge</span>
              </a>
              <div className="challenge-auth-wrap">
                <button
                  type="button"
                  className={`chip-btn chip-btn--sm chip-btn--icon topbar__account-chip${isChallengeConnected ? ' is-connected' : ''}`}
                  aria-expanded={challengeMenuOpen}
                  aria-label={isChallengeConnected ? `Compte : ${challengeProfile.pseudo || 'Connecté'}` : 'Connexion'}
                  title={isChallengeConnected ? challengeProfile.pseudo || 'Connecté' : 'Connexion'}
                  onClick={() => setChallengeMenuOpen((open) => !open)}
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true"><circle cx="8.5" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M2 15c0-3.59 2.91-6.5 6.5-6.5S15 11.41 15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  {isChallengeConnected ? <span>{challengeProfile.pseudo}</span> : null}
                </button>
                {challengeMenuOpen ? (
                  <div className="topmenu challenge-auth-drop" role="menu">
                    {isChallengeConnected ? (
                      <>
                        <button
                          type="button"
                          className="topmenu__label topmenu__label--editable"
                          onClick={() => {
                            setClassicProfileError(null)
                            setClassicProfileSettingsOpen(true)
                            setChallengeMenuOpen(false)
                          }}
                        >
                          <span>{challengeProfile.pseudo}</span>
                          <i aria-hidden="true">Editer</i>
                        </button>
                        <button type="button" className="topmenu__item" onClick={handleChallengeLogout}>
                          Se déconnecter
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="topmenu__item"
                        onClick={() => {
                          setChallengeLoginError(null)
                          setChallengeLoginSent(false)
                          setShowChallengeLoginEntry(true)
                          setChallengeMenuOpen(false)
                        }}
                      >
                        Connexion
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              <a
                href={alternateLanguageHref(locale)}
                className="chip-btn chip-btn--sm chip-btn--icon"
                hrefLang={locale === 'en' ? 'fr' : 'en'}
                aria-label={locale === 'en' ? 'Version française' : 'English version'}
                title={locale === 'en' ? 'Version française' : 'English version'}
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8.5 2.5c-2 2-2 9 0 11M8.5 2.5c2 2 2 9 0 11M2.5 8.5h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </a>

              <div className="bracket-actions-wrap--topbar">
                <button
                  type="button"
                  className="chip-btn chip-btn--sm chip-btn--icon"
                  aria-label={headerBracketMenuOpen ? 'Fermer le menu' : 'Menu'}
                  title="Menu"
                  aria-expanded={headerBracketMenuOpen}
                  onClick={() => setHeaderBracketMenuOpen((open) => !open)}
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M2.5 4.5h12M2.5 8.5h12M2.5 12.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>

                {headerBracketMenuOpen ? (
                  <div className="topmenu bracket-actions-drop--topbar" role="menu">
                    <button
                      type="button"
                      className="topmenu__item"
                      onClick={() => {
                        setShowDayModal(true)
                        setHeaderBracketMenuOpen(false)
                      }}
                    >
                      Matchs du jour
                    </button>
                    <a
                      href={localizedChallengeHref(locale)}
                      className="topmenu__item topmenu__item--challenge"
                      onClick={() => setHeaderBracketMenuOpen(false)}
                    >
                      <img src="/brakup-challenge-logo.png" alt="" className="topmenu__challenge-logo" />
                      Brakup Challenge
                    </a>
                    <a
                      href="/?board"
                      className="topmenu__item"
                      onClick={() => setHeaderBracketMenuOpen(false)}
                    >
                      Classement
                    </a>
                    <div className="topmenu__sep" />
                    <button
                      type="button"
                      className="topmenu__item"
                      onClick={() => {
                        dispatchBracketAction('bracket:share')
                        setHeaderBracketMenuOpen(false)
                      }}
                    >
                      Partager
                    </button>
                    <button
                      type="button"
                      className="topmenu__item"
                      onClick={() => {
                        dispatchBracketAction('bracket:download')
                        setHeaderBracketMenuOpen(false)
                      }}
                    >
                      Telecharger
                    </button>
                    {isChallengeConnected ? (
                      <button
                        type="button"
                        className="topmenu__item topmenu__item--danger"
                        onClick={() => {
                          handleChallengeLogout()
                          setHeaderBracketMenuOpen(false)
                        }}
                      >
                        Deconnexion
                      </button>
                    ) : null}
                    {focusId ? (
                      <button
                        type="button"
                        className="topmenu__item"
                        onClick={() => {
                          setFocusId(null)
                          setHeaderBracketMenuOpen(false)
                        }}
                      >
                        Reinitialiser le focus
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </header> : null}

      {!isSharedBracketView && showDayModal && (dayMatches.length > 0 || initialDayModalLoading) ? (
        <div className="daymodal" role="dialog" aria-modal="true" aria-labelledby="daymodal-title">
          <div className="daymodal__scrim" onClick={closeDayModal} />
          <div className="daymodal__panel">
            {initialDayModalLoading ? (
              <div className="daymodal__loading">
                <BootLoaderMark />
                <div className="daymodal__loading-copy">
                  <span className="boot-loader__label">Recuperation FIFA</span>
                  <span className="boot-loader__status">Chargement des scores et classements du jour</span>
                </div>
              </div>
            ) : dayMatches.length > 0 ? (
              <>
                <div className="daymodal__head">
                  <button type="button" className="daymodal__close" onClick={closeDayModal} aria-label="Fermer">
                    X
                  </button>

                  <div className="daymodal__daynav" aria-label="Navigation entre les journees de matchs">
                    <button
                      type="button"
                      onClick={() => previousDayKey && setSelectedDayKey(previousDayKey)}
                      disabled={!previousDayKey}
                      aria-label="Journee precedente"
                    >
                      {'\u2190'}
                    </button>
                    <div>
                      <strong>{isSelectedToday ? 'Aujourd hui' : formatDayLabel(activeDayKey)}</strong>
                      <span>{dayMatches.length} match{dayMatches.length > 1 ? 's' : ''}</span>
                    </div>
                    <button
                      type="button"
                      className="daymodal__todaybtn"
                      onClick={() => setSelectedDayKey(localDateStr())}
                      disabled={isSelectedToday}
                    >
                      Aujourd hui
                    </button>
                    <button
                      type="button"
                      onClick={() => nextDayKey && setSelectedDayKey(nextDayKey)}
                      disabled={!nextDayKey}
                      aria-label="Journee suivante"
                    >
                      {'\u2192'}
                    </button>
                  </div>

                  <div className="daymodal__heroheader">
                    <div>
                      <h2 id="daymodal-title">Matchs du jour</h2>
                      <p>
                        {liveNowMatches.length > 0
                          ? `${liveNowMatches.length} match${liveNowMatches.length > 1 ? 's' : ''} en direct maintenant.`
                          : `${dayMatches.length} match${dayMatches.length > 1 ? 's' : ''} au programme.`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="daymodal__grid">
                  {dayMatches.map((match) => {
                    const homeTeam = teamsById.get(match.homeTeamId)
                    const awayTeam = teamsById.get(match.awayTeamId)
                    const homeLabel = homeTeam?.name ?? match.homeLabel ?? 'A determiner'
                    const awayLabel = awayTeam?.name ?? match.awayLabel ?? 'A determiner'
                    const canOpenStats = Boolean(homeTeam && awayTeam)
                    const kickoffTime = formatKickoffTime(match)
                    const liveStatus = inferStatus(match)
                    const hasScore = hasRenderableScore(match)
                    const isFinished = liveStatus === 'finished'
                    const homeWin = isFinished && hasScore && match.homeScore! > match.awayScore!
                    const awayWin = isFinished && hasScore && match.awayScore! > match.homeScore!

                    return (
                      <article
                        key={match.id}
                        className={`daymatch${canOpenStats ? ' daymatch--clickable' : ''}${liveStatus === 'live' ? ' is-live' : liveStatus === 'scheduled' ? ' is-upcoming' : ''}`}
                        onClick={canOpenStats ? () => { closeDayModal(); void openMatchStats(match) } : undefined}
                        role={canOpenStats ? 'button' : undefined}
                        tabIndex={canOpenStats ? 0 : undefined}
                        onKeyDown={canOpenStats ? (e) => { if (e.key === 'Enter') { closeDayModal(); void openMatchStats(match) } } : undefined}
                      >
                        <div className="daymatch__meta">
                          <span>{match.dayStageLabel ?? `Groupe ${match.groupId}`}</span>
                          <div className="daymatch__meta-right">
                            <BroadcasterBadge matchId={match.id} />
                            <span>{match.dayMatchLabel ?? match.venue}</span>
                          </div>
                        </div>

                        <div className="daymatch__main">
                          <div className={`daymatch__team${homeWin ? ' is-winner' : awayWin ? ' is-loser' : ''}`}>
                            {homeTeam ? (flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{homeTeam.flagEmoji}</span>) : <span className="daymatch__flag">TBD</span>}
                            <strong>{homeLabel}</strong>
                          </div>
                          <div className="daymatch__scoreblock">
                            <div className="daymatch__status">
                              {liveStatus === 'live'
                                ? formatLiveMinute(match.liveMinute, liveSource.syncedAt).toUpperCase()
                                : liveStatus === 'finished' ? 'TERMINE' : kickoffTime ? 'COUP D ENVOI' : 'BIENTOT'}
                            </div>
                            {liveStatus === 'scheduled' ? (
                              <div className="daymatch__score daymatch__score--time">{kickoffTime ?? 'A VENIR'}</div>
                            ) : hasScore ? (
                              <div className="daymatch__score">
                                <span className={homeWin ? 'is-winner-score' : ''}>{match.homeScore}</span>
                                <i>:</i>
                                <span className={awayWin ? 'is-winner-score' : ''}>{match.awayScore}</span>
                              </div>
                            ) : (
                              <ScoreLoading />
                            )}
                          </div>
                          <div className={`daymatch__team daymatch__team--right${awayWin ? ' is-winner' : homeWin ? ' is-loser' : ''}`}>
                            <strong>{awayLabel}</strong>
                            {awayTeam ? (flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{awayTeam.flagEmoji}</span>) : <span className="daymatch__flag">TBD</span>}
                          </div>
                        </div>

                        {match.status === 'scheduled' && predMap.has(match.id) ? (
                          <div className="daymatch__prono">
                            {(() => {
                              const pred = predMap.get(match.id)!
                              return (
                                <>
                                  <div className="prono__bar">
                                    <div className="prono__seg prono__seg--home" style={{ width: `${pred.homePercent}%` }} />
                                    <div className="prono__seg prono__seg--draw" style={{ width: `${pred.drawPercent}%` }} />
                                    <div className="prono__seg prono__seg--away" style={{ width: `${pred.awayPercent}%` }} />
                                  </div>
                                  <div className="prono__pcts">
                                    <span className="prono__pct prono__pct--home">{pred.homePercent}%</span>
                                    <span className="prono__pct prono__pct--draw">{pred.drawPercent}% nul</span>
                                    <span className="prono__pct prono__pct--away">{pred.awayPercent}%</span>
                                  </div>
                                </>
                              )
                            })()}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {matchModalGroupId ? (() => {
        const modalMatches = mergedMatches
          .filter((m) => m.groupId === matchModalGroupId)
          .sort((a, b) => (a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`).localeCompare(b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`))
        const modalStandings = standings[matchModalGroupId] ?? []

        // rank lookup: teamId → rank in this group
        const rankByTeamId = new Map(modalStandings.map((r) => [r.teamId, r.rank]))

        return (
          <div className="gmmodal" role="dialog" aria-modal="true">
            <div className="gmmodal__scrim" onClick={() => setMatchModalGroupId(null)} />
            <div className="gmmodal__panel">

              {/* Header */}
              <div className="gmmodal__head">
                <div className="gmmodal__title">
                  <span className="gmmodal__badge">{matchModalGroupId}</span>
                  Groupe {matchModalGroupId}
                </div>
                <button type="button" className="gmmodal__close" onClick={() => setMatchModalGroupId(null)} aria-label="Fermer">×</button>
              </div>

              {/* Match list */}
              <div className="gmmodal__body">
                {modalMatches.map((match) => {
                  const homeTeam = teamsById.get(match.homeTeamId)
                  const awayTeam = teamsById.get(match.awayTeamId)
                  if (!homeTeam || !awayTeam) return null

                  const effectiveStatus = inferStatus(match)
                  const isLive = effectiveStatus === 'live'
                  const isDone = effectiveStatus === 'finished'
                  const isScheduled = effectiveStatus === 'scheduled'
                  const homeWin = isDone && match.homeScore !== null && match.awayScore !== null && match.homeScore > match.awayScore
                  const awayWin = isDone && match.homeScore !== null && match.awayScore !== null && match.awayScore > match.homeScore

                  const homeRank = rankByTeamId.get(homeTeam.id)
                  const awayRank = rankByTeamId.get(awayTeam.id)
                  const pred = predMap.get(match.id)

                  // Format time in browser local timezone
                  const kickoffDate = new Date(match.kickoffIso ?? `${match.kickoffDate}T12:00:00Z`)
                  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(kickoffDate)
                  const kickoffHHMM = match.kickoffIso
                    ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(match.kickoffIso))
                    : null

                  return (
                    <div
                      key={match.id}
                      className={`gmrow${isLive ? ' is-live' : ''}${isMatchToday(match) ? ' is-today' : ''}${isDone || isLive ? ' is-clickable' : ''}`}
                      onClick={isDone || isLive ? () => void openMatchStats(match) : undefined}
                      style={isDone || isLive ? { cursor: 'pointer' } : undefined}
                    >

                      {/* Date / status row */}
                      <div className="gmrow__header">
                        {isLive
                          ? <span className="gmrow__livebadge"><span className="gstatus__pulse" aria-hidden="true" />{formatLiveMinute(match.liveMinute, liveSource.syncedAt)}</span>
                          : <span className="gmrow__time">{dateLabel}</span>
                        }
                        <div className="gmrow__header-right">
                          <BroadcasterBadge matchId={match.id} />
                          <span className="gmrow__venue">{match.venue}</span>
                        </div>
                      </div>

                      {/* Teams + score */}
                      <div className="gmrow__match">
                        <div className={`gmrow__team gmrow__team--home${homeWin ? ' is-win' : ''}`}>
                          {homeRank != null && <span className={`gmrow__rank${homeRank <= 2 ? ' is-q' : ''}`}>#{homeRank}</span>}
                          {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="flag-image" /> : <span className="flag-emoji">{homeTeam.flagEmoji}</span>}
                          <span className="gmrow__name">{homeTeam.name}</span>
                        </div>

                        <div className="gmrow__score">
                          {isScheduled && kickoffHHMM && (
                            <span className="gmrow__kicktime">{kickoffHHMM}</span>
                          )}
                          <div className="gmrow__score__digits">
                            {mode === 'simulation' ? (
                              <>
                                <input type="number" min="0"
                                  value={overrides[match.id]?.homeScore ?? match.homeScore ?? ''}
                                  onChange={(e) => updateOverride(match.id, 'homeScore', e.target.value)} />
                                <span>:</span>
                                <input type="number" min="0"
                                  value={overrides[match.id]?.awayScore ?? match.awayScore ?? ''}
                                  onChange={(e) => updateOverride(match.id, 'awayScore', e.target.value)} />
                              </>
                            ) : isScheduled ? (
                              <span className="gmrow__score__dash">–</span>
                            ) : (
                              <>
                                <b>{match.homeScore ?? '–'}</b>
                                <span>:</span>
                                <b>{match.awayScore ?? '–'}</b>
                              </>
                            )}
                          </div>
                        </div>

                        <div className={`gmrow__team gmrow__team--away${awayWin ? ' is-win' : ''}`}>
                          <span className="gmrow__name">{awayTeam.name}</span>
                          {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="flag-image" /> : <span className="flag-emoji">{awayTeam.flagEmoji}</span>}
                          {awayRank != null && <span className={`gmrow__rank${awayRank <= 2 ? ' is-q' : ''}`}>#{awayRank}</span>}
                        </div>
                      </div>

                      {/* Prono — only for scheduled matches */}
                      {isScheduled && pred ? (
                        <div className="gmrow__prono">
                          <div className="prono__teams">
                            <span>{homeTeam.shortName}</span>
                            <span className="prono__label">Prono</span>
                            <span>{awayTeam.shortName}</span>
                          </div>
                          <div className="prono__bar">
                            <div className="prono__seg prono__seg--home" style={{ width: `${pred.homePercent}%` }} />
                            <div className="prono__seg prono__seg--draw" style={{ width: `${pred.drawPercent}%` }} />
                            <div className="prono__seg prono__seg--away" style={{ width: `${pred.awayPercent}%` }} />
                          </div>
                          <div className="prono__pcts">
                            <span className="prono__pct prono__pct--home">{pred.homePercent}%</span>
                            <span className="prono__pct prono__pct--draw">{pred.drawPercent}% nul</span>
                            <span className="prono__pct prono__pct--away">{pred.awayPercent}%</span>
                          </div>
                          {(pred.homeForm || pred.awayForm) && (
                            <div className="prono__forms">
                              {pred.homeForm ? <FormDots form={pred.homeForm} /> : <span />}
                              <span className="prono__formsep">5 derniers</span>
                              {pred.awayForm ? <FormDots form={pred.awayForm} align="right" /> : <span />}
                            </div>
                          )}
                          {pred.advice && <div className="prono__advice">✦ {pred.advice}</div>}
                        </div>
                      ) : null}

                      {/* No time hint if no kickoffIso */}
                      {isScheduled && !match.kickoffIso && !pred && (
                        <div className="gmrow__nosync">Sync pour voir l&apos;heure exacte et le pronostic</div>
                      )}

                    </div>
                  )
                })}
              </div>

              <div className="gmmodal__foot">
                <span className={`srcdot srcdot--${mode === 'simulation' ? 'sim' : 'live'}`} />
                {mode === 'simulation' ? 'Scores simulés' : liveSource.syncedAt ? `Données live · ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(liveSource.syncedAt))}` : 'Synchronise pour avoir les horaires et pronostics'}
              </div>
            </div>
          </div>
        )
      })() : null}

      {liveSource.warnings.length > 0 ? (
        <div className="warning-strip">
          {liveSource.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {mode === 'simulation' ? (
        <div className="simhint">
          <span className="simhint__ico">✦</span>
          Glisse les équipes pour réordonner un groupe · ajuste les scores · clique une équipe dans le tableau pour la faire avancer
        </div>
      ) : null}

      {view === 'groups' ? (
        <div className="groups-rail" aria-label="Navigation groupes">
          {seed.groups.map((group) => {
            const groupMatches = mergedMatches.filter((match) => match.groupId === group.id)
            const todayMatches = groupMatches.filter(isMatchToday).length
            const isComplete = groupMatches.every((match) => match.homeScore !== null && match.awayScore !== null)
            return (
              <button
                key={group.id}
                type="button"
                className={`groups-rail__chip${selectedGroupId === group.id ? ' is-active' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <span>Groupe {group.id}</span>
                {todayMatches > 0 ? <span className="groups-rail__dot is-live" aria-hidden="true" /> : null}
                {isComplete ? <span className="groups-rail__state">OK</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={`board${view === 'bracket' ? ' board--wide' : ''}`}>
        <main className="board__main">
          {view === 'groups' ? (
            <div className="groups">
              {visibleGroups.map((group) => {
                const groupStandings = standings[group.id] ?? []
                const groupMatches = mergedMatches.filter((match) => match.groupId === group.id)
                const isComplete = groupMatches.every((match) => match.homeScore !== null && match.awayScore !== null)
                const todayMatches = groupMatches.filter(isMatchToday).length

                return (
                  <section key={group.id} className={`gcard${isComplete ? ' is-complete' : ''}`}>
                    <header className="gcard__head">
                      <div className="gcard__identity">
                        <div className="gcard__badge">{group.id}</div>
                        <div>
                          <div className="gcard__title">Groupe {group.id}</div>
                          <div className="gcard__sub">{isComplete ? 'Classement fige' : 'Classement en cours'}</div>
                        </div>
                      </div>
                      <div className="gcard__status">
                        {todayMatches > 0 ? <span className="gstatus gstatus--live"><span className="gstatus__pulse" aria-hidden="true" />Aujourd hui {todayMatches}</span> : null}
                        <span className={`gstatus${isComplete ? ' gstatus--ok' : ''}`}>{isComplete ? 'Complet' : `${groupMatches.length} matchs`}</span>
                      </div>
                    </header>

                    <table className="stand">
                      <thead>
                        <tr>
                          <th className="stand__pos">#</th>
                          <th className="stand__team">Équipe</th>
                          <th title="Matchs joués">J</th>
                          <th title="Matchs gagnés">G</th>
                          <th title="Matchs nuls">N</th>
                          <th title="Matchs perdus">P</th>
                          <th title="Différence de buts : buts marqués moins buts encaissés">+/-</th>
                          <th className="stand__pts" title="Points de classement : 3 par victoire, 1 par nul">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupStandings.map((row) => {
                          const team = teamsById.get(row.teamId)
                          if (!team) return null

                          return (
                            <tr
                              key={row.teamId}
                              className={[
                                'stand__row',
                                row.rank <= 2 ? 'stand__row--q1' : row.rank === 3 ? 'stand__row--q3' : 'stand__row--q0',
                                focusId === row.teamId ? 'is-focus' : '',
                                mode === 'simulation' ? 'stand__row--draggable' : '',
                                dragState?.groupId === group.id && dragState.overTeamId === row.teamId ? 'is-drag-over' : '',
                              ].filter(Boolean).join(' ')}
                              draggable={mode === 'simulation'}
                              onDragStart={() => handleGroupDragStart(group.id, row.teamId)}
                              onDragEnter={() => handleGroupDragEnter(group.id, row.teamId)}
                              onDragOver={(event) => {
                                if (mode === 'simulation') {
                                  event.preventDefault()
                                }
                              }}
                              onDrop={() => handleGroupDrop(group.id, row.teamId, groupStandings)}
                              onDragEnd={() => setDragState(null)}
                            >
                              <td className="stand__pos">{row.rank}</td>
                              <td className="stand__team" onClick={() => toggleFocus(row.teamId)}>
                                <div className="stand__team-content">
                                  {mode === 'simulation' ? <span className="stand__drag">⋮⋮</span> : null}
                                  {flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
                                  <span className="stand__name">{team.name}</span>
                                  {projectedQualifiedIds.has(team.id) ? <span className="stand__check">✓</span> : null}
                                </div>
                              </td>
                              <td>{row.played}</td>
                              <td>{row.wins}</td>
                              <td>{row.draws}</td>
                              <td>{row.losses}</td>
                              <td className={row.goalDifference > 0 ? 'pos' : row.goalDifference < 0 ? 'neg' : ''}>
                                {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                              </td>
                              <td className="stand__pts">{row.points}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>

                    <div className="gcard__footer">
                      <button type="button" className="gcard__toggle" onClick={() => setMatchModalGroupId(group.id)}>
                        {todayMatches > 0 ? <span className="gcard__livetag"><span className="gstatus__pulse" aria-hidden="true" />En direct</span> : null}
                        <span>Programme · {groupMatches.length} matchs</span>
                        <span className="gcard__togglearrow">→</span>
                      </button>
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <BracketBoard
              matches={displayBracket}
              teamsById={teamsById}
              focusId={focusId}
              picks={displayedKnockoutPicks}
              simulationEnabled={mode === 'simulation' && !bracketReadOnly}
              standings={standings}
              groupMatches={mergedMatches}
              lockedMatchIds={lockedMatchIds}
              rewards={bracketRewards}
              knockoutTodayMatchIds={knockoutTodayMatchIds}
              knockoutDayMatchesById={knockoutDayMatchesById}
              openMatchStats={(match) => void openMatchStats(match)}
              shareOwnerName={viewedPublicBracket?.pseudo || publicSimulatorBracket?.pseudo || sharedBracket?.pseudo || challengeProfile.pseudo || 'Brakup'}
              shareOwnerScore={viewedPublicBracket?.score ?? publicSimulatorBracket?.score ?? null}
              existingShareUrl={currentShareUrl}
              readOnlyShare={bracketReadOnly}
              createHref={createFromShareHref}
              createLabel={createFromShareLabel}
              onPick={handlePickWinner}
              onClear={handleClearWinner}
              onFocusChange={setFocusId}
              onFullscreenChange={setIsBracketFullscreen}
            />
          )}
        </main>

        {view === 'bracket' && !isSharedBracketView ? (
          <>
            {sidePanel ? <button type="button" className="float-sidebar__scrim" aria-label="Fermer le panneau lateral" onClick={() => setSidePanel(null)} /> : null}
            <div className={`float-sidebar${sidePanel ? ' has-panel' : ''}`}>
              <div className="float-tabs">
                <button
                  type="button"
                  className={`float-tab${sidePanel === 'brackets' ? ' is-active' : ''}`}
                  onClick={() => {
                    if (sidePanel !== 'brackets' && publicBracketsError) setPublicBracketsLoaded(false)
                    setSidePanel((current) => current === 'brackets' ? null : 'brackets')
                  }}
                >
                  Brackets communaute
                </button>
                {liveSource.topScorers && liveSource.topScorers.length > 0 ? (
                  <button
                    type="button"
                    className={`float-tab${sidePanel === 'scorers' ? ' is-active' : ''}`}
                    onClick={() => setSidePanel((current) => current === 'scorers' ? null : 'scorers')}
                  >
                    Buteurs
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`float-tab${sidePanel === 'groups' ? ' is-active' : ''}`}
                  onClick={() => setSidePanel((current) => current === 'groups' ? null : 'groups')}
                >
                  Groupes
                </button>
                <button
                  type="button"
                  className={`float-tab${sidePanel === 'results' ? ' is-active' : ''}`}
                  onClick={() => setSidePanel((current) => current === 'results' ? null : 'results')}
                >
                  Resultats
                </button>
              </div>

              {sidePanel ? (
                <div className="float-panel">
                  <div className="float-panel__head">
                    <div className="float-panel__title">
                      {sidePanel === 'brackets'
                        ? 'Brackets communaute'
                        : sidePanel === 'scorers'
                          ? 'Top buteurs'
                          : sidePanel === 'groups'
                            ? 'Groupes'
                            : 'Resultats'}
                    </div>
                    <button type="button" className="float-panel__close" onClick={() => setSidePanel(null)} aria-label="Fermer">
                      X
                    </button>
                  </div>

                  <div className="float-panel__body">
                    {sidePanel === 'brackets' ? (
                      <div className="community-brackets">
                        {publicBracketsLoading ? (
                          <div className="float-panel__state float-panel__state--loading">
                            <span className="float-panel__spinner" aria-hidden="true" />
                            <span>Chargement des brackets communaute...</span>
                          </div>
                        ) : null}
                        {publicBracketsError ? <div className="float-panel__state">{publicBracketsError}</div> : null}
                        {!publicBracketsLoading && !publicBracketsError && publicBrackets.length === 0 ? <div className="float-panel__state">Aucun bracket communaute pour le moment.</div> : null}
                        {publicBrackets.map((entry, index) => (
                          <button key={entry.emailHash || entry.pseudo} type="button" className="community-bracket" onClick={() => { setViewedPublicBracket(entry); setSidePanel(null); setFocusId(null) }}>
                            <span className="community-bracket__rank">#{index + 1}</span>
                            <span className="community-bracket__main">
                              <strong>{entry.pseudo}</strong>
                              <small>{entry.bracketName || 'Bracket public'}</small>
                            </span>
                            <span className="community-bracket__score"><b>{entry.score ?? 0}</b><small>pts</small></span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {sidePanel === 'scorers' && liveSource.topScorers && liveSource.topScorers.length > 0 ? (
                      <div className="scorers">
                        {liveSource.topScorers.map((scorer, index) => {
                          const team = teamsByFifaCode.get(scorer.teamCode)
                          return (
                            <div key={`${scorer.name}-${scorer.teamCode}`} className={`scorerrow${index === 0 ? ' is-top' : ''}`}>
                              <span className="scorerrow__rank">{index + 1}</span>
                              {team ? (flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>) : null}
                              <span className="scorerrow__name">{scorer.name}</span>
                              <span className="scorerrow__goals"><b>{scorer.goals}</b></span>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}

                    {sidePanel === 'groups' ? (
                      <div className="float-groups">
                        {seed.groups.map((group) => {
                          const rows = standings[group.id] ?? []
                          const groupMatches = mergedMatches.filter((match) => match.groupId === group.id)
                          const completeCount = groupMatches.filter((match) => inferStatus(match) === 'finished').length
                          return (
                            <section key={group.id} className="float-group">
                              <button type="button" className="float-group__head" onClick={() => setMatchModalGroupId(group.id)}>
                                <span>Groupe {group.id}</span>
                                <small>{completeCount}/{groupMatches.length} joues</small>
                              </button>
                              <div className="float-group__standings">
                                {rows.slice(0, 4).map((row) => {
                                  const team = teamsById.get(row.teamId)
                                  if (!team) return null
                                  return (
                                    <button key={row.teamId} type="button" className={`float-group-row${focusId === team.id ? ' is-focus' : ''}`} onClick={() => setFocusId(focusId === team.id ? null : team.id)}>
                                      <span className="float-group-row__rank">{row.rank}</span>
                                      {flagUrl(team) ? <img src={flagUrl(team)} alt="" className="flag-image" /> : <span className="flag-emoji">{team.flagEmoji}</span>}
                                      <span className="float-group-row__name">{team.shortName || team.name}</span>
                                      <span className="float-group-row__diff">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</span>
                                      <b>{row.points}</b>
                                    </button>
                                  )
                                })}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    ) : null}

                    {sidePanel === 'results' ? (
                      <div className="float-results">
                        {seed.groups.map((group) => {
                          const groupMatches = mergedMatches
                            .filter((match) => match.groupId === group.id)
                            .sort((a, b) => (a.kickoffIso ?? `${a.kickoffDate}T${a.kickoffTime ?? '99:99'}`).localeCompare(b.kickoffIso ?? `${b.kickoffDate}T${b.kickoffTime ?? '99:99'}`))
                          return (
                            <section key={group.id} className="float-group">
                              <button type="button" className="float-group__head" onClick={() => setMatchModalGroupId(group.id)}>
                                <span>Groupe {group.id}</span>
                                <small>{groupMatches.length} matchs</small>
                              </button>
                              <div className="float-result-list">
                                {groupMatches.map((match) => {
                                  const homeTeam = teamsById.get(match.homeTeamId)
                                  const awayTeam = teamsById.get(match.awayTeamId)
                                  if (!homeTeam || !awayTeam) return null
                                  const status = inferStatus(match)
                                  const canOpenStats = status === 'finished' || status === 'live'
                                  return (
                                    <button
                                      key={match.id}
                                      type="button"
                                      className={`float-result${status === 'live' ? ' is-live' : ''}`}
                                      onClick={canOpenStats ? () => void openMatchStats(match) : () => setMatchModalGroupId(group.id)}
                                    >
                                      <span className="float-result__teams">
                                        <span>{homeTeam.shortName || homeTeam.name}</span>
                                        <i>{awayTeam.shortName || awayTeam.name}</i>
                                      </span>
                                      <span className="float-result__score">
                                        {status === 'scheduled'
                                          ? formatKickoffTime(match) || 'A venir'
                                          : `${match.homeScore ?? '-'}:${match.awayScore ?? '-'}`}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      {completeBonusNoticeOpen ? (
        <div className="simulator-outcome is-correct" role="dialog" aria-modal="true">
          <div className="simulator-outcome__blast" aria-hidden="true">
            <i />
            {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ ['--ray-rot' as string]: `${i * (360 / 14)}deg` }} />)}
          </div>
          <div className="simulator-outcome__panel">
            <img className="simulator-outcome__logo" src="/brakup-challenge-logo.png" alt="Brakup Challenge" />
            <div className="simulator-outcome__boom">BOOM !</div>
            <div className="simulator-outcome__points">
              <strong>+20</strong>
              <span>BRACKET COMPLET</span>
            </div>
            <p>Tu as rempli tout ton bracket — bonus complet ajouté au score.</p>
            <div className="simulator-outcome__actions">
              <button type="button" className="chip-btn chip-btn--sm" onClick={() => dispatchBracketAction('bracket:share')}>
                Partager image
              </button>
              <button type="button" className="chip-btn chip-btn--sm" onClick={() => setCompleteBonusNoticeOpen(false)}>
                Continuer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {simulatorOutcomeNotices.length > 0 ? (() => {
        const totalPoints = simulatorOutcomeNotices.reduce((sum, item) => {
          const r = bracketRewards.rewardsByMatch.get(item.match.id)
          return sum + (r?.points ?? 0)
        }, 0)
        const anyCorrect = simulatorOutcomeNotices.some((item) => item.match.predictionState === 'correct')
        const allWrong = simulatorOutcomeNotices.every((item) => item.match.predictionState === 'wrong')
        const boomLabel = simulatorOutcomeNotices.length === 1
          ? (anyCorrect ? 'PRONO OK !' : 'PRONO RATÉ')
          : (allWrong ? 'TOUS RATÉS' : anyCorrect ? 'RÉSULTATS !' : 'RÉSULTATS')
        return (
          <div className={`simulator-outcome${anyCorrect ? ' is-correct' : ' is-wrong'}`} role="dialog" aria-modal="true">
            <div className="simulator-outcome__blast" aria-hidden="true">
              <i />
              {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ ['--ray-rot' as string]: `${i * (360 / 14)}deg` }} />)}
            </div>
            <div className="simulator-outcome__panel">
              <img className="simulator-outcome__logo" src="/brakup-challenge-logo.png" alt="Brakup Challenge" />
              <div className="simulator-outcome__boom">{boomLabel}</div>
              <div className="simulator-outcome__points">
                <strong>{totalPoints > 0 ? `+${totalPoints}` : '0'}</strong>
                <span>POINTS GAGNÉS</span>
              </div>
              <div className="simulator-outcome__summary">
                {simulatorOutcomeNotices.map((item) => {
                  const reward = bracketRewards.rewardsByMatch.get(item.match.id)
                  const pickedTeam = item.match.pickedWinnerId ? teamsById.get(item.match.pickedWinnerId) ?? null : null
                  const realTeam = item.match.realWinnerId ? teamsById.get(item.match.realWinnerId) ?? null : null
                  const correct = item.match.predictionState === 'correct'
                  return (
                    <span key={item.key}>
                      <i className={`simulator-outcome__result-icon${correct ? ' is-correct' : ' is-wrong'}`}>{correct ? '✓' : '✗'}</i>
                      <span className="simulator-outcome__result-label">{item.match.label} · {correct ? pickedTeam?.name : `${pickedTeam?.name ?? '?'} → ${realTeam?.name ?? '?'}`}</span>
                      <strong>{reward && reward.points > 0 ? `+${reward.points}` : '0 pt'}</strong>
                    </span>
                  )
                })}
              </div>
              <div className="simulator-outcome__actions">
                <button type="button" className="chip-btn chip-btn--sm" onClick={() => dispatchBracketAction('bracket:share')}>
                  Partager image
                </button>
                <button type="button" className="chip-btn chip-btn--sm" onClick={closeSimulatorOutcomeNotice}>
                  OK
                </button>
              </div>
            </div>
          </div>
        )
      })() : null}
      {showChallengeLoginEntry ? <LoginEntry initialEmail={challengeProfile.email} busy={challengeLoginBusy} error={challengeLoginError} sent={challengeLoginSent} onSubmit={handleChallengeLogin} onVerify={handleChallengeLoginOTP} onResend={handleChallengeResend} onCancel={() => setShowChallengeLoginEntry(false)} /> : null}
      {classicProfileSettingsOpen ? (
        <ProfileSettings
          initialEmail={challengeProfile.email}
          initialPseudo={challengeProfile.pseudo}
          busy={classicProfileBusy}
          error={classicProfileError}
          status={classicProfileStatus}
          onSubmit={handleClassicProfileUpdate}
          onClose={() => setClassicProfileSettingsOpen(false)}
        />
      ) : null}
      {matchStatsModal ? (() => {
        const { match, homeTeam, awayTeam } = matchStatsModal
        const effectiveStatus = inferStatus(match)
        const msHomeWin = effectiveStatus === 'finished' && match.homeScore !== null && match.awayScore !== null && match.homeScore > match.awayScore
        const msAwayWin = effectiveStatus === 'finished' && match.homeScore !== null && match.awayScore !== null && match.awayScore > match.homeScore
        const statsKickoffDate = new Date(match.kickoffIso ?? `${match.kickoffDate}T12:00:00Z`)
        const statsDateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(statsKickoffDate)
        const statsKickoffTime = match.kickoffIso
          ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(match.kickoffIso))
          : match.kickoffTime

        return (
          <div className="statsmodal" role="dialog" aria-modal="true">
            <div className="statsmodal__scrim" onClick={() => setMatchStatsModal(null)} />
            <div className="statsmodal__panel">
              <button type="button" className="statsmodal__close" onClick={() => setMatchStatsModal(null)} aria-label="Fermer">×</button>

              {/* Header */}
              <div className="statsmodal__header">
                <div className={`statsmodal__team${msHomeWin ? ' is-winner' : msAwayWin ? ' is-loser' : ''}`}>
                  {flagUrl(homeTeam) ? <img src={flagUrl(homeTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{homeTeam.flagEmoji}</span>}
                  <span>{homeTeam.name}</span>
                </div>
                <div className="statsmodal__score">
                  <div className="statsmodal__status">
                    {effectiveStatus === 'live' ? formatLiveMinute(match.liveMinute, liveSource.syncedAt).toUpperCase() : effectiveStatus === 'finished' ? 'TERMINÉ' : 'BIENTÔT'}
                  </div>
                  <div className="statsmodal__digits">
                    <span className={msHomeWin ? 'is-winner-score' : ''}>{match.homeScore ?? '–'}</span>
                    <i>:</i>
                    <span className={msAwayWin ? 'is-winner-score' : ''}>{match.awayScore ?? '–'}</span>
                  </div>
                </div>
                <div className={`statsmodal__team statsmodal__team--right${msAwayWin ? ' is-winner' : msHomeWin ? ' is-loser' : ''}`}>
                  <span>{awayTeam.name}</span>
                  {flagUrl(awayTeam) ? <img src={flagUrl(awayTeam)} alt="" className="daymatch__flag-image" /> : <span className="daymatch__flag">{awayTeam.flagEmoji}</span>}
                </div>
              </div>

              <div className="statsmodal__matchinfo">
                <span>{statsDateLabel}{statsKickoffTime ? ` · ${statsKickoffTime}` : ' · heure a confirmer'}</span>
                <strong>{match.venue || 'Stade a confirmer'}</strong>
              </div>

              {/* Odds probability bar */}
              {(() => {
                const odds = getMatchOdds(match.homeTeamId, match.awayTeamId)
                if (!odds) return null
                const swapped = !oddsData![`${match.homeTeamId}-${match.awayTeamId}`]
                const homeProb = swapped ? odds.away.prob : odds.home.prob
                const awayProb = swapped ? odds.home.prob : odds.away.prob
                const drawProb = odds.draw.prob
                const homeOdds = swapped ? odds.away.avgOdds : odds.home.avgOdds
                const awayOdds = swapped ? odds.home.avgOdds : odds.away.avgOdds
                return (
                  <div className="statsmodal__odds">
                    <div className="statsmodal__odds-bar">
                      <div className="statsmodal__odds-seg statsmodal__odds-seg--home" style={{ width: `${homeProb}%` }} />
                      <div className="statsmodal__odds-seg statsmodal__odds-seg--draw" style={{ width: `${drawProb}%` }} />
                      <div className="statsmodal__odds-seg statsmodal__odds-seg--away" style={{ width: `${awayProb}%` }} />
                    </div>
                    <div className="statsmodal__odds-labels">
                      <span className="statsmodal__odds-pct statsmodal__odds-pct--home">
                        <b>{homeProb}%</b>
                        <span>{homeOdds.toFixed(2)}</span>
                      </span>
                      <span className="statsmodal__odds-pct statsmodal__odds-pct--draw">
                        <b>{drawProb}%</b>
                        <span>X {odds.draw.avgOdds.toFixed(2)}</span>
                      </span>
                      <span className="statsmodal__odds-pct statsmodal__odds-pct--away">
                        <b>{awayProb}%</b>
                        <span>{awayOdds.toFixed(2)}</span>
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Body */}
              <div className="statsmodal__body">
                {matchStatsLoading ? (
                  <div className="statsmodal__loading">
                    <BootLoaderMark className="boot-loader__mark boot-loader__mark--sm" />
                    <span className="boot-loader__label" style={{ fontSize: 11 }}>Chargement des stats</span>
                  </div>
                ) : !match.fifaMatchPath ? (
                  <div className="statsmodal__empty">Stats disponibles après synchronisation.</div>
                ) : !matchStatsData ? (
                  <div className="statsmodal__empty">
                    <div>Stats indisponibles pour ce match.</div>
                    <button type="button" className="statsmodal__refresh-btn" onClick={() => void refreshMatchStats()}>Réessayer</button>
                  </div>
                ) : (
                  <>
                    {/* Match stats table */}
                    {matchStatsData.stats ? (() => {
                      const s = matchStatsData.stats
                      const rows: Array<{ label: string; home: number; away: number }> = [
                        { label: 'Tirs', home: s.home.shots, away: s.away.shots },
                        { label: 'Corners', home: s.home.corners, away: s.away.corners },
                        { label: 'Fautes', home: s.home.fouls, away: s.away.fouls },
                        { label: 'Jaunes', home: s.home.yellowCards, away: s.away.yellowCards },
                        { label: 'Rouges', home: s.home.redCards, away: s.away.redCards },
                      ].filter(r => r.home > 0 || r.away > 0)
                      if (!rows.length) return null
                      return (
                        <div className="statsmodal__statstable">
                          {rows.map((r, i) => (
                            <div key={i} className="statsmodal__statsrow">
                              <span className="statsmodal__statsval statsmodal__statsval--home">{r.home}</span>
                              <span className="statsmodal__statslabel">{r.label}</span>
                              <span className="statsmodal__statsval statsmodal__statsval--away">{r.away}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })() : null}

                    {/* Goals */}
                    {matchStatsData.goals.length > 0 ? (
                      <div className="statsmodal__goals-section">
                        <div className="statsmodal__scorers-title">Buts</div>
                        {matchStatsData.goals.map((g, i) => {
                          const isHome = g.team === (matchStatsData.home.code ?? homeTeam.fifaCode)
                          return (
                            <div key={i} className={`statsmodal__scorer statsmodal__scorer--${isHome ? 'home' : 'away'}`}>
                              {isHome ? (
                                <>
                                  <span className="statsmodal__scorer-name">⚽ {g.name}</span>
                                  <span className="statsmodal__scorer-min">{g.minute}</span>
                                  <span />
                                </>
                              ) : (
                                <>
                                  <span />
                                  <span className="statsmodal__scorer-min">{g.minute}</span>
                                  <span className="statsmodal__scorer-name statsmodal__scorer-name--away">⚽ {g.name}</span>
                                </>
                              )}
                            </div>
                          )
                        })}
                        <section className="float-group">
                          <button type="button" className="float-group__head">
                            <span>Phase finale</span>
                            <small>{knockoutDayMatches.length} matchs</small>
                          </button>
                          <div className="float-result-list">
                            {knockoutDayMatches.map((match) => {
                              const homeTeam = teamsById.get(match.homeTeamId)
                              const awayTeam = teamsById.get(match.awayTeamId)
                              const status = inferStatus(match)
                              const canOpenStats = Boolean(match.fifaMatchPath) && (status === 'finished' || status === 'live') && homeTeam && awayTeam
                              return (
                                <button
                                  key={match.id}
                                  type="button"
                                  className={`float-result${status === 'live' ? ' is-live' : ''}`}
                                  onClick={canOpenStats && homeTeam && awayTeam ? () => void openMatchStats(match as GroupMatch) : undefined}
                                >
                                  <span className="float-result__teams">
                                    <span>{homeTeam?.shortName || match.homeLabel || match.homeTeamId.replace(/^placeholder:[^:]+:/, '')}</span>
                                    <i>{awayTeam?.shortName || match.awayLabel || match.awayTeamId.replace(/^placeholder:[^:]+:/, '')}</i>
                                  </span>
                                  <span className="float-result__score">
                                    {status === 'scheduled'
                                      ? formatKickoffTime(match) || 'A venir'
                                      : `${match.homeScore ?? '-'}:${match.awayScore ?? '-'}`}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </section>
                      </div>
                    ) : null}

                    {/* Home lineup */}
                    <div className="statsmodal__lineup">
                      <div className="statsmodal__scorers-title">
                        {matchStatsData.home.code ?? homeTeam.fifaCode}
                        {matchStatsData.home.tactics ? <span className="statsmodal__lineup-tactics">{matchStatsData.home.tactics}</span> : null}
                      </div>
                      {matchStatsData.home.coach ? (
                        <div className="statsmodal__player" style={{ opacity: 0.6, fontSize: 11 }}>Coach · {matchStatsData.home.coach}</div>
                      ) : null}
                      {matchStatsData.home.players.filter(p => p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">TITULAIRES</div>
                          {matchStatsData.home.players.filter(p => p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      {matchStatsData.home.players.filter(p => !p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">REMPLAÇANTS</div>
                          {matchStatsData.home.players.filter(p => !p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>

                    {/* Away lineup */}
                    <div className="statsmodal__lineup">
                      <div className="statsmodal__scorers-title">
                        {matchStatsData.away.code ?? awayTeam.fifaCode}
                        {matchStatsData.away.tactics ? <span className="statsmodal__lineup-tactics">{matchStatsData.away.tactics}</span> : null}
                      </div>
                      {matchStatsData.away.coach ? (
                        <div className="statsmodal__player" style={{ opacity: 0.6, fontSize: 11 }}>Coach · {matchStatsData.away.coach}</div>
                      ) : null}
                      {matchStatsData.away.players.filter(p => p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">TITULAIRES</div>
                          {matchStatsData.away.players.filter(p => p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      {matchStatsData.away.players.filter(p => !p.starter).length > 0 ? (
                        <>
                          <div className="statsmodal__lineup-title">REMPLAÇANTS</div>
                          {matchStatsData.away.players.filter(p => !p.starter).map((p, i) => (
                            <div key={i} className="statsmodal__player">
                              <span className="statsmodal__player-shirt">{p.shirt}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>

                    {/* Attendance */}
                    {matchStatsData.attendance ? (
                      <div className="statsmodal__player" style={{ opacity: 0.55, fontSize: 11, marginTop: 8 }}>
                        Affluence · {Number(matchStatsData.attendance).toLocaleString('fr-FR')}
                      </div>
                    ) : null}

                    {/* Empty state */}
                    {matchStatsData.goals.length === 0 && matchStatsData.home.players.length === 0 && matchStatsData.away.players.length === 0 ? (
                      <div className="statsmodal__empty" style={{ fontSize: 12 }}>
                        Données non disponibles — le moteur FIFA charge les données en direct.
                        <br />
                        <button type="button" className="statsmodal__refresh-btn" style={{ marginTop: 10 }} onClick={() => void refreshMatchStats()}>↻ Actualiser</button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div className="statsmodal__foot">
                <span>Groupe {match.groupId} · {match.venue}</span>
                {match.fifaMatchPath && !matchStatsLoading ? (
                  <button type="button" className="statsmodal__refresh-btn" onClick={() => void refreshMatchStats()} title="Actualiser les stats">↻</button>
                ) : null}
              </div>
            </div>
          </div>
        )
      })() : null}
    </div>
  )
}

export default App
