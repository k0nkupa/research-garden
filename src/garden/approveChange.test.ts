import { describe, expect, it, vi } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { contentHash } from '../domain/hash'
import type { UlidEntropy } from '../domain/schema/ulid'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { approveChange } from './approveChange'
import { pendingChangePath, readPendingChange, writePendingChange } from './pendingChange'
import { proposeChange } from './proposeChange'
import { readUndoSnapshot } from './undoSnapshot'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const HARVEST = 'harvest_01HQ8X2K3M4N5P6Q7R8S9T0H1W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'

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
state: active
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

const fullHarvestBody = [
  '## Question',
  'What does the evidence show?',
  '## Synthesis',
  'The original synthesis.',
  '## Evidence',
  'Cited from the Root.',
  '## Contradictions and uncertainty',
  'None noted.',
  '## Open questions',
  'None remain.',
].join('\n\n')

const harvestFile = `---
schema_version: 1
id: ${HARVEST}
kind: harvest
title: A Harvest
parent_id: ${BRANCH}
supported_by:
  - ${ROOT}
created_at: ${CREATED}
updated_at: ${CREATED}
---

${fullHarvestBody}
`

function gardenWith(files: Record<string, string>) {
  return new InMemoryGardenFileSystem(files, 'my-garden')
}

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
}

const options = { now: () => NOW, entropy: countingEntropy() }

/** Proposes a real change through `proposeChange`, so approval tests exercise a genuine record. */
async function propose(
  fileSystem: InMemoryGardenFileSystem,
  files: Record<string, string>,
  itemId: string,
  baseText: string,
  newBody: string,
) {
  const index = await indexFor(files)
  const result = await proposeChange(fileSystem, index, { itemId, baseText, newBody }, options)
  if (result.kind !== 'proposed') throw new Error(`expected proposed, got ${result.kind}`)
  return result
}

describe('approving a Pending Change', () => {
  it('writes the exact previewed content', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(result.kind).toBe('applied')
    expect(fileSystem.snapshot()['branches/attention.md']).toContain('A proposed replacement body.')
  })

  it('moves updated_at and leaves created_at alone', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    const written = fileSystem.snapshot()['branches/attention.md'] ?? ''
    expect(written).toContain(`created_at: ${CREATED}`)
    expect(written).toContain(`updated_at: ${NOW}`)
  })

  it('records an Undo Snapshot of the pre-approval content', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)
    if (result.kind !== 'applied') throw new Error(`expected applied, got ${result.kind}`)

    const snapshot = await readUndoSnapshot(fileSystem, result.snapshotId)
    expect(snapshot?.previousText).toBe(branchFile)
    expect(snapshot?.itemId).toBe(BRANCH)
  })

  it('removes the Pending Change once applied -- it is no longer pending', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    await expect(readPendingChange(fileSystem, proposed.id)).resolves.toBeUndefined()
  })

  it('writes the canonical file exactly once, matching the resulting hash it reports', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')
    const writeSpy = vi.spyOn(fileSystem, 'write')

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)
    if (result.kind !== 'applied') throw new Error(`expected applied, got ${result.kind}`)

    const canonicalWrites = writeSpy.mock.calls.filter(([path]) => path.join('/') === 'branches/attention.md')
    expect(canonicalWrites).toHaveLength(1)
    expect(await contentHash(canonicalWrites[0]![1])).toBe(result.resultingHash)
  })

  it('appears in a rescan afterward', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    const rescanned = await buildGardenIndex([
      { path: ['branches', 'attention.md'], text: fileSystem.snapshot()['branches/attention.md'] as string },
    ])
    expect(rescanned.items.get(BRANCH)?.item.body).toContain('A proposed replacement body.')
    expect(rescanned.diagnostics).toEqual([])
  })
})

describe('approving a change that no longer exists', () => {
  it('reports not-found rather than throwing', async () => {
    const fileSystem = gardenWith({})

    const result = await approveChange(fileSystem, { id: 'never-proposed', previewHash: 'sha256:x' }, options)

    expect(result.kind).toBe('not-found')
  })
})

describe('approving with a preview hash that does not match the record (ADR 0025)', () => {
  it('is refused, and nothing is written', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: 'sha256:not-what-was-shown' }, options)

    expect(result.kind).toBe('preview-mismatch')
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })
})

describe('a proposal whose target changed since it was proposed', () => {
  it('is marked Stale and is not applied', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    // Simulates a second tab, or a person's own hand edit, landing after the
    // proposal but before approval (ADR 0063).
    const overtakenFile = branchFile.replace('Original body text.', 'Someone already changed this.')
    await fileSystem.write(['branches', 'attention.md'], overtakenFile)

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(result.kind).toBe('stale')
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(overtakenFile)
  })

  it('does not overwrite the newer content -- the two-tab scenario the ticket names', async () => {
    // Tab A proposes against the original. Tab B (a second `openGarden`
    // holding the same folder) applies its own edit first.
    const files = { 'branches/attention.md': branchFile }
    const tabA = gardenWith(files)
    const proposed = await propose(tabA, files, BRANCH, branchFile, "Tab A's proposed body.")

    const tabB = branchFile.replace('Original body text.', "Tab B's own newer edit.")
    await tabA.write(['branches', 'attention.md'], tabB)

    await approveChange(tabA, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(tabA.snapshot()['branches/attention.md']).toBe(tabB)
  })

  it('is marked Stale, not applied, when the target file has been deleted entirely', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    await fileSystem.delete(['branches', 'attention.md'])

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(result.kind).toBe('stale')
  })
})

describe('a proposal that would leave the item invalid', () => {
  it('is refused before writing, and the file on disk is untouched', async () => {
    const files = { 'branches/attention.md': branchFile, 'roots/paper.md': rootFile, 'harvests/h.md': harvestFile }
    const fileSystem = gardenWith(files)

    // A body missing a required Harvest section (ADR 0030) is not caught at
    // proposal time -- only body text and updated_at are ever inspected
    // there -- so this is what the pre-write schema/graph revalidation
    // (buildGardenIndex over the substituted file) exists to catch.
    const brokenBody = fullHarvestBody.replace('## Open questions\n\nNone remain.', '')
    const proposed = await propose(fileSystem, files, HARVEST, harvestFile, brokenBody)

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(result.kind).toBe('invalid')
    expect(fileSystem.snapshot()['harvests/h.md']).toBe(harvestFile)
  })

  it('leaves the Pending Change in place, so it can still be reviewed or rejected', async () => {
    const files = { 'branches/attention.md': branchFile, 'roots/paper.md': rootFile, 'harvests/h.md': harvestFile }
    const fileSystem = gardenWith(files)
    const brokenBody = fullHarvestBody.replace('## Open questions\n\nNone remain.', '')
    const proposed = await propose(fileSystem, files, HARVEST, harvestFile, brokenBody)

    await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    await expect(readPendingChange(fileSystem, proposed.id)).resolves.toBeDefined()
  })
})

describe('approving while permission has lapsed', () => {
  it('reports permission-required rather than throwing', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')
    fileSystem.revokePermission()

    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(result.kind).toBe('permission-required')
  })
})

describe('a Pending Change record naming a path outside the canonical directories', () => {
  it('is refused rather than trusted (ADR 0058)', async () => {
    const fileSystem = gardenWith({})
    await writePendingChange(fileSystem, {
      id: 'tampered',
      itemId: BRANCH,
      path: ['..', 'outside.md'],
      baseText: 'x',
      baseHash: await contentHash('x'),
      previewText: 'malicious',
      previewHash: await contentHash('malicious'),
      proposedAt: NOW,
    })

    const result = await approveChange(fileSystem, { id: 'tampered', previewHash: await contentHash('malicious') }, options)

    expect(result.kind).toBe('failed')
  })
})

describe('a Pending Change record whose previewHash does not match its own previewText', () => {
  it('is refused rather than trusted for the write or the Undo Snapshot', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': branchFile })
    await writePendingChange(fileSystem, {
      id: 'tampered-preview',
      itemId: BRANCH,
      path: ['branches', 'attention.md'],
      baseText: branchFile,
      baseHash: await contentHash(branchFile),
      previewText: 'What actually gets written.',
      previewHash: await contentHash('What the record claims was reviewed.'),
      proposedAt: NOW,
    })

    const result = await approveChange(
      fileSystem,
      { id: 'tampered-preview', previewHash: await contentHash('What the record claims was reviewed.') },
      options,
    )

    expect(result.kind).toBe('failed')
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })
})

describe('when removing the applied Pending Change record itself fails', () => {
  it('still reports applied -- the write already succeeded and must not be misreported', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const proposed = await propose(fileSystem, files, BRANCH, branchFile, 'A proposed replacement body.')

    // Delegates every real call to the InMemoryGardenFileSystem, except
    // `delete`, which simulates the one call `approveChange` cannot recover
    // from mid-flight: the write has already landed, so this failure must
    // not turn into a reported `'failed'`.
    const flaky: GardenFileSystem = {
      repositoryName: fileSystem.repositoryName,
      permission: fileSystem.permission.bind(fileSystem),
      requestPermission: fileSystem.requestPermission.bind(fileSystem),
      listFiles: fileSystem.listFiles.bind(fileSystem),
      read: fileSystem.read.bind(fileSystem),
      readBytes: fileSystem.readBytes.bind(fileSystem),
      write: fileSystem.write.bind(fileSystem),
      delete: async () => {
        throw new Error('simulated failure deleting the Pending Change record')
      },
    }

    const result = await approveChange(flaky, { id: proposed.id, previewHash: proposed.previewHash }, options)

    expect(result.kind).toBe('applied')
    expect(fileSystem.snapshot()['branches/attention.md']).toContain('A proposed replacement body.')
  })
})

describe('the operational record itself', () => {
  it('lives only under the operational pending directory', () => {
    expect(pendingChangePath('abc').join('/')).toBe('.research-garden/pending/abc.json')
  })
})
