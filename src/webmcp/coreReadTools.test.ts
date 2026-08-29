import { describe, expect, it, vi } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import type { OpenedGarden } from '../garden/openGarden'
import { registerCoreReadTools } from './coreReadTools'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const CREATED = '2026-08-01T10:00:00Z'
const branchFile = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention mechanisms
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

A body.
`

async function gardenWith(files: Record<string, string>): Promise<OpenedGarden> {
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  return { repositoryName: 'my-garden', index, fileSystem: undefined as never }
}

function runtimeFor(garden: OpenedGarden) {
  return {
    getGarden: () => garden,
    recordActivity: () => {},
    nextActivityId: () => 'entry-1',
    clock: () => CREATED,
  }
}

describe('registerCoreReadTools', () => {
  it('registers all four core read tools, each with the given signal', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const registerTool = vi.fn().mockResolvedValue(undefined)
    const controller = new AbortController()

    await registerCoreReadTools({ modelContext: { registerTool } }, runtimeFor(garden), controller.signal)

    expect(registerTool).toHaveBeenCalledTimes(4)
    const calls = registerTool.mock.calls as [{ name: string }, { signal: AbortSignal }][]
    const registeredNames = calls.map((call) => call[0].name).sort()
    expect(registeredNames).toEqual(['audit_garden', 'inspect_garden', 'read_items', 'search_garden'])
    for (const call of calls) {
      expect(call[1].signal).toBe(controller.signal)
    }
  })

  it('does nothing when WebMCP is not present', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })

    await expect(
      registerCoreReadTools({}, runtimeFor(garden), new AbortController().signal),
    ).resolves.toBeUndefined()
  })
})
