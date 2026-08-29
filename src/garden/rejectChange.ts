import { GardenFileSystemError, type GardenFileSystem } from '../filesystem/GardenFileSystem'
import { deletePendingChange, readPendingChange } from './pendingChange'

/**
 * Reject a Pending Change: an explicit, first-class outcome (ticket 14), not
 * silence. Deletes the one operational record and touches no canonical file
 * -- there is nothing to revalidate or snapshot, because nothing was ever
 * written.
 */

export type RejectChangeResult =
  | { readonly kind: 'rejected'; readonly itemId: string }
  | { readonly kind: 'not-found'; readonly message: string }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'failed'; readonly message: string }

const GENERIC_FAILURE_MESSAGE = 'The change could not be rejected. Try again.'

export async function rejectChange(
  fileSystem: GardenFileSystem,
  id: string,
): Promise<RejectChangeResult> {
  try {
    const record = await readPendingChange(fileSystem, id)
    if (!record) {
      return { kind: 'not-found', message: `No Pending Change ${id} was found.` }
    }

    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }

    await deletePendingChange(fileSystem, id)

    return { kind: 'rejected', itemId: record.itemId }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required' }
    }
    return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
  }
}

/** The one place `RejectChangeResult`'s non-`rejected` variants become a sentence. */
export function describeRejectChangeFailure(result: RejectChangeResult): string | undefined {
  switch (result.kind) {
    case 'rejected':
      return undefined
    case 'not-found':
      return result.message
    case 'permission-required':
      return 'Permission for this Garden Repository was not available. Try again.'
    case 'failed':
      return result.message
  }
}
