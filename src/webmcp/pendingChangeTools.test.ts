import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { contentHash } from '../domain/hash'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import type { OpenedGarden } from '../garden/openGarden'
import { writePendingChange } from '../garden/pendingChange'
import { writeUndoSnapshot } from '../garden/undoSnapshot'
import {
  createPendingChangeTools,
  createPendingChangeToolsBundles,
  MAX_PENDING_CHANGES,
} from './pendingChangeTools'
import { createStateAwareToolRegistration } from './stateAwareTools'

const ITEM_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const NOW = '2026-08-30T01:00:00Z'
const BASE = `---\nschema_version: 1\nid: ${ITEM_ID}\nkind: branch\ntitle: Topic\nstate: active\ncreated_at: ${NOW}\nupdated_at: ${NOW}\n---\n\nOriginal.\n`
const PREVIEW = BASE.replace('Original.', 'Proposed.')

async function fixture(count = 1): Promise<{
  fileSystem: InMemoryGardenFileSystem
  garden: OpenedGarden
  activity: GardenActivityEntry[]
}> {
  const fileSystem = new InMemoryGardenFileSystem({ 'branches/topic.md': BASE }, 'garden')
  const records = await Promise.all(Array.from({ length: count }, async (_, index) => ({
    id: `change-${String(index).padStart(2, '0')}`,
    itemId: ITEM_ID,
    path: ['branches', 'topic.md'] as const,
    baseText: BASE,
    baseHash: await contentHash(BASE),
    previewText: PREVIEW,
    previewHash: await contentHash(PREVIEW),
    proposedAt: `2026-08-30T01:${String(index).padStart(2, '0')}:00Z`,
  })))
  for (const record of records) await writePendingChange(fileSystem, record)
  const index = await buildGardenIndex([{ path: ['branches', 'topic.md'], text: BASE }])
  const activity: GardenActivityEntry[] = []
  return { fileSystem, garden: { repositoryName: 'garden', fileSystem, index }, activity }
}

const call = (tool: { execute(input: object, options: { signal: AbortSignal }): Promise<unknown> }, input: object) =>
  tool.execute(input, { signal: new AbortController().signal })

describe('pending-change WebMCP tools', () => {
  it('returns a bounded identified list without exposing exact bodies', async () => {
    const { garden, activity } = await fixture(MAX_PENDING_CHANGES + 2)
    const tools = createPendingChangeTools({
      getGarden: () => garden,
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
    })
    const list = tools.find((tool) => tool.name === 'list_pending_changes')!

    const result = (await call(list, { limit: MAX_PENDING_CHANGES + 2 })) as {
      ok: true
      data: { changes: readonly Record<string, unknown>[]; total: number; truncated: boolean }
    }

    expect(result.ok).toBe(true)
    expect(result.data.changes).toHaveLength(MAX_PENDING_CHANGES)
    expect(result.data.total).toBe(MAX_PENDING_CHANGES + 2)
    expect(result.data.truncated).toBe(true)
    expect(result.data.changes[0]).toMatchObject({ id: 'change-00', itemId: ITEM_ID, previewHash: expect.stringMatching(/^sha256:/) })
    expect(result.data.changes[0]).not.toHaveProperty('baseText')
    expect(result.data.changes[0]).not.toHaveProperty('previewText')
    expect(activity[0]).toMatchObject({ action: 'list_pending_changes', outcome: 'success', itemIds: [] })
  })

  it('inspects one exact diff and reports the identity and preview hash', async () => {
    const { garden, activity } = await fixture()
    const refreshedIndex = await buildGardenIndex([{ path: ['branches', 'topic.md'], text: PREVIEW }])
    const refreshedGarden: OpenedGarden = { ...garden, index: refreshedIndex }
    let refreshed = 0
    let inspected: { id: string; previewHash: string } | undefined
    const tools = createPendingChangeTools({
      getGarden: () => garden,
      refreshGarden: async () => { refreshed += 1; return refreshedGarden },
      onInspect: (value) => { inspected = value },
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
    })
    const inspect = tools.find((tool) => tool.name === 'inspect_pending_change')!

    const result = (await call(inspect, { id: 'change-00' })) as {
      ok: true
      data: { id: string; baseText: string; previewText: string; previewHash: string }
      gardenRevision: string
    }

    expect(result.data).toMatchObject({ id: 'change-00', baseText: BASE, previewText: PREVIEW })
    expect(refreshed).toBe(1)
    expect(result.gardenRevision).toBe(refreshedIndex.revision)
    expect(inspected).toEqual({ id: 'change-00', previewHash: result.data.previewHash })
    expect(activity[0]).toMatchObject({ action: 'inspect_pending_change', outcome: 'success', itemIds: [ITEM_ID] })
  })

  it('separates the inspect-gated apply bundle and marks mutation tools for host confirmation', async () => {
    const { garden } = await fixture()
    const runtime = {
      getGarden: () => garden,
      recordActivity: () => {},
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
      getInspected: () => ({ id: 'change-00', previewHash: 'sha256:preview' }),
    }
    const bundles = createPendingChangeToolsBundles(runtime)
    expect(bundles.map((bundle) => bundle.id)).toEqual(['pending-changes', 'pending-undo', 'pending-apply'])
    expect(bundles[0]!.tools.map((tool) => tool.name)).toEqual([
      'list_pending_changes', 'inspect_pending_change', 'reject_pending_change',
    ])
    expect(bundles[1]!.tools.map((tool) => tool.name)).toEqual(['undo_change'])
    expect(bundles[2]!.tools.map((tool) => tool.name)).toEqual(['apply_pending_change'])
    expect(bundles[2]!.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: undefined, hasPendingChanges: true, inspectedChangeId: undefined })).toBe(false)
    expect(bundles[2]!.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: undefined, hasPendingChanges: true, inspectedChangeId: 'change-00' })).toBe(true)
    expect(bundles[0]!.tools.filter((tool) => ['reject_pending_change', 'undo_change'].includes(tool.name)).every((tool) => tool.annotations?.destructiveHint === true)).toBe(true)
    expect(bundles[1]!.tools[0]!.annotations?.destructiveHint).toBe(true)
    expect(bundles[2]!.tools[0]!.annotations?.destructiveHint).toBe(true)
  })

  it('registers apply only after the exact inspection identity is present', async () => {
    const { garden } = await fixture()
    const bundles = createPendingChangeToolsBundles({
      getGarden: () => garden,
      recordActivity: () => {},
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
      getInspected: () => undefined,
    })
    const registration = createStateAwareToolRegistration(undefined, bundles)
    const base = { agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: undefined, hasPendingChanges: true }
    registration.update({ ...base })
    expect(registration.inspect().names).toEqual(['list_pending_changes', 'inspect_pending_change', 'reject_pending_change', 'undo_change'])
    registration.update({ ...base, inspectedChangeId: 'change-00' })
    expect(registration.inspect().names).toContain('apply_pending_change')

    registration.update({ ...base, inspectedChangeId: undefined, hasPendingChanges: false })
    expect(registration.inspect().names).toEqual(['undo_change'])
  })

  it('refuses an apply request that was not for the inspected change', async () => {
    const { garden, fileSystem, activity } = await fixture()
    const apply = createPendingChangeToolsBundles({
      getGarden: () => garden,
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
      getInspected: () => ({ id: 'change-00', previewHash: 'sha256:the-inspected-preview' }),
    })[2]!.tools[0]!

    const result = (await call(apply, { id: 'change-00', previewHash: 'sha256:a-different-preview' })) as {
      ok: false
      error: { code: string }
    }
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'inspection' }) }))
    expect(fileSystem.snapshot()['branches/topic.md']).toBe(BASE)
    expect(activity[0]).toMatchObject({ action: 'approve_change', outcome: 'failure', itemIds: [ITEM_ID] })
  })

  it('does not open or apply a change whose recorded base hash does not match its exact base text', async () => {
    const { garden, fileSystem, activity } = await fixture()
    await writePendingChange(fileSystem, {
      id: 'change-00',
      itemId: ITEM_ID,
      path: ['branches', 'topic.md'],
      baseText: 'A different diff base.',
      baseHash: await contentHash(BASE),
      previewText: PREVIEW,
      previewHash: await contentHash(PREVIEW),
      proposedAt: NOW,
    })
    const tools = createPendingChangeTools({
      getGarden: () => garden,
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
    })
    const inspect = tools.find((tool) => tool.name === 'inspect_pending_change')!
    const result = (await call(inspect, { id: 'change-00' })) as { ok: boolean; error?: { code: string } }
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'inspection' }) }))
    expect(fileSystem.snapshot()['branches/topic.md']).toBe(BASE)
  })

  it('applies the inspected change through the shared action and records its snapshot', async () => {
    const { garden, fileSystem, activity } = await fixture()
    const previewHash = await contentHash(PREVIEW)
    const apply = createPendingChangeToolsBundles({
      getGarden: () => garden,
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
      getInspected: () => ({ id: 'change-00', previewHash }),
    })[2]!.tools[0]!

    const result = (await call(apply, { id: 'change-00', previewHash })) as {
      ok: boolean
      data?: { itemId: string; snapshotId: string }
    }
    expect(result.ok).toBe(true)
    expect(result.data?.itemId).toBe(ITEM_ID)
    expect(result.data?.snapshotId).toBeTruthy()
    expect(fileSystem.snapshot()['branches/topic.md']).toBe(PREVIEW)
    expect(activity[0]).toMatchObject({ action: 'approve_change', outcome: 'success', itemIds: [ITEM_ID] })
  })

  it('keeps the scoped Undo tool available after the last Pending Change is applied', async () => {
    const { garden } = await fixture()
    const bundles = createPendingChangeToolsBundles({
      getGarden: () => garden,
      recordActivity: () => {},
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
      getInspected: () => ({ id: 'change-00', previewHash: 'sha256:preview' }),
    })
    const registration = createStateAwareToolRegistration(undefined, bundles)
    registration.update({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: undefined, hasPendingChanges: true, inspectedChangeId: 'change-00' })
    expect(registration.inspect().names).toContain('undo_change')
    registration.update({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: undefined, hasPendingChanges: false, inspectedChangeId: undefined })
    expect(registration.inspect().names).toEqual(['undo_change'])
  })

  it('refreshes before list and preserves the fresh Garden Revision', async () => {
    const { garden } = await fixture()
    const refreshedIndex = await buildGardenIndex([{ path: ['branches', 'topic.md'], text: PREVIEW }])
    const refreshedGarden: OpenedGarden = { ...garden, index: refreshedIndex }
    let refreshed = 0
    const tools = createPendingChangeTools({
      getGarden: () => garden,
      refreshGarden: async () => { refreshed += 1; return refreshedGarden },
      recordActivity: () => {},
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
    })
    const list = tools.find((tool) => tool.name === 'list_pending_changes')!
    const result = (await call(list, {})) as { ok: true; gardenRevision: string }
    expect(refreshed).toBe(1)
    expect(result.gardenRevision).toBe(refreshedIndex.revision)
  })

  it('retains the identified item in Activity when apply discovers stale content', async () => {
    const { garden, fileSystem, activity } = await fixture()
    await fileSystem.write(['branches', 'topic.md'], BASE.replace('Original.', 'Newer.'))
    const refreshedIndex = await buildGardenIndex([{ path: ['branches', 'topic.md'], text: PREVIEW }])
    const refreshedGarden: OpenedGarden = { ...garden, index: refreshedIndex }
    const previewHash = await contentHash(PREVIEW)
    let refreshCount = 0
    const apply = createPendingChangeToolsBundles({
      getGarden: () => garden,
      refreshGarden: async () => { refreshCount += 1; return refreshedGarden },
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
      getInspected: () => ({ id: 'change-00', previewHash }),
    })[2]!.tools[0]!
    const result = (await call(apply, { id: 'change-00', previewHash })) as { ok: boolean; gardenRevision: string; error?: { code: string } }
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'staleness' }) }))
    expect(refreshCount).toBe(1)
    expect(result.gardenRevision).toBe(refreshedIndex.revision)
    expect(activity[0]).toMatchObject({ action: 'approve_change', outcome: 'failure', itemIds: [ITEM_ID] })
  })

  it('refreshes the Garden Revision when Undo refuses stale content', async () => {
    const { garden, fileSystem, activity } = await fixture()
    const previousHash = await contentHash(BASE)
    const resultingHash = await contentHash(PREVIEW)
    await writeUndoSnapshot(fileSystem, {
      id: 'snapshot-00',
      itemId: ITEM_ID,
      path: ['branches', 'topic.md'],
      previousState: 'present',
      previousText: BASE,
      previousHash,
      resultingHash,
      appliedAt: NOW,
    })
    const newer = PREVIEW.replace('Proposed.', 'Newer.')
    await fileSystem.write(['branches', 'topic.md'], newer)
    const refreshedIndex = await buildGardenIndex([{ path: ['branches', 'topic.md'], text: newer }])
    const refreshedGarden: OpenedGarden = { ...garden, index: refreshedIndex }
    let refreshCount = 0
    const undo = createPendingChangeToolsBundles({
      getGarden: () => garden,
      refreshGarden: async () => { refreshCount += 1; return refreshedGarden },
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
    })[1]!.tools[0]!

    const result = (await call(undo, { itemId: ITEM_ID, snapshotId: 'snapshot-00' })) as { ok: boolean; gardenRevision: string; error?: { code: string } }
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'staleness' }) }))
    expect(refreshCount).toBe(1)
    expect(result.gardenRevision).toBe(refreshedIndex.revision)
    expect(activity[0]).toMatchObject({ action: 'undo_change', outcome: 'failure', itemIds: [ITEM_ID] })
  })

  it('refreshes the Garden Revision when Undo cannot find its snapshot', async () => {
    const { garden, activity } = await fixture()
    const refreshedIndex = await buildGardenIndex([{ path: ['branches', 'topic.md'], text: PREVIEW }])
    const refreshedGarden: OpenedGarden = { ...garden, index: refreshedIndex }
    let refreshCount = 0
    const undo = createPendingChangeToolsBundles({
      getGarden: () => garden,
      refreshGarden: async () => { refreshCount += 1; return refreshedGarden },
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => NOW,
    })[1]!.tools[0]!

    const result = (await call(undo, { itemId: ITEM_ID, snapshotId: 'missing' })) as { ok: boolean; gardenRevision: string; error?: { code: string } }
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'lookup' }) }))
    expect(refreshCount).toBe(1)
    expect(result.gardenRevision).toBe(refreshedIndex.revision)
    expect(activity[0]).toMatchObject({ action: 'undo_change', outcome: 'failure', itemIds: [ITEM_ID] })
  })
})
