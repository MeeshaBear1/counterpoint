// Deterministic music engine. Given a Score (from the LLM or the heuristic),
// it renders the SAME notes every time — the LLM only labels structure, all
// composition lives here. Runs against either the live Transport or an offline
// Transport (for WAV export), so the export is bit-identical to playback.
import * as Tone from 'tone'
import type { Score, ScoreEvent } from './score'

export interface Palette {
  id: string
  label: string
  // one voice factory per speaker slot; created fresh per audio context
  make: (i: number) => Tone.PolySynth
}

// Speaker colours (index → hue), used by both engine visuals and the UI legend.
export const SPEAKER_COLORS = ['#ff5c8a', '#4dd0e1', '#ffd166', '#9d7bff', '#5ce1a0', '#ff9f5c']

const majorEnv = { attack: 0.008, decay: 0.3, sustain: 0.25, release: 1.2 }
const padEnv = { attack: 0.6, decay: 0.4, sustain: 0.7, release: 2.4 }

function poly(opts: { oscillator: any; envelope: any; volume: number }): Tone.PolySynth {
  const p = new Tone.PolySynth(Tone.Synth)
  p.set({ oscillator: opts.oscillator, envelope: opts.envelope })
  p.volume.value = opts.volume
  return p
}

export const PALETTES: Palette[] = [
  {
    id: 'chamber',
    label: 'Chamber — piano & cello',
    make: (i) =>
      i % 2 === 0
        ? poly({ oscillator: { type: 'triangle' }, envelope: majorEnv, volume: -8 }) // piano-ish
        : poly({ oscillator: { type: 'sawtooth' }, envelope: { ...majorEnv, attack: 0.06, release: 1.6 }, volume: -12 }), // cello-ish
  },
  {
    id: 'night',
    label: 'Night — synth pads',
    make: (i) =>
      poly({
        oscillator: { type: i % 2 === 0 ? 'fatsawtooth' : 'fatsine', count: 3, spread: 30 } as any,
        envelope: padEnv,
        volume: -14,
      }),
  },
  {
    id: 'glass',
    label: 'Glass — bells & sine',
    make: (i) =>
      poly({
        oscillator: { type: i % 2 === 0 ? 'sine' : 'triangle' },
        envelope: { attack: 0.002, decay: 1.4, sustain: 0.02, release: 1.6 },
        volume: -9,
      }),
  },
]

// --- music theory ---------------------------------------------------------
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
// speaker key centres: closely related keys (C, G, F, D) so voices are consonant
// when they cooperate; dissonance is introduced per-event, not per-speaker.
const ROOTS = [0, 7, 5, 2, 9, 4]
const BASE_MIDI = 48 // C3

// six melodic motifs, as scale-degree contours
const MOTIFS = [
  [0, 2, 4, 2],
  [0, -1, -3, -1],
  [0, 3, 1, 4],
  [4, 2, 0],
  [0, 1, 2, 4],
  [0, -2, -3, 0],
]

function degToMidi(root: number, deg: number): number {
  const oct = Math.floor(deg / 7)
  const idx = ((deg % 7) + 7) % 7
  return BASE_MIDI + root + oct * 12 + MAJOR[idx]
}

// A phrase = a list of chords (each an array of midi notes) for one event.
function phrase(ev: ScoreEvent, speakerIndex: number): number[][] {
  const root = ROOTS[speakerIndex % ROOTS.length]
  const motif = MOTIFS[((ev.motifRef % MOTIFS.length) + MOTIFS.length) % MOTIFS.length]
  const oct = ev.kind === 'interruption' ? 12 : 0 // interruptions pierce an octave up
  const mk = (deg: number, extra: number[] = []) => [degToMidi(root, deg) + oct, ...extra.map((e) => degToMidi(root, deg) + oct + e)]

  switch (ev.kind) {
    case 'question':
      // rising, ends unresolved (on the 2nd/leading tone, not the tonic)
      return [mk(0), mk(2), mk(4), mk(6), mk(7)]
    case 'answer':
      // start high, descend and RESOLVE to the tonic
      return [mk(4), mk(3), mk(1), mk(0)]
    case 'agreement':
      // develop the prior voice's motif, harmonised in thirds/sixths — consonant
      return motif.map((d) => mk(d, [2, 4]))
    case 'challenge':
      // the melody clashed with a tritone (+6 semitones) — dissonant by design
      return motif.map((d) => [degToMidi(root, d), degToMidi(root, d) + 6])
    case 'interruption':
      return [mk(0), mk(1)]
    default: // statement — motif that lands home on the tonic
      return [...motif.map((d) => mk(d)), mk(0)]
  }
}

const midiToFreq = (m: number) => Tone.Frequency(m, 'midi').toFrequency()

// --- tempo/dynamics arc ---------------------------------------------------
// A monotonic beat→seconds clock whose local tempo rises with the emotional
// temperature of the moment, so a heated stretch literally speeds up. Built
// deterministically so live playback and offline export share timing exactly.
function intensityAtBeat(score: Score, beat: number): number {
  let cur = 0.4
  for (const e of score.events) {
    if (e.startBeat <= beat) cur = e.intensity
    else break
  }
  return cur
}

function makeClock(score: Score, baseBpm: number): (beat: number) => number {
  const step = 0.25
  const beats = [0]
  const times = [0]
  let t = 0
  for (let b = step; b <= score.totalBeats + 2; b += step) {
    const bpm = baseBpm * (0.85 + 0.5 * intensityAtBeat(score, b - step / 2))
    t += (60 / bpm) * step
    beats.push(b)
    times.push(t)
  }
  return (beat: number) => {
    if (beat <= 0) return 0
    let i = Math.min(beats.length - 1, Math.floor(beat / step))
    if (i >= beats.length - 1) return times[times.length - 1]
    const f = (beat - beats[i]) / step
    return times[i] + f * (times[i + 1] - times[i])
  }
}

export interface RenderHooks {
  onNote?: (speakerIndex: number, midi: number, time: number) => void
  onTurn?: (turn: number) => void
}

// Schedule the whole score onto a transport. Returns the end time in seconds.
export function scheduleScore(
  transport: ReturnType<typeof Tone.getTransport>,
  score: Score,
  voices: Tone.PolySynth[],
  baseBpm: number,
  hooks: RenderHooks = {},
): number {
  const clock = makeClock(score, baseBpm)
  const draw = Tone.getDraw()

  for (const ev of score.events) {
    const si = Math.max(0, score.speakers.indexOf(ev.speaker))
    const voice = voices[si % voices.length]
    const chords = phrase(ev, si)
    const vel = Math.max(0.15, Math.min(1, 0.25 + ev.intensity * 0.65))

    chords.forEach((chord, i) => {
      const nb0 = ev.startBeat + (i / chords.length) * ev.durationBeats
      const nb1 = ev.startBeat + ((i + 1) / chords.length) * ev.durationBeats
      const t0 = clock(nb0)
      const dur = Math.max(0.08, (clock(nb1) - t0) * 0.92)
      const freqs = chord.map(midiToFreq)
      transport.scheduleOnce((time) => {
        voice.triggerAttackRelease(freqs, dur, time, vel)
        if (hooks.onNote) draw.schedule(() => hooks.onNote!(si, chord[0], time), time)
      }, t0)
    })

    if (hooks.onTurn) {
      const tt = clock(ev.startBeat)
      transport.scheduleOnce((time) => draw.schedule(() => hooks.onTurn!(ev.turn), time), tt)
    }
  }
  return clock(score.totalBeats) + 2
}

// --- live player ----------------------------------------------------------
export class Player {
  private voices: Tone.PolySynth[] = []
  private chain: Tone.ToneAudioNode[] = []
  private paletteId: string

  constructor(paletteId: string) {
    this.paletteId = paletteId
    this.build()
  }

  private build() {
    this.dispose()
    const palette = PALETTES.find((p) => p.id === this.paletteId) ?? PALETTES[0]
    const reverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 2600, wet: 0.22 })
    const limiter = new Tone.Limiter(-2)
    reverb.connect(limiter)
    limiter.toDestination()
    this.chain = [reverb, limiter]
    // up to 6 distinct voices; UI keeps speakers to a sane count
    this.voices = Array.from({ length: 6 }, (_, i) => palette.make(i).connect(reverb))
  }

  setPalette(id: string) {
    if (id === this.paletteId) return
    // stop first: scheduled events hold the old voices, which build() disposes
    this.stop()
    this.paletteId = id
    this.build()
  }

  async play(score: Score, bpm: number, hooks: RenderHooks & { onEnd?: () => void }) {
    await Tone.start()
    this.stop()
    const transport = Tone.getTransport()
    transport.bpm.value = bpm
    const end = scheduleScore(transport, score, this.voices, bpm, hooks)
    if (hooks.onEnd) transport.scheduleOnce(() => Tone.getDraw().schedule(() => hooks.onEnd!(), 0), end)
    transport.start()
  }

  stop() {
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.position = 0
    this.voices.forEach((v) => v.releaseAll())
  }

  private dispose() {
    this.voices.forEach((v) => v.dispose())
    this.chain.forEach((n) => n.dispose())
    this.voices = []
    this.chain = []
  }
}

// --- WAV export (deterministic, offline) ---------------------------------
export async function renderWav(score: Score, bpm: number, paletteId: string): Promise<Blob> {
  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]
  // measure duration with a throwaway clock at the same tempo
  const duration = makeClock(score, bpm)(score.totalBeats) + 2.5

  const buffer = await Tone.Offline(({ transport }) => {
    const reverb = new Tone.Freeverb({ roomSize: 0.7, dampening: 2600, wet: 0.22 })
    const limiter = new Tone.Limiter(-2)
    reverb.connect(limiter)
    limiter.toDestination()
    const voices = Array.from({ length: 6 }, (_, i) => palette.make(i).connect(reverb))
    transport.bpm.value = bpm
    scheduleScore(transport, score, voices, bpm)
    transport.start()
  }, duration)

  return encodeWav(buffer.get() as AudioBuffer)
}

// 16-bit PCM WAV encoder.
function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels
  const len = buffer.length
  const sampleRate = buffer.sampleRate
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const dataSize = len * blockAlign
  const ab = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels = Array.from({ length: numCh }, (_, c) => buffer.getChannelData(c))
  let offset = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}
