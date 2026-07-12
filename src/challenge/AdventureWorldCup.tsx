import { useEffect, useMemo, useRef, useState } from 'react'
import BattleEngine from '../components/battle/BattleEngine'
import { getAdventureProgress, saveAdventureProgress } from '../lib/challengeData'
import { buildKnockoutBracket, computeStandings, getBestThirdPlacedTeams, knockoutTemplates } from '../lib/tournament'
import { sfx } from '../lib/sfx'
import type { AdventureProgressEntry, AdventureScore, BattleDifficultySetting, BattleResult, GroupMatch, KnockoutEntrant, KnockoutMatch, RankedStandingRow, Team } from '../types'
import WorldCupMapMenu from './WorldCupMapMenu'

type AdventureBattle = {
  kind: 'group' | 'knockout' | 'daily'
  match: KnockoutMatch
  sourceId: string
  playerSide: 'home' | 'away'
}

type TodayMatch = GroupMatch & {
  homeLabel?: string
  awayLabel?: string
  dayStageLabel?: string
  dayMatchLabel?: string
}

type AdventureSave = {
  teamId: string | null
  groupScores: Record<string, AdventureScore>
  knockoutScores: Record<string, AdventureScore>
  knockoutWinners: Record<string, string>
  updatedAt: string
}

type DailyMatchResult = {
  score: AdventureScore
  playerSide: 'home' | 'away'
  playedAt: string
}

type AdventureWorldCupProps = {
  teams: Team[]
  groupMatches: GroupMatch[]
  teamsById: Map<string, Team>
  difficultySetting: BattleDifficultySetting
  onDifficultyChange: (difficulty: BattleDifficultySetting) => void
  onOpenOfficial: () => void
  challengeToken?: string | null
  todayMatches?: TodayMatch[]
}

const STORAGE_KEY = 'brakup:worldcup-adventure:v1'
const DAILY_RESULTS_STORAGE_KEY = 'brakup:worldcup-adventure:daily-results:v1'
const GROUP_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
function readAdventureSave(): AdventureSave {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AdventureSave>
    return {
      teamId: typeof parsed.teamId === 'string' ? parsed.teamId : null,
      groupScores: parsed.groupScores && typeof parsed.groupScores === 'object' ? parsed.groupScores : {},
      knockoutScores: parsed.knockoutScores && typeof parsed.knockoutScores === 'object' ? parsed.knockoutScores : {},
      knockoutWinners: parsed.knockoutWinners && typeof parsed.knockoutWinners === 'object' ? parsed.knockoutWinners : {},
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '1970-01-01T00:00:00.000Z',
    }
  } catch {
    return { teamId: null, groupScores: {}, knockoutScores: {}, knockoutWinners: {}, updatedAt: '1970-01-01T00:00:00.000Z' }
  }
}

function adventureEntryToSave(entry: AdventureProgressEntry): AdventureSave {
  return {
    teamId: entry.teamId,
    groupScores: entry.groupScores ?? {},
    knockoutScores: entry.knockoutScores ?? {},
    knockoutWinners: entry.knockoutWinners ?? {},
    updatedAt: entry.updatedAt,
  }
}

function touchAdventureSave(save: Omit<AdventureSave, 'updatedAt'>): AdventureSave {
  return { ...save, updatedAt: new Date().toISOString() }
}

function readDailyResults(): Record<string, DailyMatchResult> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DAILY_RESULTS_STORAGE_KEY) ?? '{}') as Record<string, DailyMatchResult>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function hashString(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

const FIFA_RANK_BY_CODE: Record<string, number> = {
  FRA: 1,
  ARG: 2,
  ESP: 3,
  ENG: 4,
  BRA: 5,
  MAR: 6,
  POR: 7,
  BEL: 8,
  NED: 9,
  MEX: 10,
  CRO: 11,
  COL: 12,
  URU: 13,
  USA: 14,
  GER: 15,
  SUI: 16,
  JPN: 17,
  SEN: 18,
  IRN: 19,
  KOR: 20,
  ECU: 22,
  AUT: 23,
  AUS: 24,
  TUR: 25,
  NOR: 26,
  CAN: 27,
  SWE: 29,
  QAT: 30,
  EGY: 34,
  CIV: 35,
  TUN: 36,
  ALG: 39,
  SCO: 40,
  PAR: 42,
  GHA: 50,
  KSA: 51,
  RSA: 60,
  PAN: 61,
  CPV: 66,
  JOR: 68,
  UZB: 72,
  IRQ: 82,
  NZL: 84,
  HAI: 86,
  CZE: 89,
  BIH: 90,
  COD: 92,
  CUW: 94,
}

const TEAM_STAT_PROFILE_BY_CODE: Record<string, { att?: number; mid?: number; def?: number }> = {
  FRA: { att: 3, mid: 2, def: 2 },
  ARG: { att: 2, mid: 3, def: 1 },
  ESP: { att: 1, mid: 4, def: 2 },
  ENG: { att: 2, mid: 2, def: 1 },
  BRA: { att: 4, mid: 1, def: 0 },
  POR: { att: 3, mid: 2, def: 0 },
  NED: { att: 1, mid: 2, def: 3 },
  MAR: { att: 1, mid: 2, def: 4 },
  BEL: { att: 2, mid: 2, def: 0 },
  GER: { att: 2, mid: 2, def: 0 },
  URU: { att: 1, mid: 2, def: 3 },
  CRO: { att: 0, mid: 4, def: 1 },
  COL: { att: 2, mid: 2, def: 1 },
  SUI: { att: 0, mid: 2, def: 3 },
  NOR: { att: 5, mid: 2, def: -1 },
  SEN: { att: 1, mid: 1, def: 3 },
  USA: { att: 1, mid: 2, def: 0 },
  MEX: { att: 1, mid: 1, def: 1 },
  JPN: { att: 1, mid: 3, def: 1 },
  KOR: { att: 2, mid: 1, def: 0 },
  EGY: { att: 3, mid: 0, def: 0 },
  SWE: { att: 1, mid: 1, def: 2 },
  CIV: { att: 2, mid: 1, def: 0 },
  GHA: { att: 2, mid: 0, def: -1 },
  CPV: { att: 0, mid: 1, def: 2 },
}

function clampRating(value: number) {
  return Math.max(58, Math.min(97, Math.round(value)))
}

function overallFromRank(rank: number) {
  if (rank <= 4) return 97 - rank
  if (rank <= 10) return 93 - (rank - 4) * 0.65
  if (rank <= 20) return 89 - (rank - 10) * 0.48
  if (rank <= 40) return 84.2 - (rank - 20) * 0.25
  if (rank <= 70) return 79.2 - (rank - 40) * 0.2
  if (rank <= 100) return 73.2 - (rank - 70) * 0.18
  return 67
}

function teamRating(teamOrCode?: Team | string) {
  const code = typeof teamOrCode === 'string' ? teamOrCode : teamOrCode?.fifaCode ?? teamOrCode?.id ?? ''
  const rank = FIFA_RANK_BY_CODE[code] ?? 96
  const overall = clampRating(overallFromRank(rank))
  const profile = TEAM_STAT_PROFILE_BY_CODE[code] ?? {}
  return {
    rank,
    overall,
    att: clampRating(overall + (profile.att ?? 0)),
    mid: clampRating(overall + (profile.mid ?? 0)),
    def: clampRating(overall + (profile.def ?? 0)),
  }
}

function teamPower(teamId: string) {
  return teamRating(teamId).overall
}

function simulatedScore(matchId: string, homeTeamId: string, awayTeamId: string): AdventureScore {
  const homePower = teamPower(homeTeamId)
  const awayPower = teamPower(awayTeamId)
  const seed = hashString(`${matchId}:${homeTeamId}:${awayTeamId}`)
  const homeBase = seed % 3
  const awayBase = Math.floor(seed / 7) % 3
  const diff = Math.round((homePower - awayPower) / 18)
  let home = Math.max(0, homeBase + Math.max(0, diff))
  let away = Math.max(0, awayBase + Math.max(0, -diff))
  if (home === away && (seed % 5 === 0)) {
    if (homePower >= awayPower) home += 1
    else away += 1
  }
  return { home: Math.min(home, 5), away: Math.min(away, 5) }
}

function knockoutWinner(matchId: string, homeTeamId: string, awayTeamId: string, score: AdventureScore) {
  if (score.home > score.away) return homeTeamId
  if (score.away > score.home) return awayTeamId
  return teamPower(homeTeamId) + hashString(matchId) % 7 >= teamPower(awayTeamId) + hashString(`${matchId}:away`) % 7
    ? homeTeamId
    : awayTeamId
}

function teamName(team?: Team) {
  return team?.shortName || team?.name || 'Équipe'
}

function teamFlagImageUrl(team?: Team) {
  if (!team?.iso2) return null
  return `https://flagcdn.com/w80/${team.iso2.toLowerCase()}.png`
}

function Flag({ team }: { team?: Team }) {
  const src = teamFlagImageUrl(team)
  if (src) return <img src={src} alt="" crossOrigin="anonymous" />
  return <span>{team?.flagEmoji ?? '🌍'}</span>
}

function groupMatchToBattle(match: GroupMatch): KnockoutMatch {
  return {
    id: match.id,
    stage: `J${match.matchday}`,
    label: `Groupe ${match.groupId} · J${match.matchday}`,
    dateLabel: match.kickoffDate,
    home: { kind: 'team', teamId: match.homeTeamId },
    away: { kind: 'team', teamId: match.awayTeamId },
    qualificationStatus: 'confirmed',
  }
}

function todayMatchToBattle(match: TodayMatch): KnockoutMatch {
  return {
    id: match.id,
    stage: match.dayStageLabel ?? (match.groupId ? 'Group stage' : 'Official match'),
    label: match.dayMatchLabel ?? (match.groupId ? `Groupe ${match.groupId}` : match.id),
    dateLabel: match.kickoffDate,
    home: { kind: 'team', teamId: match.homeTeamId },
    away: { kind: 'team', teamId: match.awayTeamId },
    qualificationStatus: 'confirmed',
  }
}

function scoreFromBattleResult(result: BattleResult, playerSide: 'home' | 'away', match: KnockoutMatch): AdventureScore {
  const rawHomeId = match.home.kind === 'team' ? match.home.teamId : null
  const rawAwayId = match.away.kind === 'team' ? match.away.teamId : null
  const controlledTeamId = playerSide === 'away' ? rawAwayId : rawHomeId
  const opponentTeamId = playerSide === 'away' ? rawHomeId : rawAwayId
  if (rawHomeId === controlledTeamId && rawAwayId === opponentTeamId) {
    return { home: result.homeScore, away: result.awayScore }
  }
  if (rawHomeId === opponentTeamId && rawAwayId === controlledTeamId) {
    return { home: result.awayScore, away: result.homeScore }
  }
  return playerSide === 'home'
    ? { home: result.homeScore, away: result.awayScore }
    : { home: result.awayScore, away: result.homeScore }
}

function applyGroupScores(matches: GroupMatch[], scores: Record<string, AdventureScore>) {
  return matches.map((match) => {
    const score = scores[match.id]
    if (!score) return { ...match, homeScore: null, awayScore: null, status: 'scheduled' as const }
    return { ...match, homeScore: score.home, awayScore: score.away, status: 'finished' as const }
  })
}

function resolveEntrant(source: (typeof knockoutTemplates)[number]['home'], resolved: Map<string, KnockoutMatch>, winners: Record<string, string>): KnockoutEntrant {
  if ('matchId' in source) {
    const previous = resolved.get(source.matchId)
    const winner = winners[source.matchId]
    if (!previous || !winner) return { kind: 'placeholder', label: `${source.type === 'loserOf' ? 'Perdant' : 'Vainqueur'} ${source.matchId}` }
    if (source.type === 'winnerOf') return { kind: 'team', teamId: winner }
    const participants = [previous.home, previous.away].flatMap((entrant) => entrant.kind === 'team' ? [entrant.teamId] : [])
    const loser = participants.find((teamId) => teamId !== winner)
    return loser ? { kind: 'team', teamId: loser } : { kind: 'placeholder', label: `Perdant ${source.matchId}` }
  }
  return { kind: 'placeholder', label: 'À déterminer' }
}

function resolveKnockoutMatches(baseMatches: KnockoutMatch[], winners: Record<string, string>) {
  const baseMap = new Map(baseMatches.map((match) => [match.id, match]))
  const resolved = new Map<string, KnockoutMatch>()

  for (const template of knockoutTemplates) {
    const base = baseMap.get(template.id)
    const matchNumber = Number(template.id.slice(1))
    const match: KnockoutMatch = {
      id: template.id,
      stage: template.stage,
      label: template.label,
      dateLabel: template.dateLabel,
      qualificationStatus: base?.qualificationStatus,
      home: matchNumber <= 88 ? base?.home ?? { kind: 'placeholder', label: 'À déterminer' } : resolveEntrant(template.home, resolved, winners),
      away: matchNumber <= 88 ? base?.away ?? { kind: 'placeholder', label: 'À déterminer' } : resolveEntrant(template.away, resolved, winners),
    }
    resolved.set(match.id, match)
  }

  return [...resolved.values()]
}

function teamInMatch(match: KnockoutMatch, teamId: string | null) {
  if (!teamId) return false
  return match.home.kind === 'team' && match.home.teamId === teamId || match.away.kind === 'team' && match.away.teamId === teamId
}

function buildAutoKnockoutState(
  baseMatches: KnockoutMatch[],
  initialWinners: Record<string, string>,
  initialScores: Record<string, AdventureScore>,
  playerTeamId: string | null,
) {
  let winners = { ...initialWinners }
  const scores = { ...initialScores }
  let resolved = resolveKnockoutMatches(baseMatches, winners)
  let changed = true

  while (changed) {
    changed = false
    for (const match of resolved) {
      if (winners[match.id] || match.home.kind !== 'team' || match.away.kind !== 'team') continue
      if (teamInMatch(match, playerTeamId)) continue
      const score = simulatedScore(match.id, match.home.teamId, match.away.teamId)
      scores[match.id] = score
      winners[match.id] = knockoutWinner(match.id, match.home.teamId, match.away.teamId, score)
      changed = true
    }
    if (changed) resolved = resolveKnockoutMatches(baseMatches, winners)
  }

  return { matches: resolved, winners, scores }
}

function firstPendingPlayerGroupMatch(matches: GroupMatch[], playerTeamId: string | null, scores: Record<string, AdventureScore>) {
  if (!playerTeamId) return null
  return matches.find((match) => (
    (match.homeTeamId === playerTeamId || match.awayTeamId === playerTeamId) && !scores[match.id]
  )) ?? null
}

function playerSideForGroupMatch(match: GroupMatch, playerTeamId: string): 'home' | 'away' {
  return match.awayTeamId === playerTeamId ? 'away' : 'home'
}

function playerSideForKnockoutMatch(match: KnockoutMatch, playerTeamId: string): 'home' | 'away' {
  return match.away.kind === 'team' && match.away.teamId === playerTeamId ? 'away' : 'home'
}

function buildInitialGroupScores(groupMatches: GroupMatch[], playerTeamId: string) {
  void groupMatches
  void playerTeamId
  return {}
}

function simulateGroupScoresThroughMatchday(
  groupMatches: GroupMatch[],
  playerTeamId: string,
  currentScores: Record<string, AdventureScore>,
  upToMatchday: number,
) {
  const scores: Record<string, AdventureScore> = {}
  for (const [matchId, score] of Object.entries(currentScores)) {
    scores[matchId] = score
  }
  for (const match of groupMatches) {
    if (match.matchday > upToMatchday || scores[match.id]) continue
    const involvesPlayer = match.homeTeamId === playerTeamId || match.awayTeamId === playerTeamId
    if (involvesPlayer) continue
    scores[match.id] = simulatedScore(match.id, match.homeTeamId, match.awayTeamId)
  }
  return scores
}

function rankText(row?: RankedStandingRow) {
  if (!row) return 'Non classé'
  return `${row.rank}e · ${row.points} pts · ${row.goalDifference >= 0 ? '+' : ''}${row.goalDifference}`
}

function rankName(rank: number) {
  if (rank === 1) return 'première place'
  if (rank === 2) return 'deuxième place'
  if (rank === 3) return 'troisième place'
  return `${rank}e place`
}

function rankMovementNotice(previousRank?: number, nextRank?: number) {
  if (!previousRank || !nextRank || previousRank === nextRank || nextRank > 3 && previousRank > 3) return null
  if (nextRank < previousRank) {
    return {
      tone: 'success' as const,
      title: 'Félicitations !',
      text: `Tu prends la ${rankName(nextRank)} du groupe.`,
    }
  }
  return {
    tone: 'danger' as const,
    title: 'Oups...',
    text: `Tu descends à la ${rankName(nextRank)} du groupe.`,
  }
}

export default function AdventureWorldCup({
  teams,
  groupMatches,
  teamsById,
  difficultySetting,
  onDifficultyChange,
  onOpenOfficial,
  challengeToken = null,
  todayMatches = [],
}: AdventureWorldCupProps) {
  const [save, setSave] = useState<AdventureSave>(readAdventureSave)
  const [battle, setBattle] = useState<AdventureBattle | null>(null)
  const [showTodayMatches, setShowTodayMatches] = useState(false)
  const [showStandings, setShowStandings] = useState(false)
  const [showAdventureMenu, setShowAdventureMenu] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [simulationOpen, setSimulationOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'trophy'; title: string; text: string } | null>(null)
  const [seenNoticeKey, setSeenNoticeKey] = useState<string | null>(null)
  const [teamCarouselIndex, setTeamCarouselIndex] = useState(0)
  const [dailyResults, setDailyResults] = useState<Record<string, DailyMatchResult>>(readDailyResults)
  const [remoteHydratedTick, setRemoteHydratedTick] = useState(0)
  const remoteHydratedRef = useRef(!challengeToken)
  const remoteSaveTimerRef = useRef<number | null>(null)
  const lastRemotePayloadRef = useRef('')
  const selectedTeam = save.teamId ? teamsById.get(save.teamId) : undefined
  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => teamName(a).localeCompare(teamName(b), 'fr', { sensitivity: 'base' })),
    [teams],
  )
  const carouselTeam = sortedTeams.length ? sortedTeams[Math.min(teamCarouselIndex, sortedTeams.length - 1)] : undefined
  const carouselTeamRating = teamRating(carouselTeam)
  const carouselTeamPower = carouselTeam ? carouselTeamRating.overall : 0
  const carouselTeamStats = carouselTeam ? [
    { label: 'ATT', val: carouselTeamRating.att },
    { label: 'MIL', val: carouselTeamRating.mid },
    { label: 'DEF', val: carouselTeamRating.def },
  ] : []
  const carouselGroupTeams = useMemo(
    () => carouselTeam ? teams.filter((team) => team.groupId === carouselTeam.groupId) : [],
    [carouselTeam, teams],
  )
  const carouselOtherTeams = carouselGroupTeams.filter((team) => team.id !== carouselTeam?.id)
  const selectedGroupId = selectedTeam?.groupId ?? null
  const selectedGroupMatches = useMemo(
    () => selectedGroupId ? groupMatches.filter((match) => match.groupId === selectedGroupId) : [],
    [groupMatches, selectedGroupId],
  )
  const selectedTeamMatches = useMemo(
    () => save.teamId ? selectedGroupMatches.filter((match) => match.homeTeamId === save.teamId || match.awayTeamId === save.teamId) : [],
    [save.teamId, selectedGroupMatches],
  )
  const scoredGroupMatches = useMemo(() => applyGroupScores(groupMatches, save.groupScores), [groupMatches, save.groupScores])
  const standings = useMemo(() => computeStandings(teams, scoredGroupMatches), [scoredGroupMatches, teams])
  const bestThirds = useMemo(() => getBestThirdPlacedTeams(standings), [standings])
  const playerStanding = selectedGroupId && save.teamId ? standings[selectedGroupId]?.find((row) => row.teamId === save.teamId) : undefined
  const groupComplete = selectedTeamMatches.length > 0 && selectedTeamMatches.every((match) => Boolean(save.groupScores[match.id]))
  const qualified = Boolean(playerStanding && (playerStanding.rank <= 2 || bestThirds.some((row) => row.teamId === playerStanding.teamId)))
  const baseKnockoutMatches = useMemo(() => buildKnockoutBracket(standings, scoredGroupMatches), [scoredGroupMatches, standings])
  const autoKnockoutState = useMemo(
    () => buildAutoKnockoutState(baseKnockoutMatches, save.knockoutWinners, save.knockoutScores, qualified ? save.teamId : null),
    [baseKnockoutMatches, qualified, save.knockoutScores, save.knockoutWinners, save.teamId],
  )
  const nextGroupMatch = firstPendingPlayerGroupMatch(selectedTeamMatches, save.teamId, save.groupScores)
  const nextKnockoutMatch = qualified && save.teamId
    ? autoKnockoutState.matches.find((match) => teamInMatch(match, save.teamId) && !save.knockoutWinners[match.id]) ?? null
    : null
  const playerKnockoutPath = qualified && save.teamId
    ? autoKnockoutState.matches.filter((match) => teamInMatch(match, save.teamId) && (save.knockoutWinners[match.id] || match.id === nextKnockoutMatch?.id))
    : []
  const playerEliminated = Boolean(save.teamId && groupComplete && (!qualified || !nextKnockoutMatch && !autoKnockoutState.winners.M104))
  const playerChampion = Boolean(save.teamId && autoKnockoutState.winners.M104 === save.teamId)
  const playerGroupEliminated = Boolean(save.teamId && groupComplete && !qualified)
  const simulatedChampion = autoKnockoutState.winners.M104 ? teamsById.get(autoKnockoutState.winners.M104) : undefined
  const simulatedFinal = autoKnockoutState.matches.find((match) => match.id === 'M104')
  const simulatedFinalScore = autoKnockoutState.scores.M104
  const groupPlayedCount = selectedTeamMatches.filter((match) => save.groupScores[match.id]).length
  const nextMission = nextGroupMatch
    ? { stage: `Groupe ${selectedTeam?.groupId} · match ${groupPlayedCount + 1}/3`, label: `${teamName(teamsById.get(nextGroupMatch.homeTeamId))} vs ${teamName(teamsById.get(nextGroupMatch.awayTeamId))}`, tone: 'group' }
    : nextKnockoutMatch
      ? { stage: nextKnockoutMatch.stage, label: `${teamName(nextKnockoutMatch.home.kind === 'team' ? teamsById.get(nextKnockoutMatch.home.teamId) : undefined)} vs ${teamName(nextKnockoutMatch.away.kind === 'team' ? teamsById.get(nextKnockoutMatch.away.teamId) : undefined)}`, tone: 'knockout' }
      : playerChampion
        ? { stage: 'Trophée', label: 'Champion du monde', tone: 'trophy' }
        : playerEliminated
        ? { stage: 'Fin de parcours', label: qualified ? 'Éliminé en phase finale' : `Champion simulé : ${teamName(simulatedChampion)}`, tone: 'danger' }
          : { stage: 'Objectif', label: 'Termine tes matchs de groupe', tone: 'group' }
  const adventurePoints = useMemo(() => {
    if (!save.teamId) return 0
    const groupPoints = selectedTeamMatches.reduce((total, match) => {
      const score = save.groupScores[match.id]
      if (!score) return total
      const playerIsHome = match.homeTeamId === save.teamId
      const playerGoals = playerIsHome ? score.home : score.away
      const opponentGoals = playerIsHome ? score.away : score.home
      const resultBonus = playerGoals > opponentGoals ? 20 : playerGoals === opponentGoals ? 8 : 0
      return total + 10 + resultBonus + playerGoals * 2
    }, 0)
    const knockoutPoints = autoKnockoutState.matches.reduce((total, match) => {
      if (!teamInMatch(match, save.teamId)) return total
      const score = save.knockoutScores[match.id]
      const winner = save.knockoutWinners[match.id]
      if (!score || !winner) return total
      const playerIsHome = match.home.kind === 'team' && match.home.teamId === save.teamId
      const playerGoals = playerIsHome ? score.home : score.away
      return total + 30 + playerGoals * 3 + (winner === save.teamId ? 60 : 0)
    }, 0)
    return groupPoints + knockoutPoints + (qualified ? 80 : 0) + (playerChampion ? 250 : 0)
  }, [autoKnockoutState.matches, playerChampion, qualified, save.groupScores, save.knockoutScores, save.knockoutWinners, save.teamId, selectedTeamMatches])
  const adventureMapMatches = useMemo<KnockoutMatch[]>(() => {
    const groupNodes = selectedTeamMatches.map(groupMatchToBattle)
    const knockoutNodes = groupComplete
      ? qualified
        ? playerKnockoutPath
        : []
      : [
        { id: 'ADV-R32', stage: '16e de finale', label: '16e', dateLabel: '', home: { kind: 'placeholder' as const, label: 'À déterminer' }, away: { kind: 'placeholder' as const, label: 'À déterminer' }, qualificationStatus: 'projected' as const },
        { id: 'ADV-R16', stage: '8e de finale', label: '8e', dateLabel: '', home: { kind: 'placeholder' as const, label: 'À déterminer' }, away: { kind: 'placeholder' as const, label: 'À déterminer' }, qualificationStatus: 'projected' as const },
        { id: 'ADV-QF', stage: 'Quart de finale', label: 'QF', dateLabel: '', home: { kind: 'placeholder' as const, label: 'À déterminer' }, away: { kind: 'placeholder' as const, label: 'À déterminer' }, qualificationStatus: 'projected' as const },
        { id: 'ADV-SF', stage: 'Demi-finale', label: 'SF', dateLabel: '', home: { kind: 'placeholder' as const, label: 'À déterminer' }, away: { kind: 'placeholder' as const, label: 'À déterminer' }, qualificationStatus: 'projected' as const },
        { id: 'ADV-F', stage: 'Finale', label: 'Finale', dateLabel: '', home: { kind: 'placeholder' as const, label: 'À déterminer' }, away: { kind: 'placeholder' as const, label: 'À déterminer' }, qualificationStatus: 'projected' as const },
      ]
    return [...groupNodes, ...knockoutNodes]
  }, [groupComplete, playerKnockoutPath, qualified, selectedTeamMatches])
  const adventureRouteIds = useMemo(() => adventureMapMatches.map((match) => match.id), [adventureMapMatches])
  const adventureMapPicks = useMemo(() => {
    const teamId = save.teamId
    if (!teamId) return {}
    return Object.fromEntries(adventureMapMatches.map((match) => [match.id, teamId]))
  }, [adventureMapMatches, save.teamId])
  const adventureMapScores = useMemo(() => {
    if (!save.teamId) return {}
    const entries: Array<[string, { p: number; o: number }]> = []
    for (const match of selectedTeamMatches) {
      const score = save.groupScores[match.id]
      if (!score) continue
      const playerHome = match.homeTeamId === save.teamId
      entries.push([match.id, { p: playerHome ? score.home : score.away, o: playerHome ? score.away : score.home }])
    }
    for (const match of playerKnockoutPath) {
      const score = save.knockoutScores[match.id]
      if (!score) continue
      const playerHome = match.home.kind === 'team' && match.home.teamId === save.teamId
      entries.push([match.id, { p: playerHome ? score.home : score.away, o: playerHome ? score.away : score.home }])
    }
    return Object.fromEntries(entries)
  }, [playerKnockoutPath, save.groupScores, save.knockoutScores, save.teamId, selectedTeamMatches])
  const adventureZoneBanners = useMemo(() => {
    const banners = [{ label: `GROUPE ${selectedTeam?.groupId ?? ''}`, y: 2380 }]
    if (!playerGroupEliminated) {
      banners.push(
        { label: 'PHASE FINALE', y: 1740 },
        { label: 'QUARTS', y: 1170 },
        { label: 'DEMI-FINALES', y: 700 },
        { label: 'FINALE', y: 390 },
      )
    }
    return banners
  }, [playerGroupEliminated, selectedTeam?.groupId])
  const dailyPlayedCount = todayMatches.filter((match) => dailyResults[match.id]).length

  useEffect(() => {
    if (!challengeToken) {
      remoteHydratedRef.current = true
      return
    }

    let cancelled = false
    remoteHydratedRef.current = false
    getAdventureProgress(challengeToken)
      .then((remote) => {
        if (cancelled || !remote) return
        const localTime = Date.parse(save.updatedAt || '1970-01-01T00:00:00.000Z') || 0
        const remoteTime = Date.parse(remote.updatedAt || '1970-01-01T00:00:00.000Z') || 0
        if (remoteTime > localTime) {
          setSave(adventureEntryToSave(remote))
          setDailyResults(remote.dailyResults ?? {})
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          remoteHydratedRef.current = true
          setRemoteHydratedTick((current) => current + 1)
        }
      })

    return () => {
      cancelled = true
    }
  }, [challengeToken])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save))
  }, [save])

  useEffect(() => {
    localStorage.setItem(DAILY_RESULTS_STORAGE_KEY, JSON.stringify(dailyResults))
  }, [dailyResults])

  useEffect(() => {
    if (!challengeToken || !remoteHydratedRef.current) return

    const payload = JSON.stringify({
      teamId: save.teamId,
      groupScores: save.groupScores,
      knockoutScores: save.knockoutScores,
      knockoutWinners: save.knockoutWinners,
      dailyResults,
    })
    if (payload === lastRemotePayloadRef.current) return
    lastRemotePayloadRef.current = payload

    if (remoteSaveTimerRef.current !== null) window.clearTimeout(remoteSaveTimerRef.current)
    remoteSaveTimerRef.current = window.setTimeout(() => {
      void saveAdventureProgress(challengeToken, {
        teamId: save.teamId,
        groupScores: save.groupScores,
        knockoutScores: save.knockoutScores,
        knockoutWinners: save.knockoutWinners,
        dailyResults,
      }).catch(() => undefined)
    }, 450)

    return () => {
      if (remoteSaveTimerRef.current !== null) {
        window.clearTimeout(remoteSaveTimerRef.current)
        remoteSaveTimerRef.current = null
      }
    }
  }, [challengeToken, dailyResults, remoteHydratedTick, save.groupScores, save.knockoutScores, save.knockoutWinners, save.teamId])

  useEffect(() => {
    if (!save.teamId || !groupComplete) return
    const key = qualified ? `${save.teamId}:qualified` : `${save.teamId}:group-out`
    if (seenNoticeKey === key) return
    setSeenNoticeKey(key)
    setNotice(qualified
      ? { tone: 'success', title: 'Qualification !', text: `${teamName(selectedTeam)} continue l'aventure. Ton adversaire de phase finale est généré.` }
      : { tone: 'danger', title: 'Éliminé en groupes', text: `${teamName(selectedTeam)} ne passe pas. La phase finale est simulée jusqu'au champion : ${teamName(simulatedChampion)}.` })
  }, [groupComplete, qualified, save.teamId, seenNoticeKey, selectedTeam, simulatedChampion])

  useEffect(() => {
    if (!save.teamId || !playerEliminated || !qualified) return
    const lastLostMatch = autoKnockoutState.matches.findLast((match) => teamInMatch(match, save.teamId) && save.knockoutWinners[match.id] && save.knockoutWinners[match.id] !== save.teamId)
    if (!lastLostMatch) return
    const key = `${save.teamId}:out:${lastLostMatch.id}`
    if (seenNoticeKey === key) return
    setSeenNoticeKey(key)
    setNotice({ tone: 'danger', title: 'Éliminé', text: `Défaite en ${lastLostMatch.stage}. Le parcours s'arrête ici.` })
  }, [autoKnockoutState.matches, playerEliminated, qualified, save.knockoutWinners, save.teamId, seenNoticeKey])

  useEffect(() => {
    if (!playerChampion || !selectedTeam) return
    const key = `${selectedTeam.id}:champion`
    if (seenNoticeKey === key) return
    setSeenNoticeKey(key)
    setNotice({ tone: 'trophy', title: 'Champion du monde !', text: `${selectedTeam.name} gagne la Coupe du Monde dans ton aventure.` })
  }, [playerChampion, seenNoticeKey, selectedTeam])

  const startAdventure = (teamId: string) => {
    sfx.click()
    setSimulationOpen(true)
    window.setTimeout(() => {
      setSave(touchAdventureSave({
        teamId,
        groupScores: buildInitialGroupScores(groupMatches, teamId),
        knockoutScores: {},
        knockoutWinners: {},
      }))
      setSimulationOpen(false)
      setNotice({
        tone: 'success',
        title: 'Phase de groupe',
        text: 'Ton aventure commence en phase de groupe. Chaque point compte : remporte un maximum de matchs. Dans cette phase, une phase perdue ne peut pas être recommencée.',
      })
    }, 900)
    setBattle(null)
  }

  const resetAdventure = () => {
    sfx.error()
    setSave(touchAdventureSave({ teamId: null, groupScores: {}, knockoutScores: {}, knockoutWinners: {} }))
    setBattle(null)
    setShowResetConfirm(false)
    setShowAdventureMenu(false)
  }

  const moveTeamCarousel = (delta: number) => {
    if (!sortedTeams.length) return
    sfx.nav()
    setTeamCarouselIndex((current) => (current + delta + sortedTeams.length) % sortedTeams.length)
  }

  const playGroupMatch = (match: GroupMatch) => {
    if (!save.teamId) return
    setBattle({
      kind: 'group',
      sourceId: match.id,
      match: groupMatchToBattle(match),
      playerSide: playerSideForGroupMatch(match, save.teamId),
    })
  }

  const playKnockoutMatch = (match: KnockoutMatch) => {
    if (!save.teamId || match.home.kind !== 'team' || match.away.kind !== 'team') return
    setBattle({
      kind: 'knockout',
      sourceId: match.id,
      match,
      playerSide: playerSideForKnockoutMatch(match, save.teamId),
    })
  }

  const playTodayMatch = (match: TodayMatch, playerSide: 'home' | 'away') => {
    setShowTodayMatches(false)
    setBattle({
      kind: 'daily',
      sourceId: match.id,
      match: todayMatchToBattle(match),
      playerSide,
    })
  }

  const handleBattleComplete = (result: BattleResult) => {
    if (!battle) return
    if (battle.kind === 'daily') {
      const score = scoreFromBattleResult(result, battle.playerSide, battle.match)
      setDailyResults((current) => ({
        ...current,
        [battle.sourceId]: {
          score,
          playerSide: battle.playerSide,
          playedAt: new Date().toISOString(),
        },
      }))
      setBattle(null)
      return
    }
    if (!save.teamId) return
    const playerTeamId = save.teamId
    const score = scoreFromBattleResult(result, battle.playerSide, battle.match)
    if (battle.kind === 'group') {
      const playedMatch = groupMatches.find((match) => match.id === battle.sourceId)
      const upToMatchday = playedMatch?.matchday ?? groupPlayedCount + 1
      const previousRank = playerStanding?.rank
      const playedScores = { ...save.groupScores, [battle.sourceId]: score }
      const nextGroupScores = simulateGroupScoresThroughMatchday(groupMatches, playerTeamId, playedScores, upToMatchday)
      const nextStandings = computeStandings(teams, applyGroupScores(groupMatches, nextGroupScores))
      const nextStanding = selectedGroupId ? nextStandings[selectedGroupId]?.find((row) => row.teamId === playerTeamId) : undefined
      const movementNotice = rankMovementNotice(previousRank, nextStanding?.rank)
      setSave((current) => {
        return touchAdventureSave({
          ...current,
          groupScores: current.teamId === playerTeamId
            ? nextGroupScores
            : simulateGroupScoresThroughMatchday(groupMatches, current.teamId ?? playerTeamId, { ...current.groupScores, [battle.sourceId]: score }, upToMatchday),
          knockoutScores: {},
          knockoutWinners: {},
        })
      })
      if (movementNotice) setNotice(movementNotice)
    } else {
      const rawHomeId = battle.match.home.kind === 'team' ? battle.match.home.teamId : null
      const rawAwayId = battle.match.away.kind === 'team' ? battle.match.away.teamId : null
      const resolvedWinnerId = result.winnerId ?? (rawHomeId && rawAwayId ? knockoutWinner(battle.sourceId, rawHomeId, rawAwayId, score) : rawHomeId ?? rawAwayId ?? save.teamId)
      const winnerId = battle.playerSide === 'home'
        ? resolvedWinnerId
        : resolvedWinnerId === rawAwayId ? rawAwayId : rawHomeId ?? resolvedWinnerId
      setSave((current) => touchAdventureSave({
        ...current,
        knockoutScores: {
          ...Object.fromEntries(Object.entries(current.knockoutScores).filter(([matchId]) => Number(matchId.slice(1)) < Number(battle.sourceId.slice(1)))),
          [battle.sourceId]: score,
        },
        knockoutWinners: {
          ...Object.fromEntries(Object.entries(current.knockoutWinners).filter(([matchId]) => Number(matchId.slice(1)) < Number(battle.sourceId.slice(1)))),
          [battle.sourceId]: winnerId,
        },
      }))
    }
    setBattle(null)
  }

  if (battle) {
    return (
      <BattleEngine
        match={battle.match}
        teamsById={teamsById}
        playerSide={battle.playerSide}
        onComplete={handleBattleComplete}
        onQuit={() => setBattle(null)}
        difficultySetting={difficultySetting}
        onDifficultyChange={onDifficultyChange}
        allowDraw={battle.kind === 'group'}
        disableSpecialDraw={battle.kind === 'group'}
        allowRetry={false}
      />
    )
  }

  if (!selectedTeam) {
    return (
      <main className="adventure-shell adventure-shell--select">
        {todayMatches.length > 0 ? (
          <button type="button" className="adventure-stadium-button" onClick={() => setShowTodayMatches(true)} aria-label="Matchs du jour">
            <span>STADE</span>
          </button>
        ) : null}
        <section className="adventure-team-select">
          <div className="adventure-team-select__head">
            <p>Mode aventure</p>
            <h1>Choisis ta nation</h1>
            <span>Les nations sont classées par ordre alphabétique.</span>
          </div>
          {carouselTeam ? (
            <div className="adventure-team-carousel">
              <button
                type="button"
                className="adventure-team-carousel__arrow"
                onClick={() => moveTeamCarousel(-1)}
                aria-label="Nation precedente"
              >
                ‹
              </button>
              <div className="adventure-team-carousel__stage">
                <div className="adventure-team-carousel__card">
                  <div className="adventure-team-carousel__ovr">
                    <strong>{carouselTeamPower}</strong>
                    <small>OVR</small>
                  </div>
                  <div className="adventure-team-carousel__corner-flag">
                    <Flag team={carouselTeam} />
                  </div>
                  <div className="adventure-team-carousel__flag">
                    <Flag team={carouselTeam} />
                  </div>
                  <strong>{teamName(carouselTeam)}</strong>
                  <small>#{carouselTeamRating.rank} FIFA · {carouselTeam.fifaCode ?? carouselTeam.id} · GROUPE {carouselTeam.groupId}</small>
                  <div className="adventure-team-carousel__bubbles" aria-label={`Autres équipes du groupe ${carouselTeam.groupId}`}>
                    {carouselOtherTeams.map((team) => (
                      <span className="adventure-team-carousel__bubble" key={team.id} title={teamName(team)}>
                        <Flag team={team} />
                      </span>
                    ))}
                  </div>
                  <div className="adventure-team-carousel__stats" aria-label="Niveau de l'équipe">
                    {carouselTeamStats.map((stat) => (
                      <div className="adventure-team-carousel__stat" key={stat.label}>
                        <small>{stat.label}</small>
                        <span><i style={{ width: `${stat.val}%` }} /></span>
                        <b>{stat.val}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="adventure-team-carousel__arrow"
                onClick={() => moveTeamCarousel(1)}
                aria-label="Nation suivante"
              >
                ›
              </button>
              <button type="button" className="adventure-team-carousel__cta" onClick={() => startAdventure(carouselTeam.id)}>
                Sélectionner
              </button>
              <div className="adventure-team-carousel__dots" aria-hidden="true">
                {sortedTeams.map((team, index) => (
                  <span
                    key={team.id}
                    className={index === teamCarouselIndex ? 'is-active' : undefined}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
        {simulationOpen ? <SimulationOverlay /> : null}
        {showTodayMatches ? (
          <TodayMatchesModal
            matches={todayMatches}
            teamsById={teamsById}
            results={dailyResults}
            onClose={() => setShowTodayMatches(false)}
            onPlay={playTodayMatch}
          />
        ) : null}
      </main>
    )
  }

  return (
    <main className="adventure-shell adventure-shell--map">
      <button type="button" className="adventure-map-menu-button" onClick={() => { sfx.click(); setShowAdventureMenu(true) }} aria-label="Ouvrir le menu aventure">
        <span />
        <span />
        <span />
      </button>
      <section className="adventure-map-host" aria-label="Carte aventure">
        <WorldCupMapMenu
          matches={adventureMapMatches}
          teamsById={teamsById}
          picks={adventureMapPicks}
          scores={adventureMapScores}
          routeIds={adventureRouteIds}
          zoneBanners={adventureZoneBanners}
          introReady
          fixedTeamId={save.teamId}
          mode="adventure"
          mapBadge={{
            tone: 'adventure',
            title: 'Mon aventure',
            subtitle: `${selectedTeam?.shortName || selectedTeam?.name || 'Équipe'} · Groupe ${selectedTeam?.groupId ?? '-'} · ${groupPlayedCount}/3`,
          }}
          topLeftButton={todayMatches.length > 0 ? {
            label: 'Matchs du jour',
            onClick: () => setShowTodayMatches(true),
            content: (
              <>
                <svg className="wcmap__stadium-icon" viewBox="0 0 44 34" aria-hidden="true">
                  <g className="wcmap__stadium-lights" stroke="#ffd84a" strokeWidth="2" strokeLinecap="round">
                    <path d="M8 10 L5 3 M8 10 L11 3" fill="none" />
                    <path d="M36 10 L33 3 M36 10 L39 3" fill="none" />
                    <circle cx="5" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
                    <circle cx="11" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
                    <circle cx="33" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
                    <circle cx="39" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
                  </g>
                  <path d="M4 14 Q22 6 40 14 L37 26 Q22 32 7 26 Z" fill="rgba(43,255,154,.14)" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
                  <ellipse cx="22" cy="20.5" rx="10.5" ry="4.6" fill="rgba(43,255,154,.28)" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M22 16 V25" stroke="currentColor" strokeWidth="1.1" opacity=".8" />
                </svg>
                <strong className="adventure-daily-count">{dailyPlayedCount}/{todayMatches.length}</strong>
              </>
            ),
          } : undefined}
          onPick={() => undefined}
          onPlay={(matchId) => {
            const groupMatch = selectedTeamMatches.find((match) => match.id === matchId)
            if (groupMatch) {
              playGroupMatch(groupMatch)
              return
            }
            const knockoutMatch = autoKnockoutState.matches.find((match) => match.id === matchId)
            if (knockoutMatch) playKnockoutMatch(knockoutMatch)
          }}
        />
      </section>
      {playerGroupEliminated && simulatedChampion ? (
        <section className="adventure-elimination-summary" aria-label="Résultat de la phase finale simulée">
          <span>Phase finale simulée</span>
          <div className="adventure-elimination-summary__winner">
            <Flag team={simulatedChampion} />
            <div>
              <small>Champion du monde</small>
              <strong>{teamName(simulatedChampion)}</strong>
            </div>
          </div>
          {simulatedFinal && simulatedFinalScore ? (
            <p>
              Finale : {teamName(simulatedFinal.home.kind === 'team' ? teamsById.get(simulatedFinal.home.teamId) : undefined)}
              {' '}
              {simulatedFinalScore.home} - {simulatedFinalScore.away}
              {' '}
              {teamName(simulatedFinal.away.kind === 'team' ? teamsById.get(simulatedFinal.away.teamId) : undefined)}
            </p>
          ) : (
            <p>Le tableau a été joué automatiquement jusqu'à la finale.</p>
          )}
        </section>
      ) : null}
      {showAdventureMenu ? (
        <div className="adventure-menu-modal" role="dialog" aria-modal="true" aria-label="Menu aventure">
          <button type="button" className="adventure-menu-modal__scrim" onClick={() => setShowAdventureMenu(false)} aria-label="Fermer" />
          <div className="adventure-menu-modal__panel">
            <div className="adventure-menu-modal__team">
              <Flag team={selectedTeam} />
              <div>
                <span>Ton aventure</span>
                <strong>{selectedTeam.name}</strong>
                <small>Groupe {selectedTeam.groupId} · {rankText(playerStanding)}</small>
              </div>
            </div>
            <div className="adventure-menu-modal__stats">
              <div><span>Points</span><strong>{adventurePoints}</strong></div>
              <div><span>Qualification</span><strong>{groupComplete ? qualified ? 'OK' : 'Non qualifié' : 'En cours'}</strong></div>
              <div><span>Objectif</span><strong>{nextMission.stage}</strong></div>
            </div>
            <p>{nextMission.label}</p>
            <button type="button" className="is-primary" onClick={() => { setShowAdventureMenu(false); onOpenOfficial() }}>Officiel</button>
            <button type="button" onClick={() => { setShowAdventureMenu(false); setShowStandings(true) }}>Groupes</button>
            {todayMatches.length > 0 ? (
              <button type="button" onClick={() => { setShowAdventureMenu(false); setShowTodayMatches(true) }}>Matchs du jour</button>
            ) : null}
            <button type="button" className="is-danger" onClick={() => setShowResetConfirm(true)}>Changer d'équipe</button>
            <button type="button" onClick={() => setShowAdventureMenu(false)}>Retour à la map</button>
          </div>
        </div>
      ) : null}
      {showResetConfirm ? (
        <div className="adventure-confirm-modal" role="dialog" aria-modal="true" aria-label="Confirmation changement d'équipe">
          <button type="button" className="adventure-confirm-modal__scrim" onClick={() => setShowResetConfirm(false)} aria-label="Annuler" />
          <div className="adventure-confirm-modal__panel">
            <span>Changer d'équipe ?</span>
            <strong>Toute ta progression aventure sera perdue.</strong>
            <p>Matchs joués, simulations, classement de groupe et phase finale seront remis à zéro.</p>
            <div className="adventure-confirm-modal__actions">
              <button type="button" onClick={() => setShowResetConfirm(false)}>Annuler</button>
              <button type="button" className="is-danger" onClick={resetAdventure}>Confirmer</button>
            </div>
          </div>
        </div>
      ) : null}
      {showTodayMatches ? (
        <TodayMatchesModal
          matches={todayMatches}
          teamsById={teamsById}
          results={dailyResults}
          onClose={() => setShowTodayMatches(false)}
          onPlay={playTodayMatch}
        />
      ) : null}
      {showStandings ? (
        <StandingsModal
          standings={standings}
          teamsById={teamsById}
          selectedTeamId={save.teamId}
          bestThirds={bestThirds}
          onClose={() => setShowStandings(false)}
        />
      ) : null}
      {notice ? <AdventureNotice notice={notice} onClose={() => setNotice(null)} /> : null}
    </main>
  )
}

function SimulationOverlay() {
  return (
    <div className="adventure-sim-overlay" role="status" aria-live="polite">
      <div className="adventure-sim-overlay__panel">
        <span />
        <strong>Simulation des autres matchs</strong>
        <p>Groupes, meilleurs troisièmes et tableau se construisent...</p>
        <div><i /></div>
      </div>
    </div>
  )
}

function AdventureNotice({
  notice,
  onClose,
}: {
  notice: { tone: 'success' | 'danger' | 'trophy'; title: string; text: string }
  onClose: () => void
}) {
  return (
    <div className={`adventure-notice is-${notice.tone}`} role="dialog" aria-modal="true">
      <button type="button" className="adventure-notice__scrim" onClick={onClose} aria-label="Fermer" />
      <div className="adventure-notice__panel">
        <div className="adventure-notice__burst" aria-hidden="true" />
        <h2>{notice.title}</h2>
        <p>{notice.text}</p>
        <button type="button" onClick={onClose}>Continuer</button>
      </div>
    </div>
  )
}

function StandingsModal({
  standings,
  teamsById,
  selectedTeamId,
  bestThirds,
  onClose,
}: {
  standings: Record<string, RankedStandingRow[]>
  teamsById: Map<string, Team>
  selectedTeamId: string | null
  bestThirds: RankedStandingRow[]
  onClose: () => void
}) {
  const bestThirdSet = new Set(bestThirds.map((row) => row.teamId))
  const selectedGroupId = selectedTeamId
    ? GROUP_IDS.find((groupId) => standings[groupId]?.some((row) => row.teamId === selectedTeamId))
    : undefined
  const orderedGroupIds = selectedGroupId
    ? [selectedGroupId, ...GROUP_IDS.filter((groupId) => groupId !== selectedGroupId)]
    : GROUP_IDS
  return (
    <div className="adventure-standings-modal" role="dialog" aria-modal="true" aria-label="Classements">
      <button type="button" className="adventure-standings-modal__scrim" onClick={onClose} aria-label="Fermer" />
      <div className="adventure-standings-modal__panel">
        <div className="adventure-standings-modal__head">
          <span>Classements</span>
          <button type="button" onClick={onClose}>Retour à la map</button>
        </div>
        <div className="adventure-standings-grid">
          {orderedGroupIds.map((groupId) => (
            <section className="adventure-standings-group" key={groupId}>
              <h2>Groupe {groupId}</h2>
              {(standings[groupId] ?? []).map((row) => {
                const team = teamsById.get(row.teamId)
                const qualified = row.rank <= 2 || bestThirdSet.has(row.teamId)
                return (
                  <div className={`adventure-standing-row${row.teamId === selectedTeamId ? ' is-player' : ''}${qualified ? ' is-qualified' : ''}`} key={row.teamId}>
                    <span>{row.rank}</span>
                    <Flag team={team} />
                    <strong>{teamName(team)}</strong>
                    <em>{row.points} pts</em>
                    <small>{row.goalDifference >= 0 ? '+' : ''}{row.goalDifference}</small>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function TodayMatchesModal({
  matches,
  teamsById,
  results,
  onClose,
  onPlay,
}: {
  matches: TodayMatch[]
  teamsById: Map<string, Team>
  results: Record<string, DailyMatchResult>
  onClose: () => void
  onPlay: (match: TodayMatch, side: 'home' | 'away') => void
}) {
  const [index, setIndex] = useState(0)
  const [selectedSide, setSelectedSide] = useState<'home' | 'away' | null>(null)
  const match = matches[Math.min(index, matches.length - 1)]
  const home = match ? teamsById.get(match.homeTeamId) : undefined
  const away = match ? teamsById.get(match.awayTeamId) : undefined
  const homeName = home ? teamName(home) : match?.homeLabel ?? 'Équipe'
  const awayName = away ? teamName(away) : match?.awayLabel ?? 'Équipe'
  const result = match ? results[match.id] : undefined
  const playedCount = matches.filter((item) => results[item.id]).length

  if (!match) return null

  const chooseSide = (side: 'home' | 'away') => {
    if (selectedSide) return
    sfx.pick()
    setSelectedSide(side)
    window.setTimeout(() => onPlay(match, side), 430)
  }

  return (
    <div className="adventure-today-modal" role="dialog" aria-modal="true" aria-label="Matchs du jour">
      <button type="button" className="adventure-today-modal__scrim" onClick={onClose} aria-label="Fermer" />
      <div className="adventure-today-modal__panel">
        <div className="adventure-today-modal__head">
          <span>Matchs du jour · {playedCount}/{matches.length} joués</span>
          <button type="button" onClick={onClose}>Retour à la map</button>
        </div>
        <div className="adventure-today-card">
          <p>{match.dayStageLabel ?? (match.groupId ? `Groupe ${match.groupId}` : 'Match officiel')}</p>
          <div className="adventure-today-card__stadium">
            <button type="button" className={`adventure-today-card__side${selectedSide === 'home' ? ' is-selected' : ''}`} onClick={() => chooseSide('home')} disabled={Boolean(selectedSide)}>
              {home ? <Flag team={home} /> : <span className="adventure-today-card__fallback-flag">{homeName.slice(0, 3).toUpperCase()}</span>}
              <strong>{homeName}</strong>
            </button>
            <span className="adventure-today-card__vs">VS</span>
            <button type="button" className={`adventure-today-card__side${selectedSide === 'away' ? ' is-selected' : ''}`} onClick={() => chooseSide('away')} disabled={Boolean(selectedSide)}>
              {away ? <Flag team={away} /> : <span className="adventure-today-card__fallback-flag">{awayName.slice(0, 3).toUpperCase()}</span>}
              <strong>{awayName}</strong>
            </button>
          </div>
          <div className={`adventure-today-card__status${result ? ' is-played' : ''}`}>
            <strong>{result ? `Déjà joué · ${result.score.home} - ${result.score.away}` : "Clique sur l'équipe pour jouer ce match"}</strong>
            {result ? <span>Tu avais joué {result.playerSide === 'home' ? homeName : awayName}</span> : <span>Le camp choisi grossit avant le coup d'envoi.</span>}
          </div>
          <small>{match.venue} · {match.kickoffTime ?? match.kickoffDate}</small>
        </div>
        {matches.length > 1 ? (
          <div className="adventure-today-modal__nav">
            <button type="button" onClick={() => { setSelectedSide(null); setIndex((value) => Math.max(0, value - 1)) }} disabled={index === 0}>Préc.</button>
            <span>{index + 1}/{matches.length}</span>
            <button type="button" onClick={() => { setSelectedSide(null); setIndex((value) => Math.min(matches.length - 1, value + 1)) }} disabled={index >= matches.length - 1}>Suiv.</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
