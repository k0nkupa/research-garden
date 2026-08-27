import { FileSystemAccessGardenFileSystem } from './FileSystemAccessGardenFileSystem'
import type { DirectoryHandleLike } from './FileSystemAccessGardenFileSystem'
import type { GardenFileSystem } from './GardenFileSystem'

/**
 * Asks the person to choose a Garden Repository.
 *
 * ADR 0006: every Garden is a folder the person selected. This is the only
 * place the picker is called, and it hands back a port rather than a browser
 * handle so nothing above it needs to know which API supplied the folder.
 */
export type ChooseRepositoryResult =
  | {
      readonly kind: 'chosen'
      readonly fileSystem: GardenFileSystem
      /**
       * The handle behind the port, returned here rather than exposed on the
       * port itself so that only ADR 0060's remembering ever sees it.
       */
      readonly handle: DirectoryHandleLike
    }
  /** The person dismissed the picker. Not an error, and nothing has happened. */
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable' }

type DirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite'
  id?: string
}) => Promise<DirectoryHandleLike>

/**
 * The picker is probed from `unknown` rather than read off a declared browser
 * type: the environments that most need describing are exactly the ones whose
 * declarations do not match what is actually present.
 */
export async function chooseGardenRepository(
  source: object = window,
): Promise<ChooseRepositoryResult> {
  const picker = (source as { showDirectoryPicker?: unknown }).showDirectoryPicker
  if (typeof picker !== 'function') return { kind: 'unavailable' }
  const openPicker = picker as DirectoryPicker

  try {
    const handle = await openPicker.call(source, { mode: 'readwrite', id: 'research-garden' })
    return { kind: 'chosen', fileSystem: new FileSystemAccessGardenFileSystem(handle), handle }
  } catch (error) {
    // A dismissed picker arrives as AbortError. Treat it as the non-event it is
    // rather than reporting a failure the person did not cause.
    if (typeof error === 'object' && error !== null && (error as Error).name === 'AbortError') {
      return { kind: 'cancelled' }
    }
    return { kind: 'unavailable' }
  }
}

/** Rebuilds the port from a handle this browser remembered (ADR 0060). */
export function repositoryFromHandle(handle: DirectoryHandleLike): GardenFileSystem {
  return new FileSystemAccessGardenFileSystem(handle)
}
