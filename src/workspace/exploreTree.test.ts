import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import {
  MAX_BRANCHES_ON_MAP,
  MAX_ITEMS_PER_CANOPY,
  branchTreePageCount,
  branchTreeRows,
  overviewEntries,
  overviewPageCount,
  overviewTreeRows,
} from './exploreTree'

function branchFile(id: string, title: string, body: string) {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

${body}
`
}

function leafFile(id: string, title: string, parentId: string) {
  return `---
schema_version: 1
id: ${id}
kind: question_leaf
title: ${title}
parent_id: ${parentId}
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

${title} body
`
}

async function makeIndex(count: number) {
  return buildGardenIndex(
    Array.from({ length: count }, (_, position) => ({
      path: ['branches', `${position}.md`],
      text: branchFile(
        `branch_01HQ8X2K3M4N5P6Q7R8S9T${position}V1W`,
        `Thread ${position + 1}`,
        `Body ${position + 1}`,
      ),
    })),
  )
}

describe('dense living overview projection', () => {
  it('caps overview pages at five top-level research threads', async () => {
    const index = await makeIndex(MAX_BRANCHES_ON_MAP + 1)

    expect(overviewPageCount(index)).toBe(2)
    expect(overviewEntries(index, 0)).toHaveLength(MAX_BRANCHES_ON_MAP)
    expect(overviewEntries(index, 1)).toHaveLength(1)
    expect(overviewTreeRows(index, 0)).toHaveLength(MAX_BRANCHES_ON_MAP)
  })

  it('bounds a focused Branch to its descendant leaves and pages after five', async () => {
    const branchId = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
    const files = [
      { path: ['branches', 'thread.md'], text: branchFile(branchId, 'Focused thread', 'Thread body') },
      { path: ['branches', 'nested.md'], text: branchFile('branch_01HQ8X2K3M4N5P6Q7R8S9T2V1W', 'Nested thread', 'Nested body').replace('state: active', `state: active\nparent_id: ${branchId}`) },
      ...Array.from({ length: MAX_ITEMS_PER_CANOPY + 1 }, (_, position) => ({
        path: ['questions', `${position}.md`],
        text: leafFile(
          `question_leaf_01HQ8X2K3M4N5P6Q7R8S9T${position}V1W`,
          `Question ${position + 1}`,
          'branch_01HQ8X2K3M4N5P6Q7R8S9T2V1W',
        ),
      })),
      { path: ['branches', 'unrelated.md'], text: branchFile('branch_01HQ8X2K3M4N5P6Q7R8S9T1V1W', 'Unrelated branch', 'Other body') },
    ]
    const index = await buildGardenIndex(files)

    expect(overviewEntries(index).find((entry) => entry.title === 'Focused thread')).toEqual(
      expect.objectContaining({ count: MAX_ITEMS_PER_CANOPY + 1 }),
    )
    expect(branchTreePageCount(index, branchId)).toBe(2)
    expect(branchTreeRows(index, branchId, 0).map((row) => row.title)).toEqual([
      'Focused thread',
      'Nested thread',
      'Question 1',
      'Question 2',
      'Question 3',
      'Question 4',
      'Question 5',
    ])
    expect(branchTreeRows(index, branchId, 1).map((row) => row.title)).toEqual(['Focused thread', 'Nested thread', 'Question 6'])
    expect(branchTreeRows(index, branchId, 0).some((row) => row.title === 'Unrelated branch')).toBe(false)
  })

  it('summarises each thread with its descendant leaf count', async () => {
    const index = await makeIndex(1)

    expect(overviewEntries(index)).toEqual([
      expect.objectContaining({ title: 'Thread 1', count: 0 }),
    ])
  })
})
