import { beforeAll, describe, expect, it } from 'vitest'
import { searchGardenIndex } from '../domain/index/gardenSearch'
import type { GardenIndex } from '../domain/index/gardenIndex'
import {
  exceedsPerformanceTarget,
  PERFORMANCE_TARGET_ITEM_COUNT,
  PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
} from '../domain/index/performanceTarget'
import { createItemIdFactory, type UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { visibleTreeRows, UNFOCUSED, type TreeViewState } from '../workspace/treeView'
import { computeTreeLayout } from '../workspace/treeLayout'
import { planFiles } from './createGarden'
import { openGarden, type OpenedGarden } from './openGarden'
import { generatePerformanceFixture } from './performanceFixture'

/**
 * Ticket 24 / ADR 0061: this is the challenge performance target, measured
 * against a real Garden of the stated size rather than assumed. Every
 * criterion here is asserted *directionally* (warm faster than cold, a
 * generous but real upper bound on what "usable" means) rather than against
 * a fixed millisecond figure, so the assertions hold across machines and
 * load rather than being tuned to whatever ran them first -- what makes
 * this "repeatable evidence" is that the measurement itself re-runs and
 * re-verifies every time this suite does, not a number frozen in a comment.
 * The actual figures from one real run are recorded in the ticket's Notes.
 */

function fixtureEntropy(): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => 1_700_000_000_000 + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

async function materializedFixture(itemCount: number, relationshipCount: number) {
  const nextId = createItemIdFactory(fixtureEntropy())
  const items = await generatePerformanceFixture({
    nextId,
    now: () => '2026-08-01T10:00:00Z',
    itemCount,
    relationshipCount,
  })
  const planned = planFiles(items)
  const files = Object.fromEntries(planned.map((file) => [file.path.join('/'), file.text]))
  return new InMemoryGardenFileSystem(files, 'performance-fixture')
}

function expectOpened(result: Awaited<ReturnType<typeof openGarden>>): OpenedGarden {
  if (result.kind !== 'opened') throw new Error(`expected opened, got ${result.kind}`)
  return result.garden
}

// Built once at module scope and shared read-only by search and Tree-bounding
// below: neither mutates the fixture or its index, so there is nothing
// building three separate 1,000-item Gardens for the same target size would
// buy beyond three times the setup cost. Cold/warm timing keeps its own
// dedicated fixture (below), since sharing setup work with these would
// contaminate the very thing it is timing.
let sharedIndex: GardenIndex

beforeAll(async () => {
  const fileSystem = await materializedFixture(
    PERFORMANCE_TARGET_ITEM_COUNT,
    PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
  )
  sharedIndex = expectOpened(await openGarden(fileSystem)).index
}, 60_000)

describe('indexing and reopening the fixture at the challenge target', () => {
  let cold: OpenedGarden
  let coldMs: number
  let warm: OpenedGarden
  let warmMs: number

  beforeAll(async () => {
    const fileSystem = await materializedFixture(
      PERFORMANCE_TARGET_ITEM_COUNT,
      PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
    )

    const coldStart = performance.now()
    cold = expectOpened(await openGarden(fileSystem))
    coldMs = performance.now() - coldStart

    const warmStart = performance.now()
    warm = expectOpened(await openGarden(fileSystem))
    warmMs = performance.now() - warmStart

    console.log(
      `[ticket 24] cold open: ${coldMs.toFixed(1)}ms, warm open: ${warmMs.toFixed(1)}ms, ` +
        `items: ${cold.index.items.size}, relationships: ${cold.index.graph.relationships.length}`,
    )
  }, 60_000)

  it('indexes the fixture from canonical Markdown correctly', () => {
    expect(cold.index.items.size).toBe(PERFORMANCE_TARGET_ITEM_COUNT)
    expect(cold.index.diagnostics).toEqual([])
    expect(cold.index.graph.relationships.length).toBe(PERFORMANCE_TARGET_RELATIONSHIP_COUNT)
  })

  // "Remains usable" is given a real, generous number rather than left
  // unfalsifiable: a person opening a folder is not waiting several seconds
  // for it, and an accidental quadratic-time regression would blow well past
  // this even under heavy machine load.
  it('indexes the fixture within a usable amount of time', () => {
    expect(coldMs).toBeLessThan(10_000)
  })

  it('is measurably faster to reopen with a warm Index Cache than to open cold', () => {
    expect(warm.index.items.size).toBe(cold.index.items.size)
    // Half, not merely less-than: a bare `warmMs < coldMs` also passes most
    // of the time on JIT warmup alone, with the Index Cache disconnected
    // entirely -- confirmed directly during review, where it passed 2 of 3
    // runs against a cache that was never actually being read. The real,
    // repeatedly observed margin from the cache genuinely working is roughly
    // sevenfold (see the ticket's Notes for one real run's figures); half is
    // a floor comfortably under that real margin and comfortably over what
    // warmup alone produces.
    expect(warmMs).toBeLessThan(coldMs / 2)
  })

  it('reopening warm still produces the exact same Garden Revision as the cold open (ADR 0062)', () => {
    expect(warm.index.revision).toBe(cold.index.revision)
  })
})

describe('search over the fixture at the challenge target', () => {
  it('returns matches from the fixture', () => {
    const results = searchGardenIndex(sharedIndex, 'Generated body for Branch 1.')
    expect(results.length).toBeGreaterThan(0)
  })

  it('remains usable: a single query completes well within typing latency', () => {
    const start = performance.now()
    const results = searchGardenIndex(sharedIndex, 'Claim')
    const elapsedMs = performance.now() - start

    console.log(`[ticket 24] search over ${sharedIndex.items.size} items: ${elapsedMs.toFixed(2)}ms`)
    // A search that broke and started returning nothing would still be
    // "fast" -- timed and checked together, so a fast empty result cannot
    // pass as a usable one.
    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('stays fast across repeated queries once titles and bodies are cached', () => {
    searchGardenIndex(sharedIndex, 'warm the cache')

    const start = performance.now()
    for (let i = 0; i < 20; i++) searchGardenIndex(sharedIndex, `query ${i}`)
    const elapsedMs = performance.now() - start

    expect(elapsedMs).toBeLessThan(500)
  })
})

describe('Branch collapse and Branch focus bound the visible Tree workload', () => {
  function topLevelBranchIds(): readonly string[] {
    return sharedIndex.topLevelIds.filter((id) => sharedIndex.items.get(id)?.item.kind === 'branch')
  }

  it('with nothing collapsed or focused, the full item count is drawable', () => {
    const rows = visibleTreeRows(sharedIndex, UNFOCUSED)
    expect(rows.length).toBe(sharedIndex.items.size)
  })

  it('collapsing every top-level Branch removes most of the Garden from the drawn Tree', () => {
    const collapsedIds = new Set(topLevelBranchIds())
    const view: TreeViewState = { collapsedIds, focusedId: undefined }

    const rows = visibleTreeRows(sharedIndex, view)

    expect(rows.length).toBeLessThan(sharedIndex.items.size / 2)
  })

  it('focusing on one Branch bounds the drawn Tree to its own subtree', () => {
    const [focusId] = topLevelBranchIds()
    if (!focusId) throw new Error('expected at least one top-level Branch in the fixture')
    const view: TreeViewState = { collapsedIds: new Set(), focusedId: focusId }

    const rows = visibleTreeRows(sharedIndex, view)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(sharedIndex.items.size / 2)
    expect(rows.every((row) => row.id === focusId || row.depth > 1)).toBe(true)
  })

  // `visibleTreeRows` bounds what a person could scroll to, but the SVG a
  // browser actually paints is `computeTreeLayout`'s `nodes`/`links`/
  // `crossLinks` -- what `GardenTree.tsx` maps into one element each. Those
  // are what "visible SVG workload" names, so this measures them directly
  // rather than trusting the row count as a stand-in.
  it('bounds the actual drawn SVG elements -- nodes, limbs, and Cross-links -- not only the row count', () => {
    const full = computeTreeLayout(sharedIndex, UNFOCUSED)
    expect(full.nodes.length).toBe(sharedIndex.items.size)

    const collapsedIds = new Set(topLevelBranchIds())
    const collapsed = computeTreeLayout(sharedIndex, { collapsedIds, focusedId: undefined })

    expect(collapsed.nodes.length).toBeLessThan(full.nodes.length / 2)
    expect(collapsed.links.length).toBeLessThan(full.links.length)
    expect(collapsed.crossLinks.length).toBeLessThan(full.crossLinks.length)
  })
})

describe('a Garden larger than the fixture target', () => {
  const LARGER_ITEM_COUNT = Math.round(PERFORMANCE_TARGET_ITEM_COUNT * 1.2)
  const LARGER_RELATIONSHIP_COUNT = Math.round(PERFORMANCE_TARGET_RELATIONSHIP_COUNT * 1.2)
  let opened: OpenedGarden

  beforeAll(async () => {
    const fileSystem = await materializedFixture(LARGER_ITEM_COUNT, LARGER_RELATIONSHIP_COUNT)
    opened = expectOpened(await openGarden(fileSystem))
  }, 60_000)

  it('opens completely, with no item dropped and no hard limit imposed', () => {
    expect(opened.index.items.size).toBe(LARGER_ITEM_COUNT)
    expect(opened.index.diagnostics).toEqual([])
  })

  it('is reported as exceeding the performance target, so the interface can warn honestly', () => {
    expect(exceedsPerformanceTarget(opened.index)).toBe(true)
  })
})
