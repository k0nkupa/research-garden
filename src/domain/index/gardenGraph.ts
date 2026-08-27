import type { GardenPath } from '../../filesystem/GardenFileSystem'
import type { GardenItem, ValidationProblem } from '../schema/gardenItem'
import { RELATION_FIELD, isPermittedPairing, isSymmetricRelation, type RelationType } from '../schema/relations'
import type { GardenDiagnostic } from './gardenIndex'

/**
 * The Garden's relationship graph, resolved across every item.
 *
 * Every check on a relationship lives here, because almost none of them can be
 * made from one file alone and splitting them would mean two places deciding
 * what an edge is. Whether a relationship names something that exists, whether
 * the two kinds it joins can legitimately be joined, and whether Parent
 * placement is acyclic all need the whole Garden in hand (ADR 0079).
 *
 * ADR 0021 is the other half: inverse relationships are derived here and never
 * written into a second file. Each domain relationship is stored once, in its
 * canonical direction, alongside the item whose file actually declared it --
 * which for Supports is the Claim or Harvest, not the Root (ADR 0020).
 */

export interface GardenRelationship {
  readonly type: RelationType
  /** The canonical direction, regardless of which file carries the fact. */
  readonly sourceId: string
  readonly targetId: string
  /** The item whose file declares this relationship. */
  readonly declaredOn: string
}

export interface GardenGraph {
  readonly relationships: readonly GardenRelationship[]
  readonly diagnostics: readonly GardenDiagnostic[]
  /** Items whose Parent placement was refused, so the Tree can still show them. */
  readonly unplacedIds: ReadonlySet<string>
  /** ADR 0015: a Seed that has produced something, derived rather than stored. */
  readonly cultivatedSeedIds: ReadonlySet<string>
}

export interface GraphSubject {
  readonly item: GardenItem
  readonly path: GardenPath
}

interface DeclaredEdge {
  readonly type: RelationType
  readonly sourceId: string
  readonly targetId: string
  readonly declaredOn: string
}

/** The frontmatter field that carries a relation, for pointing a Diagnostic at it. */
const fieldFor = (type: RelationType) => RELATION_FIELD[type]

/**
 * Reads every relationship an item declares, in its canonical direction.
 *
 * `supported_by` inverts: the Claim's file declares it, but the relationship
 * runs Root -> Claim. Storing it canonically means one representation of one
 * fact, however it happened to be serialized (ADR 0020).
 */
function declaredEdges(item: GardenItem): readonly DeclaredEdge[] {
  const edges: DeclaredEdge[] = []

  if (item.parentId !== undefined) {
    edges.push({ type: 'parent', sourceId: item.id, targetId: item.parentId, declaredOn: item.id })
  }

  if (item.kind === 'claim_leaf' || item.kind === 'harvest') {
    for (const rootId of item.supportedBy) {
      edges.push({ type: 'supports', sourceId: rootId, targetId: item.id, declaredOn: item.id })
    }
  }

  for (const relation of item.relations) {
    edges.push({
      type: relation.type,
      sourceId: item.id,
      targetId: relation.target,
      declaredOn: item.id,
    })
  }

  return edges
}

/**
 * The identity of a relationship, independent of how it was written.
 *
 * A symmetric relation is the same fact whichever side declares it, so its key
 * ignores direction. That is what lets a Garden where both Claims name each
 * other resolve to the one contradiction it describes.
 */
function relationshipKey(edge: DeclaredEdge): string {
  const ends = isSymmetricRelation(edge.type)
    ? [edge.sourceId, edge.targetId].sort()
    : [edge.sourceId, edge.targetId]

  return `${edge.type}:${ends.join('->')}`
}

export function buildGardenGraph(subjects: ReadonlyMap<string, GraphSubject>): GardenGraph {
  const relationships: GardenRelationship[] = []
  const diagnostics: GardenDiagnostic[] = []
  const unplacedIds = new Set<string>()
  const seenKeys = new Set<string>()

  const report = (id: string, problem: ValidationProblem) => {
    // The graph only ever reports on items it was given, so the subject is
    // always present. Defaulting a missing path would key the Diagnostic on the
    // empty string and silently merge unrelated files.
    const subject = subjects.get(id)
    if (subject === undefined) return

    diagnostics.push({
      path: subject.path,
      itemId: id,
      title: subject.item.title,
      problems: [problem],
    })
  }

  for (const { item } of subjects.values()) {
    const declaredHere = new Set<string>()

    for (const edge of declaredEdges(item)) {
      const field = fieldFor(edge.type)
      const refuse = (message: string) => {
        report(edge.declaredOn, { field, message })
        if (edge.type === 'parent') unplacedIds.add(item.id)
      }

      // ADR 0079: nothing relates to itself.
      if (edge.sourceId === edge.targetId) {
        refuse(`must not point at itself (${edge.type})`)
        continue
      }

      const key = relationshipKey(edge)

      // ADR 0079: the same relationship written twice in one file is a mistake,
      // and worth saying so, because the person wrote it twice.
      if (declaredHere.has(key)) {
        refuse(`repeats the same ${edge.type} relationship to ${edge.targetId}`)
        continue
      }
      declaredHere.add(key)

      const source = subjects.get(edge.sourceId)
      const target = subjects.get(edge.targetId)
      if (source === undefined || target === undefined) {
        const missing = source === undefined ? edge.sourceId : edge.targetId
        refuse(`names ${missing}, which is not an item in this Garden`)
        continue
      }

      if (!isPermittedPairing(edge.type, source.item.kind, target.item.kind)) {
        refuse(`cannot join a ${source.item.kind} to a ${target.item.kind} with ${edge.type}`)
        continue
      }

      /*
       * A symmetric relation stated by both sides is one fact stated twice, and
       * both statements are true. It is redundant rather than wrong, so the
       * second is absorbed silently: ADR 0021 constrains what Research Garden
       * writes, not what a person may have written by hand. Keeping it once is
       * what makes the Tree draw one Cross-link rather than two.
       */
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      relationships.push({
        type: edge.type,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        declaredOn: edge.declaredOn,
      })
    }
  }

  // ADR 0079: Parent placement must be acyclic, because it is what determines
  // the Tree. Non-parent Cross-links may cycle freely; they place nothing.
  for (const id of parentCycleMembers(subjects, unplacedIds)) {
    unplacedIds.add(id)
    report(id, { field: 'parent_id', message: 'takes part in a cycle of Parent placements' })
  }

  const placed = relationships.filter(
    (relationship) => !(relationship.type === 'parent' && unplacedIds.has(relationship.sourceId)),
  )

  return {
    relationships: placed,
    diagnostics,
    unplacedIds,
    cultivatedSeedIds: new Set(
      placed
        .filter((relationship) => relationship.type === 'derived_from')
        .map((relationship) => relationship.targetId),
    ),
  }
}

/**
 * Every item standing on a cycle of Parent placements.
 *
 * Parent is single-valued, so each item has one ancestry to walk. Marking the
 * whole walk as settled afterwards keeps this linear, and reporting the slice
 * from the first repeat names every participant rather than an arbitrary one.
 * An item whose chain merely leads *into* a cycle is correctly left placed.
 */
function parentCycleMembers(
  subjects: ReadonlyMap<string, GraphSubject>,
  alreadyUnplaced: ReadonlySet<string>,
): ReadonlySet<string> {
  const onCycle = new Set<string>()
  const settled = new Set<string>()

  for (const id of subjects.keys()) {
    if (settled.has(id)) continue

    const walk: string[] = []
    const positionOf = new Map<string, number>()
    let current: string | undefined = id

    while (current !== undefined && !settled.has(current)) {
      const seenAt = positionOf.get(current)
      if (seenAt !== undefined) {
        for (const member of walk.slice(seenAt)) onCycle.add(member)
        break
      }

      positionOf.set(current, walk.length)
      walk.push(current)

      const parentId: string | undefined = subjects.get(current)?.item.parentId
      current = parentId !== undefined && !alreadyUnplaced.has(current) ? parentId : undefined
    }

    for (const member of walk) settled.add(member)
  }

  return onCycle
}

/** Ids on the other end of a relationship of one type, in either direction. */
export function neighboursOf(
  graph: GardenGraph,
  id: string,
  type: RelationType,
): readonly string[] {
  const found = new Set<string>()

  for (const relationship of graph.relationships) {
    if (relationship.type !== type) continue

    if (relationship.sourceId === id) found.add(relationship.targetId)
    // A symmetric Cross-link written on one side is true of both (ADR 0079).
    else if (relationship.targetId === id && isSymmetricRelation(type)) {
      found.add(relationship.sourceId)
    }
  }

  return [...found]
}

/** The inverse view, derived rather than stored: who points at this item. */
export function inboundOf(graph: GardenGraph, id: string, type: RelationType): readonly string[] {
  return graph.relationships
    .filter((relationship) => relationship.type === type && relationship.targetId === id)
    .map((relationship) => relationship.sourceId)
}
