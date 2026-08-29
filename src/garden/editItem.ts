import type { GardenIndex } from '../domain/index/gardenIndex'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { createUlidFactory, browserEntropy, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { deriveBodyEdit, type BodyEditRefusal } from './deriveBodyEdit'
import { writeUndoSnapshot } from './undoSnapshot'
import { writeAndVerify } from './verifiedWrite'

/**
 * Human edit with a verified write.
 *
 * The first Garden Action that changes a person's files (ticket 12). ADR 0055
 * fixes the sequence: revalidate permission and the target's content hash,
 * snapshot the previous content as an Undo Snapshot, write once, reread,
 * revalidate, confirm the content hash, then report. Only body text is edited
 * -- frontmatter Research Garden did not ask to change survives untouched
 * (ADR 0078), and `updated_at` is the only field this action itself sets
 * (ADR 0077).
 *
 * At most one canonical file is touched per call (ADR 0021): the Undo
 * Snapshot is an operational write, not a second canonical one. A body that
 * comes back identical to what is already on disk is not an edit and writes
 * nothing at all, so `updated_at` never moves for a no-op save.
 *
 * A person edits their own files directly, without approval -- unlike
 * `proposeChange` (ticket 14), which an agent uses instead, because ADR 0005
 * asks an agent's edit to a person's existing knowledge for a preview and
 * explicit approval first. The checks and the derivation of what would be
 * written are shared with it (`deriveBodyEdit`), so a person's edit and an
 * agent's proposed one can never validate against different rules; only what
 * happens once a proposed body is `'ready'` differs -- write it now, or hold
 * it for review.
 */

export interface EditItemInput {
  readonly itemId: string
  /** The raw file text as read when editing began, so a concurrent change is detectable. */
  readonly baseText: string
  readonly newBody: string
}

export interface EditItemOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export type EditItemResult =
  | {
      readonly kind: 'saved'
      readonly itemId: string
      readonly path: GardenPath
      /**
       * Addresses the Undo Snapshot this save produced; pass to `undoChange`.
       * `undefined` when the edit was a no-op (ADR 0077: `updated_at` moves
       * only when the item is actually edited, so a no-op writes nothing and
       * has no snapshot to undo).
       */
      readonly snapshotId: string | undefined
      readonly previousHash: string
      readonly resultingHash: string
    }
  | BodyEditRefusal
  | { readonly kind: 'verification-failed'; readonly message: string }

/** A fixed, generic reason for an unexpected failure -- never the raw error. */
const GENERIC_FAILURE_MESSAGE =
  'The edit could not be saved. Check that the Garden Repository is still available and try again.'

export async function editItem(
  fileSystem: GardenFileSystem,
  index: GardenIndex,
  input: EditItemInput,
  options: EditItemOptions = {},
): Promise<EditItemResult> {
  // Computed once and reused for both `updated_at` (inside `deriveBodyEdit`)
  // and the Undo Snapshot's `appliedAt` below, so the two can never disagree.
  const appliedAt = (options.now ?? nowAsCanonicalTimestamp)()

  try {
    const derived = await deriveBodyEdit(fileSystem, index, input, appliedAt)

    if (derived.kind !== 'ready' && derived.kind !== 'no-op') return derived

    if (derived.kind === 'no-op') {
      return {
        kind: 'saved',
        itemId: input.itemId,
        path: derived.indexed.path,
        snapshotId: undefined,
        previousHash: derived.currentHash,
        resultingHash: derived.currentHash,
      }
    }

    const { indexed, currentText, currentHash, newText, resultingHash } = derived

    const nextSnapshotId = createUlidFactory(options.entropy ?? browserEntropy)
    const snapshotId = nextSnapshotId()

    // Snapshot before the write, so the previous content is recoverable even
    // if the write itself fails partway (ADR 0055).
    await writeUndoSnapshot(fileSystem, {
      id: snapshotId,
      itemId: input.itemId,
      path: indexed.path,
      previousState: 'present',
      previousText: currentText,
      previousHash: currentHash,
      resultingHash,
      appliedAt,
    })

    const verified = await writeAndVerify(fileSystem, indexed.path, newText)
    if (verified.kind === 'verification-failed') return verified

    return {
      kind: 'saved',
      itemId: input.itemId,
      path: indexed.path,
      snapshotId,
      previousHash: currentHash,
      resultingHash: verified.hash,
    }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required' }
    }
    // The underlying error is deliberately not surfaced: it may be a
    // filesystem or parser error carrying fragments of file content, and
    // Garden Activity (which this result eventually reaches) never carries
    // raw content (ADR 0067).
    return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * The one place `EditItemResult`'s non-`saved` variants become a sentence.
 *
 * Both the Activity feed (`gardenActivity.ts`) and the Edit form itself
 * (`ItemPanel.tsx`) need to say why a save did not succeed, in the same words
 * -- so this is written once, next to the result type it describes, rather
 * than as two switches that could drift apart.
 */
export function describeEditItemFailure(result: EditItemResult): string | undefined {
  switch (result.kind) {
    case 'saved':
      return undefined
    case 'blocked':
      return result.reason
    case 'evidence-refused':
      return result.message
    case 'permission-required':
      return 'Permission for this Garden Repository was not available. Try again.'
    case 'stale':
      return result.message
    case 'verification-failed':
      return result.message
    case 'failed':
      return result.message
  }
}
