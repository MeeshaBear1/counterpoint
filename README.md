# Counterpoint

Paste a conversation. Hear its **structure** as music. A good-faith exchange
sounds consonant — voices in related keys, phrases answering each other, harmony
when people agree. An argument sounds like what it is — clashing tritones,
interruptions, voices ignoring each other's motifs. Purely beautiful,
deliberately useless.

Single-page React + Tone.js app, wrapped as native iOS & Android via Capacitor.

## How it works

1. **Analysis** — the transcript's *structure* (not its music) is labelled as a
   strict JSON "score": an array of events `{ speaker, turn, startBeat,
   durationBeats, kind, motifRef, intensity }`. Two paths, identical shape:
   - **Claude** (`claude-sonnet-5`) via the serverless proxy `api/analyze.ts`,
     using a forced tool call for guaranteed JSON.
   - **On-device heuristic** ([src/heuristic.ts](src/heuristic.ts)) — the offline
     fallback and the reference definition of the mapping. The app is fully
     playable with no API key.
2. **Rendering** — the deterministic engine ([src/engine.ts](src/engine.ts))
   turns that score into notes with Tone.js. All composition lives in code; the
   LLM only labels conversational structure.

### The mapping (also shown in the app's legend)

| Structure | Music |
|---|---|
| Each speaker | one instrument / colour / register |
| Turn length | phrase length |
| Question | rising, unresolved contour |
| Answer | picks up the question's motif and resolves home |
| Agreement / building on | reuses the other voice's motif, harmonised in thirds & sixths |
| Challenge / contradiction | tritone clash against the melody |
| Interruption | short, cut off, an octave up |
| Emotional temperature | tempo & dynamics arc (heat = faster, louder) |

## Run

```bash
npm install
npm run dev            # web, http://localhost:5173  (heuristic analysis, no key needed)
npm run build          # production build to dist/
npm run check          # asserts the two demos sound structurally different
```

Playback requires a click (Web Audio autoplay policy) — hit **Listen**.

### Live Claude analysis

Deploy on Vercel (auto-detects Vite + serves `api/`). Set `ANTHROPIC_API_KEY`
in the project env. The client calls `/api/analyze`; on any failure it silently
falls back to the heuristic. See [.env.example](.env.example).

### Mobile (iOS + Android)

Capacitor wraps the same `dist/` build; Tone.js runs in the platform WebView.

```bash
npm run android        # build + sync + open Android Studio
npm run ios            # build + sync + open Xcode (macOS only)
```

The Android project lives in `android/`. Generate iOS on macOS with
`npx cap add ios`. For live analysis on device, set `VITE_API_BASE` to your
deployed origin before building.

## Stack

Vite · React · TypeScript · Tailwind · Tone.js · Capacitor · Anthropic API
