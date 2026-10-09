import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
  // not the domain root -- every asset URL in the built index.html needs
  // that prefix or the page loads blank. The Android app is the opposite:
  // Capacitor serves the build from its own local root (capacitor://
  // localhost/), so THAT build (`vite build --mode capacitor`) needs a
  // plain "/" instead, or every asset request 404s inside the app.
    base: '/',  
}))
