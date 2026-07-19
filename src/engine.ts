// Tone.js renderer. All composition lives in compose.ts (pure); this file only
// builds instruments and schedules the plan — on the live Transport or an
// offline one, so the WAV export is identical to playback.
import * as Tone from 'tone'
import { makeClock, plan, type Plan } from './compose'
import { makeSampler, preload } from './samples'
import type { Score } from './score'

// Speaker colours (index → hue), used by both engine visuals and the UI legend.
export const SPEAKER_COLORS = ['#ff5c8a', '#4dd0e1', '#ffd166', '#9d7bff', '#5ce1a0', '#ff9f5c']

type Voice = Tone.Sampler | Tone.PolySynth

interface VoiceSpec {
  instrument?: string // sampled
  synth?: () => Tone.PolySynth // synthesized fallback/palette
  base: number // melodic register (midi)
  volume: number
  release?: number
}

export interface Palette {
  id: string
  label: string
  melody: VoiceSpec[]
  bass: VoiceSpec
  pad: VoiceSpec
  swing: number
}

function softSynth(type: OscillatorType, volume: number, envelope: Partial<Tone.EnvelopeOptions> = {}): () => Tone.PolySynth {
  return () => {
    const p = new Tone.PolySynth(Tone.Synth)
    p.set({ oscillator: { type } as any, envelope: { attack: 0.4, decay: 0.3, sustain: 0.6, release: 2.2, ...envelope } })
    p.volume.value = volume
    return p
  }
}

export const PALETTES: Palette[] = [
  {
    id: 'chamber',
    label: 'Chamber — piano, cello, violin',
    melody: [
      { instrument: 'piano', base: 60, volume: -6 },
      { instrument: 'cello', base: 48, volume: -5 },
      { instrument: 'violin', base: 72, volume: -9 },
      { instrument: 'flute', base: 72, volume: -10 },
      { instrument: 'harp', base: 60, volume: -6 },
      { instrument: 'piano', base: 72, volume: -8 },
    ],
    bass: { instrument: 'cello', base: 36, volume: -7, release: 1.6 },
    pad: { instrument: 'harp', base: 60, volume: -14 },
    swing: 0,
  },
  {
    id: 'jazz',
    label: 'Jazz trio — piano, sax, upright bass',
    melody: [
      { instrument: 'piano', base: 60, volume: -6 },
      { instrument: 'saxophone', base: 60, volume: -10 },
      { instrument: 'piano', base: 72, volume: -8 },
      { instrument: 'saxophone', base: 67, volume: -11 },
      { instrument: 'piano', base: 48, volume: -7 },
      { instrument: 'saxophone', base: 55, volume: -11 },
    ],
    bass: { instrument: 'contrabass', base: 36, volume: -4, release: 1.2 },
    pad: { instrument: 'piano', base: 55, volume: -16 },
    swing: 0.6,
  },
  {
    id: 'night',
    label: 'Night — synth pads (no samples)',
    melody: [
      { synth: softSynth('triangle', -10, { attack: 0.05, release: 1.8 }), base: 60, volume: -10 },
      { synth: softSynth('sine', -9, { attack: 0.08, release: 2 }), base: 48, volume: -9 },
      { synth: softSynth('triangle', -12, { attack: 0.05, release: 1.8 }), base: 72, volume: -12 },
      { synth: softSynth('sine', -12, { attack: 0.08, release: 2 }), base: 67, volume: -12 },
      { synth: softSynth('triangle', -11, { attack: 0.05, release: 1.8 }), base: 55, volume: -11 },
      { synth: softSynth('sine', -12, { attack: 0.08, release: 2 }), base: 64, volume: -12 },
    ],
    bass: { synth: softSynth('sine', -6, { attack: 0.03, release: 1.5 }), base: 36, volume: -6 },
    pad: { synth: softSynth('sine', -18, { attack: 0.6, release: 3 }), base: 60, volume: -18 },
    swing: 0,
  },
]

function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

function sampledInstruments(p: Palette): string[] {
  const names = [...p.melody, p.bass, p.pad].map((v) => v.instrument).filter(Boolean) as string[]
  return [...new Set(names)]
}

function makeVoice(spec: VoiceSpec): Voice {
  if (spec.instrument) return makeSampler(spec.instrument, { volume: spec.volume, release: spec.release ?? 1.4 })
  return spec.synth!()
}

interface Voices {
  melody: Voice[]
  bass: Voice
  pad: Voice
  all: Voice[]
}

function buildVoices(palette: Palette, destination: Tone.ToneAudioNode): Voices {
  const melody = palette.melody.map((s) => makeVoice(s).connect(destination))
  const bass = makeVoice(palette.bass).connect(destination)
  const pad = makeVoice(palette.pad).connect(destination)
  return { melody, bass, pad, all: [...melody, bass, pad] }
}

const midiToFreq = (m: number) => Tone.Frequency(m, 'midi').toFrequency()

export interface RenderHooks {
  onNote?: (speakerIndex: number, midi: number, time: number) => void
  onTurn?: (turn: number) => void
}

export function planFor(score: Score, paletteId: string): Plan {
  const p = paletteById(paletteId)
  return plan(score, {
    speakerBases: p.melody.map((m) => m.base),
    bassBase: p.bass.base,
    padBase: p.pad.base,
    swing: p.swing,
  })
}

// Schedule a plan onto a transport. Returns the end time in seconds.
export function schedulePlan(
  transport: ReturnType<typeof Tone.getTransport>,
  score: Score,
  planned: Plan,
  voices: Voices,
  baseBpm: number,
  hooks: RenderHooks = {},
): number {
  const clock = makeClock(score, baseBpm, planned.endBeat)
  const draw = Tone.getDraw()

  for (const n of planned.notes) {
    const voice = n.voice === 'melody' ? voices.melody[n.speaker % voices.melody.length] : n.voice === 'bass' ? voices.bass : voices.pad
    const t0 = clock(n.startBeat)
    const t1 = clock(n.startBeat + n.durBeats)
    const dur = Math.max(0.07, (t1 - t0) * (n.staccato ? 0.45 : 0.92))
    const freqs = n.midis.map(midiToFreq)
    const isMelody = n.voice === 'melody'
    transport.scheduleOnce((time) => {
      voice.triggerAttackRelease(freqs, dur, time, n.vel)
      if (isMelody && hooks.onNote) draw.schedule(() => hooks.onNote!(n.speaker, n.midis[0], time), time)
    }, t0)
  }

  if (hooks.onTurn) {
    for (const m of planned.turnMarks) {
      transport.scheduleOnce((time) => draw.schedule(() => hooks.onTurn!(m.turn), time), clock(m.startBeat))
    }
  }
  return clock(planned.endBeat) + 2
}

function makeSpace(): { input: Tone.ToneAudioNode; nodes: Tone.ToneAudioNode[]; ready: Promise<void> } {
  const reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.02, wet: 0.3 })
  const limiter = new Tone.Limiter(-2)
  reverb.connect(limiter)
  limiter.toDestination()
  return { input: reverb, nodes: [reverb, limiter], ready: reverb.ready.then(() => undefined) }
}

// --- live player ----------------------------------------------------------
export class Player {
  private voices: Voices | null = null
  private chain: Tone.ToneAudioNode[] = []
  private paletteId: string
  private builtFor = ''
  private gen = 0 // bumped by stop(); play() aborts if it changed during preload

  constructor(paletteId: string) {
    this.paletteId = paletteId
  }

  setPalette(id: string) {
    if (id === this.paletteId) return
    // stop first: scheduled events hold the old voices, which we dispose
    this.stop()
    this.paletteId = id
  }

  // Load samples for the palette; on failure (offline, missing assets) fall
  // back to the synth palette so the app always plays.
  private async ensureVoices(): Promise<void> {
    let palette = paletteById(this.paletteId)
    try {
      await preload(sampledInstruments(palette))
    } catch {
      palette = paletteById('night')
    }
    if (this.voices && this.builtFor === palette.id) return
    this.disposeVoices()
    const space = makeSpace()
    await space.ready
    this.chain = space.nodes
    this.voices = buildVoices(palette, space.input)
    this.builtFor = palette.id
  }

  async play(score: Score, bpm: number, hooks: RenderHooks & { onEnd?: () => void }) {
    await Tone.start()
    this.stop()
    const gen = this.gen
    await this.ensureVoices()
    if (gen !== this.gen) return // user hit stop while samples loaded
    const transport = Tone.getTransport()
    const planned = planFor(score, this.builtFor)
    const end = schedulePlan(transport, score, planned, this.voices!, bpm, hooks)
    if (hooks.onEnd) transport.scheduleOnce(() => Tone.getDraw().schedule(() => hooks.onEnd!(), 0), end)
    transport.start()
  }

  stop() {
    this.gen++
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    transport.position = 0
    this.voices?.all.forEach((v) => v.releaseAll())
  }

  private disposeVoices() {
    this.voices?.all.forEach((v) => v.dispose())
    this.chain.forEach((n) => n.dispose())
    this.voices = null
    this.chain = []
  }
}

// --- WAV export (deterministic, offline) ---------------------------------
export async function renderWav(score: Score, bpm: number, paletteId: string): Promise<Blob> {
  let palette = paletteById(paletteId)
  try {
    await preload(sampledInstruments(palette))
  } catch {
    palette = paletteById('night')
  }
  const planned = planFor(score, palette.id)
  const duration = makeClock(score, bpm, planned.endBeat)(planned.endBeat) + 2.5

  const buffer = await Tone.Offline(async ({ transport }) => {
    const space = makeSpace()
    await space.ready
    const voices = buildVoices(palette, space.input)
    transport.bpm.value = bpm
    schedulePlan(transport, score, planned, voices, bpm)
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
