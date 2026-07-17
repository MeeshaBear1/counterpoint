// Local, deterministic structural analyzer. It is both the offline fallback for
// the Anthropic call AND the reference definition of what the "score" means, so
// the app is fully playable with no API key. The LLM path returns the same shape
// with better judgement about agreement vs. tension.

import type { EventKind, Score, ScoreEvent, Turn } from './score'

const AGREE =
  /\b(yes|yeah|agree|agreed|exactly|right|totally|absolutely|good point|love (it|that)|makes sense|building on|true|fair|and we could|what if we also|plus we|nice|great)\b/i
const CHALLENGE =
  /\b(no|nope|but|however|disagree|wrong|actually|that'?s not|won'?t work|isn'?t|nonsense|ridiculous|you always|you never|hardly|except|not really|i doubt)\b/i

function words(t: string): number {
  return t.split(/\s+/).filter(Boolean).length
}

function intensityOf(text: string, kind: EventKind): number {
  let i = 0.4
  const bangs = (text.match(/!/g) || []).length
  i += Math.min(bangs * 0.12, 0.3)
  const letters = text.replace(/[^A-Za-z]/g, '')
  const caps = text.replace(/[^A-Z]/g, '').length
  if (letters.length > 6 && caps / letters.length > 0.4) i += 0.25 // SHOUTING
  if (kind === 'challenge' || kind === 'interruption') i += 0.22
  if (kind === 'agreement') i -= 0.05
  if (words(text) > 40) i += 0.08
  return Math.max(0.15, Math.min(1, i))
}

export function analyzeHeuristic(turns: Turn[]): Score {
  const speakers: string[] = []
  for (const t of turns) if (!speakers.includes(t.speaker)) speakers.push(t.speaker)

  const events: ScoreEvent[] = []
  let beat = 0
  const motifBySpeaker = new Map<string, number>()
  let motifCursor = 0
  let openQuestionMotif: number | null = null // a question awaiting its answer

  for (let idx = 0; idx < turns.length; idx++) {
    const turn = turns[idx]
    const prev = idx > 0 ? turns[idx - 1] : null
    const prevEvent = events[events.length - 1]
    const text = turn.text
    const w = words(text)

    // --- classify ---
    const isQuestion = /\?\s*$/.test(text) || /^(what|why|how|when|where|who|do|does|did|is|are|can|could|would|should|will)\b/i.test(text)
    const prevWasQuestion = prev ? /\?\s*$/.test(prev.text) : false
    const prevSameSpeaker = prev?.speaker === turn.speaker
    // an em-dash / double-dash at the end of the previous turn = it got cut off
    const prevCutOff = !!prev && /(—|--)\s*$/.test(prev.text) && !prevSameSpeaker

    let kind: EventKind
    if (prevCutOff) kind = 'interruption'
    else if (isQuestion) kind = 'question'
    else if (prevWasQuestion && !prevSameSpeaker) kind = 'answer'
    else if (CHALLENGE.test(text) && !AGREE.test(text.slice(0, 20))) kind = 'challenge'
    else if (AGREE.test(text)) kind = 'agreement'
    else kind = 'statement'

    // --- phrase length: short turns → quick call-and-response ---
    const durationBeats = Math.max(1, Math.min(16, Math.round(w / 4) + 1))

    // --- motif choice ---
    let motifRef: number
    if (kind === 'agreement' && prevEvent) {
      motifRef = prevEvent.motifRef // develop the other voice's idea
    } else if (kind === 'answer' && openQuestionMotif !== null) {
      motifRef = openQuestionMotif // answer picks up the question's contour...
    } else {
      motifRef = motifCursor % 6
      motifCursor++
    }
    motifBySpeaker.set(turn.speaker, motifRef)
    if (kind === 'question') openQuestionMotif = motifRef
    else if (kind === 'answer') openQuestionMotif = null

    const intensity = intensityOf(text, kind)

    // --- timing: interruptions overlap and truncate the previous phrase ---
    let startBeat = beat
    if (kind === 'interruption' && prevEvent) {
      const cutAt = prevEvent.startBeat + prevEvent.durationBeats * 0.55
      prevEvent.durationBeats = Math.max(0.5, cutAt - prevEvent.startBeat)
      startBeat = cutAt
    }

    events.push({ speaker: turn.speaker, turn: idx, startBeat, durationBeats, kind, motifRef, intensity })
    beat = startBeat + durationBeats + (kind === 'answer' || kind === 'question' ? 0.25 : 0.5)
  }

  return { speakers, events, totalBeats: Math.ceil(beat) }
}
