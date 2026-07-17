import { analyzeHeuristic } from './heuristic'
import { parseTranscript, validateScore, type Score } from './score'

// Where the serverless proxy lives. Relative on web (same origin); mobile builds
// set VITE_API_BASE to the deployed origin. Empty + no key → heuristic only.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export interface AnalyzeResult {
  score: Score
  source: 'anthropic' | 'heuristic'
}

// Try the Anthropic-backed proxy; fall back to the local analyzer on any failure
// (no backend deployed, offline mobile, rate limit, malformed response).
export async function analyze(raw: string): Promise<AnalyzeResult> {
  const turns = parseTranscript(raw)
  const fallback = () => ({ score: analyzeHeuristic(turns), source: 'heuristic' as const })
  if (turns.length < 2) return fallback()

  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: raw }),
    })
    if (!res.ok) return fallback()
    const data = await res.json()
    if (validateScore(data)) return { score: data, source: 'anthropic' }
    return fallback()
  } catch {
    return fallback()
  }
}
