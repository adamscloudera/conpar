import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import https from 'node:https'
import type { Plugin } from 'vite'

// Dev proxy: reads X-Octopai-Host per-request, mirrors the nginx proxy_pass in production.
// No env var needed — the UI supplies the tenant name, the client sets the header.
function dynamicOctopaiProxy(): Plugin {
  return {
    name: 'dynamic-octopai-proxy',
    configureServer(server) {
      server.middlewares.use('/conpar/octopai-proxy', (req, res) => {
        const host = req.headers['x-octopai-host']
        if (typeof host !== 'string' || !/^[a-zA-Z0-9-]+\.octopai\.com$/.test(host)) {
          res.statusCode = 403
          res.end('Forbidden: missing or invalid X-Octopai-Host header')
          return
        }
        const upstream = https.request(
          { hostname: host, path: req.url ?? '/', method: req.method, headers: { ...req.headers, host } },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
            proxyRes.pipe(res, { end: true })
          },
        )
        upstream.on('error', (err) => {
          console.error('[octopai-proxy]', err.message)
          if (!res.headersSent) { res.statusCode = 502; res.end() }
        })
        req.pipe(upstream, { end: true })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dynamicOctopaiProxy()],
  base: '/conpar/',
  server: {},
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const p = id.replaceAll('\\', '/')
          if (p.includes('node_modules/react-dom/') || p.includes('node_modules/react/')) return 'vendor'
          if (p.includes('node_modules/xlsx/')) return 'xlsx'
          if (p.includes('node_modules/papaparse/')) return 'papaparse'
          if (p.includes('node_modules/lucide-react/')) return 'icons'
        },
      },
    },
  },
})
