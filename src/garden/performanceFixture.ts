import { contentHash } from '../domain/hash'
import {
  PERFORMANCE_TARGET_ITEM_COUNT,
  PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
} from '../domain/index/performanceTarget'
import { isSymmetricRelation, type RelationType } from '../domain/schema/relations'
import type { GardenItemKind } from '../domain/schema/itemIdentity'
import { REQUIRED_HARVEST_SECTIONS } from '../domain/schema/gardenItem'
import type { ItemIdFactory } from '../domain/schema/ulid'
import type { SampleItem } from './sampleGarden'

/**
 * The performance fixture (ticket 24, ADR 0061): a generated Garden large
 * enough to test against the challenge's stated target rather than a small
 * demo. Every item and relationship it produces is genuine, schema-valid,
 * graph-invariant-clean canonical Markdown -- the same `planFiles` a real
 * Create Garden uses turns this into real files, and `buildGardenIndex`
 * accepts it exactly as it would a person's own folder. Nothing about
 * indexing, search, or the Tree is allowed to special-case a fixture.
 *
 * Not the Sample Garden (CONTEXT.md): the Sample Garden is a small starter
 * Garden a person actually receives from Create Garden, materialized once,
 * by design demonstrable rather than large. This is a much bigger, purely
 * generated Garden that only ever exists inside a test run, to measure
 * against, never to show anyone.
 *
 * The target is `PERFORMANCE_TARGET_ITEM_COUNT` items and
 * `PERFORMANCE_TARGET_RELATIONSHIP_COUNT` relationships -- the same numbers
 * `performanceTarget.ts` uses to decide when a real Garden has grown past
 * them, imported from there rather than redeclared here, so the two can
 * never drift apart. Most of the relationship target is necessarily Relates
 * To: a Parent edge is bounded by the item count itself, and Supports/Derived
 * From/Answers/Contradicts are each narrower by kind pairing (ADR 0079) than
 * a fully general Cross-link is. Getting to the full count honestly means
 * leaning on the one relation with no such ceiling, not pretending an even
 * split across all six is realistic at this scale.
 *
 * Below the target, `pickEdges` (below) still guarantees every Claim Leaf and
 * Harvest cites at least one Root (ADR 0010) before anything else is padded,
 * which means a small requested item/relationship count can come back with
 * *more* relationships than asked for: that guaranteed baseline alone can
 * exceed a small `relationshipCount`. `performanceFixture.test.ts` asserts
 * this rather than hiding it.
 */

export interface PerformanceFixtureOptions {
  readonly nextId: ItemIdFactory
  /** An ISO 8601 UTC instant (ADR 0077); every item shares it. */
  readonly now: () => string
  readonly itemCount?: number
  readonly relationshipCount?: number
}

interface Edge {
  readonly type: RelationType
  readonly sourceIndex: number
  readonly targetIndex: number
}

/**
 * Every unordered (symmetric) or ordered (directional) pair, so no edge
 * repeats. Symmetry is read from `isSymmetricRelation` -- the one place
 * that fact is already recorded (ADR 0079) -- rather than passed in
 * separately by each caller, where a mismatched literal could silently
 * start emitting duplicate Cross-links.
 */
function edgeKey(type: RelationType, a: number, b: number): string {
  const pair = isSymmetricRelation(type) ? [a, b].sort((x, y) => x - y) : [a, b]
  return `${type}:${pair.join('-')}`
}

/**
 * Deterministically picks up to `count` distinct edges between two index
 * pools, skipping a source that would relate to itself and any pair already
 * used (by this call or an earlier one sharing `seen`). Striding rather than
 * drawing at random keeps the whole fixture reproducible from the same
 * `nextId`/`now` -- the point of a fixture is that a run today and a run next
 * month measure the same Garden.
 *
 * Requesting more edges than two pools this size could ever hold distinctly
 * is expected at a small scale (a quick test fixture, say) and simply
 * delivers as many as exist -- callers that need an exact count at the
 * challenge target (1,000 items) stay comfortably under this ceiling, which
 * `performanceFixture.test.ts` asserts directly rather than assuming.
 */
function pickEdges(
  type: RelationType,
  sources: readonly number[],
  targets: readonly number[],
  count: number,
  seen: Set<string>,
): Edge[] {
  const edges: Edge[] = []
  let step = 1
  let cursor = 0
  const maxAttempts = count * 50 + sources.length * targets.length

  for (let attempt = 0; edges.length < count && attempt < maxAttempts; attempt++) {
    const sourceIndex = sources[cursor % sources.length]!
    const targetIndex = targets[(cursor + step) % targets.length]!
    cursor++

    if (sourceIndex === targetIndex) continue
    const key = edgeKey(type, sourceIndex, targetIndex)
    if (seen.has(key)) {
      step++
      continue
    }

    seen.add(key)
    edges.push({ type, sourceIndex, targetIndex })
  }

  return edges
}

interface Plan {
  readonly seeds: number
  readonly roots: number
  readonly branches: number
  readonly topLevelBranches: number
  readonly claimLeaves: number
  readonly questionLeaves: number
  readonly ideaLeaves: number
  readonly observationLeaves: number
  readonly harvests: number
}

function planCounts(itemCount: number): Plan {
  const seeds = Math.round(itemCount * 0.1)
  const roots = Math.round(itemCount * 0.2)
  const branches = Math.round(itemCount * 0.15)
  const claimLeaves = Math.round(itemCount * 0.15)
  const questionLeaves = Math.round(itemCount * 0.1)
  const ideaLeaves = Math.round(itemCount * 0.1)
  const harvests = Math.round(itemCount * 0.15)
  const assigned = seeds + roots + branches + claimLeaves + questionLeaves + ideaLeaves + harvests
  // Whatever rounding left over lands on observation leaves, so the total is
  // exactly `itemCount` regardless of how `itemCount` divides.
  const observationLeaves = itemCount - assigned

  return {
    seeds,
    roots,
    branches,
    // A handful of top-level Branches root the forest; the rest nest under
    // an earlier one (ADR 0028), which is what keeps Parent placement
    // acyclic by construction.
    topLevelBranches: Math.max(1, Math.round(branches * 0.1)),
    claimLeaves,
    questionLeaves,
    ideaLeaves,
    observationLeaves,
    harvests,
  }
}

const EXCERPT =
  'A captured excerpt long enough to stand as real evidence rather than a placeholder, ' +
  'the kind of sentence an actual source would contain.'

function harvestBody(): string {
  return REQUIRED_HARVEST_SECTIONS.map((section) => `## ${section}\n\nGenerated for the performance fixture.\n`).join(
    '\n',
  )
}

/**
 * Generates the performance fixture: `PERFORMANCE_TARGET_ITEM_COUNT` items
 * (default) joined by `PERFORMANCE_TARGET_RELATIONSHIP_COUNT` relationships
 * (default), every one schema-valid and graph-invariant-clean. Pass smaller
 * counts to build a quick fixture for a fast test; the default counts are
 * what ticket 24's own measurements run against.
 */
export async function generatePerformanceFixture(
  options: PerformanceFixtureOptions,
): Promise<readonly SampleItem[]> {
  const { nextId, now } = options
  const itemCount = options.itemCount ?? PERFORMANCE_TARGET_ITEM_COUNT
  const relationshipCount = options.relationshipCount ?? PERFORMANCE_TARGET_RELATIONSHIP_COUNT
  const plan = planCounts(itemCount)
  const createdAt = now()
  const timestamps = { created_at: createdAt, updated_at: createdAt }

  interface Draft {
    readonly index: number
    readonly id: string
    readonly kind: GardenItemKind
    readonly title: string
    parentId: string | undefined
    readonly supportedBy: string[]
    readonly relations: { type: RelationType; target: string }[]
  }

  const drafts: Draft[] = []
  const byKind: Record<GardenItemKind, number[]> = {
    seed: [],
    root: [],
    branch: [],
    claim_leaf: [],
    question_leaf: [],
    idea_leaf: [],
    observation_leaf: [],
    harvest: [],
  }

  function add(kind: GardenItemKind, title: string): number {
    const index = drafts.length
    drafts.push({
      index,
      id: nextId(kind),
      kind,
      title,
      parentId: undefined,
      supportedBy: [],
      relations: [],
    })
    byKind[kind].push(index)
    return index
  }

  for (let i = 0; i < plan.seeds; i++) add('seed', `Seed ${i + 1}`)
  for (let i = 0; i < plan.roots; i++) add('root', `Root ${i + 1}`)
  for (let i = 0; i < plan.branches; i++) add('branch', `Branch ${i + 1}`)
  for (let i = 0; i < plan.claimLeaves; i++) add('claim_leaf', `Claim ${i + 1}`)
  for (let i = 0; i < plan.questionLeaves; i++) add('question_leaf', `Question ${i + 1}`)
  for (let i = 0; i < plan.ideaLeaves; i++) add('idea_leaf', `Idea ${i + 1}`)
  for (let i = 0; i < plan.observationLeaves; i++) add('observation_leaf', `Observation ${i + 1}`)
  for (let i = 0; i < plan.harvests; i++) add('harvest', `Harvest ${i + 1}`)

  // Parent placement (ADR 0028): every Branch past the first `topLevelBranches`
  // nests under an *earlier* Branch, and every Leaf/Harvest nests under some
  // Branch. Pointing only backward in generation order makes a cycle
  // structurally impossible, so this needs no separate acyclicity check.
  const branchIndices = byKind.branch
  for (let i = plan.topLevelBranches; i < branchIndices.length; i++) {
    const child = drafts[branchIndices[i]!]!
    const parent = drafts[branchIndices[i % plan.topLevelBranches]!]!
    child.parentId = parent.id
  }

  const placeable = [...byKind.claim_leaf, ...byKind.question_leaf, ...byKind.idea_leaf, ...byKind.observation_leaf, ...byKind.harvest]
  for (const [position, index] of placeable.entries()) {
    const parent = drafts[branchIndices[position % branchIndices.length]!]!
    drafts[index]!.parentId = parent.id
  }

  const parentEdgeCount =
    branchIndices.length - plan.topLevelBranches + placeable.length

  // Supports (ADR 0010): every Claim Leaf and Harvest cites at least one
  // Root, guaranteed by a full pass before any padding, since the schema
  // refuses one with none.
  const supportsSeen = new Set<string>()
  const claimsAndHarvests = [...byKind.claim_leaf, ...byKind.harvest]
  for (const [position, index] of claimsAndHarvests.entries()) {
    const rootIndex = byKind.root[position % byKind.root.length]!
    drafts[index]!.supportedBy.push(drafts[rootIndex]!.id)
    // Same argument order `pickEdges` below uses (source = claim/harvest,
    // target = root), so its padding can never re-pick this exact pair.
    supportsSeen.add(edgeKey('supports', index, rootIndex))
  }

  // These four targets scale with the item count, not the requested
  // relationship count: how many Claims cite extra evidence, or how many
  // Harvests answer a Question, is a property of how much knowledge exists,
  // not of how cross-referenced the caller asked the fixture to be. At the
  // default 1,000-item scale these reproduce the exact figures the module
  // docstring's math is built on (600/300/80/60); `pickEdges` delivers fewer
  // without complaint if a smaller fixture's pools cannot hold that many
  // distinct pairs.
  const scale = itemCount / PERFORMANCE_TARGET_ITEM_COUNT
  const additionalSupportsTarget = Math.max(0, Math.round(600 * scale) - claimsAndHarvests.length)
  const additionalSupports = pickEdges(
    'supports',
    claimsAndHarvests,
    byKind.root,
    additionalSupportsTarget,
    supportsSeen,
  )
  for (const edge of additionalSupports) {
    drafts[edge.sourceIndex]!.supportedBy.push(drafts[edge.targetIndex]!.id)
  }
  const supportsEdgeCount = claimsAndHarvests.length + additionalSupports.length

  // Everything else is optional by schema, so it is generated purely to
  // reach the relationship target, distributed across the remaining
  // relation types before Relates To absorbs whatever is left.
  const cultivated = drafts.filter((draft) => draft.kind !== 'seed').map((draft) => draft.index)
  const derivedFromTarget = Math.min(Math.round(300 * scale), cultivated.length)
  const answersTarget = Math.min(Math.round(80 * scale), byKind.harvest.length, byKind.question_leaf.length)
  const contradictsTarget = Math.min(Math.round(60 * scale), Math.floor(byKind.claim_leaf.length / 2))

  const seen = new Set<string>()
  const derivedFromEdges = pickEdges('derived_from', cultivated, byKind.seed, derivedFromTarget, seen)
  const answersEdges = pickEdges('answers', byKind.harvest, byKind.question_leaf, answersTarget, seen)
  const contradictsEdges = pickEdges('contradicts', byKind.claim_leaf, byKind.claim_leaf, contradictsTarget, seen)

  const allIndices = drafts.map((draft) => draft.index)
  const fixedSoFar =
    parentEdgeCount +
    supportsEdgeCount +
    derivedFromEdges.length +
    answersEdges.length +
    contradictsEdges.length
  const relatesToTarget = Math.max(0, relationshipCount - fixedSoFar)
  const relatesToEdges = pickEdges('relates_to', allIndices, allIndices, relatesToTarget, seen)

  for (const edge of [...derivedFromEdges, ...answersEdges, ...contradictsEdges, ...relatesToEdges]) {
    drafts[edge.sourceIndex]!.relations.push({ type: edge.type, target: drafts[edge.targetIndex]!.id })
  }

  const items: SampleItem[] = []
  for (const draft of drafts) {
    const frontmatter: Record<string, unknown> = {
      schema_version: 1,
      id: draft.id,
      kind: draft.kind,
      title: draft.title,
      ...(draft.parentId ? { parent_id: draft.parentId } : {}),
      ...(draft.relations.length > 0 ? { relations: draft.relations } : {}),
      ...timestamps,
    }

    let body = `Generated body for ${draft.title}.\n`

    if (draft.kind === 'branch') frontmatter['state'] = 'active'

    if (draft.kind === 'root') {
      frontmatter['captured_at'] = createdAt
      frontmatter['content_hash'] = await contentHash(EXCERPT)
      body = `${EXCERPT}\n`
    }

    if (draft.kind === 'claim_leaf' || draft.kind === 'harvest') {
      frontmatter['supported_by'] = draft.supportedBy
    }

    if (draft.kind === 'harvest') body = harvestBody()

    items.push({ id: draft.id, kind: draft.kind, title: draft.title, frontmatter, body })
  }

  return items
}
