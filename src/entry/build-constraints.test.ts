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
  '@fontsource-variable/literata': 'self-hosted reading and title typeface (ADR 0039, ADR 0073)',
  '@fontsource/instrument-sans': 'self-hosted control typeface (ADR 0039, ADR 0073)',
  '@fontsource/ibm-plex-mono': 'self-hosted metadata typeface (ADR 0039, ADR 0073)',
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

/**
 * A ratchet on muted text ink, not a contrast measurement.
 *
 * Real contrast can only be measured against rendered pixels, and that is done
 * in the browser pass. What this stops is the specific regression that has
 * already happened twice: text quietly mixed toward transparency until it drops
 * under the 4.5:1 WCAG AA asks of body text (ADR 0044).
 *
 * On the Botanical Instrument canvas, bark ink at full strength measures
 * 11.9:1; composited at seventy percent it is 4.9:1, and at sixty-five 4.2:1.
 * Seventy is therefore the floor. It says nothing about ink mixed from the
 * other five palette colours, nor about text faded with `opacity` -- that
 * second gap is covered separately below, because it is exactly how the
 * dormant-Branch label slipped to 3.9:1.
 */
/**
 * ADR 0044's kind icons are open paths -- a stem, a pair of rules, a fork. SVG
 * fills every path by default and strokes none of it, and an open path with a
 * fill and no stroke encloses no area, so it paints nothing whatsoever.
 *
 * This is not hypothetical. The icons shipped that way and passed every unit
 * test, because the geometry was right and only the paint was missing; it took
 * looking at a real render to notice eight invisible marks.
 */
describe('kind icons are painted (ADR 0044)', () => {
  const stylesheet = readFileSync('src/styles/app.css', 'utf8')

  const markRule = /\.garden-tree__mark\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? ''

  it('strokes the mark rather than filling it', () => {
    expect(markRule, '.garden-tree__mark is missing from the stylesheet').not.toBe('')
    expect(markRule).toMatch(/stroke:\s*var\(--/)
    expect(markRule).toMatch(/fill:\s*none/)
    expect(markRule).toMatch(/stroke-width:\s*[\d.]+/)
  })

  /** Bark on a bark-filled glyph is a mark that is there and cannot be seen. */
  it('switches the mark to the canvas colour on a filled glyph', () => {
    const onFill = /\.garden-tree__mark--on-fill\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? ''

    expect(onFill).toMatch(/stroke:\s*var\(--canvas\)/)
  })
})

describe('muted text ink stays above the readable floor (ADR 0044)', () => {
  const stylesheet = readFileSync('src/styles/app.css', 'utf8')

  const MINIMUM_INK_MIX = 70
  const MINIMUM_TEXT_OPACITY = 0.7

  const inkMixes = () => [
    ...stylesheet.matchAll(/(?:color|fill):\s*color-mix\(in srgb, var\(--bark\) (\d+)%/g),
  ]

  it('never mixes text ink below the floor', () => {
    const tooFaint = inkMixes()
      .map((match) => Number(match[1]))
      .filter((percentage) => percentage < MINIMUM_INK_MIX)

    expect(tooFaint).toEqual([])
  })

  it('has muted text to check, so the rule cannot pass vacuously', () => {
    expect(inkMixes().length).toBeGreaterThan(3)
  })

  /**
   * Fading a whole node fades its label with it. That is how a Dormant Branch's
   * title reached 3.9:1 while every mix in the file was within bounds.
   *
   * One state is allowed to go under the floor, and it is named here rather
   * than inferred, because the stylesheet cannot express the difference that
   * matters. ADR 0045's dimming exists only while a person is tracing a
   * selection: it is a few seconds of deliberate de-emphasis, and it ends.
   * Dormancy is the opposite -- ADR 0031 has a Branch sit in it for as long as
   * the person likes -- so it fades its glyph and leaves the words alone.
   *
   * Recovering on focus is not a defence. Focusing every node to read it is
   * not reading a Tree, which is precisely how the original 3.9:1 label passed
   * for a whole ticket.
   *
   * Only rules that *target* a text carrier count. A fade on a descendant
   * glyph is a fade on the drawing, whatever its ancestor selector says.
   */
  const TEXT_CARRIERS = ['__node', '__label', '__kind']

  /** States that are a response to an interaction, not a property of an item. */
  const TRANSIENT_STATES = ['--dimmed']

  const targetsText = (selector: string): boolean => {
    const targeted = selector.split(/[\s>+~]+/).filter(Boolean).at(-1) ?? ''
    return TEXT_CARRIERS.some((carrier) => targeted.includes(carrier))
  }

  const fadedTextRules = () =>
    [...stylesheet.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .map(([, selector = '', body = '']) => ({
        selector: selector.trim(),
        opacity: Number(/(?:^|[;{\s])opacity:\s*([\d.]+)/.exec(body)?.[1] ?? 1),
      }))
      .filter(({ selector, opacity }) => opacity < 1 && selector.split(',').some(targetsText))

  it('never leaves text faded below the floor in a state an item rests in', () => {
    const tooFaint = fadedTextRules()
      .filter(({ opacity }) => opacity < MINIMUM_TEXT_OPACITY)
      .filter(({ selector }) => !TRANSIENT_STATES.some((state) => selector.includes(state)))

    expect(tooFaint.map(({ selector }) => selector)).toEqual([])
  })

  it('has a faded text carrier to check, so the rule cannot pass vacuously', () => {
    expect(fadedTextRules().length).toBeGreaterThan(0)
  })

  /**
   * The exemption above is only defensible while the dimming really does end.
   * A pointer has no equivalent of tabbing onto a node, so hover has to restore
   * it too, or a dimmed label can only be read by clicking it blind.
   */
  it('restores every transient dimming on both focus and hover', () => {
    for (const state of TRANSIENT_STATES) {
      for (const recovery of ['focus-visible', 'hover']) {
        const restores = new RegExp(
          `\\.garden-tree__node${state}:${recovery}[^{]*\\{[^}]*opacity:\\s*1`,
        )
        expect(restores.test(stylesheet), `${state} must restore on :${recovery}`).toBe(true)
      }
    }
  })
})
