import { useState } from 'react'

export interface EmailEntryProps {
  initialPseudo?: string
  initialBracketName?: string
  busy?: boolean
  error?: string | null
  onSubmit: (values: { email: string; pseudo: string; bracketName: string; submitted: boolean }) => void
  onCancel?: () => void
}

export function EmailEntry({ initialPseudo = '', initialBracketName = 'Mon bracket', busy = false, error, onSubmit, onCancel }: EmailEntryProps) {
  const [email, setEmail] = useState('')
  const [pseudo, setPseudo] = useState(initialPseudo)
  const [bracketName, setBracketName] = useState(initialBracketName)

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-email-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={(event) => { event.preventDefault(); onSubmit({ email, pseudo, bracketName, submitted: true }) }}>
        <span className="brakup-eyebrow">Sauvegarde sécurisée</span>
        <h2 id="brakup-email-title">Garde ton bracket</h2>
        <p>Un lien valable 30 jours permet de retrouver tes pronostics sans mot de passe.</p>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        <label>Pseudo<input required maxLength={40} value={pseudo} onChange={(event) => setPseudo(event.target.value)} placeholder="Le sélectionneur" /></label>
        <label>Nom du bracket<input required maxLength={60} value={bracketName} onChange={(event) => setBracketName(event.target.value)} /></label>
        {error && <p className="brakup-form-error">{error}</p>}
        <div className="brakup-email__actions"><button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>Annuler</button><button type="submit" className="brakup-button" disabled={busy}>{busy ? 'Sauvegarde…' : 'Valider mes choix'}</button></div>
      </form>
    </div>
  )
}

export default EmailEntry
