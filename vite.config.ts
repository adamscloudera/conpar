import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// To proxy Octopai API calls locally (avoids CORS when the tenant doesn't
// send Access-Control-Allow-Origin headers), set VITE_OCTOPAI_BASE_URL:
//   VITE_OCTOPAI_BASE_URL=https://acme.octopai.com npm run dev
// Then in apiClient.ts, replace tenantUrl() with `/octopai-proxy` and
// add the same nginx proxy_pass for production deployment.
const octopaiBase = process.env.VITE_OCTOPAI_BASE_URL

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/conpar/',
  server: octopaiBase
    ? {
        proxy: {
          '/octopai-proxy': {
            target: octopaiBase,
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/octopai-proxy/, ''),
          },
        },
      }
    : undefined,
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
