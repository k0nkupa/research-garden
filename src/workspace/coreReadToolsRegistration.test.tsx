/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { Workspace } from './Workspace'

/**
 * The registration side of ticket 18: Connect turns the four core read tools
 * on, Disconnect turns them off, through the real Workspace. `readTool.test.ts`
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
  it('registers all four core read tools, sharing one AbortSignal', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)

    await renderConnectedWorkspace(registerTool)

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4))
    const calls = registerTool.mock.calls as [{ name: string }, { signal: AbortSignal }][]
    const names = calls.map((call) => call[0].name).sort()
    expect(names).toEqual(['audit_garden', 'inspect_garden', 'read_items', 'search_garden'])
    const signals = new Set(calls.map((call) => call[1].signal))
    expect(signals.size).toBe(1)
  })
})

describe('disconnecting', () => {
  it('aborts the signal the core read tools were registered with', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    await renderConnectedWorkspace(registerTool)
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4))
    const [, options] = registerTool.mock.calls[0] as [unknown, { signal: AbortSignal }]

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))

    expect(options.signal.aborted).toBe(true)
  })

  it('registers a fresh set of tools -- and a fresh signal -- on reconnecting', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    await renderConnectedWorkspace(registerTool)
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4))
    const [, firstOptions] = registerTool.mock.calls[0] as [unknown, { signal: AbortSignal }]

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(
      within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }),
    )

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(8))
    const [, secondOptions] = registerTool.mock.calls[4] as [unknown, { signal: AbortSignal }]
    expect(secondOptions.signal).not.toBe(firstOptions.signal)
    expect(secondOptions.signal.aborted).toBe(false)
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
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(4))
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
