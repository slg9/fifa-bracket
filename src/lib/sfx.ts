import { getSharedAudioContext, getSharedAudioDestination, isGameMuted, unlockGameAudio } from './useGameAudio'
/**
 * Synthesized UI sound effects via Web Audio API.
 * No external audio files needed — all sounds are generated programmatically.
 */

const SFX_GAIN_MULTIPLIER = 1.35

function tone(
  freq: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; freqEnd?: number; delay?: number } = {},
) {
  if (isGameMuted()) return
  unlockGameAudio()
  const c = getSharedAudioContext()
  const destination = getSharedAudioDestination()
  if (!c || !destination) return
  const t = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.connect(g); g.connect(destination)
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t)
  if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + duration)
  const vol = Math.min(0.95, (opts.gain ?? 0.22) * SFX_GAIN_MULTIPLIER)
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.start(t); osc.stop(t + duration + 0.02)
}

function noise(
  duration: number,
  opts: { filterFreq?: number; filterFreqEnd?: number; gain?: number; delay?: number } = {},
) {
  if (isGameMuted()) return
  unlockGameAudio()
  const c = getSharedAudioContext()
  const destination = getSharedAudioDestination()
  if (!c || !destination) return
  const t = c.currentTime + (opts.delay ?? 0)
  const bufSize = Math.ceil(c.sampleRate * duration)
  const buf = c.createBuffer(1, bufSize, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(opts.filterFreq ?? 1200, t)
  if (opts.filterFreqEnd) filter.frequency.exponentialRampToValueAtTime(opts.filterFreqEnd, t + duration)
  const g = c.createGain()
  g.gain.setValueAtTime(Math.min(0.95, (opts.gain ?? 0.14) * SFX_GAIN_MULTIPLIER), t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter); filter.connect(g); g.connect(destination)
  src.start(t)
}

export interface SFX {
  click(): void
  countdownTick(): void
  countdownGo(): void
  defenseShot(): void
  bomb(): void
  kamikaze(): void
  nav(): void
  swipe(): void
  pick(): void
  bracket(): void
  save(): void
  battle(): void
  start(): void
  tab(): void
  goal(): void
  concede(): void
  whistle(): void
  tackle(): void
  lightning(): void
  jump(): void
  gatePass(): void
  slice(): void
  error(): void
}

export const sfx: SFX = {
  /** General button tap */
  click() {
    tone(760, 0.075, { type: 'square', gain: 0.24, freqEnd: 330 })
    tone(1280, 0.045, { type: 'sine', gain: 0.08, delay: 0.018, freqEnd: 860 })
  },

  /** Countdown 3-2-1 */
  countdownTick() {
    tone(760, 0.08, { type: 'square', gain: 0.24, freqEnd: 560 })
    tone(1520, 0.05, { type: 'sine', gain: 0.1, delay: 0.025, freqEnd: 1180 })
  },

  /** Countdown GO */
  countdownGo() {
    noise(0.2, { filterFreq: 1800, filterFreqEnd: 4200, gain: 0.14 })
    tone(520, 0.18, { type: 'triangle', gain: 0.24, freqEnd: 1040 })
    tone(1040, 0.22, { type: 'sine', gain: 0.18, delay: 0.06, freqEnd: 1560 })
  },

  /** Auto defensive shooter kick */
  defenseShot() {
    noise(0.055, { filterFreq: 1800, filterFreqEnd: 700, gain: 0.13 })
    tone(210, 0.07, { type: 'triangle', gain: 0.16, freqEnd: 88 })
    tone(780, 0.045, { type: 'square', gain: 0.08, delay: 0.015, freqEnd: 440 })
  },

  /** Bomb touched in save chaos */
  bomb() {
    noise(0.42, { filterFreq: 2400, filterFreqEnd: 110, gain: 0.36 })
    noise(0.24, { filterFreq: 120, filterFreqEnd: 60, gain: 0.22, delay: 0.03 })
    tone(96, 0.42, { type: 'sawtooth', gain: 0.24, freqEnd: 42 })
    tone(420, 0.16, { type: 'square', gain: 0.14, delay: 0.02, freqEnd: 90 })
  },

  /** Red kamikaze player hit by a shot */
  kamikaze() {
    tone(1320, 0.07, { type: 'square', gain: 0.14 })
    tone(880, 0.08, { type: 'square', gain: 0.14, delay: 0.075 })
    noise(0.34, { filterFreq: 3000, filterFreqEnd: 140, gain: 0.3, delay: 0.12 })
    tone(120, 0.32, { type: 'sawtooth', gain: 0.22, delay: 0.12, freqEnd: 48 })
  },

  /** Arrow / dot navigation */
  nav() {
    tone(700, 0.06, { type: 'sine', gain: 0.24 })
  },

  /** Card thrown off screen */
  swipe() {
    noise(0.2, { filterFreq: 3500, filterFreqEnd: 280, gain: 0.2 })
    tone(200, 0.2, { type: 'triangle', gain: 0.1, freqEnd: 55 })
  },

  /** Team pick confirmed */
  pick() {
    tone(523, 0.18, { type: 'triangle', gain: 0.28 })          // C5
    tone(784, 0.22, { type: 'triangle', gain: 0.22, delay: 0.07 }) // G5
  },

  /** "Bracket" overlay toggle */
  bracket() {
    noise(0.12, { filterFreq: 2200, filterFreqEnd: 760, gain: 0.18 })
    tone(480, 0.12, { type: 'sine', gain: 0.24 })
  },

  /** Save bracket */
  save() {
    const notes = [523, 659, 784, 1046]
    notes.forEach((freq, i) => tone(freq, 0.22, { type: 'triangle', gain: 0.2, delay: i * 0.07 }))
  },

  /** Battle / play a match */
  battle() {
    noise(0.22, { filterFreq: 600, filterFreqEnd: 3200, gain: 0.22 })
    tone(330, 0.28, { type: 'sawtooth', gain: 0.12, freqEnd: 700 })
  },

  /** Big splash JOUER button — epic */
  start() {
    noise(0.55, { filterFreq: 600, filterFreqEnd: 2500, gain: 0.24 })
    tone(261, 0.55, { type: 'triangle', gain: 0.18 })
    tone(523, 0.5,  { type: 'triangle', gain: 0.24, delay: 0.1 })
    tone(784, 0.42, { type: 'sine',     gain: 0.28, delay: 0.22 })
    tone(1046, 0.35,{ type: 'sine',     gain: 0.18, delay: 0.34 })
  },

  /** Tab navigation switch */
  tab() {
    tone(520, 0.08, { type: 'sine', gain: 0.22 })
  },

  /** Crowd roar — goal scored */
  goal() {
    noise(1.4, { filterFreq: 600, filterFreqEnd: 2400, gain: 0.28 })
    noise(1.0, { filterFreq: 200, filterFreqEnd: 800, gain: 0.18, delay: 0.06 })
    tone(392, 0.22, { type: 'triangle', gain: 0.22 })
    tone(523, 0.24, { type: 'triangle', gain: 0.26, delay: 0.1 })
    tone(659, 0.28, { type: 'triangle', gain: 0.3, delay: 0.22 })
    tone(784, 0.4,  { type: 'sine',     gain: 0.24, delay: 0.36 })
    tone(1046,0.35, { type: 'sine',     gain: 0.16, delay: 0.5 })
  },

  /** Crowd groan — goal conceded */
  concede() {
    noise(1.0, { filterFreq: 500, filterFreqEnd: 120, gain: 0.22 })
    tone(330, 0.4, { type: 'sawtooth', gain: 0.14, freqEnd: 220 })
    tone(220, 0.4, { type: 'sawtooth', gain: 0.12, delay: 0.32, freqEnd: 146 })
    tone(146, 0.3, { type: 'sawtooth', gain: 0.08, delay: 0.6,  freqEnd: 110 })
  },

  /** Referee whistle for kick start */
  whistle() {
    noise(0.16, { filterFreq: 2600, filterFreqEnd: 3400, gain: 0.08 })
    tone(1960, 0.28, { type: 'square', gain: 0.14, freqEnd: 1760 })
    tone(2380, 0.18, { type: 'sine', gain: 0.11, delay: 0.06, freqEnd: 2100 })
  },

  /** Defensive tackle shockwave */
  tackle() {
    noise(0.2, { filterFreq: 1200, filterFreqEnd: 120, gain: 0.3 })
    noise(0.12, { filterFreq: 2600, filterFreqEnd: 500, gain: 0.12, delay: 0.03 })
    tone(150, 0.22, { type: 'sawtooth', gain: 0.22, freqEnd: 60 })
    tone(55, 0.16, { type: 'triangle', gain: 0.16, delay: 0.035, freqEnd: 35 })
  },

  /** Lightning special attack */
  lightning() {
    noise(0.28, { filterFreq: 5600, filterFreqEnd: 900, gain: 0.26 })
    noise(0.14, { filterFreq: 1800, filterFreqEnd: 320, gain: 0.16, delay: 0.1 })
    tone(880, 0.12, { type: 'square', gain: 0.2, freqEnd: 1760 })
    tone(1760, 0.2, { type: 'sawtooth', gain: 0.16, delay: 0.05, freqEnd: 440 })
    tone(2600, 0.09, { type: 'square', gain: 0.12, delay: 0.13, freqEnd: 1200 })
  },

  /** Dribble jump */
  jump() {
    tone(420, 0.11, { type: 'triangle', gain: 0.18, freqEnd: 760 })
    noise(0.08, { filterFreq: 2400, gain: 0.08, delay: 0.02 })
  },

  /** Clean pass through a dribble gate */
  gatePass() {
    tone(620, 0.09, { type: 'triangle', gain: 0.16, freqEnd: 920 })
    tone(930, 0.11, { type: 'sine', gain: 0.14, delay: 0.045, freqEnd: 1240 })
    noise(0.08, { filterFreq: 3200, filterFreqEnd: 1800, gain: 0.08 })
  },

  /** Ball sliced / swiped */
  slice() {
    noise(0.12, { filterFreq: 3600, filterFreqEnd: 900, gain: 0.18 })
    tone(980, 0.08, { type: 'triangle', gain: 0.12, freqEnd: 520 })
  },

  /** Error / invalid action */
  error() {
    tone(200, 0.12, { type: 'sawtooth', gain: 0.18, freqEnd: 80 })
    tone(100, 0.1, { type: 'square', gain: 0.14, delay: 0.05, freqEnd: 50 })
  }
}
