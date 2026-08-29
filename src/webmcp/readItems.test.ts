import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { createReadTool, type ReadToolRuntime } from './readTool'
import { MAX_BODY_CHARS, MAX_READ_ITEMS, READ_ITEMS_SPEC, runReadItems } from './readItems'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const CREATED = '2026-08-01T10:00:00Z'

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

const longBody = 'x'.repeat(MAX_BODY_CHARS + 500)
const LONG = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0N1W'
const longFile = `---
schema_version: 1
id: ${LONG}
kind: branch
title: A long branch
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

${longBody}
`

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
}

describe('reading items', () => {
  it('returns the full body, kind, and title for a found item', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: [BRANCH] },
    )
    if (!envelope.ok) throw new Error('expected ok')

    const [result] = envelope.data.items
    if (!result?.found) throw new Error('expected found')
    expect(result.kind).toBe('branch')
    expect(result.title).toBe('Attention mechanisms')
    expect(result.body).toContain('Original body text.')
    expect(result.bodyTruncated).toBe(false)
  })

  it('reports found: false per item for an id the Garden does not have, without failing the call', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: [BRANCH, 'branch_01HQ8X2K3M4N5P6Q7R8S9T0Z1W'] },
    )
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.items).toEqual([
      expect.objectContaining({ itemId: BRANCH, found: true }),
      { itemId: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0Z1W', found: false },
    ])
  })

  it('truncates a body past MAX_BODY_CHARS and reports it', async () => {
    const index = await indexFor({ 'branches/long.md': longFile })

    const envelope = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: [LONG] },
    )
    if (!envelope.ok) throw new Error('expected ok')

    const [result] = envelope.data.items
    if (!result?.found) throw new Error('expected found')
    expect(result.bodyTruncated).toBe(true)
    expect(result.body.length).toBe(MAX_BODY_CHARS)
    expect(result.bodyLength).toBeGreaterThan(MAX_BODY_CHARS)
  })

  it('continues a truncated body from bodyOffset, covering the rest of it', async () => {
    const index = await indexFor({ 'branches/long.md': longFile })
    const first = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: [LONG] },
    )
    if (!first.ok) throw new Error('expected ok')
    const [firstResult] = first.data.items
    if (!firstResult?.found) throw new Error('expected found')

    const second = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: [LONG], bodyOffset: MAX_BODY_CHARS },
    )
    if (!second.ok) throw new Error('expected ok')
    const [secondResult] = second.data.items
    if (!secondResult?.found) throw new Error('expected found')

    // Together, the two slices cover the entire body: nothing left to continue.
    expect(firstResult.body.length + secondResult.body.length).toBe(firstResult.bodyLength)
    expect(secondResult.bodyTruncated).toBe(false)
  })

  it('carries the Garden Revision', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: [BRANCH] },
    )

    expect(envelope.gardenRevision).toBe(index.revision)
  })

  it('is a lookup failure when none of the requested IDs are found', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runReadItems(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { itemIds: ['branch_01HQ8X2K3M4N5P6Q7R8S9T0Z1W'] },
    )

    expect(envelope.ok).toBe(false)
    if (envelope.ok) throw new Error('expected an error envelope')
    expect(envelope.error.code).toBe('lookup')
  })
})

describe('the real read_items tool -- input validation ADR 0038 asks for', () => {
  function toolFor(index: Awaited<ReturnType<typeof indexFor>>) {
    const runtime: ReadToolRuntime = {
      getGarden: () => ({ repositoryName: 'my-garden', index, fileSystem: undefined as never }),
      recordActivity: () => {},
      nextActivityId: () => 'entry-1',
      clock: () => CREATED,
    }
    return createReadTool(READ_ITEMS_SPEC, runtime)
  }

  it('refuses zero item IDs as invalid input', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })
    const tool = toolFor(index)

    const result = (await tool.execute({ itemIds: [] }, { signal: new AbortController().signal })) as {
      ok: boolean
      error?: { code: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('invalid-input')
  })

  it(`refuses more than ${MAX_READ_ITEMS} item IDs as invalid input`, async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })
    const tool = toolFor(index)
    const tooMany = Array.from({ length: MAX_READ_ITEMS + 1 }, () => BRANCH)

    const result = (await tool.execute({ itemIds: tooMany }, { signal: new AbortController().signal })) as {
      ok: boolean
      error?: { code: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('invalid-input')
  })

  it(`accepts exactly ${MAX_READ_ITEMS} item IDs`, async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })
    const tool = toolFor(index)
    const exactlyMax = Array.from({ length: MAX_READ_ITEMS }, () => BRANCH)

    const result = (await tool.execute(
      { itemIds: exactlyMax },
      { signal: new AbortController().signal },
    )) as { ok: boolean }

    expect(result.ok).toBe(true)
  })
})
