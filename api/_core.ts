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
  return block.input
}
