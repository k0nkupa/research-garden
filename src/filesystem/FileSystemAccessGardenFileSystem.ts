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
 * The browser handle surface this adapter depends on, declared structurally.
 *
 * Naming only what is used keeps the adapter honest about its dependency and
 * lets the shared contract suite run against a fake of the same shape.
 */
export interface DirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  entries(): AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<GardenPermissionState>
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<GardenPermissionState>
}

export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
}

const READWRITE = { mode: 'readwrite' } as const

function isDomExceptionNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name
}

/**
 * Translates the port onto the browser's File System Access API.
 *
 * The whole of Research Garden's dependency on that API lives here, so the
 * domain and Action layers never see a browser handle (ADR 0065).
 */
export class FileSystemAccessGardenFileSystem implements GardenFileSystem {
  constructor(private readonly root: DirectoryHandleLike) {}

  get repositoryName(): string {
    return this.root.name
  }

  async permission(): Promise<GardenPermissionState> {
    return (await this.root.queryPermission?.(READWRITE)) ?? 'granted'
  }

  async requestPermission(): Promise<GardenPermissionState> {
    return (await this.root.requestPermission?.(READWRITE)) ?? this.permission()
  }

  async listFiles(directory: GardenPath): Promise<readonly GardenPath[]> {
    assertPathWithinRepository(directory)
    await this.#assertPermitted()

    const handle = await this.#resolveDirectory(directory, { create: false })
    if (handle === undefined) {
      // A typed directory the Garden has no items for is legitimately absent --
      // but so is every directory when the folder itself has been moved or
      // deleted, and that must not read as an empty Garden.
      await this.#assertRepositoryReachable()
      return []
    }

    return this.#collectFiles(handle, directory)
  }

  async read(path: GardenPath): Promise<string> {
    assertPathWithinRepository(path)
    await this.#assertPermitted()

    const { parent, name } = await this.#resolveParent(path)
    if (parent === undefined) {
      throw new GardenFileSystemError('not-found', `"${formatGardenPath(path)}" does not exist.`)
    }

    try {
      const file = await parent.getFileHandle(name)
      return await (await file.getFile()).text()
    } catch (error) {
      throw this.#translate(error, path)
    }
  }

  async readBytes(path: GardenPath): Promise<Uint8Array> {
    assertPathWithinRepository(path)
    await this.#assertPermitted()

    const { parent, name } = await this.#resolveParent(path)
    if (parent === undefined) {
      throw new GardenFileSystemError('not-found', `"${formatGardenPath(path)}" does not exist.`)
    }

    try {
      const file = await parent.getFileHandle(name)
      return new Uint8Array(await (await file.getFile()).arrayBuffer())
    } catch (error) {
      throw this.#translate(error, path)
    }
  }

  async write(path: GardenPath, contents: string): Promise<void> {
    assertPathWithinRepository(path)
    await this.#assertPermitted()

    const parent = await this.#resolveDirectory(path.slice(0, -1), { create: true })
    const name = path.at(-1) as string

    try {
      const file = await parent!.getFileHandle(name, { create: true })
      const writable = await file.createWritable()
      await writable.write(contents)
      await writable.close()
    } catch (error) {
      throw this.#translate(error, path)
    }
  }

  async delete(path: GardenPath): Promise<void> {
    assertPathWithinRepository(path)
    await this.#assertPermitted()

    const { parent, name } = await this.#resolveParent(path)
    // No parent directory, or nothing named `name` in it: already gone,
    // which this port treats the same as having just removed it.
    if (parent === undefined) return

    try {
      await parent.removeEntry(name)
    } catch (error) {
      if (isDomExceptionNamed(error, 'NotFoundError')) return
      throw this.#translate(error, path)
    }
  }

  /**
   * Confirms the selected folder still exists.
   *
   * Without this, a remembered folder that has since been deleted or renamed
   * would report every typed directory as merely absent, and a person's Garden
   * would appear to have quietly emptied itself.
   */
  async #assertRepositoryReachable(): Promise<void> {
    try {
      await this.root.entries().next()
    } catch (error) {
      throw this.#translate(error, [this.root.name])
    }
  }

  async #assertPermitted(): Promise<void> {
    if ((await this.permission()) !== 'granted') throw permissionLapsed()
  }

  async #resolveDirectory(
    path: GardenPath,
    { create }: { create: boolean },
  ): Promise<DirectoryHandleLike | undefined> {
    let handle = this.root
    for (const segment of path) {
      try {
        handle = await handle.getDirectoryHandle(segment, { create })
      } catch (error) {
        if (!create && isDomExceptionNamed(error, 'NotFoundError')) return undefined
        throw this.#translate(error, path)
      }
    }
    return handle
  }

  async #resolveParent(
    path: GardenPath,
  ): Promise<{ parent: DirectoryHandleLike | undefined; name: string }> {
    const parent = await this.#resolveDirectory(path.slice(0, -1), { create: false })
    return { parent, name: path.at(-1) as string }
  }

  async #collectFiles(
    handle: DirectoryHandleLike,
    prefix: GardenPath,
  ): Promise<readonly GardenPath[]> {
    const found: GardenPath[] = []
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'file') {
        found.push([...prefix, name])
      } else {
        found.push(...(await this.#collectFiles(entry, [...prefix, name])))
      }
    }
    return found
  }

  #translate(error: unknown, path: GardenPath): GardenFileSystemError {
    if (error instanceof GardenFileSystemError) return error

    const where = formatGardenPath(path)
    if (isDomExceptionNamed(error, 'NotFoundError')) {
      return new GardenFileSystemError('not-found', `"${where}" does not exist.`)
    }
    if (isDomExceptionNamed(error, 'TypeMismatchError')) {
      return new GardenFileSystemError('not-a-file', `"${where}" is a directory.`)
    }
    if (
      isDomExceptionNamed(error, 'NotAllowedError') ||
      isDomExceptionNamed(error, 'SecurityError')
    ) {
      return permissionLapsed()
    }
    throw error
  }
}
