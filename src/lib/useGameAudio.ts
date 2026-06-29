import { useEffect, useState } from 'react'

/**
 * Global singleton audio controller.
 * Any component calling useGameAudio(src) takes ownership of playback.
 * Only ONE track plays at a time — no overlap, smooth crossfade.
 */

const FADE_OUT_MS = 220
const FADE_IN_MS = 400
const FADE_STEPS = 24
const MUSIC_VOLUME = 0.22
const GAME_SOUND_VOLUME_MULTIPLIER = 1.18
const AMBIENCE_SOUND_VOLUME_MULTIPLIER = 0.18

let _audio: HTMLAudioElement | null = null
let _src: string | null = null
let _interval: number | null = null
let _musicVolumeMultiplier = 1
const MUTE_STORAGE_KEY = 'brakup:audio-muted'
const VOLUME_STORAGE_KEY = 'brakup:audio-volume'
let _muted = typeof window !== 'undefined' && window.localStorage.getItem(MUTE_STORAGE_KEY) === '1'
let _volume = typeof window !== 'undefined' ? Number(window.localStorage.getItem(VOLUME_STORAGE_KEY) ?? '0.8') : 0.8
if (!Number.isFinite(_volume)) _volume = 0.8
_volume = Math.max(0, Math.min(1, _volume))
const muteListeners = new Set<(muted: boolean) => void>()
const volumeListeners = new Set<(volume: number) => void>()
const overlayAudios = new Set<HTMLAudioElement>()
const audioBuffers = new Map<string, Promise<AudioBuffer>>()
let _ctx: AudioContext | null = null
let _masterGain: GainNode | null = null
let unlockListenersInstalled = false

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

function targetMusicVolume() {
  return MUSIC_VOLUME * _musicVolumeMultiplier * _volume
}

function targetOverlayVolume(volume: number, kind: 'sfx' | 'ambience') {
  const multiplier = kind === 'ambience' ? AMBIENCE_SOUND_VOLUME_MULTIPLIER : GAME_SOUND_VOLUME_MULTIPLIER
  return Math.min(1, Math.max(0, volume * multiplier * _volume))
}

function audioContextCtor() {
  if (typeof window === 'undefined') return null
  const audioWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null
}

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!_ctx) {
    const Ctor = audioContextCtor()
    if (!Ctor) return null
    _ctx = new Ctor()
    _masterGain = _ctx.createGain()
    _masterGain.gain.value = _muted ? 0 : _volume
    _masterGain.connect(_ctx.destination)
  }
  if (_ctx.state === 'suspended') void _ctx.resume()
  return _ctx
}

export function getSharedAudioDestination(): AudioNode | null {
  const c = getSharedAudioContext()
  if (!c) return null
  if (!_masterGain) {
    _masterGain = c.createGain()
    _masterGain.connect(c.destination)
  }
  _masterGain.gain.value = _muted ? 0 : _volume
  return _masterGain
}

export function unlockGameAudio() {
  const c = getSharedAudioContext()
  if (!c) return false
  if (c.state === 'suspended') void c.resume()

  const destination = getSharedAudioDestination()
  if (destination) {
    const buffer = c.createBuffer(1, 1, c.sampleRate)
    const source = c.createBufferSource()
    source.buffer = buffer
    source.connect(destination)
    try { source.start(0) } catch { /* already unlocked or blocked */ }
  }

  if (_audio && _src && _audio.paused && !_muted) {
    _audio.play().catch(() => undefined)
  }
  return true
}

function installGestureUnlockListeners() {
  if (typeof window === 'undefined' || unlockListenersInstalled) return
  unlockListenersInstalled = true
  const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'keydown', 'click']
  const unlock = () => {
    unlockGameAudio()
    if (!_ctx || _ctx.state === 'running') {
      events.forEach((eventName) => window.removeEventListener(eventName, unlock, true))
      unlockListenersInstalled = false
    }
  }
  events.forEach((eventName) => window.addEventListener(eventName, unlock, { capture: true, passive: true }))
}

async function loadAudioBuffer(src: string) {
  const c = getSharedAudioContext()
  if (!c) throw new Error('Web Audio unavailable')
  const existing = audioBuffers.get(src)
  if (existing) return existing
  const pending = fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error(`Audio unavailable: ${src}`)
      return response.arrayBuffer()
    })
    .then((buffer) => c.decodeAudioData(buffer.slice(0)))
  audioBuffers.set(src, pending)
  return pending
}

function startTrack(src: string) {
  installGestureUnlockListeners()
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
    audio.volume = v * targetMusicVolume()
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
    installGestureUnlockListeners()
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
  unlockGameAudio()
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
  if (_masterGain) _masterGain.gain.value = muted ? 0 : _volume
  muteListeners.forEach((listener) => listener(muted))
}

export function getGameAudioVolume() {
  return _volume
}

export function setGameAudioVolume(volume: number) {
  _volume = Math.max(0, Math.min(1, volume))
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(_volume))
  }
  if (_audio && !_audio.paused) _audio.volume = targetMusicVolume()
  overlayAudios.forEach((audio) => {
    const rawVolume = Number(audio.dataset.rawVolume ?? '1')
    const kind = audio.dataset.kind === 'ambience' ? 'ambience' : 'sfx'
    audio.volume = targetOverlayVolume(rawVolume, kind)
  })
  if (_masterGain) _masterGain.gain.value = _muted ? 0 : _volume
  volumeListeners.forEach((listener) => listener(_volume))
}

export function setGameMusicVolumeMultiplier(multiplier: number) {
  _musicVolumeMultiplier = Math.max(0, Math.min(1, multiplier))
  if (_audio && !_audio.paused) _audio.volume = targetMusicVolume()
}

export function toggleGameMuted() {
  setGameMuted(!_muted)
}

export function useGameMuted() {
  const [muted, setMuted] = useState(_muted)

  useEffect(() => {
    installGestureUnlockListeners()
    muteListeners.add(setMuted)
    return () => { muteListeners.delete(setMuted) }
  }, [])

  return muted
}

export function useGameAudioVolume() {
  const [volume, setVolume] = useState(_volume)

  useEffect(() => {
    installGestureUnlockListeners()
    volumeListeners.add(setVolume)
    return () => { volumeListeners.delete(setVolume) }
  }, [])

  return volume
}

export type GameSoundHandle = { stop: () => void }

export function playGameSound(
  src: string,
  options: { volume?: number; loop?: boolean; kind?: 'sfx' | 'ambience' } = {},
): GameSoundHandle | null {
  if (_muted) return null
  const kind = options.kind ?? (options.loop ? 'ambience' : 'sfx')
  const rawVolume = options.volume ?? 1
  const c = getSharedAudioContext()
  const destination = getSharedAudioDestination()

  if (c && destination) {
    let stopped = false
    let source: AudioBufferSourceNode | null = null
    let gain: GainNode | null = null

    unlockGameAudio()
    loadAudioBuffer(src).then((buffer) => {
      if (stopped || _muted) return
      source = c.createBufferSource()
      gain = c.createGain()
      source.buffer = buffer
      source.loop = options.loop ?? false
      gain.gain.value = Math.min(1, Math.max(0, rawVolume * (kind === 'ambience' ? AMBIENCE_SOUND_VOLUME_MULTIPLIER : GAME_SOUND_VOLUME_MULTIPLIER)))
      source.connect(gain)
      gain.connect(destination)
      source.addEventListener('ended', () => {
        source?.disconnect()
        gain?.disconnect()
      }, { once: true })
      source.start(0)
    }).catch(() => undefined)

    return {
      stop: () => {
        stopped = true
        try { source?.stop() } catch { /* already stopped */ }
        source?.disconnect()
        gain?.disconnect()
      },
    }
  }

  const audio = new Audio(src)
  audio.dataset.rawVolume = String(rawVolume)
  audio.dataset.kind = kind
  audio.volume = targetOverlayVolume(rawVolume, kind)
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
  unlockGameAudio()
  audio.play().catch(cleanup)

  return {
    stop: () => {
      cleanup()
      audio.pause()
      audio.src = ''
    },
  }
}
