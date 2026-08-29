import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { contentHash } from '../domain/hash'
import type { UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { editItem } from './editItem'
import { readUndoSnapshot } from './undoSnapshot'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
const CLAIM = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'

const NOW = '2026-08-27T12:00:00Z'
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
# a hand-authored comment
state: active
my_own_field: kept
created_at: ${CREATED}
updated_at: ${CREATED}
---

Original body text.
`

const rootFile = `---
schema_version: 1
id: ${ROOT}
kind: root
title: A captured paper
captured_at: 2026-08-01T09:00:00Z
content_hash: sha256:original
created_at: ${CREATED}
updated_at: ${CREATED}
---

The exact excerpt that was captured.
`

const healthyClaimFile = `---
schema_version: 1
id: ${CLAIM}
kind: claim_leaf
title: A well-supported Claim
parent_id: ${BRANCH}
supported_by:
  - ${ROOT}
created_at: ${CREATED}
updated_at: ${CREATED}
---

The claim, as first written.
`

const brokenClaimFile = `---
schema_version: 1
id: ${CLAIM}
kind: claim_leaf
title: A Claim pointing nowhere
parent_id: ${BRANCH}
supported_by:
  - ${ROOT}
relations:
  - type: contradicts
    target: claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0ZZW
created_at: ${CREATED}
updated_at: ${CREATED}
---

A broken claim.
`

function gardenWith(files: Record<string, string>) {
  return new InMemoryGardenFileSystem(files, 'my-garden')
}

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
}

const options = { now: () => NOW, entropy: countingEntropy() }

describe('editing an item with no Diagnostics', () => {
  // The body a person sees and edits in Edit mode is the item's body verbatim
  // (ADR 0041), which is everything after the frontmatter close including the
  // blank line that conventionally separates it -- so an edit that keeps that
  // convention passes it straight through rather than reconstructing it.
  async function editAttention(newBody = '\nEdited body text.\n') {
    const fileSystem = gardenWith({ 'branches/attention.md': branchFile })
    const index = await indexFor({ 'branches/attention.md': branchFile })
    const result = await editItem(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody },
      options,
    )
    return { fileSystem, result }
  }

  it('reports saved', async () => {
    const { result } = await editAttention()

    expect(result.kind).toBe('saved')
  })

  it('touches at most one canonical Markdown file', async () => {
    const { fileSystem } = await editAttention()

    const canonicalPaths = Object.keys(fileSystem.snapshot()).filter((path) => path.startsWith('branches/'))
    expect(canonicalPaths).toEqual(['branches/attention.md'])
  })

  it('changes the body', async () => {
    const { fileSystem } = await editAttention()

    expect(fileSystem.snapshot()['branches/attention.md']).toContain('Edited body text.\n')
  })

  it('moves updated_at', async () => {
    const { fileSystem } = await editAttention()

    expect(fileSystem.snapshot()['branches/attention.md']).toContain(`updated_at: ${NOW}`)
  })

  it('never moves created_at', async () => {
    const { fileSystem } = await editAttention()

    expect(fileSystem.snapshot()['branches/attention.md']).toContain(`created_at: ${CREATED}`)
  })

  it('preserves unknown frontmatter fields', async () => {
    const { fileSystem } = await editAttention()

    expect(fileSystem.snapshot()['branches/attention.md']).toContain('my_own_field: kept')
  })

  it('preserves comments', async () => {
    const { fileSystem } = await editAttention()

    expect(fileSystem.snapshot()['branches/attention.md']).toContain('# a hand-authored comment')
  })

  // ADR 0078: changing one known field must not fully normalize the rest.
  it('changes only the body and updated_at lines, nothing else', async () => {
    const { fileSystem } = await editAttention()

    const before = branchFile.split('\n')
    const after = fileSystem.snapshot()['branches/attention.md']?.split('\n') ?? []
    const changedLines = before
      .map((line, at) => (line === after[at] ? null : at))
      .filter((at): at is number => at !== null)

    for (const at of changedLines) {
      expect(before[at]).toMatch(/updated_at:|Original body text\./)
    }
  })

  it('saves an Undo Snapshot of the previous content before writing', async () => {
    const { fileSystem, result } = await editAttention()
    if (result.kind !== 'saved') throw new Error('expected saved')
    if (!result.snapshotId) throw new Error('expected a real edit to produce a snapshot')

    const snapshot = await readUndoSnapshot(fileSystem, result.snapshotId)
    expect(snapshot?.previousText).toBe(branchFile)
  })

  it('records the same instant on the Undo Snapshot as it wrote to updated_at', async () => {
    // A fixed clock (`options.now`, used everywhere else in this file) cannot
    // tell `appliedAt` and `updated_at` apart if they were computed by two
    // separate `now()` calls: both calls return the same fixed string either
    // way. A clock that ticks on every call is the only way to prove the two
    // are read from one shared instant, not two.
    let calls = 0
    const tickingNow = () => {
      calls += 1
      return calls === 1 ? NOW : '2099-01-01T00:00:00Z'
    }
    const fileSystem = gardenWith({ 'branches/attention.md': branchFile })
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const result = await editItem(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: '\nEdited body text.\n' },
      { now: tickingNow, entropy: countingEntropy() },
    )
    if (result.kind !== 'saved') throw new Error('expected saved')
    if (!result.snapshotId) throw new Error('expected a real edit to produce a snapshot')

    expect(fileSystem.snapshot()['branches/attention.md']).toContain(`updated_at: ${NOW}`)
    const snapshot = await readUndoSnapshot(fileSystem, result.snapshotId)
    expect(snapshot?.appliedAt).toBe(NOW)
    expect(calls).toBe(1)
  })

  it('records the resulting hash on the Undo Snapshot', async () => {
    const { fileSystem, result } = await editAttention()
    if (result.kind !== 'saved') throw new Error('expected saved')
    if (!result.snapshotId) throw new Error('expected a real edit to produce a snapshot')

    const written = fileSystem.snapshot()['branches/attention.md']
    if (!written) throw new Error('expected the file to have been written')

    const snapshot = await readUndoSnapshot(fileSystem, result.snapshotId)
    expect(snapshot?.resultingHash).toBe(await contentHash(written))
  })

  it('reports the resulting hash matching what reread from disk', async () => {
    const { fileSystem, result } = await editAttention()
    if (result.kind !== 'saved') throw new Error('expected saved')

    const written = fileSystem.snapshot()['branches/attention.md']
    if (!written) throw new Error('expected the file to have been written')
    expect(result.resultingHash).toBe(await contentHash(written))
  })
})

describe('editing an item carrying a Garden Diagnostic', () => {
  it('is blocked, and nothing is written', async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': brokenClaimFile,
    })
    const index = await indexFor({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': brokenClaimFile,
    })

    const result = await editItem(
      fileSystem,
      index,
      { itemId: CLAIM, baseText: brokenClaimFile, newBody: 'Rewritten.\n' },
      options,
    )

    expect(result.kind).toBe('blocked')
    expect(fileSystem.snapshot()['leaves/claim.md']).toBe(brokenClaimFile)
  })

  it('explains why, so the interface never silently does nothing', async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': brokenClaimFile,
    })
    const index = await indexFor({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': brokenClaimFile,
    })

    const result = await editItem(
      fileSystem,
      index,
      { itemId: CLAIM, baseText: brokenClaimFile, newBody: 'Rewritten.\n' },
      options,
    )

    if (result.kind !== 'blocked') throw new Error('expected blocked')
    expect(result.reason).toMatch(/Diagnostic/i)
  })
})

// ADR 0012 / ADR 0020 / ticket 03: a Root's body is its captured evidence.
describe("editing a Root's body", () => {
  async function attemptRootEdit(newBody: string) {
    const fileSystem = gardenWith({ 'roots/paper.md': rootFile })
    const index = await indexFor({ 'roots/paper.md': rootFile })
    const result = await editItem(
      fileSystem,
      index,
      { itemId: ROOT, baseText: rootFile, newBody },
      options,
    )
    return { fileSystem, result }
  }

  it('is refused rather than saved', async () => {
    const { result } = await attemptRootEdit('A rewritten excerpt.\n')

    expect(result.kind).toBe('evidence-refused')
  })

  it('writes nothing to disk', async () => {
    const { fileSystem } = await attemptRootEdit('A rewritten excerpt.\n')

    expect(fileSystem.snapshot()['roots/paper.md']).toBe(rootFile)
  })

  it('names the body as the field that would have been rewritten', async () => {
    const { result } = await attemptRootEdit('A rewritten excerpt.\n')

    if (result.kind !== 'evidence-refused') throw new Error('expected evidence-refused')
    expect(result.changes.map((change) => change.field)).toContain('body')
  })

  it('permits an edit that leaves the body identical, changing only metadata timing', async () => {
    // Reproducing the exact same body is not "rewriting evidence" -- it is
    // the no-op case a metadata-only correction would produce.
    const index = await indexFor({ 'roots/paper.md': rootFile })
    const identicalBody = index.items.get(ROOT)!.item.body

    const { result } = await attemptRootEdit(identicalBody)

    expect(result.kind).toBe('saved')
  })
})

// Inherited ticket 04 criterion (ADR 0020): Supports is serialized on the
// Claim, not the Root, so editing a Claim's own body must never touch the
// Root file it cites. This is the first write path that can make that
// structural claim falsifiable, and this is where it is falsified.
describe("editing a Claim Leaf that cites a Root", () => {
  it("never touches the Root's file at all", async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': healthyClaimFile,
    })
    const index = await indexFor({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': healthyClaimFile,
    })

    await editItem(
      fileSystem,
      index,
      { itemId: CLAIM, baseText: healthyClaimFile, newBody: '\nThe claim, revised.\n' },
      options,
    )

    expect(fileSystem.snapshot()['roots/paper.md']).toBe(rootFile)
  })

  it("leaves the Claim's supported_by relationship exactly as it was", async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': healthyClaimFile,
    })
    const index = await indexFor({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': healthyClaimFile,
    })

    await editItem(
      fileSystem,
      index,
      { itemId: CLAIM, baseText: healthyClaimFile, newBody: '\nThe claim, revised.\n' },
      options,
    )

    expect(fileSystem.snapshot()['leaves/claim.md']).toContain(`supported_by:\n  - ${ROOT}`)
  })

  it('still changes only the Claim body, leaving its own frontmatter otherwise untouched', async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': healthyClaimFile,
    })
    const index = await indexFor({
      'branches/attention.md': branchFile,
      'roots/paper.md': rootFile,
      'leaves/claim.md': healthyClaimFile,
    })

    await editItem(
      fileSystem,
      index,
      { itemId: CLAIM, baseText: healthyClaimFile, newBody: '\nThe claim, revised.\n' },
      options,
    )

    const written = fileSystem.snapshot()['leaves/claim.md'] ?? ''
    expect(written).toContain('The claim, revised.')
    expect(written).toContain(`parent_id: ${BRANCH}`)
    expect(written).toContain(`created_at: ${CREATED}`)
  })
})

describe('editing an item that changed on disk since editing began', () => {
  it('is refused as stale rather than overwriting the newer content', async () => {
    const changedOnDisk = branchFile.replace('Original body text.', 'Someone else already changed this.')
    const fileSystem = gardenWith({ 'branches/attention.md': changedOnDisk })
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const result = await editItem(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'My edit.\n' },
      options,
    )

    expect(result.kind).toBe('stale')
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(changedOnDisk)
  })
})

describe('editing an item without permission', () => {
  it('reports permission-required and writes nothing', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': branchFile })
    fileSystem.revokePermission()
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const result = await editItem(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'Edited.\n' },
      options,
    )

    expect(result.kind).toBe('permission-required')
  })
})

describe('an id that names nothing in this Garden', () => {
  it('is blocked, not silently ignored', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': branchFile })
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const result = await editItem(
      fileSystem,
      index,
      { itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0XXW', baseText: '', newBody: 'Edited.\n' },
      options,
    )

    expect(result.kind).toBe('blocked')
  })
})

// Inherited ticket 03 criterion: updated_at moves only when the item is
// actually edited (ADR 0077). Submitting Edit mode without changing anything
// must not count as an edit.
describe('saving a body identical to what is already on disk', () => {
  async function saveUnchanged() {
    const fileSystem = gardenWith({ 'branches/attention.md': branchFile })
    const index = await indexFor({ 'branches/attention.md': branchFile })
    const unchangedBody = index.items.get(BRANCH)!.item.body

    const result = await editItem(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: unchangedBody },
      options,
    )
    return { fileSystem, result }
  }

  it('reports saved', async () => {
    const { result } = await saveUnchanged()

    expect(result.kind).toBe('saved')
  })

  it('writes nothing at all -- the file is byte-for-byte the same', async () => {
    const { fileSystem } = await saveUnchanged()

    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })

  it('does not move updated_at', async () => {
    const { fileSystem } = await saveUnchanged()

    expect(fileSystem.snapshot()['branches/attention.md']).toContain(`updated_at: ${CREATED}`)
  })

  it('produces no Undo Snapshot, because there is nothing to undo', async () => {
    const { fileSystem } = await saveUnchanged()

    const operationalPaths = Object.keys(fileSystem.snapshot()).filter((path) =>
      path.startsWith('.research-garden/'),
    )
    expect(operationalPaths).toEqual([])
  })

  it('reports no snapshotId, so the interface offers no Undo for a no-op', async () => {
    const { result } = await saveUnchanged()
    if (result.kind !== 'saved') throw new Error('expected saved')

    expect(result.snapshotId).toBeUndefined()
  })

  it('reports the previous and resulting hash as the same value', async () => {
    const { result } = await saveUnchanged()
    if (result.kind !== 'saved') throw new Error('expected saved')

    expect(result.resultingHash).toBe(result.previousHash)
  })
})

// ticket 12 review: Garden Activity never carries raw file content (ADR 0067),
// so an unexpected failure must not surface the underlying error's own text.
describe('an unexpected filesystem failure while saving', () => {
  it('reports a fixed, generic message rather than the underlying error text', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    class ThrowingFileSystem extends InMemoryGardenFileSystem {
      override async read(): Promise<string> {
        throw new Error('a person\'s private research notes leaked into this message')
      }
    }
    const throwing = new ThrowingFileSystem({ 'branches/attention.md': branchFile }, 'my-garden')

    const result = await editItem(
      throwing,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'Edited.\n' },
      options,
    )

    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.message).not.toContain('private research notes')
    }
  })
})
