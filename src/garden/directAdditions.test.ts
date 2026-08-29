import { describe, expect, it } from 'vitest'
import { contentHash } from '../domain/hash'
import { parseGardenDocument } from '../domain/document/gardenDocument'
import type { UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { addLeaf, captureRoot, plantSeed } from './directAdditions'
import { readUndoSnapshot } from './undoSnapshot'
import { undoChange } from './undoChange'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
const NOW = '2026-08-29T01:00:00Z'

function entropy(): UlidEntropy {
  let tick = 0
  return {
    now: () => 1_700_000_000_000 + tick++,
    randomBytes: (into) => into.fill(1),
  }
}

const branchFile = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention
state: active
created_at: ${NOW}
updated_at: ${NOW}
---

The topic.
`

const rootFile = `---
schema_version: 1
id: ${ROOT}
kind: root
title: Paper
origin_url: https://example.com/paper
captured_at: ${NOW}
content_hash: sha256:old
created_at: ${NOW}
updated_at: ${NOW}
---

The source excerpt.
`

describe('direct Garden additions', () => {
  it('plants a Seed with the supplied title and body in one canonical file', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'garden')
    const result = await plantSeed(fileSystem, { title: 'A capture', body: 'Verbatim capture.' }, { now: () => NOW, entropy: entropy() })

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.item.kind).toBe('seed')
    expect(result.path).toEqual(['seeds', 'a-capture.md'])
    expect(fileSystem.snapshot()['seeds/a-capture.md']).toContain('Verbatim capture.')
    expect(Object.keys(fileSystem.snapshot()).filter((path) => path.startsWith('seeds/'))).toHaveLength(1)
    await expect(readUndoSnapshot(fileSystem, result.snapshotId)).resolves.toMatchObject({
      itemId: result.item.id,
      previousText: '',
      previousState: 'absent',
    })
  })

  it('restores the absence before a direct addition through the shared Undo action', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'garden')
    const planted = await plantSeed(fileSystem, { title: 'A capture', body: 'Verbatim capture.' }, { now: () => NOW, entropy: entropy() })
    if (planted.kind !== 'created') throw new Error('expected created')

    const undone = await undoChange(fileSystem, { itemId: planted.item.id, snapshotId: planted.snapshotId }, { now: () => NOW, entropy: entropy() })

    expect(undone.kind).toBe('restored')
    expect(fileSystem.snapshot()['seeds/a-capture.md']).toBeUndefined()
    // The original addition snapshot remains, and Undo creates a second
    // snapshot of the file it removed so the recovery event is itself tracked.
    expect(Object.keys(fileSystem.snapshot()).filter((path) => path.startsWith('.research-garden/undo/'))).toHaveLength(2)
  })

  it('captures Root evidence exactly as supplied, with metadata and hash, without fetching', async () => {
    const excerpt = 'Exact supplied evidence, including punctuation.'
    const fileSystem = new InMemoryGardenFileSystem({}, 'garden')

    const result = await captureRoot(fileSystem, {
      title: 'A source',
      originUrl: 'https://example.com/source',
      content: excerpt,
      attribution: 'A. Author',
    }, { now: () => NOW, entropy: entropy() })

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') throw new Error('expected created')
    const text = fileSystem.snapshot()[result.path.join('/')] as string
    const parsed = parseGardenDocument(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected parse')
    expect(parsed.document.frontmatter['origin_url']).toBe('https://example.com/source')
    expect(parsed.document.frontmatter['captured_at']).toBe(NOW)
    expect(parsed.document.frontmatter['content_hash']).toBe(await contentHash(excerpt))
    expect(parsed.document.frontmatter['attribution']).toBe('A. Author')
    expect(text).not.toContain('summary')
    expect(text).toContain(excerpt)
  })

  it('adds an unsourced Question Leaf under a Branch', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'garden')

    const result = await addLeaf(fileSystem, {
      title: 'What should we test?',
      body: 'An open question.',
      kind: 'question_leaf',
      parentId: BRANCH,
    }, { now: () => NOW, entropy: entropy() })

    expect(result.kind).toBe('created')
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.item.parentId).toBe(BRANCH)
    expect(result.path[0]).toBe('leaves')
  })

  it('refuses a Claim Leaf without a supporting Root before writing', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'garden')

    const result = await addLeaf(fileSystem, {
      title: 'Unsupported claim',
      body: 'This is not supported.',
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [],
    }, { now: () => NOW, entropy: entropy() })

    expect(result.kind).toBe('invalid')
    expect(Object.keys(fileSystem.snapshot())).toEqual(['branches/attention.md'])
  })

  it('refuses an addition whose referenced item carries a Diagnostic', async () => {
    const brokenBranch = branchFile.replace('state: active\n', '')
    const files = { 'branches/attention.md': brokenBranch }
    const fileSystem = new InMemoryGardenFileSystem(files, 'garden')

    const result = await addLeaf(fileSystem, {
      title: 'Question',
      body: 'Body.',
      kind: 'question_leaf',
      parentId: BRANCH,
    }, { now: () => NOW, entropy: entropy() })

    expect(result.kind).toBe('blocked')
    expect(Object.keys(fileSystem.snapshot())).toEqual(['branches/attention.md'])
  })

  it('allows a Claim Leaf supported by an existing Root and leaves the Root untouched', async () => {
    const files = { 'branches/attention.md': branchFile, 'roots/paper.md': rootFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'garden')

    const result = await addLeaf(fileSystem, {
      title: 'Supported claim',
      body: 'The evidence supports this.',
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
    }, { now: () => NOW, entropy: entropy() })

    expect(result.kind).toBe('created')
    expect(fileSystem.snapshot()['roots/paper.md']).toBe(rootFile)
  })
})
