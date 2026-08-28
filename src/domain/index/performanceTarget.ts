import type { GardenIndex } from './gardenIndex'

/**
 * The challenge performance target (ADR 0061, ticket 24): the size Research
 * Garden is actually measured against. `performanceFixture.ts` generates a
 * Garden at exactly this size to test against; this module is the other
 * half -- deciding, for a real person's Garden, whether it has grown past
 * that size. The two share these numbers rather than each defining their
 * own, so "the target" only ever means one thing.
 *
 * Crossing it changes nothing about what opens. ADR 0061 is explicit that a
 * larger repository gets a performance warning, never a hard limit or
 * destructive behaviour -- designing for arbitrary scale is out of scope,
 * but refusing a person's own knowledge because it grew past a number never
 * is.
 */
export const PERFORMANCE_TARGET_ITEM_COUNT = 1000
export const PERFORMANCE_TARGET_RELATIONSHIP_COUNT = 5000

export function exceedsPerformanceTarget(index: GardenIndex): boolean {
  return (
    index.items.size > PERFORMANCE_TARGET_ITEM_COUNT ||
    index.graph.relationships.length > PERFORMANCE_TARGET_RELATIONSHIP_COUNT
  )
}
