import { useEffect, useState } from 'react'

const RESEND_DELAY = 60

export interface LoginEntryProps {
  initialEmail?: string
  busy?: boolean
  error?: string | null
  sent?: boolean
  onSubmit: (email: string) => void
  onVerify?: (otp: string) => void
  onResend?: () => void
  onCancel?: () => void
}

export function LoginEntry({ initialEmail = '', busy = false, error, sent = false, onSubmit, onVerify, onResend, onCancel }: LoginEntryProps) {
  const [email, setEmail] = useState(initialEmail)
  const [otp, setOtp] = useState('')
  const [countdown, setCountdown] = useState(0)

  useEffect(() => setEmail(initialEmail), [initialEmail])
  useEffect(() => {
    if (!sent) {
      setOtp('')
      setCountdown(0)
    } else {
      setCountdown(RESEND_DELAY)
    }
  }, [sent])

  useEffect(() => {
    if (countdown <= 0) return
    const id = window.setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => window.clearTimeout(id)
  }, [countdown])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-login-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={(event) => { event.preventDefault(); sent && onVerify ? onVerify(otp) : onSubmit(email) }}>
        <span className="brakup-eyebrow">Brakup Challenge</span>
        <h2 id="brakup-login-title">Se connecter</h2>
        <p>Entre ton email — si tu as déjà un compte on te reconnecte, sinon on le crée automatiquement.</p>
        <label>Email<input required disabled={sent} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        {sent ? (
          <>
            <p className="brakup-form-success">Email envoyé. Ouvre le lien ou entre le code reçu.</p>
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
            {onResend ? (
              countdown > 0
                ? <p className="brakup-form-hint">Renvoyer le code dans {countdown}s</p>
                : <button type="button" className="brakup-form-resend" disabled={busy} onClick={onResend}>Renvoyer le code</button>
            ) : null}
          </>
        ) : null}
        {error ? <p className="brakup-form-error">{error}</p> : null}
        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>Annuler</button>
          <button type="submit" className="brakup-button" disabled={busy || (sent && otp.length !== 6)}>{busy ? 'Vérification...' : sent ? 'Valider le code' : 'Recevoir mon lien'}</button>
        </div>
      </form>
    </div>
  )
}

export default LoginEntry
