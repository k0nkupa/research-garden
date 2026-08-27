import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const indexHtml = readFileSync('index.html', 'utf8')

const installedPackages = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
})

function expectNoneInstalled(rejected: readonly string[]) {
  expect(installedPackages.filter((name) => rejected.includes(name))).toEqual([])
}

/** Every non-test source file, so a hand-written beacon cannot hide from the guard. */
function readProductionSources(directory = 'src'): { path: string; text: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return readProductionSources(path)
    if (/\.test\.tsx?$/.test(entry.name)) return []
    if (!/\.(ts|tsx|css)$/.test(entry.name)) return []
    return [{ path, text: readFileSync(path, 'utf8') }]
  })
}

const productionSources = readProductionSources()

/**
 * ADR 0051 requires every dependency to serve a named product boundary. This
 * map is that requirement made enforceable: adding a dependency without naming
 * what it is for fails the build.
 */
const NAMED_PRODUCT_BOUNDARIES: Record<string, string> = {
  react: 'application shell',
  'react-dom': 'application shell',
}

const NAMED_TOOLING_BOUNDARIES: Record<string, string> = {
  typescript: 'type checking',
  vite: 'client-only build',
  '@vitejs/plugin-react': 'client-only build',
  vitest: 'domain and shell tests',
  jsdom: 'domain and shell tests',
  '@testing-library/react': 'shell tests',
  '@testing-library/dom': 'shell tests',
  '@testing-library/user-event': 'shell tests',
  '@testing-library/jest-dom': 'shell tests',
  '@types/react': 'type checking',
  '@types/react-dom': 'type checking',
}

/** ADR 0073: no analytics, behavioral tracking, or remote error payloads. */
const TELEMETRY_PACKAGES = [
  '@sentry/browser', '@sentry/react', 'bugsnag', '@bugsnag/js', 'rollbar',
  'posthog-js', 'mixpanel-browser', 'amplitude-js', '@amplitude/analytics-browser',
  'segment', '@segment/analytics-next', 'react-ga', 'react-ga4', 'ga-lite',
  'logrocket', 'hotjar', 'fullstory', '@datadog/browser-rum', '@vercel/analytics',
]

/** ADR 0051: no full note-editor or graph framework. */
const REJECTED_FRAMEWORKS = [
  'prosemirror', 'prosemirror-view', 'prosemirror-state', 'slate', 'slate-react',
  'quill', 'react-quill', '@tiptap/core', '@tiptap/react', 'lexical', '@lexical/react',
  '@blocknote/core', 'cytoscape', 'react-flow', 'reactflow', '@xyflow/react',
  'sigma', 'vis-network', 'gojs', '@antv/g6', 'jointjs',
]

describe('dependency surface (ADR 0051)', () => {
  it('names a product boundary for every runtime dependency', () => {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      expect(NAMED_PRODUCT_BOUNDARIES[name], `${name} has no named product boundary`).toBeTruthy()
    }
  })

  it('names a boundary for every development dependency', () => {
    for (const name of Object.keys(manifest.devDependencies ?? {})) {
      expect(NAMED_TOOLING_BOUNDARIES[name], `${name} has no named boundary`).toBeTruthy()
    }
  })

  it('introduces no note-editor or graph framework', () => {
    expectNoneInstalled(REJECTED_FRAMEWORKS)
  })
})

describe('no product telemetry (ADR 0073)', () => {
  it('installs no analytics, tracking, or remote error-reporting package', () => {
    expectNoneInstalled(TELEMETRY_PACKAGES)
  })

  // A denylist of packages does not stop a hand-written beacon, which is the
  // likelier way telemetry actually arrives.
  it('sends nothing from application source by hand', () => {
    for (const source of productionSources) {
      expect(source.text, `${source.path} sends a beacon`).not.toMatch(
        /sendBeacon|XMLHttpRequest|new EventSource|new WebSocket/,
      )
    }
  })

  it('references no remote origin from application source', () => {
    for (const source of productionSources) {
      expect(source.text, `${source.path} references a remote origin`).not.toMatch(
        /https?:\/\//,
      )
    }
  })

  it('loads nothing from a third-party origin in the application document', () => {
    const remoteReferences = [...indexHtml.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)]
    expect(remoteReferences.map((match) => match[1])).toEqual([])
  })

  it('declares no inline analytics or tag-manager snippet', () => {
    expect(indexHtml).not.toMatch(/gtag|googletagmanager|dataLayer|analytics\.|_paq|fbq\(/i)
  })
})

describe('client-only build (ADR 0002, ADR 0048)', () => {
  it('depends on no server framework or application data backend client', () => {
    expectNoneInstalled(['express', 'fastify', 'koa', 'next', 'remix', '@remix-run/node',
      'pg', 'mysql2', 'mongodb', 'better-sqlite3', '@supabase/supabase-js', 'firebase'])
  })
})
