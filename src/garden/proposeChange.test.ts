import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { contentHash } from '../domain/hash'
import type { UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { openGarden } from './openGarden'
import { readPendingChange } from './pendingChange'
import { proposeChange } from './proposeChange'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
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

function gardenWith(files: Record<string, string>) {
  return new InMemoryGardenFileSystem(files, 'my-garden')
}

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
}

const options = { now: () => NOW, entropy: countingEntropy() }

describe('proposing a change does not touch canonical files', () => {
  it('leaves the target file exactly as it was', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      options,
    )

    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })

  it('writes only an operational record, nothing canonical', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      options,
    )

    const paths = Object.keys(fileSystem.snapshot())
    expect(paths).toContain('branches/attention.md')
    expect(paths.some((path) => path.startsWith('.research-garden/pending/'))).toBe(true)
  })

  it('never appears in a rescanned Garden Index', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      options,
    )

    const rescanned = await buildGardenIndex(
      Object.entries(fileSystem.snapshot())
        .filter(([path]) => path.startsWith('branches/'))
        .map(([path, text]) => ({ path: path.split('/'), text })),
    )
    expect(rescanned.items.get(BRANCH)?.item.body).toContain('Original body text.')
    expect(rescanned.diagnostics).toEqual([])
  })

  it('never appears in a real openGarden() scan, across every canonical directory it looks at', async () => {
    // The test above hand-filters to `branches/` before rescanning, which
    // proves nothing about the directories it never looked at. `openGarden`
    // is what the Tree and search are actually built from -- it walks every
    // canonical directory (`CANONICAL_DIRECTORIES`), the same as the running
    // app, so this is the one test that exercises the real exclusion rather
    // than a scan already scoped to exclude the operational directory.
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      options,
    )

    const opened = await openGarden(fileSystem)
    if (opened.kind !== 'opened') throw new Error(`expected opened, got ${opened.kind}`)
    expect(opened.garden.index.items.get(BRANCH)?.item.body).toContain('Original body text.')
    expect(opened.garden.index.diagnostics).toEqual([])
  })
})

describe('the recorded Pending Change', () => {
  it('carries an exact one-file preview of what would be written', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      options,
    )

    if (result.kind !== 'proposed') throw new Error(`expected proposed, got ${result.kind}`)
    const record = await readPendingChange(fileSystem, result.id)

    expect(record?.itemId).toBe(BRANCH)
    expect(record?.path).toEqual(['branches', 'attention.md'])
    expect(record?.baseText).toBe(branchFile)
    expect(record?.previewText).toContain('A proposed replacement body.')
    expect(record?.previewText).toContain(`updated_at: ${NOW}`)
    expect(record?.previewText).toContain(`created_at: ${CREATED}`)
    expect(record?.previewHash).toBe(result.previewHash)
  })

  it('records the same instant as proposedAt that it wrote into the preview\'s updated_at', async () => {
    // As in `editItem.test.ts`: a fixed clock cannot distinguish one `now()`
    // call from two, since both return the same string either way. A clock
    // that ticks on every call is the only way to prove `updated_at` (set
    // inside `deriveBodyEdit`) and `proposedAt` (set by this record) come
    // from the same shared instant, not two separate reads of a real clock.
    let calls = 0
    const tickingNow = () => {
      calls += 1
      return calls === 1 ? NOW : '2099-01-01T00:00:00Z'
    }
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      { now: tickingNow, entropy: countingEntropy() },
    )

    if (result.kind !== 'proposed') throw new Error(`expected proposed, got ${result.kind}`)
    const record = await readPendingChange(fileSystem, result.id)

    expect(record?.previewText).toContain(`updated_at: ${NOW}`)
    expect(record?.proposedAt).toBe(NOW)
    expect(calls).toBe(1)
  })

  it('records the current file hash as its base, for staleness later', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      options,
    )

    if (result.kind !== 'proposed') throw new Error(`expected proposed, got ${result.kind}`)
    const record = await readPendingChange(fileSystem, result.id)

    expect(record?.baseHash).toBe(await contentHash(branchFile))
  })
})

describe('proposing against an item with a Garden Diagnostic', () => {
  it('is blocked, the same way editing it directly is (ADR 0052)', async () => {
    const brokenBranch = branchFile.replace('kind: branch', 'kind: not-a-real-kind')
    const files = { 'branches/attention.md': brokenBranch }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: brokenBranch, newBody: 'Anything' },
      options,
    )

    expect(result.kind).toBe('blocked')
  })
})

describe("proposing a body change to a Root's captured evidence", () => {
  it('is refused, the same way editing it directly is (ADR 0012)', async () => {
    const files = { 'roots/paper.md': rootFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: ROOT, baseText: rootFile, newBody: 'A different excerpt entirely.' },
      options,
    )

    expect(result.kind).toBe('evidence-refused')
  })
})

describe('proposing against a target that has already changed on disk', () => {
  it('is refused as stale, and nothing is recorded', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)

    const staleBaseText = branchFile.replace('Original body text.', 'A version already overtaken.')

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: staleBaseText, newBody: 'Anything' },
      options,
    )

    expect(result.kind).toBe('stale')
  })
})

describe('proposing an identical body', () => {
  it('is a no-op: nothing is written or recorded', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)
    const identicalBody = index.items.get(BRANCH)!.item.body

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: identicalBody },
      options,
    )

    expect(result).toEqual({ kind: 'no-op', itemId: BRANCH })
    expect(Object.keys(fileSystem.snapshot())).toEqual(['branches/attention.md'])
  })
})

describe('proposing while permission has lapsed', () => {
  it('reports permission-required rather than throwing', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = gardenWith(files)
    const index = await indexFor(files)
    fileSystem.revokePermission()

    const result = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'Anything' },
      options,
    )

    expect(result.kind).toBe('permission-required')
  })
})
