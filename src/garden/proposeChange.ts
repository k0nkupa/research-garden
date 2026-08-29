import type { GardenIndex } from '../domain/index/gardenIndex'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { createUlidFactory, browserEntropy, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { deriveBodyEdit, type BodyEditInput, type BodyEditRefusal } from './deriveBodyEdit'
import { writePendingChange, type PendingChangeRecord } from './pendingChange'

/**
 * Propose an edit, without touching canonical files (ADR 0005, ticket 14).
 *
 * The agent-facing counterpart to `editItem`: the same checks, through the
 * same `deriveBodyEdit`, but a `'ready'` derivation becomes a Pending Change
 * record rather than a write. No Undo Snapshot either -- nothing was
 * changed yet to snapshot; that happens if and when `approveChange` applies
 * it (ticket 14).
 */

export interface ProposeChangeOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export type ProposeChangeResult =
  | {
      readonly kind: 'proposed'
      readonly id: string
      readonly itemId: string
      readonly path: GardenPath
      readonly previewHash: string
    }
  /** The body is identical to what is already on disk -- nothing to propose. */
  | { readonly kind: 'no-op'; readonly itemId: string }
  | BodyEditRefusal

const GENERIC_FAILURE_MESSAGE =
  'The proposal could not be recorded. Check that the Garden Repository is still available and try again.'

export async function proposeChange(
  fileSystem: GardenFileSystem,
  index: GardenIndex,
  input: BodyEditInput,
  options: ProposeChangeOptions = {},
): Promise<ProposeChangeResult> {
  // Computed once and reused for both `updated_at` (inside `deriveBodyEdit`)
  // and this record's `proposedAt` below, so the two can never disagree.
  const proposedAt = (options.now ?? nowAsCanonicalTimestamp)()

  try {
    const derived = await deriveBodyEdit(fileSystem, index, input, proposedAt)

    if (derived.kind !== 'ready' && derived.kind !== 'no-op') return derived
    if (derived.kind === 'no-op') return { kind: 'no-op', itemId: input.itemId }

    const { indexed, currentText, currentHash, newText, resultingHash } = derived

    // A bare ULID, not a kind-prefixed item id: a Pending Change is an
    // operational record, not a Garden item (same as an Undo Snapshot's id).
    const nextId = createUlidFactory(options.entropy ?? browserEntropy)
    const id = nextId()

    const record: PendingChangeRecord = {
      id,
      itemId: input.itemId,
      path: indexed.path,
      baseText: currentText,
      baseHash: currentHash,
      baseState: 'present',
      previewText: newText,
      previewHash: resultingHash,
      proposedAt,
    }

    await writePendingChange(fileSystem, record)

    return { kind: 'proposed', id, itemId: input.itemId, path: indexed.path, previewHash: resultingHash }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required' }
    }
    // As in `editItem`, the underlying error is deliberately not surfaced
    // (ADR 0067): it may carry fragments of file content.
    return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
  }
}

/** The one place `ProposeChangeResult`'s non-`proposed` variants become a sentence. */
export function describeProposeChangeFailure(result: ProposeChangeResult): string | undefined {
  switch (result.kind) {
    case 'proposed':
      return undefined
    case 'no-op':
      return 'This body is identical to what is already on disk; there is nothing to propose.'
    case 'blocked':
      return result.reason
    case 'evidence-refused':
      return result.message
    case 'permission-required':
      return 'Permission for this Garden Repository was not available. Try again.'
    case 'stale':
      return result.message
    case 'failed':
      return result.message
  }
}

// Ticket 22 keeps the existing body-edit action intact while exposing the
// three structural proposal actions from a discoverable proposal module.
export {
  proposeHarvest,
  proposeHarvestInputSchema,
  proposeMove,
  proposeMoveInputSchema,
  proposeRelation,
  proposeRelationInputSchema,
} from './proposalTools'
export type {
  ProposeHarvestInput,
  ProposeMoveInput,
  ProposeRelationInput,
  ProposalOptions,
  ProposalResult,
} from './proposalTools'
