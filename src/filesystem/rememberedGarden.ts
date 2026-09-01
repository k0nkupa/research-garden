import type { DirectoryHandleLike } from './FileSystemAccessGardenFileSystem'

/**
 * The one Garden Repository a browser remembers between visits.
 *
 * ADR 0060 draws this narrowly on purpose: the directory handle and the folder's
 * display name, and nothing else. Not a copy of the Markdown, not an index, not
 * a cached Tree. A person's knowledge lives in their folder, and the only thing
 * worth keeping in the browser is the ability to ask for that folder again.
 *
 * Permission is deliberately not remembered. The browser grants it, the browser
 * withdraws it, and Research Garden asks again whenever it has to.
 */
export interface RememberedGarden {
  readonly handle: DirectoryHandleLike
  readonly name: string
}

export interface RememberedGardenStore {
  remember(garden: RememberedGarden): Promise<void>
  recall(): Promise<RememberedGarden | undefined>
  forget(): Promise<void>
}

/** For tests, and for a browser that cannot store a handle at all. */
export class InMemoryRememberedGardenStore implements RememberedGardenStore {
  #remembered: RememberedGarden | undefined

  async remember(garden: RememberedGarden): Promise<void> {
    this.#remembered = garden
  }

  async recall(): Promise<RememberedGarden | undefined> {
    return this.#remembered
  }

  async forget(): Promise<void> {
    this.#remembered = undefined
  }
}

const DATABASE_NAME = 'research-garden'
const STORE_NAME = 'remembered-garden'
const ONLY_KEY = 'current'

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error)
  })
}

/**
 * The browser-local store.
 *
 * IndexedDB rather than localStorage because a directory handle is a live
 * object the browser structured-clones, not a string. Only one Garden is
 * remembered, under a fixed key, because more would be a list of a person's
 * research folders and ADR 0060 does not ask for one.
 */
export class IndexedDbRememberedGardenStore implements RememberedGardenStore {
  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open(DATABASE_NAME, 2)
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains(STORE_NAME)) opening.result.createObjectStore(STORE_NAME)
        if (!opening.result.objectStoreNames.contains('imported-garden')) opening.result.createObjectStore('imported-garden')
      }
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
  }

  async #withStore<T>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.#open()
    try {
      return await request(use(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME)))
    } finally {
      database.close()
    }
  }

  async remember(garden: RememberedGarden): Promise<void> {
    // Written field by field rather than by spreading the caller's object, so
    // nothing beyond the handle and the name can ever be persisted by accident.
    await this.#withStore('readwrite', (store) =>
      store.put({ handle: garden.handle, name: garden.name }, ONLY_KEY),
    )
  }

  async recall(): Promise<RememberedGarden | undefined> {
    const stored = await this.#withStore<unknown>('readonly', (store) => store.get(ONLY_KEY))
    if (typeof stored !== 'object' || stored === null) return undefined

    const { handle, name } = stored as Partial<RememberedGarden>
    if (handle === undefined || typeof name !== 'string') return undefined

    return { handle, name }
  }

  async forget(): Promise<void> {
    await this.#withStore('readwrite', (store) => store.delete(ONLY_KEY))
  }
}

/** The store this browser can actually use. */
export function browserRememberedGardenStore(): RememberedGardenStore {
  return typeof indexedDB === 'undefined'
    ? new InMemoryRememberedGardenStore()
    : new IndexedDbRememberedGardenStore()
}
