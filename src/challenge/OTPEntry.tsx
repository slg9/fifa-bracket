import { useState } from 'react'

export interface OTPEntryProps {
  email: string
  pseudo?: string
  requirePseudo?: boolean
  busy?: boolean
  error?: string | null
  onSubmit: (otp: string, pseudo?: string) => void
  onCancel?: () => void
}

export function OTPEntry({ email, pseudo = '', requirePseudo = false, busy = false, error, onSubmit, onCancel }: OTPEntryProps) {
  const [otp, setOtp] = useState('')
  const [draftPseudo, setDraftPseudo] = useState(pseudo)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (otp.length === 6 && (!requirePseudo || draftPseudo.trim())) {
      onSubmit(otp, draftPseudo.trim() || undefined)
    }
  }

  const handleOtpChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    if (/^\d*$/.test(value)) {
      setOtp(value.slice(0, 6))
    }
  }

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-otp-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={handleSubmit}>
        <span className="brakup-eyebrow">Vérification OTP</span>
        <h2 id="brakup-otp-title">Code de connexion</h2>
        <p>Entre le code à 6 chiffres envoyé par email.{requirePseudo ? ' Comme ce mail est nouveau, choisis aussi ton pseudo.' : ''}</p>

        <label>Email<input readOnly type="email" autoComplete="email" value={email} /></label>

        <label>
          Code OTP (6 chiffres)
          <input
            required
            type="text"
            name="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={handleOtpChange}
            placeholder="123456"
            autoComplete="one-time-code"
            autoCapitalize="none"
            enterKeyHint="done"
            style={{ fontSize: '20px', letterSpacing: '8px', textAlign: 'center' }}
          />
        </label>

        {requirePseudo ? <label>Pseudo<input required maxLength={40} autoComplete="nickname" value={draftPseudo} onChange={(event) => setDraftPseudo(event.target.value)} placeholder="Le sélectionneur" /></label> : null}

        {error && <p className="brakup-form-error">{error}</p>}

        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="brakup-button" disabled={busy || otp.length !== 6 || (requirePseudo && !draftPseudo.trim())}>
            {busy ? 'Vérification…' : 'Valider'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default OTPEntry