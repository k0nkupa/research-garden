import { contentHash } from '../domain/hash'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { CANONICAL_DIRECTORIES } from '../domain/schema/itemIdentity'
import { createUlidFactory, browserEntropy, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { readUndoSnapshot, writeUndoSnapshot } from './undoSnapshot'
import { writeAndVerify } from './verifiedWrite'

/**
 * Undo, from a saved Undo Snapshot.
 *
 * ADR 0027: restoring the exact snapshot is only permitted while the current
 * file still matches the applied change's resulting hash, so Undo can never
 * discard work done since the edit it is reverting. ADR 0055 and ADR 0021
 * apply to this write exactly as they do to `editItem`'s: before Undo
 * replaces the canonical file, it snapshots what it is about to overwrite --
 * the edited content -- so that state is not silently lost either, and Undo
 * gets the same reread-revalidate-confirm-hash guarantee any other canonical
 * write gets. The Undo Snapshot Undo restored *from* is never deleted or
 * rewritten, so it stays on disk afterward as the record that the edit and
 * its Undo both happened (ticket 12).
 *
 * Deliberately does not run `ensureMutable` (ADR 0052) the way `editItem`
 * does: that check exists to stop editing a file whose current content is not
 * understood. Undo's precondition is different and already stricter -- the
 * current file's *hash* must match exactly what the edit it is reverting
 * produced -- and gating it on Diagnostics would create exactly the trap the
 * Undo Snapshot exists to prevent: if a person's hand edit *after* an applied
 * change broke the file, `ensureMutable` would refuse to let Undo restore the
 * last known-good version, the one situation where restoring it matters most.
 */

export interface UndoChangeInput {
  readonly itemId: string
  readonly snapshotId: string
}

export interface UndoChangeOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export type UndoChangeResult =
  | {
      readonly kind: 'restored'
      readonly itemId: string
      readonly path: GardenPath
      readonly restoredHash: string
      /** The snapshot this Undo itself recorded of the content it overwrote. */
      readonly snapshotId: string
    }
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'verification-failed'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

/** A fixed, generic reason for an unexpected failure -- never the raw error. */
const GENERIC_FAILURE_MESSAGE = 'Undo could not be completed. Try again.'

export async function undoChange(
  fileSystem: GardenFileSystem,
  input: UndoChangeInput,
  options: UndoChangeOptions = {},
): Promise<UndoChangeResult> {
  try {
    const snapshot = await readUndoSnapshot(fileSystem, input.snapshotId)
    // Addressed by the snapshot's own id, but cross-checked against the item id
    // the caller believes it names -- ticket 12: actions address items by
    // stable id, never a bare, unverified operational record.
    if (!snapshot || snapshot.itemId !== input.itemId) {
      return {
        kind: 'not-found',
        message: `No Undo Snapshot ${input.snapshotId} was found for ${input.itemId}.`,
      }
    }

    // ADR 0058: canonical writes resolve only to the typed Garden directories.
    // A snapshot's `path` was always taken from the Garden Index when it was
    // written (`editItem`), but it travels through this action as data read
    // back off disk, so it is re-checked here rather than trusted blindly --
    // the same posture `assertPathWithinRepository` takes one layer down.
    if (!CANONICAL_DIRECTORIES.includes(snapshot.path[0] ?? '')) {
      return {
        kind: 'failed',
        message: 'This Undo Snapshot does not name a location Research Garden restores to.',
      }
    }

    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }

    const currentText = await fileSystem.read(snapshot.path)
    const currentHash = await contentHash(currentText)
    if (currentHash !== snapshot.resultingHash) {
      return {
        kind: 'stale',
        message:
          'This item changed again after the edit Undo would revert, so Undo was refused to avoid discarding that later change.',
      }
    }

    const now = (options.now ?? nowAsCanonicalTimestamp)()
    const nextSnapshotId = createUlidFactory(options.entropy ?? browserEntropy)
    const undoSnapshotId = nextSnapshotId()

    // Snapshot what Undo is about to overwrite -- the edited content -- before
    // writing, exactly as `editItem` snapshots before its own write. This is
    // what keeps the resulting (pre-Undo) file recoverable rather than merely
    // "not yet deleted": Undo's own effect is undoable through the same path.
    await writeUndoSnapshot(fileSystem, {
      id: undoSnapshotId,
      itemId: input.itemId,
      path: snapshot.path,
      previousText: currentText,
      previousHash: currentHash,
      resultingHash: snapshot.previousHash,
      appliedAt: now,
    })

    const verified = await writeAndVerify(fileSystem, snapshot.path, snapshot.previousText)
    if (verified.kind === 'verification-failed') return verified

    return {
      kind: 'restored',
      itemId: input.itemId,
      path: snapshot.path,
      restoredHash: verified.hash,
      snapshotId: undoSnapshotId,
    }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required' }
    }
    if (error instanceof GardenFileSystemError && error.code === 'not-found') {
      return { kind: 'not-found', message: `No Undo Snapshot ${input.snapshotId} was found.` }
    }
    // As in `editItem`, the underlying error is deliberately not surfaced
    // (ADR 0067): it may carry fragments of file content.
    return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
  }
}

/** The one place `UndoChangeResult`'s non-`restored` variants become a sentence. */
export function describeUndoChangeFailure(result: UndoChangeResult): string | undefined {
  switch (result.kind) {
    case 'restored':
      return undefined
    case 'not-found':
      return result.message
    case 'stale':
      return result.message
    case 'permission-required':
      return 'Permission for this Garden Repository was not available. Try again.'
    case 'verification-failed':
      return result.message
    case 'failed':
      return result.message
  }
}
