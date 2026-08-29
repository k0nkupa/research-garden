import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import type { OpenedGarden } from '../garden/openGarden'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import {
  createResearchTools,
  createResearchToolsBundles,
  MAX_RESEARCH_ITEMS,
} from './researchTools'

const U = (suffix: string) => `01HQ8X2K3M4N5P6Q7R8S9T0${suffix}W`
const SEED = `seed_${U('S1')}`
const BRANCH = `branch_${U('B1')}`
const ROOT_A = `root_${U('A1')}`
const ROOT_B = `root_${U('B1')}`
const CLAIM_A = `claim_leaf_${U('C1')}`
const CLAIM_B = `claim_leaf_${U('C2')}`
const QUESTION = `question_leaf_${U('Q1')}`
const QUESTION_OPEN = `question_leaf_${U('Q2')}`
const HARVEST = `harvest_${U('H1')}`
const CREATED = '2026-08-01T10:00:00Z'

const body = (text: string) => `${text}\n`
const front = (lines: readonly string[], text: string) =>
  ['---', 'schema_version: 1', ...lines, `created_at: ${CREATED}`, `updated_at: ${CREATED}`, '---', '', text, ''].join('\n')

const files = [
  { path: ['seeds', 'capture.md'], text: front([`id: ${SEED}`, 'kind: seed', 'title: Original capture'], body('Seed body')) },
  { path: ['branches', 'topic.md'], text: front([`id: ${BRANCH}`, 'kind: branch', 'title: Topic', 'state: active', `relations:\n  - type: derived_from\n    target: ${SEED}`], body('Branch body')) },
  { path: ['roots', 'source-a.md'], text: front([`id: ${ROOT_A}`, 'kind: root', 'title: Source A', `origin_url: https://example.com/a`, `captured_at: ${CREATED}`, 'content_hash: sha256:a', `relations:\n  - type: derived_from\n    target: ${SEED}`], body('Evidence A')) },
  { path: ['roots', 'source-b.md'], text: front([`id: ${ROOT_B}`, 'kind: root', 'title: Source B', 'origin_url: https://example.com/b', `captured_at: ${CREATED}`, 'content_hash: sha256:b'], body('Evidence B')) },
  { path: ['leaves', 'claim-a.md'], text: front([`id: ${CLAIM_A}`, 'kind: claim_leaf', 'title: First claim', `parent_id: ${BRANCH}`, `supported_by:\n  - ${ROOT_A}`, `relations:\n  - type: contradicts\n    target: ${CLAIM_B}`], body('Claim A body')) },
  { path: ['leaves', 'claim-b.md'], text: front([`id: ${CLAIM_B}`, 'kind: claim_leaf', 'title: Second claim', `parent_id: ${BRANCH}`, `supported_by:\n  - ${ROOT_B}`], body('Claim B body')) },
  { path: ['leaves', 'question.md'], text: front([`id: ${QUESTION}`, 'kind: question_leaf', 'title: An open question', `parent_id: ${BRANCH}`], body('Question body')) },
  { path: ['leaves', 'question-open.md'], text: front([`id: ${QUESTION_OPEN}`, 'kind: question_leaf', 'title: A genuinely unanswered question', `parent_id: ${BRANCH}`], body('Unanswered question body')) },
  {
    path: ['harvests', 'answer.md'],
    text: front([`id: ${HARVEST}`, 'kind: harvest', 'title: Existing answer', `parent_id: ${BRANCH}`, `supported_by:\n  - ${ROOT_A}`, `relations:\n  - type: answers\n    target: ${QUESTION}`], ['## Question', 'q', '## Synthesis', 's', '## Evidence', 'e', '## Contradictions and uncertainty', 'c', '## Open questions', 'o'].join('\n\n')),
  },
]

async function garden(): Promise<OpenedGarden> {
  const index = await buildGardenIndex(files)
  expect(index.diagnostics).toEqual([])
  return { repositoryName: 'test-garden', index, fileSystem: undefined as never }
}

async function toolsAndActivity() {
  const opened = await garden()
  const activity: GardenActivityEntry[] = []
  const tools = createResearchTools({
    getGarden: () => opened,
    recordActivity: (entry) => activity.push(entry),
    nextActivityId: () => `activity-${activity.length + 1}`,
    clock: () => CREATED,
  })
  return { opened, activity, tools }
}

const PAGED_ROOT_IDS = Array.from({ length: MAX_RESEARCH_ITEMS + 2 }, (_, index) => `root_${U(String(index).padStart(2, '0'))}`)
const PAGED_CLAIM_A = {
  path: ['leaves', 'claim-paged.md'],
  text: front([
    `id: ${CLAIM_A}`,
    'kind: claim_leaf',
    'title: First claim',
    `parent_id: ${BRANCH}`,
    `supported_by:\n${PAGED_ROOT_IDS.map((id) => `  - ${id}`).join('\n')}`,
    `relations:\n  - type: contradicts\n    target: ${CLAIM_B}`,
  ], body('Claim A body')),
}
const PAGED_FILES = [
  ...files.filter((file) => file.path.join('/') !== 'leaves/claim-a.md'),
  PAGED_CLAIM_A,
  ...PAGED_ROOT_IDS.map((id, index) => ({
    path: ['roots', `paged-${index}.md`],
    text: front([
      `id: ${id}`,
      'kind: root',
      `title: Paged source ${index}`,
      `origin_url: https://example.com/paged/${index}`,
      `captured_at: ${CREATED}`,
      `content_hash: sha256:${index}`,
    ], body(`Paged evidence ${index}`)),
  })),
]

function toolByName(tools: readonly { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }[], name: string) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`missing ${name}`)
  return tool
}

const call = (tool: { execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }, input: object) =>
  tool.execute(input, { signal: new AbortController().signal })

describe('ticket 21 research tools', () => {
  it('explores a Branch with descendants and bounded bodies', async () => {
    const { tools } = await toolsAndActivity()
    const result = (await call(toolByName(tools, 'explore_branch'), { branchId: BRANCH })) as { ok: true; data: { items: readonly { itemId: string }[]; truncated: boolean } }
    expect(result.ok).toBe(true)
    expect(result.data.items.map((item) => item.itemId)).toContain(CLAIM_A)
    expect(result.data.items.map((item) => item.itemId)).toContain(QUESTION)
    expect(result.data.truncated).toBe(false)
  })

  it('traces evidence to Roots and reports direct contradictions', async () => {
    const { tools } = await toolsAndActivity()
    const result = (await call(toolByName(tools, 'trace_evidence'), { itemId: CLAIM_A })) as { ok: true; data: { evidencePathIds: readonly string[]; contradictingIds: readonly string[] } }
    expect(result.data.evidencePathIds).toContain(ROOT_A)
    expect(result.data.evidencePathIds).not.toContain(ROOT_B)
    expect(result.data.contradictingIds).toEqual([CLAIM_B])
  })

  it('continues bounded evidence and contradiction pages with an offset', async () => {
    const index = await buildGardenIndex(PAGED_FILES)
    expect(index.diagnostics).toEqual([])
    const opened: OpenedGarden = { repositoryName: 'paged-garden', index, fileSystem: undefined as never }
    const tools = createResearchTools({
      getGarden: () => opened,
      recordActivity: () => {},
      nextActivityId: () => 'activity-1',
      clock: () => CREATED,
    })
    const trace = toolByName(tools, 'trace_evidence')
    const first = (await call(trace, { itemId: CLAIM_A })) as {
      ok: true
      data: {
        evidencePathIds: readonly string[]
        offset: number
        nextOffset: number | null
        hasMore: boolean
        totalEvidencePathItems: number
      }
    }
    expect(first.data.evidencePathIds).toHaveLength(MAX_RESEARCH_ITEMS)
    expect(first.data.offset).toBe(0)
    expect(first.data.nextOffset).toBe(MAX_RESEARCH_ITEMS)
    expect(first.data.hasMore).toBe(true)
    expect(first.data.totalEvidencePathItems).toBe(MAX_RESEARCH_ITEMS + 2)

    const second = (await call(trace, { itemId: CLAIM_A, offset: first.data.nextOffset })) as {
      ok: true
      data: { evidencePathIds: readonly string[]; offset: number; nextOffset: number | null; hasMore: boolean }
    }
    expect(second.data.evidencePathIds).toHaveLength(2)
    expect(second.data.offset).toBe(MAX_RESEARCH_ITEMS)
    expect(second.data.nextOffset).toBeNull()
    expect(second.data.hasMore).toBe(false)
    expect(new Set([...first.data.evidencePathIds, ...second.data.evidencePathIds]).size).toBe(MAX_RESEARCH_ITEMS + 2)
  })

  it('finds only unanswered Question Leaves', async () => {
    const { tools } = await toolsAndActivity()
    const result = (await call(toolByName(tools, 'find_open_questions'), {})) as { ok: true; data: { questions: readonly { itemId: string }[] } }
    expect(result.data.questions.map((item) => item.itemId)).toEqual([QUESTION_OPEN])
  })

  it('finds contradiction pairs with supporting Roots', async () => {
    const { tools } = await toolsAndActivity()
    const result = (await call(toolByName(tools, 'find_contradictions'), {})) as { ok: true; data: { pairs: readonly { claimA: { itemId: string }; claimB: { itemId: string }; supportingRootsA: readonly { itemId: string }[] }[] } }
    expect(result.data.pairs).toHaveLength(1)
    expect(result.data.pairs[0]?.claimA.itemId).toBe(CLAIM_A)
    expect(result.data.pairs[0]?.claimB.itemId).toBe(CLAIM_B)
    expect(result.data.pairs[0]?.supportingRootsA[0]?.itemId).toBe(ROOT_A)
  })

  it('prepares a source comparison without mutating the Garden', async () => {
    const { opened, tools } = await toolsAndActivity()
    const before = opened.index.revision
    const result = (await call(toolByName(tools, 'prepare_source_comparison'), { rootIds: [ROOT_A, ROOT_B] })) as { ok: true; data: { rootIds: readonly string[]; comparisonPrompts: readonly string[] }; gardenRevision: string }
    expect(result.data.rootIds).toEqual([ROOT_A, ROOT_B])
    expect(result.data.comparisonPrompts.length).toBeGreaterThan(0)
    expect(result.gardenRevision).toBe(before)
  })

  it('prepares Seed cultivation while preserving the Seed body', async () => {
    const { tools } = await toolsAndActivity()
    const result = (await call(toolByName(tools, 'prepare_seed_cultivation'), { seedId: SEED })) as { ok: true; data: { seed: { body: string }; existingCultivation: readonly { itemId: string }[] } }
    expect(result.data.seed.body).toContain('Seed body')
    expect(result.data.existingCultivation.map((item) => item.itemId)).toContain(BRANCH)
  })

  it('uses read-only and untrusted annotations, and records every call in Activity', async () => {
    const { tools, activity } = await toolsAndActivity()
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
      await call(tool, tool.name === 'explore_branch' ? { branchId: BRANCH } : tool.name === 'trace_evidence' ? { itemId: CLAIM_A } : tool.name === 'prepare_source_comparison' ? { rootIds: [ROOT_A, ROOT_B] } : tool.name === 'prepare_seed_cultivation' ? { seedId: SEED } : {})
    }
    expect(activity).toHaveLength(6)
    expect(activity.map((entry) => entry.action)).toEqual([
      'explore_branch',
      'trace_evidence',
      'find_open_questions',
      'find_contradictions',
      'prepare_source_comparison',
      'prepare_seed_cultivation',
    ])
  })

  it('exports bundles whose availability follows focused Branch and selected item state', async () => {
    const { opened } = await toolsAndActivity()
    const runtime = { getGarden: () => opened, recordActivity: () => {}, nextActivityId: () => 'id', clock: () => CREATED }
    const bundles = createResearchToolsBundles(runtime)
    expect(bundles.find((bundle) => bundle.id === 'research-focused-branch')?.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: BRANCH, hasPendingChanges: false })).toBe(true)
    expect(bundles.find((bundle) => bundle.id === 'research-selected-item')?.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: CLAIM_A, selectedItemKind: 'claim_leaf', focusedBranchId: undefined, hasPendingChanges: false })).toBe(true)
    expect(bundles.find((bundle) => bundle.id === 'research-selected-seed')?.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: CLAIM_A, selectedItemKind: 'claim_leaf', focusedBranchId: undefined, hasPendingChanges: false })).toBe(false)
    expect(bundles.find((bundle) => bundle.id === 'research-selected-seed')?.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: 'seed-1', selectedItemKind: 'seed', focusedBranchId: undefined, hasPendingChanges: false })).toBe(true)
  })
})
