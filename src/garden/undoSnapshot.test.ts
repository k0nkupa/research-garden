import { describe, expect, it } from 'vitest'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { readUndoSnapshot, undoSnapshotPath, writeUndoSnapshot } from './undoSnapshot'

const RECORD = {
  id: '01HQ8X2K3M4N5P6Q7R8S9T0S1W',
  itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
  path: ['branches', 'attention.md'],
  previousText: 'old content\n',
  previousHash: 'sha256:before',
  resultingHash: 'sha256:after',
  appliedAt: '2026-08-01T10:00:00Z',
}

describe('the operational location of an Undo Snapshot', () => {
  it('resolves under the operational directory, never a canonical one', () => {
    expect(undoSnapshotPath(RECORD.id)).toEqual(['.research-garden', 'undo', `${RECORD.id}.json`])
  })
})

describe('writing and reading a snapshot back', () => {
  it('round-trips every field', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await writeUndoSnapshot(fileSystem, RECORD)

    await expect(readUndoSnapshot(fileSystem, RECORD.id)).resolves.toEqual(RECORD)
  })

  it('writes only under the operational directory, not among canonical files', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await writeUndoSnapshot(fileSystem, RECORD)

    const [path] = Object.keys(fileSystem.snapshot())
    expect(path).toBe('.research-garden/undo/01HQ8X2K3M4N5P6Q7R8S9T0S1W.json')
  })
})

describe('reading a snapshot that was never written', () => {
  it('reports undefined rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await expect(readUndoSnapshot(fileSystem, 'never-written')).resolves.toBeUndefined()
  })
})

// Nothing else in this codebase trusts a value off disk without validating
// its shape first; a snapshot record is no exception (ticket 12 review).
describe('reading a record that is not a valid Undo Snapshot', () => {
  it('reports undefined for JSON that does not parse, rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { '.research-garden/undo/broken.json': 'not valid json {' },
      'my-garden',
    )

    await expect(readUndoSnapshot(fileSystem, 'broken')).resolves.toBeUndefined()
  })

  it('never lets a JSON parse failure surface previousText -- the file content it protects', async () => {
    // The malformed JSON below embeds what would be a person's file content,
    // to prove a parse error is never let anywhere near a caller (ADR 0067).
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/undo/broken.json':
          '{"previousText": "The person\'s private research notes.", "unterminated"',
      },
      'my-garden',
    )

    await expect(readUndoSnapshot(fileSystem, 'broken')).resolves.toBeUndefined()
  })

  it('reports undefined for well-formed JSON missing a required field', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/undo/incomplete.json': JSON.stringify({
          id: 'incomplete',
          itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
          path: ['branches', 'a.md'],
          // previousText, previousHash, resultingHash, appliedAt all missing.
        }),
      },
      'my-garden',
    )

    await expect(readUndoSnapshot(fileSystem, 'incomplete')).resolves.toBeUndefined()
  })

  it('reports undefined when path is not a nonempty array of strings', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      {
        '.research-garden/undo/bad-path.json': JSON.stringify({ ...RECORD, id: 'bad-path', path: [] }),
      },
      'my-garden',
    )

    await expect(readUndoSnapshot(fileSystem, 'bad-path')).resolves.toBeUndefined()
  })

  it('reports undefined when the JSON is a valid but unrelated shape', async () => {
    const fileSystem = new InMemoryGardenFileSystem(
      { '.research-garden/undo/wrong-shape.json': JSON.stringify([1, 2, 3]) },
      'my-garden',
    )

    await expect(readUndoSnapshot(fileSystem, 'wrong-shape')).resolves.toBeUndefined()
  })
})
