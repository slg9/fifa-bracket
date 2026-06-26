import { useEffect, useState } from 'react'

/**
 * Global singleton audio controller.
 * Any component calling useGameAudio(src) takes ownership of playback.
 * Only ONE track plays at a time — no overlap, smooth crossfade.
 */

const FADE_OUT_MS = 220
const FADE_IN_MS = 400
const FADE_STEPS = 24
const MUSIC_VOLUME = 0.58

let _audio: HTMLAudioElement | null = null
let _src: string | null = null
let _interval: number | null = null
const MUTE_STORAGE_KEY = 'brakup:audio-muted'
let _muted = typeof window !== 'undefined' && window.localStorage.getItem(MUTE_STORAGE_KEY) === '1'
const muteListeners = new Set<(muted: boolean) => void>()
const overlayAudios = new Set<HTMLAudioElement>()

const DEDICATED_TRACKS = new Set<string>([
  '/audio/final-kick-freeze.mp3',
  '/audio/save-the-chaos.mp3',
])
const resumePositions = new Map<string, number>()

function shouldResume(src: string | null): src is string {
  return src !== null && !DEDICATED_TRACKS.has(src)
}

function rememberPosition(audio: HTMLAudioElement | null, src: string | null) {
  if (!audio || !shouldResume(src) || !Number.isFinite(audio.currentTime)) return
  resumePositions.set(src, audio.currentTime)
}

function stopInterval() {
  if (_interval !== null) { clearInterval(_interval); _interval = null }
}

function startTrack(src: string) {
  const audio = _audio ?? new Audio()
  audio.pause()
  audio.src = src
  audio.loop = true
  audio.muted = _muted
  audio.volume = 0
  const resumeAt = shouldResume(src) ? resumePositions.get(src) ?? 0 : 0
  if (resumeAt > 0) {
    audio.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25))
    }, { once: true })
  }
  _audio = audio
  _src = src
  audio.play().catch(() => undefined)

  let v = 0
  const step = 1 / FADE_STEPS
  _interval = window.setInterval(() => {
    v = Math.min(1, v + step)
    audio.muted = _muted
    audio.volume = v * MUSIC_VOLUME
    if (v >= 1) stopInterval()
  }, FADE_IN_MS / FADE_STEPS)
}

function switchTo(newSrc: string | null) {
  if (newSrc === _src) return
  stopInterval()

  const prev = _audio
  const prevSrc = _src
  _src = newSrc

  if (prev && !prev.paused) {
    const startVol = prev.volume
    const step = Math.max(startVol / FADE_STEPS, 0.001)
    _interval = window.setInterval(() => {
      const next = Math.max(0, prev.volume - step)
      prev.muted = _muted
      prev.volume = next
      if (next <= 0) {
        stopInterval()
        rememberPosition(prev, prevSrc)
        prev.pause()
        if (newSrc) {
          _audio = prev
          startTrack(newSrc)
        } else {
          prev.removeAttribute('src')
          _audio = null
        }
      }
    }, FADE_OUT_MS / FADE_STEPS)
  } else {
    if (prev) { rememberPosition(prev, prevSrc); prev.pause(); _audio = prev }
    if (newSrc) startTrack(newSrc)
    else if (prev) { prev.removeAttribute('src'); _audio = null }
  }
}

/**
 * Hook: call with the desired src (or null for silence).
 * Switching src triggers a crossfade. Passing null fades out.
 * The last mounted component wins — unmounting does NOT stop music
 * (intentional: music survives component transitions).
 */
export function useGameAudio(src: string | null) {
  useEffect(() => {
    switchTo(src)
    // No cleanup on unmount — music persists across component changes.
    // Silence is explicit: pass null.
  }, [src])
}

/** Hard stop — call on full app teardown if needed */
export function stopGameAudio() {
  stopInterval()
  rememberPosition(_audio, _src)
  if (_audio) { _audio.pause(); _audio.src = ''; _audio = null }
  _src = null
}

/**
 * Force-start a track immediately (ignores same-src guard).
 * Use this for the first play triggered by a direct user interaction,
 * bypassing the browser autoplay block.
 */
export function playTrack(src: string) {
  stopInterval()
  if (_audio) { _audio.pause() }
  _src = null       // reset guard so switchTo doesn't short-circuit
  switchTo(src)
}


export function isGameMuted() {
  return _muted
}

export function setGameMuted(muted: boolean) {
  _muted = muted
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0')
  }
  if (_audio) _audio.muted = muted
  overlayAudios.forEach((audio) => { audio.muted = muted })
  muteListeners.forEach((listener) => listener(muted))
}

export function toggleGameMuted() {
  setGameMuted(!_muted)
}

export function useGameMuted() {
  const [muted, setMuted] = useState(_muted)

  useEffect(() => {
    muteListeners.add(setMuted)
    return () => { muteListeners.delete(setMuted) }
  }, [])

  return muted
}


export type GameSoundHandle = { stop: () => void }

export function playGameSound(src: string, options: { volume?: number; loop?: boolean } = {}): GameSoundHandle | null {
  if (_muted) return null
  const audio = new Audio(src)
  audio.volume = options.volume ?? 1
  audio.loop = options.loop ?? false
  audio.muted = _muted
  overlayAudios.add(audio)

  const cleanup = () => {
    overlayAudios.delete(audio)
    audio.removeEventListener('ended', cleanup)
    audio.removeEventListener('error', cleanup)
  }

  audio.addEventListener('ended', cleanup)
  audio.addEventListener('error', cleanup)
  audio.play().catch(cleanup)

  return {
    stop: () => {
      cleanup()
      audio.pause()
      audio.src = ''
    },
  }
}
