/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Changes on every production build so the browser's own byte-comparison
 * service-worker update check reliably notices a new version (ticket 16). Not
 * a call home: it never leaves the build, it only makes the built sw.js
 * differ from the previous build's sw.js.
 */
const serviceWorkerVersion = `${Date.now()}`

/**
 * Every hashed filename Vite emits is unknown until this build actually runs,
 * so the service worker cannot hardcode what to precache. This plugin writes
 * `dist/precache-manifest.json` — the exact list of this build's versioned
 * shell files — which the service worker fetches once at install time and
 * caches explicitly (see src/entry/offline-shell/serviceWorker.ts).
 *
 * Without this, only the document shell a browser happens to request during
 * install gets cached; the JS/CSS bundle a fresh install's own page load
 * requests is never seen by that same install's fetch handler (a service
 * worker does not control the page that is installing it), so a first-ever
 * visit that goes offline before a second online visit would have no cached
 * bundle to run at all. Confirmed by loading a real build in headless Chrome,
 * cutting the network, and reloading — see the ticket's Notes.
 *
 * The icon list is read from public/manifest.webmanifest rather than
 * hand-copied here: that manifest is already the source of truth for which
 * icon files exist (installability depends on it listing the real ones), so
 * repeating the list here would just be a second copy that could drift from
 * the first.
 */
function precacheManifestPlugin(): Plugin {
  return {
    name: 'research-garden-precache-manifest',
    generateBundle(_options, bundle) {
      const appManifest = JSON.parse(
        readFileSync(fileURLToPath(new URL('./public/manifest.webmanifest', import.meta.url)), 'utf8'),
      ) as { icons?: { src: string }[] }

      const paths = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        ...(appManifest.icons ?? []).map((icon) => icon.src),
      ]

      for (const fileName of Object.keys(bundle)) {
        if (fileName.startsWith('assets/')) paths.push(`/${fileName}`)
      }

      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(paths),
      })
    },
  }
}

// Client-only build: no SSR and no application data backend (ADR 0002, ADR 0048).
export default defineConfig({
  plugins: [react(), precacheManifestPlugin()],
  define: {
    __SW_VERSION__: JSON.stringify(serviceWorkerVersion),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // A second, independent entry point: the offline shell's service
        // worker (ADR 0072). It must land at a stable, unhashed `/sw.js` so
        // `registerServiceWorker` can register it by a fixed URL.
        sw: fileURLToPath(new URL('./src/entry/offline-shell/serviceWorker.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    globals: true,
    // Node by default: the domain and filesystem layers never touch the DOM, and
    // jsdom costs tens of seconds to start. Files that render or sanitize opt in
    // with an `@vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
