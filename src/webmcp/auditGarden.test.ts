import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { runAuditGarden } from './auditGarden'

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

A branch body.
`

const unparseableFile = 'not even frontmatter\n'

async function indexFor(files: Record<string, string>) {
  return buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
}

describe('auditing a Garden', () => {
  it('reports no diagnostics for a fully valid Garden', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runAuditGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.diagnostics).toEqual([])
    expect(envelope.data.totalDiagnostics).toBe(0)
  })

  it('includes an invalid, unparseable file -- one that has no item id at all', async () => {
    const index = await indexFor({
      'branches/attention.md': branchFile,
      'roots/broken.md': unparseableFile,
    })

    const envelope = runAuditGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })
    if (!envelope.ok) throw new Error('expected ok')

    expect(envelope.data.totalDiagnostics).toBe(1)
    expect(envelope.data.diagnostics[0]).toMatchObject({ path: 'roots/broken.md', itemId: undefined })
    expect(envelope.data.diagnostics[0]?.problems.length).toBeGreaterThan(0)
  })

  it('carries the Garden Revision', async () => {
    const index = await indexFor({ 'branches/attention.md': branchFile })

    const envelope = runAuditGarden({ repositoryName: 'my-garden', index, fileSystem: undefined as never })

    expect(envelope.gardenRevision).toBe(index.revision)
  })
})
