import { describe, expect, it } from 'vitest'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import type { GardenFileSystem, GardenPath } from '../filesystem/GardenFileSystem'
import { editItem } from './editItem'
import { indexCachePath, readIndexCache } from './indexCacheStore'
import { openGarden } from './openGarden'

/**
 * End-to-end proof that a real `openGarden` call -- not just the lower-level
 * `scanGardenWithCache` (see `gardenIndexCaching.test.ts`) -- actually reads
 * and persists the Index Cache (ticket 15, ADR 0062).
 */

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const CREATED = '2026-08-01T10:00:00Z'

const attentionFile = `---
schema_version: 1
id: ${ATTENTION}
kind: branch
title: Attention mechanisms
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

Original body text.
`

function gardenWith(files: Record<string, string>) {
  return new InMemoryGardenFileSystem(files, 'my-garden')
}

function expectOpened(result: Awaited<ReturnType<typeof openGarden>>) {
  if (result.kind !== 'opened') throw new Error(`expected opened, got ${result.kind}`)
  return result.garden
}

describe('the Index Cache is persisted under the operational location as derived, disposable state', () => {
  it('writes a cache after opening', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })

    await openGarden(fileSystem)

    const cache = await readIndexCache(fileSystem)
    expect(cache.entries.get('branches/attention.md')).toBeDefined()
  })

  it('opens correctly from Markdown alone when the cache has never existed, or is deleted', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })

    // Never existed:
    const first = expectOpened(await openGarden(fileSystem))
    expect(first.index.items.get(ATTENTION)?.item.title).toBe('Attention mechanisms')

    // Deleted:
    fileSystem.remove(indexCachePath())
    const second = expectOpened(await openGarden(fileSystem))
    expect(second.index.items.get(ATTENTION)?.item.title).toBe('Attention mechanisms')

    // And a fresh cache exists again afterward -- deleting it does not
    // permanently disable it.
    const cache = await readIndexCache(fileSystem)
    expect(cache.entries.size).toBeGreaterThan(0)
  })
})

describe('a warm open actually reuses the cache', () => {
  it('serves the cached entry rather than reparsing, when nothing on disk has changed', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    await openGarden(fileSystem)

    // Tamper directly with the persisted cache, as no Garden Action would --
    // this is only possible because the real file, unread, is what a warm
    // open would otherwise have to fall back on.
    const cache = await readIndexCache(fileSystem)
    const entry = cache.entries.get('branches/attention.md')
    if (!entry || entry.outcome.kind !== 'accepted') throw new Error('expected an accepted entry')
    const tampered = new Map(cache.entries)
    tampered.set('branches/attention.md', {
      ...entry,
      outcome: { kind: 'accepted', item: { ...entry.outcome.item, title: 'A title only the cache would say' } },
    })
    await fileSystem.write(
      indexCachePath(),
      JSON.stringify({ schema_version: cache.schemaVersion, entries: Object.fromEntries(tampered) }, null, 2),
    )

    const reopened = expectOpened(await openGarden(fileSystem))
    expect(reopened.index.items.get(ATTENTION)?.item.title).toBe('A title only the cache would say')
  })
})

describe('a cache entry corrupted in a way that would crash downstream code never blocks an open', () => {
  // Found in review: a cached item with a malformed relation element (not
  // simply a non-array, but an array containing something that is not a
  // well-formed relation) passed the shape guard, was served on a warm
  // open, and crashed when `buildGardenGraph` dereferenced `.type` on it --
  // turning `openGarden` into `kind: 'failed'`, with no recovery short of
  // deleting the cache file outside the app. It must instead be read as an
  // uncertain manifest (ADR 0062) and opened fresh from Markdown.
  it('opens correctly from Markdown when the cached relations contain a malformed element', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    await openGarden(fileSystem)

    const cache = await readIndexCache(fileSystem)
    const entry = cache.entries.get('branches/attention.md')
    if (!entry || entry.outcome.kind !== 'accepted') throw new Error('expected an accepted entry')
    const poisoned = new Map(cache.entries)
    poisoned.set('branches/attention.md', {
      ...entry,
      outcome: {
        kind: 'accepted',
        item: { ...entry.outcome.item, relations: [null] as unknown as [] },
      },
    })
    await fileSystem.write(
      indexCachePath(),
      JSON.stringify({ schema_version: cache.schemaVersion, entries: Object.fromEntries(poisoned) }, null, 2),
    )

    const reopened = await openGarden(fileSystem)

    expect(reopened.kind).toBe('opened')
    if (reopened.kind !== 'opened') return
    expect(reopened.garden.index.items.get(ATTENTION)?.item.title).toBe('Attention mechanisms')
    expect(reopened.garden.index.diagnostics).toEqual([])
  })
})

describe('the Garden Revision (ADR 0062: cache reuse never alters it)', () => {
  it('is identical on a cold open and the warm open right after it', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })

    const cold = expectOpened(await openGarden(fileSystem))
    const warm = expectOpened(await openGarden(fileSystem))

    expect(warm.index.revision).toBe(cold.index.revision)
  })
})

describe('a write invalidates or updates the affected cache entry', () => {
  it('reflects an edit at the next open, rather than serving the pre-edit cached content', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    const opened = expectOpened(await openGarden(fileSystem))

    const edited = await editItem(fileSystem, opened.index, {
      itemId: ATTENTION,
      baseText: attentionFile,
      newBody: 'Body after the edit.',
    })
    expect(edited.kind).toBe('saved')

    const reopened = expectOpened(await openGarden(fileSystem))
    expect(reopened.index.items.get(ATTENTION)?.item.body).toContain('Body after the edit.')
  })
})

describe('the cache never becomes a competing authority', () => {
  it('opens successfully even when the cache itself cannot be written', async () => {
    const real = gardenWith({ 'branches/attention.md': attentionFile })
    const cachePath = indexCachePath().join('/')

    const refusesOnlyTheCacheWrite: GardenFileSystem = {
      repositoryName: real.repositoryName,
      permission: () => real.permission(),
      requestPermission: () => real.requestPermission(),
      listFiles: (directory) => real.listFiles(directory),
      read: (path) => real.read(path),
      readBytes: (path) => real.readBytes(path),
      write: (path: GardenPath, contents: string) => {
        if (path.join('/') === cachePath) throw new Error('disk is full')
        return real.write(path, contents)
      },
      delete: (path) => real.delete(path),
    }

    const result = await openGarden(refusesOnlyTheCacheWrite)

    expect(result.kind).toBe('opened')
  })
})
