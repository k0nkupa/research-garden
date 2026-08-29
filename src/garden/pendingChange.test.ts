import { describe, expect, it } from 'vitest'
import { contentHash } from '../domain/hash'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import {
  deletePendingChange,
  isPendingChangeStale,
  listPendingChanges,
  pendingChangePath,
  readPendingChange,
  writePendingChange,
} from './pendingChange'

const RECORD = {
  id: '01HQ8X2K3M4N5P6Q7R8S9T0P1W',
  itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
  path: ['branches', 'attention.md'],
  baseText: '---\nid: x\n---\n\nOriginal body.\n',
  baseHash: 'sha256:before',
  previewText: '---\nid: x\n---\n\nProposed body.\n',
  previewHash: 'sha256:after',
  proposedAt: '2026-08-01T10:00:00Z',
}

describe('the operational location of a Pending Change', () => {
  it('resolves under the operational directory, never a canonical one', () => {
    expect(pendingChangePath(RECORD.id)).toEqual(['.research-garden', 'pending', `${RECORD.id}.json`])
  })
})

describe('writing and reading a change back', () => {
  it('round-trips every field', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await writePendingChange(fileSystem, RECORD)

    await expect(readPendingChange(fileSystem, RECORD.id)).resolves.toEqual(RECORD)
  })

  it('writes only under the operational directory, not among canonical files', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await writePendingChange(fileSystem, RECORD)

    const [path] = Object.keys(fileSystem.snapshot())
    expect(path).toBe('.research-garden/pending/01HQ8X2K3M4N5P6Q7R8S9T0P1W.json')
  })
})

describe('reading a change that was never written', () => {
  it('reports undefined rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await expect(readPendingChange(fileSystem, 'never-written')).resolves.toBeUndefined()
  })
})

describe('rejecting deletes the operational record and nothing else', () => {
  it('removes the change so it can no longer be read', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    await writePendingChange(fileSystem, RECORD)

    await deletePendingChange(fileSystem, RECORD.id)

    await expect(readPendingChange(fileSystem, RECORD.id)).resolves.toBeUndefined()
  })

  it('touches no canonical file', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { 'branches/attention.md': 'unrelated canonical content\n' },
      'my-garden',
    )
    await writePendingChange(fileSystem, RECORD)

    await deletePendingChange(fileSystem, RECORD.id)

    expect(fileSystem.snapshot()['branches/attention.md']).toBe('unrelated canonical content\n')
  })
})

// Nothing else in this codebase trusts a value off disk without validating
// its shape first; a Pending Change record is no exception (ticket 12 review,
// `undoSnapshot.test.ts`'s equivalent suite).
describe('reading a record that is not a valid Pending Change', () => {
  it('reports undefined for JSON that does not parse, rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { '.research-garden/pending/broken.json': 'not valid json {' },
      'my-garden',
    )

    await expect(readPendingChange(fileSystem, 'broken')).resolves.toBeUndefined()
  })

  it('never lets a JSON parse failure surface previewText -- the proposed content it protects', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/pending/broken.json':
          '{"previewText": "The person\'s private research notes.", "unterminated"',
      },
      'my-garden',
    )

    await expect(readPendingChange(fileSystem, 'broken')).resolves.toBeUndefined()
  })

  it('reports undefined for well-formed JSON missing a required field', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/pending/incomplete.json': JSON.stringify({
          id: 'incomplete',
          itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
          path: ['branches', 'a.md'],
          // baseHash, previewText, previewHash, proposedAt all missing.
        }),
      },
      'my-garden',
    )

    await expect(readPendingChange(fileSystem, 'incomplete')).resolves.toBeUndefined()
  })

  it('reports undefined when path is not a nonempty array of strings', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/pending/bad-path.json': JSON.stringify({ ...RECORD, id: 'bad-path', path: [] }),
      },
      'my-garden',
    )

    await expect(readPendingChange(fileSystem, 'bad-path')).resolves.toBeUndefined()
  })

  it('reports undefined when the JSON is a valid but unrelated shape', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { '.research-garden/pending/wrong-shape.json': JSON.stringify([1, 2, 3]) },
      'my-garden',
    )

    await expect(readPendingChange(fileSystem, 'wrong-shape')).resolves.toBeUndefined()
  })
})

describe('listing every currently proposed change', () => {
  it('lists nothing when none have been proposed', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await expect(listPendingChanges(fileSystem)).resolves.toEqual([])
  })

  it('lists every written change, oldest first', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    const earlier = { ...RECORD, id: 'earlier', proposedAt: '2026-08-01T09:00:00Z' }
    const later = { ...RECORD, id: 'later', proposedAt: '2026-08-01T11:00:00Z' }

    await writePendingChange(fileSystem, later)
    await writePendingChange(fileSystem, earlier)

    const listed = await listPendingChanges(fileSystem)
    expect(listed.map((record) => record.id)).toEqual(['earlier', 'later'])
  })

  it('skips a record that fails to parse rather than surfacing it broken', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/pending/broken.json': 'not valid json {',
      },
      'my-garden',
    )
    await writePendingChange(fileSystem, RECORD)

    const listed = await listPendingChanges(fileSystem)
    expect(listed.map((record) => record.id)).toEqual([RECORD.id])
  })

  it('never lists a Pending Change alongside canonical files it lives beside', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { 'branches/attention.md': 'canonical content\n' },
      'my-garden',
    )
    await writePendingChange(fileSystem, RECORD)

    // The operational listing must never reach into canonical directories.
    const canonicalListing = await fileSystem.listFiles(['branches'])
    expect(canonicalListing.map((path) => path.join('/'))).toEqual(['branches/attention.md'])
  })
})

describe('whether a change is Stale', () => {
  it('is not stale while the target still matches what it was proposed against', async () => {
    const targetText = 'the original content\n'
    const record = { ...RECORD, baseHash: await contentHash(targetText) }
    const fileSystem = new InMemoryGardenFileSystem(
      { 'branches/attention.md': targetText },
      'my-garden',
    )

    await expect(isPendingChangeStale(fileSystem, record)).resolves.toBe(false)
  })

  it('is stale once the target has changed', async () => {
    const record = { ...RECORD, baseHash: await contentHash('the original content\n') }
    const fileSystem = new InMemoryGardenFileSystem(
      { 'branches/attention.md': 'someone changed this\n' },
      'my-garden',
    )

    await expect(isPendingChangeStale(fileSystem, record)).resolves.toBe(true)
  })

  it('is stale when the target has been deleted entirely', async () => {
    const record = { ...RECORD, baseHash: await contentHash('the original content\n') }
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await expect(isPendingChangeStale(fileSystem, record)).resolves.toBe(true)
  })
})
