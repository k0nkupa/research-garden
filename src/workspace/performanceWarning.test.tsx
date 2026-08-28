/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { PERFORMANCE_TARGET_ITEM_COUNT } from '../domain/index/performanceTarget'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { Workspace } from './Workspace'

/**
 * ADR 0061 / ticket 24: a Garden past the performance target gets a
 * warning, in the human interface a person actually reads it in -- never a
 * refusal to open, and never fewer items than it actually has.
 */

function branchFile(id: string, title: string) {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

Body of ${title}.
`
}

function branchId(n: number): string {
  // A ULID is 26 characters; the fixed 20-character prefix below plus a
  // zero-padded 6-digit suffix (valid Crockford base32, since digits are
  // all in the alphabet) makes exactly that, varied only in its last digits.
  return `branch_01HQ8X2K3M4N5P6Q7R8S${String(n).padStart(6, '0')}`
}

async function renderWorkspaceWith(itemCount: number) {
  const files = Array.from({ length: itemCount }, (_, i) => ({
    path: ['branches', `branch-${i}.md`],
    text: branchFile(branchId(i), `Branch ${i}`),
  }))
  const index = await buildGardenIndex(files)
  const fileSystem = new InMemoryGardenFileSystem({}, 'large-garden')
  render(<Workspace garden={{ repositoryName: 'large-garden', index, fileSystem }} />)
  return index
}

describe('a Garden within the performance target', () => {
  it('shows no performance warning', async () => {
    await renderWorkspaceWith(5)

    expect(screen.queryByText(/grown past the size/i)).not.toBeInTheDocument()
  })
})

describe('a Garden past the performance target', () => {
  it('shows a performance warning, without dropping any item', async () => {
    const itemCount = PERFORMANCE_TARGET_ITEM_COUNT + 1
    const index = await renderWorkspaceWith(itemCount)

    expect(index.items.size).toBe(itemCount)
    expect(screen.getByText(/grown past the size/i)).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBe(itemCount)
  }, 20_000)

  it('states the warning as informational, not as a failure', async () => {
    await renderWorkspaceWith(PERFORMANCE_TARGET_ITEM_COUNT + 1)

    const notice = screen.getByText(/grown past the size/i)
    expect(notice).toHaveAttribute('role', 'status')
  }, 20_000)
})
