import { useEffect, useState } from 'react'

const RESEND_DELAY = 60

type LoginFlow = 'existing' | 'new'

export interface LoginEntryProps {
  initialEmail?: string
  initialPseudo?: string
  flow?: LoginFlow
  busy?: boolean
  error?: string | null
  sent?: boolean
  onSubmit: (email: string) => void
  onVerify?: (otp: string, pseudo?: string) => void
  onPseudoChange?: (pseudo: string) => void
  onResend?: () => void
  onCancel?: () => void
}

export function LoginEntry({
  initialEmail = '',
  initialPseudo = '',
  flow = 'existing',
  busy = false,
  error,
  sent = false,
  onSubmit,
  onVerify,
  onPseudoChange,
  onResend,
  onCancel,
}: LoginEntryProps) {
  const [email, setEmail] = useState(initialEmail)
  const [pseudo, setPseudo] = useState(initialPseudo)
  const [otp, setOtp] = useState('')
  const [countdown, setCountdown] = useState(0)
  const isNewUser = sent && flow === 'new'

  useEffect(() => setEmail(initialEmail), [initialEmail])
  useEffect(() => setPseudo(initialPseudo), [initialPseudo])
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

  const updatePseudo = (value: string) => {
    const next = value.slice(0, 40)
    setPseudo(next)
    onPseudoChange?.(next)
  }

  const handleOtpChange = (value: string) => {
    if (/^\d*$/.test(value)) setOtp(value.slice(0, 6))
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (sent && onVerify) {
      onVerify(otp, pseudo.trim())
      return
    }
    onSubmit(email)
  }

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-login-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={handleSubmit}>
        <span className="brakup-eyebrow">Brakup Challenge</span>
        <h2 id="brakup-login-title">Se connecter</h2>
        <p>{sent ? 'Entre le code recu pour continuer.' : 'Entre ton email. Si un compte existe, on te reconnecte; sinon on prepare la creation.'}</p>

        {!sent || isNewUser ? (
          <label>Email<input required disabled={sent} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        ) : null}

        {isNewUser ? (
          <label>Pseudo<input required maxLength={40} autoComplete="nickname" value={pseudo} onChange={(event) => updatePseudo(event.target.value)} placeholder="Le selectionneur" /></label>
        ) : null}

        {sent ? (
          <>
            <p className="brakup-form-success">Code envoye. Ouvre le lien ou entre le code recu.</p>
            <label>
              Code OTP
              <input
                required
                type="text"
                name="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                autoCapitalize="none"
                enterKeyHint="done"
                value={otp}
                onChange={(event) => handleOtpChange(event.target.value)}
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
          <button type="submit" className="brakup-button" disabled={busy || (sent && (otp.length !== 6 || (isNewUser && !pseudo.trim())))}>{busy ? 'Verification...' : sent ? 'Valider le code' : 'Recevoir mon lien'}</button>
        </div>
      </form>
    </div>
  )
}

export default LoginEntry
