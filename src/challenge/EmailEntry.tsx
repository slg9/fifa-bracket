import { useEffect, useState } from 'react'

export interface EmailEntryProps {
  initialEmail?: string
  initialPseudo?: string
  busy?: boolean
  error?: string | null
  onSubmit: (values: { email: string; pseudo: string; bracketName: string; submitted: boolean }) => void
  onDraftChange?: (values: { email: string; pseudo: string; bracketName: string }) => void
  onCancel?: () => void
}

export function EmailEntry({ initialEmail = '', initialPseudo = '', busy = false, error, onSubmit, onDraftChange, onCancel }: EmailEntryProps) {
  const [email, setEmail] = useState(initialEmail)
  const [pseudo, setPseudo] = useState(initialPseudo)

  useEffect(() => {
    onDraftChange?.({ email, pseudo, bracketName: pseudo || 'Mon bracket' })
  }, [email, onDraftChange, pseudo])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-email-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={(event) => { event.preventDefault(); onSubmit({ email, pseudo, bracketName: pseudo || 'Mon bracket', submitted: true }) }}>
        <span className="brakup-eyebrow">Sauvegarde sécurisée</span>
        <h2 id="brakup-email-title">Crée ton compte</h2>
        <p>Un lien valable 30 jours permet de retrouver tes pronostics sans mot de passe.</p>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        <label>Pseudo<input required maxLength={40} value={pseudo} onChange={(event) => setPseudo(event.target.value)} placeholder="Le sélectionneur" /></label>
        {error && <p className="brakup-form-error">{error}</p>}
        <div className="brakup-email__actions"><button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>Annuler</button><button type="submit" className="brakup-button" disabled={busy}>{busy ? 'Sauvegarde…' : 'Créer mon compte'}</button></div>
      </form>
    </div>
  )
}

export default EmailEntry
