import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// FlowSight Vue SPA build config.
//
// Flask serves index.html from templates/ at "/" (raw read, not Jinja) and
// static assets from static/ at /static.  So we build with base "/static/" and
// reorganize the output to match:  index.html -> templates/, assets -> static/.
// In Docker the multi-stage build copies dist/ pieces into the right places.
export default defineConfig({
  plugins: [vue()],
  base: '/static/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Flask dev server (host) — MJPEG streams live under /api too, so they
      // pass through this proxy automatically.
      '/api': 'http://localhost:5001',
      '/translations.js': 'http://localhost:5001',
    },
  },
})
