import { useEffect, useState } from 'react'
import type { BattleDifficultySetting } from '../types'

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
  difficultySetting?: BattleDifficultySetting
  onSubmit: (values: { email: string; pseudo: string }) => void
  onDifficultyChange?: (difficulty: BattleDifficultySetting) => void
  onClose: () => void
}

export function ProfileSettings({ initialEmail, initialPseudo, busy = false, error, status, difficultySetting = 'medium', onSubmit, onDifficultyChange, onClose }: ProfileSettingsProps) {
  const [email, setEmail] = useState(initialEmail)
  const [pseudo, setPseudo] = useState(initialPseudo)

  useEffect(() => setEmail(initialEmail), [initialEmail])
  useEffect(() => setPseudo(initialPseudo), [initialPseudo])

  return (
    <div className="brakup-dialog" role="dialog" aria-modal="true" aria-labelledby="brakup-settings-title">
      <button type="button" className="brakup-dialog__scrim" onClick={onClose} aria-label="Fermer les paramètres" />
      <form className="brakup-email brakup-settings" onSubmit={(event) => { event.preventDefault(); onSubmit({ email, pseudo }) }}>
        <h2 id="brakup-settings-title">Paramètres du compte</h2>
        <p>Ton pseudo doit rester unique sur le leaderboard public.</p>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" /></label>
        <label>Pseudo<input required maxLength={40} value={pseudo} onChange={(event) => setPseudo(event.target.value)} placeholder="Le sélectionneur" /></label>
        <section className="brakup-settings__game" aria-label="Paramètres du jeu">
          <div>
            <strong>Difficulté du jeu</strong>
            <span>{difficultySetting === 'auto' ? 'Auto selon le stade' : difficultySetting === 'easy' ? 'Facile' : difficultySetting === 'medium' ? 'Moyen' : 'Difficile'}</span>
          </div>
          <div className="brakup-settings__difficulty">
            {(['auto', 'easy', 'medium', 'hard'] as BattleDifficultySetting[]).map((option) => (
              <button
                key={option}
                type="button"
                className={difficultySetting === option ? 'is-active' : ''}
                onClick={() => onDifficultyChange?.(option)}
              >
                {option === 'auto' ? 'Auto' : option === 'easy' ? 'Facile' : option === 'medium' ? 'Moyen' : 'Dur'}
              </button>
            ))}
          </div>
        </section>
        {status && !status.hasEntries ? <p className="brakup-form-error">Aucune donnée distante trouvée pour ce compte.</p> : null}
        {error ? <p className="brakup-form-error">{error}</p> : null}
        <div className="brakup-email__actions">
          <button type="button" className="brakup-button brakup-button--ghost" onClick={onClose}>Retour</button>
          <button type="submit" className="brakup-button" disabled={busy}>{busy ? 'Mise à jour…' : 'Mettre à jour'}</button>
        </div>
      </form>
    </div>
  )
}

export default ProfileSettings
