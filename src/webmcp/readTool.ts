import { z } from 'zod'
import type { GardenActivityAction, GardenActivityEntry } from '../garden/gardenActivity'
import type { OpenedGarden } from '../garden/openGarden'
import { errorEnvelope, type ToolEnvelope } from './envelope'
import type { ModelContextTool, ModelContextToolAnnotations } from './modelContext'

/**
 * Turns one pure read function into a real `ModelContextTool` (ticket 18).
 *
 * Every core read tool needs the same wrapper around its own logic: validate
 * the raw WebMCP `object` input against a schema, run against the Garden the
 * caller currently has open, record exactly one Garden Activity entry, and
 * never let an exception escape `execute` (ADR 0036's "no tool signals
 * outcome through... an uncaught exception" applies to a bug in the tool's
 * own code, not only to expected domain refusals). Building this once here,
 * rather than once per tool, is what keeps that wrapper identical across all
 * four -- `inspect_garden`/`search_garden`/`read_items`/`audit_garden` differ
 * only in `spec`, never in how a call becomes an envelope and an Activity
 * entry.
 */

export interface ReadToolSpec<Input, Data> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<Input>
  readonly annotations?: ModelContextToolAnnotations
  readonly action: GardenActivityAction
  run(garden: OpenedGarden, input: Input): ToolEnvelope<Data>
  /** What Garden Activity shows as "affected item IDs" for this call. */
  itemIdsFor(input: Input): readonly string[]
}

export interface ReadToolRuntime {
  /** Read fresh at call time -- a WebMCP call can land long after registration, well after a rescan. */
  getGarden(): OpenedGarden
  recordActivity(entry: GardenActivityEntry): void
  nextActivityId(): string
  clock(): string
}

const GENERIC_TOOL_FAILURE_MESSAGE = 'This tool could not complete the request. Try again.'

function describeInputError(error: z.ZodError): string {
  const [first] = error.issues
  if (!first) return 'The input did not match what this tool expects.'
  const at = first.path.length > 0 ? first.path.join('.') : 'input'
  return `Invalid input at ${at}: ${first.message}`
}

export function createReadTool<Input, Data>(
  spec: ReadToolSpec<Input, Data>,
  runtime: ReadToolRuntime,
): ModelContextTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.inputSchema),
    ...(spec.annotations ? { annotations: spec.annotations } : {}),
    async execute(rawInput) {
      const garden = runtime.getGarden()

      let envelope: ToolEnvelope<Data>
      let itemIds: readonly string[] = []
      try {
        const parsed = spec.inputSchema.safeParse(rawInput)
        if (parsed.success) {
          itemIds = spec.itemIdsFor(parsed.data)
          envelope = spec.run(garden, parsed.data)
        } else {
          envelope = errorEnvelope('invalid-input', describeInputError(parsed.error), garden.index.revision)
        }
      } catch {
        // A bug in `spec.run`, not a domain refusal -- see the doc comment above.
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
