import { useEffect, useState } from 'react'

const CHALLENGE_ASSETS = [
  '/brakup-loader.svg',
  '/brakup-logo.png',
  '/challenge-splash.png',
  '/challenge-splash-wide.png',
  '/audio/kickoff-carnival.mp3',
  '/audio/clutch-chance.mp3',
  '/audio/goal-line-panic.mp3',
  '/audio/cup-victory-parade.mp3',
  '/audio/final-whistle-fumble.mp3',
] as const

const MIN_LOADING_MS = 2000

type ChallengePreloadState = {
  ready: boolean
  progress: number
}

function preloadAsset(src: string) {
  return fetch(src, { cache: 'force-cache' }).then(() => undefined)
}

export function useChallengePreload(): ChallengePreloadState {
  const [loadedCount, setLoadedCount] = useState(0)
  const [minDelayDone, setMinDelayDone] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    let active = true
    const startedAt = performance.now()

    const minDelayTimer = window.setTimeout(() => {
      if (!active) return
      setElapsedMs(MIN_LOADING_MS)
      setMinDelayDone(true)
    }, MIN_LOADING_MS)

    const progressTimer = window.setInterval(() => {
      if (!active) return
      setElapsedMs(Math.min(MIN_LOADING_MS, performance.now() - startedAt))
    }, 50)

    CHALLENGE_ASSETS.forEach((src) => {
      preloadAsset(src)
        .catch(() => undefined)
        .finally(() => {
          if (!active) return
          setLoadedCount((current) => Math.min(CHALLENGE_ASSETS.length, current + 1))
        })
    })

    return () => {
      active = false
      window.clearTimeout(minDelayTimer)
      window.clearInterval(progressTimer)
    }
  }, [])

  const assetsProgress = (loadedCount / CHALLENGE_ASSETS.length) * 100
  const timeProgress = Math.min(100, (elapsedMs / MIN_LOADING_MS) * 100)
  const progress = minDelayDone
    ? 100
    : loadedCount >= CHALLENGE_ASSETS.length
      ? Math.max(assetsProgress, timeProgress)
      : Math.min(94, Math.max(timeProgress * 0.7, assetsProgress))

  return {
    ready: loadedCount >= CHALLENGE_ASSETS.length && minDelayDone,
    progress,
  }
}

export default useChallengePreload
