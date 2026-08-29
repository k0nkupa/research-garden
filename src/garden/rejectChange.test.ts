import { describe, expect, it } from 'vitest'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { readPendingChange, writePendingChange } from './pendingChange'
import { rejectChange } from './rejectChange'

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

describe('rejecting a Pending Change', () => {
  it('removes it so it can no longer be read', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    await writePendingChange(fileSystem, RECORD)

    const result = await rejectChange(fileSystem, RECORD.id)

    expect(result).toEqual({ kind: 'rejected', itemId: RECORD.itemId })
    await expect(readPendingChange(fileSystem, RECORD.id)).resolves.toBeUndefined()
  })

  it('touches no canonical file', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { 'branches/attention.md': 'unrelated canonical content\n' },
      'my-garden',
    )
    await writePendingChange(fileSystem, RECORD)

    await rejectChange(fileSystem, RECORD.id)

    expect(fileSystem.snapshot()['branches/attention.md']).toBe('unrelated canonical content\n')
  })

  it('is a first-class, explicit outcome, distinct from the change simply vanishing', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    await writePendingChange(fileSystem, RECORD)

    const result = await rejectChange(fileSystem, RECORD.id)

    expect(result.kind).toBe('rejected')
  })
})

describe('rejecting a change that does not exist', () => {
  it('reports not-found rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    const result = await rejectChange(fileSystem, 'never-proposed')

    expect(result.kind).toBe('not-found')
  })
})

describe('rejecting while permission has lapsed', () => {
  it('reports permission-required rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    await writePendingChange(fileSystem, RECORD)
    fileSystem.revokePermission()

    const result = await rejectChange(fileSystem, RECORD.id)

    expect(result.kind).toBe('permission-required')
  })
})
