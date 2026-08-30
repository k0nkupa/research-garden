import { describe, expect, it } from 'vitest'
import { parseGardenDocument } from '../domain/document/gardenDocument'
import { searchGardenIndex } from '../domain/index/gardenSearch'
import { computeTreeLayout } from '../workspace/treeLayout'
import { UNFOCUSED, visibleTreeRows } from '../workspace/treeView'
import { PERFORMANCE_TARGET_ITEM_COUNT, PERFORMANCE_TARGET_RELATIONSHIP_COUNT } from '../domain/index/performanceTarget'
import { createItemIdFactory, type UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { approveChange } from '../garden/approveChange'
import { createGarden } from '../garden/createGarden'
import { openGarden, type OpenedGarden } from '../garden/openGarden'
import { proposeHarvest } from '../garden/proposalTools'
import { undoChange } from '../garden/undoChange'
import { createGardenToolBundles } from '../webmcp/gardenToolBundles'
import { createStateAwareToolRegistration, type ToolRegistrationState } from '../webmcp/stateAwareTools'
import type { ModelContextTool } from '../webmcp/modelContext'
import { generatePerformanceFixture } from '../garden/performanceFixture'
import { planFiles } from '../garden/createGarden'

const NOW = '2026-08-30T00:00:00Z'

function entropy(): UlidEntropy {
  let now = 0
  let byte = 0
  return {
    now: () => 1_700_000_000_000 + now++,
    randomBytes: (target) => target.map(() => byte++ % 256),
  }
}

async function opened(fileSystem: GardenFileSystem): Promise<OpenedGarden> {
  const result = await openGarden(fileSystem)
  if (result.kind !== 'opened') throw new Error(`expected an open Garden, got ${result.kind}`)
  return result.garden
}

async function sample() {
  const fileSystem = new InMemoryGardenFileSystem({}, 'acceptance-garden')
  const result = await createGarden(fileSystem, { entropy: entropy(), now: () => NOW })
  if (result.kind !== 'created') throw new Error(`expected Sample Garden creation, got ${result.kind}`)
  if (result.result.kind !== 'opened') throw new Error(`expected created Garden to open, got ${result.result.kind}`)
  return { fileSystem, garden: result.result.garden }
}

function findItem(garden: OpenedGarden, kind: string, title: RegExp) {
  const match = [...garden.index.items.values()].find(
    ({ item }) => item.kind === kind && title.test(item.title),
  )
  if (!match) throw new Error(`could not find ${kind} ${title}`)
  return match
}

const call = (tool: ModelContextTool, input: object) =>
  tool.execute(input, { signal: new AbortController().signal })

function directHarness(initial: OpenedGarden) {
  let garden = initial
  const activity: unknown[] = []
  let inspected: { id: string; previewHash: string } | undefined
  const registrations: { tool: ModelContextTool; signal: AbortSignal }[] = []
  const navigator = {
    modelContext: {
      registerTool: async (tool: ModelContextTool, options?: { signal?: AbortSignal }) => {
        registrations.push({ tool, signal: options?.signal ?? new AbortController().signal })
        return undefined
      },
    },
  }
  const runtime = {
    getGarden: () => garden,
    refreshGarden: async () => {
      garden = await opened(initial.fileSystem)
      return garden
    },
    recordActivity: (entry: unknown) => activity.push(entry),
    nextActivityId: () => `activity-${activity.length + 1}`,
    clock: () => NOW,
    now: () => NOW,
    entropy: entropy(),
    onInspect: (identity: { id: string; previewHash: string }) => { inspected = identity },
    getInspected: () => inspected,
    onMutation: () => { inspected = undefined },
  }
  const registration = createStateAwareToolRegistration(navigator, createGardenToolBundles(runtime))
  const update = (state: Partial<ToolRegistrationState> = {}) => registration.update({
    agentAccess: true,
    gardenOpen: true,
    selectedItemId: undefined,
    selectedItemKind: undefined,
    focusedBranchId: undefined,
    hasPendingChanges: false,
    ...state,
  })
  const active = (name: string) => {
    const entry = [...registrations].reverse().find(({ tool, signal }) => tool.name === name && !signal.aborted)
    if (!entry) throw new Error(`no active registration for ${name}`)
    return entry.tool
  }
  return { activity, get garden() { return garden }, registration, update, active, call }
}

describe('Ticket 25 risk-bearing acceptance scenarios', () => {
  it('creates a Sample Garden in an empty repository and leaves readable Markdown files', async () => {
    const { fileSystem, garden } = await sample()
    const files = fileSystem.snapshot()
    const canonical = Object.keys(files).filter((path) => path.endsWith('.md'))

    expect(canonical).toHaveLength(8)
    expect(canonical.every((path) => !path.startsWith('.research-garden/'))).toBe(true)
    expect(garden.index.diagnostics).toEqual([])
    expect(garden.index.items.size).toBe(8)
    expect(Object.keys(files)).toContain('seeds/something-i-read-about-the-10-000-hour-rule.md')
    expect(Object.keys(files).some((path) => path.startsWith('harvests/'))).toBe(false)
    for (const path of canonical) expect(parseGardenDocument(files[path] ?? '').ok).toBe(true)
  })

  it('runs the contradiction-to-Harvest cultivation loop through registered tools', async () => {
    const { fileSystem, garden } = await sample()
    const branch = findItem(garden, 'branch', /Deliberate practice/)
    const question = findItem(garden, 'question_leaf', /How much/)
    const harness = directHarness(garden)
    harness.update({ focusedBranchId: branch.item.id, selectedItemId: findItem(garden, 'claim_leaf', /Most of expertise/).item.id, selectedItemKind: 'claim_leaf' })

    const inspected = await harness.call(harness.active('inspect_garden'), {}) as { ok: true; data: { totalItems: number } }
    expect(inspected.data.totalItems).toBe(8)
    const contradictions = await harness.call(harness.active('find_contradictions'), {}) as {
      ok: true
      data: { pairs: readonly { claimA: { itemId: string }; claimB: { itemId: string }; supportingRootsA: readonly { itemId: string }[]; supportingRootsB: readonly { itemId: string }[] }[] }
    }
    expect(contradictions.data.pairs).toHaveLength(1)
    const pair = contradictions.data.pairs[0]!
    const trace = await harness.call(harness.active('trace_evidence'), { itemId: pair.claimA.itemId }) as {
      ok: true
      data: { evidencePathIds: readonly string[]; contradictingIds: readonly string[] }
    }
    expect(trace.data.evidencePathIds).toEqual(expect.arrayContaining(pair.supportingRootsA.map((root) => root.itemId)))
    expect(trace.data.contradictingIds).toContain(pair.claimB.itemId)

    const proposed = await harness.call(harness.active('propose_harvest'), {
      title: 'What deliberate practice can explain',
      parentId: branch.item.id,
      supportedBy: [...new Set([...pair.supportingRootsA, ...pair.supportingRootsB].map((root) => root.itemId))],
      claimIds: [pair.claimA.itemId, pair.claimB.itemId],
      questionId: question.item.id,
      question: 'How much does deliberate practice actually explain?',
      synthesis: 'Deliberate practice matters, but its explanatory contribution varies by domain.',
      evidence: 'Both preserved Roots are considered in this synthesis.',
      contradictionsAndUncertainty: 'The supported Claims disagree; the evidence does not justify choosing one as universally correct.',
      openQuestions: 'Which domain and measurement differences account for the disagreement?',
    }) as { ok: true; data: { id: string; itemId: string; previewHash: string } }
    expect(proposed.ok).toBe(true)
    expect(Object.keys(fileSystem.snapshot()).some((path) => path.startsWith('harvests/'))).toBe(false)

    harness.update({ focusedBranchId: branch.item.id, hasPendingChanges: true })
    expect(harness.registration.inspect().names).not.toContain('apply_pending_change')
    const listed = await harness.call(harness.active('list_pending_changes'), {}) as { ok: true; data: { changes: readonly { id: string }[] } }
    expect(listed.data.changes.map((change) => change.id)).toContain(proposed.data.id)
    const diff = await harness.call(harness.active('inspect_pending_change'), { id: proposed.data.id }) as {
      ok: true
      data: { id: string; previewHash: string; previewText: string }
    }
    expect(diff.data.previewHash).toBe(proposed.data.previewHash)
    expect(diff.data.previewText).toContain('## Contradictions and uncertainty')

    // Opening the exact diff updates the inspection identity, but the
    // registered surface changes only when the state update carries it.
    expect(harness.registration.inspect().names).not.toContain('apply_pending_change')
    harness.update({ focusedBranchId: branch.item.id, hasPendingChanges: true, inspectedChangeId: proposed.data.id })
    expect(harness.registration.inspect().names).toContain('apply_pending_change')
    const applied = await harness.call(harness.active('apply_pending_change'), { id: proposed.data.id, previewHash: diff.data.previewHash }) as {
      ok: true
      data: { itemId: string; snapshotId: string }
    }
    expect(applied.ok).toBe(true)

    const resulting = await opened(fileSystem)
    const harvest = resulting.index.items.get(applied.data.itemId)
    expect(harvest?.item.kind).toBe('harvest')
    expect(harvest?.item.kind === 'harvest' ? harvest.item.supportedBy : []).toEqual(expect.arrayContaining([...new Set([...pair.supportingRootsA, ...pair.supportingRootsB].map((root) => root.itemId))]))
    expect(harvest?.item.relations.some((relation) => relation.type === 'answers' && relation.target === question.item.id)).toBe(true)
    expect(harvest?.item.body).toContain('Claims considered:')
    expect(harvest?.item.body).toContain(pair.claimA.itemId)
    expect(harvest?.item.body).toContain(pair.claimB.itemId)
    expect(harvest?.item.body).toContain('The supported Claims disagree; the evidence does not justify choosing one as universally correct.')
    expect(harvest?.item.body).toContain('Contradicts relationship preserved')
    const resultingText = fileSystem.snapshot()[harvest?.path.join('/') ?? ''] ?? ''
    expect(parseGardenDocument(resultingText).ok).toBe(true)
    expect(resultingText).toContain('## Contradictions and uncertainty')
    expect(harness.activity.map((entry) => (entry as { action: string }).action)).toEqual(expect.arrayContaining([
      'inspect_garden', 'find_contradictions', 'trace_evidence', 'propose_harvest',
      'list_pending_changes', 'inspect_pending_change', 'approve_change',
    ]))
    harness.registration.disconnect()
    expect(harness.registration.inspect().names).toEqual([])
  })

  it('isolates one invalid Markdown file while retaining valid items and diagnostics', async () => {
    const { fileSystem } = await sample()
    await fileSystem.write(['branches', 'malformed.md'], '---\nid: not-a-valid-item\nkind: branch\n---\n')
    const garden = await opened(fileSystem)
    expect(garden.index.items.size).toBe(8)
    expect(garden.index.diagnostics.length).toBeGreaterThan(0)
    expect([...garden.index.items.values()].some(({ item }) => item.title === 'Deliberate practice')).toBe(true)
  })

  it('rejects a stale Harvest proposal without overwriting the newer file', async () => {
    const { fileSystem, garden } = await sample()
    const branch = findItem(garden, 'branch', /Deliberate practice/)
    const proposal = await proposeHarvest(fileSystem, {
      title: 'A stale Harvest', parentId: branch.item.id, supportedBy: [findItem(garden, 'root', /Ericsson/).item.id],
      question: 'What remains true?', synthesis: 'A synthesis.', evidence: 'The Root.',
      contradictionsAndUncertainty: 'Uncertainty remains.', openQuestions: 'More work.',
    }, { now: () => NOW, entropy: entropy() })
    if (proposal.kind !== 'proposed') throw new Error(`expected proposal, got ${proposal.kind}`)
    const newer = 'newer content written outside the proposal\n'
    await fileSystem.write(proposal.path, newer)
    const result = await approveChange(fileSystem, { id: proposal.id, previewHash: proposal.previewHash }, { now: () => NOW, entropy: entropy() })
    expect(result.kind).toBe('stale')
    expect(await fileSystem.read(proposal.path)).toBe(newer)
  })

  it('undoes an applied change only while its resulting file is unchanged', async () => {
    const applyHarvest = async (title: string) => {
      const { fileSystem, garden } = await sample()
      const branch = findItem(garden, 'branch', /Deliberate practice/)
      const proposal = await proposeHarvest(fileSystem, {
        title, parentId: branch.item.id, supportedBy: [findItem(garden, 'root', /Ericsson/).item.id],
        question: 'Question?', synthesis: 'Synthesis.', evidence: 'Evidence.',
        contradictionsAndUncertainty: 'Uncertainty.', openQuestions: 'Open.',
      }, { now: () => NOW, entropy: entropy() })
      if (proposal.kind !== 'proposed') throw new Error(`expected proposal, got ${proposal.kind}`)
      const applied = await approveChange(fileSystem, { id: proposal.id, previewHash: proposal.previewHash }, { now: () => NOW, entropy: entropy() })
      if (applied.kind !== 'applied') throw new Error(`expected applied, got ${applied.kind}`)
      return { fileSystem, applied }
    }

    const safe = await applyHarvest('Undoable Harvest')
    expect((await opened(safe.fileSystem)).index.items.has(safe.applied.itemId)).toBe(true)
    const restored = await undoChange(safe.fileSystem, { itemId: safe.applied.itemId, snapshotId: safe.applied.snapshotId }, { now: () => NOW, entropy: entropy() })
    expect(restored.kind).toBe('restored')
    expect((await opened(safe.fileSystem)).index.items.has(safe.applied.itemId)).toBe(false)

    const guarded = await applyHarvest('Guarded Harvest')
    const changedAfterApproval = 'edited outside Research Garden after approval\n'
    await guarded.fileSystem.write(guarded.applied.path, changedAfterApproval)
    const refused = await undoChange(guarded.fileSystem, { itemId: guarded.applied.itemId, snapshotId: guarded.applied.snapshotId }, { now: () => NOW, entropy: entropy() })
    expect(refused.kind).toBe('stale')
    expect(await guarded.fileSystem.read(guarded.applied.path)).toBe(changedAfterApproval)
  })

  it('returns a recoverable permission outcome when access lapses mid-session', async () => {
    const { fileSystem, garden } = await sample()
    fileSystem.revokePermission()
    const reopened = await openGarden(fileSystem)
    expect(reopened).toEqual({ kind: 'permission-required', repositoryName: 'acceptance-garden' })
    const branch = findItem(garden, 'branch', /Deliberate practice/)
    const proposal = await proposeHarvest(fileSystem, {
      title: 'Unavailable Harvest', parentId: branch.item.id, supportedBy: [findItem(garden, 'root', /Ericsson/).item.id],
      body: '## Question\n\nQuestion\n\n## Synthesis\n\nSynthesis\n\n## Evidence\n\nEvidence\n\n## Contradictions and uncertainty\n\nUncertainty\n\n## Open questions\n\nOpen\n',
    })
    expect(proposal.kind).toBe('permission-required')
  })

  it('opens and searches the complete 1,000-item / 5,000-relation acceptance fixture', async () => {
    const items = await generatePerformanceFixture({
      nextId: createItemIdFactory(entropy()), now: () => NOW,
      itemCount: PERFORMANCE_TARGET_ITEM_COUNT, relationshipCount: PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
    })
    const files = Object.fromEntries(planFiles(items).map(({ path, text }) => [path.join('/'), text]))
    const garden = await opened(new InMemoryGardenFileSystem(files, 'performance-acceptance'))
    expect(garden.index.items.size).toBe(PERFORMANCE_TARGET_ITEM_COUNT)
    expect(garden.index.graph.relationships.length).toBe(PERFORMANCE_TARGET_RELATIONSHIP_COUNT)
    expect(garden.index.diagnostics).toEqual([])

    const searchStarted = performance.now()
    const searchResults = searchGardenIndex(garden.index, 'Generated body for Branch 1.')
    const searchElapsedMs = performance.now() - searchStarted
    expect(searchResults.length).toBeGreaterThan(0)
    // A representative indexed search should remain comfortably interactive
    // on this acceptance fixture, with a 500ms upper budget.
    const searchBudgetMs = 500
    expect(searchElapsedMs).toBeLessThan(searchBudgetMs)

    const fullLayout = computeTreeLayout(garden.index, UNFOCUSED)
    const topLevelBranches = garden.index.topLevelIds.filter(
      (id) => garden.index.items.get(id)?.item.kind === 'branch',
    )
    const collapsedLayout = computeTreeLayout(garden.index, {
      collapsedIds: new Set(topLevelBranches),
      focusedId: undefined,
    })
    // Collapsing all top-level Branches bounds the rendered Tree workload to
    // below half the full fixture, rather than merely exercising a flag.
    const collapsedRows = visibleTreeRows(garden.index, { collapsedIds: new Set(topLevelBranches), focusedId: undefined })
    const collapsedWorkloadBound = garden.index.items.size / 2
    expect(collapsedRows.length).toBeLessThan(collapsedWorkloadBound)
    expect(collapsedLayout.nodes.length).toBeLessThan(fullLayout.nodes.length / 2)

    const focusedBranch = topLevelBranches[0]
    if (!focusedBranch) throw new Error('expected a top-level Branch in the performance fixture')
    const focusedLayout = computeTreeLayout(garden.index, { collapsedIds: new Set(), focusedId: focusedBranch })
    expect(focusedLayout.nodes.length).toBeLessThan(fullLayout.nodes.length / 2)
  }, 60_000)
})
