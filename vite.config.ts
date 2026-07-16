import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/conpar/',
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
