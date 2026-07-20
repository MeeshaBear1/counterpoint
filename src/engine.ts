// Tone.js renderer. All composition lives in compose.ts (pure); this file only
// builds instruments and schedules the plan — on the live Transport or an
// offline one, so the WAV export is identical to playback.
import * as Tone from 'tone'
import { makeClock, plan, type BassStyle, type CompStyle, type DrumStyle, type Plan } from './compose'
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
  defaultBpm: number
  bassStyle: BassStyle
  compStyle: CompStyle
  drums: DrumStyle
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
    id: 'orchestra',
    label: 'Orchestra — baroque grandeur',
    melody: [
      { instrument: 'violin', base: 72, volume: -8 },
      { instrument: 'cello', base: 48, volume: -5 },
      { instrument: 'flute', base: 72, volume: -10 },
      { instrument: 'french-horn', base: 55, volume: -8 },
      { instrument: 'bassoon', base: 48, volume: -7 },
      { instrument: 'trumpet', base: 67, volume: -10 },
    ],
    bass: { instrument: 'cello', base: 36, volume: -6, release: 1.4 },
    pad: { instrument: 'organ', base: 55, volume: -16 },
    swing: 0,
    defaultBpm: 100,
    bassStyle: 'walking',
    compStyle: 'arp',
    drums: null,
  },
  {
    id: 'bigband',
    label: 'Big band — swing',
    melody: [
      { instrument: 'trumpet', base: 67, volume: -9 },
      { instrument: 'saxophone', base: 60, volume: -9 },
      { instrument: 'trombone', base: 48, volume: -8 },
      { instrument: 'clarinet', base: 62, volume: -10 },
      { instrument: 'trumpet', base: 72, volume: -10 },
      { instrument: 'saxophone', base: 55, volume: -10 },
    ],
    bass: { instrument: 'contrabass', base: 36, volume: -4, release: 1 },
    pad: { instrument: 'piano', base: 55, volume: -13 },
    swing: 0.6,
    defaultBpm: 116,
    bassStyle: 'walking',
    compStyle: 'stabs',
    drums: 'swing',
  },
  {
    id: 'hotjazz',
    label: 'Hot jazz — trumpet & clarinet',
    melody: [
      { instrument: 'trumpet', base: 67, volume: -8 },
      { instrument: 'clarinet', base: 62, volume: -9 },
      { instrument: 'trombone', base: 48, volume: -8 },
      { instrument: 'trumpet', base: 72, volume: -9 },
      { instrument: 'clarinet', base: 67, volume: -10 },
      { instrument: 'trombone', base: 53, volume: -9 },
    ],
    bass: { instrument: 'tuba', base: 33, volume: -5, release: 0.8 },
    pad: { instrument: 'guitar-acoustic', base: 52, volume: -13 },
    swing: 0.55,
    defaultBpm: 92,
    bassStyle: 'rootFifth',
    compStyle: 'strum',
    drums: 'swing',
  },
  {
    id: 'boombap',
    label: '90s hip-hop — boom bap',
    melody: [
      { instrument: 'piano', base: 60, volume: -6 },
      { instrument: 'organ', base: 55, volume: -10 },
      { instrument: 'guitar-electric', base: 60, volume: -10 },
      { instrument: 'piano', base: 72, volume: -8 },
      { instrument: 'organ', base: 48, volume: -11 },
      { instrument: 'guitar-electric', base: 67, volume: -11 },
    ],
    bass: { instrument: 'bass-electric', base: 31, volume: -3, release: 0.6 },
    pad: { instrument: 'organ', base: 48, volume: -17 },
    swing: 0.2,
    defaultBpm: 88,
    bassStyle: 'boom',
    compStyle: 'held',
    drums: 'boombap',
  },
  {
    id: 'country',
    label: 'Modern country',
    melody: [
      { instrument: 'guitar-acoustic', base: 60, volume: -6 },
      { instrument: 'guitar-electric', base: 64, volume: -9 },
      { instrument: 'violin', base: 72, volume: -10 },
      { instrument: 'piano', base: 60, volume: -8 },
      { instrument: 'guitar-acoustic', base: 67, volume: -8 },
      { instrument: 'guitar-electric', base: 55, volume: -10 },
    ],
    bass: { instrument: 'bass-electric', base: 36, volume: -4, release: 0.8 },
    pad: { instrument: 'guitar-acoustic', base: 48, volume: -13 },
    swing: 0.1,
    defaultBpm: 100,
    bassStyle: 'rootFifth',
    compStyle: 'strum',
    drums: 'backbeat',
  },
  {
    id: 'popanthem',
    label: 'Pop anthem',
    melody: [
      { instrument: 'piano', base: 72, volume: -6 },
      { instrument: 'guitar-acoustic', base: 60, volume: -7 },
      { instrument: 'piano', base: 60, volume: -7 },
      { instrument: 'guitar-electric', base: 64, volume: -10 },
      { instrument: 'piano', base: 48, volume: -8 },
      { instrument: 'guitar-acoustic', base: 67, volume: -9 },
    ],
    bass: { instrument: 'bass-electric', base: 36, volume: -4, release: 0.8 },
    pad: { instrument: 'piano', base: 55, volume: -14 },
    swing: 0,
    defaultBpm: 108,
    bassStyle: 'rootFifth',
    compStyle: 'strum',
    drums: 'pop',
  },
  {
    id: 'festival',
    label: 'Festival EDM — four on the floor',
    melody: [
      { instrument: 'piano', base: 72, volume: -5 },
      { synth: softSynth('triangle', -8, { attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.5 }), base: 72, volume: -8 },
      { instrument: 'piano', base: 60, volume: -7 },
      { synth: softSynth('triangle', -10, { attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.5 }), base: 67, volume: -10 },
      { instrument: 'piano', base: 76, volume: -8 },
      { synth: softSynth('square', -14, { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.4 }), base: 72, volume: -14 },
    ],
    bass: { synth: softSynth('sine', -4, { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 }), base: 36, volume: -4 },
    pad: { synth: softSynth('fatsawtooth' as OscillatorType, -16, { attack: 0.5, release: 2.5 }), base: 60, volume: -16 },
    swing: 0,
    defaultBpm: 126,
    bassStyle: 'offbeat',
    compStyle: 'held',
    drums: 'fourfloor',
  },
]

// Hidden no-samples fallback — used when sample loading fails (offline).
const FALLBACK: Palette = {
  id: 'fallback',
  label: 'Synth (offline fallback)',
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
  defaultBpm: 96,
  bassStyle: 'held',
  compStyle: 'held',
  drums: null,
}

function paletteById(id: string): Palette {
  if (id === 'fallback') return FALLBACK
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

interface DrumKit {
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  hat: Tone.MetalSynth
  open: Tone.MetalSynth
  ride: Tone.MetalSynth
  nodes: Tone.ToneAudioNode[]
}

// Synthesized kit — no samples needed, identical live and offline.
function buildKit(dry: Tone.ToneAudioNode): DrumKit {
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, volume: -6 }).connect(dry)
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -12 }).connect(dry)
  const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.02 }, harmonicity: 5.1, resonance: 4000, volume: -22 }).connect(dry)
  const open = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.3, release: 0.1 }, harmonicity: 5.1, resonance: 3500, volume: -24 }).connect(dry)
  const ride = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.6, release: 0.2 }, harmonicity: 4.1, resonance: 3000, volume: -25 }).connect(dry)
  return { kick, snare, hat, open, ride, nodes: [kick, snare, hat, open, ride] }
}

function hitDrum(kit: DrumKit, piece: number, dur: number, time: number, vel: number) {
  if (piece === 36) kit.kick.triggerAttackRelease('C1', dur, time, vel)
  else if (piece === 38) kit.snare.triggerAttackRelease(dur, time, vel)
  else if (piece === 46) kit.open.triggerAttackRelease('G5', dur, time, vel)
  else if (piece === 51) kit.ride.triggerAttackRelease('A5', dur, time, vel)
  else kit.hat.triggerAttackRelease('G5', dur, time, vel)
}

interface Voices {
  melody: Voice[]
  bass: Voice
  pad: Voice
  kit: DrumKit | null
  all: Voice[]
}

function buildVoices(palette: Palette, wet: Tone.ToneAudioNode, dry: Tone.ToneAudioNode): Voices {
  const melody = palette.melody.map((s) => makeVoice(s).connect(wet))
  const bass = makeVoice(palette.bass).connect(wet)
  const pad = makeVoice(palette.pad).connect(wet)
  const kit = palette.drums ? buildKit(dry) : null
  return { melody, bass, pad, kit, all: [...melody, bass, pad] }
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
    bassStyle: p.bassStyle,
    compStyle: p.compStyle,
    drums: p.drums,
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
    const t0 = clock(n.startBeat)
    const t1 = clock(n.startBeat + n.durBeats)
    const dur = Math.max(0.07, (t1 - t0) * (n.staccato ? 0.45 : 0.92))
    if (n.voice === 'drums') {
      if (!voices.kit) continue
      const kit = voices.kit
      transport.scheduleOnce((time) => hitDrum(kit, n.midis[0], dur, time, n.vel), t0)
      continue
    }
    const voice = n.voice === 'melody' ? voices.melody[n.speaker % voices.melody.length] : n.voice === 'bass' ? voices.bass : voices.pad
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

function makeSpace(): { wet: Tone.ToneAudioNode; dry: Tone.ToneAudioNode; nodes: Tone.ToneAudioNode[]; ready: Promise<void> } {
  const reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.02, wet: 0.3 })
  const limiter = new Tone.Limiter(-2)
  reverb.connect(limiter)
  limiter.toDestination()
  // drums go straight to the limiter — a dry, punchy groove under the wet bed
  return { wet: reverb, dry: limiter, nodes: [reverb, limiter], ready: reverb.ready.then(() => undefined) }
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
      palette = paletteById('fallback')
    }
    if (this.voices && this.builtFor === palette.id) return
    this.disposeVoices()
    const space = makeSpace()
    await space.ready
    this.chain = space.nodes
    this.voices = buildVoices(palette, space.wet, space.dry)
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
    this.voices?.kit?.nodes.forEach((n) => n.dispose())
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
    palette = paletteById('fallback')
  }
  const planned = planFor(score, palette.id)
  const duration = makeClock(score, bpm, planned.endBeat)(planned.endBeat) + 2.5

  const buffer = await Tone.Offline(async ({ transport }) => {
    const space = makeSpace()
    await space.ready
    const voices = buildVoices(palette, space.wet, space.dry)
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
