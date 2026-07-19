// ponytail self-check: the promise of the app is (a) the collaborative demo
// sounds consonant and soaring, (b) the argument sounds dark and driving, and
// (c) NOTHING is ever abrasive — tension comes from mode/register/rhythm, not
// bare tritone walls. Assert all three on the actual note plan. Run: npm run check
import { plan } from '../src/compose'
import { DEMOS } from '../src/demos'
import { analyzeHeuristic } from '../src/heuristic'
import { parseTranscript } from '../src/score'
import type { Score } from '../src/score'

const OPTS = { speakerBases: [60, 48, 72, 72, 60, 72], bassBase: 36, padBase: 60, swing: 0 }
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
const challengeSpans = ag.events.filter((e) => e.kind === 'challenge').map((e) => [e.startBeat, e.startBeat + e.durationBeats])
const inChallenge = ap.notes.filter(
  (n) => n.voice === 'melody' && challengeSpans.some(([a, b]) => n.startBeat >= a - 0.1 && n.startBeat < b),
)
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

// 6. No breaks between speakers: the melody line is continuous. Legato phrase
// endings ring into the next entrance; only staccato bite may leave daylight.
for (const [name, p] of [['brainstorm', bp], ['argument', ap]] as const) {
  const mel = p.notes.filter((n) => n.voice === 'melody').sort((a, b) => a.startBeat - b.startBeat)
  let covered = mel[0].startBeat + mel[0].durBeats
  for (const n of mel.slice(1)) {
    const gap = n.startBeat - covered
    if (gap > 0.6) fail(`${name}: ${gap.toFixed(2)}-beat hole in the melody at beat ${covered.toFixed(1)}`)
    covered = Math.max(covered, n.startBeat + n.durBeats)
  }
}

// 7. Every phrase plays off the counterparty: its opening pitch appears in the
// previous phrase's tail (octave-agnostic). Checked on the brainstorm, where
// no phrase is inverted (challenges quote inverted by design).
{
  const byPhrase = new Map<number, typeof bp.notes>()
  for (const n of bp.notes.filter((n) => n.voice === 'melody')) {
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

console.log(
  `\nOK — structure: consonant=${consonant} vs combative=${combative} · no tritone dyads · ` +
    `brainstorm ${((bsInMajor / bsAll) * 100).toFixed(0)}% major w/ lift+cadence · ` +
    `challenges ${((agMinor / agAll) * 100).toFixed(0)}% minor, staccato ${apStacc} vs ${bpStacc}`,
)
