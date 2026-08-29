import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { runInspectGarden } from './inspectGarden'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const LEAF = 'question_leaf_01HQ8X2K3M4N5P6Q7R8S9T0Q1W'
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

A branch body.
`

const leafFile = `---
schema_version: 1
id: ${LEAF}
kind: question_leaf
title: An open question
parent_id: ${BRANCH}
created_at: ${CREATED}
updated_at: ${CREATED}
---

What happens next?
`

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
}

describe('inspecting a Garden', () => {
  it('counts items by kind', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile, 'leaves/question.md': leafFile })

    const envelope = runInspectGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.itemCounts.branch).toBe(1)
    expect(envelope.data.itemCounts.question_leaf).toBe(1)
    expect(envelope.data.itemCounts.root).toBe(0)
    expect(envelope.data.totalItems).toBe(2)
  })

  it('lists only top-level items, by id, kind, and title -- never a body', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile, 'leaves/question.md': leafFile })

    const envelope = runInspectGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.topLevel).toEqual([{ itemId: BRANCH, kind: 'branch', title: 'Attention mechanisms' }])
    expect(JSON.stringify(envelope.data)).not.toContain('A branch body.')
    expect(JSON.stringify(envelope.data)).not.toContain('What happens next?')
  })

  it('carries the repository name and the Garden Revision', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runInspectGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.repositoryName).toBe('my-garden')
    expect(envelope.gardenRevision).toBe(index.revision)
  })

  it('counts Garden Diagnostics', async () => {
    const brokenFile = '---\nnot: valid frontmatter for a kind\n---\n\nbody\n'
    const index = await indexFor({ 'branches/attention.md': branchFile, 'roots/broken.md': brokenFile })

    const envelope = runInspectGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.diagnosticsCount).toBe(index.diagnostics.length)
    expect(envelope.data.diagnosticsCount).toBeGreaterThan(0)
  })
})
