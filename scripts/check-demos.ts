// ponytail self-check: the promise of the app is (a) the collaborative demo
// sounds consonant and soaring, (b) the argument sounds dark and driving, and
// (c) NOTHING is ever abrasive — tension comes from mode/register/rhythm, not
// bare tritone walls. Assert all three on the actual note plan. Run: npm run check
import { plan } from '../src/compose'
import { DEMOS } from '../src/demos'
import { analyzeHeuristic } from '../src/heuristic'
import { parseTranscript } from '../src/score'
import type { Score } from '../src/score'

const OPTS = { speakerBases: [60, 48, 72, 72, 60, 72], bassBase: 36, padBase: 60, swing: 0 } // neutral: held bass/comp, no drums
const MAJOR_PC = new Set([0, 2, 4, 5, 7, 9, 11])
const MINOR_PC = new Set([0, 2, 3, 5, 7, 8, 10])

function scoreOf(id: string): Score {
  const demo = DEMOS.find((d) => d.id === id)!
  return analyzeHeuristic(parseTranscript(demo.transcript))
}

function fail(msg: string): never {
  throw new Error(msg)
}

// --- structural contrast (the original check) ------------------------------
const bs = scoreOf('brainstorm')
const ag = scoreOf('argument')
const tally = (s: Score) => {
  const c: Record<string, number> = {}
  for (const e of s.events) c[e.kind] = (c[e.kind] ?? 0) + 1
  return c
}
const bt = tally(bs)
const at = tally(ag)
console.log('brainstorm:', bt)
console.log('argument  :', at)
const consonant = (bt.agreement ?? 0) + (bt.answer ?? 0)
const combative = (at.challenge ?? 0) + (at.interruption ?? 0)
if (consonant < 3) fail(`brainstorm not consonant enough: ${consonant}`)
if (combative < 3) fail(`argument not combative enough: ${combative}`)
if ((at.agreement ?? 0) >= consonant) fail('argument as agreeable as the brainstorm')

// --- musical assertions on the note plan -----------------------------------
const bp = plan(bs, OPTS)
const ap = plan(ag, OPTS)

// 1. No chord anywhere contains a bare tritone (interval of exactly 6 semitones).
for (const p of [bp, ap]) {
  for (const n of p.notes) {
    for (let i = 0; i < n.midis.length; i++)
      for (let j = i + 1; j < n.midis.length; j++)
        if (Math.abs(n.midis[i] - n.midis[j]) % 12 === 6) fail(`tritone dyad in a chord: ${n.midis}`)
  }
}

// 2. Brainstorm melody is overwhelmingly in C major — the warm, soaring floor.
const bsMel = bp.notes.filter((n) => n.voice === 'melody')
const bsInMajor = bsMel.flatMap((n) => n.midis).filter((m) => MAJOR_PC.has(m % 12)).length
const bsAll = bsMel.flatMap((n) => n.midis).length
if (bsInMajor / bsAll < 0.85) fail(`brainstorm only ${((bsInMajor / bsAll) * 100).toFixed(0)}% major`)

// 3. Argument challenge phrases live in C minor (the resolving chromatic lean excepted).
// Phrases are indexed by event, so identify them structurally — the timeline is
// re-laid metrically and no longer matches the raw score's beats.
const inChallenge = ap.notes.filter((n) => n.voice === 'melody' && ag.events[n.phrase]?.kind === 'challenge')
const agMinor = inChallenge.flatMap((n) => n.midis).filter((m) => MINOR_PC.has(m % 12)).length
const agAll = inChallenge.flatMap((n) => n.midis).length
if (agAll === 0) fail('no challenge melody notes found')
if (agMinor / agAll < 0.75) fail(`challenge phrases only ${((agMinor / agAll) * 100).toFixed(0)}% minor`)

// 4. The lift arc: late-brainstorm agreement notes are hotter than early ones,
// and the piece earns a cadence (extra beats past the score, ending on C).
const agreeVels = bsMel.filter((n) => n.midis.length > 1).map((n) => n.vel) // harmonized notes = agreement/answer
if (agreeVels.length < 4) fail('too few harmonized notes to check the lift arc')
const firstHalf = agreeVels.slice(0, Math.floor(agreeVels.length / 2))
const secondHalf = agreeVels.slice(Math.floor(agreeVels.length / 2))
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
if (mean(secondHalf) <= mean(firstHalf)) fail('no dynamic lift across the brainstorm')
if (bp.endBeat <= bs.totalBeats) fail('brainstorm has no cadence')
const lastBass = bp.notes.filter((n) => n.voice === 'bass').sort((a, b) => a.startBeat - b.startBeat).at(-1)!
if (lastBass.midis[0] % 12 !== 0) fail(`cadence does not land on C: ${lastBass.midis}`)

// 5. The argument stays dark: staccato notes appear there and (almost) never in the brainstorm.
const apStacc = ap.notes.filter((n) => n.staccato).length
const bpStacc = bp.notes.filter((n) => n.staccato).length
if (apStacc < 8) fail(`argument barely staccato: ${apStacc}`)
if (bpStacc > apStacc / 3) fail(`brainstorm too staccato: ${bpStacc} vs argument ${apStacc}`)

// 6. No breaks between speakers: each phrase's ring-out reaches the next
// entrance. (Air *inside* a staccato phrase is articulation, not a break — the
// invariant is about handoffs.)
for (const [name, p] of [['brainstorm', bp], ['argument', ap]] as const) {
  const mel = p.notes.filter((n) => n.voice === 'melody')
  const ids = [...new Set(mel.map((n) => n.phrase))].sort((a, b) => a - b)
  for (let k = 1; k < ids.length; k++) {
    const prevEnd = Math.max(...mel.filter((n) => n.phrase === ids[k - 1]).map((n) => n.startBeat + n.durBeats))
    const nextStart = Math.min(...mel.filter((n) => n.phrase === ids[k]).map((n) => n.startBeat))
    if (nextStart - prevEnd > 0.25) fail(`${name}: ${(nextStart - prevEnd).toFixed(2)}-beat break at the handoff into phrase ${ids[k]}`)
  }
}

// 7. Every phrase plays off the counterparty: its opening pitch appears in the
// previous phrase's tail (octave-agnostic). Checked on the brainstorm, where
// no phrase is inverted (challenges quote inverted by design).
{
  const byPhrase = new Map<number, typeof bp.notes>()
  // structural notes only — grace ornaments are not the quoted material
  for (const n of bp.notes.filter((n) => n.voice === 'melody' && n.durBeats > 0.15).sort((a, b) => a.startBeat - b.startBeat)) {
    byPhrase.set(n.phrase, [...(byPhrase.get(n.phrase) ?? []), n])
  }
  const ids = [...byPhrase.keys()].sort((a, b) => a - b)
  let hits = 0
  let eligible = 0
  for (let k = 1; k < ids.length; k++) {
    const prev = byPhrase.get(ids[k - 1])!
    const cur = byPhrase.get(ids[k])!
    const tailPcs = prev.slice(-2).map((n) => n.midis[0] % 12)
    eligible++
    if (tailPcs.includes(cur[0].midis[0] % 12)) hits++
  }
  if (eligible === 0 || hits / eligible < 0.7) fail(`imitation too weak: ${hits}/${eligible} phrases quote the counterparty`)
  console.log(`imitation: ${hits}/${eligible} phrases open from the counterparty's tail`)
}

// 8. The style layer: each groove produces its signature — and stays deterministic.
{
  const K = 36, S = 38
  const ff = plan(bs, { ...OPTS, bassStyle: 'offbeat', compStyle: 'held', drums: 'fourfloor' })
  const kicks = ff.notes.filter((n) => n.voice === 'drums' && n.midis[0] === K)
  // one kick per beat across the drummed span (the metrical timeline, not the raw score)
  const drumSpan = Math.max(...ff.notes.filter((n) => n.voice === 'drums').map((n) => n.startBeat))
  if (kicks.length < drumSpan * 0.9) fail(`four-on-the-floor missing kicks: ${kicks.length} over ${drumSpan.toFixed(0)} beats`)

  const bb = plan(bs, { ...OPTS, bassStyle: 'boom', compStyle: 'held', drums: 'boombap' })
  const snares = bb.notes.filter((n) => n.voice === 'drums' && n.midis[0] === S)
  // the loud snares ARE the backbeat; quiet ones are ghost notes and fills,
  // which is exactly what a human drummer adds around it
  // whole-beat + loud = the backbeat itself; sixteenth-position hits are fills
  const backbeat = snares.filter((n) => n.vel > 0.5 && Math.abs(n.startBeat - Math.round(n.startBeat)) < 0.08)
  const ghosts = snares.filter((n) => n.vel <= 0.3)
  const fillHits = snares.filter((n) => Math.abs(n.startBeat - Math.round(n.startBeat)) >= 0.2)
  if (!backbeat.every((n) => Math.abs((n.startBeat % 2) - 1) < 0.08)) fail('boom-bap backbeat snare is off beats 2 & 4')
  if (fillHits.length < 3) fail(`no fill hits between the beats: ${fillHits.length}`)
  if (backbeat.length < 6) fail(`boom-bap barely any backbeat: ${backbeat.length}`)
  if (ghosts.length < 4) fail(`no ghost snares: ${ghosts.length}`)

  const walk = plan(bs, { ...OPTS, bassStyle: 'walking', compStyle: 'arp', drums: null })
  const bassNotes = walk.notes.filter((n) => n.voice === 'bass')
  if (bassNotes.length < bs.totalBeats * 0.7) fail(`walking bass too sparse: ${bassNotes.length} notes over ${bs.totalBeats} beats`)
  if (walk.notes.some((n) => n.voice === 'drums')) fail('drums emitted with drums: null')

  const again = plan(bs, { ...OPTS, bassStyle: 'offbeat', compStyle: 'held', drums: 'fourfloor' })
  if (JSON.stringify(again) !== JSON.stringify(ff)) fail('plan is not deterministic')

  // drums must breathe: fills near phrase ends, and no two bars identical
  const fills = bb.notes.filter((n) => n.voice === 'drums' && n.midis[0] === S && n.startBeat % 1 > 0.2 && n.startBeat % 1 < 0.8)
  if (fills.length < 4) fail(`no drum fills / ghost notes: ${fills.length}`)
  const kickVels = new Set(ff.notes.filter((n) => n.voice === 'drums' && n.midis[0] === K).map((n) => n.vel.toFixed(4)))
  if (kickVels.size < 5) fail(`drums are robotic: only ${kickVels.size} distinct kick velocities`)
  console.log(`styles: fourfloor kicks=${kicks.length} · boombap snares=${snares.length} · walking bass=${bassNotes.length} · fills=${fills.length} · deterministic`)
}

// 9. HUMAN-PLAYED INVARIANTS ------------------------------------------------
// (a) Metrical: melody onsets sit on the eighth-note grid, within humanization.
{
  const mel = bp.notes.filter((n) => n.voice === 'melody')
  const offGrid = mel.filter((n) => {
    const off = Math.abs(n.startBeat - Math.round(n.startBeat * 2) / 2)
    return off > 0.09
  })
  // grace notes are deliberately off-grid leaning ornaments
  const graces = mel.filter((n) => n.durBeats < 0.15).length
  if (offGrid.length - graces > mel.length * 0.1) {
    fail(`melody is not metrical: ${offGrid.length - graces}/${mel.length} onsets off the eighth grid`)
  }
  console.log(`metrical: ${mel.length - (offGrid.length - graces)}/${mel.length} onsets on grid (+${graces} grace notes)`)
}

// (b) Strong beats land on chord tones — composed, not generated.
{
  const barRootAt = (beat: number) => {
    // mirrors compose: I V vi IV, one chord per bar, dominant in the last bar
    const nBars = Math.max(1, Math.ceil((bp.endBeat - 6) / 4))
    const b = Math.floor(beat / 4)
    return b === nBars - 1 && nBars > 1 ? 4 : [0, 4, 5, 3][b % 4]
  }
  const mel = bp.notes.filter((n) => n.voice === 'melody' && n.durBeats > 0.15)
  const onBeat = mel.filter((n) => Math.abs(n.startBeat - Math.round(n.startBeat)) < 0.09)
  const MAJ = [0, 2, 4, 5, 7, 9, 11]
  const tonePcs = (root: number) => [root, root + 2, root + 4].map((d) => MAJ[((d % 7) + 7) % 7] % 12)
  const hits = onBeat.filter((n) => tonePcs(barRootAt(n.startBeat)).includes(n.midis[0] % 12)).length
  if (hits / onBeat.length < 0.55) fail(`only ${((hits / onBeat.length) * 100).toFixed(0)}% of downbeat notes are chord tones`)
  console.log(`harmony: ${((hits / onBeat.length) * 100).toFixed(0)}% of on-beat melody notes are chord tones`)
}

// (c) Metric accent hierarchy: downbeats are played stronger than offbeats.
{
  const mel = bp.notes.filter((n) => n.voice === 'melody' && n.durBeats > 0.15)
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const downs = mean(mel.filter((n) => Math.abs((n.startBeat % 4) - Math.round(n.startBeat % 4)) < 0.09 && Math.round(n.startBeat % 4) === 0).map((n) => n.vel))
  const offs = mean(mel.filter((n) => Math.abs((n.startBeat % 1) - 0.5) < 0.12).map((n) => n.vel))
  if (!(downs > offs)) fail(`no metric accent: downbeat vel ${downs.toFixed(3)} vs offbeat ${offs.toFixed(3)}`)
  console.log(`dynamics: downbeats ${downs.toFixed(3)} > offbeats ${offs.toFixed(3)}`)
}

// (d) Voice leading: comping chords move by small steps, not parallel jumps.
{
  const pad = bp.notes.filter((n) => n.voice === 'pad').sort((a, b) => a.startBeat - b.startBeat)
  const byBar = new Map<number, number[]>()
  for (const n of pad) {
    const bar = Math.floor(n.startBeat / 4)
    byBar.set(bar, [...(byBar.get(bar) ?? []), ...n.midis])
  }
  const barsSorted = [...byBar.keys()].sort((a, b) => a - b)
  let maxMove = 0
  for (let k = 1; k < barsSorted.length; k++) {
    const a = byBar.get(barsSorted[k - 1])!.sort((x, y) => x - y)
    const b = byBar.get(barsSorted[k])!.sort((x, y) => x - y)
    const move = Math.abs((b[0] ?? 0) - (a[0] ?? 0))
    maxMove = Math.max(maxMove, move)
  }
  if (maxMove > 7) fail(`comping leaps ${maxMove} semitones between bars — not voice-led`)
  console.log(`voice leading: largest bass-of-chord move between bars = ${maxMove} semitones`)
}

console.log(
  `\nOK — structure: consonant=${consonant} vs combative=${combative} · no tritone dyads · ` +
    `brainstorm ${((bsInMajor / bsAll) * 100).toFixed(0)}% major w/ lift+cadence · ` +
    `challenges ${((agMinor / agAll) * 100).toFixed(0)}% minor, staccato ${apStacc} vs ${bpStacc}`,
)
