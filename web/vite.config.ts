import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: `npm run dev` on :5173 proxies the API to the engine on :8000.
// Build: `npm run build` writes web/dist, which `python -m abhedya serve` serves at http://127.0.0.1:8000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { chunkSizeWarningLimit: 900 },   // Cytoscape is ~500 kB; served locally, so one chunk is fine
})
