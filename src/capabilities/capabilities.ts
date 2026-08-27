/**
 * Capability detection for the Research Garden application shell.
 *
 * ADR 0059 requires local-folder access and WebMCP to be feature-detected
 * independently: with local-folder access the complete human interface stays
 * usable even when WebMCP is absent, and agent workflows require both. ADR 0040
 * scopes the workspace to desktop.
 *
 * Detection is a pure function over an injected environment so the shell's
 * behaviour can be verified without a real browser.
 */

/** The smallest viewport the Garden workspace is designed for (ADR 0040). */
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

export type Readiness =
  | { readonly kind: 'ready'; readonly agentInterfaceAvailable: boolean }
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

export function detectCapabilities(environment: CapabilityEnvironment): Capabilities {
  return {
    localFolderAccess: typeof environment.showDirectoryPicker === 'function',
    webMcp: exposesAgentToolRegistry(environment.navigator),
  }
}

/**
 * Decides what the shell may present. Returning a single decision — rather than
 * letting each surface test capabilities for itself — is what keeps an
 * unsupported environment from partially executing an action: there is one
 * place where "may we proceed" is answered.
 */
export function resolveReadiness(capabilities: Capabilities, viewport: Viewport): Readiness {
  // The desktop requirement is the outermost gate (ADR 0040). A small screen is
  // told about the screen, because no capability explanation would be
  // actionable there.
  if (viewport.width < MINIMUM_WORKSPACE_WIDTH || viewport.height < MINIMUM_WORKSPACE_HEIGHT) {
    return { kind: 'unsupported-viewport' }
  }

  if (!capabilities.localFolderAccess) {
    return { kind: 'unsupported-browser', missing: 'local-folder-access' }
  }

  return { kind: 'ready', agentInterfaceAvailable: capabilities.webMcp }
}
