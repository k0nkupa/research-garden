import { z } from 'zod'
import { contentHash } from '../domain/hash'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import { approveChange, type ApproveChangeResult } from '../garden/approveChange'
import { rejectChange, type RejectChangeResult } from '../garden/rejectChange'
import {
  isPendingChangeStale,
  listPendingChanges,
  readPendingChange,
  type PendingChangeInspectionIdentity,
  type PendingChangeRecord,
} from '../garden/pendingChange'
import { undoChange, type UndoChangeResult } from '../garden/undoChange'
import type { OpenedGarden } from '../garden/openGarden'
import type { UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError } from '../filesystem/GardenFileSystem'
import { errorEnvelope, okEnvelope, type ToolEnvelope } from './envelope'
import { type ModelContextTool, registerModelContextTool } from './modelContext'
import type { StateAwareToolBundle } from './stateAwareTools'

/** Bounds operational records returned by the agent-facing list action. */
export const MAX_PENDING_CHANGES = 25

export interface PendingChangeToolsRuntime {
  getGarden(): OpenedGarden
  refreshGarden?: (() => Promise<OpenedGarden | undefined>) | undefined
  recordActivity(entry: GardenActivityEntry): void
  nextActivityId(): string
  clock(): string
  now?: (() => string) | undefined
  entropy?: UlidEntropy | undefined
  /** Called only after one exact Pending Change diff has been opened. */
  onInspect?: ((inspection: PendingChangeInspectionIdentity) => void) | undefined
  /** The identity recorded by the inspect action, used by apply as an additional gate. */
  getInspected?: (() => PendingChangeInspectionIdentity | undefined) | undefined
  onMutation?: (() => void) | undefined
}

export const listPendingChangesInputSchema = z.strictObject({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type ListPendingChangesInput = z.infer<typeof listPendingChangesInputSchema>

export const inspectPendingChangeInputSchema = z.strictObject({ id: z.string().min(1) })
export type InspectPendingChangeInput = z.infer<typeof inspectPendingChangeInputSchema>

export const applyPendingChangeInputSchema = z.strictObject({
  id: z.string().min(1),
  previewHash: z.string().min(1),
})
export type ApplyPendingChangeInput = z.infer<typeof applyPendingChangeInputSchema>

export const rejectPendingChangeInputSchema = z.strictObject({ id: z.string().min(1) })
export type RejectPendingChangeInput = z.infer<typeof rejectPendingChangeInputSchema>

export const undoChangeInputSchema = z.strictObject({
  itemId: z.string().min(1),
  snapshotId: z.string().min(1),
})
export type UndoChangeToolInput = z.infer<typeof undoChangeInputSchema>

interface PendingChangeSummary {
  readonly id: string
  readonly itemId: string
  readonly path: readonly string[]
  readonly baseHash: string
  readonly previewHash: string
  readonly proposedAt: string
  readonly stale: boolean
}

interface PendingChangeListData {
  readonly changes: readonly PendingChangeSummary[]
  readonly total: number
  readonly offset: number
  readonly nextOffset: number | null
  readonly truncated: boolean
}

interface PendingChangeInspection {
  readonly id: string
  readonly itemId: string
  readonly path: readonly string[]
  readonly baseText: string
  readonly baseHash: string
  readonly previewText: string
  readonly previewHash: string
  readonly proposedAt: string
  readonly stale: boolean
}

const GENERIC_FAILURE = 'This tool could not complete the request. Try again.'
const PERMISSION_MESSAGE = 'Permission for this Garden Repository was not available. Try again.'

function permissionEnvelope(revision: string): ToolEnvelope<never> {
  return errorEnvelope('permission', PERMISSION_MESSAGE, revision)
}

async function currentGarden(runtime: PendingChangeToolsRuntime): Promise<OpenedGarden> {
  try {
    const reopened = await runtime.refreshGarden?.()
    return reopened ?? runtime.getGarden()
  } catch {
    // The already-open Garden remains the best available read view.
  }
  return runtime.getGarden()
}

function activity(
  runtime: PendingChangeToolsRuntime,
  action: GardenActivityEntry['action'],
  itemIds: readonly string[],
  result: ToolEnvelope<unknown>,
): void {
  runtime.recordActivity({
    id: runtime.nextActivityId(),
    action,
    at: runtime.clock(),
    itemIds,
    outcome: result.ok ? 'success' : 'failure',
    detail: result.ok ? undefined : result.error.message,
  })
}

function invalidInput(runtime: PendingChangeToolsRuntime, action: GardenActivityEntry['action'], result: ToolEnvelope<never>): ToolEnvelope<never> {
  activity(runtime, action, [], result)
  return result
}

function summary(record: PendingChangeRecord, stale: boolean): PendingChangeSummary {
  return {
    id: record.id,
    itemId: record.itemId,
    path: record.path,
    baseHash: record.baseHash,
    previewHash: record.previewHash,
    proposedAt: record.proposedAt,
    stale,
  }
}

async function listPending(runtime: PendingChangeToolsRuntime, input: ListPendingChangesInput): Promise<ToolEnvelope<PendingChangeListData>> {
  const garden = await currentGarden(runtime)
  try {
    const records = await listPendingChanges(garden.fileSystem)
    const staleFlags = await Promise.all(records.map((record) => isPendingChangeStale(garden.fileSystem, record)))
    const offset = input.offset ?? 0
    const requestedLimit = input.limit ?? MAX_PENDING_CHANGES
    const limit = Math.min(requestedLimit, MAX_PENDING_CHANGES)
    const changes = records.slice(offset, offset + limit).map((record, index) => summary(record, staleFlags[offset + index] ?? false))
    const nextOffset = offset + changes.length < records.length ? offset + changes.length : null
    const truncated = nextOffset !== null || requestedLimit > MAX_PENDING_CHANGES
    const warnings = truncated
      ? [`Pending Change output is bounded to ${MAX_PENDING_CHANGES} records per call.`]
      : []
    return okEnvelope({ changes, total: records.length, offset, nextOffset, truncated }, garden.index.revision, warnings)
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return permissionEnvelope(garden.index.revision)
    }
    return errorEnvelope('internal', GENERIC_FAILURE, garden.index.revision)
  }
}

async function inspectPending(runtime: PendingChangeToolsRuntime, input: InspectPendingChangeInput): Promise<ToolEnvelope<PendingChangeInspection>> {
  const garden = await currentGarden(runtime)
  try {
    const record = await readPendingChange(garden.fileSystem, input.id)
    if (!record) return errorEnvelope('lookup', `No Pending Change ${input.id} was found.`, garden.index.revision)
    if (await contentHash(record.baseText) !== record.baseHash) {
      return errorEnvelope('inspection', 'This Pending Change has an invalid target preview and cannot be inspected.', garden.index.revision)
    }
    if (await contentHash(record.previewText) !== record.previewHash) {
      return errorEnvelope('inspection', 'This Pending Change has an invalid preview and cannot be inspected.', garden.index.revision)
    }
    const stale = await isPendingChangeStale(garden.fileSystem, record)
    runtime.onInspect?.({ id: record.id, previewHash: record.previewHash })
    return okEnvelope({
      id: record.id,
      itemId: record.itemId,
      path: record.path,
      baseText: record.baseText,
      baseHash: record.baseHash,
      previewText: record.previewText,
      previewHash: record.previewHash,
      proposedAt: record.proposedAt,
      stale,
    }, garden.index.revision)
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return permissionEnvelope(garden.index.revision)
    }
    return errorEnvelope('internal', 'This Pending Change could not be inspected. Try again.', garden.index.revision)
  }
}

function approveEnvelope(result: ApproveChangeResult, revision: string): ToolEnvelope<unknown> {
  switch (result.kind) {
    case 'applied': return okEnvelope({ itemId: result.itemId, path: result.path, snapshotId: result.snapshotId, resultingHash: result.resultingHash }, revision)
    case 'not-found': return errorEnvelope('lookup', result.message, revision)
    case 'preview-mismatch': return errorEnvelope('inspection', result.message, revision)
    case 'stale': return errorEnvelope('staleness', result.message, revision)
    case 'invalid': return errorEnvelope('schema', result.message, revision)
    case 'permission-required': return permissionEnvelope(revision)
    case 'verification-failed': return errorEnvelope('write', result.message, revision)
    case 'failed': return errorEnvelope('write', result.message, revision)
  }
}

function rejectEnvelope(result: RejectChangeResult, revision: string): ToolEnvelope<unknown> {
  switch (result.kind) {
    case 'rejected': return okEnvelope({ itemId: result.itemId }, revision)
    case 'not-found': return errorEnvelope('lookup', result.message, revision)
    case 'permission-required': return permissionEnvelope(revision)
    case 'failed': return errorEnvelope('write', result.message, revision)
  }
}

function undoEnvelope(result: UndoChangeResult, revision: string): ToolEnvelope<unknown> {
  switch (result.kind) {
    case 'restored': return okEnvelope({ itemId: result.itemId, path: result.path, restoredHash: result.restoredHash, snapshotId: result.snapshotId }, revision)
    case 'not-found': return errorEnvelope('lookup', result.message, revision)
    case 'stale': return errorEnvelope('staleness', result.message, revision)
    case 'permission-required': return permissionEnvelope(revision)
    case 'verification-failed': return errorEnvelope('write', result.message, revision)
    case 'failed': return errorEnvelope('write', result.message, revision)
  }
}

function mutationAnnotations() {
  return { destructiveHint: true, untrustedContentHint: true } as const
}

async function refreshRevision(runtime: PendingChangeToolsRuntime, fallback: string): Promise<string> {
  const garden = await currentGarden(runtime)
  return garden.index.revision || fallback
}

function createUndoChangeTool(runtime: PendingChangeToolsRuntime): ModelContextTool {
  return {
    name: 'undo_change',
    description: "Restore one identified applied change from its Undo Snapshot. This mutation is subject to the host's human confirmation flow and refuses newer file content.",
    inputSchema: z.toJSONSchema(undoChangeInputSchema),
    annotations: mutationAnnotations(),
    async execute(rawInput) {
      const garden = runtime.getGarden()
      const parsed = undoChangeInputSchema.safeParse(rawInput)
      if (!parsed.success) return invalidInput(runtime, 'undo_change', errorEnvelope('invalid-input', 'Invalid input.', garden.index.revision))
      const result = undoEnvelope(await undoChange(garden.fileSystem, parsed.data, { now: runtime.now ?? runtime.clock, entropy: runtime.entropy }), garden.index.revision)
      activity(runtime, 'undo_change', [parsed.data.itemId], result)
      if (result.ok) {
        runtime.onMutation?.()
        const revision = await refreshRevision(runtime, result.gardenRevision)
        return { ...result, gardenRevision: revision }
      }
      if (result.error.code !== 'permission') {
        const revision = await refreshRevision(runtime, result.gardenRevision)
        return { ...result, gardenRevision: revision }
      }
      return result
    },
  }
}

/** Creates the three tools available while at least one Pending Change exists. */
export function createPendingChangeTools(runtime: PendingChangeToolsRuntime): readonly ModelContextTool[] {
  const list: ModelContextTool = {
    name: 'list_pending_changes',
    description: `List identified Pending Changes awaiting review, bounded to ${MAX_PENDING_CHANGES} records per call.`,
    inputSchema: z.toJSONSchema(listPendingChangesInputSchema),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(rawInput) {
      const garden = runtime.getGarden()
      const parsed = listPendingChangesInputSchema.safeParse(rawInput)
      if (!parsed.success) return invalidInput(runtime, 'list_pending_changes', errorEnvelope('invalid-input', 'Invalid input.', garden.index.revision))
      const result = await listPending(runtime, parsed.data)
      activity(runtime, 'list_pending_changes', [], result)
      return result
    },
  }
  const inspect: ModelContextTool = {
    name: 'inspect_pending_change',
    description: 'Open one exact Pending Change diff, including the complete proposed file text and preview hash.',
    inputSchema: z.toJSONSchema(inspectPendingChangeInputSchema),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(rawInput) {
      const garden = runtime.getGarden()
      const parsed = inspectPendingChangeInputSchema.safeParse(rawInput)
      if (!parsed.success) return invalidInput(runtime, 'inspect_pending_change', errorEnvelope('invalid-input', 'Invalid input.', garden.index.revision))
      const result = await inspectPending(runtime, parsed.data)
      const itemIds = result.ok ? [result.data.itemId] : []
      activity(runtime, 'inspect_pending_change', itemIds, result)
      return result
    },
  }
  const reject: ModelContextTool = {
    name: 'reject_pending_change',
    description: "Reject one identified Pending Change. This mutation is subject to the host's human confirmation flow.",
    inputSchema: z.toJSONSchema(rejectPendingChangeInputSchema),
    annotations: mutationAnnotations(),
    async execute(rawInput) {
      const garden = runtime.getGarden()
      const parsed = rejectPendingChangeInputSchema.safeParse(rawInput)
      if (!parsed.success) return invalidInput(runtime, 'reject_change', errorEnvelope('invalid-input', 'Invalid input.', garden.index.revision))
      const record = await readPendingChange(garden.fileSystem, parsed.data.id).catch(() => undefined)
      const result = rejectEnvelope(await rejectChange(garden.fileSystem, parsed.data.id), garden.index.revision)
      const resultItemId = result.ok ? (result.data as { readonly itemId: string }).itemId : undefined
      activity(runtime, 'reject_change', resultItemId ? [resultItemId] : record ? [record.itemId] : [], result)
      if (result.ok) {
        runtime.onMutation?.()
        const revision = await refreshRevision(runtime, result.gardenRevision)
        return { ...result, gardenRevision: revision }
      }
      return result
    },
  }
  return [list, inspect, reject]
}

/** The apply action is separate so registration can only expose it after inspection. */
export function createApplyPendingChangeTool(runtime: PendingChangeToolsRuntime): ModelContextTool {
  return {
    name: 'apply_pending_change',
    description: "Apply one exact inspected Pending Change after the host's human confirmation flow. The request must carry that change's id and preview hash.",
    inputSchema: z.toJSONSchema(applyPendingChangeInputSchema),
    annotations: mutationAnnotations(),
    async execute(rawInput) {
      const garden = runtime.getGarden()
      const parsed = applyPendingChangeInputSchema.safeParse(rawInput)
      if (!parsed.success) return invalidInput(runtime, 'approve_change', errorEnvelope('invalid-input', 'Invalid input.', garden.index.revision))
      // Resolve the record before the inspection gate so even a rejected
      // preview/inspection request can identify the affected item safely.
      const record = await readPendingChange(garden.fileSystem, parsed.data.id).catch(() => undefined)
      const inspected = runtime.getInspected?.()
      if (!inspected || inspected.id !== parsed.data.id || inspected.previewHash !== parsed.data.previewHash) {
        const result = errorEnvelope('inspection', 'Inspect this exact Pending Change before applying it.', garden.index.revision)
        activity(runtime, 'approve_change', record ? [record.itemId] : [], result)
        return result
      }
      const action = await approveChange(garden.fileSystem, parsed.data, { now: runtime.now ?? runtime.clock, entropy: runtime.entropy })
      let result = approveEnvelope(action, garden.index.revision)
      const itemIds = result.ok ? [(result.data as { readonly itemId: string }).itemId] : record ? [record.itemId] : []
      activity(runtime, 'approve_change', itemIds, result)
      if (result.ok) {
        runtime.onMutation?.()
        const revision = await refreshRevision(runtime, result.gardenRevision)
        result = { ...result, gardenRevision: revision }
      } else if (action.kind !== 'permission-required') {
        // Approval rescans before returning stale/failed outcomes. Refresh the
        // caller's view as well, while retaining the inspection authorization
        // if the exact operational record still exists.
        const revision = await refreshRevision(runtime, result.gardenRevision)
        result = { ...result, gardenRevision: revision }
      }
      return result
    },
  }
}

export function createPendingChangeToolsBundles(runtime: PendingChangeToolsRuntime): readonly StateAwareToolBundle[] {
  const tools = createPendingChangeTools(runtime)
  const undo = createUndoChangeTool(runtime)
  return [
    {
      id: 'pending-changes',
      tools,
      isRelevant: (state) => state.hasPendingChanges,
    },
    {
      id: 'pending-undo',
      tools: [undo],
      isRelevant: (state) => state.gardenOpen,
    },
    {
      id: 'pending-apply',
      tools: [createApplyPendingChangeTool(runtime)],
      isRelevant: (state) => state.hasPendingChanges && state.inspectedChangeId !== undefined,
    },
  ]
}

export async function registerPendingChangeTools(navigator: unknown, runtime: PendingChangeToolsRuntime, signal: AbortSignal): Promise<void> {
  await Promise.all(createPendingChangeTools(runtime).map((tool) => registerModelContextTool(navigator, tool, signal)))
}

/** Registers only the apply action; callers must invoke this after exact inspection. */
export async function registerApplyPendingChangeTool(navigator: unknown, runtime: PendingChangeToolsRuntime, signal: AbortSignal): Promise<void> {
  if (!runtime.getInspected?.()) return
  await registerModelContextTool(navigator, createApplyPendingChangeTool(runtime), signal)
}
