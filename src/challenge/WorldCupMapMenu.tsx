import { useEffect, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { sfx } from '../lib/sfx'
import { formatKnockoutDateTime, knockoutKickoffById } from '../lib/knockoutSchedule'
import type { BattleScorer, KnockoutMatch, Team } from '../types'
import { evaluateMatchProgress, scoreForPick, type BattleScore, type DisplayScore, type MatchProgress, type OfficialScore, type RealScorer } from './progress'

export interface WorldCupMapMenuProps {
  matches: KnockoutMatch[]
  teamsById: Map<string, Team>
  picks: Record<string, string>
  scores?: Record<string, { p: number; o: number }>
  scorers?: Record<string, BattleScorer[]>
  realScorers?: RealScorer[]
  realResults?: Record<string, string>
  officialScores?: Record<string, OfficialScore>
  onPick: (matchId: string, teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
  onSimulate?: (matchId: string) => void
  onShowBracket?: () => void
  autosavedAt?: string | null
  ownerPseudo?: string
  readOnly?: boolean
  introReady?: boolean
}

type NodeStatus = 'locked' | 'available' | 'picked' | 'completed' | 'live' | 'closed'

type DisplayNode = {
  id: string
  matchNumber: number
  roundLabel: string
  roundShort: string
  isFinalBoss: boolean
  isThirdPlace: boolean
  x: number
  y: number
  match: KnockoutMatch
  status: NodeStatus
  homeTeam?: Team
  awayTeam?: Team
  pickedTeamId?: string
  realWinnerTeamId?: string
  predictionState?: 'correct' | 'wrong'
  progress: MatchProgress
  isNextPlayable: boolean
}

const MAP_HEIGHT = 2600
const ROUTE_Y_START = 2450
const ROUTE_Y_END = 180

const ROUTE_X = [
  22, 72, 34, 80,
  20, 66, 38, 80,
  28, 74, 20, 62,
  36, 80, 26, 70,

  20, 58, 80, 42,
  72, 24, 64, 34,

  78, 30, 68, 22,

  40, 74,
  56,
  50,
]

const MATCH_SEQUENCE = [
  'M73', 'M76', 'M74', 'M75',
  'M78', 'M77', 'M79', 'M80',
  'M81', 'M82', 'M84', 'M83',
  'M85', 'M88', 'M86', 'M87',
  'M90', 'M89', 'M91', 'M92',
  'M93', 'M94', 'M95', 'M96',
  'M97', 'M98', 'M99', 'M100',
  'M101', 'M102', 'M103', 'M104',
]

const NODE_POS: Record<string, { x: number; y: number }> = Object.fromEntries(
  MATCH_SEQUENCE.map((id, index) => {
    const t = index / (MATCH_SEQUENCE.length - 1)
    const y = Math.round(ROUTE_Y_START - t * (ROUTE_Y_START - ROUTE_Y_END))
    return [id, { x: ROUTE_X[index] ?? 50, y }]
  }),
) as Record<string, { x: number; y: number }>

const ZONE_BANNERS = [
  { label: '16ES DE FINALE', y: 2380 },
  { label: '8ES DE FINALE', y: 1740 },
  { label: 'QUARTS DE FINALE', y: 1170 },
  { label: 'DEMI-FINALES', y: 700 },
  { label: 'FINALE', y: 390 },
]

const INTRO_REVEAL_MARGIN = 90

const ROUND_LONG: Record<string, string> = {
  'Round of 32': '16e de finale',
  'Round of 16': '8e de finale',
  'Quarter-final': 'Quart de finale',
  'Semi-final': 'Demi-finale',
  Finale: 'Finale',
}

const ROUND_SHORT: Record<string, string> = {
  'Round of 32': '16e',
  'Round of 16': '8e',
  'Quarter-final': 'QF',
  'Semi-final': 'SF',
  Finale: 'FINALE',
}

function getRoundLabel(match: KnockoutMatch) {
  if (match.id === 'M103') return '3e place'
  return ROUND_LONG[match.stage] ?? match.stage
}

function getRoundShort(match: KnockoutMatch) {
  if (match.id === 'M103') return '3E'
  if (match.id === 'M104') return 'FINALE'
  return ROUND_SHORT[match.stage] ?? match.stage
}

function getStatusHint(status: NodeStatus) {
  switch (status) {
    case 'closed':
      return 'Resultat officiel connu. Rejoue le scenario pour le fun et pour marquer les points du prono.'
    case 'completed':
      return 'Match joue. Touche une equipe pour rejouer avec ce camp.'
    case 'picked':
      return 'Choix vainqueur enregistre. Confirme ton prono en gagnant ce match.'
    case 'live':
      return 'Choisis une equipe pour lancer le match.'
    case 'available':
      return 'Choisis une equipe pour lancer le match.'
    default:
      return 'Termine les matchs précédents pour débloquer.'
  }
}

function entrantTeam(match: KnockoutMatch, side: 'home' | 'away', teamsById: Map<string, Team>) {
  const entrant = match[side]
  return entrant.kind === 'team' ? teamsById.get(entrant.teamId) : undefined
}

function pickBelongsToResolvedMatch(pickedTeamId: string | undefined, homeTeam?: Team, awayTeam?: Team) {
  return Boolean(pickedTeamId && (pickedTeamId === homeTeam?.id || pickedTeamId === awayTeam?.id))
}
function displayTeamName(team?: Team, fallback?: string) {
  if (team) return team.shortName || team.name
  return fallback ?? 'À déterminer'
}

function formatMatchDetailDateTime(matchId: string, fallbackDateLabel: string) {
  const schedule = knockoutKickoffById[matchId]
  if (!schedule) return `${fallbackDateLabel} · heure a confirmer`
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(schedule.kickoffIso)).replace(',', ' ·')
}

function teamFlagEmoji(team?: Team) {
  return team?.flagEmoji || '🌍'
}

function teamFlagImageUrl(team?: Team) {
  if (!team?.iso2) return null
  return `https://flagcdn.com/w80/${team.iso2.toLowerCase()}.png`
}

function TeamFlag({ team, className }: { team?: Team; className?: string }) {
  const src = teamFlagImageUrl(team)
  if (src) return <img src={src} alt={team?.name ?? ''} className={className} crossOrigin="anonymous" />
  return <span className={className}>{teamFlagEmoji(team)}</span>
}

function BrakupScorersToggle({ scorers }: { scorers: BattleScorer[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`wcmap-entry__scorers${open ? ' is-open' : ''}`}>
      <button type="button" className="wcmap-entry__scorers-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <strong>{open ? 'Masquer buteurs' : 'Voir buteurs'}</strong>
        <span>{scorers.length}</span>
      </button>
      {open ? <span className="wcmap-entry__scorers-list">{scorers.map((scorer) => `#${scorer.number ?? 9} ${scorer.name}`).join(' · ')}</span> : null}
    </div>
  )
}

function MapStageIcon({ kind }: { kind: 'missing' | 'failed' }) {
  if (kind === 'missing') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5h7l4 4V20.5H7z" />
        <path d="M14 3.5v4h4" />
        <path d="M9.4 13h5.2M9.4 16h3.6" />
        <circle cx="17.2" cy="17.2" r="3.1" />
        <path d="M17.2 15.9v1.8M17.2 19h.01" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M5.4 18.6 18.6 5.4" />
    </svg>
  )
}

function scoreForNode(node: DisplayNode, score?: BattleScore): DisplayScore | null {
  return scoreForPick(node.match, node.pickedTeamId, score)
}


function buildDisplayNodes(
  matches: KnockoutMatch[],
  teamsById: Map<string, Team>,
  picks: Record<string, string>,
  scores: Record<string, BattleScore>,
  realResults: Record<string, string>,
  officialScores: Record<string, OfficialScore>,
  scorers: Record<string, BattleScorer[]>,
  realScorers: RealScorer[],
): DisplayNode[] {
  const resolved = matches.map((match) => {
    const homeTeam = entrantTeam(match, 'home', teamsById)
    const awayTeam = entrantTeam(match, 'away', teamsById)
    const pickedTeamId = pickBelongsToResolvedMatch(picks[match.id], homeTeam, awayTeam) ? picks[match.id] : undefined
    return { match, homeTeam, awayTeam, pickedTeamId }
  })
  const byId = new Map(resolved.map((entry) => [entry.match.id, entry]))
  const orderedResolved = MATCH_SEQUENCE
    .map((id) => byId.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  const firstPlayable = orderedResolved.find((entry) =>
    !scores[entry.match.id] &&
    !realResults[entry.match.id] &&
    entry.homeTeam &&
    entry.awayTeam,
  )?.match.id

  return orderedResolved.map(({ match, homeTeam, awayTeam, pickedTeamId }) => {
    const pos = NODE_POS[match.id]
    const realWinnerTeamId = realResults[match.id]
    const progress = evaluateMatchProgress(match, picks, scores, realResults, officialScores, scorers, realScorers)
    const isNextPlayable = match.id === firstPlayable
    const hasOfficialResult = realWinnerTeamId
    const hasPlayedScore = Boolean(scores[match.id])
    const status: NodeStatus = hasOfficialResult
      ? 'closed'
      : hasPlayedScore
        ? 'completed'
        : homeTeam && awayTeam && isNextPlayable
          ? pickedTeamId ? 'picked' : 'live'
          : 'locked'
    return {
      id: match.id,
      matchNumber: Number(match.id.replace('M', '')),
      roundLabel: getRoundLabel(match),
      roundShort: getRoundShort(match),
      isFinalBoss: match.id === 'M104',
      isThirdPlace: match.id === 'M103',
      x: pos?.x ?? 50,
      y: pos?.y ?? 0,
      match,
      status,
      homeTeam,
      awayTeam,
      pickedTeamId,
      realWinnerTeamId,
      predictionState: pickedTeamId && realWinnerTeamId ? pickedTeamId === realWinnerTeamId ? 'correct' : 'wrong' : undefined,
      progress,
      isNextPlayable,
    }
  })
}

function MapPathSvg({ nodes, revealY }: { nodes: DisplayNode[]; revealY?: number | null }) {
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  return (
    <svg
      className="wcmap__paths"
      viewBox={`0 0 1000 ${MAP_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {MATCH_SEQUENCE.slice(1).map((id, index) => {
        const from = byId.get(MATCH_SEQUENCE[index])
        const to = byId.get(id)
        if (!from || !to) return null

        const fx = from.x * 10
        const fy = from.y
        const tx = to.x * 10
        const ty = to.y
        const dx = tx - fx
        const direction = dx >= 0 ? 1 : -1
        const bend = Math.max(10, Math.min(22, Math.abs(dx) * 0.36 + 8))
        const cp1x = fx + dx * 0.24 + direction * bend
        const cp1y = fy - 62
        const cp2x = tx - dx * 0.24 - direction * bend * 0.7
        const cp2y = ty + 62
        const pathDef = `M ${fx} ${fy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`
        const isActive = to.status !== 'locked'
        const segmentDistance = Math.max(1, fy - ty)
        const revealProgress = revealY == null
          ? 1
          : Math.max(0, Math.min(1, (fy - revealY + INTRO_REVEAL_MARGIN * 0.35) / segmentDistance))

        return (
          <path
            key={`${MATCH_SEQUENCE[index]}-${id}`}
            className={`wcmap__path${isActive ? ' is-active' : ''}${revealY != null ? ' is-intro-reveal' : ''}`}
            d={pathDef}
            pathLength={1}
            style={revealY != null ? { strokeDasharray: 1, strokeDashoffset: 1 - revealProgress, opacity: revealProgress > 0 ? 1 : 0 } : undefined}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

function MatchNode({
  node,
  selecting,
  score,
  readOnly,
  recommended,
  invite,
  introState,
  onClick,
}: {
  node: DisplayNode
  selecting: boolean
  score?: BattleScore
  readOnly?: boolean
  recommended?: boolean
  invite?: boolean
  introState?: 'hidden' | 'revealed'
  onClick: () => void
}) {
  const isLocked = node.status === 'locked'
  const isCompleted = node.status === 'completed'
  const isClosed = node.status === 'closed'
  const isLive = node.status === 'live'
  const isAvailable = node.status === 'available'
  const isPicked = node.status === 'picked'
  const displayScore = scoreForNode(node, score)
  const officialScore = node.progress.realScore
  const hasBrakupScore = Boolean(score)
  const panelScore = isClosed && officialScore ? officialScore : displayScore
  const showFieldPanel = isLocked || Boolean(panelScore)
  const isPickOnlyMatchup = isPicked && !panelScore && !isClosed
  const resultTeams = node.homeTeam && node.awayTeam && ((isCompleted && node.pickedTeamId) || (isClosed && node.realWinnerTeamId) || (isPicked && node.pickedTeamId))
    ? [node.homeTeam, node.awayTeam] as const
    : null
  const hasPick = Boolean(node.pickedTeamId)
  const hasOfficialResult = Boolean(node.realWinnerTeamId)
  const hasPlayedMarker = hasBrakupScore || node.progress.played || hasOfficialResult
  const officialPending = hasBrakupScore && !hasOfficialResult
  const officialOnly = hasOfficialResult && !hasPick
  const stageBadge = node.progress.played
    ? {
        className: [node.progress.correct ? 'is-correct' : 'is-wrong', hasBrakupScore ? 'is-filled' : 'is-empty'].join(' '),
        label: node.progress.correct ? '\u2605 +' + node.progress.points : <MapStageIcon kind="failed" />,
        title: node.progress.correct ? 'Prono réussi +' + node.progress.points : 'Prono raté',
      }
    : officialOnly
      ? {
          className: 'is-incomplete is-empty',
          label: <MapStageIcon kind="missing" />,
          title: 'Resultat officiel connu, aucun prono joue',
        }
      : officialPending
        ? {
            className: 'is-pending is-filled',
            label: '…',
            title: 'Match joué, score officiel en attente',
          }
        : hasPick
          ? {
              className: 'is-pick is-empty',
              label: '',
              title: 'Vainqueur choisi, match à jouer',
            }
          : null
  const borderState = node.progress.played
    ? hasBrakupScore
      ? node.progress.correct ? 'correct' : 'wrong'
      : node.progress.correct ? 'correct-open' : 'wrong-open'
    : officialOnly
      ? 'official-only'
      : officialPending
        ? 'brakup-played'
        : hasPick
          ? 'winner-picked'
          : isLive || isAvailable
            ? 'playable'
            : 'locked'

  return (
    <button
      type="button"
      data-node-id={node.id}
      className={[
        'wcmap__field-node',
        `is-${node.status}`,
        `is-border-${borderState}`,
        recommended ? 'is-recommended' : '',
        invite ? 'is-invite' : '',
        readOnly ? 'is-readonly' : '',
        introState === 'hidden' ? 'is-intro-hidden' : '',
        introState === 'revealed' ? 'is-intro-revealed' : '',
        node.isFinalBoss ? 'is-final' : '',
        node.isThirdPlace ? 'is-third' : '',
        selecting ? 'is-selecting' : '',
      ].filter(Boolean).join(' ')}
      style={{ left: `${node.x}%`, top: `${node.y}px` }}
      onClick={readOnly ? undefined : onClick}
      aria-disabled={readOnly ? 'true' : undefined}
    >
      {showFieldPanel ? (
        <div className="wcmap__field-panel">
          {isLocked ? (
            <span className="wcmap__locked-label">VERROUILLÉ</span>
          ) : panelScore ? (
            <span className={`wcmap__score-badge${isClosed ? ' is-official' : ''}`} aria-label={`Score ${panelScore.home} à ${panelScore.away}`}>
              <TeamFlag team={node.homeTeam} className="wcmap__score-flag" />
              <strong>{panelScore.home}</strong>
              <em>-</em>
              <strong>{panelScore.away}</strong>
              <TeamFlag team={node.awayTeam} className="wcmap__score-flag" />
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="wcmap__mini-field">
        <div className="wcmap__pitch-line wcmap__pitch-line--mid" />
        <div className="wcmap__pitch-circle" />
        <div className="wcmap__goal wcmap__goal--top" />
        <div className="wcmap__goal wcmap__goal--bottom" />
        {hasPlayedMarker ? <span className="wcmap__played-cross" aria-hidden="true" /> : null}

        {resultTeams ? (
          <span className={`wcmap__result-matchup${isPickOnlyMatchup ? ' is-pick-only' : ''}`} aria-label={`${resultTeams[0].name} a gauche, ${resultTeams[1].name} a droite`}>
            {resultTeams.map((team) => {
              const isWinner = isClosed ? node.realWinnerTeamId === team.id : node.pickedTeamId === team.id
              return (
                <span key={team.id} className={`wcmap__result-flag wcmap__result-flag--${isWinner ? 'winner' : 'loser'}`}>
                  <TeamFlag team={team} />
                </span>
              )
            })}
          </span>
        ) : null}

        {(isLive || isAvailable) && node.homeTeam && node.awayTeam ? (
          <span className={`wcmap__live-matchup${isAvailable ? ' is-available' : ''}`} aria-hidden="true">
            <TeamFlag team={node.homeTeam} />
            <strong>VS</strong>
            <TeamFlag team={node.awayTeam} />
          </span>
        ) : null}
      </div>

      <span className="wcmap__round-chip">{node.roundShort}</span>

      <span className="wcmap__badge-rail" aria-hidden="true">
        {isLocked ? <span className="wcmap__status-badge wcmap__status-badge--lock">{'\uD83D\uDD12'}</span> : null}
        {stageBadge ? (
          <span className={`wcmap__stage-badge ${stageBadge.className}`} title={stageBadge.title}>
            {stageBadge.label}
          </span>
        ) : null}
      </span>
    </button>
  )
}

function LevelEntryScreen({
  node,
  selectedTeamId,
  score,
  scorers = [],
  open,
  canShare,
  canShowBracket: _canShowBracket,
  onClose,
  onPickTeam,
  onPlay,
  onSimulate,
  onShowBracket: _onShowBracket,
  onShare,
}: {
  node: DisplayNode | null
  selectedTeamId: string | null
  score?: BattleScore
  scorers?: BattleScorer[]
  open: boolean
  canShare: boolean
  canShowBracket: boolean
  onClose: () => void
  onPickTeam: (teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
  onSimulate?: () => void
  onShowBracket?: () => void
  onShare?: () => void
}) {
  if (!open || !node) return null

  const canSimulate = Boolean(node.homeTeam && node.awayTeam && onSimulate)
  const displayScore = scoreForNode(node, score)
  const isClosed = node.status === 'closed'
  const officialScoreSummary = isClosed ? node.progress.realScore : null
  const brakupScoreSummary = displayScore ?? (score ? { home: score.p, away: score.o } : null)
  const hasScoreSummary = Boolean(officialScoreSummary || brakupScoreSummary)
  const officialWinnerTeam = node.realWinnerTeamId
    ? node.realWinnerTeamId === node.homeTeam?.id ? node.homeTeam : node.awayTeam
    : undefined
  const predictedWinnerTeam = node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.pickedTeamId === node.awayTeam?.id ? node.awayTeam : undefined
  const resultWinnerTeam = isClosed ? officialWinnerTeam : predictedWinnerTeam
  const officialPending = node.status === 'completed' && Boolean(node.pickedTeamId) && !node.progress.played
  const canReplayPlayedMatch = node.status === 'completed' && !isClosed
  const canReplayOfficialMatch = isClosed && Boolean(node.homeTeam && node.awayTeam)
  const canSharePlayedMatch = canShare && Boolean(node.pickedTeamId && displayScore) && node.status === 'completed'
  const hasPreselectedWinner = Boolean(node.pickedTeamId && !brakupScoreSummary)
  const selectedWinnerTeam = node.pickedTeamId === node.homeTeam?.id ? node.homeTeam : node.pickedTeamId === node.awayTeam?.id ? node.awayTeam : undefined
  const canPlaySelectedWinner = node.status === 'picked' && hasPreselectedWinner && Boolean(selectedWinnerTeam)
  const schedule = knockoutKickoffById[node.match.id]
  const actionTitle = isClosed
    ? 'Rejouer ce match'
    : canReplayPlayedMatch
      ? 'Rejouer ce match'
      : hasPreselectedWinner
        ? 'Confirme ton prono'
        : 'Choisis une equipe'
  const actionHint = isClosed
    ? 'Rejoue avec un camp.'
    : canReplayPlayedMatch
      ? 'Touche une equipe.'
      : hasPreselectedWinner
        ? 'Ton vainqueur est deja choisi.'
        : 'Touche une equipe.'
  const showStatusHint = node.status === 'locked'

  return (
    <div className="wcmap-entry" role="dialog" aria-modal="true">
      <button type="button" className="wcmap-entry__scrim" onClick={onClose} aria-label="Fermer" />
      <aside className={`wcmap-entry__panel${node.isFinalBoss ? ' is-final' : ''}`}>
        <div className="wcmap-entry__grab" />

        <div className="wcmap-entry__header">
          <div className="wcmap-entry__badge">{node.roundLabel.toUpperCase()}</div>
          <div className="wcmap-entry__match-num">{formatMatchDetailDateTime(node.match.id, node.match.dateLabel)}</div>
          <button type="button" className="wcmap-entry__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="wcmap-entry__schedule" aria-label="Informations du match">
          <span>{formatKnockoutDateTime(node.match.id, node.match.dateLabel)}</span>
          {schedule?.venue ? <strong>{schedule.venue}</strong> : <strong>Stade a confirmer</strong>}
        </div>

        {showStatusHint ? <p className="wcmap-entry__hint">{getStatusHint(node.status)}</p> : null}

        {(((node.status === 'completed' || node.status === 'picked') && node.pickedTeamId) || (isClosed && resultWinnerTeam)) ? (
          <div className="wcmap-entry__result">
            <div className="wcmap-entry__result-main">
              <div className="wcmap-entry__result-winner">
                <span className="wcmap-entry__result-flag">
                  <TeamFlag team={resultWinnerTeam} />
                </span>
                <div>
                  <small className="wcmap-entry__result-label">{isClosed ? 'VAINQUEUR OFFICIEL' : hasPreselectedWinner ? 'CHOIX VAINQUEUR' : 'VAINQUEUR'}</small>
                  <strong className="wcmap-entry__result-name">
                    {resultWinnerTeam?.name ?? node.pickedTeamId}
                  </strong>
                </div>
              </div>
              {hasScoreSummary ? (
                <div className="wcmap-entry__score-grid">
                  {officialScoreSummary ? (
                    <div className="wcmap-entry__score-card is-official">
                      <span>Officiel</span>
                      <strong>{officialScoreSummary.home} - {officialScoreSummary.away}</strong>
                    </div>
                  ) : null}
                  {brakupScoreSummary ? (
                    <div className="wcmap-entry__score-card is-brakup">
                      <span>Brakup</span>
                      <strong>{brakupScoreSummary.home} - {brakupScoreSummary.away}</strong>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="wcmap-entry__result-vs">
                  <span><TeamFlag team={node.homeTeam} /> {displayTeamName(node.homeTeam)}</span>
                  <em>vs</em>
                  <span><TeamFlag team={node.awayTeam} /> {displayTeamName(node.awayTeam)}</span>
                </div>
              )}
            </div>
            {(node.progress.played || officialPending || scorers.length || canSharePlayedMatch) ? (
              <div className="wcmap-entry__result-meta">
                {node.progress.played ? (
                  <div className={`wcmap-entry__verdict${node.progress.correct ? ' is-correct' : ' is-wrong'}`}>
                    <strong>{node.progress.correct ? 'Prono reussi' : 'Prono rate'}</strong>
                    {node.progress.exact ? <em>Score exact +{node.progress.exactPoints}</em> : null}
                    {node.progress.scorerHits.length ? <em>Buteur +{node.progress.scorerPoints}</em> : null}
                  </div>
                ) : officialPending ? (
                  <div className="wcmap-entry__verdict is-pending">
                    <strong>Officiel en attente</strong>
                    <span>Jeu sauvegarde</span>
                  </div>
                ) : null}
                {scorers.length ? <BrakupScorersToggle scorers={scorers} /> : null}
                {canSharePlayedMatch ? (
                  <button type="button" className="wcmap-entry__share" onClick={onShare} aria-label="Partager">
                    <span aria-hidden="true">↗</span>
                    <b>Partager</b>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {(node.status !== 'completed' && !isClosed) || canReplayPlayedMatch || canReplayOfficialMatch ? (
          <div className="wcmap-entry__choose">
            <span>{actionTitle}</span>
            <small>{actionHint}</small>
          </div>
        ) : null}

        {canPlaySelectedWinner ? (
          <button
            type="button"
            className="wcmap-entry__play is-invite"
            onClick={() => selectedWinnerTeam && onPlay(node.id, selectedWinnerTeam.id)}
          >
            Jouer avec {selectedWinnerTeam?.shortName || selectedWinnerTeam?.name}
          </button>
        ) : null}

        <div className="wcmap-entry__teams">
          <button
            type="button"
            className={`wcmap-entry__team${selectedTeamId === node.homeTeam?.id ? ' is-selected' : ''}${isClosed && node.realWinnerTeamId === node.homeTeam?.id ? ' is-official-winner' : ''}${isClosed && node.realWinnerTeamId && node.realWinnerTeamId !== node.homeTeam?.id ? ' is-official-loser' : ''}`}
            onClick={() => node.homeTeam && onPickTeam(node.homeTeam.id)}
            disabled={!node.homeTeam || !node.awayTeam}
          >
            <span className="wcmap-entry__team-flag">
              <TeamFlag team={node.homeTeam} />
            </span>
            <strong>{displayTeamName(node.homeTeam, node.match.home.kind === 'placeholder' ? node.match.home.label : undefined)}</strong>
            <small>{node.homeTeam?.name ?? 'En attente'}</small>
          </button>
          <div className="wcmap-entry__vs">VS</div>
          <button
            type="button"
            className={`wcmap-entry__team${selectedTeamId === node.awayTeam?.id ? ' is-selected' : ''}${isClosed && node.realWinnerTeamId === node.awayTeam?.id ? ' is-official-winner' : ''}${isClosed && node.realWinnerTeamId && node.realWinnerTeamId !== node.awayTeam?.id ? ' is-official-loser' : ''}`}
            onClick={() => node.awayTeam && onPickTeam(node.awayTeam.id)}
            disabled={!node.homeTeam || !node.awayTeam}
          >
            <span className="wcmap-entry__team-flag">
              <TeamFlag team={node.awayTeam} />
            </span>
            <strong>{displayTeamName(node.awayTeam, node.match.away.kind === 'placeholder' ? node.match.away.label : undefined)}</strong>
            <small>{node.awayTeam?.name ?? 'En attente'}</small>
          </button>
        </div>
        {canSimulate && !isClosed ? (
          <button
            type="button"
            className="wcmap-entry__simulate"
            onClick={onSimulate}
          >
            Simuler sans jouer
          </button>
        ) : null}
      </aside>
    </div>
  )
}

export function WorldCupMapMenu({
  matches,
  teamsById,
  picks,
  scores = {},
  scorers = {},
  realScorers = [],
  realResults = {},
  officialScores = {},
  onPick: _onPick,
  onPlay,
  onSimulate,
  onShowBracket,
  ownerPseudo = '',
  readOnly = false,
  introReady = true,
}: WorldCupMapMenuProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panFocusRef = useRef<string | null>(null)
  const introPanDoneRef = useRef(false)
  const introPanTimerRef = useRef<number | null>(null)
  const introAnimatingRef = useRef(false)
  const introRevealRef = useRef<number | null>(null)
  const introRevealedSoundRef = useRef<Set<string>>(new Set())
  const lastStadiumRevealSfxRef = useRef(0)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number; lastY: number; lastT: number; vy: number } | null>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const momentumRef = useRef<number | null>(null)
  const panAnimRef = useRef<number | null>(null)
  const dragDistRef = useRef(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [introEntering, setIntroEntering] = useState(false)
  const [introHasStarted, setIntroHasStarted] = useState(false)
  const [introRevealY, setIntroRevealY] = useState<number | null>(null)

  const nodes = useMemo(() => buildDisplayNodes(matches, teamsById, picks, scores, realResults, officialScores, scorers, realScorers), [matches, teamsById, picks, scores, realResults, officialScores, scorers, realScorers])
  // Invite à jouer : les matchs jouables sans prono clignotent ; si tous les
  // matchs disponibles sont pronostiqués, ce sont les pronos non joués qui clignotent.
  const playableWithoutPick = useMemo(() => new Set(
    nodes.filter((node) => (node.status === 'live' || node.status === 'available') && !node.pickedTeamId).map((node) => node.id),
  ), [nodes])
  const inviteIds = useMemo(() => {
    if (playableWithoutPick.size > 0) return playableWithoutPick
    return new Set(nodes.filter((node) => node.isNextPlayable && node.pickedTeamId && !scores[node.id]).map((node) => node.id))
  }, [nodes, playableWithoutPick, scores])
  const recommendedNode = nodes.find((node) => node.status === 'live')
    ?? nodes.find((node) => node.isNextPlayable)
    ?? nodes.find((node) => node.status === 'picked')
    ?? nodes.find((node) => node.status === 'available')
    ?? nodes.find((node) => node.status === 'closed' && !node.progress.played && node.homeTeam && node.awayTeam)
    ?? null
  const focusNode = recommendedNode
  const selectedNode = nodes.find((node) => node.id === selectedMatchId) ?? null

  const setPanOffset = (next: { x: number; y: number }) => {
    offsetRef.current = next
    setOffset(next)
  }

  const clampPanY = (y: number) => {
    const viewportHeight = viewportRef.current?.clientHeight ?? 0
    const maxPan = Math.max(0, MAP_HEIGHT - viewportHeight)
    return Math.max(-maxPan, Math.min(0, y))
  }

  const stopPanMotion = () => {
    const wasIntroAnimating = introAnimatingRef.current || introRevealRef.current !== null
    if (introPanTimerRef.current !== null) {
      window.clearTimeout(introPanTimerRef.current)
      introPanTimerRef.current = null
    }
    if (momentumRef.current !== null) {
      cancelAnimationFrame(momentumRef.current)
      momentumRef.current = null
    }
    if (panAnimRef.current !== null) {
      cancelAnimationFrame(panAnimRef.current)
      panAnimRef.current = null
    }
    if (introRevealRef.current !== null) {
      cancelAnimationFrame(introRevealRef.current)
      introRevealRef.current = null
    }
    introAnimatingRef.current = false
    if (wasIntroAnimating) {
      setIntroEntering(false)
      setIntroRevealY(null)
      setIntroHasStarted(true)
    }
  }


  const startMomentum = (velocityY: number) => {
    if (Math.abs(velocityY) < 0.04) return
    let previous = performance.now()
    let velocity = velocityY

    const tick = (now: number) => {
      const elapsed = Math.min(32, now - previous)
      previous = now
      const currentY = offsetRef.current.y
      const nextY = clampPanY(currentY + velocity * elapsed)
      setPanOffset({ x: 0, y: nextY })

      if (nextY !== currentY + velocity * elapsed) {
        velocity *= 0.35
      }
      velocity *= Math.pow(0.94, elapsed / 16.67)

      if (Math.abs(velocity) > 0.02) {
        momentumRef.current = requestAnimationFrame(tick)
      } else {
        momentumRef.current = null
      }
    }

    momentumRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (!selectedNode) return
    setSelectedTeamId(selectedNode.status === 'completed' ? null : selectedNode.pickedTeamId ?? null)
  }, [selectedNode])

  const focusMapImmediately = (node: DisplayNode) => {
    if (!viewportRef.current) return false
    const viewportHeight = viewportRef.current.clientHeight
    if (!viewportHeight) return false
    const maxPan = Math.max(0, MAP_HEIGHT - viewportHeight)
    const targetOffset = -(node.y - viewportHeight * 0.52)
    panFocusRef.current = node.id
    setPanOffset({ x: 0, y: Math.max(-maxPan, Math.min(0, targetOffset)) })
    return true
  }

  const panForRouteY = (routeY: number) => {
    if (!viewportRef.current) return null
    const viewportHeight = viewportRef.current.clientHeight
    if (!viewportHeight) return null
    const maxPan = Math.max(0, MAP_HEIGHT - viewportHeight)
    const targetOffset = -(routeY - viewportHeight * 0.68)
    return Math.max(-maxPan, Math.min(0, targetOffset))
  }

  const animateIntroRevealToNode = (node: DisplayNode) => {
    if (!viewportRef.current) return false
    const startY = Math.min(MAP_HEIGHT, ROUTE_Y_START + 120)
    const revealEndY = Math.max(0, ROUTE_Y_END - 80)
    const cameraStopY = node.y
    const duration = 6200
    const startAt = performance.now()
    const ease = (t: number) => t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2

    stopPanMotion()
    introPanDoneRef.current = true
    introAnimatingRef.current = true
    panFocusRef.current = node.id
    introRevealedSoundRef.current.clear()
    lastStadiumRevealSfxRef.current = 0
    setIntroEntering(true)
    setIntroHasStarted(true)
    setIntroRevealY(startY)
    const bottomPan = panForRouteY(startY)
    if (bottomPan !== null) setPanOffset({ x: 0, y: bottomPan })

    const tick = (now: number) => {
      const raw = Math.min(1, (now - startAt) / duration)
      const progress = ease(raw)
      const currentY = startY + (revealEndY - startY) * progress
      const cameraY = Math.max(currentY, cameraStopY)
      const nextPan = panForRouteY(cameraY)
      setIntroRevealY(currentY)
      if (nextPan !== null) setPanOffset({ x: 0, y: nextPan })

      if (raw < 1) {
        introRevealRef.current = requestAnimationFrame(tick)
      } else {
        introRevealRef.current = null
        introAnimatingRef.current = false
        setIntroEntering(false)
        setIntroRevealY(null)
        focusMapImmediately(node)
      }
    }

    introRevealRef.current = requestAnimationFrame(tick)
    return true
  }

  useLayoutEffect(() => {
    if (!introReady || !focusNode || panFocusRef.current === focusNode.id) return
    if (!introPanDoneRef.current && viewportRef.current?.clientHeight) {
      animateIntroRevealToNode(focusNode)
      return
    }
    if (introPanDoneRef.current && focusMapImmediately(focusNode)) return

    const frameId = window.requestAnimationFrame(() => {
      if (panFocusRef.current !== focusNode.id) {
        if (!introPanDoneRef.current) {
          animateIntroRevealToNode(focusNode)
        } else {
          focusMapImmediately(focusNode)
        }
      }
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [focusNode, introReady])

  useEffect(() => {
    if (!introReady || !focusNode) return

    const viewport = viewportRef.current
    const observer = viewport && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        if (panFocusRef.current === focusNode.id && !introAnimatingRef.current) focusMapImmediately(focusNode)
      })
      : null
    if (viewport && observer) observer.observe(viewport)

    const timeoutId = window.setTimeout(() => {
      if (panFocusRef.current !== focusNode.id) focusMapImmediately(focusNode)
    }, 80)

    return () => {
      window.clearTimeout(timeoutId)
      observer?.disconnect()
    }
  }, [focusNode, introReady])

  useEffect(() => {
    if (introReady) return
    introPanDoneRef.current = false
    panFocusRef.current = null
    introAnimatingRef.current = false
    introRevealedSoundRef.current.clear()
    lastStadiumRevealSfxRef.current = 0
    setIntroEntering(false)
    setIntroHasStarted(false)
    setIntroRevealY(null)
    stopPanMotion()
  }, [introReady])

  useEffect(() => {
    if (introRevealY == null) return
    const visibleNodes = nodes.filter((node) => node.y >= introRevealY - INTRO_REVEAL_MARGIN)
    const newlyVisible = visibleNodes.filter((node) => !introRevealedSoundRef.current.has(node.id))
    if (!newlyVisible.length) return
    visibleNodes.forEach((node) => introRevealedSoundRef.current.add(node.id))
    const now = performance.now()
    if (now - lastStadiumRevealSfxRef.current > 130) {
      sfx.mapStadiumReveal()
      lastStadiumRevealSfxRef.current = now
    }
  }, [introRevealY, nodes])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const wasIntroRevealActive = introAnimatingRef.current || introRevealRef.current !== null || introRevealY !== null
    stopPanMotion()
    if (wasIntroRevealActive && focusNode) {
      focusMapImmediately(focusNode)
    }

    // Vérifie si le clic a ciblé un bouton MatchNode
    const target = event.target as HTMLElement;
    const nodeButton = target.closest('.wcmap__field-node');

    if (nodeButton) {
      // Clic sur un match → ne pas capturer, laisser le onClick du bouton agir
      dragRef.current = null;
      dragDistRef.current = 0;
      return;
    }

    // Clic ailleurs (viewport) → activer le drag
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      px: event.clientX,
      py: event.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
      lastY: event.clientY,
      lastT: performance.now(),
      vy: 0,
    };
    dragDistRef.current = 0;
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !viewportRef.current) return
    event.preventDefault()
    const deltaY = event.clientY - dragRef.current.py
    const deltaX = event.clientX - dragRef.current.px
    dragDistRef.current = Math.max(dragDistRef.current, Math.hypot(deltaX, deltaY))
    const now = performance.now()
    const dt = Math.max(1, now - dragRef.current.lastT)
    dragRef.current.vy = (event.clientY - dragRef.current.lastY) / dt
    dragRef.current.lastY = event.clientY
    dragRef.current.lastT = now
    const nextY = clampPanY(dragRef.current.oy + deltaY)
    setPanOffset({ x: 0, y: nextY })
  }

  const handlePointerUp = () => {
    const velocityY = dragRef.current?.vy ?? 0
    dragRef.current = null
    startMomentum(velocityY)
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    event.preventDefault()
    stopPanMotion()
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    setPanOffset({ x: 0, y: clampPanY(offsetRef.current.y - delta) })
  }

  const handleFocusPlayableMatch = () => {
    if (!focusNode) return
    sfx.tab()
    focusMapImmediately(focusNode)
  }

  useEffect(() => () => stopPanMotion(), [])

  useEffect(() => {
    if (!notice) return
    const timeoutId = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const handleSelectNode = (node: DisplayNode) => {
    if (readOnly) return
    if (dragDistRef.current > 8) {
      dragDistRef.current = 0
      return
    }
    dragDistRef.current = 0
    if (node.status === 'locked') {
      setNotice('Match verrouillé. Termine le match qui clignote pour débloquer la suite.')
      return
    }
    sfx.tab()
    setSelectingId(node.id)
    setSelectedMatchId(node.id)
    setSelectedTeamId(node.status === 'completed' || node.status === 'closed' ? null : node.pickedTeamId ?? null)
    window.setTimeout(() => setSelectingId(null), 220)
  }

  const handlePickTeam = (teamId: string) => {
    if (readOnly) return
    if (!selectedNode) return
    if (!selectedNode.homeTeam || !selectedNode.awayTeam) {
      setNotice('Ce match n est pas encore disponible.')
      return
    }
    sfx.pick()
    setSelectedTeamId(teamId)
    sfx.battle()
    onPlay(selectedNode.id, teamId)
  }

  const handleSimulate = () => {
    if (readOnly) return
    if (!selectedNode) return
    sfx.click()
    onSimulate?.(selectedNode.id)
  }

  const handleSharePlayedMatch = () => {
    if (!selectedNode?.pickedTeamId) return
    sfx.click()
    onPlay(selectedNode.id, selectedNode.pickedTeamId)
  }
  const displayedPseudo = ownerPseudo.trim()
  const introPending = !readOnly && (!introReady || (Boolean(focusNode) && !introHasStarted))

  return (
    <section className={`wcmap${readOnly ? ' is-readonly' : ''}${introEntering ? ' is-intro-entering' : ''}${introPending ? ' is-intro-pending' : ''}`}>
      <button type="button" className="wcmap__focus-button" onClick={handleFocusPlayableMatch} aria-label="Aller au match à jouer" disabled={!focusNode}>
        <svg className="wcmap__stadium-icon" viewBox="0 0 44 34" aria-hidden="true">
          {/* Floodlights */}
          <g className="wcmap__stadium-lights" stroke="#ffd84a" strokeWidth="2" strokeLinecap="round">
            <path d="M8 10 L5 3 M8 10 L11 3" fill="none" />
            <path d="M36 10 L33 3 M36 10 L39 3" fill="none" />
            <circle cx="5" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
            <circle cx="11" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
            <circle cx="33" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
            <circle cx="39" cy="3" r="1.6" fill="#ffd84a" stroke="none" />
          </g>
          {/* Stadium bowl */}
          <path d="M4 14 Q22 6 40 14 L37 26 Q22 32 7 26 Z" fill="rgba(43,255,154,.14)" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          {/* Pitch inside */}
          <ellipse cx="22" cy="20.5" rx="10.5" ry="4.6" fill="rgba(43,255,154,.28)" stroke="currentColor" strokeWidth="1.4" />
          <path d="M22 16 V25" stroke="currentColor" strokeWidth="1.1" opacity=".8" />
        </svg>
      </button>
      {readOnly && displayedPseudo ? (
        <div className="wcmap__autosave" aria-live="polite">
          <span>{displayedPseudo}</span>
        </div>
      ) : null}
      <div
        className="wcmap__viewport"
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div
          className="wcmap__canvas"
          style={{ height: `${MAP_HEIGHT}px`, transform: `translateY(${offset.y}px)` }}
        >
          <MapPathSvg nodes={nodes} revealY={introRevealY} />

          {ZONE_BANNERS.map((banner) => (
            <div
              key={banner.label}
              className={`wcmap__marker${introRevealY != null && banner.y < introRevealY - INTRO_REVEAL_MARGIN ? ' is-hidden-by-intro' : ''}`}
              style={{ top: `${banner.y}px` }}
            >
              <span>{banner.label}</span>
            </div>
          ))}

          {nodes.map((node) => {
            const introState = introRevealY == null
              ? undefined
              : node.y < introRevealY - INTRO_REVEAL_MARGIN ? 'hidden' : 'revealed'
            return (
              <MatchNode
                key={node.id}
                node={node}
                selecting={selectingId === node.id}
                score={scores[node.id]}
                readOnly={readOnly || introRevealY != null}
                recommended={recommendedNode?.id === node.id}
                invite={!readOnly && introRevealY == null && (inviteIds.has(node.id) || (node.status === 'picked' && Boolean(node.pickedTeamId) && !scores[node.id]))}
                introState={introState}
                onClick={() => handleSelectNode(node)}
              />
            )
          })}
        </div>
      </div>

      <div className={`wcmap__notice${notice ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {notice}
      </div>

      <LevelEntryScreen
        node={selectedNode}
        selectedTeamId={selectedTeamId}
        score={selectedNode ? scores[selectedNode.id] : undefined}
        scorers={selectedNode ? scorers[selectedNode.id] : undefined}
        open={Boolean(selectedNode)}
        canShare={Boolean(selectedNode?.pickedTeamId && selectedNode ? scores[selectedNode.id] : undefined)}
        canShowBracket={Boolean(onShowBracket)}
        onClose={() => setSelectedMatchId(null)}
        onPickTeam={handlePickTeam}
        onPlay={onPlay}
        onSimulate={onSimulate ? handleSimulate : undefined}
        onShowBracket={onShowBracket}
        onShare={handleSharePlayedMatch}
      />
    </section>
  )
}

export default WorldCupMapMenu
