import type { GardenActivityEntry } from '../garden/gardenActivity'
import type { OpenedGarden } from '../garden/openGarden'
import { proposeHarvest, proposeHarvestInputSchema, proposeMove, proposeMoveInputSchema, proposeRelation, proposeRelationInputSchema, type ProposeHarvestInput, type ProposeMoveInput, type ProposeRelationInput, type ProposalResult } from '../garden/proposalTools'
import type { UlidEntropy } from '../domain/schema/ulid'
import { errorEnvelope, okEnvelope, type ToolEnvelope } from './envelope'
import { registerModelContextTool, type ModelContextTool } from './modelContext'
import type { StateAwareToolBundle } from './stateAwareTools'
import { z } from 'zod'

export interface ProposalToolsRuntime {
  getGarden(): OpenedGarden
  refreshGarden?: (() => Promise<unknown>) | undefined
  recordActivity(entry: GardenActivityEntry): void
  nextActivityId(): string
  clock(): string
  entropy?: UlidEntropy | undefined
}

interface ProposalSpec<Input> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<Input>
  readonly action: GardenActivityEntry['action']
  readonly itemIdsFor: (input: Input) => readonly string[]
  readonly run: (garden: OpenedGarden, input: Input, runtime: ProposalToolsRuntime) => Promise<ProposalResult>
}

function envelope(result: ProposalResult, revision: string): ToolEnvelope<unknown> {
  if (result.kind === 'proposed') {
    return okEnvelope({ id: result.id, itemId: result.itemId, path: result.path, previewHash: result.previewHash }, result.gardenRevision)
  }
  if (result.kind === 'permission-required') return errorEnvelope('permission', 'Permission for this Garden Repository was not available. Try again.', revision)
  if (result.kind === 'blocked') return errorEnvelope('schema', result.message, revision)
  if (result.kind === 'invalid') return errorEnvelope(result.code, result.message, revision)
  return errorEnvelope('write', result.message, revision)
}

function createProposalTool<Input>(spec: ProposalSpec<Input>, runtime: ProposalToolsRuntime): ModelContextTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.inputSchema),
    annotations: { untrustedContentHint: true },
    async execute(rawInput) {
      const garden = runtime.getGarden()
      let result: ToolEnvelope<unknown>
      let itemIds: readonly string[] = []
      try {
        const parsed = spec.inputSchema.safeParse(rawInput)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          result = errorEnvelope('invalid-input', issue ? `Invalid input at ${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input.', garden.index.revision)
        } else {
          itemIds = spec.itemIdsFor(parsed.data)
          const proposal = await spec.run(garden, parsed.data, runtime)
          result = envelope(proposal, garden.index.revision)
          if (proposal.kind === 'proposed') {
            // Pending records are operational, but the Tray observes them only
            // after the same explicit rescan used by all other actions.
            try { await runtime.refreshGarden?.() } catch { /* Tray convergence is best-effort. */ }
          }
        }
      } catch {
        result = errorEnvelope('internal', 'This tool could not complete the request. Try again.', garden.index.revision)
      }
      runtime.recordActivity({ id: runtime.nextActivityId(), action: spec.action, at: runtime.clock(), itemIds, outcome: result.ok ? 'success' : 'failure', detail: result.ok ? undefined : result.error.message })
      return result
    },
  }
}

export function createProposalTools(runtime: ProposalToolsRuntime): readonly ModelContextTool[] {
  return [
    createProposalTool<ProposeRelationInput>({
      name: 'propose_relation', description: 'Propose one recognized relationship between two existing Garden items for human review.', inputSchema: proposeRelationInputSchema, action: 'propose_relation', itemIdsFor: (input) => [input.sourceId, input.targetId], run: (garden, input, current) => proposeRelation(garden.fileSystem, input, { now: current.clock, entropy: current.entropy }),
    }, runtime),
    createProposalTool<ProposeMoveInput>({
      name: 'propose_move', description: 'Propose moving one existing Garden item under a Branch for human review.', inputSchema: proposeMoveInputSchema, action: 'propose_move', itemIdsFor: (input) => [input.itemId, input.parentId], run: (garden, input, current) => proposeMove(garden.fileSystem, input, { now: current.clock, entropy: current.entropy }),
    }, runtime),
    createProposalTool<ProposeHarvestInput>({
      name: 'propose_harvest', description: 'Propose an evidence-shaped Harvest for human review without writing canonical files.', inputSchema: proposeHarvestInputSchema, action: 'propose_harvest', itemIdsFor: (input) => [input.parentId, ...input.supportedBy, ...(input.claimIds ?? []), ...(input.questionId ? [input.questionId] : [])], run: (garden, input, current) => proposeHarvest(garden.fileSystem, input, { now: current.clock, entropy: current.entropy }),
    }, runtime),
  ] as const
}

export function createProposalToolsBundles(runtime: ProposalToolsRuntime): readonly StateAwareToolBundle[] {
  const tools = createProposalTools(runtime)
  return [
    { id: 'proposal-selected', tools: tools.slice(0, 2), isRelevant: (state) => state.selectedItemId !== undefined },
    { id: 'proposal-focused-branch', tools: [tools[2]!], isRelevant: (state) => state.focusedBranchId !== undefined },
  ]
}

export async function registerProposalTools(navigator: unknown, runtime: ProposalToolsRuntime, signal: AbortSignal): Promise<void> {
  await Promise.all(createProposalTools(runtime).map((tool) => registerModelContextTool(navigator, tool, signal)))
}
