import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
//
// Two builds of the same app:
// - Website (`vite build`): the app lives at foodguards.space/app/, so every
//   asset URL needs the /app/ prefix and the build goes to dist/app. The
//   domain root (dist/) is the website -- for now just site/index.html,
//   which forwards old links (foodguards.space/#/p/123) to /app/ (copied in
//   by scripts/build-site.js, see the "build" script).
// - Android app (`vite build --mode capacitor`): Capacitor serves the build
//   from its own local root, so that build keeps a plain "/" and dist/.
export default defineConfig(({ mode }) => {
  const app = mode !== 'capacitor';
  return {
    plugins: [react()],
    base: app ? '/app/' : '/',
    build: { outDir: app ? 'dist/app' : 'dist' },
  };
})
