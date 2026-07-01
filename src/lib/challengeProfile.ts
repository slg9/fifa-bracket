export type StoredChallengeProfile = {
  email: string
  pseudo: string
  bracketName: string
  savedAt?: string
}

export const CHALLENGE_PROFILE_STORAGE_KEY = 'brakup:profile'
const CHALLENGE_PROFILE_EVENT = 'brakup:profile-updated'

export const emptyChallengeProfile: StoredChallengeProfile = {
  email: '',
  pseudo: '',
  bracketName: 'Mon bracket',
}

export function readChallengeProfile(): StoredChallengeProfile {
  if (typeof window === 'undefined') return emptyChallengeProfile

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHALLENGE_PROFILE_STORAGE_KEY) ?? '{}') as Partial<StoredChallengeProfile>
    return {
      email: parsed.email ?? '',
      pseudo: parsed.pseudo ?? '',
      bracketName: parsed.bracketName ?? 'Mon bracket',
      savedAt: parsed.savedAt,
    }
  } catch {
    return emptyChallengeProfile
  }
}

export function writeChallengeProfile(profile: StoredChallengeProfile) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CHALLENGE_PROFILE_STORAGE_KEY, JSON.stringify(profile))
  window.dispatchEvent(new CustomEvent<StoredChallengeProfile>(CHALLENGE_PROFILE_EVENT, { detail: profile }))
}

export function clearChallengeProfile() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CHALLENGE_PROFILE_STORAGE_KEY)
  window.dispatchEvent(new CustomEvent<StoredChallengeProfile>(CHALLENGE_PROFILE_EVENT, { detail: emptyChallengeProfile }))
}

export function subscribeChallengeProfile(callback: (profile: StoredChallengeProfile) => void) {
  if (typeof window === 'undefined') return () => undefined

  const onProfile = (event: Event) => {
    callback((event as CustomEvent<StoredChallengeProfile>).detail ?? readChallengeProfile())
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === CHALLENGE_PROFILE_STORAGE_KEY) callback(readChallengeProfile())
  }

  window.addEventListener(CHALLENGE_PROFILE_EVENT, onProfile)
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener(CHALLENGE_PROFILE_EVENT, onProfile)
    window.removeEventListener('storage', onStorage)
  }
}
