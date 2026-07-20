// Sampled-instrument loader. Buffers are fetched+decoded once and cached at
// module level; AudioBuffers are context-independent, so the same cache backs
// both live playback and the offline WAV render. Samples are vendored under
// public/samples/ (from nbrosowsky/tonejs-instruments, CC-licensed VSCO2 et
// al.), so they work offline and inside the Capacitor bundle.
import * as Tone from 'tone'

const NOTE_SETS: Record<string, string[]> = {
  piano: ['C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6'],
  cello: ['C2', 'G2', 'C3', 'G3', 'C4', 'C5'],
  violin: ['G3', 'C4', 'E4', 'A4', 'C5', 'E5', 'C6'],
  harp: ['C3', 'E3', 'G3', 'A4', 'C5', 'E5', 'G5'],
  flute: ['C4', 'E4', 'A4', 'C5', 'E5', 'C6'],
  contrabass: ['G1', 'C2', 'D2', 'E2', 'A2'],
  saxophone: ['C4', 'D4', 'F4', 'A4', 'C5'],
  trumpet: ['F3', 'C4', 'F4', 'G4', 'D5', 'F5', 'C6'],
  trombone: ['F2', 'C3', 'F3', 'C4', 'F4'],
  clarinet: ['D3', 'F3', 'D4', 'F4', 'D5', 'F5'],
  'french-horn': ['C2', 'D3', 'F3', 'C4', 'D5'],
  bassoon: ['G2', 'C3', 'A3', 'C4', 'G4'],
  tuba: ['F1', 'Ds2', 'F2', 'As2', 'D3'],
  'guitar-acoustic': ['E2', 'A2', 'D3', 'G3', 'C4', 'E4', 'A4', 'C5'],
  'guitar-electric': ['E2', 'A2', 'C3', 'C4', 'A4', 'C5'],
  'bass-electric': ['E1', 'G1', 'Cs2', 'E2', 'G2', 'Cs3', 'E3'],
  organ: ['C2', 'A2', 'C3', 'A3', 'C4', 'A4', 'C5'],
}

const cache = new Map<string, Record<string, AudioBuffer>>()
const pending = new Map<string, Promise<void>>()

async function loadInstrument(name: string): Promise<void> {
  if (cache.has(name)) return
  if (pending.has(name)) return pending.get(name)
  const p = (async () => {
    const notes = NOTE_SETS[name]
    if (!notes) throw new Error(`unknown instrument ${name}`)
    const ctx = Tone.getContext().rawContext
    const buffers: Record<string, AudioBuffer> = {}
    await Promise.all(
      notes.map(async (n) => {
        const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}/${n}.mp3`)
        if (!res.ok) throw new Error(`sample ${name}/${n} → ${res.status}`)
        buffers[n] = await ctx.decodeAudioData(await res.arrayBuffer())
      }),
    )
    cache.set(name, buffers)
  })()
  pending.set(name, p)
  try {
    await p
  } finally {
    pending.delete(name)
  }
}

export async function preload(names: string[]): Promise<void> {
  await Promise.all(names.map(loadInstrument))
}

// Synchronous once preloaded — creation must be sync inside Tone.Offline.
export function makeSampler(name: string, opts: { volume: number; attack?: number; release?: number }): Tone.Sampler {
  const buffers = cache.get(name)
  if (!buffers) throw new Error(`instrument ${name} not preloaded`)
  const urls: Record<string, AudioBuffer> = {}
  // filenames use "s" for sharp (Ds2.mp3); Tone note names want "D#2"
  for (const [note, buf] of Object.entries(buffers)) urls[note.replace(/^([A-G])s/, '$1#')] = buf
  return new Tone.Sampler({
    urls: urls as any,
    volume: opts.volume,
    attack: opts.attack ?? 0,
    release: opts.release ?? 1.2,
  })
}
