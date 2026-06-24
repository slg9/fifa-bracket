import { useRef, useState } from 'react'
import type { KnockoutMatch, Team } from '../types'
import { sfx } from '../lib/sfx'

export interface MobileBracketFlowProps {
  matches: KnockoutMatch[]
  teamsById: Map<string, Team>
  picks: Record<string, string>
  onPick: (matchId: string, teamId: string) => void
  onPlay: (matchId: string, teamId: string) => void
  onShowBracket?: () => void
  onSave?: () => void
}

const STAGE_SHORT: Record<string, string> = {
  'Round of 32': 'R32', 'Round of 16': '16èmes', 'Quarter-final': 'Quarts', 'Semi-final': 'Demies', 'Finale': 'Finale',
}

function entrantTeam(match: KnockoutMatch, side: 'home' | 'away', teamsById: Map<string, Team>) {
  const entrant = match[side]
  return entrant.kind === 'team' ? teamsById.get(entrant.teamId) : undefined
}

export function MobileBracketFlow({ matches, teamsById, picks, onPick, onPlay, onShowBracket, onSave }: MobileBracketFlowProps) {
  const [index, setIndex] = useState(0)
  const [teamPick, setTeamPick] = useState(false)
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null)
  const [hintDir, setHintDir] = useState<'left' | 'right' | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  const dragStartX = useRef<number | null>(null)

  const match = matches[index]
  const nextMatch = matches[index + 1]
  const home = match ? entrantTeam(match, 'home', teamsById) : undefined
  const away = match ? entrantTeam(match, 'away', teamsById) : undefined
  const picked = match ? picks[match.id] : undefined
  const canPlay = !!(home && away)

  const navigate = (delta: 1 | -1) => {
    const targetIdx = index + delta
    if (targetIdx < 0 || targetIdx >= matches.length) {
      snapBack()
      return
    }
    sfx.swipe()
    setHintDir(null)
    setExitDir(delta === 1 ? 'left' : 'right')
    setTimeout(() => {
      if (cardRef.current) { cardRef.current.style.transform = ''; cardRef.current.style.transition = '' }
      setIndex(targetIdx)
      setExitDir(null)
      setTeamPick(false)
    }, 340)
  }

  const snapBack = () => {
    setHintDir(null)
    dragStartX.current = null
    if (cardRef.current) {
      cardRef.current.style.transition = 'transform 0.45s cubic-bezier(0.2,1.4,0.4,1)'
      cardRef.current.style.transform = 'translateX(0) rotate(0deg)'
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (exitDir) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    dragStartX.current = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (cardRef.current) cardRef.current.style.transition = 'none'
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const offset = e.clientX - dragStartX.current
    if (cardRef.current) {
      cardRef.current.style.transform = `translateX(${offset}px) rotate(${offset * 0.06}deg)`
    }
    const next = offset < -44 ? 'left' : offset > 44 ? 'right' : null
    if (next !== hintDir) setHintDir(next)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return
    const delta = e.clientX - dragStartX.current
    dragStartX.current = null
    if (Math.abs(delta) > 80) {
      navigate(delta < 0 ? 1 : -1)
    } else {
      snapBack()
    }
  }

  if (!match) return null

  // Exit animation style applied when exitDir is set
  const exitStyle: React.CSSProperties | undefined = exitDir ? {
    transform: exitDir === 'left' ? 'translateX(-140vw) rotate(-22deg)' : 'translateX(140vw) rotate(22deg)',
    transition: 'transform 0.34s cubic-bezier(0.4,0,1,1)',
  } : undefined

  /* ── Team pick screen ──────────────────────────────── */
  if (teamPick && home && away) {
    return (
      <section className="mbf">
        <div className="mbf__pick-header">
          <button type="button" className="mbf__back" onClick={() => setTeamPick(false)}>← Retour</button>
          <span className="mbf__pick-title">⚔️ Choisis ton camp</span>
        </div>
        <div className="mbf__pick-match">{STAGE_SHORT[match.stage] ?? match.stage} · {match.label}</div>
        <div className="mbf__pick-teams">
          <button type="button" className="mbf__pick-team" onClick={() => { sfx.battle(); setTeamPick(false); onPlay(match.id, home.id) }}>
            <span className="mbf__pick-flag">{home.flagEmoji}</span>
            <strong>{home.shortName}</strong>
            <div className="mbf__pick-cta">Jouer avec {home.shortName} ⚔️</div>
          </button>
          <div className="mbf__pick-vs">VS</div>
          <button type="button" className="mbf__pick-team" onClick={() => { sfx.battle(); setTeamPick(false); onPlay(match.id, away.id) }}>
            <span className="mbf__pick-flag">{away.flagEmoji}</span>
            <strong>{away.shortName}</strong>
            <div className="mbf__pick-cta">Jouer avec {away.shortName} ⚔️</div>
          </button>
        </div>
      </section>
    )
  }

  /* ── Browse screen ─────────────────────────────────── */
  return (
    <section className="mbf">
      {/* Top bar */}
      <div className="mbf__top">
        <span className="mbf__stage">{STAGE_SHORT[match.stage] ?? match.stage}</span>
        <span className="mbf__date">{match.dateLabel}</span>
        <span className="mbf__counter">{index + 1}/{matches.length}</span>
        {onShowBracket && <button type="button" className="mbf__bracket-btn" onClick={onShowBracket} title="Voir le bracket">⊞</button>}
      </div>

      {/* Progress bar */}
      <div className="mbf__progress"><div style={{ width: `${((index + 1) / matches.length) * 100}%` }} /></div>

      {/* Card stack */}
      <div className={`mbf__stack${exitDir ? ' is-exiting' : ''}`}>

        {/* Behind card — next match, visible underneath */}
        {nextMatch && (
          <div className="mbf__card mbf__card--behind" aria-hidden="true">
            <div className="mbf__card-arena">
              <div className="mbf__card-team">
                <span className="mbf__card-flag">{entrantTeam(nextMatch, 'home', teamsById)?.flagEmoji ?? '◌'}</span>
                <strong>{entrantTeam(nextMatch, 'home', teamsById)?.shortName ?? '?'}</strong>
              </div>
              <div className="mbf__card-vs">VS</div>
              <div className="mbf__card-team">
                <span className="mbf__card-flag">{entrantTeam(nextMatch, 'away', teamsById)?.flagEmoji ?? '◌'}</span>
                <strong>{entrantTeam(nextMatch, 'away', teamsById)?.shortName ?? '?'}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Current card — draggable */}
        <div
          ref={cardRef}
          className="mbf__card"
          style={exitStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={snapBack}
        >
          {/* Swipe direction hint */}
          {hintDir === 'left' && <div className="mbf__swipe-hint mbf__swipe-hint--next">Match suivant →</div>}
          {hintDir === 'right' && <div className="mbf__swipe-hint mbf__swipe-hint--prev">← Match préc.</div>}

          {/* Stage + match label */}
          <div className="mbf__card-meta">
            <span className="mbf__card-stage">{STAGE_SHORT[match.stage] ?? match.stage}</span>
            <span className="mbf__card-matchlabel">{match.label}</span>
            <span className="mbf__card-date">{match.dateLabel}</span>
          </div>

          {/* Arena */}
          <div className="mbf__card-arena">
            <div className={`mbf__card-team${picked === home?.id ? ' is-winner' : picked && picked !== home?.id ? ' is-loser' : ''}`}>
              <span className="mbf__card-flag">{home ? home.flagEmoji : '◌'}</span>
              <strong>{home?.shortName ?? '?'}</strong>
              <small>{home?.name ?? 'À déterminer'}</small>
            </div>
            <div className="mbf__card-vs">VS</div>
            <div className={`mbf__card-team${picked === away?.id ? ' is-winner' : picked && picked !== away?.id ? ' is-loser' : ''}`}>
              <span className="mbf__card-flag">{away ? away.flagEmoji : '◌'}</span>
              <strong>{away?.shortName ?? '?'}</strong>
              <small>{away?.name ?? 'À déterminer'}</small>
            </div>
          </div>

          {/* Pick buttons */}
          {home && away && (
            <div className="mbf__card-picks">
              <button type="button" className={`mbf__pick-btn${picked === home.id ? ' is-active' : ''}`} onClick={() => { sfx.pick(); onPick(match.id, home.id) }}>
                {home.flagEmoji} {home.shortName}
              </button>
              <button type="button" className={`mbf__pick-btn${picked === away.id ? ' is-active' : ''}`} onClick={() => { sfx.pick(); onPick(match.id, away.id) }}>
                {away.flagEmoji} {away.shortName}
              </button>
            </div>
          )}

          {/* Play */}
          {canPlay && (
            <button type="button" className="mbf__card-play" onClick={() => { sfx.battle(); setTeamPick(true) }}>
              ⚔️ Jouer ce match
            </button>
          )}
        </div>
      </div>

      {/* Nav arrows */}
      <div className="mbf__nav">
        <button type="button" className="mbf__nav-btn" onClick={() => { sfx.nav(); navigate(-1) }} disabled={index === 0 || !!exitDir}>←</button>
        <div className="mbf__dots">
          {matches.slice(Math.max(0, index - 2), Math.min(matches.length, index + 3)).map((m, i) => {
            const absIdx = Math.max(0, index - 2) + i
            return <span key={m.id} className={absIdx === index ? 'is-active' : ''} />
          })}
        </div>
        <button type="button" className="mbf__nav-btn" onClick={() => { sfx.nav(); navigate(1) }} disabled={index >= matches.length - 1 || !!exitDir}>→</button>
      </div>

      {/* Save */}
      {onSave && <button type="button" className="mbf__save" onClick={() => { sfx.save(); onSave() }}>Sauvegarder mon bracket</button>}
    </section>
  )
}

export default MobileBracketFlow
