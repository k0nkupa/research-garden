/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import type { UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { Workspace } from './Workspace'

function countingEntropy(startAt = 1_700_000_000_000): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => startAt + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

/**
 * The full human-edit loop through the real Workspace (ticket 12): select an
 * item, edit its plain Markdown, save, see the change land, and undo it back.
 * The unit suites for `editItem`, `undoChange`, and `ItemPanel` each exercise
 * one seam in isolation; this is the one place that proves they are actually
 * wired together the way a person would use them.
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
  options: { now?: () => string; entropy?: UlidEntropy } = {},
) {
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  render(
    <Workspace
      garden={{ repositoryName: 'my-garden', index, fileSystem }}
      now={options.now}
      entropy={options.entropy}
    />,
  )
  return { fileSystem }
}

describe('editing an item end to end', () => {
  it('selects, edits, saves, and the Tree and panel reflect the new content', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))

    const editor = await screen.findByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Freshly cultivated body text.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(fileSystem.snapshot()['branches/attention.md']).toContain('Freshly cultivated body text.')
    expect(screen.getByText(/Freshly cultivated body text\./)).toBeInTheDocument()
  })

  it('moves updated_at and leaves created_at alone', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.type(editor, ' Extended.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    const written = fileSystem.snapshot()['branches/attention.md'] ?? ''
    expect(written).toContain(`created_at: ${CREATED}`)
    expect(written).not.toContain(`updated_at: ${CREATED}`)
  })

  it('offers Undo after a save, and Undo restores the exact previous file', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Changed for a moment.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

    const undoButton = await screen.findByRole('button', { name: /undo/i })
    await userEvent.click(undoButton)

    await waitFor(() => expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile))
  })

  it('records the edit in the Garden Activity feed without any raw body content', async () => {
    await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Body text that must never appear in Activity.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^activity/i }))

    const feed = screen.getByLabelText('Garden Activity')
    expect(within(feed).getByText(/Attention mechanisms/)).toBeInTheDocument()
    // ticket 12: the feed names "affected item IDs" specifically, not only a title.
    expect(within(feed).getByText(new RegExp(BRANCH))).toBeInTheDocument()
    expect(screen.queryByText(/must never appear in Activity/)).not.toBeInTheDocument()
  })

  // A no-op save (Edit, then Save without changing anything) must not move
  // updated_at (ADR 0077) or offer an Undo for a change that never happened.
  it('treats saving with no changes as a no-op: no file write, no Undo offered', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await screen.findByRole('textbox')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  })
})

describe('time and identity used by an edit', () => {
  it('uses the injected clock and entropy rather than real time and randomness', async () => {
    const { fileSystem } = await renderOpenWorkspace(
      { 'branches/attention.md': branchFile },
      { now: () => '2030-01-01T00:00:00Z', entropy: countingEntropy(1_900_000_000_000) },
    )

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.type(editor, ' Extended.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(fileSystem.snapshot()['branches/attention.md']).toContain('updated_at: 2030-01-01T00:00:00Z')
  })
})
