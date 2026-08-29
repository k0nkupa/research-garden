import { z } from 'zod'
import type { GardenItemKind } from '../domain/schema/gardenItem'
import { inboundOf } from '../domain/index/gardenGraph'
import type { IndexedItem } from '../domain/index/gardenIndex'
import type { OpenedGarden } from '../garden/openGarden'
import { traceEvidence } from '../workspace/evidenceTrace'
import { MAX_BODY_CHARS } from './readItems'
import { errorEnvelope, okEnvelope, type ToolEnvelope } from './envelope'
import { createReadTool, type ReadToolRuntime, type ReadToolSpec } from './readTool'
import type { StateAwareToolBundle } from './stateAwareTools'

/** The research surface is deliberately bounded, even when the Garden is not. */
export const MAX_RESEARCH_ITEMS = 25
export const MAX_RESEARCH_PAIRS = 10
export const MAX_COMPARISON_ROOTS = 5

export interface ResearchItem {
  readonly itemId: string
  readonly kind: GardenItemKind
  readonly title: string
  readonly parentId: string | undefined
  readonly originUrl: string | undefined
  readonly capturedAt: string | undefined
  readonly contentHash: string | undefined
  readonly attribution: string | undefined
  readonly body: string
  readonly bodyTruncated: boolean
  readonly bodyLength: number
}

interface BoundedItems {
  readonly items: readonly ResearchItem[]
  readonly truncated: boolean
  readonly totalItems: number
}

interface BoundedPage extends BoundedItems {
  readonly offset: number
  readonly nextOffset: number | null
}

function boundedItem(indexed: IndexedItem): ResearchItem {
  const body = indexed.item.body.slice(0, MAX_BODY_CHARS)
  const item = indexed.item
  return {
    itemId: indexed.item.id,
    kind: indexed.item.kind,
    title: indexed.item.title,
    parentId: indexed.item.parentId,
    originUrl: item.kind === 'root' ? item.originUrl : undefined,
    capturedAt: item.kind === 'root' ? item.capturedAt : undefined,
    contentHash: item.kind === 'root' ? item.contentHash : undefined,
    attribution: item.kind === 'root' ? item.attribution : undefined,
    body,
    bodyTruncated: body.length < indexed.item.body.length,
    bodyLength: indexed.item.body.length,
  }
}

function boundedItems(
  index: ReadonlyMap<string, IndexedItem>,
  ids: readonly string[],
  limit = MAX_RESEARCH_ITEMS,
  offset = 0,
): BoundedItems {
  const found = ids.flatMap((id) => {
    const indexed = index.get(id)
    return indexed ? [indexed] : []
  })
  const boundedLimit = Math.min(limit, MAX_RESEARCH_ITEMS)
  const limited = found.slice(offset, offset + boundedLimit)
  const items = limited.map(boundedItem)
  return {
    items,
    truncated: found.length > limited.length || items.some((item) => item.bodyTruncated),
    totalItems: found.length,
  }
}

function boundedPage(
  index: ReadonlyMap<string, IndexedItem>,
  ids: readonly string[],
  offset: number,
): BoundedPage {
  const page = boundedItems(index, ids, MAX_RESEARCH_ITEMS, offset)
  const nextOffset = offset + page.items.length < page.totalItems
    ? offset + page.items.length
    : null
  return { ...page, offset, nextOffset }
}

function boundedList(
  index: ReadonlyMap<string, IndexedItem>,
  ids: readonly string[],
  requestedLimit: number,
): { readonly data: BoundedItems; readonly warnings: readonly string[] } {
  const data = boundedItems(index, ids, requestedLimit)
  const warnings = requestedLimit > MAX_RESEARCH_ITEMS
    ? [`limit ${requestedLimit} exceeds the maximum of ${MAX_RESEARCH_ITEMS}; capped to ${MAX_RESEARCH_ITEMS}.`]
    : warningForTruncation(data.truncated)
  return { data, warnings }
}

function warningForTruncation(truncated: boolean): readonly string[] {
  return truncated ? [`Research output is bounded to ${MAX_RESEARCH_ITEMS} items and ${MAX_BODY_CHARS} characters per body.`] : []
}

function descendants(index: ReadonlyMap<string, IndexedItem>, branchId: string): readonly string[] {
  const result: string[] = [branchId]
  const queue: string[] = [branchId]
  for (let at = 0; at < queue.length; at += 1) {
    const current = queue[at] as string
    for (const childId of index.get(current)?.childIds ?? []) {
      result.push(childId)
      queue.push(childId)
    }
  }
  return result
}

function invalidBranch(garden: OpenedGarden, branchId: string): ToolEnvelope<never> | undefined {
  const item = garden.index.items.get(branchId)
  if (!item || item.item.kind !== 'branch') {
    return errorEnvelope('lookup', `Branch ${branchId} was not found in this Garden.`, garden.index.revision)
  }
  return undefined
}

export const ExploreBranchInput = z.strictObject({
  branchId: z.string(),
  limit: z.number().int().positive().optional(),
})
export type ExploreBranchInput = z.infer<typeof ExploreBranchInput>

export interface ExploreBranchData extends BoundedItems {
  readonly branchId: string
}

export function runExploreBranch(
  garden: OpenedGarden,
  input: ExploreBranchInput,
): ToolEnvelope<ExploreBranchData> {
  const failure = invalidBranch(garden, input.branchId)
  if (failure) return failure

  const allIds = descendants(garden.index.items, input.branchId)
  const requestedLimit = input.limit ?? MAX_RESEARCH_ITEMS
  const { data, warnings } = boundedList(garden.index.items, allIds, requestedLimit)
  return okEnvelope({ branchId: input.branchId, ...data }, garden.index.revision, warnings)
}

export const EXPLORE_BRANCH_SPEC: ReadToolSpec<ExploreBranchInput, ExploreBranchData> = {
  name: 'explore_branch',
  description: `Explores one Branch and its Tree descendants, returning bounded structure and content (at most ${MAX_RESEARCH_ITEMS} items and ${MAX_BODY_CHARS} body characters per item).`,
  inputSchema: ExploreBranchInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'explore_branch',
  run: runExploreBranch,
  itemIdsFor: (input) => [input.branchId],
}

export const TraceEvidenceInput = z.strictObject({
  itemId: z.string(),
  /** Continue both evidence and contradiction lists from this zero-based page offset. */
  offset: z.number().int().nonnegative().optional(),
})
export type TraceEvidenceInput = z.infer<typeof TraceEvidenceInput>

export interface TraceEvidenceData {
  readonly itemId: string
  readonly evidencePath: readonly ResearchItem[]
  readonly contradictingItems: readonly ResearchItem[]
  readonly evidencePathIds: readonly string[]
  readonly contradictingIds: readonly string[]
  readonly offset: number
  readonly nextOffset: number | null
  readonly hasMore: boolean
  readonly totalEvidencePathItems: number
  readonly totalContradictingItems: number
  readonly truncated: boolean
}

export function runTraceEvidence(
  garden: OpenedGarden,
  input: TraceEvidenceInput,
): ToolEnvelope<TraceEvidenceData> {
  if (!garden.index.items.has(input.itemId)) {
    return errorEnvelope('lookup', `Item ${input.itemId} was not found in this Garden.`, garden.index.revision)
  }

  const trace = traceEvidence(garden.index, input.itemId)
  const evidencePathIds = [...trace.evidencePathIds]
  const contradictingIds = [...trace.contradictingIds]
  const offset = input.offset ?? 0
  const evidence = boundedPage(garden.index.items, evidencePathIds, offset)
  const contradicting = boundedPage(garden.index.items, contradictingIds, offset)
  const boundedEvidencePathIds = evidence.items.map((item) => item.itemId)
  const boundedContradictingIds = contradicting.items.map((item) => item.itemId)
  const nextOffset = [evidence.nextOffset, contradicting.nextOffset].reduce<number | null>(
    (highest, candidate) => candidate === null ? highest : Math.max(highest ?? 0, candidate),
    null,
  )
  const hasMore = nextOffset !== null
  const truncated = evidence.truncated || contradicting.truncated
  return okEnvelope(
    {
      itemId: input.itemId,
      evidencePath: evidence.items,
      contradictingItems: contradicting.items,
      evidencePathIds: boundedEvidencePathIds,
      contradictingIds: boundedContradictingIds,
      offset,
      nextOffset,
      hasMore,
      totalEvidencePathItems: evidence.totalItems,
      totalContradictingItems: contradicting.totalItems,
      truncated,
    },
    garden.index.revision,
    warningForTruncation(truncated),
  )
}

export const TRACE_EVIDENCE_SPEC: ReadToolSpec<TraceEvidenceInput, TraceEvidenceData> = {
  name: 'trace_evidence',
  description: `Traces an item backward through Supports, Answers, and Derived From to its Roots, with bounded content and direct contradictions. Use offset to continue a page when hasMore is true.`,
  inputSchema: TraceEvidenceInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'trace_evidence',
  run: runTraceEvidence,
  itemIdsFor: (input) => [input.itemId],
}

export const FindOpenQuestionsInput = z.strictObject({
  branchId: z.string().optional(),
  limit: z.number().int().positive().optional(),
})
export type FindOpenQuestionsInput = z.infer<typeof FindOpenQuestionsInput>

export interface FindOpenQuestionsData extends BoundedItems {
  readonly questions: readonly ResearchItem[]
}

export function runFindOpenQuestions(
  garden: OpenedGarden,
  input: FindOpenQuestionsInput,
): ToolEnvelope<FindOpenQuestionsData> {
  if (input.branchId !== undefined) {
    const failure = invalidBranch(garden, input.branchId)
    if (failure) return failure
  }

  const ids = [...garden.index.items.values()]
    .filter(({ item }) => item.kind === 'question_leaf' && inboundOf(garden.index.graph, item.id, 'answers').length === 0)
    .filter(({ item }) => input.branchId === undefined || item.parentId === input.branchId)
    .map(({ item }) => item.id)
  const requestedLimit = input.limit ?? MAX_RESEARCH_ITEMS
  const { data, warnings } = boundedList(garden.index.items, ids, requestedLimit)
  return okEnvelope({ questions: data.items, ...data }, garden.index.revision, warnings)
}

export const FIND_OPEN_QUESTIONS_SPEC: ReadToolSpec<FindOpenQuestionsInput, FindOpenQuestionsData> = {
  name: 'find_open_questions',
  description: `Finds Question Leaves with no Harvest Answers relationship, optionally within one Branch, with bounded content.`,
  inputSchema: FindOpenQuestionsInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'find_open_questions',
  run: runFindOpenQuestions,
  itemIdsFor: (input) => (input.branchId === undefined ? [] : [input.branchId]),
}

export interface ContradictionPair {
  readonly claimA: ResearchItem
  readonly claimB: ResearchItem
  readonly supportingRootsA: readonly ResearchItem[]
  readonly supportingRootsB: readonly ResearchItem[]
  readonly supportingRootsATruncated: boolean
  readonly supportingRootsBTruncated: boolean
}

export const FindContradictionsInput = z.strictObject({
  branchId: z.string().optional(),
  limit: z.number().int().positive().optional(),
})
export type FindContradictionsInput = z.infer<typeof FindContradictionsInput>

export interface FindContradictionsData {
  readonly pairs: readonly ContradictionPair[]
  readonly totalPairs: number
  readonly supportingRootsTruncated: boolean
  readonly truncated: boolean
}

export function runFindContradictions(
  garden: OpenedGarden,
  input: FindContradictionsInput,
): ToolEnvelope<FindContradictionsData> {
  if (input.branchId !== undefined) {
    const failure = invalidBranch(garden, input.branchId)
    if (failure) return failure
  }

  const pairs: ContradictionPair[] = []
  const seen = new Set<string>()
  for (const relation of garden.index.graph.relationships) {
    if (relation.type !== 'contradicts') continue
    const key = [relation.sourceId, relation.targetId].sort().join(':')
    if (seen.has(key)) continue
    seen.add(key)
    const first = garden.index.items.get(relation.sourceId)
    const second = garden.index.items.get(relation.targetId)
    if (!first || !second || first.item.kind !== 'claim_leaf' || second.item.kind !== 'claim_leaf') continue
    if (input.branchId !== undefined && first.item.parentId !== input.branchId && second.item.parentId !== input.branchId) continue
    const rootsA = boundedItems(garden.index.items, inboundOf(garden.index.graph, first.item.id, 'supports'))
    const rootsB = boundedItems(garden.index.items, inboundOf(garden.index.graph, second.item.id, 'supports'))
    pairs.push({
      claimA: boundedItem(first),
      claimB: boundedItem(second),
      supportingRootsA: rootsA.items,
      supportingRootsB: rootsB.items,
      supportingRootsATruncated: rootsA.truncated,
      supportingRootsBTruncated: rootsB.truncated,
    })
  }

  const requestedLimit = input.limit ?? MAX_RESEARCH_PAIRS
  const limited = pairs.slice(0, Math.min(requestedLimit, MAX_RESEARCH_PAIRS))
  const supportingRootsTruncated = limited.some((pair) =>
    pair.supportingRootsATruncated || pair.supportingRootsBTruncated,
  )
  const truncated = pairs.length > limited.length || limited.some((pair) =>
    [...pair.supportingRootsA, ...pair.supportingRootsB, pair.claimA, pair.claimB].some((item) => item.bodyTruncated),
  ) || supportingRootsTruncated
  const warnings = [
    ...(requestedLimit > MAX_RESEARCH_PAIRS
      ? [`limit ${requestedLimit} exceeds the maximum of ${MAX_RESEARCH_PAIRS}; capped to ${MAX_RESEARCH_PAIRS}.`]
      : warningForTruncation(truncated)),
    ...(supportingRootsTruncated
      ? [`Supporting Roots are bounded to ${MAX_RESEARCH_ITEMS} items per Claim.`]
      : []),
  ]
  return okEnvelope({ pairs: limited, totalPairs: pairs.length, supportingRootsTruncated, truncated }, garden.index.revision, warnings)
}

export const FIND_CONTRADICTIONS_SPEC: ReadToolSpec<FindContradictionsInput, FindContradictionsData> = {
  name: 'find_contradictions',
  description: `Finds supported Claim Leaf pairs joined by Contradicts and includes each claim's supporting Roots, within read bounds.`,
  inputSchema: FindContradictionsInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'find_contradictions',
  run: runFindContradictions,
  itemIdsFor: () => [],
}

export const PrepareSourceComparisonInput = z.strictObject({
  rootIds: z.array(z.string()).min(2).max(MAX_COMPARISON_ROOTS),
})
export type PrepareSourceComparisonInput = z.infer<typeof PrepareSourceComparisonInput>

export interface PrepareSourceComparisonData {
  readonly roots: readonly ResearchItem[]
  readonly rootIds: readonly string[]
  readonly comparisonPrompts: readonly string[]
  readonly truncated: boolean
}

export function runPrepareSourceComparison(
  garden: OpenedGarden,
  input: PrepareSourceComparisonInput,
): ToolEnvelope<PrepareSourceComparisonData> {
  const roots = input.rootIds.map((id) => garden.index.items.get(id))
  if (roots.some((root) => !root || root.item.kind !== 'root')) {
    return errorEnvelope('lookup', 'Every requested source comparison item must be a Root present in this Garden.', garden.index.revision)
  }
  const data = boundedItems(garden.index.items, input.rootIds)
  const truncated = data.truncated
  return okEnvelope(
    {
      roots: data.items,
      rootIds: input.rootIds,
      comparisonPrompts: [
        'What does each Root claim or show?',
        'Where do the Roots agree, differ, or leave uncertainty?',
        'What context or limitations should a later Harvest preserve?',
      ],
      truncated,
    },
    garden.index.revision,
    warningForTruncation(truncated),
  )
}

export const PREPARE_SOURCE_COMPARISON_SPEC: ReadToolSpec<PrepareSourceComparisonInput, PrepareSourceComparisonData> = {
  name: 'prepare_source_comparison',
  description: `Prepares a bounded, read-only comparison starting point for two to ${MAX_COMPARISON_ROOTS} Roots without changing them.`,
  inputSchema: PrepareSourceComparisonInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'prepare_source_comparison',
  run: runPrepareSourceComparison,
  itemIdsFor: (input) => input.rootIds,
}

export const PrepareSeedCultivationInput = z.strictObject({ seedId: z.string() })
export type PrepareSeedCultivationInput = z.infer<typeof PrepareSeedCultivationInput>

export interface PrepareSeedCultivationData {
  readonly seed: ResearchItem
  readonly seedId: string
  readonly existingCultivation: readonly ResearchItem[]
  readonly suggestedNextSteps: readonly string[]
  readonly truncated: boolean
}

export function runPrepareSeedCultivation(
  garden: OpenedGarden,
  input: PrepareSeedCultivationInput,
): ToolEnvelope<PrepareSeedCultivationData> {
  const seed = garden.index.items.get(input.seedId)
  if (!seed || seed.item.kind !== 'seed') {
    return errorEnvelope('lookup', `Seed ${input.seedId} was not found in this Garden.`, garden.index.revision)
  }
  const derivedIds = garden.index.graph.relationships
    .filter((relation) => relation.type === 'derived_from' && relation.targetId === input.seedId)
    .map((relation) => relation.sourceId)
  const existing = boundedItems(garden.index.items, derivedIds)
  const truncated = existing.truncated || boundedItem(seed).bodyTruncated
  return okEnvelope(
    {
      seed: boundedItem(seed),
      seedId: input.seedId,
      existingCultivation: existing.items,
      suggestedNextSteps: ['Preserve the Seed body verbatim.', 'Inspect or capture supporting Roots.', 'Develop Claims, Questions, or a Harvest as separate items.'],
      truncated,
    },
    garden.index.revision,
    warningForTruncation(truncated),
  )
}

export const PREPARE_SEED_CULTIVATION_SPEC: ReadToolSpec<PrepareSeedCultivationInput, PrepareSeedCultivationData> = {
  name: 'prepare_seed_cultivation',
  description: `Prepares a bounded, read-only cultivation starting point for one Seed and never modifies the Seed.`,
  inputSchema: PrepareSeedCultivationInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'prepare_seed_cultivation',
  run: runPrepareSeedCultivation,
  itemIdsFor: (input) => [input.seedId],
}

export function createResearchTools(runtime: ReadToolRuntime) {
  return [
    createReadTool(EXPLORE_BRANCH_SPEC, runtime),
    createReadTool(TRACE_EVIDENCE_SPEC, runtime),
    createReadTool(FIND_OPEN_QUESTIONS_SPEC, runtime),
    createReadTool(FIND_CONTRADICTIONS_SPEC, runtime),
    createReadTool(PREPARE_SOURCE_COMPARISON_SPEC, runtime),
    createReadTool(PREPARE_SEED_CULTIVATION_SPEC, runtime),
  ] as const
}

export function createResearchToolsBundles(runtime: ReadToolRuntime): readonly StateAwareToolBundle[] {
  const tools = createResearchTools(runtime)
  const [explore, trace, openQuestions, contradictions, comparison, cultivation] = tools
  return [
    { id: 'research-focused-branch', tools: [explore], isRelevant: (state) => state.focusedBranchId !== undefined },
    { id: 'research-selected-item', tools: [trace], isRelevant: (state) => state.selectedItemId !== undefined },
    { id: 'research-selected-seed', tools: [cultivation], isRelevant: (state) => state.selectedItemKind === 'seed' },
    { id: 'research-garden', tools: [openQuestions, contradictions, comparison], isRelevant: () => true },
  ]
}
