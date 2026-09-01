import {
  GardenFileSystemError,
  assertPathWithinRepository,
  formatGardenPath,
  type GardenFileSystem,
  type GardenPath,
  type GardenPermissionState,
} from './GardenFileSystem'

export interface ImportedGardenSnapshot {
  readonly repositoryName: string
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly hasUnexportedChanges: boolean
}

export interface ImportedGardenStore {
  load(): Promise<ImportedGardenSnapshot | undefined>
  save(snapshot: ImportedGardenSnapshot): Promise<void>
  clear(): Promise<void>
}

export class InMemoryImportedGardenStore implements ImportedGardenStore {
  #snapshot: ImportedGardenSnapshot | undefined
  async load() { return this.#snapshot }
  async save(snapshot: ImportedGardenSnapshot) { this.#snapshot = snapshot }
  async clear() { this.#snapshot = undefined }
}

/** Browser-local, single-working-copy persistence. No folder handles or agent state are stored. */
export class IndexedDbImportedGardenStore implements ImportedGardenStore {
  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('research-garden', 2)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('imported-garden')) request.result.createObjectStore('imported-garden')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  async #use<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
    const database = await this.#open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = operation(database.transaction('imported-garden', mode).objectStore('imported-garden'))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  }
  async load(): Promise<ImportedGardenSnapshot | undefined> {
    return (await this.#use<ImportedGardenSnapshot | undefined>('readonly', (store) => store.get('current'))) ?? undefined
  }
  async save(snapshot: ImportedGardenSnapshot): Promise<void> { await this.#use('readwrite', (store) => store.put(snapshot, 'current')) }
  async clear(): Promise<void> { await this.#use('readwrite', (store) => store.delete('current')) }
}

export function browserImportedGardenStore(): ImportedGardenStore {
  return typeof indexedDB === 'undefined' ? new InMemoryImportedGardenStore() : new IndexedDbImportedGardenStore()
}

/** A persistent browser-local Garden filesystem. It deliberately never holds a source-folder handle. */
export class ImportedGardenFileSystem implements GardenFileSystem {
  readonly repositoryName: string
  #files: Map<string, Uint8Array>
  #dirty: boolean
  readonly #store: ImportedGardenStore

  private constructor(snapshot: ImportedGardenSnapshot, store: ImportedGardenStore) {
    this.repositoryName = snapshot.repositoryName
    this.#files = new Map(Object.entries(snapshot.files).map(([path, bytes]) => [path, new Uint8Array(bytes)]))
    this.#dirty = snapshot.hasUnexportedChanges
    this.#store = store
  }

  static async create(repositoryName: string, files: Readonly<Record<string, Uint8Array>>, store: ImportedGardenStore): Promise<ImportedGardenFileSystem> {
    const snapshot = { repositoryName, files, hasUnexportedChanges: false }
    const fileSystem = new ImportedGardenFileSystem(snapshot, store)
    await store.save(fileSystem.snapshot())
    return fileSystem
  }

  static async resume(store: ImportedGardenStore): Promise<ImportedGardenFileSystem | undefined> {
    const snapshot = await store.load()
    return snapshot ? new ImportedGardenFileSystem(snapshot, store) : undefined
  }

  snapshot(): ImportedGardenSnapshot {
    return { repositoryName: this.repositoryName, files: Object.fromEntries([...this.#files].map(([path, bytes]) => [path, new Uint8Array(bytes)])), hasUnexportedChanges: this.#dirty }
  }
  async discard(): Promise<void> { await this.#store.clear() }
  async markExported(): Promise<void> {
    const snapshot = { ...this.snapshot(), hasUnexportedChanges: false }
    await this.#store.save(snapshot)
    this.#dirty = false
  }
  get hasUnexportedChanges() { return this.#dirty }
  async permission(): Promise<GardenPermissionState> { return 'granted' }
  async requestPermission(): Promise<GardenPermissionState> { return 'granted' }
  async listFiles(directory: GardenPath): Promise<readonly GardenPath[]> {
    assertPathWithinRepository(directory)
    const prefix = `${formatGardenPath(directory)}/`
    return [...this.#files.keys()].filter((path) => path.startsWith(prefix)).map((path) => path.split('/'))
  }
  async read(path: GardenPath): Promise<string> { return new TextDecoder().decode(await this.readBytes(path)) }
  async readBytes(path: GardenPath): Promise<Uint8Array> {
    assertPathWithinRepository(path)
    const key = formatGardenPath(path)
    const contents = this.#files.get(key)
    if (contents) return new Uint8Array(contents)
    const isDirectory = [...this.#files.keys()].some((other) => other.startsWith(`${key}/`))
    throw new GardenFileSystemError(isDirectory ? 'not-a-file' : 'not-found', isDirectory ? `"${key}" is a directory.` : `"${key}" does not exist.`)
  }
  async write(path: GardenPath, contents: string): Promise<void> {
    assertPathWithinRepository(path)
    const next = new Map(this.#files); next.set(formatGardenPath(path), new TextEncoder().encode(contents))
    const dirty = !formatGardenPath(path).startsWith('.research-garden/index.json')
    const snapshot = { repositoryName: this.repositoryName, files: Object.fromEntries(next), hasUnexportedChanges: this.#dirty || dirty }
    await this.#store.save(snapshot); this.#files = next; this.#dirty = snapshot.hasUnexportedChanges
  }
  async delete(path: GardenPath): Promise<void> {
    assertPathWithinRepository(path)
    const next = new Map(this.#files); next.delete(formatGardenPath(path))
    const snapshot = { repositoryName: this.repositoryName, files: Object.fromEntries(next), hasUnexportedChanges: true }
    await this.#store.save(snapshot); this.#files = next; this.#dirty = true
  }
}
