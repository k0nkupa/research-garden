/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { proposeChange } from '../garden/proposeChange'
import { Workspace } from './Workspace'

/**
 * The registration side of tickets 18-21: Connect turns the current tool
 * surface on and Disconnect turns it off, through the real Workspace. `readTool.test.ts`
 * and `coreReadTools.test.ts` already prove the tools themselves and the
 * registration call in isolation; this is the one place that proves
 * `agentAccess` flipping in the real component is actually what drives it.
 */

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
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

Original body text.
`

function grantWebMcp(registerTool: (tool: unknown, options?: unknown) => Promise<undefined>) {
  Object.defineProperty(navigator, 'modelContext', { value: { registerTool }, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'modelContext')
})

async function renderConnectedWorkspace(registerTool: (tool: unknown, options?: unknown) => Promise<undefined>) {
  grantWebMcp(registerTool)
  const files = { 'branches/attention.md': branchFile }
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} agentInterface="available" />)

  await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
  await userEvent.click(
    within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }),
  )
}

type ToolRegistrationCall = [{ name: string }, { signal: AbortSignal }]
type RegistrationMock = { mock: { calls: unknown[][] } }

const CORE_CONNECTED_NAMES = [
  'add_leaf',
  'audit_garden',
  'capture_root',
  'find_contradictions',
  'find_open_questions',
  'inspect_garden',
  'plant_seed',
  'prepare_source_comparison',
  'read_items',
  'search_garden',
  'undo_change',
] as const

const PENDING_CONNECTED_NAMES = [
  ...CORE_CONNECTED_NAMES,
  'list_pending_changes',
  'inspect_pending_change',
  'reject_pending_change',
] as const

function registeredNames(registerTool: RegistrationMock, from = 0): string[] {
  const calls = registerTool.mock.calls as ToolRegistrationCall[]
  return [...new Set(calls.slice(from).map(([tool]) => tool.name))].sort()
}

async function waitForRegisteredNames(registerTool: RegistrationMock, expected: readonly string[], from = 0) {
  await waitFor(() => expect(registeredNames(registerTool, from)).toEqual([...expected].sort()))
}

describe('while Agent Access is off', () => {
  it('registers no core read tool', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    grantWebMcp(registerTool)
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
    const index = await buildGardenIndex(
      Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
    )
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} agentInterface="available" />)

    expect(registerTool).not.toHaveBeenCalled()
  })
})

describe('connecting', () => {
  it('registers core, direct-addition, and garden-level research tools with one AbortSignal per bundle', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)

    await renderConnectedWorkspace(registerTool)

    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES)
    const calls = registerTool.mock.calls as [{ name: string }, { signal: AbortSignal }][]
    expect(registeredNames(registerTool)).toEqual([...CORE_CONNECTED_NAMES].sort())
    const signals = new Set(calls.map((call) => call[1].signal))
    expect(signals.size).toBe(4)
  })

  it('adds selected-item and focused-Branch research tools as the person navigates', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    await renderConnectedWorkspace(registerTool)
    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES)

    const branch = screen.getByRole('treeitem', { name: /Attention mechanisms/ })
    await userEvent.click(branch)
    await waitForRegisteredNames(registerTool, [...CORE_CONNECTED_NAMES, 'trace_evidence'])
    expect((registerTool.mock.calls as [{ name: string }][]).at(-1)?.[0].name).toBe('trace_evidence')

    branch.focus()
    await userEvent.keyboard('f')
    await waitForRegisteredNames(registerTool, [...CORE_CONNECTED_NAMES, 'trace_evidence', 'explore_branch'])
    expect((registerTool.mock.calls as [{ name: string }][]).at(-1)?.[0].name).toBe('explore_branch')
  })

  it('refreshes the visible Tree after a successful direct Seed tool write', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    await renderConnectedWorkspace(registerTool)
    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES)

    const plantSeed = (registerTool.mock.calls as [{ name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }][])
      .find(([tool]) => tool.name === 'plant_seed')?.[0]
    if (!plantSeed) throw new Error('expected plant_seed to be registered')

    const result = (await plantSeed.execute(
      { title: 'A newly planted Seed', body: 'Captured verbatim.' },
      { signal: new AbortController().signal },
    )) as { ok: boolean }
    expect(result.ok).toBe(true)
    await waitFor(() => expect(screen.getByText('A newly planted Seed')).toBeInTheDocument())
  })
})

describe('disconnecting', () => {
  it('aborts the signal the core read tools were registered with', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    await renderConnectedWorkspace(registerTool)
    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES)
    const [, options] = registerTool.mock.calls[0] as [unknown, { signal: AbortSignal }]

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))

    expect(options.signal.aborted).toBe(true)
  })

  it('registers a fresh set of tools -- and a fresh signal -- on reconnecting', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    await renderConnectedWorkspace(registerTool)
    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES)
    const [, firstOptions] = registerTool.mock.calls[0] as [unknown, { signal: AbortSignal }]
    const firstSessionEnd = registerTool.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(
      within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }),
    )

    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES, firstSessionEnd)
    const [, secondOptions] = registerTool.mock.calls[firstSessionEnd] as [unknown, { signal: AbortSignal }]
    expect(secondOptions.signal).not.toBe(firstOptions.signal)
    expect(secondOptions.signal.aborted).toBe(false)
  })

  it('clears the inspect gate on Disconnect and requires a fresh inspection after reconnect', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branchFile }, 'my-garden')
    const index = await buildGardenIndex([{ path: ['branches', 'attention.md'], text: branchFile }])
    const proposed = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      { now: () => CREATED },
    )
    if (proposed.kind !== 'proposed') throw new Error(`expected proposed, got ${proposed.kind}`)
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} agentInterface="available" />)
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }))
    await waitForRegisteredNames(registerTool, PENDING_CONNECTED_NAMES)

    const findTool = (name: string) => (registerTool.mock.calls as [{ name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }][])
      .find(([tool]) => tool.name === name)?.[0]
    const inspect = findTool('inspect_pending_change')
    if (!inspect) throw new Error('expected inspect_pending_change to be registered')
    await inspect.execute({ id: proposed.id }, { signal: new AbortController().signal })
    await waitForRegisteredNames(registerTool, [...PENDING_CONNECTED_NAMES, 'apply_pending_change'])
    expect(findTool('apply_pending_change')).toBeDefined()
    const secondSessionStart = registerTool.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }))
    await waitForRegisteredNames(registerTool, PENDING_CONNECTED_NAMES, secondSessionStart)
    const secondSessionNames = registeredNames(registerTool, secondSessionStart)
    expect(secondSessionNames).not.toContain('apply_pending_change')
    expect(secondSessionNames).toContain('undo_change')
  })
})

describe('calling a registered tool after a rescan', () => {
  it('reflects the current Garden, not the one held when the tool was registered', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    grantWebMcp(registerTool)
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
    const index = await buildGardenIndex(
      Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
    )
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} agentInterface="available" />)
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(
      within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }),
    )
    await waitForRegisteredNames(registerTool, CORE_CONNECTED_NAMES)
    const calls = registerTool.mock.calls as [{ name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }][]
    const inspectTool = calls.find((call) => call[0].name === 'inspect_garden')?.[0]
    if (!inspectTool) throw new Error('expected inspect_garden to be registered')

    const before = (await inspectTool.execute({}, { signal: new AbortController().signal })) as {
      data: { totalItems: number }
    }
    expect(before.data.totalItems).toBe(1)

    // A second Branch lands on disk after registration -- e.g. a person's own
    // edit in another tab. Only a rescan boundary (ADR 0053, here: window
    // focus) picks it up; the registered tool must see it without having been
    // torn down and re-registered.
    const SECOND = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0S1W'
    await fileSystem.write(
      ['branches', 'second.md'],
      `---\nschema_version: 1\nid: ${SECOND}\nkind: branch\ntitle: A second branch\nstate: active\ncreated_at: ${CREATED}\nupdated_at: ${CREATED}\n---\n\nAnother body.\n`,
    )
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(screen.getByText('A second branch')).toBeInTheDocument())

    const after = (await inspectTool.execute({}, { signal: new AbortController().signal })) as {
      data: { totalItems: number }
    }
    expect(after.data.totalItems).toBe(2)
  })
})
