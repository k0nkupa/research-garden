/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { proposeChange } from '../garden/proposeChange'
import { Workspace } from './Workspace'

/**
 * The Connect/Disconnect lifecycle through the real Workspace (ADR 0081,
 * ADR 0082, ADR 0083, ticket 17). `AgentAccessPanel.test.tsx` exercises the
 * disclosure and notice in isolation; this is the one place that proves
 * Connect/Disconnect are actually wired to a session flag and to Garden
 * Activity the way a person would use them.
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

async function renderOpenWorkspace(
  files: Record<string, string>,
  options: { agentInterface?: 'available' | 'unsupported' | 'offline' } = {},
) {
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  render(
    <Workspace
      garden={{ repositoryName: 'my-garden', index, fileSystem }}
      agentInterface={options.agentInterface}
    />,
  )
  return { fileSystem, index }
}

describe('before connecting', () => {
  it('shows a Connect ChatGPT action in the workspace bar', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    expect(screen.getByRole('button', { name: /^connect chatgpt$/i })).toBeInTheDocument()
  })

  it('opens the disclosure without enabling Agent Access yet', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))

    const panel = screen.getByLabelText('Agent Access')
    expect(within(panel).getByRole('button', { name: /^enable agent access$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^disconnect chatgpt$/i })).not.toBeInTheDocument()
  })

  it('never starts connected -- a fresh mount is always human-only, even for a remembered folder', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    expect(screen.queryByRole('button', { name: /^disconnect chatgpt$/i })).not.toBeInTheDocument()
  })

  it('Cancel closes the disclosure without enabling Agent Access', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByLabelText('Agent Access')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^disconnect chatgpt$/i })).not.toBeInTheDocument()
  })
})

describe('connecting', () => {
  it('enables Agent Access and switches the bar to Disconnect ChatGPT', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))

    await userEvent.click(within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }))

    expect(screen.getByRole('button', { name: /^disconnect chatgpt$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^connect chatgpt$/i })).not.toBeInTheDocument()
  })

  it('records the connection in the Garden Activity feed', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }))

    await userEvent.click(screen.getByRole('button', { name: /^activity/i }))

    const feed = screen.getByLabelText('Garden Activity')
    expect(within(feed).getByText(/connect/i)).toBeInTheDocument()
    expect(within(feed).getByText(/succeeded/i)).toBeInTheDocument()
  })
})

describe('disconnecting', () => {
  async function connectFirst() {
    const rendered = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await userEvent.click(screen.getByRole('button', { name: /^connect chatgpt$/i }))
    await userEvent.click(within(screen.getByLabelText('Agent Access')).getByRole('button', { name: /^enable agent access$/i }))
    return rendered
  }

  it('is immediate -- one click both disconnects and shows what it cannot undo', async () => {
    await connectFirst()

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))

    expect(screen.getByRole('button', { name: /^connect chatgpt$/i })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Agent Access')).getByRole('status')).toHaveTextContent(
      /cannot be recalled/i,
    )
  })

  it('records the disconnection in the Garden Activity feed', async () => {
    await connectFirst()
    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))

    await userEvent.click(screen.getByRole('button', { name: /^activity/i }))

    const feed = screen.getByLabelText('Garden Activity')
    const disconnectEntry = within(feed).getByText(/disconnect/i).closest('li')
    if (!disconnectEntry) throw new Error('expected the Disconnect entry to be inside a list item')
    expect(within(disconnectEntry).getByText(/succeeded/i)).toBeInTheDocument()
  })

  it('leaves Pending Changes untouched -- disconnecting is not itself a mutation', async () => {
    const { fileSystem, index } = await connectFirst()
    // A real Pending Change, proposed directly against the same folder --
    // standing in for the agent tool ticket 22 will eventually wire to it,
    // the same way `changeTrayLifecycle.test.tsx` already does for ticket 14.
    const proposed = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      { now: () => CREATED },
    )
    if (proposed.kind !== 'proposed') throw new Error(`expected proposed, got ${proposed.kind}`)
    window.dispatchEvent(new Event('focus'))
    await screen.findByRole('region', { name: /change tray/i })

    await userEvent.click(screen.getByRole('button', { name: /^disconnect chatgpt$/i }))

    expect(screen.queryByText(/no changes to review/i)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /change tray/i })).getByText(/Attention mechanisms/)).toBeInTheDocument()
  })
})

describe('when WebMCP is not supported by this browser', () => {
  it('shows no Connect ChatGPT action at all', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile }, { agentInterface: 'unsupported' })

    expect(screen.queryByRole('button', { name: /connect chatgpt/i })).not.toBeInTheDocument()
  })
})

describe('when WebMCP is supported but this browser is offline', () => {
  it('shows Connect ChatGPT disabled, explaining why', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile }, { agentInterface: 'offline' })

    expect(screen.getByRole('button', { name: /^connect chatgpt$/i })).toBeDisabled()
  })
})
