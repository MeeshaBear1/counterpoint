// Pure composition: Score → a deterministic note plan. No Tone.js here — the
// engine renders the plan, the check script asserts on it directly in Node.
//
// The musical thesis, post listening-feedback: conflict is expressed the way
// real music expresses it — minor mode, low register, driving staccato,
// dissonance that RESOLVES — never bare tritone walls. Collaboration is the
// product: consecutive agreements build a "lift" arc (rising register, richer
// harmony, swelling dynamics) that lands on a real cadence. One shared key so
// consonance has a home to be consonant against.
import type { Score, ScoreEvent } from './score'

export interface PlannedNote {
  voice: 'melody' | 'bass' | 'pad'
  speaker: number // melody only; -1 otherwise
  startBeat: number
  durBeats: number
  midis: number[]
  vel: number
  staccato?: boolean
}

export interface Plan {
  notes: PlannedNote[]
  turnMarks: { turn: number; startBeat: number }[]
  endBeat: number
}

export interface PlanOpts {
  speakerBases: number[] // midi register per speaker slot (palette-defined)
  bassBase: number
  padBase: number
  swing: number // 0 = straight, ~0.6 = jazz
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10] // natural minor
const MOTIFS = [
  [0, 2, 4, 2],
  [0, -1, -3, -1],
  [0, 3, 1, 4],
  [4, 2, 0],
  [0, 1, 2, 4],
  [0, -2, -3, 0],
]
// chord cycles as scale-degree roots
const MAJOR_CYCLE = [0, 5, 3, 4] // I vi IV V
const MINOR_CYCLE = [0, 5, 2, 6] // i VI III VII

const COMBATIVE = new Set(['challenge', 'interruption'])
const CONSONANT = new Set(['agreement', 'answer'])

function degToSemis(scale: number[], deg: number): number {
  const oct = Math.floor(deg / 7)
  const idx = ((deg % 7) + 7) % 7
  return oct * 12 + scale[idx]
}

// Diatonic stacking can produce a tritone inside a chord (F–B in C major, the
// deg3/deg6 pair). Nudge the offender up one scale degree — beauty invariant.
function fixTritones(scale: number[], degs: number[]): number[] {
  const kept: number[] = []
  for (let g of degs) {
    for (let tries = 0; tries < 2; tries++) {
      const s = degToSemis(scale, g)
      if (kept.every((k) => Math.abs(degToSemis(scale, k) - s) % 12 !== 6)) break
      g += 1
    }
    kept.push(g)
  }
  return kept
}

// deterministic jitter in [-1, 1] — same score, same plan, same WAV
function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function heatOf(ev: ScoreEvent): number {
  const bias =
    ev.kind === 'challenge' ? 0.35 : ev.kind === 'interruption' ? 0.4 : ev.kind === 'agreement' ? -0.15 : ev.kind === 'answer' ? -0.05 : 0
  return Math.max(0, Math.min(1, 0.55 * ev.intensity + 0.3 + bias))
}

interface Ctx {
  scale: number[]
  minor: boolean
  lift: number
  chordRoot: number // scale degree
}

// rhythm: relative note-length weights per kind
function weightsFor(kind: string, n: number): number[] {
  let ws: number[]
  switch (kind) {
    case 'question':
      ws = [0.16, 0.16, 0.2, 0.2, 0.28].slice(0, n)
      break
    case 'answer':
      ws = [0.22, 0.18, 0.18, 0.18, 0.24].slice(0, n)
      break
    case 'agreement':
      ws = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.28 : 0.2))
      break
    default:
      ws = Array.from({ length: n }, (_, i) => (i === n - 1 ? 0.3 : 0.18))
  }
  while (ws.length < n) ws.push(0.2)
  return ws
}

// A phrase = sequence of {degs, chromatic} — chromatic offsets in semitones
// applied after scale mapping (used for the resolving lean, never parallel).
function phraseSpec(ev: ScoreEvent, ctx: Ctx): { steps: { degs: number[]; chrom?: number }[]; staccato: boolean; octave: number } {
  const motif = MOTIFS[((ev.motifRef % MOTIFS.length) + MOTIFS.length) % MOTIFS.length]
  const liftDeg = Math.floor(ctx.lift / 2) // soaring: contour climbs as agreement builds
  const up = (d: number) => d + liftDeg

  switch (ev.kind) {
    case 'question':
      // rising, ends hanging on the 6th degree — unresolved but lyrical
      return { steps: [0, 1, 2, 4, 6].map((d) => ({ degs: [up(d)] })), staccato: false, octave: 0 }
    case 'answer': {
      // descends and resolves home; harmonized when the room is warm
      const h = ctx.lift >= 2 ? [2] : []
      return { steps: [4, 3, 2, 1, 0].map((d) => ({ degs: [up(d), ...h.map((x) => up(d) + x)] })), staccato: false, octave: 0 }
    }
    case 'agreement': {
      // the other voice's motif, harmonized in thirds (then sixths as lift grows)
      const h = ctx.lift >= 4 ? [2, 5] : [2]
      return { steps: motif.map((d) => ({ degs: [up(d), ...h.map((x) => up(d) + x)] })), staccato: false, octave: 0 }
    }
    case 'challenge': {
      // dark and driving: forced minor (caller sets ctx), low register, doubled
      // hits, and a chromatic lean that RESOLVES — tension, not noise
      const steps: { degs: number[]; chrom?: number }[] = [{ degs: [motif[0]], chrom: 1 }]
      for (const d of motif) steps.push({ degs: [d] }, { degs: [d] })
      return { steps, staccato: true, octave: -12 }
    }
    case 'interruption':
      // quick pickup an octave up — abrupt in rhythm, tonal in pitch
      return { steps: [{ degs: [4] }, { degs: [0], chrom: 0 }], staccato: true, octave: 12 }
    default:
      // statement: motif landing home
      return { steps: [...motif.map((d) => ({ degs: [up(d)] })), { degs: [up(0)] }], staccato: false, octave: 0 }
  }
}

export function plan(score: Score, opts: PlanOpts): Plan {
  const notes: PlannedNote[] = []
  const turnMarks: { turn: number; startBeat: number }[] = []
  const events = score.events
  const heats = events.map(heatOf)

  let lift = 0
  let seed = 1

  events.forEach((ev, i) => {
    const si = Math.max(0, score.speakers.indexOf(ev.speaker))
    const base = opts.speakerBases[si % opts.speakerBases.length]

    // mode from the local emotional window; combat is always minor
    const win = (heats[i - 1] ?? heats[i]) * 0.25 + heats[i] * 0.5 + (heats[i + 1] ?? heats[i]) * 0.25
    const minor = COMBATIVE.has(ev.kind) || win > 0.62
    const scale = minor ? MINOR : MAJOR

    // lift arc: consonance builds, combat resets
    if (COMBATIVE.has(ev.kind)) lift = 0
    else if (CONSONANT.has(ev.kind) || ev.intensity < 0.55) lift = Math.min(6, lift + 1)

    const ctx: Ctx = { scale, minor, lift, chordRoot: (minor ? MINOR_CYCLE : MAJOR_CYCLE)[i % 4] }
    const spec = phraseSpec(ev, ctx)
    const w = weightsFor(ev.kind, spec.steps.length)
    const total = w.reduce((a, b) => a + b, 0)

    turnMarks.push({ turn: ev.turn, startBeat: ev.startBeat })

    // --- melody ---
    let frac = 0
    spec.steps.forEach((st, ni) => {
      const nb0 = ev.startBeat + (frac / total) * ev.durationBeats
      const nbDur = (w[ni] / total) * ev.durationBeats
      frac += w[ni]
      let start = nb0
      // light swing on offbeat-ish positions (jazz palette)
      if (opts.swing > 0 && Math.abs((start % 1) - 0.5) < 0.15) start += opts.swing * 0.16
      start += jitter(seed++) * 0.02 // humanize
      const vel = Math.max(0.15, Math.min(1, 0.3 + ev.intensity * 0.5 + lift * 0.035 + jitter(seed++) * 0.04))
      // keep the "dark = low" drop only for voices with room below; clamp to
      // sampled-instrument range so pitch-shifting stays clean
      const octave = spec.octave < 0 && base < 60 ? 0 : spec.octave
      const degs = st.degs.length > 1 ? fixTritones(ctx.scale, st.degs) : st.degs
      const midis = degs.map((d) => Math.max(31, Math.min(96, base + degToSemis(ctx.scale, d) + octave + (st.chrom ?? 0))))
      notes.push({ voice: 'melody', speaker: si, startBeat: start, durBeats: nbDur, midis, vel, staccato: spec.staccato })
    })

    // --- accompaniment: bass root + soft pad triad ---
    const rootSemis = degToSemis(ctx.scale, ctx.chordRoot)
    notes.push({
      voice: 'bass',
      speaker: -1,
      startBeat: ev.startBeat,
      durBeats: Math.max(1, ev.durationBeats * 0.95),
      midis: [opts.bassBase + rootSemis],
      vel: Math.min(1, 0.4 + ev.intensity * 0.25),
    })
    if (ev.kind !== 'interruption' && ev.durationBeats >= 1.5) {
      const triad = [0, 2, 4].map((d) => opts.padBase + degToSemis(ctx.scale, ctx.chordRoot + d))
      triad.forEach((m, ti) => {
        notes.push({
          voice: 'pad',
          speaker: -1,
          startBeat: ev.startBeat + ti * 0.07, // gentle roll
          durBeats: ev.durationBeats - ti * 0.07,
          midis: [m],
          vel: Math.min(0.6, 0.2 + ev.intensity * 0.08 + lift * 0.03),
        })
      })
    }
  })

  // --- cadence: collaborative pieces EARN a resolution ---
  let endBeat = score.totalBeats
  const last = events[events.length - 1]
  const endedWarm = last && !COMBATIVE.has(last.kind) && lift > 0
  if (endedWarm) {
    // V → I(add9), the "we made a thing" landing
    notes.push({ voice: 'bass', speaker: -1, startBeat: endBeat + 0.5, durBeats: 1.5, midis: [opts.bassBase + 7], vel: 0.5 })
    ;[7, 11, 14].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, startBeat: endBeat + 0.5 + ti * 0.07, durBeats: 1.5, midis: [opts.padBase + s], vel: 0.3 }),
    )
    notes.push({ voice: 'bass', speaker: -1, startBeat: endBeat + 2, durBeats: 3.5, midis: [opts.bassBase], vel: 0.55 })
    ;[0, 4, 7, 14].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, startBeat: endBeat + 2 + ti * 0.07, durBeats: 3.5, midis: [opts.padBase + s], vel: 0.34 }),
    )
    endBeat += 6
  } else if (last) {
    // combative end: a bare low minor chord, dark and honest
    notes.push({ voice: 'bass', speaker: -1, startBeat: endBeat + 0.5, durBeats: 3, midis: [opts.bassBase], vel: 0.5 })
    ;[0, 3, 7].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, startBeat: endBeat + 0.5 + ti * 0.07, durBeats: 3, midis: [opts.padBase + s], vel: 0.28 }),
    )
    endBeat += 4
  }

  return { notes, turnMarks, endBeat }
}

// --- tempo arc: monotonic beat→seconds clock, local tempo follows heat ------
function intensityAtBeat(score: Score, beat: number): number {
  let cur = 0.4
  for (const e of score.events) {
    if (e.startBeat <= beat) cur = e.intensity
    else break
  }
  return cur
}

export function makeClock(score: Score, baseBpm: number, lengthBeats: number): (beat: number) => number {
  const step = 0.25
  const beats = [0]
  const times = [0]
  let t = 0
  for (let b = step; b <= lengthBeats + 2; b += step) {
    const bpm = baseBpm * (0.85 + 0.5 * intensityAtBeat(score, b - step / 2))
    t += (60 / bpm) * step
    beats.push(b)
    times.push(t)
  }
  return (beat: number) => {
    if (beat <= 0) return 0
    const i = Math.min(beats.length - 1, Math.floor(beat / step))
    if (i >= beats.length - 1) return times[times.length - 1]
    const f = (beat - beats[i]) / step
    return times[i] + f * (times[i + 1] - times[i])
  }
}
