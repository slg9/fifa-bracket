import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setGameAudioVolume, setGameMuted, useGameAudio, useGameAudioVolume, useGameMuted } from '../lib/useGameAudio'
import { checkEmailExists, getBrackets, getProfileStatus, getSeenOutcomeKeys, markSeenOutcomeKeys, publishResultShare, requestOTP, resendMagicLink, submitBracket, updateProfile, verifyLoginOTP, verifyOTP } from '../lib/challengeData'
import { alternateLanguageHref, localizedChallengeGuideHref, localizedChallengeHref, type Locale } from '../lib/i18n'
import { buildKnockoutBracket, knockoutTemplates } from '../lib/tournament'
import type { BattleDifficultySetting, BattleResult, BattleScorer, ChallengeBreakdown, ChallengeEntry, GroupMatch, KnockoutEntrant, KnockoutMatch, RankedStandingRow, Team, TournamentSeed } from '../types'
import BattleEngine from '../components/battle/BattleEngine'
import CoinFlip from '../components/battle/CoinFlip'
import BracketChallenge from './BracketChallenge'
import ChallengeSplash from './ChallengeSplash'
import ChallengeLoading from './ChallengeLoading'
import WorldCupMapMenu from './WorldCupMapMenu'
import useChallengePreload from './useChallengePreload'
import EmailEntry from './EmailEntry'
import OTPEntry from './OTPEntry'
import LoginEntry from './LoginEntry'
import Leaderboard from './Leaderboard'
import MyBrackets from './MyBrackets'
import ProfileSettings from './ProfileSettings'
import { blobToDataUrl, shareLink } from './shareImage'
import { renderResultShareCanvas } from './shareCanvas'
import { sfx } from '../lib/sfx'
import { evaluateMatchProgress, formatScore, summarizeProgress, teamLabel, type OfficialScore, type RealScorer } from './progress'
import { clearBrakupLocalSession, readChallengeProfile, subscribeChallengeProfile, writeChallengeProfile, type StoredChallengeProfile } from '../lib/challengeProfile'
import { identifyAnalyticsProfile, trackAnalytics } from '../lib/analytics'
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
  officialFinishedMatchIds?: string[]
  topScorers?: Array<{ name: string; teamCode: string; goals: number }>
  locale?: Locale
}

type HubView = 'challenge' | 'battle' | 'brackets' | 'board' | 'viewBracket' | 'guide'
type SavedProfile = StoredChallengeProfile

const AUTOSAVE_STORAGE_KEY = 'brakup:autosave-at'
const OFFICIAL_RESULTS_STORAGE_KEY = 'brakup:official-results'
const OFFICIAL_SCORES_STORAGE_KEY = 'brakup:official-scores'
const SEEN_OUTCOMES_STORAGE_KEY = 'brakup:seen-outcomes'
const SKIP_SPLASH_STORAGE_KEY = 'brakup:skip-splash-once'
const SPLASH_SEEN_STORAGE_KEY = 'brakup:splash-seen'
const HAD_ACCOUNT_KEY = 'brakup:hadAccount'
const SCORERS_STORAGE_KEY = 'brakup:scorers'
const CLASSIC_SIMULATION_STORAGE_KEY = 'fifabracket:simulation'
const DIFFICULTY_STORAGE_KEY = 'brakup:difficulty'
const SHARE_BUILD_TIMEOUT_MS = 14000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeoutId))
  })
}

function readSavedProfile(): SavedProfile {
  return readChallengeProfile()
}

function readDifficultySetting(): BattleDifficultySetting {
  try {
    const saved = localStorage.getItem(DIFFICULTY_STORAGE_KEY)
    return saved === 'auto' || saved === 'easy' || saved === 'medium' || saved === 'hard' ? saved : 'medium'
  } catch {
    return 'medium'
  }
}

function readStorageMap<T extends object>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)) as T
  } catch {
    return fallback
  }
}

function readClassicKnockoutPicks(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLASSIC_SIMULATION_STORAGE_KEY) ?? '{}') as { knockoutPicks?: unknown }
    return parsed.knockoutPicks && typeof parsed.knockoutPicks === 'object' && !Array.isArray(parsed.knockoutPicks)
      ? parsed.knockoutPicks as Record<string, string>
      : {}
  } catch {
    return {}
  }
}

function writeClassicKnockoutPicks(picks: Record<string, string>) {
  try {
    const current = JSON.parse(localStorage.getItem(CLASSIC_SIMULATION_STORAGE_KEY) ?? '{}') as { overrides?: unknown; knockoutPicks?: unknown }
    localStorage.setItem(CLASSIC_SIMULATION_STORAGE_KEY, JSON.stringify({
      overrides: current.overrides && typeof current.overrides === 'object' ? current.overrides : {},
      knockoutPicks: picks,
    }))
  } catch {
    localStorage.setItem(CLASSIC_SIMULATION_STORAGE_KEY, JSON.stringify({ overrides: {}, knockoutPicks: picks }))
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

type OutcomeNotice = {
  key: string
  match: KnockoutMatch
  progress: ReturnType<typeof evaluateMatchProgress>
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

function teamFlagImageUrl(team?: Team) {
  if (!team?.iso2) return null
  return `https://flagcdn.com/w80/${team.iso2.toLowerCase()}.png`
}

function OutcomeFlag({ team, label }: { team?: Team; label: string }) {
  const src = teamFlagImageUrl(team)
  return (
    <span className="brakup-outcome__flag">
      {src
        ? <img src={src} alt="" crossOrigin="anonymous" />
        : <span>{team?.flagEmoji ?? label.slice(0, 3).toUpperCase()}</span>}
    </span>
  )
}
function resolveMatches(baseMatches: KnockoutMatch[], picks: Record<string, string>, realResults: Record<string, string>): KnockoutMatch[] {
  const baseMap = new Map(baseMatches.map((match) => [match.id, match]))
  const resolved = new Map<string, KnockoutMatch>()

  const resolveSource = (source: (typeof knockoutTemplates)[number]['home']): KnockoutEntrant => {
    if ('matchId' in source) {
      const previous = resolved.get(source.matchId)
      // Real result takes priority over user pick
      const winner = realResults[source.matchId] ?? picks[source.matchId]
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
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath === '/challenge/faq' || normalizedPath === '/en/challenge/faq') return 'guide'
  const params = new URLSearchParams(window.location.search)
  if (params.has('board')) return 'board'
  if (params.has('brackets')) return 'brackets'
  if (params.has('match')) return 'battle'
  return 'challenge'
}

function readInitialShowSplash() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('skipSplash')) return false
  try {
    if (window.localStorage.getItem(SPLASH_SEEN_STORAGE_KEY) === 'true') return false
    if (window.sessionStorage.getItem(SKIP_SPLASH_STORAGE_KEY) === 'true') {
      window.sessionStorage.removeItem(SKIP_SPLASH_STORAGE_KEY)
      return false
    }
  } catch {
    return true
  }
  return true
}

function markSplashSeen() {
  try {
    window.localStorage.setItem(SPLASH_SEEN_STORAGE_KEY, 'true')
  } catch {
    // Ignore storage failures; the session can still continue to the map.
  }
}

function skipSplashOnNextChallengeOpen() {
  try {
    window.sessionStorage.setItem(SKIP_SPLASH_STORAGE_KEY, 'true')
  } catch {
    // Ignore storage failures; the link still opens the game.
  }
}

function ChallengeGuidePage({ locale, onBackToGame }: { locale: Locale; onBackToGame: () => void }) {

  if (locale === 'en') {
    return (
      <main className="brakup-phone-shell brakup-guide-page">
        <div className="brakup-guide-page__top"><button type="button" className="brakup-guide-page__back" onClick={onBackToGame}>Back to game</button></div>
        <section className="brakup-seo-content" aria-labelledby="challenge-guide-title">
          <p className="brakup-seo-content__eyebrow">World Cup 2026 bracket challenge</p>
          <h1 id="challenge-guide-title">How to play Brakup Challenge</h1>
          <p>
            Brakup is a World Cup 2026 prediction game built for friends: choose knockout winners,
            predict scores, play football mini-games and follow your points on the leaderboard.
          </p>
          <div className="brakup-seo-content__grid">
            <article>
              <h2>Start from the match map</h2>
              <p>Open the map, select the live fixture, pick a side and launch the arcade match to confirm your prediction.</p>
            </article>
            <article>
              <h2>Create your World Cup bracket</h2>
              <p>Resolve every knockout fixture, save your bracket with a pseudo and come back when real results update your score.</p>
            </article>
            <article>
              <h2>Score points</h2>
              <p>You score points for correct winners, exact scores, scorers and bonus streaks earned through Brakup game mode.</p>
            </article>
            <article>
              <h2>Play without an account</h2>
              <p>You can build a local bracket first, then sync it later to publish your score and compare with friends.</p>
            </article>
          </div>
          <div className="brakup-seo-content__faq" aria-label="World Cup 2026 Challenge FAQ">
            <h2>World Cup 2026 Challenge FAQ</h2>
            <details open>
              <summary>What is the Brakup Challenge?</summary>
              <p>A football prediction challenge mixing a World Cup bracket predictor, arcade mini-games and leaderboard scoring.</p>
            </details>
            <details>
              <summary>Can I share my challenge with friends?</summary>
              <p>Yes. Brakup can share your bracket, match results and leaderboard position.</p>
            </details>
            <details>
              <summary>How is Brakup different from a simple bracket?</summary>
              <p>Brakup makes each pick playable: a selected winner is confirmed on the map after a mini-game result.</p>
            </details>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="brakup-phone-shell brakup-guide-page">
      <div className="brakup-guide-page__top"><button type="button" className="brakup-guide-page__back" onClick={onBackToGame}>Retour au jeu</button></div>
      <section className="brakup-seo-content" aria-labelledby="challenge-guide-title">
        <p className="brakup-seo-content__eyebrow">Challenge Coupe du Monde 2026</p>
        <h1 id="challenge-guide-title">Comment jouer au Brakup Challenge</h1>
        <p>
          Brakup est un jeu de prediction Coupe du Monde 2026 pense pour jouer entre amis :
          cree ton bracket, predis les scores, lance des mini-jeux foot arcade et grimpe au classement.
        </p>
        <div className="brakup-seo-content__grid">
          <article>
            <h2>Pars de la carte des matchs</h2>
            <p>Ouvre la carte, selectionne le match disponible, choisis ton camp puis lance le mini-jeu pour confirmer ton prono.</p>
          </article>
          <article>
            <h2>Cree ton bracket Coupe du Monde</h2>
            <p>Resous chaque phase finale, sauvegarde ton bracket avec un pseudo et reviens quand les vrais resultats mettent ton score a jour.</p>
          </article>
          <article>
            <h2>Marque des points</h2>
            <p>Tu marques des points avec les bons vainqueurs, les scores exacts, les buteurs et les bonus de serie gagnes dans le mode Brakup.</p>
          </article>
          <article>
            <h2>Joue sans compte</h2>
            <p>Tu peux preparer un bracket local, puis le synchroniser ensuite pour publier ton score et te comparer aux autres joueurs.</p>
          </article>
        </div>
        <div className="brakup-seo-content__faq" aria-label="FAQ Coupe du Monde 2026 Challenge">
          <h2>FAQ Coupe du Monde 2026 Challenge</h2>
          <details open>
            <summary>Qu'est-ce que le Brakup Challenge ?</summary>
            <p>Un challenge de pronostic foot qui melange bracket Coupe du Monde, mini-jeux arcade et classement entre joueurs.</p>
          </details>
          <details>
            <summary>Peut-on partager son challenge avec ses amis ?</summary>
            <p>Oui. Brakup permet de partager ton bracket, tes resultats de match et ta place au classement.</p>
          </details>
          <details>
            <summary>Quelle est la difference avec un simple bracket ?</summary>
            <p>Brakup rend chaque choix jouable : un vainqueur selectionne est confirme sur la carte apres un vrai resultat de mini-jeu.</p>
          </details>
        </div>
      </section>
    </main>
  )

}

function MapSyncLoading() {
  return (
    <section className="wcmap-sync" role="status" aria-live="polite" aria-label="Synchronisation de la carte">
      <div className="wcmap-sync__stadium" aria-hidden="true">
        <svg viewBox="0 0 64 48">
          <path d="M7 20 Q32 7 57 20 L52 38 Q32 47 12 38 Z" />
          <ellipse cx="32" cy="29" rx="17" ry="7" />
          <path d="M32 22 V36" />
          <path d="M14 17 10 6M50 17 54 6" />
        </svg>
      </div>
      <strong>Synchronisation</strong>
      <span>Preparation de la carte</span>
      <div className="wcmap-sync__bar"><i /></div>
    </section>
  )
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
  officialFinishedMatchIds = [],
  topScorers = [],
  locale = 'fr',
}: BrakupHubProps) {
  const [view, setView] = useState<HubView>(readInitialView)
  const [showSplash, setShowSplash] = useState(readInitialShowSplash)
  const [showBracket, setShowBracket] = useState(false)
  const [activeMatchId, setActiveMatchId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('match'))
  const [simulatedMatchId, setSimulatedMatchId] = useState<string | null>(null)
  const [mapResetKey, setMapResetKey] = useState(0)
  const [mapDataSettling, setMapDataSettling] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('token') ?? localStorage.getItem('brakup:token'))
  const [otpMode] = useState(() => new URLSearchParams(window.location.search).has('otp'))
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    try {
      const challengeDraft = JSON.parse(localStorage.getItem('brakup:draft') ?? '{}') as Record<string, string>
      return { ...challengeDraft, ...readClassicKnockoutPicks() }
    } catch {
      return readClassicKnockoutPicks()
    }
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
  const [difficultySetting, setDifficultySetting] = useState<BattleDifficultySetting>(readDifficultySetting)
  const [, setHadAccount] = useState(() => localStorage.getItem(HAD_ACCOUNT_KEY) === 'true')
  const [autosavedAt, setAutosavedAt] = useState<string | null>(() => localStorage.getItem(AUTOSAVE_STORAGE_KEY))
  const [brackets, setBrackets] = useState<ChallengeEntry[]>([])
  const [activeBracketId, setActiveBracketId] = useState<string | null>(null)
  const [viewedBracketEntry, setViewedBracketEntry] = useState<ChallengeEntry | null>(null)
  const [showEmailEntry, setShowEmailEntry] = useState(false)
  const [showLoginEntry, setShowLoginEntry] = useState(false)
  const [showOTPEntry, setShowOTPEntry] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [pendingPseudo, setPendingPseudo] = useState<string | null>(null)
  const [loginToken, setLoginToken] = useState<string | null>(null)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpBusy, setOtpBusy] = useState(false)
  const [showGameMenu, setShowGameMenu] = useState(false)
  const [showProfileSettings, setShowProfileSettings] = useState(false)
  const [profileStatus, setProfileStatus] = useState<Awaited<ReturnType<typeof getProfileStatus>> | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [showBattleControls, setShowBattleControls] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginSent, setLoginSent] = useState(false)
  const [loginEmail, setLoginEmail] = useState<string | null>(null)
  const [loginFlow, setLoginFlow] = useState<'existing' | 'new'>('existing')
  const [loginPseudo, setLoginPseudo] = useState('')
  const [pendingPostAuthAction, setPendingPostAuthAction] = useState<'share' | null>(null)
  const [loadingBrackets, setLoadingBrackets] = useState(Boolean(accessToken))
  const [outcomeShareStatus, setOutcomeShareStatus] = useState<'idle' | 'working' | 'ready' | 'done' | 'error'>('idle')
  const [outcomeShareUrl, setOutcomeShareUrl] = useState<string | null>(null)
  const [outcomeSharePreviewUrl, setOutcomeSharePreviewUrl] = useState<string | null>(null)
  const [outcomeSharePreviewOpen, setOutcomeSharePreviewOpen] = useState(false)
  const [isOutcomeCapturingShare, setIsOutcomeCapturingShare] = useState(false)
  const [outcomeNoticeKey, setOutcomeNoticeKey] = useState<string | null>(null)
  const [forcedOutcomeNotice, setForcedOutcomeNotice] = useState<OutcomeNotice | null>(null)
  const [outcomeBreakdownExpanded, setOutcomeBreakdownExpanded] = useState(false)
  const [seenOutcomeVersion, setSeenOutcomeVersion] = useState(0)
  const [remoteSeenOutcomeKeys, setRemoteSeenOutcomeKeys] = useState<string[]>([])
  const outcomeShareRunRef = useRef(0)
  const mapSyncEndedAtRef = useRef(0)

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
  const audioVolume = useGameAudioVolume()

  useEffect(() => {
    return subscribeChallengeProfile((profile) => setSavedProfile(profile))
  }, [])

  const baseMatches = useMemo(() => buildKnockoutBracket(standings, groupMatches), [standings, groupMatches])
  // Base real results (no dependency on matches — breaks circular dep)
  const baseRealResults = useMemo<Record<string, string>>(() => ({ ...storedRealResults, ...officialResults }), [officialResults, storedRealResults])
  const matches = useMemo(() => resolveMatches(baseMatches, picks, baseRealResults), [baseMatches, picks, baseRealResults])
  const activeMatch = matches.find((match) => match.id === activeMatchId)
  const hasSyncedProfile = Boolean(accessToken && savedProfile.email && savedProfile.pseudo)
  const officialScoreMap = useMemo(
    () => ({ ...storedRealScores, ...officialScores }),
    [officialScores, storedRealScores],
  )
  const officialFinishedSet = useMemo(() => new Set(officialFinishedMatchIds), [officialFinishedMatchIds])
  const officialMapSignature = useMemo(() => {
    const resultKeys = Object.keys(baseRealResults).sort().join(',')
    const scoreKeys = Object.keys(officialScoreMap).sort().join(',')
    const finishedKeys = [...officialFinishedSet].sort().join(',')
    return `${resultKeys}|${scoreKeys}|${finishedKeys}`
  }, [baseRealResults, officialFinishedSet, officialScoreMap])
  const realResults = useMemo(() => {
    const derivedFromScores = matches.reduce<Record<string, string>>((results, match) => {
      const score = officialScoreMap[match.id]
      const canDeriveFromScore = officialFinishedSet.has(match.id) || Boolean(storedRealResults[match.id])
      if (!canDeriveFromScore) return results
      if (!score || score.home === score.away || match.home.kind !== 'team' || match.away.kind !== 'team') return results
      results[match.id] = score.home > score.away ? match.home.teamId : match.away.teamId
      return results
    }, {})
    return { ...baseRealResults, ...derivedFromScores }
  }, [matches, officialFinishedSet, officialScoreMap, baseRealResults, storedRealResults])
  const teamsByFifaCode = useMemo(() => new Map([...teamsById.values()].map((team) => [team.fifaCode, team])), [teamsById])
  const realScorers = useMemo<RealScorer[]>(() => topScorers.flatMap((scorer) => {
    const team = teamsByFifaCode.get(scorer.teamCode)
    return team ? [{ name: scorer.name, teamId: team.id, teamCode: scorer.teamCode, goals: scorer.goals }] : []
  }), [teamsByFifaCode, topScorers])
  const pendingOutcomeNotices = useMemo<OutcomeNotice[]>(() => {
    const seen = new Set([...readSeenOutcomeKeys(), ...remoteSeenOutcomeKeys])
    return matches
      .map((match) => {
        const progress = evaluateMatchProgress(match, picks, battleScores, realResults, officialScoreMap, scorers, realScorers)
        const key = outcomeStorageKey(match.id, progress.realWinnerTeamId, progress.realScore)
        return { key, match, progress }
      })
      .filter((item) => {
        const hasFinalOfficialResult = officialFinishedSet.has(item.match.id) || Boolean(storedRealResults[item.match.id])
        return hasFinalOfficialResult && item.progress.played && !seen.has(item.key)
      })
  }, [battleScores, matches, officialFinishedSet, officialScoreMap, picks, realResults, realScorers, remoteSeenOutcomeKeys, scorers, seenOutcomeVersion, storedRealResults])
  const outcomeNotice = forcedOutcomeNotice ?? pendingOutcomeNotices.find((item) => item.key === outcomeNoticeKey) ?? pendingOutcomeNotices[0] ?? null
  const outcomeNoticeIndex = outcomeNotice ? pendingOutcomeNotices.findIndex((item) => item.key === outcomeNotice.key) : -1
  const hubAudioSrc = outcomeNotice?.progress.correct ? '/audio/cup-victory-parade.mp3' : view !== 'battle' ? '/audio/kickoff-carnival.mp3' : null
  // Lobby music: kickoff when on challenge/brackets/board. Null during battle (BattleEngine takes over).
  useGameAudio(hubAudioSrc)
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

  useEffect(() => {
    if (view !== 'challenge' || showSplash) return
    const now = performance.now()
    if (!mapDataSettling && now - mapSyncEndedAtRef.current < 1200) return
    setMapDataSettling(true)
    const timeoutId = window.setTimeout(() => {
      mapSyncEndedAtRef.current = performance.now()
      setMapDataSettling(false)
    }, 520)
    return () => window.clearTimeout(timeoutId)
  }, [officialMapSignature, mapDataSettling, showSplash, view])

  // Reconstruire un BattleResult pour un match deja joue
  function makeExistingBattleResult(match: KnockoutMatch, battleScores: Record<string, { p: number; o: number }>, scorers: Record<string, BattleScorer[]>): import('../types').BattleResult | null {
    if (match.home.kind !== 'team' || match.away.kind !== 'team') return null
    const matchId = match.id
    const scoreData = battleScores[matchId]
    if (!scoreData) return null
    
    const pickedTeamId = picks[matchId]
    const normalizedScore = scoreData.p < scoreData.o ? { p: scoreData.o, o: scoreData.p } : scoreData
    const playerTeamId = pickedTeamId === match.away.teamId ? match.away.teamId : match.home.teamId
    const opponentTeamId = playerTeamId === match.home.teamId ? match.away.teamId : match.home.teamId
    const playerWon = normalizedScore.p >= normalizedScore.o
    const winnerId = playerWon ? playerTeamId : opponentTeamId
    
    return {
      homeScore: normalizedScore.p,
      awayScore: normalizedScore.o,
      winnerId,
      playerScore: normalizedScore.p,
      rounds: [], // Pas de rounds detailles pour un match deja joue
      scorers: scorers[matchId] ?? [],
      penalties: undefined,
      simulated: true,
      commentary: playerWon 
        ? `Victoire contre ${teamsById.get(opponentTeamId)?.name || opponentTeamId} !`
        : `Defaite contre ${teamsById.get(opponentTeamId)?.name || opponentTeamId}.`,
    }
  }

  const rememberProfile = useCallback((values: { email: string; pseudo: string; bracketName: string }) => {
    const next = { ...values, savedAt: new Date().toISOString() }
    writeChallengeProfile(next)
    setSavedProfile(next)
  }, [])

  const updateDifficultySetting = useCallback((difficulty: BattleDifficultySetting) => {
    setDifficultySetting(difficulty)
    try {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty)
    } catch {
      // localStorage can be unavailable in private browsing.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('brakup:draft', JSON.stringify(picks))
    writeClassicKnockoutPicks(picks)
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
    getBrackets(accessToken).then((entries) => {
      setBrackets(entries)
      if (!entries[0]) return
      const activeEntry = entries.find((entry) => entry.id === activeBracketId) ?? entries[0]
      setActiveBracketId(activeEntry.id)
      setPicks({ ...(activeEntry.picks ?? {}), ...readClassicKnockoutPicks() })
      setBattleScores(activeEntry.battleScores ?? {})
      setScorers(activeEntry.scorers ?? {})
      setBattleBonuses(activeEntry.battleBonuses ?? 0)
      setSavedProfile((current) => {
        const next = {
          email: current.email,
          pseudo: activeEntry.pseudo ?? current.pseudo,
          bracketName: activeEntry.bracketName ?? current.bracketName,
          savedAt: current.savedAt ?? new Date().toISOString(),
        }
        writeChallengeProfile(next)
        return next
      })
    }).catch(() => undefined).finally(() => setLoadingBrackets(false))
  }, [accessToken, activeBracketId])

  useEffect(() => {
    if (!accessToken) {
      setRemoteSeenOutcomeKeys([])
      return
    }
    getSeenOutcomeKeys(accessToken).then((keys) => {
      setRemoteSeenOutcomeKeys(keys)
      const merged = [...new Set([...readSeenOutcomeKeys(), ...keys])]
      localStorage.setItem(SEEN_OUTCOMES_STORAGE_KEY, JSON.stringify(merged))
      setSeenOutcomeVersion((version) => version + 1)
    }).catch(() => undefined)
  }, [accessToken])

  useEffect(() => {
    if (!accessToken || !showProfileSettings) return
    getProfileStatus(accessToken).then((status) => {
      setProfileStatus(status)
      setProfileError(null)
    }).catch((caught) => {
      setProfileError(caught instanceof Error ? caught.message : 'Statut indisponible.')
    })
  }, [accessToken, showProfileSettings])

  const navigate = (next: HubView, matchId?: string) => {
    const nextParams = new URLSearchParams()
    if (next === 'brackets') nextParams.set('brackets', '')
    if (next === 'board') nextParams.set('board', '')
    if (next === 'battle' && matchId) nextParams.set('match', matchId)
    const query = nextParams.toString().replace(/=$/, '')
    window.history.pushState({}, '', `${localizedChallengeHref(locale)}${query ? `?${query}` : ''}`)
    setShowGameMenu(false)
    setView(next)
    setActiveMatchId(matchId ?? null)
    trackAnalytics('challenge_navigation', { view: next, matchId }, 'challenge')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigateGuide = () => {
    window.history.pushState({}, '', localizedChallengeGuideHref(locale))
    setShowGameMenu(false)
    setView('guide')
    setActiveMatchId(null)
    trackAnalytics('challenge_navigation', { view: 'guide' }, 'challenge')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const returnFromGuideToGame = () => {
    skipSplashOnNextChallengeOpen()
    setShowSplash(false)
    returnToMap()
  }

  const returnToMap = () => {
    navigate('challenge')
  }


  const viewBracket = async (entry: ChallengeEntry) => {
    setViewedBracketEntry(entry)
    setView('viewBracket')
  }

  const closeViewBracket = () => {
    setViewedBracketEntry(null)
    setView('board')
  }

  const handlePick = (matchId: string, teamId: string | null) => {
    if (teamId === null) {
      trackAnalytics('challenge_cancel_pick', { matchId }, 'challenge')
      setPicks((current) => {
        const next = { ...current }
        delete next[matchId]
        return next
      })
      setBattleScores((current) => {
        const next = { ...current }
        delete next[matchId]
        return next
      })
      setScorers((current) => {
        const next = { ...current }
        delete next[matchId]
        return next
      })
      return
    }
    trackAnalytics('challenge_pick_team', { matchId, teamId }, 'challenge')
    setPicks((current) => ({ ...current, [matchId]: teamId }))
  }
  const handlePlay = (matchId: string, teamId?: string) => {
    trackAnalytics('challenge_play_match', { matchId, teamId, alreadyPlayed: battleScores[matchId] !== undefined }, 'challenge')
    const m = matches.find((mx) => mx.id === matchId)
    const selectedTeamId = teamId ?? picks[matchId]
    if (selectedTeamId && m?.home.kind === 'team' && m.away.kind === 'team') {
      if (m.home.teamId === selectedTeamId) {
        setActiveSide('home')
      } else if (m.away.teamId === selectedTeamId) {
        setActiveSide('away')
      } else {
        handlePick(matchId, null)
        return
      }
    }
    if (battleScores[matchId] !== undefined) {
      setBattleScores((cur) => { const n = { ...cur }; delete n[matchId]; return n })
      setScorers((cur) => { const n = { ...cur }; delete n[matchId]; return n })
    }
    navigate('battle', matchId)
  }
  const handleSimulate = (matchId: string) => {
    trackAnalytics('challenge_simulate_match', { matchId }, 'challenge')
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
      setAccessToken(token)
      // Charger les brackets
      const entries = await getBrackets(token)
      setBrackets(entries)
      if (entries[0]) {
        setActiveBracketId(entries[0].id)
        setPicks({ ...(entries[0].picks ?? {}), ...readClassicKnockoutPicks() })
      }
      // Sauvegarder le profil
      rememberProfile({ email: pendingEmail, pseudo: pendingPseudo, bracketName: pendingPseudo })
      identifyAnalyticsProfile({ pseudo: pendingPseudo, hasAccount: true })
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

  const handleOTPResend = async () => {
    if (!pendingEmail || !pendingPseudo) return
    setOtpBusy(true)
    setOtpError(null)
    try {
      await requestOTP(pendingEmail, pendingPseudo)
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : 'Renvoi impossible.')
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
    }, accessToken ?? undefined)
    localStorage.setItem('brakup:token', result.token)
    setAccessToken(result.token)
    setBrackets((entries) => entries.some((entry) => entry.id === result.entry.id) ? entries.map((entry) => entry.id === result.entry.id ? result.entry : entry) : [...entries, result.entry])
    setActiveBracketId(result.entry.id)
    return result
  }, [activeBracketId, brackets, accessToken])

  const handleBattleComplete = (result: BattleResult) => {
    const mid = activeMatchId ?? ''
    const officialReplay = Boolean(mid && realResults[mid])
    const nextPicks = mid ? { ...picks, [mid]: result.winnerId } : picks
    const playerTeamId = activeMatch?.home.kind === 'team' && activeMatch.away.kind === 'team'
      ? activeSide === 'away' ? activeMatch.away.teamId : activeMatch.home.teamId
      : result.winnerId
    const winnerScore = result.winnerId === playerTeamId ? result.homeScore : result.awayScore
    const loserScore = result.winnerId === playerTeamId ? result.awayScore : result.homeScore
    const nextBattleScores = mid ? { ...battleScores, [mid]: { p: winnerScore, o: loserScore } } : battleScores
    const nextScorers = mid ? { ...scorers, [mid]: result.scorers ?? [] } : scorers
    const nextBattleBonuses = Math.min(40, battleBonuses + Math.max(1, Math.round(result.playerScore / 20)))
    const nextProgressStats = summarizeProgress(matches, nextPicks, nextBattleScores, realResults, officialScoreMap, nextBattleBonuses, nextScorers, realScorers)
    const nextBreakdown = buildProgressBreakdown(matches, nextPicks, nextBattleScores, realResults, officialScoreMap, nextScorers, realScorers)
    if (officialReplay && activeMatch) {
      const replayProgress = evaluateMatchProgress(activeMatch, nextPicks, nextBattleScores, realResults, officialScoreMap, nextScorers, realScorers)
      setForcedOutcomeNotice({
        key: `${outcomeStorageKey(activeMatch.id, replayProgress.realWinnerTeamId, replayProgress.realScore)}:replay:${Date.now()}`,
        match: activeMatch,
        progress: replayProgress,
      })
    }
    trackAnalytics('challenge_battle_complete', {
      matchId: mid,
      winnerId: result.winnerId,
      playerScore: result.playerScore,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      scorers: result.scorers?.length ?? 0,
      officialReplay,
    }, 'challenge')
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
      }).finally(() => setSaving(false))
    } else {
      setShowEmailEntry(true)
    }
    returnToMap()
  }
  const handleSimulationComplete = (winnerId: string, score?: { home: number; away: number }) => {
    const match = matches.find((item) => item.id === simulatedMatchId)
    if (!match || match.home.kind !== 'team' || match.away.kind !== 'team') {
      setSimulatedMatchId(null)
      setMapResetKey((key) => key + 1)
      return
    }

    const winnerIsHome = winnerId === match.home.teamId
    const simulatedScore = score ?? (winnerIsHome ? { home: 1, away: 0 } : { home: 0, away: 1 })
    const nextMatchScore = winnerIsHome
      ? { p: simulatedScore.home, o: simulatedScore.away }
      : { p: simulatedScore.away, o: simulatedScore.home }
    handlePick(match.id, winnerId)
    setBattleScores((current) => ({ ...current, [match.id]: nextMatchScore }))
    setScorers((current) => {
      const next = { ...current }
      delete next[match.id]
      return next
    })
    setSimulatedMatchId(null)
    trackAnalytics('challenge_simulation_complete', { matchId: match.id, winnerId, score: simulatedScore }, 'challenge')
    returnToMap()
  }

  const save = async ({ email, pseudo, bracketName, submitted }: { email: string; pseudo: string; bracketName: string; submitted: boolean }) => {
    setSaving(true); setSaveError(null)
    
    // Si on vient du flow OTP (loginToken existe), juste mettre a jour le pseudo
    if (loginToken) {
      try {
        const result = await updateProfile(loginToken, { email, pseudo })
        await loadAccountFromToken(result.token, email)
        setLoginToken(null)
        setPendingEmail(null)
        setShowEmailEntry(false)
        rememberProfile({ email, pseudo, bracketName })
        identifyAnalyticsProfile({ pseudo, hasAccount: true })
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : 'Mise a jour impossible.')
      } finally {
        setSaving(false)
      }
      return
    }
    
    rememberProfile({ email, pseudo, bracketName })
    identifyAnalyticsProfile({ pseudo, hasAccount: Boolean(accessToken) })
    if (!accessToken) {
      try {
        await requestOTP(email, pseudo)
        setPendingEmail(email)
        setPendingPseudo(pseudo)
        setShowEmailEntry(false)
        setShowOTPEntry(true)
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : 'Envoi du code impossible.')
      } finally {
        setSaving(false)
      }
      return
    }

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

  const handleLogout = () => {
    clearBrakupLocalSession()
    setAccessToken(null)
    setSavedProfile({ email: '', pseudo: '', bracketName: 'Mon bracket' })
    setHadAccount(false)
    setPicks({})
    setBattleScores({})
    setScorers({})
    setBattleBonuses(0)
    setBrackets([])
    setActiveBracketId(null)
    setViewedBracketEntry(null)
    setAutosavedAt(null)
    setPendingEmail(null)
    setPendingPseudo(null)
    setLoginToken(null)
    setLoginEmail(null)
    setLoginError(null)
    setLoginSent(false)
    setLoginBusy(false)
    setOtpError(null)
    setOtpBusy(false)
    setProfileError(null)
    setProfileStatus(null)
    setRemoteSeenOutcomeKeys([])
    setSeenOutcomeVersion((version) => version + 1)
    setOutcomeNoticeKey(null)
    setForcedOutcomeNotice(null)
    setOutcomeShareStatus('idle')
    setOutcomeShareUrl(null)
    if (outcomeSharePreviewUrl) URL.revokeObjectURL(outcomeSharePreviewUrl)
    setOutcomeSharePreviewUrl(null)
    setOutcomeSharePreviewOpen(false)
    setIsOutcomeCapturingShare(false)
    setShowEmailEntry(false)
    setShowLoginEntry(false)
    setShowOTPEntry(false)
    setShowProfileSettings(false)
    setShowGameMenu(false)
    setMapResetKey((key) => key + 1)
    trackAnalytics('challenge_logout', {}, 'challenge')
  }

  const handleLogin = async (email: string) => {
    setLoginBusy(true)
    setLoginError(null)
    setLoginSent(false)
    setLoginEmail(email)
    const pseudo = savedProfile.pseudo.trim()
      || (email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
      || 'Joueur'
    setLoginPseudo(pseudo)
    try {
      const emailExists = await checkEmailExists(email)
      setLoginFlow(emailExists ? 'existing' : 'new')
      const result = emailExists ? await resendMagicLink(email) : null
      if (!emailExists) await requestOTP(email, pseudo)
      setLoginSent(true)
      if (result?.token) {
        localStorage.setItem('brakup:token', result.token)
        setAccessToken(result.token)
        const entries = await getBrackets(result.token)
        setBrackets(entries)
        if (entries[0]) {
          setActiveBracketId(entries[0].id)
          setPicks({ ...(entries[0].picks ?? {}), ...readClassicKnockoutPicks() })
          setBattleScores(entries[0].battleScores ?? {})
          setScorers(entries[0].scorers ?? {})
          setBattleBonuses(entries[0].battleBonuses ?? 0)
          rememberProfile({ email, pseudo: entries[0].pseudo, bracketName: entries[0].bracketName })
          identifyAnalyticsProfile({ pseudo: entries[0].pseudo, hasAccount: true })
          setShowLoginEntry(false)
        }
      }
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : 'Connexion impossible.')
    } finally {
      setLoginBusy(false)
    }
  }

  const loadAccountFromToken = async (token: string, email: string) => {
    localStorage.setItem('brakup:token', token)
    setAccessToken(token)
    const entries = await getBrackets(token)
    setBrackets(entries)
    if (entries[0]) {
      setActiveBracketId(entries[0].id)
      setPicks({ ...(entries[0].picks ?? {}), ...readClassicKnockoutPicks() })
      setBattleScores(entries[0].battleScores ?? {})
      setScorers(entries[0].scorers ?? {})
      setBattleBonuses(entries[0].battleBonuses ?? 0)
      rememberProfile({ email, pseudo: entries[0].pseudo, bracketName: entries[0].bracketName })
      identifyAnalyticsProfile({ pseudo: entries[0].pseudo, hasAccount: true })
    }
  }

  const handleLoginOTP = async (otp: string, verifiedPseudo?: string) => {
    if (!loginEmail) return
    setLoginBusy(true)
    setLoginError(null)
    try {
      const pseudo = verifiedPseudo?.trim()
        || loginPseudo
        || (loginEmail.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20)
        || 'Joueur'
      const result = loginFlow === 'new'
        ? { token: await verifyOTP(loginEmail, pseudo, otp), email: loginEmail }
        : await verifyLoginOTP(loginEmail, otp, pseudo)

      await loadAccountFromToken(result.token, result.email)
      if (loginFlow === 'new') {
        rememberProfile({ email: result.email, pseudo, bracketName: savedProfile.bracketName || pseudo })
      }
      setLoginToken(null)
      setShowLoginEntry(false)
      setLoginSent(false)
      setHadAccount(true)
      localStorage.setItem(HAD_ACCOUNT_KEY, 'true')
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : 'Code invalide.')
    } finally {
      setLoginBusy(false)
    }
  }

  const handleLoginResend = async () => {
    if (!loginEmail) return
    setLoginBusy(true)
    setLoginError(null)
    try {
      if (loginFlow === 'new') {
        await requestOTP(loginEmail, loginPseudo || 'Joueur')
      } else {
        await resendMagicLink(loginEmail)
      }
      setLoginSent(false)
      window.setTimeout(() => setLoginSent(true), 50)
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : 'Renvoi impossible.')
    } finally {
      setLoginBusy(false)
    }
  }

  const openBracket = (entry: ChallengeEntry) => { setPicks({ ...(entry.picks ?? {}), ...readClassicKnockoutPicks() }); setBattleScores(entry.battleScores ?? {}); setScorers(entry.scorers ?? {}); setBattleBonuses(entry.battleBonuses); setActiveBracketId(entry.id); returnToMap() }
  const openBracketOverlay = () => {
    setShowBracket(true)
  }
  const closeBracketOverlay = () => {
    setShowBracket(false)
    setMapResetKey((key) => key + 1)
    if (document.fullscreenElement) {
      const fullscreenExit = document.exitFullscreen?.()
      fullscreenExit?.catch(() => undefined)
    }
  }
  const introActive = view === 'challenge' && showSplash
  const simulatedMatch = simulatedMatchId ? matches.find((match) => match.id === simulatedMatchId) : null

  useEffect(() => {
    if (!challengePreload.ready || showSplash) return
    if (!outcomeNoticeKey || !pendingOutcomeNotices.some((item) => item.key === outcomeNoticeKey)) {
      setOutcomeNoticeKey(pendingOutcomeNotices[0]?.key ?? null)
    }
  }, [challengePreload.ready, outcomeNoticeKey, pendingOutcomeNotices, showSplash])

  const closeOutcomeNotice = () => {
    if (outcomeNotice && !forcedOutcomeNotice) {
      const seen = new Set(readSeenOutcomeKeys())
      pendingOutcomeNotices.forEach((item) => seen.add(item.key))
      const nextSeen = [...new Set([...remoteSeenOutcomeKeys, ...seen])]
      localStorage.setItem(SEEN_OUTCOMES_STORAGE_KEY, JSON.stringify(nextSeen))
      setRemoteSeenOutcomeKeys(nextSeen)
      if (accessToken) {
        void markSeenOutcomeKeys(accessToken, nextSeen).then((keys) => {
          setRemoteSeenOutcomeKeys(keys)
          localStorage.setItem(SEEN_OUTCOMES_STORAGE_KEY, JSON.stringify(keys))
        }).catch(() => undefined)
      }
      setSeenOutcomeVersion((version) => version + 1)
    }
    setForcedOutcomeNotice(null)
    setOutcomeNoticeKey(null)
    setOutcomeShareStatus('idle')
    setOutcomeShareUrl(null)
    if (outcomeSharePreviewUrl) URL.revokeObjectURL(outcomeSharePreviewUrl)
    setOutcomeSharePreviewUrl(null)
    setOutcomeSharePreviewOpen(false)
    setIsOutcomeCapturingShare(false)
    setOutcomeBreakdownExpanded(false)
  }

  const showOutcomeAt = (index: number) => {
    const next = pendingOutcomeNotices[index]
    if (!next) return
    setOutcomeNoticeKey(next.key)
  }

  const buildChallengeShareUrl = () => `${window.location.origin}${localizedChallengeHref(locale)}`

  const buildOutcomeShareText = () => {
    if (!outcomeNotice) return `Viens tenter ton bracket Brakup.`
    const parts: string[] = []
    if (outcomeNotice.progress.correct) parts.push("J'ai reussi le bon prono")
    if (outcomeNotice.progress.exact) parts.push("j'ai trouve le score exact")
    if (outcomeNotice.progress.scorerHits.length > 0) {
      const scorerLabel = outcomeNotice.progress.scorerHits.length === 1
        ? `j'ai aussi trouve un buteur: ${outcomeNotice.progress.scorerHits[0].name}`
        : `j'ai aussi trouve ${outcomeNotice.progress.scorerHits.length} buteurs`
      parts.push(scorerLabel)
    }
    if (!parts.length) {
      parts.push("J'ai tente mon prono sur Brakup")
    }
    return `Brakup ${outcomeMatchLabel}: reel ${formatScore(outcomeNotice.progress.realScore)} (${outcomeRealWinnerLabel}), mon prono ${formatScore(outcomeNotice.progress.playedScore)} (${outcomePickedWinnerLabel}). ${parts.join(', ')}. Et toi, tu veux essayer ?`
  }

  const handleOutcomeShare = async () => {
    if (!outcomeNotice) return
    if (!hasSyncedProfile) {
      setPendingPostAuthAction('share')
      setSaveError(null)
      setLoginError(null)
      setLoginSent(false)
      setLoginEmail(null)
      setLoginFlow('existing')
      setLoginPseudo('')
      setShowEmailEntry(false)
      setShowLoginEntry(true)
      return
    }
    if (outcomeShareUrl) {
      setOutcomeShareStatus('working')
      try {
        await withTimeout(
          shareLink({
            title: 'Brakup Challenge',
            text: buildOutcomeShareText(),
            url: outcomeShareUrl,
          }),
          SHARE_BUILD_TIMEOUT_MS,
          'Partage trop long. Retente dans quelques secondes.',
        )
        setOutcomeSharePreviewOpen(false)
        setOutcomeShareStatus('done')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setOutcomeShareStatus('ready')
          return
        }
        console.error('Outcome native share failed:', error)
        setOutcomeShareStatus('error')
      }
      return
    }
    const runId = outcomeShareRunRef.current + 1
    outcomeShareRunRef.current = runId
    setOutcomeShareStatus('working')
    setIsOutcomeCapturingShare(true)
    try {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const blob = await withTimeout(
        renderResultShareCanvas({
          backgroundSrc: '/brakup-share-bg-brakup.png',
          logoSrc: '/brakup-logo.png',
          ownerPseudo: savedProfile.pseudo || undefined,
          matchup: {
            homeFlag: teamFlagImageUrl(outcomeHomeTeam) ?? outcomeHomeTeam?.flagEmoji,
            awayFlag: teamFlagImageUrl(outcomeAwayTeam) ?? outcomeAwayTeam?.flagEmoji,
            homeLabel: outcomeHomeLabel,
            awayLabel: outcomeAwayLabel,
          },
          boomLabel: outcomeBoomLabel,
          headline: outcomeHeadline,
          subline: `${outcomeNotice.match.label} - reel ${formatScore(outcomeNotice.progress.realScore)} - ton pari ${formatScore(outcomeNotice.progress.playedScore)}`,
          messageLines: outcomeShareMessageLines,
          pointsLabel: `+${outcomeBreakdownTotal} points gagnes`,
          rows: outcomeShareRows,
          cta: 'Tente ta chance avec ton prono.',
        }),
        SHARE_BUILD_TIMEOUT_MS,
        'Construction du visuel trop longue. Retente dans quelques secondes.',
      )
      const shareTitle = `${outcomeHeadline} - ${outcomeMatchLabel}`
      const shareDescription = buildOutcomeShareText()
      const imageDataUrl = await withTimeout(blobToDataUrl(blob), 5000, 'Conversion du visuel trop longue.')
      const published = await withTimeout(
        publishResultShare({
          title: shareTitle,
          description: shareDescription,
          redirectUrl: buildChallengeShareUrl(),
          imageDataUrl,
          pseudo: savedProfile.pseudo || 'Brakup',
        }),
        SHARE_BUILD_TIMEOUT_MS,
        'Publication du visuel trop longue. Retente dans quelques secondes.',
      )
      if (outcomeShareRunRef.current !== runId) return
      if (outcomeSharePreviewUrl) URL.revokeObjectURL(outcomeSharePreviewUrl)
      setOutcomeSharePreviewUrl(URL.createObjectURL(blob))
      setOutcomeSharePreviewOpen(true)
      setOutcomeShareUrl(published.shareUrl)
      setOutcomeShareStatus('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setOutcomeShareStatus('idle')
        return
      }
      console.error('Outcome share failed:', error)
      setOutcomeShareStatus('error')
    } finally {
      if (outcomeShareRunRef.current === runId) {
        setIsOutcomeCapturingShare(false)
      }
    }
  }

  const closeOutcomeSharePreview = () => {
    outcomeShareRunRef.current += 1
    setIsOutcomeCapturingShare(false)
    setOutcomeSharePreviewOpen(false)
    setOutcomeShareStatus((status) => status === 'working' ? 'idle' : status)
  }

  useEffect(() => {
    if (!hasSyncedProfile || !pendingPostAuthAction) return
    const action = pendingPostAuthAction
    setPendingPostAuthAction(null)
    if (action === 'share') void handleOutcomeShare()
  }, [hasSyncedProfile, pendingPostAuthAction])

  const outcomeScorerNames = outcomeNotice?.progress.scorerHits.map((scorer) => scorer.name) ?? []
  const outcomeExactLabel = outcomeNotice?.progress.exact ? `Score exact +${outcomeNotice.progress.exactPoints}` : null
  const outcomeScorerLabel = outcomeNotice && outcomeNotice.progress.scorerPoints > 0
    ? `Buteur trouve +${outcomeNotice.progress.scorerPoints}`
    : null
  const outcomeBreakdownTotal = outcomeNotice?.progress.points ?? 0
  const outcomeHasPoints = outcomeBreakdownTotal > 0
  const outcomeIsPartial = Boolean(outcomeNotice && !outcomeNotice.progress.correct && outcomeHasPoints)
  const outcomeBoomLabel = outcomeNotice?.progress.correct ? 'PRONO OK' : outcomeIsPartial ? 'BONUS OK' : 'PRONO RATE'
  const outcomeHeadline = outcomeNotice?.progress.correct ? 'Points gagnes' : outcomeIsPartial ? 'Bonus gagne' : 'Rien gagne'
  const outcomeMatchLabel = outcomeNotice?.match.label ?? 'Match Brakup'
  const outcomeHomeTeam = outcomeNotice?.match.home.kind === 'team' ? teamsById.get(outcomeNotice.match.home.teamId) : undefined
  const outcomeAwayTeam = outcomeNotice?.match.away.kind === 'team' ? teamsById.get(outcomeNotice.match.away.teamId) : undefined
  const outcomeHomeLabel = teamLabel(outcomeHomeTeam, outcomeNotice?.match.home.kind === 'team' ? outcomeNotice.match.home.teamId : 'Home')
  const outcomeAwayLabel = teamLabel(outcomeAwayTeam, outcomeNotice?.match.away.kind === 'team' ? outcomeNotice.match.away.teamId : 'Away')
  const outcomeRealWinnerLabel = outcomeNotice?.progress.realWinnerTeamId
    ? teamLabel(teamsById.get(outcomeNotice.progress.realWinnerTeamId), outcomeNotice.progress.realWinnerTeamId)
    : 'vainqueur reel inconnu'
  const outcomePickedTeamId = outcomeNotice ? picks[outcomeNotice.match.id] : undefined
  const outcomePickedWinnerLabel = outcomePickedTeamId
    ? teamLabel(teamsById.get(outcomePickedTeamId), outcomePickedTeamId)
    : 'aucun prono'
  const outcomeShareMessageLines = outcomeNotice ? [
    `Match ${outcomeMatchLabel}`,
    `Vainqueur reel: ${outcomeRealWinnerLabel}`,
    `Ton prono: ${outcomePickedWinnerLabel}`,
  ] : []
  const outcomeShareRows = [
    ...(outcomeNotice?.progress.correct ? [{ label: `Vainqueur +${outcomeNotice.progress.stagePoints}`, tone: 'win' as const }] : []),
    ...(outcomeNotice?.progress.exact ? [{ label: `Score exact +${outcomeNotice.progress.exactPoints}`, tone: 'win' as const }] : []),
    ...(outcomeNotice && outcomeScorerNames.length ? [{ label: `Buteur trouve +${outcomeNotice.progress.scorerPoints}: ${outcomeScorerNames.join(', ')}`, tone: 'win' as const }] : []),
  ]
  const outcomeScoreRows = outcomeNotice ? [
    {
      label: 'Vainqueur trouve',
      detail: outcomeNotice.progress.correct ? outcomeRealWinnerLabel : null,
      points: outcomeNotice.progress.correct ? `+${outcomeNotice.progress.stagePoints}` : '0',
    },
    ...(outcomeExactLabel ? [{
      label: 'Score exact reussi',
      detail: null,
      points: outcomeExactLabel,
    }] : []),
    ...(outcomeScorerLabel ? [{
      label: 'Buteur trouve',
      detail: null,
      points: outcomeScorerLabel,
    }] : []),
    ...(outcomeScorerNames.length ? [{
      label: 'Scoreurs Brakup',
      detail: null,
      points: outcomeScorerNames.join(', '),
    }] : []),
  ] : []
  const visibleOutcomeScoreRows = outcomeBreakdownExpanded ? outcomeScoreRows : outcomeScoreRows.slice(0, 2)
  const hiddenOutcomeScoreRows = Math.max(0, outcomeScoreRows.length - visibleOutcomeScoreRows.length)
  const menuPseudo = savedProfile.pseudo || brackets.find((entry) => entry.id === activeBracketId)?.pseudo || 'Invite'
  const singleBracketEntry = currentLeaderboardEntry ?? brackets[0] ?? null

  useEffect(() => {
    setOutcomeShareStatus('idle')
    setOutcomeShareUrl(null)
    if (outcomeSharePreviewUrl) URL.revokeObjectURL(outcomeSharePreviewUrl)
    setOutcomeSharePreviewUrl(null)
    setOutcomeSharePreviewOpen(false)
    setIsOutcomeCapturingShare(false)
    setOutcomeBreakdownExpanded(false)
  }, [outcomeNotice?.key])

  useEffect(() => () => {
    if (outcomeSharePreviewUrl) URL.revokeObjectURL(outcomeSharePreviewUrl)
  }, [outcomeSharePreviewUrl])

  const handleProfileUpdate = async ({ email, pseudo }: { email: string; pseudo: string }) => {
    if (!accessToken) {
      setProfileError('Connecte ton compte depuis le lien email pour modifier le profil.')
      return
    }
    setProfileBusy(true)
    setProfileError(null)
    try {
      const result = await updateProfile(accessToken, { email, pseudo })
      localStorage.setItem('brakup:token', result.token)
      setAccessToken(result.token)
      setBrackets(result.entries)
      if (result.entries[0]) setActiveBracketId(result.entries[0].id)
      rememberProfile({
        email: result.profile.email,
        pseudo: result.profile.pseudo,
        bracketName: savedProfile.bracketName || result.entries[0]?.bracketName || 'Mon bracket',
      })
      identifyAnalyticsProfile({ pseudo: result.profile.pseudo, hasAccount: true })
      setProfileStatus({
        blobConfigured: result.profile.blobConfigured,
        bracketCount: result.profile.bracketCount,
        hasEntries: result.profile.bracketCount > 0,
        emailHash: result.entries[0]?.emailHash ?? '',
        pseudo: result.profile.pseudo,
        lastSavedAt: result.entries[0]?.createdAt ?? null,
      })
      setShowProfileSettings(false)
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : 'Mise a jour impossible.')
    } finally {
      setProfileBusy(false)
    }
  }

  return (
    <div className={`brakup-shell${view === 'challenge' ? ' brakup-shell--map-only' : ''}${view === 'board' ? ' brakup-shell--board-page' : ''}${view === 'guide' ? ' brakup-shell--guide-page' : ''}${introActive ? ' brakup-shell--intro' : ''}`}>
      {view === 'challenge' && showSplash && !challengePreload.ready ? <ChallengeLoading progress={challengePreload.progress} /> : null}
      {view === 'challenge' && showSplash && challengePreload.ready ? <ChallengeSplash locale={locale} onPlay={() => { markSplashSeen(); setShowSplash(false) }} /> : null}
      {view !== 'guide' ? <header className="brakup-topbar">
        <button type="button" className="brakup-brand" onClick={() => { sfx.tab(); returnToMap() }}><img src="/favicon-512.png" alt="" className="brakup-brand__ico" /><div><strong>BRAKUP</strong><small>World Cup Challenge</small></div></button>
        <nav>
          <button type="button" className={view === 'challenge' ? 'is-active' : ''} onClick={() => { sfx.tab(); returnToMap() }}>Challenge</button>
          <button type="button" className={view === 'board' ? 'is-active' : ''} onClick={() => { sfx.tab(); navigate('board') }}>Classement</button>
          <button type="button" className="brakup-lang-switch" onClick={() => { sfx.tab(); navigateGuide() }}>FAQ</button>
          <a className="brakup-lang-switch" href={alternateLanguageHref(locale)} hrefLang={locale === 'en' ? 'fr' : 'en'}>{locale === 'en' ? 'FR' : 'EN'}</a>
        </nav>
      </header> : null}
      {view === 'battle' && activeMatch?.home.kind === 'team' && activeMatch.away.kind === 'team' ? (
        <BattleEngine 
          match={activeMatch} 
          teamsById={teamsById} 
          onComplete={handleBattleComplete} 
          playerSide={activeSide} 
          onQuit={returnToMap}
          showControls={showBattleControls}
          ownerPseudo={savedProfile.pseudo || undefined}
          difficultySetting={difficultySetting}
          onDifficultyChange={updateDifficultySetting}
          existingResult={activeMatch ? makeExistingBattleResult(activeMatch, battleScores, scorers) : null}
        />
      ) : null}
      {view === 'battle' && (!activeMatch || activeMatch.home.kind !== 'team' || activeMatch.away.kind !== 'team') ? <section className="brakup-empty"><span>⚽</span><h2>Ce match n’est pas encore disponible</h2><button type="button" className="brakup-button" onClick={returnToMap}>Retour au bracket</button></section> : null}
      {view === 'challenge' ? <>
        <div className={`wcmap-sync-shell${mapDataSettling ? ' is-settling' : ''}`}>
          <WorldCupMapMenu key={mapResetKey} matches={matches} teamsById={teamsById} picks={picks} scores={battleScores} scorers={scorers} realScorers={realScorers} realResults={realResults} officialScores={officialScoreMap} autosavedAt={autosavedAt} ownerPseudo={hasSyncedProfile ? menuPseudo : ''} introReady={!showSplash && !mapDataSettling} onPick={handlePick} onPlay={handlePlay} onSimulate={handleSimulate} />
          {mapDataSettling ? <MapSyncLoading /> : null}
        </div>
        {!showBracket && !mapDataSettling ? <button type="button" className="game-menu-button" onClick={() => { sfx.click(); setShowGameMenu(true) }} aria-label="Ouvrir le menu jeu">
          <span />
          <span />
          <span />
        </button> : null}
      </> : null}

      {view === 'guide' ? <ChallengeGuidePage locale={locale} onBackToGame={returnFromGuideToGame} /> : null}

      {view === 'challenge' && showGameMenu ? (
        <div className="game-menu-modal" role="dialog" aria-modal="true" aria-label="Menu jeu">
          <button type="button" className="game-menu-modal__scrim" onClick={() => setShowGameMenu(false)} aria-label="Fermer le menu" />
          <div className="game-menu-modal__panel">
            <div className="game-menu-modal__head">
              <span>Menu jeu</span>
            </div>
            <div className="game-menu-modal__profile">
              <div className="game-menu-modal__profile-main">
                {hasSyncedProfile ? (
                  <button
                    type="button"
                    className="game-menu-modal__pseudo-edit"
                    onClick={() => {
                      setProfileError(null)
                      setShowProfileSettings(true)
                      setShowGameMenu(false)
                    }}
                    aria-label="Modifier le pseudo"
                  >
                    <strong>{menuPseudo}</strong>
                    <i aria-hidden="true">Editer</i>
                  </button>
                ) : (
                  <div className="game-menu-modal__guest-label" aria-label="Profil invite">
                    <strong>Invite</strong>
                  </div>
                )}
                {hasSyncedProfile ? (
                  <button type="button" onClick={handleLogout}>
                    Se deconnecter
                  </button>
                ) : (
                  <button type="button" onClick={() => { setLoginError(null); setLoginSent(false); setLoginEmail(null); setShowLoginEntry(true); setShowGameMenu(false) }}>
                    Se connecter
                  </button>
                )}
              </div>
              <small>{hasSyncedProfile ? savedProfile.email || 'Compte synchronise' : 'Progression invite sur cet appareil'}</small>
              {hasSyncedProfile && saveError ? <small>{saveError}</small> : null}
            </div>
            <div className="game-menu-modal__score">
              <strong>{progressStats.points}</strong>
              <span>pts</span>
              <small>{progressStats.correct} pronos OK · {progressStats.exact} scores exacts · {progressStats.scorers} buteurs</small>
            </div>
            <div className="game-menu-modal__difficulty">
              <span>Difficulte</span>
              <strong>{difficultySetting === 'auto' ? 'Auto' : difficultySetting === 'easy' ? 'Facile' : difficultySetting === 'medium' ? 'Moyen' : 'Difficile'}</strong>
            </div>
            <button type="button" className="game-menu-modal__item game-menu-modal__item--primary" onClick={() => { sfx.bracket(); setShowGameMenu(false); openBracketOverlay() }}>Tableau</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); setShowGameMenu(false); returnToMap() }}>Carte des matchs</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); navigate('board') }}>Classement</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); navigateGuide() }}>Comment jouer / FAQ</button>
            {hasSyncedProfile ? <button type="button" className="game-menu-modal__item" onClick={() => { setProfileError(null); setShowProfileSettings(true); setShowGameMenu(false) }}>Parametres du compte</button> : null}
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
              {topScorers.length > 0 ? topScorers.slice(0, 5).map((scorer, index) => {
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
            <label className="game-menu-modal__volume">
              <span>Volume</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(audioVolume * 100)}
                onChange={(event) => setGameAudioVolume(Number(event.currentTarget.value) / 100)}
              />
              <strong>{Math.round(audioVolume * 100)}</strong>
            </label>
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
          <div className="brakup-bracket-overlay__bar brakup-bracket-overlay__bar--return-only">
            <button type="button" className="brakup-bracket-overlay__close" onClick={() => { sfx.click(); closeBracketOverlay() }}>Retour au jeu</button>
          </div>
          <div className="brakup-bracket-overlay__body">
            <BracketChallenge matches={matches} teamsById={teamsById} picks={picks} scores={battleScores} officialScores={officialScoreMap} onPick={handlePick} onPlay={(matchId, teamId) => { closeBracketOverlay(); handlePlay(matchId, teamId) }} brackets={singleBracketEntry ? [singleBracketEntry] : []} activeBracketId={singleBracketEntry?.id ?? activeBracketId} onSelectBracket={(id) => { const entry = brackets.find((item) => item.id === id); if (entry) openBracket(entry) }} realResults={realResults} />
          </div>
        </div>
      ) : null}
      {view === 'brackets' ? <div className="brakup-phone-shell"><MyBrackets brackets={brackets} loading={loadingBrackets} onOpen={openBracket} onCreate={() => { writeClassicKnockoutPicks({}); setPicks({}); setActiveBracketId(null); returnToMap() }} /></div> : null}
      {view === 'board' ? <div className="brakup-phone-shell"><Leaderboard currentEntry={currentLeaderboardEntry} currentStats={progressStats} onBackToGame={() => { sfx.tab(); returnToMap() }} onViewBracket={viewBracket} /></div> : null}
      {view === 'viewBracket' && viewedBracketEntry ? (
        <div className="brakup-bracket-overlay brakup-bracket-overlay--map">
          <div className="brakup-bracket-overlay__bar">
            <span>Carte de {viewedBracketEntry.pseudo} · lecture seule</span>
            <button type="button" className="brakup-bracket-overlay__close" onClick={() => { sfx.click(); closeViewBracket() }}>Retour au jeu</button>
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
              ownerPseudo={viewedBracketEntry.pseudo}
              readOnly
            />
          </div>
        </div>
      ) : null}
      {outcomeNotice ? (
        <div className={`brakup-outcome${outcomeNotice.progress.correct ? ' is-correct' : outcomeIsPartial ? ' is-partial' : ' is-wrong'}${isOutcomeCapturingShare ? ' is-share-capturing' : ''}`} role="dialog" aria-modal="true">
          <div className="brakup-outcome__panel">
            <div className="brakup-outcome__matchup" aria-label={`${outcomeHomeLabel} contre ${outcomeAwayLabel}`}>
              <OutcomeFlag team={outcomeHomeTeam} label={outcomeHomeLabel} />
              <b>VS</b>
              <OutcomeFlag team={outcomeAwayTeam} label={outcomeAwayLabel} />
            </div>
            <div className="brakup-outcome__blast" aria-hidden="true">
              <i />
              {Array.from({ length: 14 }, (_, index) => <span key={index} style={{ ['--ray-rot' as string]: `${index * (360 / 14)}deg` }} />)}
            </div>
            <img className="brakup-outcome__logo" src="/brakup-logo.png" alt="Brakup" />
            <div className="brakup-outcome__boom">{outcomeBoomLabel}</div>
            <h2>{outcomeHeadline}</h2>
            <p>{outcomeNotice.match.label} · réel {formatScore(outcomeNotice.progress.realScore)} · ton pari {formatScore(outcomeNotice.progress.playedScore)}</p>
            <div className="brakup-outcome__points">
              <strong>+{outcomeBreakdownTotal}</strong>
              <span>points gagnés</span>
            </div>
            <div className="brakup-outcome__scores">
              {visibleOutcomeScoreRows.map((row) => (
                <span key={`${row.label}-${row.points}`}>
                  {row.label} {row.detail ? <em>{row.detail}</em> : null}
                  <strong>{row.points}</strong>
                </span>
              ))}
            </div>
            {hiddenOutcomeScoreRows > 0 ? (
              <button type="button" className="brakup-outcome__more" onClick={() => { sfx.tab(); setOutcomeBreakdownExpanded(true) }}>
                Voir +{hiddenOutcomeScoreRows}
              </button>
            ) : outcomeBreakdownExpanded && outcomeScoreRows.length > 2 ? (
              <button type="button" className="brakup-outcome__more" onClick={() => { sfx.tab(); setOutcomeBreakdownExpanded(false) }}>
                Voir moins
              </button>
            ) : null}
            <div className="brakup-outcome__share-copy">
              {isOutcomeCapturingShare ? 'Tente ta chance avec ton prono.' : 'Envoie ton prono et invite tes potes à tenter le leur.'}
            </div>
            <button type="button" className="brakup-share-button" onClick={() => { sfx.click(); outcomeSharePreviewUrl ? setOutcomeSharePreviewOpen(true) : void handleOutcomeShare() }} disabled={outcomeShareStatus === 'working'}>
              {outcomeShareStatus === 'working' ? 'Préparation...' : outcomeShareStatus === 'ready' ? 'Voir le visuel' : "Partager l'image"}
            </button>
            {outcomeShareStatus === 'ready' ? <small className="brakup-share-feedback">Image prête. Ouvre le visuel pour partager.</small> : null}
            {outcomeShareStatus === 'done' ? <small className="brakup-share-feedback">Partage lancé.</small> : null}
            {outcomeShareStatus === 'error' ? <small className="brakup-share-feedback is-error">Partage indisponible. Retente.</small> : null}
            {!forcedOutcomeNotice && pendingOutcomeNotices.length > 1 ? (
              <div className="brakup-outcome__slider" aria-label="Resultats non vus">
                <button type="button" onClick={() => { sfx.tab(); showOutcomeAt((outcomeNoticeIndex - 1 + pendingOutcomeNotices.length) % pendingOutcomeNotices.length) }}>‹</button>
                <span>{outcomeNoticeIndex + 1} / {pendingOutcomeNotices.length}</span>
                <button type="button" onClick={() => { sfx.tab(); showOutcomeAt((outcomeNoticeIndex + 1) % pendingOutcomeNotices.length) }}>›</button>
              </div>
            ) : null}
            <button type="button" className="brakup-button" onClick={() => { sfx.click(); closeOutcomeNotice() }}>Continuer</button>
          </div>
          {(outcomeShareStatus === 'working' || (outcomeSharePreviewUrl && outcomeSharePreviewOpen)) ? (
            <div className="brakup-share-preview" role="dialog" aria-modal="true">
              <div className="brakup-share-preview__panel">
                <div className={`brakup-share-preview__frame${outcomeSharePreviewUrl ? '' : ' is-loading'}`}>
                  {outcomeSharePreviewUrl ? (
                    <img src={outcomeSharePreviewUrl} alt="Apercu du partage Brakup" />
                  ) : (
                    <div className="brakup-share-loader">
                      <div className="boot-loader__mark boot-loader__mark--sm" aria-hidden="true">
                        <span className="boot-loader__orbit boot-loader__orbit--outer" />
                        <span className="boot-loader__orbit boot-loader__orbit--inner" />
                        <img className="boot-loader__logo" src="/brakup-loader.svg" alt="" />
                      </div>
                      <strong>Brakup loading</strong>
                      <span>Construction du visuel</span>
                      <span>On prepare tout</span>
                      <span>Derniere passe</span>
                    </div>
                  )}
                </div>
                <div className="brakup-share-preview__actions">
                  <button type="button" className="brakup-share-preview__ghost" onClick={() => { sfx.click(); closeOutcomeSharePreview() }}>Retour</button>
                  <button type="button" className="brakup-share-preview__primary" onClick={() => { sfx.click(); void handleOutcomeShare() }} disabled={!outcomeShareUrl || outcomeShareStatus === 'working'}>
                    {outcomeShareStatus === 'working' ? 'Preparation...' : 'Partager'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showEmailEntry ? <EmailEntry busy={saving} error={saveError} initialEmail={pendingEmail || savedProfile.email} initialPseudo={brackets.find((entry) => entry.id === activeBracketId)?.pseudo ?? savedProfile.pseudo} onDraftChange={rememberProfile} onSubmit={save} onCancel={() => { setShowEmailEntry(false); setLoginToken(null); setPendingEmail(null); }} /> : null}
      {showLoginEntry ? <LoginEntry initialEmail={savedProfile.email} initialPseudo={loginPseudo} flow={loginFlow} busy={loginBusy} error={loginError} sent={loginSent} onSubmit={handleLogin} onVerify={handleLoginOTP} onPseudoChange={setLoginPseudo} onResend={handleLoginResend} onCancel={() => { setShowLoginEntry(false); setPendingPostAuthAction(null) }} /> : null}
      {showOTPEntry && pendingEmail && pendingPseudo ? <OTPEntry email={pendingEmail} pseudo={pendingPseudo} busy={otpBusy} error={otpError} onSubmit={handleOTPSubmit} onResend={handleOTPResend} onCancel={() => { setShowOTPEntry(false); setPendingEmail(null); setPendingPseudo(null); setShowEmailEntry(true) }} /> : null}
      {showProfileSettings ? <ProfileSettings initialEmail={savedProfile.email} initialPseudo={savedProfile.pseudo} busy={profileBusy} error={profileError} status={profileStatus} difficultySetting={difficultySetting} onDifficultyChange={updateDifficultySetting} onSubmit={handleProfileUpdate} onClose={() => setShowProfileSettings(false)} /> : null}
      <footer className="brakup-footer"><span>BRAKUP 2026</span><small>Données tournoi : {seed.meta.name} · {liveSource?.syncedAt ? `sync ${new Date(liveSource.syncedAt).toLocaleString('fr-FR')}` : 'projection locale'}</small></footer>
    </div>
  )
}

export default BrakupHub
