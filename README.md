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
| Each speaker | one instrument / colour / register (all voices share one key) |
| Every turn | opens by quoting the counterparty's tail — real call-and-response; a challenge quotes it *inverted* (arguing with the same material); phrase endings ring into the next entrance, so the line never breaks |
| Turn length | phrase length |
| Question | rising contour, hanging unresolved on the 6th degree |
| Answer | descends and resolves home |
| Agreement / building on | reuses the other voice's motif, harmonised in thirds & sixths |
| Sustained collaboration | the **lift arc** — register climbs, harmony thickens, dynamics swell |
| Challenge / contradiction | dark natural minor, low register, driving staccato, a chromatic lean that *resolves* — tension, never noise |
| Interruption | short, cut off, an octave up |
| Emotional temperature | tempo & dynamics arc (heat = faster, louder) + major ↔ minor mode |
| A collaborative ending | earns a V → I(add9) cadence; a combative one ends on a bare low minor chord |

Under the voices, a generated accompaniment (bass root motion + soft rolled
triads, I–vi–IV–V when warm, i–VI–III–VII when dark) gives the ear a floor.
Composition is pure and deterministic ([src/compose.ts](src/compose.ts)) — the
check suite asserts on real note plans (no bare-tritone chords anywhere, ever).

### Styles

Seven genre palettes — same conversation counterpoint, different worlds. Genre
identity lives in the arrangement layer: per-style rhythm section (synthesized
kick/snare/hats/ride patterns), bass style, comping style, swing, and a natural
default tempo.

| Palette | Inspiration | Arrangement |
|---|---|---|
| Orchestra | Bach / Beethoven grandeur | strings, winds & horns · walking continuo bass · organ arpeggio comping |
| Big band | Sinatra-era swing | trumpet/sax/trombone · walking upright bass · piano stabs · swing ride, 116 BPM |
| Hot jazz | Louis Armstrong-style hot five | trumpet & clarinet leads · tuba two-feel · strummed comping |
| 90s hip-hop | boom bap | piano/organ/electric guitar · sub bass locked to the kick · 88 BPM |
| Modern country | radio country | acoustic/electric guitars & fiddle · root-fifth bass · strums · backbeat |
| Pop anthem | modern pop | piano & guitars · driving strums · pop kit |
| Festival EDM | Avicii-style four-on-the-floor | piano + pluck leads · offbeat sub bass · saw pad · 126 BPM |

Samples are vendored in `public/samples/` from
[nbrosowsky/tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)
(VSCO2 Community Edition et al., CC licenses). Drums are synthesized (no
samples), and a hidden all-synth palette takes over automatically if sample
loading ever fails.

## Run

```bash
npm install
npm run dev            # web, http://localhost:5173  (heuristic analysis, no key needed)
npm run build          # production build to dist/
npm run check          # asserts the two demos sound structurally different
```

Playback requires a click (Web Audio autoplay policy) — hit **Listen**.

### Live Claude analysis

The SDK reads `ANTHROPIC_API_KEY` from the process env, so a system-level env var
just works — no `.env` needed.

- **Local dev:** `npm run dev` serves `/api/analyze` via a Vite middleware
  ([vite.config.ts](vite.config.ts)) sharing the same core as the function, so
  live Sonnet 5 analysis runs on your machine.
- **Production:** deploy on Vercel (auto-detects Vite + serves `api/`); set
  `ANTHROPIC_API_KEY` in the project env.

The client calls `/api/analyze`; on any failure (no key, offline) it silently
falls back to the on-device heuristic. See [.env.example](.env.example).

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
