/**
 * The narrow surface of `navigator.modelContext` (WebMCP) this codebase
 * actually calls.
 *
 * `capabilities.ts` already narrows `navigator` from `unknown` rather than
 * trusting a declared browser type, because the environments this app most
 * needs to describe correctly are precisely the ones whose type declarations
 * do not match what is actually there (ADR 0059, ADR 0064). Tool
 * registration follows the same discipline: `asModelContextRegistry` checks
 * shape at the boundary rather than casting, and every caller stays
 * consistent with `capabilities.ts`'s own `exposesAgentToolRegistry` about
 * where the registry lives (`navigator.modelContext`, not
 * `document.modelContext`), since that is the surface already validated
 * against the real deployed target (ADR 0068).
 */

export interface ModelContextToolAnnotations {
  readonly readOnlyHint?: boolean
  /** Standard MCP hint used by hosts to place a human confirmation step. */
  readonly destructiveHint?: boolean
  readonly untrustedContentHint?: boolean
}

export interface ModelContextToolExecuteOptions {
  readonly signal: AbortSignal
}

export interface ModelContextTool {
  readonly name: string
  readonly description: string
  readonly inputSchema?: object
  execute(input: object, options: ModelContextToolExecuteOptions): Promise<unknown>
  readonly annotations?: ModelContextToolAnnotations
}

export interface ModelContextRegisterToolOptions {
  /** Aborting this unregisters the tool -- the registry has no separate `unregisterTool`. */
  readonly signal?: AbortSignal
}

export interface ModelContextRegistry {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<undefined>
}

/**
 * `undefined` unless `navigator.modelContext` is present and actually shaped
 * like a registry -- never trusted merely because the property exists
 * (`capabilities.ts`'s own `exposesAgentToolRegistry` only checks presence,
 * for the coarser "is WebMCP here at all" question; this checks the one
 * method actually called).
 */
export function asModelContextRegistry(navigator: unknown): ModelContextRegistry | undefined {
  if (typeof navigator !== 'object' || navigator === null) return undefined
  if (!('modelContext' in navigator)) return undefined

  const modelContext = (navigator as { modelContext: unknown }).modelContext
  if (typeof modelContext !== 'object' || modelContext === null) return undefined
  if (typeof (modelContext as { registerTool?: unknown }).registerTool !== 'function') return undefined

  return modelContext as ModelContextRegistry
}

/**
 * Registers a tool if WebMCP is present, and does nothing otherwise.
 *
 * Best-effort, matching `refreshPendingChanges`'s own posture: a browser
 * agent that cannot register this tool right now still leaves the human
 * interface fully usable (ADR 0059), so a registration failure is never
 * surfaced as an application error.
 */
export async function registerModelContextTool(
  navigator: unknown,
  tool: ModelContextTool,
  signal: AbortSignal,
): Promise<void> {
  const registry = asModelContextRegistry(navigator)
  if (!registry) return

  try {
    await registry.registerTool(tool, { signal })
  } catch {
    // See doc comment above.
  }
}
