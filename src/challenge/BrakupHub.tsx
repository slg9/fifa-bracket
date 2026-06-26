import { useEffect, useMemo, useState } from 'react'
import { setGameMuted, useGameAudio, useGameMuted } from '../lib/useGameAudio'
import { getBrackets, submitBracket } from '../lib/challengeData'
import { buildKnockoutBracket, knockoutTemplates } from '../lib/tournament'
import type { BattleResult, ChallengeEntry, KnockoutEntrant, KnockoutMatch, RankedStandingRow, Team, TournamentSeed } from '../types'
import BattleEngine from '../components/battle/BattleEngine'
import BracketChallenge from './BracketChallenge'
import ChallengeSplash from './ChallengeSplash'
import ChallengeLoading from './ChallengeLoading'
import WorldCupMapMenu from './WorldCupMapMenu'
import useChallengePreload from './useChallengePreload'
import EmailEntry from './EmailEntry'
import Leaderboard from './Leaderboard'
import MyBrackets from './MyBrackets'
import { sfx } from '../lib/sfx'
import './challenge.css'

export interface BrakupHubProps {
  seed: TournamentSeed
  liveSource?: { source: string; syncedAt: string | null }
  standings: Record<string, RankedStandingRow[]>
  teamsById: Map<string, Team>
}

type HubView = 'challenge' | 'battle' | 'brackets' | 'board'

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

export function BrakupHub({ seed, liveSource, standings, teamsById }: BrakupHubProps) {
  const [view, setView] = useState<HubView>(readInitialView)
  const [showSplash, setShowSplash] = useState(true)
  const [showBracket, setShowBracket] = useState(false)
  const [activeMatchId, setActiveMatchId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('match'))
  const [accessToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('token') ?? localStorage.getItem('brakup:token'))
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('brakup:draft') ?? '{}') as Record<string, string> } catch { return {} }
  })
  const [battleScores, setBattleScores] = useState<Record<string, { p: number; o: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('brakup:scores') ?? '{}') } catch { return {} }
  })
  const [activeSide, setActiveSide] = useState<'home' | 'away'>('home')
  const [battleBonuses, setBattleBonuses] = useState(0)
  const [brackets, setBrackets] = useState<ChallengeEntry[]>([])
  const [activeBracketId, setActiveBracketId] = useState<string | null>(null)
  const [showEmailEntry, setShowEmailEntry] = useState(false)
  const [showGameMenu, setShowGameMenu] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadingBrackets, setLoadingBrackets] = useState(Boolean(accessToken))
  const challengePreload = useChallengePreload()
  const audioMuted = useGameMuted()
  // Lobby music: kickoff when on challenge/brackets/board. Null during battle (BattleEngine takes over).
  useGameAudio(view !== 'battle' ? '/audio/kickoff-carnival.mp3' : null)

  const baseMatches = useMemo(() => buildKnockoutBracket(standings), [standings])
  const matches = useMemo(() => resolveMatches(baseMatches, picks), [baseMatches, picks])
  const activeMatch = matches.find((match) => match.id === activeMatchId)

  useEffect(() => { localStorage.setItem('brakup:draft', JSON.stringify(picks)) }, [picks])
  useEffect(() => { localStorage.setItem('brakup:scores', JSON.stringify(battleScores)) }, [battleScores])
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

  const handlePick = (matchId: string, teamId: string) => setPicks((current) => ({ ...current, [matchId]: teamId }))
  const handlePlay = (matchId: string, teamId?: string) => {
    if (teamId) {
      const m = matches.find((mx) => mx.id === matchId)
      const side: 'home' | 'away' = m?.home.kind === 'team' && m.home.teamId === teamId ? 'home' : 'away'
      setActiveSide(side)
    }
    navigate('battle', matchId)
  }
  const handleBattleComplete = (result: BattleResult) => {
    const mid = activeMatchId ?? ''
    handlePick(mid, result.winnerId)
    setBattleScores((s) => ({ ...s, [mid]: { p: result.playerScore, o: result.awayScore } }))
    setBattleBonuses((current) => Math.min(40, current + Math.max(1, Math.round(result.playerScore / 20))))
    navigate('challenge')
  }

  const save = async ({ email, pseudo, bracketName, submitted }: { email: string; pseudo: string; bracketName: string; submitted: boolean }) => {
    setSaving(true); setSaveError(null)
    try {
      const current = brackets.find((entry) => entry.id === activeBracketId)
      const result = await submitBracket({ ...current, email, pseudo, bracketName, picks, battleBonuses, submittedAt: submitted ? new Date().toISOString() : null })
      localStorage.setItem('brakup:token', result.token)
      setBrackets((entries) => entries.some((entry) => entry.id === result.entry.id) ? entries.map((entry) => entry.id === result.entry.id ? result.entry : entry) : [...entries, result.entry])
      setActiveBracketId(result.entry.id)
      setShowEmailEntry(false)
    } catch (caught) { setSaveError(caught instanceof Error ? caught.message : 'Sauvegarde impossible.') } finally { setSaving(false) }
  }

  const openBracket = (entry: ChallengeEntry) => { setPicks(entry.picks); setBattleBonuses(entry.battleBonuses); setActiveBracketId(entry.id); navigate('challenge') }
  const introActive = view === 'challenge' && (!challengePreload.ready || showSplash)

  return (
    <div className={`brakup-shell${view === 'challenge' ? ' brakup-shell--map-only' : ''}${introActive ? ' brakup-shell--intro' : ''}`}>
      {view === 'challenge' && !challengePreload.ready ? <ChallengeLoading progress={challengePreload.progress} /> : null}
      {showSplash && challengePreload.ready ? <ChallengeSplash onPlay={() => setShowSplash(false)} /> : null}
      <header className="brakup-topbar">
        <button type="button" className="brakup-brand" onClick={() => { sfx.tab(); navigate('challenge') }}><img src="/favicon-512.png" alt="" className="brakup-brand__ico" /><div><strong>BRAKUP</strong><small>World Cup Challenge</small></div></button>
        <nav>
          <button type="button" className={view === 'challenge' ? 'is-active' : ''} onClick={() => { sfx.tab(); navigate('challenge') }}>Challenge</button>
          <button type="button" className={view === 'brackets' ? 'is-active' : ''} onClick={() => { sfx.tab(); navigate('brackets') }}>Mes brackets</button>
          <button type="button" className={view === 'board' ? 'is-active' : ''} onClick={() => { sfx.tab(); navigate('board') }}>Classement</button>
        </nav>
        <a href="/" className="brakup-exit">Simulateur ↗</a>
      </header>
      {view === 'battle' && activeMatch?.home.kind === 'team' && activeMatch.away.kind === 'team' ? <BattleEngine match={activeMatch} teamsById={teamsById} onComplete={handleBattleComplete} playerSide={activeSide} onQuit={() => navigate('challenge')} /> : null}
      {view === 'battle' && (!activeMatch || activeMatch.home.kind !== 'team' || activeMatch.away.kind !== 'team') ? <section className="brakup-empty"><span>⚽</span><h2>Ce match n’est pas encore disponible</h2><button type="button" className="brakup-button" onClick={() => navigate('challenge')}>Retour au bracket</button></section> : null}
      {view === 'challenge' ? <>
        <WorldCupMapMenu matches={matches} teamsById={teamsById} picks={picks} scores={battleScores} onPick={handlePick} onPlay={handlePlay} onShowBracket={() => { sfx.bracket(); setShowBracket(true) }} onSave={() => setShowEmailEntry(true)} />
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
            <button type="button" className="game-menu-modal__item game-menu-modal__item--primary" onClick={() => { sfx.bracket(); setShowGameMenu(false); setShowBracket(true) }}>Tableau</button>
            <button type="button" className={`game-menu-modal__item game-menu-modal__item--sound${audioMuted ? ' is-muted' : ''}`} onClick={() => setGameMuted(!audioMuted)}>
              {audioMuted ? 'Activer le son' : 'Mute le jeu'}
            </button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.click(); setShowGameMenu(false); setShowEmailEntry(true) }}>Sauvegarder</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); navigate('brackets') }}>Mes brackets</button>
            <button type="button" className="game-menu-modal__item" onClick={() => { sfx.tab(); navigate('board') }}>Classement</button>
            <a className="game-menu-modal__item game-menu-modal__item--link" href="/">Simulateur</a>
          </div>
        </div>
      ) : null}

      {/* Bracket overlay — fullscreen, opens from the ⊞ button */}
      {view === 'challenge' && showBracket ? (
        <div className="brakup-bracket-overlay">
          <div className="brakup-bracket-overlay__bar">
            <span>Bracket — Coupe du Monde 2026</span>
            <button type="button" className="brakup-bracket-overlay__close" onClick={() => { sfx.click(); setShowBracket(false) }}>✕ Fermer</button>
          </div>
          <div className="brakup-bracket-overlay__body">
            <BracketChallenge matches={matches} teamsById={teamsById} picks={picks} onPick={handlePick} onPlay={(matchId) => { setShowBracket(false); handlePlay(matchId) }} brackets={brackets} activeBracketId={activeBracketId} onSelectBracket={(id) => { const entry = brackets.find((item) => item.id === id); if (entry) openBracket(entry) }} />
          </div>
        </div>
      ) : null}
      {view === 'brackets' ? <div className="brakup-phone-shell"><MyBrackets brackets={brackets} loading={loadingBrackets} onOpen={openBracket} onCreate={() => { setPicks({}); setActiveBracketId(null); navigate('challenge') }} /></div> : null}
      {view === 'board' ? <div className="brakup-phone-shell"><Leaderboard /></div> : null}
      {showEmailEntry ? <EmailEntry busy={saving} error={saveError} initialBracketName={brackets.find((entry) => entry.id === activeBracketId)?.bracketName} initialPseudo={brackets.find((entry) => entry.id === activeBracketId)?.pseudo} onSubmit={save} onCancel={() => setShowEmailEntry(false)} /> : null}
      <footer className="brakup-footer"><span>BRAKUP 2026</span><small>Données tournoi : {seed.meta.name} · {liveSource?.syncedAt ? `sync ${new Date(liveSource.syncedAt).toLocaleString('fr-FR')}` : 'projection locale'}</small></footer>
    </div>
  )
}

export default BrakupHub
