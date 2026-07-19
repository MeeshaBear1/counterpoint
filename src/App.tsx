import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze } from './analyze'
import { DEMOS } from './demos'
import { PALETTES, Player, SPEAKER_COLORS, renderWav } from './engine'
import { parseTranscript, type Score, type Turn } from './score'

type Status = 'idle' | 'analyzing' | 'playing' | 'rendering'
interface Bloom { id: number; x: number; y: number; color: string; size: number }

export default function App() {
  const [transcript, setTranscript] = useState(DEMOS[0].transcript)
  const [score, setScore] = useState<Score | null>(null)
  const [source, setSource] = useState<'anthropic' | 'heuristic' | null>(null)
  const [analyzedFor, setAnalyzedFor] = useState<string>('')
  const [status, setStatus] = useState<Status>('idle')
  const [activeTurn, setActiveTurn] = useState(-1)
  const [tempo, setTempo] = useState(96)
  const [paletteId, setPaletteId] = useState(PALETTES[0].id)
  const [blooms, setBlooms] = useState<Bloom[]>([])
  const [nowPlaying, setNowPlaying] = useState<string>('') // label during play-both
  const [error, setError] = useState('')

  const playerRef = useRef<Player | null>(null)
  const bloomId = useRef(0)
  const turnRefs = useRef<(HTMLDivElement | null)[]>([])

  const turns: Turn[] = useMemo(() => parseTranscript(transcript), [transcript])
  const speakers = useMemo(() => score?.speakers ?? [...new Set(turns.map((t) => t.speaker))], [score, turns])
  const colorFor = useCallback(
    (sp: string) => SPEAKER_COLORS[Math.max(0, speakers.indexOf(sp)) % SPEAKER_COLORS.length],
    [speakers],
  )

  useEffect(() => {
    if (!playerRef.current) playerRef.current = new Player(paletteId)
    else playerRef.current.setPalette(paletteId)
  }, [paletteId])

  useEffect(() => () => playerRef.current?.stop(), [])

  // auto-scroll the active line into view
  useEffect(() => {
    if (activeTurn >= 0) turnRefs.current[activeTurn]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeTurn])

  const pushBloom = useCallback((speakerIndex: number, midi: number) => {
    const id = bloomId.current++
    const n = Math.max(1, speakers.length)
    const x = ((speakerIndex + 0.5) / n) * 100
    const y = (1 - Math.max(0, Math.min(1, (midi - 40) / 44))) * 100
    const color = SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length]
    setBlooms((b) => [...b.slice(-40), { id, x, y, color, size: 26 + (midi % 12) * 3 }])
    setTimeout(() => setBlooms((b) => b.filter((x) => x.id !== id)), 1400)
  }, [speakers.length])

  const ensureScore = useCallback(async (text: string): Promise<Score> => {
    if (score && analyzedFor === text) return score
    setStatus('analyzing')
    const { score: s, source: src } = await analyze(text)
    setScore(s); setSource(src); setAnalyzedFor(text)
    return s
  }, [score, analyzedFor])

  const listen = useCallback(async () => {
    setError('')
    playerRef.current?.stop()
    try {
      const s = await ensureScore(transcript)
      setNowPlaying('')
      setStatus('playing')
      await playerRef.current!.play(s, tempo, {
        onTurn: setActiveTurn,
        onNote: pushBloom,
        onEnd: () => { setStatus('idle'); setActiveTurn(-1) },
      })
    } catch (e: any) {
      setError(e?.message ?? 'something broke'); setStatus('idle')
    }
  }, [transcript, tempo, ensureScore, pushBloom])

  const stop = useCallback(() => {
    playerRef.current?.stop(); setStatus('idle'); setActiveTurn(-1); setNowPlaying('')
  }, [])

  // Play the two contrast demos back to back so the difference lands.
  const playBoth = useCallback(async () => {
    setError('')
    playerRef.current?.stop()
    setStatus('playing')
    try {
      for (const demo of DEMOS) {
        setTranscript(demo.transcript)
        setNowPlaying(demo.title)
        const { score: s, source: src } = await analyze(demo.transcript)
        setScore(s); setSource(src); setAnalyzedFor(demo.transcript)
        await new Promise<void>((resolve, reject) => {
          playerRef.current!.play(s, tempo, {
            onTurn: setActiveTurn, onNote: pushBloom, onEnd: () => resolve(),
          }).catch(reject)
        })
        await new Promise((r) => setTimeout(r, 900)) // breath between pieces
      }
    } catch (e: any) {
      setError(e?.message ?? 'playback failed')
    }
    setStatus('idle'); setActiveTurn(-1); setNowPlaying('')
  }, [tempo, pushBloom])

  const record = useCallback(async () => {
    setError('')
    try {
      const s = await ensureScore(transcript)
      setStatus('rendering')
      const blob = await renderWav(s, tempo, paletteId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'counterpoint.wav'; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e?.message ?? 'render failed')
    }
    setStatus('idle')
  }, [transcript, tempo, paletteId, ensureScore])

  const loadDemo = (t: string) => { stop(); setTranscript(t); setScore(null); setAnalyzedFor('') }
  const busy = status !== 'idle'

  return (
    <div className="min-h-full w-full bg-[#06060a] text-[#e7e7ef]">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <header className="mb-6">
          <h1 className="font-display text-5xl font-semibold tracking-tight text-white sm:text-6xl">Counterpoint</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/60">
            Paste a conversation. Hear its structure as music — consonant when people build on each other,
            clashing when they talk past each other. <span className="text-white/40">Purely beautiful, deliberately useless.</span>
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* left: input + controls */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {DEMOS.map((d) => (
                <button key={d.id} onClick={() => loadDemo(d.transcript)}
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10">
                  {d.title}
                </button>
              ))}
            </div>

            <textarea value={transcript} onChange={(e) => { setTranscript(e.target.value); setScore(null); setAnalyzedFor('') }}
              spellCheck={false}
              className="h-64 w-full resize-y rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-white/85 outline-none placeholder:text-white/30 focus:border-white/25"
              placeholder={'Ada: What if we tried it this way?\nRavi: Oh, I like that — and we could…'} />

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={busy ? stop : listen}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90">
                {status === 'analyzing' ? 'Analyzing…' : status === 'playing' ? '■ Stop' : '▶ Listen'}
              </button>
              <button onClick={playBoth} disabled={busy}
                className="rounded-full border border-white/20 px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10 disabled:opacity-40">
                ▶▶ Play both (contrast)
              </button>
              <button onClick={record} disabled={busy}
                className="rounded-full border border-white/20 px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10 disabled:opacity-40">
                {status === 'rendering' ? 'Rendering…' : '⬇ WAV'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="text-xs text-white/60">
                Tempo — {tempo} BPM
                <input type="range" min={60} max={160} value={tempo} onChange={(e) => setTempo(+e.target.value)}
                  className="mt-1 w-full accent-[#ff5c8a]" />
              </label>
              <label className="text-xs text-white/60">
                Palette
                <select value={paletteId} onChange={(e) => { stop(); setPaletteId(e.target.value) }}
                  className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white/85 outline-none">
                  {PALETTES.map((p) => <option key={p.id} value={p.id} className="bg-[#111]">{p.label}</option>)}
                </select>
              </label>
            </div>

            {error && <p className="text-xs text-[#ff8a8a]">{error}</p>}

            {/* legend */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Voices</div>
              <div className="flex flex-wrap gap-3">
                {speakers.map((sp) => (
                  <span key={sp} className="flex items-center gap-1.5 text-sm text-white/80">
                    <span className="h-3 w-3 rounded-full" style={{ background: colorFor(sp), boxShadow: `0 0 10px ${colorFor(sp)}` }} />
                    {sp}
                  </span>
                ))}
              </div>
              <div className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/45">
                question = rising, unresolved · answer = resolves home · agreement = shared motif in thirds, and the music lifts as you build ·
                challenge = dark minor, low &amp; driving · interruption = cut off, an octave up · heat = faster &amp; louder ·
                a collaborative ending earns its cadence
                {source && <span className="ml-1 text-white/30">· analysis: {source === 'anthropic' ? 'Claude' : 'local heuristic'}</span>}
              </div>
            </div>
          </section>

          {/* right: stage + playhead transcript */}
          <section className="flex flex-col gap-4">
            <div className="relative h-40 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40">
              {blooms.map((b) => (
                <span key={b.id} aria-hidden
                  style={{
                    left: `${b.x}%`, top: `${b.y}%`, width: b.size, height: b.size,
                    background: `radial-gradient(circle, ${b.color} 0%, transparent 70%)`,
                    animation: 'bloom 1.4s ease-out forwards',
                  }}
                  className="pointer-events-none absolute rounded-full" />
              ))}
              {nowPlaying && (
                <div className="absolute bottom-2 left-3 text-xs font-medium text-white/70">now playing: {nowPlaying}</div>
              )}
              {status === 'idle' && blooms.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm text-white/25">notes bloom here as they sound</div>
              )}
            </div>

            <div className="max-h-[26rem] overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2">
              {turns.map((t, i) => {
                const c = colorFor(t.speaker)
                const active = i === activeTurn
                return (
                  <div key={i} ref={(el) => { turnRefs.current[i] = el }}
                    className={`flex gap-3 rounded-lg px-3 py-2 transition ${active ? 'bg-white/10' : ''}`}
                    style={active ? { boxShadow: `inset 3px 0 0 ${c}` } : undefined}>
                    <span className="mt-0.5 shrink-0 text-xs font-semibold" style={{ color: c }}>{t.speaker}</span>
                    <span className={`text-sm leading-relaxed transition ${active ? 'text-white' : 'text-white/55'}`}>{t.text}</span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <footer className="mt-10 text-center text-xs text-white/25">
          Counterpoint · structure → music ·{' '}
          <a className="underline decoration-white/20 hover:text-white/40" href="https://github.com/MeeshaBear1/counterpoint">github.com/MeeshaBear1/counterpoint</a>
        </footer>
      </div>
    </div>
  )
}
