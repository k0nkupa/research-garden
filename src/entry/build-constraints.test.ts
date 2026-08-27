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
  yaml: 'YAML document model that preserves unknown fields and comments (ADR 0054, ADR 0078)',
  zod: 'runtime schema validation of known canonical fields (ADR 0054)',
  'markdown-it': 'Markdown rendering with raw HTML disabled (ADR 0056)',
  dompurify: 'sanitizing rendered Markdown output (ADR 0056)',
  'd3-hierarchy': 'Tree layout and path calculation only (ADR 0049)',
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
  '@types/markdown-it': 'type checking',
  '@types/d3-hierarchy': 'type checking',
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

  /**
   * The Sample Garden cites two real papers. A citation is inert data: it
   * becomes a Root's `origin_url`, which ADR 0057 renders as a link and never
   * fetches. The exemption lists the exact URLs rather than the file, so a
   * third one cannot arrive unnoticed and the rule stays absolute otherwise.
   */
  const PERMITTED_CITATIONS = [
    'https://psycnet.apa.org/record/1993-40718-001',
    'https://journals.sagepub.com/doi/10.1177/0956797614535810',
  ]

  const remoteOriginsIn = (text: string) =>
    [...text.matchAll(/https?:\/\/[^'"`\s)]+/g)].map((match) => match[0])

  it('references no remote origin from application source, beyond permitted citations', () => {
    for (const source of productionSources) {
      const unexpected = remoteOriginsIn(source.text).filter(
        (origin) => !PERMITTED_CITATIONS.includes(origin),
      )

      expect(unexpected, `${source.path} references a remote origin`).toEqual([])
    }
  })

  it('still permits every citation it names, so the list cannot rot', () => {
    const referenced = productionSources.flatMap((source) => remoteOriginsIn(source.text))

    for (const citation of PERMITTED_CITATIONS) {
      expect(referenced, `${citation} is permitted but no longer used`).toContain(citation)
    }
  })

  it('never loads a permitted citation, only records it', () => {
    for (const source of productionSources) {
      if (remoteOriginsIn(source.text).length === 0) continue

      expect(source.text, `${source.path} loads a remote origin`).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|\.src\s*=|import\s*\(/,
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

/**
 * ADR 0065 separates domain, filesystem, UI, and WebMCP. That separation is
 * what makes the domain testable without a browser, so it is enforced here
 * rather than left to habit.
 */
describe('layering (ADR 0065)', () => {
  /**
   * Operating a folder through the browser. `requestPermission` is deliberately
   * absent: it is also the port's own method name, so including it would flag
   * callers of the port rather than callers of the browser.
   */
  const BROWSER_FILESYSTEM_API = [
    'showDirectoryPicker',
    'FileSystemDirectoryHandle',
    'FileSystemFileHandle',
    'FileSystemWritableFileStream',
    'getDirectoryHandle',
    'getFileHandle',
    'createWritable',
    'queryPermission',
  ]

  /**
   * Capability detection legitimately names the picker without operating it:
   * ADR 0059 requires local-folder access to be feature-detected, and that
   * check cannot happen inside the adapter it decides whether to build.
   */
  const MAY_DETECT_THE_PICKER = 'src/capabilities/'

  const inside = (directory: string) =>
    productionSources.filter((source) => source.path.startsWith(directory))

  it('confines operating the browser filesystem to the adapter layer', () => {
    const offenders = productionSources
      .filter((source) => !source.path.startsWith('src/filesystem/'))
      .filter((source) => {
        const names = source.path.startsWith(MAY_DETECT_THE_PICKER)
          ? BROWSER_FILESYSTEM_API.filter((name) => name !== 'showDirectoryPicker')
          : BROWSER_FILESYSTEM_API
        return names.some((name) => source.text.includes(name))
      })
      .map((source) => source.path)

    expect(offenders).toEqual([])
  })

  it('keeps the browser filesystem API out of domain logic', () => {
    const offenders = inside('src/domain/')
      .filter((source) => BROWSER_FILESYSTEM_API.some((name) => source.text.includes(name)))
      .map((source) => source.path)

    expect(offenders).toEqual([])
  })

  it('keeps React out of domain logic', () => {
    const offenders = inside('src/domain/')
      .filter((source) => /from 'react'|from "react"/.test(source.text))
      .map((source) => source.path)

    expect(offenders).toEqual([])
  })

  it('keeps the filesystem adapter layer free of React', () => {
    const offenders = inside('src/filesystem/')
      .filter((source) => /from 'react'|from "react"/.test(source.text))
      .map((source) => source.path)

    expect(offenders).toEqual([])
  })

  it('has domain logic to check, so these rules cannot pass vacuously', () => {
    expect(inside('src/domain/').length).toBeGreaterThan(0)
    expect(inside('src/filesystem/').length).toBeGreaterThan(0)
  })
})

describe('client-only build (ADR 0002, ADR 0048)', () => {
  it('depends on no server framework or application data backend client', () => {
    expectNoneInstalled(['express', 'fastify', 'koa', 'next', 'remix', '@remix-run/node',
      'pg', 'mysql2', 'mongodb', 'better-sqlite3', '@supabase/supabase-js', 'firebase'])
  })
})
