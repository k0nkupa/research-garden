import { registerModelContextTool, type ModelContextTool } from './modelContext'

/**
 * The pieces of workspace state that decide which agent capabilities are
 * useful.  Item and Branch identities are opaque to registration: the tools
 * themselves still receive stable IDs and validate them at their own seam.
 */
export interface ToolRegistrationState {
  readonly agentAccess: boolean
  readonly gardenOpen: boolean
  readonly selectedItemId: string | undefined
  readonly focusedBranchId: string | undefined
  readonly hasPendingChanges: boolean
}

/**
 * A bundle owns one coherent capability group and its registration lifetime.
 * Future action tickets can add bundles without changing this state machine or
 * the schemas of bundles already registered.
 */
export interface StateAwareToolBundle {
  readonly id: string
  readonly tools: readonly ModelContextTool[]
  readonly isRelevant: (state: ToolRegistrationState) => boolean
}

export interface RegisteredToolSurface {
  readonly state: ToolRegistrationState
  readonly bundleIds: readonly string[]
  readonly tools: readonly ModelContextTool[]
  readonly names: readonly string[]
}

export interface StateAwareToolRegistration {
  /** Updates availability, retaining registrations whose bundle is still relevant. */
  update(state: ToolRegistrationState): void
  /** Revokes every active bundle and empties the inspectable surface. */
  disconnect(): void
  /** Returns the current local view of what this registration owns. */
  inspect(): RegisteredToolSurface
}

interface ActiveBundle {
  readonly bundle: StateAwareToolBundle
  readonly controller: AbortController
}

const INITIAL_STATE: ToolRegistrationState = {
  agentAccess: false,
  gardenOpen: false,
  selectedItemId: undefined,
  focusedBranchId: undefined,
  hasPendingChanges: false,
}

/**
 * Owns the browser registrations for one Agent Access session.
 *
 * The browser WebMCP registry has no separate unregister method: aborting the
 * signal supplied to `registerTool` is the unregister operation. Keeping one
 * controller per bundle means a selection/focus/pending-change update only
 * changes the relevant bundle, while `disconnect` can revoke all of them
 * synchronously. `inspect` never consults the browser host, so tests and the
 * human UI can inspect the surface in environments without WebMCP.
 */
export function createStateAwareToolRegistration(
  navigator: unknown,
  bundles: readonly StateAwareToolBundle[],
): StateAwareToolRegistration {
  const active = new Map<string, ActiveBundle>()
  let state = INITIAL_STATE

  const resolveActiveSurface = (activeIds: ReadonlySet<string>) => {
    const tools: ModelContextTool[] = []
    const names = new Set<string>()
    const bundleIds: string[] = []

    for (const bundle of bundles) {
      if (!activeIds.has(bundle.id)) continue
      bundleIds.push(bundle.id)
      for (const tool of bundle.tools) {
        if (names.has(tool.name)) continue
        names.add(tool.name)
        tools.push(tool)
      }
    }

    return { bundleIds, tools, names: tools.map((tool) => tool.name) }
  }

  const inspect = (): RegisteredToolSurface => {
    const surface = resolveActiveSurface(new Set(active.keys()))
    return { state, ...surface }
  }

  const update = (nextState: ToolRegistrationState): void => {
    state = nextState
    // Every bundle managed here is filesystem-backed Garden capability. The
    // access gate is enforced centrally so a future bundle cannot accidentally
    // become visible merely because its own contextual predicate matches.
    const relevant = new Set(
      nextState.agentAccess && nextState.gardenOpen
        ? bundles.filter((bundle) => bundle.isRelevant(nextState)).map((bundle) => bundle.id)
        : [],
    )

    for (const [id, registration] of active) {
      if (relevant.has(id)) continue
      registration.controller.abort()
      active.delete(id)
    }

    for (const bundle of bundles) {
      if (!relevant.has(bundle.id) || active.has(bundle.id)) continue

      const namesAlreadyRegistered = new Set(
        resolveActiveSurface(new Set(active.keys())).names,
      )
      const controller = new AbortController()
      active.set(bundle.id, { bundle, controller })
      for (const tool of bundle.tools) {
        if (namesAlreadyRegistered.has(tool.name)) continue
        namesAlreadyRegistered.add(tool.name)
        void registerModelContextTool(navigator, tool, controller.signal)
      }
    }
  }

  const disconnect = (): void => {
    for (const registration of active.values()) registration.controller.abort()
    active.clear()
    state = { ...INITIAL_STATE }
  }

  return { update, disconnect, inspect }
}
