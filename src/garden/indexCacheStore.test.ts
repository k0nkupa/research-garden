import { describe, expect, it } from 'vitest'
import { emptyIndexCache, type CacheEntry } from '../domain/index/indexCache'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { indexCachePath, readIndexCache, writeIndexCache } from './indexCacheStore'

const ENTRY: CacheEntry = {
  length: 42,
  hash: 'sha256hex',
  outcome: {
    kind: 'accepted',
    item: {
      kind: 'branch',
      schemaVersion: 1,
      id: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
      title: 'Attention mechanisms',
      parentId: undefined,
      relations: [],
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
      body: 'What I am collecting.\n',
      state: 'active',
    },
  },
}

describe('the Index Cache location', () => {
  it('lives under the operational directory, not among canonical files', () => {
    expect(indexCachePath()).toEqual(['.research-garden', 'index.json'])
  })
})

describe('reading and writing the cache', () => {
  it('round-trips a written cache', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'test-garden')
    const record = { schemaVersion: 1 as const, entries: new Map([['branches/attention.md', ENTRY]]) }

    await writeIndexCache(fileSystem, record)
    const read = await readIndexCache(fileSystem)

    expect(read.entries.get('branches/attention.md')).toEqual(ENTRY)
  })

  it('reads an empty cache when no file has ever been written', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'test-garden')

    const read = await readIndexCache(fileSystem)

    expect(read).toEqual(emptyIndexCache())
  })

  it('reads an empty cache when the file on disk is corrupted', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { '.research-garden/index.json': 'not valid json {' },
      'test-garden',
    )

    const read = await readIndexCache(fileSystem)

    expect(read).toEqual(emptyIndexCache())
  })

  it('reads an empty cache when the schema version on disk does not match', () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/index.json': JSON.stringify({ schema_version: 999, entries: {} }),
      },
      'test-garden',
    )

    return expect(readIndexCache(fileSystem)).resolves.toEqual(emptyIndexCache())
  })

  it('never fails an open merely because the cache could not be written', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'test-garden')
    fileSystem.revokePermission()

    await expect(
      writeIndexCache(fileSystem, { schemaVersion: 1, entries: new Map() }),
    ).resolves.toBeUndefined()
  })

  // The write itself is a no-op when it fails: nothing should appear as if
  // it had succeeded.
  it('leaves nothing behind when the write fails', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'test-garden')
    fileSystem.revokePermission()
    await writeIndexCache(fileSystem, { schemaVersion: 1, entries: new Map() })
    fileSystem.grantPermission()

    const read = await readIndexCache(fileSystem)

    expect(read).toEqual(emptyIndexCache())
  })
})
