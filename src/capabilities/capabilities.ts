/**
 * Capability detection for the Research Garden application shell.
 *
 * ADR 0059 requires local-folder access and WebMCP to be feature-detected
 * independently: with local-folder access the complete human interface stays
 * usable even when WebMCP is absent, and agent workflows require both.
 *
 * Detection is a pure function over an injected environment so the shell's
 * behaviour can be verified without a real browser.
 */

export const MINIMUM_WORKSPACE_WIDTH = 1024
export const MINIMUM_WORKSPACE_HEIGHT = 640

export interface CapabilityEnvironment {
  /** Present on browsers implementing the File System Access directory picker. */
  readonly showDirectoryPicker?: unknown
  /** WebMCP exposes its agent tool registry on the navigator. */
  readonly navigator?: unknown
}

export interface Capabilities {
  readonly localFolderAccess: boolean
  readonly webMcp: boolean
  /**
   * Live network connectivity (`navigator.onLine`). Unlike the other two
   * capabilities this can change mid-session (ADR 0072: the human interface
   * keeps working offline; agent workflows do not), so callers re-derive it on
   * `online`/`offline` events rather than only once at load.
   */
  readonly online: boolean
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

/**
 * The one capability whose absence blocks the product outright. WebMCP is
 * deliberately not in this union: its absence degrades to a fully usable
 * human-only interface rather than an unsupported environment.
 */
export type MissingCapability = 'local-folder-access'

/**
 * Whether ChatGPT can currently reach this Garden through WebMCP.
 *
 * `'unsupported'` and `'offline'` are kept distinct rather than collapsed into
 * one boolean because they call for different explanations: a browser without
 * WebMCP will never gain it, while an offline browser regains it the moment
 * connectivity returns. ADR 0072: the human interface keeps working offline,
 * but browser-agent workflows require the host connection.
 */
export type AgentInterfaceStatus = 'available' | 'unsupported' | 'offline'

export type Readiness =
  | { readonly kind: 'ready'; readonly agentInterface: AgentInterfaceStatus }
  | { readonly kind: 'unsupported-viewport' }
  | { readonly kind: 'unsupported-browser'; readonly missing: MissingCapability }

/**
 * Both probes narrow from `unknown` rather than trusting a declared browser
 * type. The environments we most need to describe correctly are precisely the
 * ones whose type declarations do not match what is actually there.
 */
function exposesAgentToolRegistry(navigator: unknown): boolean {
  if (typeof navigator !== 'object' || navigator === null) return false
  if (!('modelContext' in navigator)) return false
  return (navigator as { modelContext: unknown }).modelContext != null
}

/**
 * `navigator.onLine` is well-supported in the target desktop Chromium
 * browsers (ADR 0064), so an environment that omits it entirely (as bare test
 * fixtures do) is read as online rather than penalized for not modelling a
 * signal it was never trying to describe.
 */
function readOnline(navigator: unknown): boolean {
  if (typeof navigator !== 'object' || navigator === null) return true
  if (!('onLine' in navigator)) return true
  return Boolean((navigator as { onLine: unknown }).onLine)
}

/**
 * WebMCP presence and live connectivity are two independent gates on the same
 * outcome (ADR 0059/ADR 0072), so this is written as the two guard clauses it
 * actually is rather than a nested ternary — one condition to read at a time,
 * in the order they are checked.
 */
function resolveAgentInterfaceStatus(capabilities: Capabilities): AgentInterfaceStatus {
  if (!capabilities.webMcp) return 'unsupported'
  if (!capabilities.online) return 'offline'
  return 'available'
}

export function detectCapabilities(environment: CapabilityEnvironment): Capabilities {
  return {
    localFolderAccess: typeof environment.showDirectoryPicker === 'function',
    webMcp: exposesAgentToolRegistry(environment.navigator),
    online: readOnline(environment.navigator),
  }
}

/**
 * Decides what the shell may present. Returning a single decision — rather than
 * letting each surface test capabilities for itself — is what keeps an
 * unsupported environment from partially executing an action: there is one
 * place where "may we proceed" is answered.
 */
export function resolveReadiness(capabilities: Capabilities, viewport: Viewport): Readiness {
  if (viewport.width < MINIMUM_WORKSPACE_WIDTH || viewport.height < MINIMUM_WORKSPACE_HEIGHT) {
    return { kind: 'unsupported-viewport' }
  }
  if (!capabilities.localFolderAccess) {
    return { kind: 'unsupported-browser', missing: 'local-folder-access' }
  }
  return { kind: 'ready', agentInterface: resolveAgentInterfaceStatus(capabilities) }
}
