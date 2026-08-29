import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import type { OpenedGarden } from '../garden/openGarden'
import { createDirectAdditionTools, createDirectAdditionToolsBundle } from './directAdditionTools'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const CREATED = '2026-08-29T01:00:00Z'
const branchFile = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

Topic.
`

async function garden(): Promise<{ opened: OpenedGarden; fileSystem: InMemoryGardenFileSystem; activity: GardenActivityEntry[] }> {
  const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branchFile }, 'garden')
  const index = await buildGardenIndex([{ path: ['branches', 'attention.md'], text: branchFile }])
  const activity: GardenActivityEntry[] = []
  return {
    fileSystem,
    activity,
    opened: { repositoryName: 'garden', fileSystem, index },
  }
}

describe('registered direct-addition tools', () => {
  it('exposes stable names, JSON schemas, and untrusted-content annotations', async () => {
    const { opened, activity } = await garden()
    const tools = createDirectAdditionTools({
      getGarden: () => opened,
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => CREATED,
    })

    expect(tools.map((tool) => tool.name)).toEqual(['plant_seed', 'capture_root', 'add_leaf'])
    expect(tools.every((tool) => tool.annotations?.untrustedContentHint)).toBe(true)
    expect(tools[0]?.inputSchema).toMatchObject({ type: 'object', required: ['title', 'body'] })
  })

  it('executes a registered capture_root tool and returns the updated revision', async () => {
    const { opened, fileSystem, activity } = await garden()
    let refreshed = 0
    const tools = createDirectAdditionTools({
      getGarden: () => opened,
      refreshGarden: async () => { refreshed += 1 },
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => CREATED,
    })

    const capture = tools.find((tool) => tool.name === 'capture_root')!
    const result = (await capture.execute({
      title: 'Captured source',
      originUrl: 'https://example.com/source',
      excerpt: 'Exact excerpt supplied by the agent.',
    }, { signal: new AbortController().signal })) as { ok: boolean; data?: { item?: { kind: string } }; gardenRevision: string }

    expect(result.ok).toBe(true)
    expect(result.data?.item?.kind).toBe('root')
    expect(result.gardenRevision).not.toBe(opened.index.revision)
    expect(refreshed).toBe(1)
    expect(Object.keys(fileSystem.snapshot()).some((path) => path.startsWith('roots/'))).toBe(true)
    expect(activity).toHaveLength(1)
    expect(activity[0]).toMatchObject({ action: 'capture_root', outcome: 'success' })
  })

  it('returns a structured invalid-input envelope and records failure without throwing', async () => {
    const { opened, activity } = await garden()
    const tools = createDirectAdditionTools({
      getGarden: () => opened,
      recordActivity: (entry) => activity.push(entry),
      nextActivityId: () => 'activity-1',
      clock: () => CREATED,
    })

    const result = (await tools[0]!.execute({ title: '' }, { signal: new AbortController().signal })) as {
      ok: boolean
      error?: { code: string; retryable: boolean }
    }

    expect(result.ok).toBe(false)
    expect(result.error).toEqual({ code: 'invalid-input', message: expect.any(String), retryable: false })
    expect(activity[0]).toMatchObject({ action: 'plant_seed', outcome: 'failure', itemIds: [] })
  })

  it('is supplied as an always-relevant state-aware bundle', async () => {
    const { opened } = await garden()
    const bundle = createDirectAdditionToolsBundle({
      getGarden: () => opened,
      recordActivity: () => {},
      nextActivityId: () => 'activity-1',
      clock: () => CREATED,
    })

    expect(bundle.id).toBe('direct-additions')
    expect(bundle.tools.map((tool) => tool.name)).toEqual(['plant_seed', 'capture_root', 'add_leaf'])
    expect(bundle.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: undefined, hasPendingChanges: false })).toBe(true)
  })
})
