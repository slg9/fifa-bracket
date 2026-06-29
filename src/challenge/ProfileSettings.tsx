import { useEffect, useState } from 'react'

type ProfileStatus = {
  blobConfigured: boolean
  bracketCount: number
  hasEntries: boolean
  emailHash: string
  pseudo: string
  lastSavedAt: string | null
}

export interface ProfileSettingsProps {
  initialEmail: string
  initialPseudo: string
  busy?: boolean
  error?: string | null
  status?: ProfileStatus | null
  onSubmit: (values: { email: string; pseudo: string }) => void
  onClose: () => void
}

export function ProfileSettings({ initialEmail, initialPseudo, busy = false, error, status, onSubmit, onClose }: ProfileSettingsProps) {
  const [email, setEmail] = useState(initialEmail)
  const [pseudo, setPseudo] = useState(initialPseudo)

  useEffect(() => setEmail(initialEmail), [initialEmail])
  useEffect(() => setPseudo(initialPseudo), [initialPseudo])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-settings-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onClose} aria-label="Fermer les parametres" />
      <form className="brakup-email brakup-settings" onSubmit={(event) => { event.preventDefault(); onSubmit({ email, pseudo }) }}>
        <h2 id="brakup-settings-title">Parametres du compte</h2>
        <p>Ton pseudo doit rester unique sur le leaderboard public.</p>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        <label>Pseudo<input required maxLength={40} value={pseudo} onChange={(event) => setPseudo(event.target.value)} placeholder="Le selectionneur" /></label>
        <div className="brakup-settings__status">
          <strong>Blob Vercel</strong>
          <span>{status?.blobConfigured ? 'Connecte' : 'Indisponible'}</span>
          <strong>Brackets</strong>
          <span>{status ? status.bracketCount : '...'}</span>
          <strong>Derniere synchro</strong>
          <span>{status?.lastSavedAt ? new Date(status.lastSavedAt).toLocaleString('fr-FR') : 'Aucune'}</span>
        </div>
        {status && !status.hasEntries ? <p className="brakup-form-error">Aucune donnee distante trouvee pour ce compte.</p> : null}
        {error ? <p className="brakup-form-error">{error}</p> : null}
        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onClose}>Retour</button>
          <button type="submit" className="brakup-button" disabled={busy}>{busy ? 'Mise a jour…' : 'Mettre a jour'}</button>
        </div>
      </form>
    </div>
  )
}

export default ProfileSettings
