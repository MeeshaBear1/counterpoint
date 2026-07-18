import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { NoKeyError, scoreFromTranscript } from './api/_core.js'

// Serve POST /api/analyze during `npm run dev` using the same core as the
// Vercel function, so live Claude analysis works locally with the system-level
// ANTHROPIC_API_KEY (the SDK reads it from process.env automatically).
function analyzeDevApi(): Plugin {
  return {
    name: 'analyze-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/analyze', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end('POST only')
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          const send = (code: number, obj: unknown) => {
            res.statusCode = code
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          try {
            const transcript = JSON.parse(body || '{}').transcript ?? ''
            if (typeof transcript !== 'string' || transcript.trim().length < 2) return send(400, { error: 'empty transcript' })
            send(200, await scoreFromTranscript(transcript))
          } catch (e: any) {
            if (e instanceof NoKeyError) send(501, { error: e.message })
            else send(502, { error: e?.message ?? 'analyze failed' })
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), analyzeDevApi()],
})
