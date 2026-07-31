import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/conpar/',
  server: {
    proxy: {
      // Dev proxy for Octopai API calls. Set VITE_OCTOPAI_BASE_URL to the
      // tenant URL before starting the dev server (e.g. https://acme.octopai.com).
      // Production uses the nginx proxy_pass in nginx/default.conf instead.
      '/conpar/octopai-proxy': {
        target: process.env.VITE_OCTOPAI_BASE_URL || 'https://placeholder.octopai.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/conpar\/octopai-proxy/, ''),
      },
    },
  },
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
