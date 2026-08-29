import { z } from 'zod'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import { addLeaf, addLeafInputSchema, captureRoot, captureRootInputSchema, plantSeed, plantSeedInputSchema, type AddLeafInput, type CaptureRootInput, type DirectAdditionResult, type PlantSeedInput } from '../garden/directAdditions'
import type { OpenedGarden } from '../garden/openGarden'
import type { UlidEntropy } from '../domain/schema/ulid'
import { errorEnvelope, okEnvelope, type ToolEnvelope } from './envelope'
import { registerModelContextTool, type ModelContextTool } from './modelContext'
import type { StateAwareToolBundle } from './stateAwareTools'

/** Runtime dependencies held by the Workspace for one Agent Access session. */
export interface DirectAdditionToolsRuntime {
  getGarden(): OpenedGarden
  /** Lets the human Tree converge immediately after a direct canonical write. */
  refreshGarden?: (() => Promise<unknown>) | undefined
  recordActivity(entry: GardenActivityEntry): void
  nextActivityId(): string
  clock(): string
  entropy?: UlidEntropy | undefined
}

export interface DirectAdditionToolSpec<Input> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<Input>
  readonly action: 'plant_seed' | 'capture_root' | 'add_leaf'
  run(garden: OpenedGarden, input: Input, options: { readonly now: () => string; readonly entropy?: UlidEntropy | undefined }): Promise<DirectAdditionResult>
  itemIdsFor(input: Input): readonly string[]
}

const GENERIC_TOOL_FAILURE_MESSAGE = 'This tool could not complete the request. Try again.'

function asEnvelope(result: DirectAdditionResult, revision: string): ToolEnvelope<unknown> {
  switch (result.kind) {
    case 'created':
      return okEnvelope(
        {
          item: result.item,
          path: result.path,
          snapshotId: result.snapshotId,
          resultingHash: result.resultingHash,
        },
        result.gardenRevision,
      )
    case 'blocked':
      return errorEnvelope('schema', result.reason, revision)
    case 'invalid':
      return errorEnvelope(result.code ?? 'schema', result.message, revision)
    case 'permission-required':
      return errorEnvelope('permission', 'Permission for this Garden Repository was not available. Try again.', revision)
    case 'verification-failed':
      return errorEnvelope('write', result.message, revision)
    case 'failed':
      return errorEnvelope('write', result.message, revision)
  }
}

/** Converts one direct action into a stable, never-throwing WebMCP tool. */
export function createDirectAdditionTool<Input>(
  spec: DirectAdditionToolSpec<Input>,
  runtime: DirectAdditionToolsRuntime,
): ModelContextTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.inputSchema),
    annotations: { untrustedContentHint: true },
    async execute(rawInput) {
      const garden = runtime.getGarden()
      let envelope: ToolEnvelope<unknown>
      let itemIds: readonly string[] = []

      try {
        const parsed = spec.inputSchema.safeParse(rawInput)
        if (!parsed.success) {
          const first = parsed.error.issues[0]
          envelope = errorEnvelope(
            'invalid-input',
            first ? `Invalid input at ${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.',
            garden.index.revision,
          )
        } else {
          itemIds = spec.itemIdsFor(parsed.data)
          const result = await spec.run(garden, parsed.data, {
            now: runtime.clock,
            entropy: runtime.entropy,
          })
          envelope = asEnvelope(result, garden.index.revision)
          if (result.kind === 'created') {
            itemIds = [result.item.id]
            // The canonical write has already been verified. A UI rescan is a
            // convergence aid, not part of the action's success contract, so
            // an incidental refresh failure must not turn a committed write
            // into an `internal` tool error.
            try {
              await runtime.refreshGarden?.()
            } catch {
              // The next explicit consistency boundary will still rescan.
            }
          }
        }
      } catch {
        envelope = errorEnvelope('internal', GENERIC_TOOL_FAILURE_MESSAGE, garden.index.revision)
      }

      runtime.recordActivity({
        id: runtime.nextActivityId(),
        action: spec.action,
        at: runtime.clock(),
        itemIds,
        outcome: envelope.ok ? 'success' : 'failure',
        detail: envelope.ok ? undefined : envelope.error.message,
      })
      return envelope
    },
  }
}

export function createDirectAdditionTools(runtime: DirectAdditionToolsRuntime): readonly ModelContextTool[] {
  return [
    createDirectAdditionTool<PlantSeedInput>({
      name: 'plant_seed',
      description: 'Create one Seed preserving the supplied title and body verbatim.',
      inputSchema: plantSeedInputSchema,
      action: 'plant_seed',
      run: (garden, input, options) => plantSeed(garden.fileSystem, input, options),
      itemIdsFor: () => [],
    }, runtime),
    createDirectAdditionTool<CaptureRootInput>({
      name: 'capture_root',
      description: 'Capture exact evidence supplied by the browser agent, with origin metadata and a content hash. Research Garden never fetches the URL.',
      inputSchema: captureRootInputSchema,
      action: 'capture_root',
      run: (garden, input, options) => captureRoot(garden.fileSystem, input, options),
      itemIdsFor: () => [],
    }, runtime),
    createDirectAdditionTool<AddLeafInput>({
      name: 'add_leaf',
      description: 'Create one Leaf under a Branch; Claim Leaves require supporting Roots.',
      inputSchema: addLeafInputSchema,
      action: 'add_leaf',
      run: (garden, input, options) => addLeaf(garden.fileSystem, input, options),
      itemIdsFor: (input) => [input.parentId, ...(input.supportedBy ?? [])],
    }, runtime),
  ] as const
}

export function createDirectAdditionToolsBundle(runtime: DirectAdditionToolsRuntime): StateAwareToolBundle {
  return {
    id: 'direct-additions',
    tools: createDirectAdditionTools(runtime),
    isRelevant: () => true,
  }
}

export async function registerDirectAdditionTools(
  navigator: unknown,
  runtime: DirectAdditionToolsRuntime,
  signal: AbortSignal,
): Promise<void> {
  await Promise.all(createDirectAdditionTools(runtime).map((tool) => registerModelContextTool(navigator, tool, signal)))
}
