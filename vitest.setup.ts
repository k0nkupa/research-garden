import { afterEach } from 'vitest'

export {}

// React Testing Library does not reliably auto-register cleanup when the setup
// file is shared by Node and jsdom projects. Clean DOM roots explicitly so one
// jsdom test cannot leak into the next one.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
  }
})

// The DOM matchers are only meaningful in files that opted into jsdom.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}
