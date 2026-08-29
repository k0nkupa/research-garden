import { contentHash } from '../domain/hash'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { CANONICAL_DIRECTORIES } from '../domain/schema/itemIdentity'
import { createUlidFactory, browserEntropy, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { diagnosticsForItem } from './mutationGuard'
import { deletePendingChange, readPendingChange } from './pendingChange'
import { scanCanonicalFiles } from './openGarden'
import { writeUndoSnapshot } from './undoSnapshot'
import { writeAndVerify } from './verifiedWrite'

/**
 * Approve a Pending Change: revalidate everything, then apply it exactly
 * once (ADR 0025, ADR 0055, ticket 14).
 *
 * Deliberately takes no `GardenIndex` -- unlike `editItem`, which trusts the
 * index its caller already has because a person is looking at the Tree it
 * came from, an approval may land long after the proposal and after other
 * writes, so it rescans the Garden itself rather than trusting anything
 * handed in. The checklist runs in order: the record's path names a location
 * Research Garden actually writes to (ADR 0058), the record itself is
 * internally consistent (its stored `previewHash` really is the hash of its
 * stored `previewText`), the caller's `previewHash` still names what this
 * record actually holds (ADR 0025 -- `inspect_pending_change` and
 * `apply_pending_change` must agree on what was reviewed), directory
 * permission, the target's current content hash against what the proposal
 * was built from (staleness), and finally -- substituting the proposed text
 * into a full rescan -- that applying it would still leave the target item
 * schema-valid and graph-invariant-clean. Only once every one of those holds
 * does the familiar snapshot-write-reread-verify sequence (`writeAndVerify`,
 * ADR 0055) run, exactly as it does for a person's own edit.
 */

export interface ApproveChangeInput {
  readonly id: string
  /** What the caller actually inspected; a mismatch is refused, never trusted (ADR 0025). */
  readonly previewHash: string
}

export interface ApproveChangeOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export type ApproveChangeResult =
  | {
      readonly kind: 'applied'
      readonly itemId: string
      readonly path: GardenPath
      readonly snapshotId: string
      readonly resultingHash: string
    }
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'preview-mismatch'; readonly message: string }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'verification-failed'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

const GENERIC_FAILURE_MESSAGE =
  'The change could not be applied. Check that the Garden Repository is still available and try again.'

export async function approveChange(
  fileSystem: GardenFileSystem,
  input: ApproveChangeInput,
  options: ApproveChangeOptions = {},
): Promise<ApproveChangeResult> {
  try {
    const record = await readPendingChange(fileSystem, input.id)
    if (!record) {
      return { kind: 'not-found', message: `No Pending Change ${input.id} was found.` }
    }

    // ADR 0058: canonical writes resolve only to the typed Garden directories.
    // A record's `path` was always written from the Garden Index it was
    // proposed against, but it travels through this action as data read back
    // off disk, so it is re-checked here rather than trusted blindly.
    if (!CANONICAL_DIRECTORIES.includes(record.path[0] ?? '')) {
      return {
        kind: 'failed',
        message: 'This Pending Change does not name a location Research Garden writes to.',
      }
    }

    // The record's own `previewHash` is what the input is about to be
    // checked against below, and what the Undo Snapshot will later record as
    // `resultingHash` -- so it is verified against the record's actual
    // `previewText` here, rather than trusted as data read back off disk.
    const previewTextHash = await contentHash(record.previewText)
    if (previewTextHash !== record.previewHash) {
      return {
        kind: 'failed',
        message: 'This Pending Change record is internally inconsistent and cannot be applied.',
      }
    }

    if (input.previewHash !== record.previewHash) {
      return {
        kind: 'preview-mismatch',
        message: 'What was approved does not match what this Pending Change currently holds. Reopen it and review again.',
      }
    }

    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }

    // One rescan serves both remaining checks: the target's current hash
    // (staleness) is read from it directly, and it is what gets the
    // proposed text substituted into for the schema/graph check below --
    // one fresh, complete picture of the Garden as it stands right now.
    const scanned = await scanCanonicalFiles(fileSystem)
    const targetKey = record.path.join('/')
    const currentFile = scanned.find((file) => file.path.join('/') === targetKey)

    if (!currentFile) {
      return {
        kind: 'stale',
        message: 'The item this change targets no longer exists. Reopen the Garden to see its current state.',
      }
    }

    const currentHash = await contentHash(currentFile.text)
    if (currentHash !== record.baseHash) {
      return {
        kind: 'stale',
        message:
          'This item changed since the proposal was made, so approving it was refused to avoid overwriting that newer change.',
      }
    }

    // Schema and graph invariants (ADR 0079): the whole current Garden, with
    // only this one file's text replaced by what approving would write.
    const substituted = scanned.map((file) =>
      file.path.join('/') === targetKey ? { path: file.path, text: record.previewText } : file,
    )
    const revalidated = await buildGardenIndex(substituted)
    const problems = diagnosticsForItem(revalidated, record.itemId)
    if (!revalidated.items.has(record.itemId) || problems.length > 0) {
      return {
        kind: 'invalid',
        message: 'Applying this change would leave the item invalid, so it was refused rather than written.',
      }
    }

    const now = (options.now ?? nowAsCanonicalTimestamp)()
    const nextSnapshotId = createUlidFactory(options.entropy ?? browserEntropy)
    const snapshotId = nextSnapshotId()

    // Snapshot before the write, exactly as `editItem` does, so the
    // pre-approval content is recoverable even if the write itself fails
    // partway (ADR 0055).
    await writeUndoSnapshot(fileSystem, {
      id: snapshotId,
      itemId: record.itemId,
      path: record.path,
      previousText: currentFile.text,
      previousHash: currentHash,
      resultingHash: record.previewHash,
      appliedAt: now,
    })

    const verified = await writeAndVerify(fileSystem, record.path, record.previewText)
    if (verified.kind === 'verification-failed') return verified

    // Applied: the proposal is no longer pending. The Undo Snapshot just
    // written is what stays as the recovery record from here (ADR 0027).
    // Isolated from the outer catch: the write above already succeeded, so a
    // failure here must not be reported as the whole approval having failed.
    // A record left behind this way will show as Stale on the next rescan
    // (its `baseHash` no longer matches the now-written file), and rejecting
    // a Stale proposal is always safe -- it never touches the canonical file.
    try {
      await deletePendingChange(fileSystem, record.id)
    } catch {
      // Deliberately swallowed, for the reason above.
    }

    return {
      kind: 'applied',
      itemId: record.itemId,
      path: record.path,
      snapshotId,
      resultingHash: verified.hash,
    }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required' }
    }
    // As in `editItem`, the underlying error is deliberately not surfaced
    // (ADR 0067): it may carry fragments of file content.
    return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
  }
}

/** The one place `ApproveChangeResult`'s non-`applied` variants become a sentence. */
export function describeApproveChangeFailure(result: ApproveChangeResult): string | undefined {
  switch (result.kind) {
    case 'applied':
      return undefined
    case 'not-found':
      return result.message
    case 'preview-mismatch':
      return result.message
    case 'stale':
      return result.message
    case 'invalid':
      return result.message
    case 'permission-required':
      return 'Permission for this Garden Repository was not available. Try again.'
    case 'verification-failed':
      return result.message
    case 'failed':
      return result.message
  }
}
