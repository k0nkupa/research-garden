/**
 * The filesystem port.
 *
 * Every layer above this one addresses the Garden Repository through this
 * interface and never through a browser API, so domain logic stays testable
 * without a browser and the File System Access adapter stays replaceable
 * (ADR 0065). ADR 0058 makes the port the enforcement point for path safety:
 * paths are relative segment lists, and nothing that escapes the selected
 * Garden Repository resolves.
 */

/** A location inside the Garden Repository, as relative path segments. */
export type GardenPath = readonly string[]

export type GardenPermissionState = 'granted' | 'prompt' | 'denied'

export type GardenFileSystemErrorCode =
  /** The browser no longer permits access to the selected folder. */
  | 'permission-denied'
  /** Nothing exists at that path. */
  | 'not-found'
  /** The path names a directory where a file was expected, or the reverse. */
  | 'not-a-file'
  /** The path would leave the Garden Repository, or is not a relative path. */
  | 'path-escape'

export class GardenFileSystemError extends Error {
  constructor(
    readonly code: GardenFileSystemErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GardenFileSystemError'
  }
}

export interface GardenFileSystem {
  /** The folder's display name, for the interface only. Never a filesystem path. */
  readonly repositoryName: string

  /** The browser's current permission for the selected folder. */
  permission(): Promise<GardenPermissionState>

  /** Ask the browser to restore permission after it has lapsed. */
  requestPermission(): Promise<GardenPermissionState>

  /**
   * Every file beneath `directory`, recursively. A directory that does not
   * exist lists as empty rather than throwing: a Garden Repository legitimately
   * lacks typed directories it has no items for.
   */
  listFiles(directory: GardenPath): Promise<readonly GardenPath[]>

  read(path: GardenPath): Promise<string>

  /**
   * The raw bytes at a path.
   *
   * Attachments are a person's own supporting files -- images, PDFs -- and are
   * not text (ADR 0057). Reading them as text would corrupt them.
   */
  readBytes(path: GardenPath): Promise<Uint8Array>

  /** One complete write. Verification of the result belongs to a later layer. */
  write(path: GardenPath, contents: string): Promise<void>

  /**
   * Removes one file. Never used on canonical Markdown (ADR 0021 gives each
   * MVP Garden Action at most one canonical write, never a deletion) --
   * this exists for rejecting a Pending Change (ticket 14), which is
   * removing an operational record, not touching a person's knowledge.
   * Resolves without error when nothing exists at that path, matching
   * `listFiles`'s own "absence is not failure" stance.
   */
  delete(path: GardenPath): Promise<void>
}

/**
 * Rejects anything that is not a plain relative path inside the repository.
 * Applied by every adapter, so no caller can reach outside the folder the
 * person selected (ADR 0058).
 */
export function assertPathWithinRepository(path: GardenPath): void {
  if (path.length === 0) {
    throw new GardenFileSystemError('path-escape', 'An empty path names no file.')
  }

  for (const segment of path) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new GardenFileSystemError(
        'path-escape',
        `"${path.join('/')}" does not stay inside the Garden Repository.`,
      )
    }
    if (segment.includes('/') || segment.includes('\\')) {
      throw new GardenFileSystemError(
        'path-escape',
        `"${segment}" is a path, not a single name.`,
      )
    }
  }
}

/** One wording for the one recoverable filesystem state. */
export const PERMISSION_LAPSED_MESSAGE =
  'Research Garden no longer has permission for this folder.'

export function permissionLapsed(): GardenFileSystemError {
  return new GardenFileSystemError('permission-denied', PERMISSION_LAPSED_MESSAGE)
}

export function formatGardenPath(path: GardenPath): string {
  return path.join('/')
}
