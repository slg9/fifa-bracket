import { useEffect, useState } from 'react'

export interface LoginEntryProps {
  initialEmail?: string
  busy?: boolean
  error?: string | null
  sent?: boolean
  onSubmit: (email: string) => void
  onCancel?: () => void
}

export function LoginEntry({ initialEmail = '', busy = false, error, sent = false, onSubmit, onCancel }: LoginEntryProps) {
  const [email, setEmail] = useState(initialEmail)

  useEffect(() => setEmail(initialEmail), [initialEmail])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-login-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={(event) => { event.preventDefault(); onSubmit(email) }}>
        <span className="brakup-eyebrow">Connexion</span>
        <h2 id="brakup-login-title">Retrouver mon bracket</h2>
        <p>Entre ton email pour recevoir un lien de connexion et récupérer ton score sur cet appareil.</p>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        {sent ? <p className="brakup-form-success">Lien envoyé. Ouvre-le sur cet appareil.</p> : null}
        {error ? <p className="brakup-form-error">{error}</p> : null}
        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>Annuler</button>
          <button type="submit" className="brakup-button" disabled={busy}>{busy ? 'Envoi...' : 'Recevoir mon lien'}</button>
        </div>
      </form>
    </div>
  )
}

export default LoginEntry
