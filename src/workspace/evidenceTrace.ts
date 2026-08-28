import type { GardenIndex } from '../domain/index/gardenIndex'
import type { GardenRelationship } from '../domain/index/gardenGraph'

/**
 * The evidence tracing signature interaction (ADR 0045).
 *
 * Selecting an item is meant to show its complete provenance and evidence
 * path: every Root that supports it, however many Harvests or Questions sit
 * between them, plus anything it disagrees with. Kept as a pure model over
 * the index -- like treeView.ts -- so the path a person is shown can be
 * judged without a browser, and so the Tree component stays a renderer.
 *
 * CONTEXT.md names Supports, Answers, and Derived From as the relationships
 * that carry provenance and evidence; Parent is Tree placement, not
 * provenance, so ancestry is deliberately not traced here.
 *
 * The walk follows each of those relationships in one direction only: toward
 * whatever fed evidence into the current item, never toward whatever it feeds
 * in turn. A real-browser check during development caught what going both
 * ways does -- two Harvests that happen to cite the same Root lit each other
 * up merely for sharing a citation, which is not evidence for either one. So
 * Supports and Answers are walked from target back to source, and Derived
 * From is walked from source on to the Seed it names; nothing is ever walked
 * the other way.
 */

export interface EvidenceTrace {
  /**
   * Every item reached from the selection by walking Supports, Answers, and
   * Derived From backward, however many hops away -- including Roots and
   * Seeds. Named for what a person is shown (ADR 0045's "evidence path"),
   * not for one relation among the three that build it. Never contains the
   * selection itself.
   */
  readonly evidencePathIds: ReadonlySet<string>
  /**
   * Claims that directly contradict the selection. Disagreement is shown,
   * not chased through the graph as if it were evidence: a contradicting
   * Claim's own supporting Roots are not traced further.
   */
  readonly contradictingIds: ReadonlySet<string>
  /**
   * Every relationship drawn as part of the path, keyed the same way a
   * Cross-link is (`${type}:${sourceId}->${targetId}`), so the Tree can tell
   * a lit edge from an unrelated one.
   */
  readonly litEdges: ReadonlySet<string>
}

export const NOTHING_TRACED: EvidenceTrace = {
  evidencePathIds: new Set(),
  contradictingIds: new Set(),
  litEdges: new Set(),
}

/**
 * Whether a trace actually found anything to illuminate.
 *
 * Distinct from "something is selected": a Root or a bare Branch is a valid
 * selection whose trace is legitimately empty (ADR 0012 -- a Root's evidence
 * terminates in itself), and softening the whole Tree for a selection with
 * nothing to show would read as broken rather than quiet. Exported rather
 * than left to `!== NOTHING_TRACED` at the call site, so nothing outside this
 * module depends on the sentinel's object identity.
 */
export function isTracing(trace: EvidenceTrace): boolean {
  return trace.evidencePathIds.size > 0 || trace.contradictingIds.size > 0
}

/** Keyed the same way a drawn Cross-link is, so the two can be compared. */
export function edgeKey(relationship: Pick<GardenRelationship, 'type' | 'sourceId' | 'targetId'>): string {
  return `${relationship.type}:${relationship.sourceId}->${relationship.targetId}`
}

/**
 * Every relationship that feeds evidence into the item named here, keyed by
 * that item's id.
 *
 * Supports and Answers point from the evidence to what it evidences (Root ->
 * Claim, Harvest -> Question), so tracing backward means indexing them by
 * `targetId`. Derived From points the other way -- from the cultivated item
 * to its Seed -- so provenance still runs forward from `sourceId`. Either
 * way, the id this is indexed by is always the "later" end of the
 * relationship: the one whose provenance is being asked about.
 */
function backwardAdjacency(
  relationships: readonly GardenRelationship[],
): ReadonlyMap<string, readonly GardenRelationship[]> {
  const adjacency = new Map<string, GardenRelationship[]>()
  const add = (id: string, relationship: GardenRelationship) => {
    const forId = adjacency.get(id)
    if (forId) forId.push(relationship)
    else adjacency.set(id, [relationship])
  }

  for (const relationship of relationships) {
    if (relationship.type === 'supports' || relationship.type === 'answers') {
      add(relationship.targetId, relationship)
    } else if (relationship.type === 'derived_from') {
      add(relationship.sourceId, relationship)
    }
  }

  return adjacency
}

/** The upstream end of a relationship found through `backwardAdjacency`. */
function upstreamOf(relationship: GardenRelationship): string {
  return relationship.type === 'derived_from' ? relationship.targetId : relationship.sourceId
}

/**
 * Traces the complete provenance and evidence path to `selectedId`.
 *
 * One breadth-first walk backward through Supports, Answers, and Derived From
 * reaches every Root no matter how many items sit between it and the
 * selection -- the property ticket 09 asks for directly -- without also
 * reaching whatever else that Root happens to support. Contradicts is walked
 * separately and only one hop, because disagreement is a fact about the
 * selection, not a path to follow further.
 *
 * The queue is read with an index rather than `Array.shift()`, so this stays
 * linear in the size of the Garden's relationships rather than quadratic --
 * the same anti-quadratic care `describeCrossLinksByItem` takes in
 * GardenTree.tsx, for the same reason (ADR 0061).
 */
export function traceEvidence(index: GardenIndex, selectedId: string | undefined): EvidenceTrace {
  if (selectedId === undefined || !index.items.has(selectedId)) return NOTHING_TRACED

  const adjacency = backwardAdjacency(index.graph.relationships)
  const evidencePathIds = new Set<string>()
  const litEdges = new Set<string>()
  const visited = new Set<string>([selectedId])
  const queue: string[] = [selectedId]

  for (let at = 0; at < queue.length; at += 1) {
    const current = queue[at] as string

    for (const relationship of adjacency.get(current) ?? []) {
      litEdges.add(edgeKey(relationship))
      const other = upstreamOf(relationship)
      if (visited.has(other)) continue

      visited.add(other)
      evidencePathIds.add(other)
      queue.push(other)
    }
  }

  const contradictingIds = new Set<string>()
  for (const relationship of index.graph.relationships) {
    if (relationship.type !== 'contradicts') continue

    if (relationship.sourceId === selectedId) contradictingIds.add(relationship.targetId)
    else if (relationship.targetId === selectedId) contradictingIds.add(relationship.sourceId)
    else continue

    litEdges.add(edgeKey(relationship))
  }

  return { evidencePathIds, contradictingIds, litEdges }
}
