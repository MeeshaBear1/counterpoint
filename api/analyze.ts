// Serverless proxy (Vercel Node function). Keeps the Anthropic key server-side.
// Returns the same Score shape the client heuristic produces, so the music
// engine renders either identically. Analysis logic lives in ./_core (shared
// with the Vite dev middleware).
import { NoKeyError, scoreFromTranscript } from './_core'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const transcript: string = req.body?.transcript ?? ''
  if (typeof transcript !== 'string' || transcript.trim().length < 2) {
    res.status(400).json({ error: 'empty transcript' })
    return
  }
  try {
    res.status(200).json(await scoreFromTranscript(transcript))
  } catch (e: any) {
    if (e instanceof NoKeyError) res.status(501).json({ error: e.message })
    else res.status(502).json({ error: e?.message ?? 'analyze failed' })
  }
}
