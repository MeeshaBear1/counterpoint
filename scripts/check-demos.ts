// ponytail self-check: the whole promise of the app is that the collaborative
// demo sounds consonant and the argument sounds combative. That comes down to
// the structural score, so assert the two scores differ in the ways that drive
// the music. Run: npx esbuild scripts/check-demos.ts --bundle --platform=node --format=cjs | node
import { DEMOS } from '../src/demos'
import { analyzeHeuristic } from '../src/heuristic'
import { parseTranscript } from '../src/score'

function tally(id: string) {
  const demo = DEMOS.find((d) => d.id === id)!
  const s = analyzeHeuristic(parseTranscript(demo.transcript))
  const counts: Record<string, number> = {}
  for (const e of s.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  return counts
}

const brainstorm = tally('brainstorm')
const argument = tally('argument')
console.log('brainstorm:', brainstorm)
console.log('argument  :', argument)

const consonant = (brainstorm.agreement ?? 0) + (brainstorm.answer ?? 0)
const combative = (argument.challenge ?? 0) + (argument.interruption ?? 0)

// The collaborative piece must lean consonant; the argument must lean combative.
if (consonant < 3) throw new Error(`brainstorm not consonant enough: ${consonant} agreement/answer events`)
if (combative < 3) throw new Error(`argument not combative enough: ${combative} challenge/interruption events`)
if ((argument.agreement ?? 0) >= consonant) throw new Error('argument has as much agreement as the brainstorm — they will sound alike')

console.log(`\nOK — brainstorm consonant=${consonant}, argument combative=${combative}. They will sound different.`)
