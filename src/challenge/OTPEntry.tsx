import { useState } from 'react'

export interface OTPEntryProps {
  email: string
  pseudo: string
  busy?: boolean
  error?: string | null
  onSubmit: (otp: string) => void
  onCancel?: () => void
}

export function OTPEntry({ email, pseudo, busy = false, error, onSubmit, onCancel }: OTPEntryProps) {
  const [otp, setOtp] = useState('')

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (otp.length === 6) {
      onSubmit(otp)
    }
  }

  const handleOtpChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    // Only allow digits
    if (/^\d*$/.test(value)) {
      setOtp(value.slice(0, 6))
    }
  }

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-otp-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onCancel} aria-label="Fermer" />
      <form className="brakup-email" onSubmit={handleSubmit}>
        <span className="brakup-eyebrow">Verification OTP</span>
        <h2 id="brakup-otp-title">Code de connexion</h2>
        <p>Un code à 6 chiffres a été envoyé à <strong>{email}</strong> pour le compte <strong>{pseudo}</strong>.</p>
        <p>Entrez le code reçu ci-dessous pour vous connecter.</p>
        
        <label>
          Code OTP (6 chiffres)
          <input
            required
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={handleOtpChange}
            placeholder="123456"
            autoComplete="one-time-code"
            style={{ fontSize: '20px', letterSpacing: '8px', textAlign: 'center' }}
          />
        </label>
        
        {error && <p className="brakup-form-error">{error}</p>}
        
        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="brakup-button" disabled={busy || otp.length !== 6}>
            {busy ? 'Verification...' : 'Valider'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default OTPEntry
