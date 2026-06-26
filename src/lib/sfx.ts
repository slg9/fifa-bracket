import { isGameMuted } from './useGameAudio'
/**
 * Synthesized UI sound effects via Web Audio API.
 * No external audio files needed — all sounds are generated programmatically.
 */

let _ctx: AudioContext | null = null

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext()
  if (_ctx.state === 'suspended') void _ctx.resume()
  return _ctx
}

function tone(
  freq: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; freqEnd?: number; delay?: number } = {},
) {
  if (isGameMuted()) return
  const c = ctx()
  const t = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.connect(g); g.connect(c.destination)
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t)
  if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + duration)
  const vol = opts.gain ?? 0.22
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.start(t); osc.stop(t + duration + 0.02)
}

function noise(
  duration: number,
  opts: { filterFreq?: number; filterFreqEnd?: number; gain?: number; delay?: number } = {},
) {
  if (isGameMuted()) return
  const c = ctx()
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
  g.gain.setValueAtTime(opts.gain ?? 0.14, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter); filter.connect(g); g.connect(c.destination)
  src.start(t)
}

export const sfx = {
  /** General button tap */
  click() {
    tone(760, 0.075, { type: 'square', gain: 0.2, freqEnd: 330 })
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
}
