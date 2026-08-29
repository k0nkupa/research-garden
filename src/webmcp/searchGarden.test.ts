import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { MAX_SEARCH_RESULTS } from '../domain/index/gardenSearch'
import { runSearchGarden } from './searchGarden'

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

A body about transformers and attention.
`

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
}

describe('searching a Garden', () => {
  it('returns a title and a snippet, never a full body', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runSearchGarden(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { query: 'transformers' },
    )
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.results).toHaveLength(1)
    expect(envelope.data.results[0]?.itemId).toBe(BRANCH)
    expect(envelope.data.results[0]?.snippet).toContain('transformers')
  })

  it('returns nothing for a query that matches nothing', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runSearchGarden(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { query: 'nonexistent-term' },
    )
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.results).toEqual([])
  })

  it('warns rather than refuses when the requested limit exceeds the cap', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runSearchGarden(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { query: 'attention', limit: MAX_SEARCH_RESULTS + 100 },
    )
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.warnings.length).toBeGreaterThan(0)
    expect(envelope.warnings[0]).toContain(String(MAX_SEARCH_RESULTS))
  })

  it('carries no warning when the limit is within bounds', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runSearchGarden(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { query: 'attention', limit: 5 },
    )
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.warnings).toEqual([])
  })

  it('carries the Garden Revision', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runSearchGarden(
      { repositoryName: 'my-garden', index, fileSystem: undefined as never },
      { query: 'attention' },
    )

    expect(envelope.gardenRevision).toBe(index.revision)
  })
})
