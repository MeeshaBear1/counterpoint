# Copy changes, 2026-10-10 (house-voice sweep)

Voice: `VOICE.md`, copied verbatim from the Common Ground family file with this repo's
paragraph added. Shapes on `src/App.tsx` before and after: all four 0 and 0.

| Where | Before | After | Why |
|---|---|---|---|
| Listen fallback | `something broke` | Playback did not start. Press Listen again. | Names what failed and the button that clears it. |
| Play fallback | `playback failed` | Playback stopped partway. Press Play both again. | Same. |
| WAV fallback | `render failed` | The WAV did not render. Press WAV again. | Same. |

Left alone: the legend, the demo thread labels, and every line of the score itself. The page
carried no tells before the sweep; the three fallbacks were the only reader-facing copy that
broke a rule.

Lint: `tells.py src/App.tsx` CLEAN. Checks: `npm run lint` ok, `npm run check` ok (demo
structure assertions), `npm run build` built.
