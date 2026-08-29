import type { GardenActivityEntry } from '../garden/gardenActivity'
import type { OpenedGarden } from '../garden/openGarden'
import { AUDIT_GARDEN_SPEC } from './auditGarden'
import { INSPECT_GARDEN_SPEC } from './inspectGarden'
import { registerModelContextTool } from './modelContext'
import { READ_ITEMS_SPEC } from './readItems'
import { createReadTool } from './readTool'
import { SEARCH_GARDEN_SPEC } from './searchGarden'
import type { StateAwareToolBundle } from './stateAwareTools'

/**
 * The four core read tools (ticket 18), registered together, unregistered
 * together -- one `AbortSignal`, shared by all four, is what `Workspace.tsx`
 * aborts when Agent Access turns off (ADR 0083), so there is exactly one
 * seam where "the core read tools are live" can ever be true or false.
 */

export interface CoreReadToolsRuntime {
  getGarden(): OpenedGarden
  recordActivity(entry: GardenActivityEntry): void
  nextActivityId(): string
  clock(): string
}

/** Builds the stable core read tool objects for one runtime. */
export function createCoreReadTools(runtime: CoreReadToolsRuntime) {
  return [
    createReadTool(INSPECT_GARDEN_SPEC, runtime),
    createReadTool(SEARCH_GARDEN_SPEC, runtime),
    createReadTool(READ_ITEMS_SPEC, runtime),
    createReadTool(AUDIT_GARDEN_SPEC, runtime),
  ] as const
}

/** The core bundle is useful whenever a connected agent has an open Garden. */
export function createCoreReadToolsBundle(runtime: CoreReadToolsRuntime): StateAwareToolBundle {
  return {
    id: 'core-read',
    tools: createCoreReadTools(runtime),
    isRelevant: () => true,
  }
}

export async function registerCoreReadTools(
  navigator: unknown,
  runtime: CoreReadToolsRuntime,
  signal: AbortSignal,
): Promise<void> {
  const tools = createCoreReadTools(runtime)
  await Promise.all(tools.map((tool) => registerModelContextTool(navigator, tool, signal)))
}
