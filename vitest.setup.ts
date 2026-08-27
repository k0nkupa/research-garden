export {}

// The DOM matchers are only meaningful in files that opted into jsdom.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}
