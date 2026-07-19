// Shared analysis core — used by both the Vercel handler (api/analyze.ts) and
// the Vite dev middleware (vite.config.ts) so live Claude analysis works the
// same in `npm run dev` and in production. Reads ANTHROPIC_API_KEY from the
// process env (the SDK's default), so a system-level env var just works.
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-5'

// One tool the model is forced to call — its input IS the score.
const SCORE_TOOL = {
  name: 'emit_score',
  description: 'Emit the musical score describing the conversation structure.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      speakers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Speaker names in first-appearance order; each maps to one instrument.',
      },
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            speaker: { type: 'string' },
            turn: { type: 'integer', description: '0-based index of the transcript turn this event voices.' },
            startBeat: { type: 'number' },
            durationBeats: { type: 'number' },
            kind: {
              type: 'string',
              enum: ['statement', 'question', 'answer', 'agreement', 'challenge', 'interruption'],
            },
            motifRef: { type: 'integer', description: '0-5; agreement reuses the prior voice’s motifRef, an answer reuses its question’s.' },
            intensity: { type: 'number', description: '0..1 emotional temperature.' },
          },
          required: ['speaker', 'turn', 'startBeat', 'durationBeats', 'kind', 'motifRef', 'intensity'],
        },
      },
      totalBeats: { type: 'number' },
    },
    required: ['speakers', 'events', 'totalBeats'],
  },
}

const SYSTEM = `You analyze the STRUCTURE of a conversation and turn it into a musical score. You are not composing music — you are labeling conversational structure so a deterministic engine can render it.

Rules for the score:
- One event per transcript turn (index it with "turn", 0-based). An interruption may overlap the previous event: give it a startBeat inside the previous event's span.
- durationBeats scales with turn length: short turns = short phrases (1-3 beats), long turns longer (up to ~16).
- Lay events out sequentially in "startBeat" with small gaps, except interruptions which overlap.
- kind: "question" for a genuine question; "answer" when a turn directly answers the immediately preceding question; "agreement" when the speaker builds on / affirms the other's point; "challenge" for contradiction, dismissal, or talking past; "interruption" when a turn cuts the previous one off mid-thought; otherwise "statement".
- motifRef (0-5) is a melodic idea id. When a turn is "agreement", reuse the PREVIOUS event's motifRef (the second voice develops the first's motif). When "answer", reuse the motifRef of the question it answers. Otherwise pick a fresh id.
- intensity 0..1: raise for shouting, exclamation, challenges, and interruptions; lower for calm agreement.
The whole point: a good-faith exchange should read as consonant (shared motifs, agreements), an argument as dissonant (challenges, interruptions, no shared motifs).`

export class NoKeyError extends Error {}

// Tool schemas guide the model but don't guarantee conformance — live Sonnet 5
// omits the derivable top-level fields (speakers/totalBeats) often enough that
// the client's validator rejected every real response and silently fell back to
// the heuristic. Repair what's derivable, clamp per-event values, drop the rest.
const KINDS = ['statement', 'question', 'answer', 'agreement', 'challenge', 'interruption']

function normalizeScore(raw: any): unknown {
  // Seen live: the whole score (or just the events array) JSON-encoded as a
  // string inside one field. Unwrap before repairing.
  const parse = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return v } }
  raw = parse(raw)
  if (raw && typeof raw.events === 'string') {
    const inner = parse(raw.events)
    raw = Array.isArray(inner) ? { ...raw, events: inner } : inner
  }
  if (!raw || !Array.isArray(raw.events)) return raw
  const events = raw.events
    .filter((e: any) => e && typeof e.speaker === 'string' && typeof e.startBeat === 'number' && typeof e.durationBeats === 'number')
    .sort((a: any, b: any) => a.startBeat - b.startBeat)
    .map((e: any, i: number) => ({
      speaker: e.speaker,
      turn: typeof e.turn === 'number' ? e.turn : i,
      startBeat: e.startBeat,
      durationBeats: e.durationBeats,
      kind: KINDS.includes(e.kind) ? e.kind : 'statement',
      motifRef: typeof e.motifRef === 'number' ? e.motifRef : 0,
      intensity: typeof e.intensity === 'number' ? Math.max(0, Math.min(1, e.intensity)) : 0.5,
    }))
  const speakers =
    Array.isArray(raw.speakers) && raw.speakers.length > 0 ? raw.speakers : [...new Set(events.map((e: any) => e.speaker))]
  const totalBeats =
    typeof raw.totalBeats === 'number' ? raw.totalBeats : Math.ceil(Math.max(0, ...events.map((e: any) => e.startBeat + e.durationBeats)))
  return { speakers, events, totalBeats }
}

// Returns the raw score object (the forced tool's input). Throws NoKeyError when
// no key is configured, or a plain Error on any API/parse failure — callers map
// those to the right HTTP status.
export async function scoreFromTranscript(transcript: string): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY) throw new NoKeyError('no key configured')

  const client = new Anthropic()
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'disabled' }, // bounded extraction — no need for adaptive thinking (Sonnet 5's default)
    system: SYSTEM,
    tools: [SCORE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_score' },
    messages: [{ role: 'user', content: `Analyze this transcript:\n\n${transcript}` }],
  })
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('no score in response')
  return normalizeScore(block.input)
}
