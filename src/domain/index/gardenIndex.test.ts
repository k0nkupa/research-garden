import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from './gardenIndex'

function branchFile(id: string, title: string, extra = '') {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
${extra}---

Body of ${title}.
`
}

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'

const oneBranch = [
  { path: ['branches', 'attention.md'], text: branchFile(ATTENTION, 'Attention') },
]

describe('building an index', () => {
  it('indexes a well-formed Branch by its stable id', async () => {
    const index = await buildGardenIndex(oneBranch)

    expect(index.items.get(ATTENTION)).toMatchObject({
      item: { id: ATTENTION, kind: 'branch', title: 'Attention' },
    })
  })

  it('keeps the body alongside the validated item', async () => {
    const index = await buildGardenIndex(oneBranch)

    expect(index.items.get(ATTENTION)?.item.body).toContain('Body of Attention.')
  })

  // ADR 0013: relationships reference stable identities, not file paths, but the
  // index still remembers where each item was read from so it can be written back.
  it('remembers the path each item was read from', async () => {
    const index = await buildGardenIndex(oneBranch)

    expect(index.items.get(ATTENTION)?.path).toEqual(['branches', 'attention.md'])
  })

  it('treats a Branch with no parent as top level', async () => {
    const index = await buildGardenIndex(oneBranch)

    expect(index.topLevelIds).toEqual([ATTENTION])
  })

  it('nests a Branch beneath its parent', async () => {
    const index = await buildGardenIndex([
      ...oneBranch,
      {
        path: ['branches', 'optimisers.md'],
        text: branchFile(OPTIMISERS, 'Optimisers', `parent_id: ${ATTENTION}\n`),
      },
    ])

    expect(index.topLevelIds).toEqual([ATTENTION])
    expect(index.items.get(ATTENTION)?.childIds).toEqual([OPTIMISERS])
  })

  it('orders top-level items by title so the Tree is stable between opens', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'z.md'], text: branchFile(OPTIMISERS, 'Zebra') },
      { path: ['branches', 'a.md'], text: branchFile(ATTENTION, 'Aardvark') },
    ])

    expect(index.topLevelIds).toEqual([ATTENTION, OPTIMISERS])
  })

  it('indexes an empty Garden without failing', async () => {
    const index = await buildGardenIndex([])

    expect(index.items.size).toBe(0)
    expect(index.topLevelIds).toEqual([])
  })
})

// The mechanism only. Ticket 05 turns these into surfaced Garden Diagnostics
// with their auditing and mutation-blocking guarantees.
describe('files that do not validate', () => {
  it('records an unparseable file instead of throwing', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'broken.md'], text: 'no frontmatter here\n' },
    ])

    expect(index.diagnostics).toHaveLength(1)
    expect(index.diagnostics[0]).toMatchObject({ path: ['branches', 'broken.md'] })
  })

  it('records a file that parses but fails validation', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'bad.md'], text: branchFile(ATTENTION, '') },
    ])

    expect(index.diagnostics).toHaveLength(1)
  })

  it('keeps valid items available when another file is invalid', async () => {
    const index = await buildGardenIndex([
      ...oneBranch,
      { path: ['branches', 'broken.md'], text: 'not a Garden item\n' },
    ])

    expect(index.items.get(ATTENTION)).toBeDefined()
    expect(index.diagnostics).toHaveLength(1)
  })

  it('records two files claiming the same id rather than silently dropping one', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'one.md'], text: branchFile(ATTENTION, 'One') },
      { path: ['branches', 'two.md'], text: branchFile(ATTENTION, 'Two') },
    ])

    expect(index.diagnostics).toHaveLength(1)
    expect(index.items.size).toBe(1)
  })

  it('treats a parent that does not exist as top level and records the problem', async () => {
    const index = await buildGardenIndex([
      {
        path: ['branches', 'orphan.md'],
        text: branchFile(OPTIMISERS, 'Orphan', `parent_id: ${ATTENTION}\n`),
      },
    ])

    expect(index.topLevelIds).toEqual([OPTIMISERS])
    expect(index.diagnostics).toHaveLength(1)
  })
})

// ADR 0001 and ADR 0050: the index is derived, so it must be a pure function of
// the canonical files and never an authority of its own.
describe('the Garden Revision', () => {
  it('derives a revision from canonical content', async () => {
    const index = await buildGardenIndex(oneBranch)

    expect(index.revision).toMatch(/^[0-9a-f]{64}$/)
  })

  it('derives the same revision from the same files', async () => {
    const first = await buildGardenIndex(oneBranch)
    const second = await buildGardenIndex(oneBranch)

    expect(second.revision).toBe(first.revision)
  })

  it('derives the same revision regardless of the order files were scanned', async () => {
    const files = [
      { path: ['branches', 'a.md'], text: branchFile(ATTENTION, 'Aardvark') },
      { path: ['branches', 'z.md'], text: branchFile(OPTIMISERS, 'Zebra') },
    ]

    const forwards = await buildGardenIndex(files)
    const backwards = await buildGardenIndex([...files].reverse())

    expect(backwards.revision).toBe(forwards.revision)
  })

  it('changes when a file’s content changes', async () => {
    const before = await buildGardenIndex(oneBranch)
    const after = await buildGardenIndex([
      { path: ['branches', 'attention.md'], text: branchFile(ATTENTION, 'Attention rewritten') },
    ])

    expect(after.revision).not.toBe(before.revision)
  })

  it('changes when a file is added', async () => {
    const before = await buildGardenIndex(oneBranch)
    const after = await buildGardenIndex([
      ...oneBranch,
      { path: ['branches', 'other.md'], text: branchFile(OPTIMISERS, 'Other') },
    ])

    expect(after.revision).not.toBe(before.revision)
  })

  it('changes when a file moves to a different path', async () => {
    const before = await buildGardenIndex(oneBranch)
    const after = await buildGardenIndex([
      { path: ['branches', 'renamed.md'], text: branchFile(ATTENTION, 'Attention') },
    ])

    expect(after.revision).not.toBe(before.revision)
  })

  it('covers invalid files too, so fixing one changes the revision', async () => {
    const before = await buildGardenIndex([
      ...oneBranch,
      { path: ['branches', 'broken.md'], text: 'broken\n' },
    ])
    const after = await buildGardenIndex([
      ...oneBranch,
      { path: ['branches', 'broken.md'], text: 'still broken but different\n' },
    ])

    expect(after.revision).not.toBe(before.revision)
  })

  it('gives an empty Garden a stable revision', async () => {
    expect((await buildGardenIndex([])).revision).toBe((await buildGardenIndex([])).revision)
  })
})
