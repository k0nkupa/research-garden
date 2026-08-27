import {
  GardenFileSystemError,
  assertPathWithinRepository,
  permissionLapsed,
  formatGardenPath,
  type GardenFileSystem,
  type GardenPath,
  type GardenPermissionState,
} from './GardenFileSystem'

/**
 * A deterministic Garden Repository held in memory.
 *
 * This is what makes the domain and Action layers testable without a browser
 * (ADR 0065). It is a real adapter, not a stub: it satisfies the same contract
 * as the File System Access adapter, including path safety and permission loss.
 */
export class InMemoryGardenFileSystem implements GardenFileSystem {
  readonly repositoryName: string
  #files: Map<string, string>
  #permission: GardenPermissionState = 'granted'

  constructor(files: Record<string, string> = {}, repositoryName = 'in-memory-garden') {
    this.repositoryName = repositoryName
    this.#files = new Map(Object.entries(files))
  }

  /** Test affordance: revoke access the way a browser does between sessions. */
  revokePermission(): void {
    this.#permission = 'denied'
  }

  grantPermission(): void {
    this.#permission = 'granted'
  }

  /** Test affordance: inspect what was actually written, without going through read(). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.#files)
  }

  async permission(): Promise<GardenPermissionState> {
    return this.#permission
  }

  async requestPermission(): Promise<GardenPermissionState> {
    return this.#permission
  }

  async listFiles(directory: GardenPath): Promise<readonly GardenPath[]> {
    assertPathWithinRepository(directory)
    this.#assertPermitted()

    const prefix = `${formatGardenPath(directory)}/`
    return [...this.#files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.split('/'))
  }

  async read(path: GardenPath): Promise<string> {
    assertPathWithinRepository(path)
    this.#assertPermitted()

    const key = formatGardenPath(path)
    const contents = this.#files.get(key)
    if (contents !== undefined) return contents

    // A path that is a prefix of other files names a directory, not a file.
    const isDirectory = [...this.#files.keys()].some((other) => other.startsWith(`${key}/`))
    throw new GardenFileSystemError(
      isDirectory ? 'not-a-file' : 'not-found',
      isDirectory ? `"${key}" is a directory.` : `"${key}" does not exist.`,
    )
  }

  async write(path: GardenPath, contents: string): Promise<void> {
    assertPathWithinRepository(path)
    this.#assertPermitted()

    this.#files.set(formatGardenPath(path), contents)
  }

  #assertPermitted(): void {
    if (this.#permission !== 'granted') throw permissionLapsed()
  }
}
