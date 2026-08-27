/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Client-only build: no SSR and no application data backend (ADR 0002, ADR 0048).
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
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
