const STORAGE_KEY = 'brakup:battle-tutorials-seen'

export type BattleTutorialId =
  | 'attack-dribble'
  | 'attack-shot'
  | 'defense'
  | 'fruit-ninja'
  | 'goal-save'
  | 'penalty'

function readSeenTutorials() {
  if (typeof window === 'undefined') return new Set<string>()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

export function hasSeenBattleTutorial(id: BattleTutorialId) {
  return readSeenTutorials().has(id)
}

export function markBattleTutorialSeen(id: BattleTutorialId) {
  if (typeof window === 'undefined') return
  const seen = readSeenTutorials()
  seen.add(id)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]))
  } catch {
    // Ignore private browsing/storage quota failures.
  }
}
