import { useEffect, useState } from 'react'

export interface LoginEntryProps {
  initialEmail?: string
  busy?: boolean
  error?: string | null
  sent?: boolean
  onSubmit: (email: string) => void
  onVerify?: (otp: string) => void
  onCancel?: () => void
}

export function LoginEntry({ initialEmail = '', busy = false, error, sent = false, onSubmit, onVerify, onCancel }: LoginEntryProps) {
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')

  useEffect(() => setEmail(initialEmail), [initialEmail])
  useEffect(() => { if (!sent) setOtp('') }, [sent])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-login-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={(event) => { event.preventDefault(); sent && onVerify ? onVerify(otp) : onSubmit(email) }}>
        <span className="brakup-eyebrow">Connexion</span>
        <h2 id="brakup-login-title">Retrouver mon bracket</h2>
        <p>Entre ton email pour recevoir un lien magique et un code de connexion.</p>
        <label>Email<input required disabled={sent} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        {sent ? (
          <>
            <p className="brakup-form-success">Email envoyé. Ouvre le lien magique ou entre le code reçu.</p>
            <label>
              Code OTP
              <input
                required
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) => {
                  const value = event.target.value
                  if (/^\d*$/.test(value)) setOtp(value.slice(0, 6))
                }}
                placeholder="123456"
              />
            </label>
          </>
        ) : null}
        {error ? <p className="brakup-form-error">{error}</p> : null}
        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>Annuler</button>
          <button type="submit" className="brakup-button" disabled={busy || (sent && otp.length !== 6)}>{busy ? 'Verification...' : sent ? 'Valider le code' : 'Recevoir mon lien'}</button>
        </div>
      </form>
    </div>
  )
}

export default LoginEntry
