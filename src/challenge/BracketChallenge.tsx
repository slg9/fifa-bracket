import { useLayoutEffect, useState, useRef, useCallback, useEffect } from 'react'
import type { ChallengeEntry, KnockoutMatch, Team } from '../types'
import ScorePanel from './ScorePanel'
import { sfx } from '../lib/sfx'
import { formatKnockoutDateTime } from '../lib/knockoutSchedule'
import { evaluateMatchProgress, formatScore, type BattleScore, type OfficialScore } from './progress'

export interface BracketChallengeProps {
  matches: KnockoutMatch[]
  teamsById: Map<string, Team>
  picks: Record<string, string>
  onPick: (matchId: string, teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
  brackets?: ChallengeEntry[]
  activeBracketId?: string | null
  onSelectBracket?: (id: string) => void
  realResults?: Record<string, string>
  scores?: Record<string, BattleScore>
  officialScores?: Record<string, OfficialScore>
  readOnly?: boolean
  ownerPseudo?: string
}

const ROUND_ORDER = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Finale']
const STAGE_SHORT: Record<string, string> = {
  'Round of 32': 'R32', 'Round of 16': 'R16', 'Quarter-final': 'QF', 'Semi-final': 'SF', 'Finale': 'F',
}
const LATE_STAGES = new Set(['Quarter-final', 'Semi-final', 'Finale'])

const CONNECTIONS: { from: [string, string]; to: string }[] = [
  // R32 → R16
  { from: ['M74','M77'], to: 'M89' },
  { from: ['M73','M75'], to: 'M90' },
  { from: ['M76','M78'], to: 'M91' },
  { from: ['M79','M80'], to: 'M92' },
  { from: ['M83','M84'], to: 'M93' },
  { from: ['M81','M82'], to: 'M94' },
  { from: ['M86','M88'], to: 'M95' },
  { from: ['M85','M87'], to: 'M96' },
  // R16 → QF
  { from: ['M89','M90'], to: 'M97' },
  { from: ['M93','M94'], to: 'M98' },
  { from: ['M91','M92'], to: 'M99' },
  { from: ['M95','M96'], to: 'M100' },
  // QF → SF
  { from: ['M97','M98'], to: 'M101' },
  { from: ['M99','M100'], to: 'M102' },
  // SF → Finale
  { from: ['M101','M102'], to: 'M104' },
  { from: ['M101','M102'], to: 'M103' },
]

interface PathInfo {
  d: string
  color: string
  glow: boolean
}

function getRelativeRect(el: HTMLElement, container: HTMLElement) {
  let top = 0, left = 0
  let current: HTMLElement | null = el
  while (current && current !== container) {
    top += current.offsetTop
    left += current.offsetLeft
    current = current.offsetParent as HTMLElement | null
  }
  return { top, left, width: el.offsetWidth, height: el.offsetHeight }
}

export function BracketChallenge({ matches, teamsById, picks, onPick, onPlay, brackets = [], activeBracketId = null, onSelectBracket = () => undefined, realResults = {}, scores = {}, officialScores = {}, readOnly = false, ownerPseudo }: BracketChallengeProps) {
  const bracketRef = useRef<HTMLElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<PathInfo[]>([])
  const [activeRound, setActiveRound] = useState(0)
  const activeRoundRef = useRef(0)

  const scrollParentToTop = useCallback((from: HTMLElement) => {
    let el: HTMLElement | null = from.parentElement
    while (el && el !== document.documentElement) {
      if (el.scrollTop > 0) {
        el.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      el = el.parentElement
    }
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    let tid: ReturnType<typeof window.setTimeout>
    const handleScroll = () => {
      window.clearTimeout(tid)
      tid = window.setTimeout(() => {
        if (!wrapper.clientWidth) return
        const idx = Math.max(0, Math.min(Math.round(wrapper.scrollLeft / wrapper.clientWidth), ROUND_ORDER.length - 1))
        if (idx !== activeRoundRef.current) {
          activeRoundRef.current = idx
          setActiveRound(idx)
          scrollParentToTop(wrapper)
        }
      }, 80)
    }
    wrapper.addEventListener('scroll', handleScroll, { passive: true })
    return () => { wrapper.removeEventListener('scroll', handleScroll); window.clearTimeout(tid) }
  }, [scrollParentToTop])

  const scrollToRound = useCallback((idx: number) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    activeRoundRef.current = idx
    setActiveRound(idx)
    wrapper.scrollTo({ left: idx * wrapper.clientWidth, behavior: 'smooth' })
    scrollParentToTop(wrapper)
  }, [scrollParentToTop])

  const buildPaths = useCallback(() => {
    const container = bracketRef.current
    if (!container) return

    const positions = new Map<string, { top: number; left: number; width: number; height: number }>()
    container.querySelectorAll<HTMLElement>('[data-match-id]').forEach((el) => {
      const id = el.dataset.matchId
      if (id) positions.set(id, getRelativeRect(el, container))
    })

    const result: PathInfo[] = []

    for (const conn of CONNECTIONS) {
      const [A, B] = conn.from
      const C = conn.to
      const posA = positions.get(A)
      const posB = positions.get(B)
      const posC = positions.get(C)
      if (!posA || !posB || !posC) continue

      const ax = posA.left + posA.width
      const ay = posA.top + posA.height / 2
      const bx = posB.left + posB.width
      const by = posB.top + posB.height / 2
      const cx = posC.left
      const midX = (ax + cx) / 2
      const midY = (ay + by) / 2

      const dA = `M${ax},${ay} H${midX} V${midY}`
      const dB = `M${bx},${by} H${midX} V${midY}`
      const dC = `M${midX},${midY} H${cx}`

      const isPicked = picks[C] != null
      const isActive = isPicked && picks[A] == null && picks[B] == null
      const color = isActive
        ? 'rgba(255,184,0,.7)'
        : isPicked
          ? '#2bff9a'
          : 'rgba(255,255,255,.12)'
      const glow = isPicked && !isActive

      result.push(
        { d: dA, color, glow },
        { d: dB, color, glow },
        { d: dC, color, glow },
      )
    }

    setPaths(result)
  }, [picks])

  useLayoutEffect(() => {
    buildPaths()
    const container = bracketRef.current
    if (!container) return
    const ro = new ResizeObserver(buildPaths)
    ro.observe(container)
    return () => ro.disconnect()
  }, [buildPaths])

  return (
    <div className="brakup-bracket-layout">
      <nav className="brakup-phase-nav" aria-label="Phases">
        {ROUND_ORDER.map((stage, i) => (
          <button
            key={stage}
            type="button"
            className={`brakup-phase-nav__btn${activeRound === i ? ' is-active' : ''}`}
            onClick={() => scrollToRound(i)}
            aria-current={activeRound === i ? 'step' : undefined}
          >
            {STAGE_SHORT[stage] ?? stage}
          </button>
        ))}
      </nav>
      <div className="brakup-bracket-wrapper" ref={wrapperRef}>
        <div className="brakup-bracket-header">
          <div style={{ font: '900 22px Barlow Condensed, Arial Narrow, sans-serif', letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {ownerPseudo ? `Bracket de ${ownerPseudo}` : 'Bracket — Coupe du Monde 2026'}
          </div>
          <div className="brakup-bracket-header__hint">
            {ownerPseudo ? 'Mode lecture seule' : 'R32 → Finale'}
          </div>
        </div>
        <section className="brakup-bracket" aria-label="Bracket challenge" ref={bracketRef}>
          <svg
            className="brakup-bracket-connectors"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}
            aria-hidden="true"
          >
            {paths.map((path, i) => (
              <path
                key={i}
                d={path.d}
                fill="none"
                stroke={path.color}
                strokeWidth="2"
                style={path.glow ? { filter: 'drop-shadow(0 0 4px rgba(43,255,154,.6))' } : undefined}
              />
            ))}
          </svg>
          {ROUND_ORDER.map((stage) => <div className={`brakup-bracket__round${LATE_STAGES.has(stage) ? ' is-late' : ''}`} key={stage}>
            <h2>{STAGE_SHORT[stage] ?? stage}</h2>
            {matches.filter((match) => match.stage === stage).map((match) => {
              const isPicked = picks[match.id] != null
              const bothTeamsKnown = match.home.kind === 'team' && match.away.kind === 'team'
              const isReady = bothTeamsKnown && !isPicked
              const isPlayed = isPicked && scores[match.id] !== undefined
              const realWinnerId = realResults[match.id]
              const progress = evaluateMatchProgress(match, picks, scores, realResults, officialScores)
              return <article className={`brakup-bracket__match${isPicked ? ' is-done' : isReady ? ' is-ready' : ''}${isPlayed ? ' is-played' : ''}${progress.correct ? ' is-prono-correct' : progress.wrong ? ' is-prono-wrong' : ''}`} key={match.id} data-match-id={match.id}>
                <header className="bkm-meta">
                  <span>{match.label}</span>
                  <time>{formatKnockoutDateTime(match.id, match.dateLabel)}</time>
                </header>
                {(['home', 'away'] as const).map((side) => {
                  const entrant = match[side]
                  const team = entrant.kind === 'team' ? teamsById.get(entrant.teamId) : undefined
                  if (!team) return <div key={side} className="is-pending"><span>◌</span><strong>{entrant.kind === 'placeholder' ? entrant.label : '?'}</strong></div>
                  const isWinner = isPicked && picks[match.id] === team.id
                  const isLoser = isPicked && picks[match.id] !== team.id
                  const isRealWinnerVisible = isPicked && realWinnerId === team.id
                  const handleClick = readOnly ? undefined
                    : isPlayed ? () => { sfx.battle(); onPlay(match.id, team.id) }
                    : !isLoser ? () => { sfx.pick(); onPick(match.id, team.id) }
                    : undefined
                  return <div key={side}
                    className={`${isWinner ? 'is-picked' : isLoser && !isPlayed ? 'is-lost' : ''}${isRealWinnerVisible ? ' is-real-winner' : ''}${readOnly ? ' is-readonly' : ''}`}
                    onClick={handleClick}
                    role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0}
                    title={isPlayed ? `Rejouer avec ${team.shortName}` : readOnly ? undefined : `Choisir ${team.shortName}`}>
                    <span>{team.flagEmoji}</span>
                    <strong>{team.shortName}</strong>
                    {isRealWinnerVisible ? <small className="bkm-official">OFF</small> : null}
                    {isReady && !readOnly && <button type="button" className="bkm-play" title="Jouer ce match"
                      onClick={(e) => { e.stopPropagation(); sfx.battle(); onPlay(match.id, team.id) }}>⚔</button>}
                  </div>
                })}
                {progress.played ? (
                  <footer className="bkm-progress">
                    <span className={`bkm-progress__badge${progress.correct ? ' is-correct' : ' is-wrong'}`}>
                      {progress.correct ? `★ +${progress.points}` : '! rate'}
                    </span>
                    {progress.exact ? <span className="bkm-progress__exact">◎ exact +{progress.exactPoints}</span> : null}
                    <span>R {formatScore(progress.realScore)} · J {formatScore(progress.playedScore)}</span>
                  </footer>
                ) : null}
              </article>
            })}
          </div>)}
        </section>
      </div>
      {!readOnly && <ScorePanel brackets={brackets} activeBracketId={activeBracketId} onSelect={onSelectBracket} realResults={realResults} />}
    </div>
  )
}

export default BracketChallenge
