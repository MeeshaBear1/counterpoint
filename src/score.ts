// The "score" is the structural analysis of a conversation. The LLM (or the
// local heuristic fallback) produces it; the Tone.js engine renders it. Keeping
// this shape identical on both paths is the whole contract of the app.

export type EventKind =
  | 'statement'
  | 'question'
  | 'answer'
  | 'agreement'
  | 'challenge'
  | 'interruption'

export interface ScoreEvent {
  speaker: string // must be one of Score.speakers
  turn: number // index into the transcript turns — drives the playhead
  startBeat: number
  durationBeats: number
  kind: EventKind
  motifRef: number // which melodic motif this phrase uses; agreement reuses the prior voice's
  intensity: number // 0..1 emotional temperature of this turn
}

export interface Score {
  speakers: string[] // ordered; index = which voice/instrument
  events: ScoreEvent[]
  totalBeats: number
}

export interface Turn {
  speaker: string
  text: string
}

// Parse "Name: text" transcripts. Lines without a speaker prefix are appended to
// the previous turn (multi-line quotes). Blank lines are ignored.
export function parseTranscript(raw: string): Turn[] {
  const turns: Turn[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(/^([A-Za-z0-9 ._'-]{1,30}?)\s*:\s*(.*)$/)
    if (m && m[2] !== undefined && m[1].split(' ').length <= 4) {
      turns.push({ speaker: m[1].trim(), text: m[2].trim() })
    } else if (turns.length) {
      turns[turns.length - 1].text += ' ' + t
    } else {
      turns.push({ speaker: 'Voice', text: t })
    }
  }
  return turns
}

export function speakersOf(turns: Turn[]): string[] {
  const seen: string[] = []
  for (const t of turns) if (!seen.includes(t.speaker)) seen.push(t.speaker)
  return seen
}

// Basic sanity so a malformed LLM response can't crash the engine.
export function validateScore(s: unknown): s is Score {
  if (!s || typeof s !== 'object') return false
  const sc = s as Score
  return (
    Array.isArray(sc.speakers) &&
    sc.speakers.length > 0 &&
    Array.isArray(sc.events) &&
    sc.events.every(
      (e) =>
        typeof e.speaker === 'string' &&
        typeof e.startBeat === 'number' &&
        typeof e.durationBeats === 'number' &&
        typeof e.turn === 'number',
    )
  )
}
