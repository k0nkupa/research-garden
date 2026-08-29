import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import type { OpenedGarden } from '../garden/openGarden'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import { okEnvelope, type ToolEnvelope } from './envelope'
import { createReadTool, type ReadToolRuntime, type ReadToolSpec } from './readTool'

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
  const activity: GardenActivityEntry[] = []
  const runtime: ReadToolRuntime = {
    getGarden: () => garden,
    recordActivity: (entry) => activity.push(entry),
    nextActivityId: () => 'entry-1',
    clock: () => CREATED,
  }
  return { runtime, activity }
}

const EchoInput = z.strictObject({ itemId: z.string() })
type EchoInput = z.infer<typeof EchoInput>

const workingSpec: ReadToolSpec<EchoInput, { readonly seen: string }> = {
  name: 'echo_tool',
  description: 'Echoes the given itemId.',
  inputSchema: EchoInput,
  action: 'inspect_garden',
  run: (garden, input) => okEnvelope({ seen: input.itemId }, garden.index.revision),
  itemIdsFor: (input) => [input.itemId],
}

const throwingSpec: ReadToolSpec<EchoInput, { readonly seen: string }> = {
  ...workingSpec,
  run: (): ToolEnvelope<{ readonly seen: string }> => {
    throw new Error('a bug, carrying a fragment of file content that must never reach the caller')
  },
}

describe('createReadTool', () => {
  it('produces a read-only-annotated tool with the JSON Schema derived from the zod input schema', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime } = runtimeFor(garden)

    const tool = createReadTool({ ...workingSpec, annotations: { readOnlyHint: true } }, runtime)

    expect(tool.name).toBe('echo_tool')
    expect(tool.annotations?.readOnlyHint).toBe(true)
    expect(tool.inputSchema).toMatchObject({ type: 'object', required: ['itemId'] })
  })

  it('runs the spec and returns its envelope for valid input', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime } = runtimeFor(garden)
    const tool = createReadTool(workingSpec, runtime)

    const result = await tool.execute({ itemId: BRANCH }, { signal: new AbortController().signal })

    expect(result).toEqual({ ok: true, data: { seen: BRANCH }, gardenRevision: garden.index.revision, warnings: [] })
  })

  it('returns an inspection error for input that fails the schema, without calling run', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime } = runtimeFor(garden)
    const tool = createReadTool(workingSpec, runtime)

    const result = (await tool.execute({ itemId: 123 }, { signal: new AbortController().signal })) as {
      ok: boolean
      error?: { code: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('invalid-input')
  })

  it('rejects unexpected extra fields as an inspection error, since the schema is strict', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime } = runtimeFor(garden)
    const tool = createReadTool(workingSpec, runtime)

    const result = (await tool.execute(
      { itemId: BRANCH, somethingElse: true },
      { signal: new AbortController().signal },
    )) as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('invalid-input')
  })

  it('never throws, even when the underlying run function does -- and never leaks its message', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime } = runtimeFor(garden)
    const tool = createReadTool(throwingSpec, runtime)

    const result = (await tool.execute({ itemId: BRANCH }, { signal: new AbortController().signal })) as {
      ok: boolean
      error?: { code: string; message: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('internal')
    expect(result.error?.message).not.toContain('fragment of file content')
  })

  it('records exactly one Garden Activity entry per call, naming the action and the affected item IDs', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime, activity } = runtimeFor(garden)
    const tool = createReadTool(workingSpec, runtime)

    await tool.execute({ itemId: BRANCH }, { signal: new AbortController().signal })

    expect(activity).toHaveLength(1)
    expect(activity[0]).toMatchObject({ action: 'inspect_garden', itemIds: [BRANCH], outcome: 'success' })
  })

  it('records a failure outcome with a detail message, for a schema-rejected call', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime, activity } = runtimeFor(garden)
    const tool = createReadTool(workingSpec, runtime)

    await tool.execute({ itemId: 123 }, { signal: new AbortController().signal })

    expect(activity).toHaveLength(1)
    expect(activity[0]).toMatchObject({ itemIds: [], outcome: 'failure' })
    expect(activity[0]?.detail).toBeDefined()
  })

  it('carries no raw body content in the recorded Activity detail, even when run throws', async () => {
    const garden = await gardenWith({ 'branches/attention.md': branchFile })
    const { runtime, activity } = runtimeFor(garden)
    const tool = createReadTool(throwingSpec, runtime)

    await tool.execute({ itemId: BRANCH }, { signal: new AbortController().signal })

    expect(activity[0]?.detail).not.toContain('fragment of file content')
  })
})
