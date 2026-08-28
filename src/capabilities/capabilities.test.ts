import { describe, expect, it } from 'vitest'
import {
  MINIMUM_WORKSPACE_HEIGHT,
  MINIMUM_WORKSPACE_WIDTH,
  detectCapabilities,
  resolveReadiness,
} from './capabilities'

const bothPresent = { localFolderAccess: true, webMcp: true, online: true }
const desktopViewport = { width: 1440, height: 900 }

describe('detectCapabilities', () => {
  it('reports local-folder access when the environment can pick a directory', () => {
    expect(detectCapabilities({ showDirectoryPicker: () => {} }).localFolderAccess).toBe(true)
  })

  it('reports no local-folder access when the environment cannot pick a directory', () => {
    expect(detectCapabilities({}).localFolderAccess).toBe(false)
  })

  it('reports WebMCP when the environment exposes an agent tool registry', () => {
    expect(detectCapabilities({ navigator: { modelContext: {} } }).webMcp).toBe(true)
  })

  it('reports no WebMCP when the environment exposes no agent tool registry', () => {
    expect(detectCapabilities({}).webMcp).toBe(false)
  })

  // ADR 0059: the two capabilities are gated independently, so neither
  // detection may be inferred from the other.
  it('detects local-folder access even when WebMCP is absent', () => {
    expect(detectCapabilities({ showDirectoryPicker: () => {} })).toEqual({
      localFolderAccess: true,
      webMcp: false,
      online: true,
    })
  })

  it('detects WebMCP even when local-folder access is absent', () => {
    expect(detectCapabilities({ navigator: { modelContext: {} } })).toEqual({
      localFolderAccess: false,
      webMcp: true,
      online: true,
    })
  })

  it('treats a non-callable directory picker as absent rather than present', () => {
    expect(detectCapabilities({ showDirectoryPicker: 'yes' }).localFolderAccess).toBe(false)
  })

  describe('online', () => {
    it('reads live connectivity off navigator.onLine', () => {
      expect(detectCapabilities({ navigator: { onLine: false } }).online).toBe(false)
      expect(detectCapabilities({ navigator: { onLine: true } }).online).toBe(true)
    })

    // A fixture that never models the signal is not the same claim as "offline",
    // so it reads as online rather than penalizing tests that predate it.
    it('reads online when the environment omits the signal entirely', () => {
      expect(detectCapabilities({}).online).toBe(true)
      expect(detectCapabilities({ navigator: {} }).online).toBe(true)
    })

    it('detects offline even when the other two capabilities are present', () => {
      expect(
        detectCapabilities({
          showDirectoryPicker: () => {},
          navigator: { modelContext: {}, onLine: false },
        }),
      ).toEqual({ localFolderAccess: true, webMcp: true, online: false })
    })
  })
})

describe('resolveReadiness', () => {
  it('is ready with the agent interface available when both capabilities exist and online', () => {
    expect(resolveReadiness(bothPresent, desktopViewport)).toEqual({
      kind: 'ready',
      agentInterface: 'available',
    })
  })

  // ADR 0059: with local-folder access the complete human interface stays
  // usable even when WebMCP is unavailable.
  it('reports the agent interface unsupported when only WebMCP is missing', () => {
    expect(
      resolveReadiness({ localFolderAccess: true, webMcp: false, online: true }, desktopViewport),
    ).toEqual({ kind: 'ready', agentInterface: 'unsupported' })
  })

  // ADR 0072: browser-agent workflows require the host connection even when
  // WebMCP itself is present, so offline is reported distinctly from a
  // browser that never supported WebMCP at all.
  it('reports the agent interface offline when WebMCP is present but connectivity is not', () => {
    expect(
      resolveReadiness({ localFolderAccess: true, webMcp: true, online: false }, desktopViewport),
    ).toEqual({ kind: 'ready', agentInterface: 'offline' })
  })

  it('reports unsupported rather than offline when both WebMCP and connectivity are missing', () => {
    expect(
      resolveReadiness({ localFolderAccess: true, webMcp: false, online: false }, desktopViewport),
    ).toEqual({ kind: 'ready', agentInterface: 'unsupported' })
  })

  it('blocks on the missing capability when local-folder access is absent', () => {
    expect(
      resolveReadiness({ localFolderAccess: false, webMcp: true, online: true }, desktopViewport),
    ).toEqual({
      kind: 'unsupported-browser',
      missing: 'local-folder-access',
    })
  })

  it('blocks on local-folder access when both capabilities are absent', () => {
    expect(
      resolveReadiness({ localFolderAccess: false, webMcp: false, online: true }, desktopViewport),
    ).toEqual({ kind: 'unsupported-browser', missing: 'local-folder-access' })
  })

  it('blocks a viewport narrower than the supported desktop width', () => {
    expect(
      resolveReadiness(bothPresent, { width: MINIMUM_WORKSPACE_WIDTH - 1, height: 900 }),
    ).toEqual({ kind: 'unsupported-viewport' })
  })

  it('blocks a viewport shorter than the supported desktop height', () => {
    expect(
      resolveReadiness(bothPresent, { width: 1440, height: MINIMUM_WORKSPACE_HEIGHT - 1 }),
    ).toEqual({ kind: 'unsupported-viewport' })
  })

  it('accepts a viewport exactly at the supported desktop minimum', () => {
    expect(
      resolveReadiness(bothPresent, {
        width: MINIMUM_WORKSPACE_WIDTH,
        height: MINIMUM_WORKSPACE_HEIGHT,
      }),
    ).toEqual({ kind: 'ready', agentInterface: 'available' })
  })

  // ADR 0040: the desktop requirement is the outermost gate, so a small screen
  // is told about the screen rather than about a capability it could not use
  // on that screen anyway.
  it('reports the viewport first when the screen is small and capabilities are missing', () => {
    expect(
      resolveReadiness(
        { localFolderAccess: false, webMcp: false, online: true },
        { width: 390, height: 720 },
      ),
    ).toEqual({ kind: 'unsupported-viewport' })
  })
})

describe('detectCapabilities narrowing', () => {
  it('reports no WebMCP when the navigator exposes no tool registry', () => {
    expect(detectCapabilities({ navigator: {} }).webMcp).toBe(false)
  })

  it('reports no WebMCP when the navigator is absent entirely', () => {
    expect(detectCapabilities({ navigator: null }).webMcp).toBe(false)
  })

  it('reports no WebMCP when the tool registry is present but null', () => {
    expect(detectCapabilities({ navigator: { modelContext: null } }).webMcp).toBe(false)
  })

  it('reads online as true when the navigator is absent entirely', () => {
    expect(detectCapabilities({ navigator: null }).online).toBe(true)
  })
})
