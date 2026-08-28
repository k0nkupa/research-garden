import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from './gardenIndex'
import {
  exceedsPerformanceTarget,
  PERFORMANCE_TARGET_ITEM_COUNT,
  PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
} from './performanceTarget'

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

describe('a Garden within the target', () => {
  it('does not exceed the performance target', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'attention.md'], text: branchFile(ATTENTION, 'Attention') },
    ])

    expect(exceedsPerformanceTarget(index)).toBe(false)
  })
})

describe('a Garden larger than the target', () => {
  it('exceeds the target on item count alone, whatever the relationship count', () => {
    const fakeIndex = {
      items: new Map(Array.from({ length: PERFORMANCE_TARGET_ITEM_COUNT + 1 }, (_, i) => [String(i), {}])),
      graph: { relationships: [] },
    }

    expect(exceedsPerformanceTarget(fakeIndex as never)).toBe(true)
  })

  it('exceeds the target on relationship count alone, whatever the item count', () => {
    const fakeIndex = {
      items: new Map(),
      graph: {
        relationships: Array.from({ length: PERFORMANCE_TARGET_RELATIONSHIP_COUNT + 1 }, () => ({})),
      },
    }

    expect(exceedsPerformanceTarget(fakeIndex as never)).toBe(true)
  })

  it('does not exceed the target when exactly at it', () => {
    const fakeIndex = {
      items: new Map(Array.from({ length: PERFORMANCE_TARGET_ITEM_COUNT }, (_, i) => [String(i), {}])),
      graph: {
        relationships: Array.from({ length: PERFORMANCE_TARGET_RELATIONSHIP_COUNT }, () => ({})),
      },
    }

    expect(exceedsPerformanceTarget(fakeIndex as never)).toBe(false)
  })
})
