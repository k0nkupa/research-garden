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
/** Text or raw bytes: an Attachment is not text (ADR 0057). */
export type InMemoryFile = string | Uint8Array

export class InMemoryGardenFileSystem implements GardenFileSystem {
  readonly repositoryName: string
  #files: Map<string, InMemoryFile>
  #permission: GardenPermissionState = 'granted'

  constructor(files: Record<string, InMemoryFile> = {}, repositoryName = 'in-memory-garden') {
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
    return Object.fromEntries(
      [...this.#files].map(([path, contents]) => [path, asText(contents)]),
    )
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
    if (contents !== undefined) return asText(contents)

    // A path that is a prefix of other files names a directory, not a file.
    const isDirectory = [...this.#files.keys()].some((other) => other.startsWith(`${key}/`))
    throw new GardenFileSystemError(
      isDirectory ? 'not-a-file' : 'not-found',
      isDirectory ? `"${key}" is a directory.` : `"${key}" does not exist.`,
    )
  }

  async readBytes(path: GardenPath): Promise<Uint8Array> {
    assertPathWithinRepository(path)
    this.#assertPermitted()

    const contents = this.#files.get(formatGardenPath(path))
    // Bytes are returned exactly as stored, so a byte-corrupting bug in an
    // adapter has somewhere to show itself.
    if (contents !== undefined) {
      return typeof contents === 'string' ? new TextEncoder().encode(contents) : contents
    }

    // Delegating reproduces read()'s not-found and not-a-file distinction.
    await this.read(path)
    throw new GardenFileSystemError('not-found', `"${formatGardenPath(path)}" does not exist.`)
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

function asText(contents: InMemoryFile): string {
  return typeof contents === 'string' ? contents : new TextDecoder().decode(contents)
}
