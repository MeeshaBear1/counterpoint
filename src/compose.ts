// Pure composition: Score → a deterministic note plan. No Tone.js here — the
// engine renders the plan, the check script asserts on it directly in Node.
//
// The musical thesis, refined twice by listener feedback:
// - Conflict is expressed the way real music does it — minor mode, low
//   register, driving staccato, dissonance that RESOLVES — never tritone walls.
// - Collaboration is the product: consecutive agreements build a "lift" arc
//   (rising register, richer harmony, swelling dynamics) that earns a cadence.
// - It must flow like humans playing together: every phrase OPENS by quoting
//   the counterparty's tail (challenges quote it inverted — arguing with the
//   same material), phrases walk stepwise to a peak and land on a chord tone,
//   final notes ring through the gap to the next entrance (no silence between
//   speakers), and the bass/pad lay a continuous harmonic bed under it all.
import type { Score, ScoreEvent } from './score'

export interface PlannedNote {
  voice: 'melody' | 'bass' | 'pad' | 'drums'
  speaker: number // melody only; -1 otherwise
  phrase: number // melody only (event index); -1 otherwise
  startBeat: number
  durBeats: number
  midis: number[] // drums: 36 kick · 38 snare · 42 closed hat · 46 open hat · 51 ride
  vel: number
  staccato?: boolean
}

export type BassStyle = 'held' | 'walking' | 'rootFifth' | 'offbeat' | 'boom'
export type CompStyle = 'held' | 'arp' | 'stabs' | 'strum'
export type DrumStyle = 'swing' | 'boombap' | 'backbeat' | 'pop' | 'fourfloor' | null

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
  bassStyle?: BassStyle // default 'held'
  compStyle?: CompStyle // default 'held'
  drums?: DrumStyle // default none
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10] // natural minor
// chord cycles as scale-degree roots; harmonic rhythm = one chord per 2 turns
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

// Stepwise path from a start degree, up to a peak, down to a target — the
// shape of a sung sentence. Mostly seconds; repeats become upper neighbors.
function walk(from: number, peak: number, target: number, n: number): number[] {
  if (n <= 1) return [target]
  const up = Math.max(1, Math.round(n * 0.55))
  const down = n - up
  const path: number[] = []
  for (let i = 0; i < up; i++) path.push(Math.round(from + ((peak - from) * i) / Math.max(1, up - 1)))
  for (let i = 1; i <= down; i++) path.push(Math.round(peak + ((target - peak) * i) / down))
  // melodic hygiene: a repeated degree becomes an upper-neighbor ornament
  for (let i = 1; i < path.length - 1; i++) if (path[i] === path[i - 1]) path[i] += 1
  path[path.length - 1] = target
  return path
}

interface PhraseCtx {
  scale: number[]
  lift: number
  chordRoot: number
  prevTail: number[] // counterparty's last degrees — the material we play off
  intensity: number
}

// Build a phrase as scale degrees. Every phrase answers the previous one.
function buildPhrase(ev: ScoreEvent, ctx: PhraseCtx): { degs: number[]; chrom: number[]; staccato: boolean; octave: number } {
  const n = Math.max(3, Math.min(12, Math.round(ev.durationBeats * (0.9 + 0.5 * ev.intensity))))
  const liftDeg = Math.floor(ctx.lift / 2)
  const tail = ctx.prevTail
  const head = tail.length ? tail.slice(-2) : [0 + liftDeg, 2 + liftDeg]

  switch (ev.kind) {
    case 'question': {
      // inherit the tail, climb, hang on the dominant — a half cadence
      const target = 4 + liftDeg
      const peak = Math.max(head[head.length - 1], target) + 2 + liftDeg
      return { degs: [...head, ...walk(head[head.length - 1], peak, target, n - head.length)], chrom: [], staccato: false, octave: 0 }
    }
    case 'answer': {
      // take the question's hanging note and bring it home
      const start = head[head.length - 1]
      return { degs: [...head, ...walk(start, start + 1, ctx.chordRoot, n - head.length)], chrom: [], staccato: false, octave: 0 }
    }
    case 'agreement': {
      // develop the counterparty's idea upward — the soaring direction
      const start = head[head.length - 1]
      const peak = start + 3 + liftDeg
      return { degs: [...head, ...walk(start, peak, ctx.chordRoot + 2 + liftDeg, n - head.length)], chrom: [], staccato: false, octave: 0 }
    }
    case 'challenge': {
      // quote the counterparty INVERTED (same material, opposite direction),
      // then drive at the minor root; one chromatic lean that resolves
      const pivot = head[0]
      const inv = head.map((d) => pivot - (d - pivot))
      const degs = [...inv]
      const chrom = inv.map(() => 0)
      while (degs.length < n) {
        degs.push(0)
        chrom.push(degs.length === n - 1 ? 1 : 0) // the lean, resolving into the final root
      }
      if (degs.length >= 2) chrom[degs.length - 1] = 0
      return { degs, chrom, staccato: true, octave: -12 }
    }
    case 'interruption': {
      // snatch the counterparty's last note and cut it off, an octave up
      const g = head[head.length - 1]
      return { degs: [g + 1, g], chrom: [], staccato: true, octave: 12 }
    }
    default: {
      // statement: own material shaped from the inherited head, lands on the chord
      const start = head[head.length - 1]
      const peak = start + 2 + liftDeg + (ev.intensity > 0.7 ? 1 : 0)
      return { degs: [...head, ...walk(start, peak, ctx.chordRoot, n - head.length)], chrom: [], staccato: false, octave: 0 }
    }
  }
}

// phrase rhythm: varied short values with a long breath note at the end
function rhythmFor(n: number, turn: number): number[] {
  const pool = [0.6, 0.4, 0.5, 0.8]
  const w = Array.from({ length: n }, (_, i) => pool[(i + turn) % pool.length])
  w[n - 1] = 1.6
  return w
}

export function plan(score: Score, opts: PlanOpts): Plan {
  const notes: PlannedNote[] = []
  const turnMarks: { turn: number; startBeat: number }[] = []
  const events = score.events
  const heats = events.map(heatOf)

  // --- harmonic bed: chord groups spanning 2 turns each, gap-free ----------
  interface Group { start: number; end: number; root: number; scale: number[] }
  const groups: Group[] = []
  for (let i = 0; i < events.length; i += 2) {
    const win = heats.slice(Math.max(0, i - 1), i + 2)
    const minor = win.reduce((a, b) => a + b, 0) / win.length > 0.62 || COMBATIVE.has(events[i].kind)
    const scale = minor ? MINOR : MAJOR
    const cycle = minor ? MINOR_CYCLE : MAJOR_CYCLE
    groups.push({ start: events[i].startBeat, end: 0, root: cycle[(i / 2) % 4], scale })
  }
  groups.forEach((g, gi) => { g.end = gi + 1 < groups.length ? groups[gi + 1].start : score.totalBeats })

  const bassStyle = opts.bassStyle ?? 'held'
  const compStyle = opts.compStyle ?? 'held'
  // swing shift for anything landing on an offbeat eighth
  const sw = (beat: number) => (opts.swing > 0 && Math.abs((beat % 1) - 0.5) < 0.15 ? opts.swing * 0.16 : 0)
  const bassNote = (startBeat: number, durBeats: number, semis: number, vel: number) =>
    notes.push({ voice: 'bass', speaker: -1, phrase: -1, startBeat: startBeat + sw(startBeat), durBeats, midis: [opts.bassBase + semis], vel })

  groups.forEach((g, gi) => {
    const span = g.end - g.start
    if (span <= 0) return
    const anchor = events[gi * 2]
    const next = groups[gi + 1]
    const rootVel = Math.min(1, 0.4 + anchor.intensity * 0.25)

    // --- bass, per style ---------------------------------------------------
    if (bassStyle === 'walking') {
      // quarter-note line through the chord, approaching the next root
      const cycle = [g.root, g.root + 2, g.root + 4, g.root + 2]
      for (let q = 0; q < Math.floor(span); q++) {
        const isLast = q === Math.floor(span) - 1
        const deg = isLast && next && next.root !== g.root ? next.root - 1 : cycle[q % 4]
        bassNote(g.start + q, 0.9, degToSemis(isLast && next ? next.scale : g.scale, deg), q % 4 === 0 ? rootVel : 0.35)
      }
    } else if (bassStyle === 'rootFifth') {
      // the two-feel: root and fifth alternating every two beats
      for (let b = 0; b < span; b += 2) {
        const onRoot = (b / 2) % 2 === 0
        bassNote(g.start + b, Math.min(1.9, span - b), degToSemis(g.scale, onRoot ? g.root : g.root + 4), onRoot ? rootVel : 0.4)
      }
    } else if (bassStyle === 'offbeat') {
      // eighth-note offbeat bounce — the four-on-the-floor counterweight
      for (let b = 0; b < span - 0.5; b += 1) {
        bassNote(g.start + b + 0.5, 0.35, degToSemis(g.scale, g.root), 0.5)
      }
    } else if (bassStyle === 'boom') {
      // sparse sub hits locking with the boom-bap kick
      for (let b = 0; b < span; b += 4) {
        bassNote(g.start + b, Math.min(1.6, span - b), degToSemis(g.scale, g.root), rootVel)
        if (span - b > 2) bassNote(g.start + b + 1.75, 0.7, degToSemis(g.scale, g.root), 0.35)
      }
    } else {
      // held: root, a fifth at the midpoint of long spans, stepwise approach
      bassNote(g.start, Math.max(1, span * 0.95), degToSemis(g.scale, g.root), rootVel)
      if (span >= 3) bassNote(g.start + span / 2, span / 2 - 0.75, degToSemis(g.scale, g.root + 4), 0.35)
      if (next && next.root !== g.root && span >= 2) bassNote(g.end - 0.75, 0.7, degToSemis(next.scale, next.root - 1), 0.3)
    }

    // --- comping, per style ------------------------------------------------
    const triad = [0, 2, 4].map((d) => opts.padBase + degToSemis(g.scale, g.root + d))
    const compVel = Math.min(0.5, 0.22 + anchor.intensity * 0.08)
    if (compStyle === 'arp') {
      // broken-chord eighths — the continuo realization
      const cyc = [0, 2, 4, 2]
      for (let e = 0; e * 0.5 < span - 0.25; e++) {
        const m = opts.padBase + degToSemis(g.scale, g.root + cyc[e % 4])
        notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: g.start + e * 0.5, durBeats: 0.48, midis: [m], vel: compVel })
      }
    } else if (compStyle === 'stabs') {
      // syncopated chord punches on the back offbeats
      for (let b = 0; b < span; b += 4) {
        for (const off of [1.5, 3.5]) {
          if (b + off < span) {
            notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: g.start + b + off + sw(off), durBeats: 0.3, midis: triad, vel: Math.min(0.6, compVel + 0.18) })
          }
        }
      }
    } else if (compStyle === 'strum') {
      // strummed chords — quick roll on a driving pattern
      const patt = [0, 1.5, 2, 3.5]
      for (let b = 0; b < span; b += 4) {
        for (const off of patt) {
          if (b + off >= span) continue
          triad.forEach((m, ti) => {
            notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: g.start + b + off + sw(off) + ti * 0.03, durBeats: 1.1, midis: [m], vel: compVel + (off === 0 ? 0.06 : 0) })
          })
        }
      }
    } else {
      // held: one rolled chord for the whole group — the continuous bed
      triad.forEach((m, ti) => {
        notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: g.start + ti * 0.07, durBeats: span - ti * 0.07, midis: [m], vel: compVel })
      })
    }
  })

  // --- drums: the groove layer, one bar pattern repeated to the last turn ---
  if (opts.drums) {
    const K = 36, S = 38, H = 42, O = 46, R = 51
    // [piece, barOffset, velocity][]
    const PATTERNS: Record<string, [number, number, number][]> = {
      swing: [[R, 0, 0.5], [R, 1, 0.4], [R, 1.5, 0.35], [R, 2, 0.5], [R, 3, 0.4], [R, 3.5, 0.35], [H, 1, 0.3], [H, 3, 0.3], [K, 0, 0.25], [K, 2, 0.2]],
      boombap: [[K, 0, 0.9], [K, 1.75, 0.7], [S, 1, 0.85], [S, 3, 0.85], [H, 0, 0.4], [H, 0.5, 0.3], [H, 1, 0.4], [H, 1.5, 0.3], [H, 2, 0.4], [H, 2.5, 0.3], [H, 3, 0.4], [H, 3.5, 0.3]],
      backbeat: [[K, 0, 0.8], [K, 2, 0.7], [S, 1, 0.75], [S, 3, 0.75], [H, 0, 0.35], [H, 0.5, 0.25], [H, 1, 0.35], [H, 1.5, 0.25], [H, 2, 0.35], [H, 2.5, 0.25], [H, 3, 0.35], [H, 3.5, 0.25]],
      pop: [[K, 0, 0.85], [K, 1.5, 0.6], [K, 2, 0.75], [S, 1, 0.8], [S, 3, 0.8], [H, 0.5, 0.3], [H, 1.5, 0.3], [H, 2.5, 0.3], [O, 3.5, 0.35]],
      fourfloor: [[K, 0, 0.95], [K, 1, 0.95], [K, 2, 0.95], [K, 3, 0.95], [O, 0.5, 0.45], [O, 1.5, 0.45], [O, 2.5, 0.45], [O, 3.5, 0.45], [S, 1, 0.6], [S, 3, 0.6]],
    }
    const patt = PATTERNS[opts.drums]
    for (let bar = 0; bar * 4 < score.totalBeats; bar++) {
      for (const [piece, off, vel] of patt) {
        const beat = bar * 4 + off
        if (beat >= score.totalBeats) continue
        notes.push({ voice: 'drums', speaker: -1, phrase: -1, startBeat: beat + sw(beat), durBeats: 0.25, midis: [piece], vel })
      }
    }
  }

  // --- melody: every phrase plays off the counterparty ---------------------
  let lift = 0
  let seed = 1
  let prevTail: number[] = []
  let lastMelodyEnd = 0

  events.forEach((ev, i) => {
    const si = Math.max(0, score.speakers.indexOf(ev.speaker))
    const base = opts.speakerBases[si % opts.speakerBases.length]
    const g = groups[Math.floor(i / 2)]
    const minor = COMBATIVE.has(ev.kind) || g.scale === MINOR
    const scale = COMBATIVE.has(ev.kind) ? MINOR : g.scale

    if (COMBATIVE.has(ev.kind)) lift = 0
    else if (CONSONANT.has(ev.kind) || ev.intensity < 0.55) lift = Math.min(6, lift + 1)

    const ctx: PhraseCtx = { scale, lift, chordRoot: g.root, prevTail, intensity: ev.intensity }
    const spec = buildPhrase(ev, ctx)
    const w = rhythmFor(spec.degs.length, ev.turn)
    const total = w.reduce((a, b) => a + b, 0)
    const octave = spec.octave < 0 && base < 60 ? 0 : spec.octave
    // harmonization: thirds when warm, sixths added as the lift grows
    const harmony = ev.kind === 'agreement' ? (lift >= 4 ? [2, 5] : [2]) : ev.kind === 'answer' && lift >= 2 ? [2] : []
    // the final note rings through the gap into the next phrase — no breaks
    const nextStart = events[i + 1]?.startBeat ?? score.totalBeats
    const gapExtension = Math.max(0, Math.min(4, nextStart - (ev.startBeat + ev.durationBeats) + 0.4))
    const peakIdx = Math.max(0, spec.degs.indexOf(Math.max(...spec.degs)))

    turnMarks.push({ turn: ev.turn, startBeat: ev.startBeat })

    let frac = 0
    spec.degs.forEach((d, ni) => {
      const nb0 = ev.startBeat + (frac / total) * ev.durationBeats
      let nbDur = (w[ni] / total) * ev.durationBeats
      frac += w[ni]
      if (ni === spec.degs.length - 1 && !spec.staccato) nbDur += gapExtension
      let start = nb0
      if (opts.swing > 0 && Math.abs((start % 1) - 0.5) < 0.15) start += opts.swing * 0.16
      start += jitter(seed++) * 0.02 // humanize
      // dynamics breathe: crescendo into the peak, soften the landing
      const shape = 0.08 * (1 - Math.abs(ni - peakIdx) / spec.degs.length) - (ni === spec.degs.length - 1 ? 0.04 : 0)
      const vel = Math.max(0.15, Math.min(1, 0.28 + ev.intensity * 0.5 + lift * 0.03 + shape + jitter(seed++) * 0.04))
      const chordDegs = harmony.length && ni % 2 === 0 ? fixTritones(scale, [d, ...harmony.map((h) => d + h)]) : [d]
      const midis = chordDegs.map((cd) => Math.max(31, Math.min(96, base + degToSemis(scale, cd) + octave + (spec.chrom[ni] ?? 0))))
      notes.push({ voice: 'melody', speaker: si, phrase: i, startBeat: start, durBeats: nbDur, midis, vel, staccato: spec.staccato })
      lastMelodyEnd = Math.max(lastMelodyEnd, start + nbDur)
    })

    prevTail = spec.degs.slice(-2)
    void minor
  })

  // --- cadence: collaborative pieces EARN a resolution ---------------------
  let endBeat = Math.max(score.totalBeats, Math.ceil(lastMelodyEnd))
  const last = events[events.length - 1]
  const endedWarm = last && !COMBATIVE.has(last.kind) && lift > 0
  if (endedWarm) {
    // V → I(add9), the "we made a thing" landing
    notes.push({ voice: 'bass', speaker: -1, phrase: -1, startBeat: endBeat + 0.5, durBeats: 1.5, midis: [opts.bassBase + 7], vel: 0.5 })
    ;[7, 11, 14].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: endBeat + 0.5 + ti * 0.07, durBeats: 1.5, midis: [opts.padBase + s], vel: 0.3 }),
    )
    notes.push({ voice: 'bass', speaker: -1, phrase: -1, startBeat: endBeat + 2, durBeats: 3.5, midis: [opts.bassBase], vel: 0.55 })
    ;[0, 4, 7, 14].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: endBeat + 2 + ti * 0.07, durBeats: 3.5, midis: [opts.padBase + s], vel: 0.34 }),
    )
    endBeat += 6
  } else if (last) {
    // combative end: a bare low minor chord, dark and honest
    notes.push({ voice: 'bass', speaker: -1, phrase: -1, startBeat: endBeat + 0.5, durBeats: 3, midis: [opts.bassBase], vel: 0.5 })
    ;[0, 3, 7].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: endBeat + 0.5 + ti * 0.07, durBeats: 3, midis: [opts.padBase + s], vel: 0.28 }),
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
