import { useEffect, useState } from 'react'
import { CHALLENGE_DIALOGUE_IMAGES } from './ChallengeSplash'
import type { Team } from '../types'

const CHALLENGE_ASSETS = [
  '/brakup-loader.svg',
  '/brakup-logo.png',
  '/brakup-challenge-logo.png',
  '/brakup-challenge-logo-wc.png',
  '/brakup-share-bg.png',
  '/brakup-share-bg-brakup.png',
  '/favicon-512.png',
  '/challenge-splash.png',
  '/challenge-splash-wide.png',
  ...CHALLENGE_DIALOGUE_IMAGES,
  '/data/world-cup-2026.json',
  '/data/fifa-live.json',
  '/api/fifa-sync',
  '/audio/kickoff-carnival.mp3',
  '/audio/clutch-chance.mp3',
  '/audio/goal-line-panic.mp3',
  '/audio/save-the-chaos.mp3',
  '/audio/final-kick-freeze.mp3',
  '/audio/cup-victory-parade.mp3',
  '/audio/final-whistle-fumble.mp3',
  '/audio/ball-kick.mp3',
  '/audio/crowd.mp3',
  '/audio/goal.mp3',
  '/audio/goal-rush.mp3',
  '/audio/heart.mp3',
  '/audio/sad.mp3',
] as const

const MIN_LOADING_MS = 2000
const PRELOAD_TIMEOUT_MS = 5500

type ChallengePreloadState = {
  ready: boolean
  progress: number
}

function withTimeout<T>(promise: Promise<T>, ms = PRELOAD_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error('preload timeout')), ms)
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeoutId))
  })
}

function isImageAsset(src: string) {
  return /\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i.test(src) || src.includes('flagcdn.com/')
}

function preloadImage(src: string) {
  return withTimeout(new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if ('decode' in image) {
        image.decode().then(() => resolve()).catch(() => resolve())
        return
      }
      resolve()
    }
    image.onerror = () => reject(new Error(`Image preload failed: ${src}`))
    image.src = src
  }))
}

function preloadFetch(src: string) {
  return withTimeout(fetch(src, { cache: 'force-cache' }).then(() => undefined))
}

function preloadAsset(src: string) {
  return isImageAsset(src) ? preloadImage(src) : preloadFetch(src)
}

function flagUrlsForTeams(teams: Team[]) {
  const urls = new Set<string>()
  for (const team of teams) {
    if (!team.iso2) continue
    const iso2 = team.iso2.toLowerCase()
    urls.add(`https://flagcdn.com/w40/${iso2}.png`)
    urls.add(`https://flagcdn.com/w80/${iso2}.png`)
  }
  return [...urls]
}

export function useChallengePreload(teams: Team[] = []): ChallengePreloadState {
  const [loadedCount, setLoadedCount] = useState(0)
  const [assetCount, setAssetCount] = useState(CHALLENGE_ASSETS.length)
  const [minDelayDone, setMinDelayDone] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    let active = true
    const startedAt = performance.now()
    const assets = [...new Set([...CHALLENGE_ASSETS, ...flagUrlsForTeams(teams)])]

    setLoadedCount(0)
    setAssetCount(assets.length)
    setMinDelayDone(false)
    setElapsedMs(0)

    const minDelayTimer = window.setTimeout(() => {
      if (!active) return
      setElapsedMs(MIN_LOADING_MS)
      setMinDelayDone(true)
    }, MIN_LOADING_MS)

    const progressTimer = window.setInterval(() => {
      if (!active) return
      setElapsedMs(Math.min(MIN_LOADING_MS, performance.now() - startedAt))
    }, 50)

    assets.forEach((src) => {
      preloadAsset(src)
        .catch(() => undefined)
        .finally(() => {
          if (!active) return
          setLoadedCount((current) => Math.min(assets.length, current + 1))
        })
    })

    return () => {
      active = false
      window.clearTimeout(minDelayTimer)
      window.clearInterval(progressTimer)
    }
  }, [teams])

  const assetsProgress = assetCount > 0 ? (loadedCount / assetCount) * 100 : 100
  const timeProgress = Math.min(100, (elapsedMs / MIN_LOADING_MS) * 100)
  const progress = minDelayDone
    ? 100
    : loadedCount >= assetCount
      ? Math.max(assetsProgress, timeProgress)
      : Math.min(94, Math.max(timeProgress * 0.7, assetsProgress))

  return {
    ready: loadedCount >= assetCount && minDelayDone,
    progress,
  }
}

export default useChallengePreload
