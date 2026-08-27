import { describe, expect, it } from 'vitest'
import type { DirectoryHandleLike } from './FileSystemAccessGardenFileSystem'
import {
  InMemoryRememberedGardenStore,
  type RememberedGardenStore,
} from './rememberedGarden'

/**
 * The behaviour every remembered-Garden store must share.
 *
 * Run here against the in-memory adapter. The IndexedDB adapter cannot be run
 * under this suite: it stores a live `FileSystemDirectoryHandle`, which only a
 * real browser can produce and structured-clone, and a fake carrying methods is
 * not cloneable at all. Its real behaviour belongs to the manual acceptance run
 * ADR 0064 requires.
 */
export function describeRememberedGardenStore(
  name: string,
  create: () => RememberedGardenStore,
) {
  const handle = { kind: 'directory', name: 'my-garden' } as unknown as DirectoryHandleLike

  describe(`${name} satisfies the remembered-Garden contract`, () => {
    it('recalls nothing before anything is remembered', async () => {
      await expect(create().recall()).resolves.toBeUndefined()
    })

    it('recalls what it was asked to remember', async () => {
      const store = create()
      await store.remember({ handle, name: 'my-garden' })

      await expect(store.recall()).resolves.toMatchObject({ name: 'my-garden' })
    })

    it('recalls the handle itself, which is the point of remembering', async () => {
      const store = create()
      await store.remember({ handle, name: 'my-garden' })

      expect((await store.recall())?.handle).toBe(handle)
    })

    // ADR 0060: the handle and the display name, and nothing else.
    it('keeps only the handle and the name', async () => {
      const store = create()
      await store.remember({ handle, name: 'my-garden' })

      expect(Object.keys((await store.recall()) as object).sort()).toEqual(['handle', 'name'])
    })

    it('remembers one Garden, replacing any earlier one', async () => {
      const store = create()
      await store.remember({ handle, name: 'first' })
      await store.remember({ handle, name: 'second' })

      expect((await store.recall())?.name).toBe('second')
    })

    it('forgets when asked', async () => {
      const store = create()
      await store.remember({ handle, name: 'my-garden' })
      await store.forget()

      await expect(store.recall()).resolves.toBeUndefined()
    })

    it('forgets nothing without complaint', async () => {
      await expect(create().forget()).resolves.toBeUndefined()
    })

    // Permission is the browser's to grant, and is never remembered.
    it('stores nothing resembling a permission decision', async () => {
      const store = create()
      await store.remember({ handle, name: 'my-garden' })

      expect(JSON.stringify(Object.keys((await store.recall()) as object))).not.toMatch(
        /permission|granted/i,
      )
    })
  })
}

describeRememberedGardenStore('InMemoryRememberedGardenStore', () => new InMemoryRememberedGardenStore())
