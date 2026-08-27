import type {
  DirectoryHandleLike,
  FileHandleLike,
} from './FileSystemAccessGardenFileSystem'
import type { GardenPermissionState } from './GardenFileSystem'

/**
 * A fake of the browser's File System Access handles.
 *
 * This exists so the shared contract suite can run against the real adapter
 * under the unit suite, catching translation mistakes — path walking,
 * permission mapping, DOMException handling — that an in-memory adapter alone
 * would never exercise. It is not a substitute for the real-browser acceptance
 * run required by ADR 0064.
 */
function domException(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

interface FakeState {
  permission: GardenPermissionState
}

class FakeFileHandle implements FileHandleLike {
  readonly kind = 'file' as const

  constructor(
    readonly name: string,
    private readonly directory: FakeDirectoryHandle,
    private readonly state: FakeState,
  ) {}

  async getFile() {
    this.#assertPermitted()
    return { text: async () => this.directory.contentsOf(this.name) }
  }

  async createWritable() {
    this.#assertPermitted()
    // Real File System Access truncates on open rather than buffering to close.
    // The fake does the same so it cannot make a write look more atomic than it
    // is: recovering a write interrupted part way through is what the Undo
    // Snapshot and reread-and-verify sequence in ticket 12 exists for.
    this.directory.setContents(this.name, '')
    return {
      write: async (data: string) => {
        this.#assertPermitted()
        this.directory.setContents(this.name, this.directory.contentsOf(this.name) + data)
      },
      close: async () => {
        this.#assertPermitted()
      },
    }
  }

  #assertPermitted() {
    if (this.state.permission !== 'granted') throw domException('NotAllowedError')
  }
}

export class FakeDirectoryHandle implements DirectoryHandleLike {
  readonly kind = 'directory' as const
  #directories = new Map<string, FakeDirectoryHandle>()
  #files = new Map<string, string>()

  constructor(
    readonly name: string,
    private readonly state: FakeState = { permission: 'granted' },
  ) {}

  static fromFiles(files: Record<string, string>, name = 'fake-garden'): FakeDirectoryHandle {
    const root = new FakeDirectoryHandle(name)
    for (const [path, contents] of Object.entries(files)) {
      const segments = path.split('/')
      const fileName = segments.pop() as string
      let directory = root
      for (const segment of segments) directory = directory.ensureDirectory(segment)
      directory.setContents(fileName, contents)
    }
    return root
  }

  setPermission(permission: GardenPermissionState): void {
    this.state.permission = permission
  }

  ensureDirectory(name: string): FakeDirectoryHandle {
    const existing = this.#directories.get(name)
    if (existing) return existing
    const created = new FakeDirectoryHandle(name, this.state)
    this.#directories.set(name, created)
    return created
  }

  setContents(name: string, contents: string): void {
    this.#files.set(name, contents)
  }

  contentsOf(name: string): string {
    const contents = this.#files.get(name)
    if (contents === undefined) throw domException('NotFoundError')
    return contents
  }

  async queryPermission(): Promise<GardenPermissionState> {
    return this.state.permission
  }

  async requestPermission(): Promise<GardenPermissionState> {
    return this.state.permission
  }

  async *entries(): AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]> {
    this.#assertPermitted()
    for (const [name] of this.#files) {
      yield [name, new FakeFileHandle(name, this, this.state)]
    }
    for (const [name, directory] of this.#directories) {
      yield [name, directory]
    }
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<DirectoryHandleLike> {
    this.#assertPermitted()
    if (this.#files.has(name)) throw domException('TypeMismatchError')

    const existing = this.#directories.get(name)
    if (existing) return existing
    if (!options?.create) throw domException('NotFoundError')
    return this.ensureDirectory(name)
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    this.#assertPermitted()
    if (this.#directories.has(name)) throw domException('TypeMismatchError')

    if (!this.#files.has(name)) {
      if (!options?.create) throw domException('NotFoundError')
      this.setContents(name, '')
    }
    return new FakeFileHandle(name, this, this.state)
  }

  #assertPermitted() {
    if (this.state.permission !== 'granted') throw domException('NotAllowedError')
  }
}
