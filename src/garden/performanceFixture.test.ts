import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import {
  PERFORMANCE_TARGET_ITEM_COUNT,
  PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
} from '../domain/index/performanceTarget'
import { createItemIdFactory, type UlidEntropy } from '../domain/schema/ulid'
import { GARDEN_ITEM_KINDS } from '../domain/schema/itemIdentity'
import { generatePerformanceFixture } from './performanceFixture'
import { planFiles } from './createGarden'

/** Deterministic, so a generated fixture is the same fixture on every run. */
function fixtureEntropy(): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => 1_700_000_000_000 + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

async function buildFixture(itemCount: number, relationshipCount: number) {
  const nextId = createItemIdFactory(fixtureEntropy())
  const items = await generatePerformanceFixture({
    nextId,
    now: () => '2026-08-01T10:00:00Z',
    itemCount,
    relationshipCount,
  })
  const planned = planFiles(items)
  const index = await buildGardenIndex(planned.map((file) => ({ path: file.path, text: file.text })))
  return { items, planned, index }
}

describe('the performance fixture, at a small scale (fast algorithm check)', () => {
  it('produces exactly the requested item count, all schema-valid and graph-clean', async () => {
    const { index } = await buildFixture(60, 150)

    expect(index.items.size).toBe(60)
    expect(index.diagnostics).toEqual([])
  })

  it('produces exactly the requested relationship count', async () => {
    const { index } = await buildFixture(60, 150)

    expect(index.graph.relationships.length).toBe(150)
  })

  it('writes real, well-formed canonical Markdown -- the same planFiles a real Create Garden uses', async () => {
    const { planned } = await buildFixture(60, 150)

    expect(planned.length).toBe(60)
    for (const file of planned) {
      expect(file.text.startsWith('---\nschema_version: 1\nid: ')).toBe(true)
    }
  })

  it('scales down cleanly for item counts not evenly divisible by the kind proportions', async () => {
    const { index } = await buildFixture(37, 40)

    expect(index.items.size).toBe(37)
    expect(index.diagnostics).toEqual([])
  })

  it('covers every item kind', async () => {
    const { index } = await buildFixture(200, 400)

    const kindsPresent = new Set([...index.items.values()].map((indexed) => indexed.item.kind))
    for (const kind of GARDEN_ITEM_KINDS) expect(kindsPresent.has(kind)).toBe(true)
  })

  // The one guaranteed relationship (ADR 0010: every Claim Leaf and Harvest
  // cites at least one Root) is generated before anything asked-for is
  // padded, so a small `relationshipCount` can come back exceeded rather
  // than honoured exactly -- this is the module docstring's documented
  // structural floor, not a bug, and it stays a valid, invariant-clean
  // Garden either way.
  it('can exceed a requested relationship count that sits below the guaranteed Supports baseline', async () => {
    const { index } = await buildFixture(37, 40)

    expect(index.diagnostics).toEqual([])
    expect(index.graph.relationships.length).toBeGreaterThan(40)
  })
})

describe('the performance fixture, at the challenge target (ADR 0061)', () => {
  it('produces 1,000 items and 5,000 relationships that validate against the full schema and all graph invariants', async () => {
    const { index } = await buildFixture(
      PERFORMANCE_TARGET_ITEM_COUNT,
      PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
    )

    expect(index.items.size).toBe(PERFORMANCE_TARGET_ITEM_COUNT)
    expect(index.diagnostics).toEqual([])
    expect(index.graph.relationships.length).toBe(PERFORMANCE_TARGET_RELATIONSHIP_COUNT)
  }, 30_000)

  it('uses the default target when no counts are given', async () => {
    const nextId = createItemIdFactory(fixtureEntropy())
    const items = await generatePerformanceFixture({ nextId, now: () => '2026-08-01T10:00:00Z' })

    expect(items.length).toBe(PERFORMANCE_TARGET_ITEM_COUNT)
  }, 30_000)
})
