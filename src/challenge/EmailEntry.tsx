import { useEffect, useState } from 'react'

export interface EmailEntryProps {
  initialEmail?: string
  initialPseudo?: string
  busy?: boolean
  error?: string | null
  mode?: 'email' | 'profile'
  onSubmit: (values: { email: string; pseudo: string; bracketName: string; submitted: boolean }) => void
  onDraftChange?: (values: { email: string; pseudo: string; bracketName: string }) => void
  onCancel?: () => void
}

export function EmailEntry({ initialEmail = '', initialPseudo = '', busy = false, error, mode = 'email', onSubmit, onDraftChange, onCancel }: EmailEntryProps) {
  const [email, setEmail] = useState(initialEmail)
  const [pseudo, setPseudo] = useState(initialPseudo)
  const isProfileMode = mode === 'profile'

  useEffect(() => {
    if (!isProfileMode) return
    onDraftChange?.({ email, pseudo, bracketName: pseudo || 'Mon bracket' })
  }, [email, isProfileMode, onDraftChange, pseudo])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-email-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={(event) => { event.preventDefault(); const submitPseudo = isProfileMode ? pseudo : pseudo || (email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'Joueur'; onSubmit({ email, pseudo: submitPseudo, bracketName: submitPseudo || 'Mon bracket', submitted: true }) }}>
        <span className="brakup-eyebrow">{isProfileMode ? 'Profil Brakup' : 'Sauvegarde tes résultats'}</span>
        <h2 id="brakup-email-title">{isProfileMode ? 'Choisis ton pseudo' : 'Ajoute ton email'}</h2>
        <p>{isProfileMode ? 'Ce pseudo sera affiché sur ton espace et le leaderboard.' : 'Ajoute ton email pour te créer un espace, sauvegarder tes résultats et pouvoir les partager.'}</p>
        <label>Email<input required readOnly={isProfileMode} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        {isProfileMode ? <label>Pseudo<input required maxLength={40} value={pseudo} onChange={(event) => setPseudo(event.target.value)} placeholder="Le sélectionneur" /></label> : null}
        {error && <p className="brakup-form-error">{error}</p>}
        <div className="brakup-email__actions"><button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>Annuler</button><button type="submit" className="brakup-button" disabled={busy || !email.trim() || (isProfileMode && !pseudo.trim())}>{busy ? 'Sauvegarde…' : isProfileMode ? 'Sauvegarder' : 'Recevoir mon code'}</button></div>
      </form>
    </div>
  )
}

export default EmailEntry