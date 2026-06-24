import { useEffect } from 'react'

/**
 * Global singleton audio controller.
 * Any component calling useGameAudio(src) takes ownership of playback.
 * Only ONE track plays at a time — no overlap, smooth crossfade.
 */

const FADE_OUT_MS = 220
const FADE_IN_MS = 400
const FADE_STEPS = 24

let _audio: HTMLAudioElement | null = null
let _src: string | null = null
let _interval: number | null = null

function stopInterval() {
  if (_interval !== null) { clearInterval(_interval); _interval = null }
}

function startTrack(src: string) {
  const audio = new Audio(src)
  audio.loop = true
  audio.volume = 0
  _audio = audio
  _src = src
  audio.play().catch(() => undefined)

  let v = 0
  const step = 1 / FADE_STEPS
  _interval = window.setInterval(() => {
    v = Math.min(1, v + step)
    audio.volume = v
    if (v >= 1) stopInterval()
  }, FADE_IN_MS / FADE_STEPS)
}

function switchTo(newSrc: string | null) {
  if (newSrc === _src) return
  stopInterval()

  const prev = _audio
  _src = newSrc

  if (prev && !prev.paused) {
    const startVol = prev.volume
    const step = Math.max(startVol / FADE_STEPS, 0.001)
    _interval = window.setInterval(() => {
      const next = Math.max(0, prev.volume - step)
      prev.volume = next
      if (next <= 0) {
        stopInterval()
        prev.pause()
        prev.src = ''
        _audio = null
        if (newSrc) startTrack(newSrc)
      }
    }, FADE_OUT_MS / FADE_STEPS)
  } else {
    if (prev) { prev.pause(); prev.src = ''; _audio = null }
    if (newSrc) startTrack(newSrc)
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
  if (_audio) { _audio.pause(); _audio.src = ''; _audio = null }
  _src = null       // reset guard so switchTo doesn't short-circuit
  switchTo(src)
}
