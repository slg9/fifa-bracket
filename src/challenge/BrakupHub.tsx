import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setGameMuted, useGameAudio, useGameMuted } from '../lib/useGameAudio'
import { getBrackets, submitBracket, verifyOTP } from '../lib/challengeData'
import { buildKnockoutBracket, knockoutTemplates } from '../lib/tournament'
import type { BattleResult, BattleScorer, ChallengeBreakdown, ChallengeEntry, GroupMatch, KnockoutEntrant, KnockoutMatch, RankedStandingRow, Team, TournamentSeed } from '../types'
import BattleEngine from '../components/battle/BattleEngine'
import CoinFlip from '../components/battle/CoinFlip'
import BracketChallenge from './BracketChallenge'
import ChallengeSplash from './ChallengeSplash'
import ChallengeLoading from './ChallengeLoading'
import WorldCupMapMenu from './WorldCupMapMenu'
import useChallengePreload from './useChallengePreload'
import EmailEntry from './EmailEntry'
import OTPEntry from './OTPEntry'
import Leaderboard from './Leaderboard'
import MyBrackets from './MyBrackets'
import ShareCard from './ShareCard'
import { safeFilePart, shareElementImage } from './shareImage'
import { sfx } from '../lib/sfx'
import { evaluateMatchProgress, formatScore, summarizeProgress, type OfficialScore, type RealScorer } from './progress'
import './challenge.css'

export type ChallengeMenuMatch = GroupMatch & {
  dayStageLabel?: string
  dayMatchLabel?: string
  homeLabel?: string
  awayLabel?: string
  isKnockout?: boolean
}

export interface BrakupHubProps {
  seed: TournamentSeed
  liveSource?: { source: string; syncedAt: string | null }
  standings: Record<string, RankedStandingRow[]>
  groupMatches?: GroupMatch[]
  teamsById: Map<string, Team>
  todayMatches?: ChallengeMenuMatch[]
  officialResults?: Record<string, string>
  officialScores?: Record<string, OfficialScore>
  topScorers?: Array<{ name: string; teamCode: string; goals: number }>
}

type HubView = 'challenge' | 'battle' | 'brackets' | 'board' | 'viewBracket'
type SavedProfile = { email: string; pseudo: string; bracketName: string; savedAt?: string }

const PROFILE_STORAGE_KEY = 'brakup:profile'
const AUTOSAVE_STORAGE_KEY = 'brakup:autosave-at'
const OFFICIAL_RESULTS_STORAGE_KEY = 'brakup:official-results'
const OFFICIAL_SCORES_STORAGE_KEY = 'brakup:official-scores'
const SEEN_OUTCOMES_STORAGE_KEY = 'brakup:seen-outcomes'
const SCORERS_STORAGE_KEY = 'brakup:scorers'

function readSavedProfile(): SavedProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? '{}') as Partial<SavedProfile>
    return {
      email: parsed.email ?? '',
      pseudo: parsed.pseudo ?? '',
      bracketName: parsed.bracketName ?? 'Mon bracket',
      savedAt: parsed.savedAt,
    }
  } catch {
    return { email: '', pseudo: '', bracketName: 'Mon bracket' }
  }
}

function readStorageMap<T extends object>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)) as T
  } catch {
    return fallback
  }
}

function readSeenOutcomeKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_OUTCOMES_STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function outcomeStorageKey(matchId: string, winnerId: string | undefined, score?: OfficialScore) {
  return `${matchId}:${winnerId ?? 'unknown'}:${score ? `${score.home}-${score.away}` : 'score'}`
}

function buildProgressBreakdown(
  matches: KnockoutMatch[],
  picks: Record<string, string>,
  scores: Record<string, { p: number; o: number }>,
  realResults: Record<string, string>,
  officialScores: Record<string, OfficialScore>,
  scorers: Record<string, BattleScorer[]>,
  realScorers: RealScorer[],
): ChallengeBreakdown {
  return Object.fromEntries(matches.map((match) => {
    const progress = evaluateMatchProgress(match, picks, scores, realResults, officialScores, scorers, realScorers)
    return [match.id, {
      points: progress.points,
      correct: progress.correct,
      played: progress.played,
      stage: match.stage,
      exact: progress.exact,
      exactPoints: progress.exactPoints,
      scorerHits: progress.scorerHits.length,
      scorerPoints: progress.scorerPoints,
    }]
  }))
}

function formatMenuKickoff(match: ChallengeMenuMatch) {
  if (match.kickoffIso) {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(match.kickoffIso))
  }
  return match.kickoffTime ?? 'Horaire a confirmer'
}

function menuTeamName(match: ChallengeMenuMatch, side: 'home' | 'away', teamsById: Map<string, Team>) {
  const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId
  const team = teamsById.get(teamId)
  if (team) return team.shortName || team.name
  return side === 'home' ? match.homeLabel ?? 'A determiner' : match.awayLabel ?? 'A determiner'
}

function resolveMatches(baseMatches: KnockoutMatch[], picks: Record<string, string>): KnockoutMatch[] {
  const baseMap = new Map(baseMatches.map((match) => [match.id, match]))
  const resolved = new Map<string, KnockoutMatch>()

  const resolveSource = (source: (typeof knockoutTemplates)[number]['home']): KnockoutEntrant => {
    if ('matchId' in source) {
      const previous = resolved.get(source.matchId)
      const winner = picks[source.matchId]
      if (!previous || !winner) return { kind: 'placeholder', label: `${source.type === 'loserOf' ? 'Perdant' : 'Vainqueur'} ${source.matchId}` }
      if (source.type === 'winnerOf') return { kind: 'team', teamId: winner }
      const ids = [previous.home, previous.away].flatMap((entrant) => entrant.kind === 'team' ? [entrant.teamId] : [])
      const loser = ids.find((id) => id !== winner)
      return loser ? { kind: 'team', teamId: loser } : { kind: 'placeholder', label: `Perdant ${source.matchId}` }
    }
    return { kind: 'placeholder', label: 'À déterminer' }
  }

  for (const template of knockoutTemplates) {
    const base = baseMap.get(template.id)
    const match: KnockoutMatch = {
      id: template.id,
      stage: template.stage,
      label: template.label,
      dateLabel: template.dateLabel,
      qualificationStatus: base?.qualificationStatus,
      home: Number(template.id.slice(1)) <= 88 ? base?.home ?? { kind: 'placeholder', label: 'À déterminer' } : resolveSource(template.home),
      away: Number(template.id.slice(1)) <= 88 ? base?.away ?? { kind: 'placeholder', label: 'À déterminer' } : resolveSource(template.away),
    }
    resolved.set(match.id, match)
  }
  return [...resolved.values()]
}

function readInitialView(): HubView {
  const params = new URLSearchParams(window.location.search)
  if (params.has('board')) return 'board'
  if (params.has('brackets')) return 'brackets'
  if (params.has('match')) return 'battle'
  return 'challenge'
}

export function BrakupHub({
  seed,
  liveSource,
  standings,
  groupMatches,
  teamsById,
  todayMatches = [],
  officialResults = {},
  officialScores = {},
  topScorers = [],
}: BrakupHubProps) {
  const [view, setView] = useState<HubView>(readInitialView)
  const [showSplash, setShowSplash] = useState(true)
  const [showBracket, setShowBracket] = useState(false)
  const [activeMatchId, setActiveMatchId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('match'))
  const [simulatedMatchId, setSimulatedMatchId] = useState<string | null>(null)
  const [mapResetKey, setMapResetKey] = useState(0)
  const [accessToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('token') ?? localStorage.getItem('brakup:token'))
  const [otpMode] = useState(() => new URLSearchParams(window.location.search).has('otp'))
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('brakup:draft') ?? '{}') as Record<string, string> } catch { return {} }
  })
  const [battleScores, setBattleScores] = useState<Record<string, { p: number; o: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('brakup:scores') ?? '{}') } catch { return {} }
  })
  const [scorers, setScorers] = useState<Record<string, BattleScorer[]>>(() => {
    try { return JSON.parse(localStorage.getItem(SCORERS_STORAGE_KEY) ?? '{}') as Record<string, BattleScorer[]> } catch { return {} }
  })
  const [storedRealResults] = useState<Record<string, string>>(() => readStorageMap<Record<string, string>>(OFFICIAL_RESULTS_STORAGE_KEY, {}))
  const [storedRealScores] = useState<Record<string, OfficialScore>>(() => readStorageMap<Record<string, OfficialScore>>(OFFICIAL_SCORES_STORAGE_KEY, {}))
  const [activeSide, setActiveSide] = useState<'home' | 'away'>('home')
  const [battleBonuses, setBattleBonuses] = useState(0)
  const [savedProfile, setSavedProfile] = useState<SavedProfile>(readSavedProfile)
  const [autosavedAt, setAutosavedAt] = useState<string | null>(() => localStorage.getItem(AUTOSAVE_STORAGE_KEY))
  const [brackets, setBrackets] = useState<ChallengeEntry[]>([])
  const [activeBracketId, setActiveBracketId] = useState<string | null>(null)
  const [viewedBracketEntry, setViewedBracketEntry] = useState<ChallengeEntry | null>(null)
  const [showEmailEntry, setShowEmailEntry] = useState(false)
  const [showOTPEntry, setShowOTPEntry] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [pendingPseudo, setPendingPseudo] = useState<string | null>(null)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpBusy, setOtpBusy] = useState(false)
  const [showGameMenu, setShowGameMenu] = useState(false)
  const [showBattleControls, setShowBattleControls] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadingBrackets, setLoadingBrackets] = useState(Boolean(accessToken))
  const [shareStatus, setShareStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const outcomeShareRef = useRef<HTMLDivElement>(null)
  const [outcomeNotice, setOutcomeNotice] = useState<{
    key: string
    match: KnockoutMatch
    progress: ReturnType<typeof evaluateMatchProgress>
  } | null>(null)

  // Initialiser email/pseudo depuis URL si mode OTP
  useEffect(() => {
    if (otpMode) {
      const params = new URLSearchParams(window.location.search)
      const email = params.get('email')
      const pseudo = params.get('pseudo')
      if (email && pseudo) {
        setPendingEmail(email)
        setPendingPseudo(pseudo)
        setShowOTPEntry(true)
      }
    }
  }, [otpMode])
  const challengePreload = useChallengePreload()
  const audioMuted = useGameMuted()
  const hubAudioSrc = outcomeNotice?.progress.correct ? '/audio/cup-victory-parade.mp3' : view !== 'battle' ? '/audio/kickoff-carnival.mp3' : null
  // Lobby music: kickoff when on challenge/brackets/board. Null during battle (BattleEngine takes over).
  useGameAudio(hubAudioSrc)

  const baseMatches = useMemo(() => buildKnockoutBracket(standings, groupMatches), [standings, groupMatches])
  const matches = useMemo(() => resolveMatches(baseMatches, picks), [baseMatches, picks])
  const activeMatch = matches.find((match) => match.id === activeMatchId)
  const hasSyncedProfile = Boolean(savedProfile.email && savedProfile.pseudo)
  const officialScoreMap = useMemo(
    () => ({ ...storedRealScores, ...officialScores }),
    [officialScores, storedRealScores],
  )
  const realResults = useMemo(() => {
    const derivedFromScores = matches.reduce<Record<string, string>>((results, match) => {
      const score = officialScoreMap[match.id]
      if (!score || score.home === score.away || match.home.kind !== 'team' || match.away.kind !== 'team') return results
      results[match.id] = score.home > score.away ? match.home.teamId : match.away.teamId
      return results
    }, {})
    return { ...storedRealResults, ...officialResults, ...derivedFromScores }
  }, [matches, officialResults, officialScoreMap, storedRealResults])
  const teamsByFifaCode = useMemo(() => new Map([...teamsById.values()].map((team) => [team.fifaCode, team])), [teamsById])
  const realScorers = useMemo<RealScorer[]>(() => topScorers.flatMap((scorer) => {
    const team = teamsByFifaCode.get(scorer.teamCode)
    return team ? [{ name: scorer.name, teamId: team.id, teamCode: scorer.teamCode, goals: scorer.goals }] : []
  }), [teamsByFifaCode, topScorers])
  const progressStats = useMemo(
    () => summarizeProgress(matches, picks, battleScores, realResults, officialScoreMap, battleBonuses, scorers, realScorers),
    [battleBonuses, battleScores, matches, officialScoreMap, picks, realResults, realScorers, scorers],
  )
  const progressBreakdown = useMemo(
    () => buildProgressBreakdown(matches, picks, battleScores, realResults, officialScoreMap, scorers, realScorers),
    [battleScores, matches, officialScoreMap, picks, realResults, realScorers, scorers],
  )
  const currentLeaderboardEntry = useMemo<ChallengeEntry | null>(() => {
    const current = brackets.find((entry) => entry.id === activeBracketId)
    if (!current && !savedProfile.pseudo && Object.keys(picks).length === 0) return null
    return {
      id: current?.id ?? 'local-current-player',
      emailHash: current?.emailHash ?? 'local',
      pseudo: current?.pseudo ?? (savedProfile.pseudo || 'Moi'),
      bracketName: current?.bracketName ?? (savedProfile.bracketName || 'Mon bracket'),
      picks,
      battleScores,
      scorers,
      score: progressStats.points,
      rank: current?.rank ?? null,
      submittedAt: current?.submittedAt ?? null,
      breakdown: progressBreakdown,
      battleBonuses,
      createdAt: current?.createdAt ?? savedProfile.savedAt ?? new Date().toISOString(),
    }
  }, [activeBracketId, battleBonuses, battleScores, brackets, picks, progressBreakdown, progressStats.points, savedProfile, scorers])

  const rememberProfile = useCallback((values: { email: string; pseudo: string; bracketName: string }) => {
    const next = { ...values, savedAt: new Date().toISOString() }
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next))
    setSavedProfile(next)
  }, [])

  useEffect(() => {
    localStorage.setItem('brakup:draft', JSON.stringify(picks))
    const now = new Date().toISOString()
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, now)
    setAutosavedAt(now)
  }, [picks])
  useEffect(() => {
    localStorage.setItem('brakup:scores', JSON.stringify(battleScores))
    const now = new Date().toISOString()
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, now)
    setAutosavedAt(now)
  }, [battleScores])
  useEffect(() => {
    localStorage.setItem(SCORERS_STORAGE_KEY, JSON.stringify(scorers))
    const now = new Date().toISOString()
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, now)
    setAutosavedAt(now)
  }, [scorers])
  useEffect(() => { localStorage.setItem('brakup:show-battle-controls', showBattleControls ? '1' : '0') }, [showBattleControls])
  useEffect(() => {
    if (!accessToken) return
    localStorage.setItem('brakup:token', accessToken)
    getBrackets(accessToken).then((entries) => { setBrackets(entries); if (entries[0]) setActiveBracketId(entries[0].id) }).catch(() => undefined).finally(() => setLoadingBrackets(false))
  }, [accessToken])

  const navigate = (next: HubView, matchId?: string) => {
    const nextParams = new URLSearchParams()
    nextParams.set('challenge', '')
    if (next === 'brackets') nextParams.set('brackets', '')
    if (next === 'board') nextParams.set('board', '')
    if (next === 'battle' && matchId) nextParams.set('match', matchId)
    window.history.pushState({}, '', `?${nextParams.toString().replace(/=$/, '')}`)
    setShowGameMenu(false)
    setView(next)
    setActiveMatchId(matchId ?? null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const viewBracket = async (entry: ChallengeEntry) => {
    setViewedBracketEntry(entry)
    setView('viewBracket')
  }

  const closeViewBracket = () => {
    setViewedBracketEntry(null)
    setView('board')
  }

  const handlePick = (matchId: string, teamId: string) => setPicks((current) => ({ ...current, [matchId]: teamId }))
  const handlePlay = (matchId: string, teamId?: string) => {
    // Verrouiller si le match a deja un resultat officiel
    if (realResults[matchId] || officialResults[matchId]) {
      sfx.error()
      return
    }
    if (teamId) {
      const m = matches.find((mx) => mx.id === matchId)
      const side: 'home' | 'away' = m?.home.kind === 'team' && m.home.teamId === teamId ? 'home' : 'away'
      setActiveSide(side)
    }
    navigate('battle', matchId)
  }
  const handleSimulate = (matchId: string) => {
    setSimulatedMatchId(matchId)
  }


  const handleOTPSubmit = async (otp: string) => {
    if (!pendingEmail || !pendingPseudo) return
    
    setOtpBusy(true)
    setOtpError(null)
    try {
      const token = await verifyOTP(pendingEmail, pendingPseudo, otp)
      // Stocker le token
      localStorage.setItem('brakup:token', token)
      // Charger les brackets
      const entries = await getBrackets(token)
      setBrackets(entries)
      if (entries[0]) {
        setActiveBracketId(entries[0].id)
        setPicks(entries[0].picks ?? {})
      }
      // Sauvegarder le profil
      rememberProfile({ email: pendingEmail, pseudo: pendingPseudo, bracketName: pendingPseudo })
      setPendingEmail(null)
      setPendingPseudo(null)
      setShowOTPEntry(false)
      setShowSplash(false)
      setShowEmailEntry(false)
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : 'Code OTP invalide ou expiré.')
    } finally {
      setOtpBusy(false)
    }
  }

  const syncBracketSnapshot = useCallback(async ({
    email,
    pseudo,
    bracketName,
    picksSnapshot,
    battleScoresSnapshot,
    scorersSnapshot,
    battleBonusesSnapshot,
    scoreSnapshot,
    breakdownSnapshot,
    submitted,
  }: {
    email: string
    pseudo: string
    bracketName: string
    picksSnapshot: Record<string, string>
    battleScoresSnapshot: Record<string, { p: number; o: number }>
    scorersSnapshot: Record<string, BattleScorer[]>
    battleBonusesSnapshot: number
    scoreSnapshot: number
    breakdownSnapshot: ChallengeBreakdown
    submitted: boolean
  }) => {
    const current = brackets.find((entry) => entry.id === activeBracketId)
    const result = await submitBracket({
      ...current,
      email,
      pseudo,
      bracketName,
      picks: picksSnapshot,
      battleScores: battleScoresSnapshot,
      scorers: scorersSnapshot,
      score: scoreSnapshot,
      breakdown: breakdownSnapshot,
      battleBonuses: battleBonusesSnapshot,
      submittedAt: submitted ? new Date().toISOString() : null,
    })
    localStorage.setItem('brakup:token', result.token)
    setBrackets((entries) => entries.some((entry) => entry.id === result.entry.id) ? entries.map((entry) => entry.id === result.entry.id ? result.entry : entry) : [...entries, result.entry])
    setActiveBracketId(result.entry.id)
    return result
  }, [activeBracketId, brackets])

  const handleBattleComplete = (result: BattleResult) => {
    const mid = activeMatchId ?? ''
    const nextPicks = mid ? { ...picks, [mid]: result.winnerId } : picks
    const nextBattleScores = mid ? { ...battleScores, [mid]: { p: result.playerScore, o: result.awayScore } } : battleScores
    const nextScorers = mid ? { ...scorers, [mid]: result.scorers ?? [] } : scorers
    const nextBattleBonuses = Math.min(40, battleBonuses + Math.max(1, Math.round(result.playerScore / 20)))
    const nextProgressStats = summarizeProgress(matches, nextPicks, nextBattleScores, realResults, officialScoreMap, nextBattleBonuses, nextScorers, realScorers)
    const nextBreakdown = buildProgressBreakdown(matches, nextPicks, nextBattleScores, realResults, officialScoreMap, nextScorers, realScorers)
    setPicks(nextPicks)
    if (mid) setBattleScores(nextBattleScores)
    if (mid) setScorers(nextScorers)
    setBattleBonuses(nextBattleBonuses)
    if (hasSyncedProfile) {
      setSaving(true)
      setSaveError(null)
      void syncBracketSnapshot({
        email: savedProfile.email,
        pseudo: savedProfile.pseudo,
        bracketName: savedProfile.bracketName || 'Mon bracket',
        picksSnapshot: nextPicks,
        battleScoresSnapshot: nextBattleScores,
        scorersSnapshot: nextScorers,
        battleBonusesSnapshot: nextBattleBonuses,
        scoreSnapshot: nextProgressStats.points,
        breakdownSnapshot: nextBreakdown,
        submitted: true,
      }).catch((caught) => {
        setSaveError(caught instanceof Error ? caught.message : 'Sauvegarde impossible.')
        setShowEmailEntry(true)
      }).finally(() => setSaving(false))
    } else {
      setShowEmailEntry(true)
    }
    navigate('challenge')
  }
  const handleSimulationComplete = (winnerId: string, score?: { home: number; away: number }) => {
    const match = matches.find((item) => item.id === simulatedMatchId)
    if (!match || match.home.kind !== 'team' || match.away.kind !== 'team') {
      setSimulatedMatchId(null)
      setMapResetKey((key) => key + 1)
      return
    }

    const winnerIsHome = winnerId === match.home.teamId
    handlePick(match.id, winnerId)
    if (score) {
      setBattleScores((current) => ({
        ...current,
        [match.id]: {
          p: winnerIsHome ? score.home : score.away,
          o: winnerIsHome ? score.away : score.home,
        },
      }))
    }
    setScorers((current) => ({ ...current, [match.id]: [] }))
    setSimulatedMatchId(null)
    setMapResetKey((key) => key + 1)
    navigate('challenge')
  }

  const save = async ({ email, pseudo, bracketName, submitted }: { email: string; pseudo: string; bracketName: string; submitted: boolean }) => {
    setSaving(true); setSaveError(null)
    rememberProfile({ email, pseudo, bracketName })
    try {
      await syncBracketSnapshot({
        email,
        pseudo,
        bracketName,
        picksSnapshot: picks,
        battleScoresSnapshot: battleScores,
        scorersSnapshot: scorers,
        battleBonusesSnapshot: battleBonuses,
        scoreSnapshot: progressStats.points,
        breakdownSnapshot: progressBreakdown,
        submitted,
      })
      setShowEmailEntry(false)
    } catch (caught) { setSaveError(caught instanceof Error ? caught.message : 'Sauvegarde impossible.') } finally { setSaving(false) }
  }

  const openBracket = (entry: ChallengeEntry) => { setPicks(entry.picks); setBattleScores(entry.battleScores ?? {}); setScorers(entry.scorers ?? {}); setBattleBonuses(entry.battleBonuses); setActiveBracketId(entry.id); navigate('challenge') }
  const openBracketOverlay = () => {
    setShowBracket(true)
  }
  const closeBracketOverlay = () => {
    setShowBracket(false)
    if (document.fullscreenElement) {
      const fullscreenExit = document.exitFullscreen?.()
      fullscreenExit?.catch(() => undefined)
    }
  }
  const introActive = view === 'challenge' && (!challengePreload.ready || showSplash)
  const simulatedMatch = simulatedMatchId ? matches.find((match) => match.id === simulatedMatchId) : null

  useEffect(() => {
    if (!challengePreload.ready || showSplash || outcomeNotice) return
    const seen = new Set(readSeenOutcomeKeys())
    const next = matches
      .map((match) => {
        const progress = evaluateMatchProgress(match, picks, battleScores, realResults, officialScoreMap, scorers, realScorers)
        const key = outcomeStorageKey(match.id, progress.realWinnerTeamId, progress.realScore)
        return { key, match, progress }
      })
      .find((item) => item.progress.played && !seen.has(item.key))
    if (next) setOutcomeNotice(next)
  }, [battleScores, challengePreload.ready, matches, officialScoreMap, outcomeNotice, picks, realResults, realScorers, scorers, showSplash])

  const closeOutcomeNotice = () => {
    if (outcomeNotice) {
      const seen = new Set(readSeenOutcomeKeys())
      seen.add(outcomeNotice.key)
      localStorage.setItem(SEEN_OUTCOMES_STORAGE_KEY, JSON.stringify([...seen]))
    }
    setOutcomeNotice(null)
    setShareStatus('idle')
  }

  const handleOutcomeShare = async () => {
    if (!outcomeNotice || !outcomeShareRef.current) return
    setShareStatus('working')
    try {
      // Pre-charger les images pour s'assurer qu'elles sont disponibles
      const bgImg = new Image()
      const logoImg = new Image()
      bgImg.src = '/brakup-share-bg-brakup.png'
      logoImg.src = '/brakup-logo.png'
      await Promise.all([
        new Promise((resolve) => { bgImg.onload = resolve; bgImg.onerror = resolve }),
        new Promise((resolve) => { logoImg.onload = resolve; logoImg.onerror = resolve }),
        new Promise(resolve => setTimeout(resolve, 200))
      ])
      const status = await shareElementImage(outcomeShareRef.current, {
        fileName: `brakup-${safeFilePart(outcomeNotice.match.id)}-${outcomeNotice.progress.correct ? 'win' : 'loss'}.png`,
        title: 'Brakup Challenge',
        text: 'Partage ca avec tes potes et challenge-les sur Brakup.',
      })
      setShareStatus(status === 'shared' ? 'done' : 'done')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setShareStatus('idle')
        return
      }
      console.error('Outcome share failed:', error)
      setShareStatus('error')
    }
  }

  const outcomeScorerNames = outcomeNotice?.progress.scorerHits.map((scorer) => scorer.name) ?? []
  const outcomeExactLabel = outcomeNotice?.progress.exact ? `Score exact +${outcomeNotice.progress.exactPoints}` : null
  const outcomeScorerLabel = outcomeNotice && outcomeNotice.progress.scorerPoints > 0
    ? `Buteur trouve +${outcomeNotice.progress.scorerPoints}`
    : null
  const outcomeBreakdownTotal = outcomeNotice?.progress.points ?? 0

  return (
    <div className={`brakup-shell${view === 'challenge' ? ' brakup-shell--map-only' : ''}${view === 'board' ? ' brakup-shell--board-page' : ''}${introActive ? ' brakup-shell--intro' : ''}`}>
      {view === 'challenge' && !challengePreload.ready ? <ChallengeLoading progress={challengePreload.progress} /> : null}
      {showSplash && challengePreload.ready ? <ChallengeSplash onPlay={() => setShowSplash(false)} /> : null}
      <header className="brakup-topbar">
        <button type="button" className="brakup-brand" onClick={() => { sfx.tab(); navigate('challenge') }}><img src="/favicon-512.png" alt="" className="brakup-brand__ico" /><div><strong>BRAKUP</strong><small>World Cup Challenge</small></div></button>
        <nav>
          <button type="button" className={view === 'challenge' ? 'is-active' : ''} onClick={() => { sfx.tab(); navigate('challenge') }}>Challenge</button>
          <button type="button" className={view === 'board' ? 'is-active' : ''} onClick={() => { sfx.tab(); navigate('board') }}>Classement</button>
        </nav>
      </header>
      {view === 'battle' && activeMatch?.home.kind === 'team' && activeMatch.away.kind === 'team' ? <BattleEngine match={activeMatch} teamsById={teamsById} onComplete={handleBattleComplete} playerSide={activeSide} onQuit={() => navigate('challenge')} showControls={showBattleControls} syncStatusLabel={hasSyncedProfile ? `Deja synchronise : ${savedProfile.pseudo || 'profil'} sera sauvegarde automatiquement.` : 'Synchro proposee apres ce match pour publier ton score.'} /> : null}
      {view === 'battle' && (!activeMatch || activeMatch.home.kind !== 'team' || activeMatch.away.kind !== 'team') ? <section className="brakup-empty"><span>⚽</span><h2>Ce match n’est pas encore disponible</h2><button type="button" className="brakup-button" onClick={() => navigate('challenge')}>Retour au bracket</button></section> : null}
      {view === 'challenge' ? <>
        <WorldCupMapMenu key={mapResetKey} matches={matches} teamsById={teamsById} picks={picks} scores={battleScores} scorers={scorers} realScorers={realScorers} realResults={realResults} officialScores={officialScoreMap} autosavedAt={autosavedAt} onPick={handlePick} onPlay={handlePlay} onSimulate={handleSimulate} onShowBracket={() => { sfx.bracket(); openBracketOverlay() }} />
        <button type="button" className="game-menu-button" onClick={() => { sfx.click(); setShowGameMenu(true) }} aria-label="Ouvrir le menu jeu">
          <span />
          <span />
          <span />
        </button>
      </> : null}

      {view === 'challenge' && showGameMenu ? (
        <div className="game-menu-modal" role="dialog" aria-modal="true" aria-label="Menu jeu">
          <button type="button" className="game-menu-modal__scrim" onClick={() => setShowGameMenu(false)} aria-label="Fermer le menu" />
          <div className="game-menu-modal__panel">
            <div className="game-menu-modal__head">
              <span>Menu jeu</span>
              <button type="button" className="game-menu-modal__close" onClick={() => { sfx.click(); setShowGameMenu(false) }} aria-label="Fermer">X</button>
            </div>
            <div className="game-menu-modal__score">
              <strong>{progressStats.points}</strong>
              <span>pts</span>
              <small>{progressStats.correct} pronos OK · {progressStats.exact} scores exacts · {progressStats.scorers} buteurs</small>
            </div>
            <button type="button" className="game-menu-modal__item game-menu-modal__item--primary" onClick={() => { sfx.bracket(); setShowGameMenu(false); openBracketOverlay() }}>Tableau</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); setShowGameMenu(false); navigate('challenge') }}>Carte des matchs</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); navigate('board') }}>Classement</button>
            <div className="game-menu-modal__section">
              <h3>Matchs du jour</h3>
              {todayMatches.length > 0 ? todayMatches.map((match) => (
                <div className="game-menu-modal__match" key={match.id}>
                  <time>{formatMenuKickoff(match)}</time>
                  <span>{menuTeamName(match, 'home', teamsById)}</span>
                  <b>{match.homeScore !== null && match.awayScore !== null ? `${match.homeScore}-${match.awayScore}` : 'vs'}</b>
                  <span>{menuTeamName(match, 'away', teamsById)}</span>
                </div>
              )) : <p>Aucun match aujourd'hui.</p>}
            </div>
            <div className="game-menu-modal__section">
              <h3>Stats</h3>
              {topScorers.length > 0 ? topScorers.slice(0, 6).map((scorer, index) => {
                const team = teamsByFifaCode.get(scorer.teamCode)
                return (
                  <div className="game-menu-modal__stat" key={`${scorer.name}-${scorer.teamCode}`}>
                    <span>#{index + 1}</span>
                    <strong>{scorer.name}</strong>
                    <em>{team?.flagEmoji ?? scorer.teamCode} {scorer.goals}</em>
                  </div>
                )
              }) : <p>Top buteurs indisponible.</p>}
            </div>
            <button type="button" className={`game-menu-modal__item game-menu-modal__item--sound${audioMuted ? ' is-muted' : ''}`} onClick={() => setGameMuted(!audioMuted)}>
              {audioMuted ? 'Activer le son' : 'Mute le jeu'}
            </button>
            <button type="button" className="game-menu-modal__item" onClick={() => setShowBattleControls((value) => !value)}>
              Commandes bas : {showBattleControls ? 'oui' : 'non'}
            </button>
          </div>
        </div>
      ) : null}

      {view === 'challenge' && simulatedMatch?.home.kind === 'team' && simulatedMatch.away.kind === 'team' ? (
        <div className="brakup-coin-overlay">
          <CoinFlip
            homeTeamId={simulatedMatch.home.teamId}
            awayTeamId={simulatedMatch.away.teamId}
            homeTeamName={teamsById.get(simulatedMatch.home.teamId)?.name ?? simulatedMatch.home.teamId}
            awayTeamName={teamsById.get(simulatedMatch.away.teamId)?.name ?? simulatedMatch.away.teamId}
            homeFlag={teamsById.get(simulatedMatch.home.teamId)?.flagEmoji ?? simulatedMatch.home.teamId.slice(0, 2).toUpperCase()}
            awayFlag={teamsById.get(simulatedMatch.away.teamId)?.flagEmoji ?? simulatedMatch.away.teamId.slice(0, 2).toUpperCase()}
            mode="simulation"
            onComplete={handleSimulationComplete}
          />
        </div>
      ) : null}

      {/* Bracket overlay — fullscreen, opens from the ⊞ button */}
      {view === 'challenge' && showBracket ? (
        <div className="brakup-bracket-overlay">
          <div className="brakup-bracket-overlay__bar">
            <span>Bracket — Coupe du Monde 2026</span>
            <button type="button" className="brakup-bracket-overlay__close" onClick={() => { sfx.click(); closeBracketOverlay() }}>✕ Fermer</button>
          </div>
          <div className="brakup-bracket-overlay__body">
            <BracketChallenge matches={matches} teamsById={teamsById} picks={picks} scores={battleScores} officialScores={officialScoreMap} onPick={handlePick} onPlay={(matchId, teamId) => { closeBracketOverlay(); handlePlay(matchId, teamId) }} brackets={brackets} activeBracketId={activeBracketId} onSelectBracket={(id) => { const entry = brackets.find((item) => item.id === id); if (entry) openBracket(entry) }} realResults={realResults} />
          </div>
        </div>
      ) : null}
      {view === 'brackets' ? <div className="brakup-phone-shell"><MyBrackets brackets={brackets} loading={loadingBrackets} onOpen={openBracket} onCreate={() => { setPicks({}); setActiveBracketId(null); navigate('challenge') }} /></div> : null}
      {view === 'board' ? <div className="brakup-phone-shell"><Leaderboard currentEntry={currentLeaderboardEntry} currentStats={progressStats} onBackToGame={() => { sfx.tab(); navigate('challenge') }} onViewBracket={viewBracket} /></div> : null}
      {view === 'viewBracket' && viewedBracketEntry ? (
        <div className="brakup-bracket-overlay">
          <div className="brakup-bracket-overlay__bar">
            <span>Carte de {viewedBracketEntry.pseudo}</span>
            <button type="button" className="brakup-bracket-overlay__close" onClick={() => { sfx.click(); closeViewBracket() }}>✕ Fermer</button>
          </div>
          <div className="brakup-bracket-overlay__body">
            <WorldCupMapMenu
              matches={matches}
              teamsById={teamsById}
              picks={viewedBracketEntry.picks ?? {}}
              scores={viewedBracketEntry.battleScores}
              scorers={viewedBracketEntry.scorers}
              realScorers={realScorers}
              realResults={realResults}
              officialScores={officialScoreMap}
              onPick={() => { sfx.error() }}  // Bloquer les selections
              onPlay={() => { sfx.error() }}  // Bloquer le jeu
              autosavedAt={null}
            />
          </div>
        </div>
      ) : null}
      {outcomeNotice ? (
        <div className={`brakup-outcome${outcomeNotice.progress.correct ? ' is-correct' : ' is-wrong'}`} role="dialog" aria-modal="true">
          <div className="brakup-outcome__panel">
            <div className="brakup-outcome__blast" aria-hidden="true">
              <i />
              {Array.from({ length: 14 }, (_, index) => <span key={index} style={{ ['--ray-rot' as string]: `${index * (360 / 14)}deg` }} />)}
            </div>
            <img className="brakup-outcome__logo" src="/brakup-logo.png" alt="Brakup" />
            <div className="brakup-outcome__boom">{outcomeNotice.progress.correct ? 'BOOOOOM' : 'REMATCH'}</div>
            <h2>{outcomeNotice.progress.correct ? 'Prono reussi' : 'Dommage'}</h2>
            <p>{outcomeNotice.match.label} · reel {formatScore(outcomeNotice.progress.realScore)} · toi {formatScore(outcomeNotice.progress.playedScore)}</p>
            <div className="brakup-outcome__points">
              <strong>+{outcomeBreakdownTotal}</strong>
              <span>points gagnes</span>
            </div>
            <div className="brakup-outcome__scores">
              <span>Vainqueur trouve <strong>{outcomeNotice.progress.correct ? `+${outcomeNotice.progress.stagePoints}` : '0'}</strong></span>
              {outcomeExactLabel ? <span>Score exact reussi <strong>{outcomeExactLabel}</strong></span> : null}
              {outcomeScorerLabel ? <span>Buteur trouve <strong>{outcomeScorerLabel}</strong></span> : null}
              {outcomeScorerNames.length ? <span>Scoreurs Brakup <strong>{outcomeScorerNames.join(', ')}</strong></span> : null}
            </div>
            <div className="brakup-outcome__share-copy">Partage-la avec tes potes et challenge-les sur Brakup.</div>
            <button type="button" className="brakup-share-button" onClick={() => { sfx.click(); void handleOutcomeShare() }} disabled={shareStatus === 'working'}>
              {shareStatus === 'working' ? "Generation de l'image..." : "Partager l'image"}
            </button>
            {shareStatus === 'done' ? <small className="brakup-share-feedback">Image prete a partager.</small> : null}
            {shareStatus === 'error' ? <small className="brakup-share-feedback is-error">Partage indisponible pour le moment.</small> : null}
            <button type="button" className="brakup-button" onClick={() => { sfx.click(); closeOutcomeNotice() }}>Continuer</button>
          </div>
          <div className="brakup-share-capture" aria-hidden="true">
            <ShareCard
              captureRef={outcomeShareRef}
              variant={outcomeNotice.progress.correct ? 'win' : 'loss'}
              kicker={outcomeNotice.progress.correct ? 'Bien joue' : 'Dommage'}
              headline={outcomeNotice.progress.correct ? 'Prono reussi' : 'Prono rate'}
              boomLabel={outcomeNotice.progress.correct ? 'BOOOOOM' : 'REMATCH'}
              scoreLabel={outcomeBreakdownTotal > 0 ? `+${outcomeBreakdownTotal} PTS` : '0 PT'}
              matchLabel={outcomeNotice.match.label}
              detailLabel={`Reel ${formatScore(outcomeNotice.progress.realScore)} · Ton jeu ${formatScore(outcomeNotice.progress.playedScore)}`}
              pointsLabel={outcomeExactLabel ?? outcomeScorerLabel ?? (outcomeNotice.progress.correct ? 'Vainqueur trouve' : 'Retente le prochain')}
              exactLabel={outcomeNotice.progress.exact ? 'Master score' : undefined}
              scorerLabel={outcomeScorerNames.length ? `Buteur: ${outcomeScorerNames.join(', ')}` : undefined}
            />
          </div>
        </div>
      ) : null}
      {showEmailEntry ? <EmailEntry busy={saving} error={saveError} initialEmail={savedProfile.email} initialBracketName={brackets.find((entry) => entry.id === activeBracketId)?.bracketName ?? savedProfile.bracketName} initialPseudo={brackets.find((entry) => entry.id === activeBracketId)?.pseudo ?? savedProfile.pseudo} onDraftChange={rememberProfile} onSubmit={save} onCancel={() => setShowEmailEntry(false)} /> : null}
      {showOTPEntry && pendingEmail && pendingPseudo ? <OTPEntry email={pendingEmail} pseudo={pendingPseudo} busy={otpBusy} error={otpError} onSubmit={handleOTPSubmit} onCancel={() => { setShowOTPEntry(false); setPendingEmail(null); setPendingPseudo(null); setShowEmailEntry(true) }} /> : null}
      <footer className="brakup-footer"><span>BRAKUP 2026</span><small>Données tournoi : {seed.meta.name} · {liveSource?.syncedAt ? `sync ${new Date(liveSource.syncedAt).toLocaleString('fr-FR')}` : 'projection locale'}</small></footer>
    </div>
  )
}

export default BrakupHub
