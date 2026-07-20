// Pure composition: Score → a deterministic note plan. No Tone.js here — the
// engine renders the plan, the check script asserts on it directly in Node.
//
// The musical thesis, refined by successive listening passes:
// - Conflict is expressed the way real music does it — minor mode, low
//   register, driving staccato, dissonance that RESOLVES — never tritone walls.
// - Collaboration is the product: consecutive agreements build a "lift" arc
//   that earns a cadence.
// - It flows like humans playing together: every phrase OPENS by quoting the
//   counterparty's tail (challenges quote it inverted), and phrase endings ring
//   into the next entrance so the line never breaks.
// - It is METRICAL. Phrases are laid out on a bar grid in real note values, so
//   melody, bass, comping and drums share one time system. Expression then
//   comes from playing *against* that grid: metric accent hierarchy, correlated
//   timing drift, per-genre feel (laid back vs. driving), and phrase-end rubato.
//   Off-grid onsets were the single biggest "machine" tell.
// - Strong beats land on CHORD TONES; dissonance lives on weak beats as passing
//   motion. That rule is what separates composed melody from generated notes.
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
  // beat → emotional temperature, for the tempo arc (built on the metrical
  // timeline, so the clock and the notes agree)
  heat: { beat: number; intensity: number }[]
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
// functional progressions, one chord per bar
const MAJOR_PROG = [0, 4, 5, 3] // I V vi IV
const MINOR_PROG = [0, 5, 2, 6] // i VI III VII

const COMBATIVE = new Set(['challenge', 'interruption'])
const CONSONANT = new Set(['agreement', 'answer'])
const BAR = 4

function degToSemis(scale: number[], deg: number): number {
  const oct = Math.floor(deg / 7)
  const idx = ((deg % 7) + 7) % 7
  return oct * 12 + scale[idx]
}

// Diatonic stacking can produce a tritone inside a chord (F–B in C major).
// Nudge the offender up one scale degree — beauty invariant.
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

// Deterministic pseudo-random in [-1, 1] — same score, same plan, same WAV.
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

// Correlated timing drift: a smooth wander, the way a player's pulse breathes.
// White noise sounds like a broken sequencer; drift sounds like a person.
function drift(i: number): number {
  return 0.6 * Math.sin(i * 0.37) + 0.4 * Math.sin(i * 0.11 + 1.7)
}

function heatOf(ev: ScoreEvent): number {
  const bias =
    ev.kind === 'challenge' ? 0.35 : ev.kind === 'interruption' ? 0.4 : ev.kind === 'agreement' ? -0.15 : ev.kind === 'answer' ? -0.05 : 0
  return Math.max(0, Math.min(1, 0.55 * ev.intensity + 0.3 + bias))
}

// --- metric layout ---------------------------------------------------------
// Phrases are laid out sequentially on the beat grid: each entrance lands on a
// beat, lengths are whole beats, and an interruption cuts into the phrase it
// interrupts. Turn length still drives phrase length — the mapping is intact,
// it is simply expressed in real note values now.
interface QEvent {
  ev: ScoreEvent
  start: number
  dur: number
}

function layout(events: ScoreEvent[]): QEvent[] {
  const out: QEvent[] = []
  let cursor = 0
  for (const ev of events) {
    const len = Math.max(2, Math.min(16, Math.round(ev.durationBeats)))
    const prev = out[out.length - 1]
    if (ev.kind === 'interruption' && prev) {
      // cut in on the next beat past the midpoint of the phrase being cut off
      const cut = Math.max(prev.start + 1, Math.ceil(prev.start + prev.dur * 0.55))
      prev.dur = Math.max(1, cut - prev.start)
      out.push({ ev, start: cut, dur: Math.max(1, Math.min(2, len)) })
      cursor = cut + Math.max(1, Math.min(2, len))
    } else {
      const start = Math.max(cursor, Math.ceil(cursor))
      out.push({ ev, start, dur: len })
      cursor = start + len
    }
  }
  return out
}

// Rhythm: real note values summing to the phrase length, ending long (a breath).
// Patterns are chosen per phrase so repeated turns don't repeat rhythmically.
const RHYTHM_CELLS = [
  [1, 1],
  [0.5, 0.5, 1],
  [1.5, 0.5],
  [0.5, 1, 0.5],
  [1, 0.5, 0.5],
  [2],
  [0.5, 0.5, 0.5, 0.5],
  [0.75, 0.75, 0.5],
]

function rhythmFor(lenBeats: number, seed: number, driving: boolean): number[] {
  const vals: number[] = []
  let left = lenBeats - 1 // reserve the final breath note
  let k = seed
  while (left >= 2) {
    // driving styles favour shorter, busier cells
    const cell = RHYTHM_CELLS[Math.abs((k * 7 + (driving ? 3 : 0)) % (driving ? 8 : 6))]
    const sum = cell.reduce((a, b) => a + b, 0)
    if (sum <= left) {
      vals.push(...cell)
      left -= sum
    } else {
      vals.push(left)
      left = 0
    }
    k++
  }
  if (left > 0) vals.push(left)
  vals.push(1) // the breath
  return vals
}

// --- melody ----------------------------------------------------------------
// Stepwise path from a start degree, up to a peak, down to a target.
function walk(from: number, peak: number, target: number, n: number): number[] {
  if (n <= 1) return [target]
  const up = Math.max(1, Math.round(n * 0.55))
  const down = n - up
  const path: number[] = []
  for (let i = 0; i < up; i++) path.push(Math.round(from + ((peak - from) * i) / Math.max(1, up - 1)))
  for (let i = 1; i <= down; i++) path.push(Math.round(peak + ((target - peak) * i) / down))
  for (let i = 1; i < path.length - 1; i++) if (path[i] === path[i - 1]) path[i] += 1
  path[path.length - 1] = target
  return path
}

interface PhraseCtx {
  scale: number[]
  lift: number
  chordRoot: number
  prevTail: number[]
  intensity: number
}

function buildPhrase(ev: ScoreEvent, ctx: PhraseCtx, n: number): { degs: number[]; chrom: number[]; staccato: boolean; octave: number } {
  const liftDeg = Math.floor(ctx.lift / 2)
  const tail = ctx.prevTail
  const head = tail.length ? tail.slice(-2) : [0 + liftDeg, 2 + liftDeg]
  const rest = Math.max(1, n - head.length)

  switch (ev.kind) {
    case 'question': {
      const target = 4 + liftDeg // hang on the dominant — a half cadence
      const peak = Math.max(head[head.length - 1], target) + 2 + liftDeg
      return { degs: [...head, ...walk(head[head.length - 1], peak, target, rest)], chrom: [], staccato: false, octave: 0 }
    }
    case 'answer': {
      const start = head[head.length - 1]
      return { degs: [...head, ...walk(start, start + 1, ctx.chordRoot, rest)], chrom: [], staccato: false, octave: 0 }
    }
    case 'agreement': {
      const start = head[head.length - 1]
      const peak = start + 3 + liftDeg
      return { degs: [...head, ...walk(start, peak, ctx.chordRoot + 2 + liftDeg, rest)], chrom: [], staccato: false, octave: 0 }
    }
    case 'challenge': {
      // quote the counterparty INVERTED, then drive at the minor root; one
      // chromatic lean that resolves
      const pivot = head[0]
      const inv = head.map((d) => pivot - (d - pivot))
      const degs = [...inv]
      const chrom = inv.map(() => 0)
      while (degs.length < n) {
        degs.push(0)
        chrom.push(degs.length === n - 1 ? 1 : 0)
      }
      if (degs.length >= 2) chrom[degs.length - 1] = 0
      return { degs, chrom, staccato: true, octave: -12 }
    }
    case 'interruption': {
      const g = head[head.length - 1]
      const degs = [g + 1, g].slice(0, Math.max(1, Math.min(2, n)))
      while (degs.length < n) degs.push(g)
      return { degs, chrom: [], staccato: true, octave: 12 }
    }
    default: {
      const start = head[head.length - 1]
      const peak = start + 2 + liftDeg + (ev.intensity > 0.7 ? 1 : 0)
      return { degs: [...head, ...walk(start, peak, ctx.chordRoot, rest)], chrom: [], staccato: false, octave: 0 }
    }
  }
}

// Strong beats land on chord tones; weak beats may pass through. The rule that
// makes a line sound composed rather than generated.
function snapToChordTone(deg: number, chordRoot: number): number {
  const tones = [chordRoot, chordRoot + 2, chordRoot + 4, chordRoot + 7, chordRoot - 3, chordRoot - 5]
  let best = deg
  let bestD = Infinity
  for (const t of tones) {
    const d = Math.abs(t - deg)
    if (d < bestD) { bestD = d; best = t }
  }
  return bestD <= 1 ? best : deg // never move more than a step — keep the contour
}

// After a leap, step back the other way. Classic melodic hygiene.
function smoothLeaps(degs: number[]): number[] {
  const out = [...degs]
  for (let i = 2; i < out.length; i++) {
    const leap = out[i - 1] - out[i - 2]
    if (Math.abs(leap) >= 3) {
      const next = out[i] - out[i - 1]
      if (Math.sign(next) === Math.sign(leap) && Math.abs(next) >= 2) out[i] = out[i - 1] - Math.sign(leap)
    }
  }
  return out
}

// Voice-leading: choose the triad inversion closest to the previous voicing so
// chords move by common tone instead of jumping in parallel.
function voiceLead(prev: number[] | null, pcs: number[], center: number): number[] {
  const options: number[][] = []
  for (let inv = 0; inv < 3; inv++) {
    const v = pcs.map((p, i) => p + (i < inv ? 12 : 0))
    for (const shift of [-12, 0, 12]) options.push(v.map((m) => m + shift))
  }
  const cost = (v: number[]) =>
    prev
      ? v.reduce((a, m, i) => a + Math.abs(m - (prev[i] ?? prev[prev.length - 1])), 0)
      : v.reduce((a, m) => a + Math.abs(m - center), 0)
  return options.reduce((best, v) => (cost(v) < cost(best) ? v : best), options[0]).sort((a, b) => a - b)
}

export function plan(score: Score, opts: PlanOpts): Plan {
  const notes: PlannedNote[] = []
  const turnMarks: { turn: number; startBeat: number }[] = []
  const q = layout(score.events)
  const heats = score.events.map(heatOf)
  const lastBeat = q.length ? q[q.length - 1].start + q[q.length - 1].dur : 0

  const bassStyle = opts.bassStyle ?? 'held'
  const compStyle = opts.compStyle ?? 'held'
  const drumStyle = opts.drums ?? null
  // Per-genre feel: swing/hip-hop sit behind the beat, EDM pushes it.
  const laidBack = drumStyle === 'boombap' || opts.swing > 0.3 ? 0.035 : 0
  const driving = drumStyle === 'fourfloor'
  const push = driving ? -0.012 : 0

  // swing shift for anything landing on an offbeat eighth
  const sw = (beat: number) => (opts.swing > 0 && Math.abs((beat % 1) - 0.5) < 0.12 ? opts.swing * 0.16 : 0)
  // metric accent hierarchy — beat 1 strongest, then 3, then 2 & 4, then offbeats
  const metricAccent = (beat: number) => {
    const p = ((beat % BAR) + BAR) % BAR
    if (Math.abs(p) < 0.06) return 0.1
    if (Math.abs(p - 2) < 0.06) return 0.05
    if (Math.abs(p - Math.round(p)) < 0.06) return 0.0
    return -0.05
  }

  // --- harmony: one chord per bar, functional, with a cadence at the end ----
  interface Bar { start: number; root: number; scale: number[] }
  const bars: Bar[] = []
  const nBars = Math.max(1, Math.ceil(lastBeat / BAR))
  for (let b = 0; b < nBars; b++) {
    const beat = b * BAR
    // the emotional temperature of whatever is sounding in this bar
    const active = q.filter((x) => x.start < beat + BAR && x.start + x.dur > beat)
    const idxs = active.map((x) => score.events.indexOf(x.ev))
    const heat = idxs.length ? idxs.reduce((a, i) => a + heats[i], 0) / idxs.length : 0.4
    const minor = heat > 0.62 || active.some((x) => COMBATIVE.has(x.ev.kind))
    const scale = minor ? MINOR : MAJOR
    const prog = minor ? MINOR_PROG : MAJOR_PROG
    // approach the final bar with a dominant — a real cadence
    const isPenultimate = b === nBars - 1 && nBars > 1
    bars.push({ start: beat, root: isPenultimate ? 4 : prog[b % prog.length], scale })
  }
  const barAt = (beat: number) => bars[Math.max(0, Math.min(bars.length - 1, Math.floor(beat / BAR)))]

  const bassNote = (startBeat: number, durBeats: number, semis: number, vel: number) =>
    notes.push({
      voice: 'bass',
      speaker: -1,
      phrase: -1,
      // bass players anticipate microscopically; it reads as "in the pocket"
      startBeat: startBeat + sw(startBeat) - 0.008 + push,
      durBeats,
      midis: [opts.bassBase + semis],
      vel: Math.max(0.15, Math.min(1, vel + metricAccent(startBeat) * 0.5)),
    })

  // --- bass + comping, per bar --------------------------------------------
  let prevVoicing: number[] | null = null
  bars.forEach((bar, bi) => {
    const next = bars[bi + 1]
    const span = Math.min(BAR, lastBeat - bar.start)
    if (span <= 0) return
    const active = q.filter((x) => x.start < bar.start + BAR && x.start + x.dur > bar.start)
    const inten = active.length ? active.reduce((a, x) => a + x.ev.intensity, 0) / active.length : 0.5
    const rootVel = Math.min(1, 0.42 + inten * 0.22)
    const root = degToSemis(bar.scale, bar.root)

    if (bassStyle === 'walking') {
      const cycle = [bar.root, bar.root + 2, bar.root + 4, bar.root + 2]
      for (let beat = 0; beat < span; beat++) {
        const isLast = beat === Math.floor(span) - 1
        const deg = isLast && next && next.root !== bar.root ? next.root - 1 : cycle[beat % 4]
        bassNote(bar.start + beat, 0.92, degToSemis(isLast && next ? next.scale : bar.scale, deg), beat === 0 ? rootVel : 0.36)
      }
    } else if (bassStyle === 'rootFifth') {
      bassNote(bar.start, Math.min(1.9, span), root, rootVel)
      if (span > 2) bassNote(bar.start + 2, Math.min(1.9, span - 2), degToSemis(bar.scale, bar.root + 4), 0.42)
    } else if (bassStyle === 'offbeat') {
      for (let beat = 0; beat + 0.5 < span; beat++) bassNote(bar.start + beat + 0.5, 0.38, root, 0.52)
    } else if (bassStyle === 'boom') {
      bassNote(bar.start, Math.min(1.6, span), root, rootVel)
      if (span > 2.75) bassNote(bar.start + 2.75, 0.7, root, 0.36)
    } else {
      bassNote(bar.start, Math.max(1, span * 0.96), root, rootVel)
      if (span >= 3) bassNote(bar.start + 2, span - 2.1, degToSemis(bar.scale, bar.root + 4), 0.34)
    }

    // comping: voice-led triad so chords move by common tone
    const pcs = [0, 2, 4].map((d) => opts.padBase + degToSemis(bar.scale, bar.root + d))
    const voicing = voiceLead(prevVoicing, pcs, opts.padBase + 4)
    prevVoicing = voicing
    const compVel = Math.min(0.5, 0.2 + inten * 0.08)

    if (compStyle === 'arp') {
      const cyc = [0, 1, 2, 1]
      for (let e = 0; e * 0.5 < span - 0.25; e++) {
        const beat = bar.start + e * 0.5
        notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: beat + sw(beat) + laidBack * 0.5, durBeats: 0.48, midis: [voicing[cyc[e % 4]]], vel: compVel + metricAccent(beat) * 0.4 })
      }
    } else if (compStyle === 'stabs') {
      for (const off of [1.5, 3.5]) {
        if (off < span) {
          const beat = bar.start + off
          notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: beat + sw(beat) + laidBack, durBeats: 0.3, midis: voicing, vel: Math.min(0.6, compVel + 0.18) })
        }
      }
    } else if (compStyle === 'strum') {
      for (const off of [0, 1.5, 2, 3.5]) {
        if (off >= span) continue
        const beat = bar.start + off
        const down = off % 1 === 0
        voicing.forEach((m, ti) =>
          notes.push({
            voice: 'pad', speaker: -1, phrase: -1,
            // a strum is a fast roll, downstrokes low→high, upstrokes high→low
            startBeat: beat + sw(beat) + laidBack * 0.5 + (down ? ti : voicing.length - 1 - ti) * 0.025,
            durBeats: down ? 1.1 : 0.5,
            midis: [m], vel: compVel + (down ? 0.06 : -0.02),
          }),
        )
      }
    } else {
      voicing.forEach((m, ti) =>
        notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: bar.start + ti * 0.05, durBeats: span - ti * 0.05, midis: [m], vel: compVel }),
      )
    }
  })

  // --- drums: pattern + accents + ghost notes + fills ----------------------
  if (drumStyle) {
    const K = 36, S = 38, H = 42, O = 46, R = 51
    const PATTERNS: Record<string, [number, number, number][]> = {
      swing: [[R, 0, 0.5], [R, 1, 0.38], [R, 1.66, 0.34], [R, 2, 0.5], [R, 3, 0.38], [R, 3.66, 0.34], [H, 1, 0.3], [H, 3, 0.3], [K, 0, 0.22], [K, 2, 0.18]],
      boombap: [[K, 0, 0.92], [K, 1.75, 0.72], [S, 1, 0.88], [S, 3, 0.88], [S, 2.5, 0.16], [S, 3.75, 0.14], [H, 0, 0.42], [H, 0.5, 0.26], [H, 1, 0.4], [H, 1.5, 0.26], [H, 2, 0.42], [H, 2.5, 0.26], [H, 3, 0.4], [H, 3.5, 0.26]],
      backbeat: [[K, 0, 0.82], [K, 2, 0.7], [S, 1, 0.78], [S, 3, 0.78], [H, 0, 0.36], [H, 0.5, 0.24], [H, 1, 0.34], [H, 1.5, 0.24], [H, 2, 0.36], [H, 2.5, 0.24], [H, 3, 0.34], [H, 3.5, 0.24]],
      pop: [[K, 0, 0.86], [K, 1.5, 0.6], [K, 2, 0.76], [S, 1, 0.82], [S, 3, 0.82], [H, 0.5, 0.3], [H, 1.5, 0.3], [H, 2.5, 0.3], [O, 3.5, 0.36]],
      fourfloor: [[K, 0, 0.95], [K, 1, 0.95], [K, 2, 0.95], [K, 3, 0.95], [O, 0.5, 0.45], [O, 1.5, 0.45], [O, 2.5, 0.45], [O, 3.5, 0.45], [S, 1, 0.6], [S, 3, 0.6]],
    }
    const patt = PATTERNS[drumStyle]
    const totalBars = Math.ceil(lastBeat / BAR)
    let d = 0
    for (let bar = 0; bar < totalBars; bar++) {
      const fillBar = totalBars > 2 && bar % 4 === 3 && bar < totalBars - 1
      for (const [piece, off, vel] of patt) {
        const beat = bar * BAR + off
        if (beat >= lastBeat) continue
        // a fill replaces the last beat of the bar
        if (fillBar && off >= 3) continue
        // snare & hats sit fractionally behind the beat in laid-back styles;
        // the kick stays put — that difference IS the feel
        const feel = piece === K ? push : laidBack + push
        notes.push({
          voice: 'drums', speaker: -1, phrase: -1,
          startBeat: beat + sw(beat) + feel + rand(d++) * 0.006,
          durBeats: 0.25,
          midis: [piece],
          // bar-to-bar variation so no two bars are identical
          vel: Math.max(0.08, Math.min(1, vel * (1 + rand(d++) * 0.07) + (bar % 4 === 0 && off === 0 ? 0.05 : 0))),
        })
      }
      if (fillBar) {
        const fill = [[S, 3, 0.4], [S, 3.25, 0.5], [S, 3.5, 0.62], [S, 3.75, 0.78]] as [number, number, number][]
        for (const [piece, off, vel] of fill) {
          const beat = bar * BAR + off
          if (beat < lastBeat) notes.push({ voice: 'drums', speaker: -1, phrase: -1, startBeat: beat + push, durBeats: 0.2, midis: [piece], vel })
        }
      }
    }
  }

  // --- melody: metrical phrases that play off the counterparty -------------
  let lift = 0
  let seed = 1
  let prevTail: number[] = []

  q.forEach((qe, i) => {
    const ev = qe.ev
    const si = Math.max(0, score.speakers.indexOf(ev.speaker))
    const base = opts.speakerBases[si % opts.speakerBases.length]
    const bar = barAt(qe.start)
    const scale = COMBATIVE.has(ev.kind) ? MINOR : bar.scale

    if (COMBATIVE.has(ev.kind)) lift = 0
    else if (CONSONANT.has(ev.kind) || ev.intensity < 0.55) lift = Math.min(6, lift + 1)

    // rhythm first, then a melody shaped to fit it — the way a player thinks
    const rhythm = rhythmFor(qe.dur, i + ev.turn, driving || ev.intensity > 0.75)
    const spec = buildPhrase(ev, { scale, lift, chordRoot: bar.root, prevTail, intensity: ev.intensity }, rhythm.length)
    let degs = spec.degs.slice(0, rhythm.length)
    while (degs.length < rhythm.length) degs.push(degs[degs.length - 1] ?? 0)
    if (!spec.staccato) degs = smoothLeaps(degs)

    const octave = spec.octave < 0 && base < 60 ? 0 : spec.octave
    const harmony = ev.kind === 'agreement' ? (lift >= 4 ? [2, 5] : [2]) : ev.kind === 'answer' && lift >= 2 ? [2] : []
    const nextStart = q[i + 1]?.start ?? lastBeat
    const phraseEnd = qe.start + qe.dur
    const ring = Math.max(0, Math.min(4, nextStart - phraseEnd + 0.5)) // sing into the gap
    const peakIdx = Math.max(0, degs.indexOf(Math.max(...degs)))

    turnMarks.push({ turn: ev.turn, startBeat: qe.start })

    let cursor = qe.start
    const sounded: number[] = [] // what actually played — that is what gets quoted
    degs.forEach((deg, ni) => {
      const gridBeat = cursor
      const value = rhythm[ni]
      cursor += value
      const isLast = ni === degs.length - 1
      const strong = Math.abs(gridBeat - Math.round(gridBeat)) < 0.01 && Math.round(gridBeat) % 2 === Math.round(bar.start) % 2
      // strong beats land on chord tones; the quoted head is never touched
      const shaped = strong && ni >= 2 ? snapToChordTone(deg, barAt(gridBeat).root) : deg
      sounded.push(shaped)

      // expression: metric accent + phrase arc + correlated drift
      const accent = metricAccent(gridBeat)
      const arc = 0.08 * (1 - Math.abs(ni - peakIdx) / Math.max(1, degs.length)) - (isLast ? 0.05 : 0)
      const vel = Math.max(0.15, Math.min(1, 0.3 + ev.intensity * 0.45 + lift * 0.028 + accent + arc + rand(seed++) * 0.03))
      const timing = sw(gridBeat) + (spec.staccato ? push : laidBack * 0.6 + push) + drift(seed++) * 0.012

      // legato notes overlap slightly so the line is truly connected; even a
      // staccato phrase gives its final note length — players always do
      const dur = spec.staccato
        ? isLast ? value * 0.85 + ring * 0.6 : value * 0.5
        : value * 0.98 + 0.04 + (isLast ? ring : 0)
      const chordDegs = harmony.length && ni % 2 === 0 ? fixTritones(scale, [shaped, ...harmony.map((h) => shaped + h)]) : [shaped]
      const midis = chordDegs.map((cd) => Math.max(31, Math.min(96, base + degToSemis(scale, cd) + octave + (spec.chrom[ni] ?? 0))))

      // a grace note leaning into the phrase peak — the most human ornament there is
      if (!spec.staccato && ni === peakIdx && ni > 0 && value >= 1) {
        notes.push({
          voice: 'melody', speaker: si, phrase: i,
          startBeat: gridBeat + timing - 0.12, durBeats: 0.11,
          midis: [Math.max(31, Math.min(96, midis[0] - (scale === MINOR ? 2 : 1)))],
          vel: vel * 0.55,
        })
      }

      notes.push({ voice: 'melody', speaker: si, phrase: i, startBeat: gridBeat + timing, durBeats: dur, midis, vel, staccato: spec.staccato })
    })

    prevTail = sounded.slice(-2)
  })

  // --- cadence: collaborative pieces EARN a resolution ---------------------
  let endBeat = Math.ceil(lastBeat / BAR) * BAR
  const last = q[q.length - 1]?.ev
  const endedWarm = last && !COMBATIVE.has(last.kind) && lift > 0
  const padBase = opts.padBase
  if (endedWarm) {
    // V → I(add9), the "we made a thing" landing
    bassNote(endBeat, 2, 7, 0.5)
    voiceLead(prevVoicing, [7, 11, 14].map((s) => padBase + s), padBase + 4).forEach((m, ti) =>
      notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: endBeat + ti * 0.05, durBeats: 2, midis: [m], vel: 0.3 }),
    )
    bassNote(endBeat + 2, 4, 0, 0.55)
    ;[0, 4, 7, 14].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: endBeat + 2 + ti * 0.05, durBeats: 4, midis: [padBase + s], vel: 0.34 }),
    )
    endBeat += 6
  } else if (last) {
    bassNote(endBeat, 3, 0, 0.5)
    ;[0, 3, 7].forEach((s, ti) =>
      notes.push({ voice: 'pad', speaker: -1, phrase: -1, startBeat: endBeat + ti * 0.05, durBeats: 3, midis: [padBase + s], vel: 0.28 }),
    )
    endBeat += 4
  }

  const heat = q.map((qe, i) => ({ beat: qe.start, intensity: heats[i] }))
  return { notes, turnMarks, endBeat, heat }
}

// --- tempo arc -------------------------------------------------------------
// A monotonic beat→seconds clock. Local tempo follows the emotional temperature
// (a heated stretch literally speeds up) and eases into the final bars — the
// ritardando every ensemble plays at a cadence without being told to.
export function makeClock(planned: Plan, baseBpm: number): (beat: number) => number {
  const step = 0.25
  const beats = [0]
  const times = [0]
  let t = 0
  const heatAt = (beat: number) => {
    let cur = 0.4
    for (const h of planned.heat) {
      if (h.beat <= beat) cur = h.intensity
      else break
    }
    return cur
  }
  const ritStart = planned.endBeat - 6
  for (let b = step; b <= planned.endBeat + 2; b += step) {
    const mid = b - step / 2
    let bpm = baseBpm * (0.9 + 0.35 * heatAt(mid))
    if (mid > ritStart) bpm *= Math.max(0.82, 1 - ((mid - ritStart) / 6) * 0.18)
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
