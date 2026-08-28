import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import type { UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { editItem } from './editItem'
import { readUndoSnapshot } from './undoSnapshot'
import { undoChange } from './undoChange'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const CREATED = '2026-08-01T10:00:00Z'

function countingEntropy(startAt = 1_700_000_000_000): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => startAt + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

const branchFile = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention mechanisms
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

Original body text.
`

async function editedGarden(newBody = '\nEdited body text.\n') {
  const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branchFile }, 'my-garden')
  const index = await buildGardenIndex([{ path: ['branches', 'attention.md'], text: branchFile }])

  const saved = await editItem(
    fileSystem,
    index,
    { itemId: BRANCH, baseText: branchFile, newBody },
    { now: () => '2026-08-27T12:00:00Z', entropy: countingEntropy() },
  )
  if (saved.kind !== 'saved') throw new Error(`expected the edit to save, got ${saved.kind}`)
  if (!saved.snapshotId) throw new Error('expected a real edit to produce a snapshot')

  return { fileSystem, snapshotId: saved.snapshotId }
}

describe('undoing an applied edit', () => {
  it('restores the exact previous content', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    expect(result.kind).toBe('restored')
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })

  it('leaves the Undo Snapshot record intact, so the edit and its Undo stay auditable', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    const snapshot = await readUndoSnapshot(fileSystem, snapshotId)
    expect(snapshot).toBeDefined()
    expect(snapshot?.previousText).toBe(branchFile)
  })

  it('touches at most the one canonical file the edit touched', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    const canonicalPaths = Object.keys(fileSystem.snapshot()).filter((path) => path.startsWith('branches/'))
    expect(canonicalPaths).toEqual(['branches/attention.md'])
  })
})

// ADR 0055 / ADR 0021: every canonical write -- including Undo's own -- is
// preceded by an Undo Snapshot of what it is about to overwrite.
describe("Undo snapshotting what it overwrites", () => {
  it('records a new Undo Snapshot of the edited content before restoring', async () => {
    const { fileSystem, snapshotId } = await editedGarden()
    const editedText = fileSystem.snapshot()['branches/attention.md']
    if (!editedText) throw new Error('expected the edited file to exist')

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId }, {
      now: () => '2026-08-27T13:00:00Z',
      entropy: countingEntropy(1_800_000_000_000),
    })

    if (result.kind !== 'restored') throw new Error(`expected restored, got ${result.kind}`)
    const newSnapshot = await readUndoSnapshot(fileSystem, result.snapshotId)
    expect(newSnapshot?.previousText).toBe(editedText)
  })

  it("the new snapshot's own resultingHash matches the restored content, so it could itself be undone", async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId }, {
      now: () => '2026-08-27T13:00:00Z',
      entropy: countingEntropy(1_800_000_000_000),
    })

    if (result.kind !== 'restored') throw new Error(`expected restored, got ${result.kind}`)
    const newSnapshot = await readUndoSnapshot(fileSystem, result.snapshotId)
    expect(newSnapshot?.resultingHash).toBe(result.restoredHash)
  })

  it('returns a snapshot id distinct from the one Undo restored from', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    if (result.kind !== 'restored') throw new Error(`expected restored, got ${result.kind}`)
    expect(result.snapshotId).not.toBe(snapshotId)
  })
})

describe('undoing twice in a row', () => {
  it('refuses the second Undo, because the file no longer matches the applied change', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    const first = await undoChange(fileSystem, { itemId: BRANCH, snapshotId })
    expect(first.kind).toBe('restored')

    const second = await undoChange(fileSystem, { itemId: BRANCH, snapshotId })
    expect(second.kind).toBe('stale')
  })

  it('does not change the file on the refused second attempt', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    await undoChange(fileSystem, { itemId: BRANCH, snapshotId })
    const restoredText = fileSystem.snapshot()['branches/attention.md']

    await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    expect(fileSystem.snapshot()['branches/attention.md']).toBe(restoredText)
  })
})

describe('undoing after the file changed again since the edit', () => {
  it('is refused rather than discarding the newer content', async () => {
    const { fileSystem, snapshotId } = await editedGarden()
    // Something else touched the file after the edit -- another edit, or a
    // hand edit outside Research Garden.
    await fileSystem.write(['branches', 'attention.md'], 'not what the edit produced\n')

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    expect(result.kind).toBe('stale')
    expect(fileSystem.snapshot()['branches/attention.md']).toBe('not what the edit produced\n')
  })
})

describe('undoing with an unknown snapshot id', () => {
  it('reports not-found', async () => {
    const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branchFile }, 'my-garden')

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId: 'never-existed' })

    expect(result.kind).toBe('not-found')
  })
})

describe('undoing with a snapshot that belongs to a different item', () => {
  it('reports not-found rather than restoring the wrong file', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    const result = await undoChange(fileSystem, {
      itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0YYW',
      snapshotId,
    })

    expect(result.kind).toBe('not-found')
  })
})

describe('undoing without permission', () => {
  it('reports permission-required and writes nothing', async () => {
    const { fileSystem, snapshotId } = await editedGarden()
    fileSystem.revokePermission()

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId })

    expect(result.kind).toBe('permission-required')
  })
})

// ADR 0058: canonical writes resolve only to the typed Garden directories.
// A snapshot's path is always taken from the Garden Index when `editItem`
// writes it, but it travels through this action as data read back off disk,
// so a snapshot naming somewhere outside those directories is refused rather
// than trusted.
describe('a snapshot naming a location outside the typed Garden directories', () => {
  it('is refused rather than written to', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    await fileSystem.write(
      ['.research-garden', 'undo', 'escaping.json'],
      JSON.stringify({
        id: 'escaping',
        itemId: BRANCH,
        // Not one of CANONICAL_DIRECTORIES -- the operational directory itself.
        path: ['.research-garden', 'pending', 'something.json'],
        previousText: 'whatever was there before\n',
        previousHash: 'sha256:before',
        resultingHash: 'sha256:after',
        appliedAt: CREATED,
      }),
    )

    const result = await undoChange(fileSystem, { itemId: BRANCH, snapshotId: 'escaping' })

    expect(result.kind).toBe('failed')
    expect(fileSystem.snapshot()['.research-garden/pending/something.json']).toBeUndefined()
  })
})

// ticket 12 review: Garden Activity never carries raw file content (ADR 0067).
describe('an unexpected failure while undoing', () => {
  it('reports a fixed, generic message rather than the underlying error text', async () => {
    const { fileSystem, snapshotId } = await editedGarden()

    class ThrowingFileSystem extends InMemoryGardenFileSystem {
      override async read(path: readonly string[]): Promise<string> {
        if (path.join('/').startsWith('branches/')) {
          throw new Error("a person's private research notes leaked into this message")
        }
        return super.read(path as never)
      }
    }
    const throwing = new ThrowingFileSystem(fileSystem.snapshot(), 'my-garden')

    const result = await undoChange(throwing, { itemId: BRANCH, snapshotId })

    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.message).not.toContain('private research notes')
    }
  })
})
