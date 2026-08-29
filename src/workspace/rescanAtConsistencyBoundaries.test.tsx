/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { Workspace } from './Workspace'

/**
 * Ticket 13: the Garden Repository is rescanned at explicit consistency
 * boundaries -- window focus, an explicit Refresh, and immediately before a
 * mutation -- and never on a timer (ADR 0053). `openGarden.test.ts` already
 * proves a rescan itself notices an external edit, addition, deletion, and
 * newly invalid content, and that it moves the Garden Revision. This file
 * proves the boundaries actually call it, through the real Workspace a person
 * uses, and that the "no polling" and "no disruption" halves of the ticket
 * hold under that wiring.
 */

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'
const CREATED = '2026-08-01T10:00:00Z'

const attentionFile = `---
schema_version: 1
id: ${ATTENTION}
kind: branch
title: Attention mechanisms
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

Original body text.
`

function optimisersFile(parentId?: string) {
  return `---
schema_version: 1
id: ${OPTIMISERS}
kind: branch
title: Optimisers
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
${parentId ? `parent_id: ${parentId}\n` : ''}---

What I am collecting about optimisers.
`
}

async function renderOpenWorkspace(files: Record<string, string>) {
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} />)
  return { fileSystem }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('rescanning on window focus', () => {
  it('reflects a file added outside Research Garden once the window regains focus', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': attentionFile })
    expect(screen.queryByRole('treeitem', { name: /Optimisers/ })).not.toBeInTheDocument()

    await fileSystem.write(['branches', 'optimisers.md'], optimisersFile())
    window.dispatchEvent(new Event('focus'))

    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: /Optimisers/ })).toBeInTheDocument(),
    )
  })
})

describe('the explicit Refresh control', () => {
  it('rescans on demand and picks up a file added outside Research Garden', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': attentionFile })

    await fileSystem.write(['branches', 'optimisers.md'], optimisersFile())
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: /Optimisers/ })).toBeInTheDocument(),
    )
  })

  it('shows a notice, without losing what is on screen, when the rescan itself fails', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': attentionFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    fileSystem.revokePermission()
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission/i))
    // The Tree a person was already looking at is untouched by the failed rescan.
    expect(screen.getByRole('treeitem', { name: /Attention mechanisms/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Attention mechanisms/ })).toBeInTheDocument()
  })
})

describe('no continuous polling', () => {
  it('does not rescan merely because time passes, with no focus, Refresh, or mutation', async () => {
    // Fake timers are installed before mount, not just before advancing: a
    // `setInterval` registered by an effect at mount would otherwise keep
    // running on the real clock underneath the fake one, and 30 simulated
    // minutes would prove nothing about it.
    vi.useFakeTimers()
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': attentionFile })
    const listFiles = vi.spyOn(fileSystem, 'listFiles')
    const read = vi.spyOn(fileSystem, 'read')

    await vi.advanceTimersByTimeAsync(30 * 60_000)

    expect(listFiles).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
})

describe('concurrent rescans', () => {
  // A rescan requested *because* something is about to depend on current
  // files -- the check right before a mutation, the reread right after one --
  // must never be handed an earlier scan's result just because that scan
  // happened to still be in flight: an earlier scan started before the
  // moment that matters and says nothing about it. This was tried once
  // (sharing one in-flight `Promise` across callers) and reverted for exactly
  // this reason during review.
  it('never lets a rescan already in flight stand in for one requested afterward', async () => {
    const real = new InMemoryGardenFileSystem(
      { 'branches/attention.md': attentionFile },
      'my-garden',
    )
    let releaseFirstScan: (() => void) | undefined
    let listFilesCalls = 0

    const gated = {
      repositoryName: real.repositoryName,
      permission: () => real.permission(),
      requestPermission: () => real.requestPermission(),
      read: (path: readonly string[]) => real.read(path),
      readBytes: (path: readonly string[]) => real.readBytes(path),
      write: (path: readonly string[], contents: string) => real.write(path, contents),
      delete: (path: readonly string[]) => real.delete(path),
      // Only the very first call blocks, so exactly one rescan is left in
      // flight while a second one is requested.
      listFiles: async (directory: readonly string[]) => {
        listFilesCalls += 1
        if (listFilesCalls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstScan = resolve
          })
        }
        return real.listFiles(directory)
      },
    }

    const index = await buildGardenIndex([
      { path: ['branches', 'attention.md'], text: attentionFile },
    ])
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem: gated }} />)

    // Leaves one rescan blocked mid-scan. (Not the Refresh button for the
    // second trigger below: it disables itself while a rescan is already in
    // flight, same as Undo already does while undoing -- reasonable, but it
    // would make this test about the button's own state rather than about
    // rescan independence. A second focus event is not gated by anything.)
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(listFilesCalls).toBeGreaterThan(0))

    // Requested while the first is still in flight: this must run its own
    // scan rather than waiting on, or receiving, the first's result.
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))

    await waitFor(() => expect(listFilesCalls).toBeGreaterThan(1))

    releaseFirstScan?.()
  })
})

describe('rescanning immediately before a mutation', () => {
  it('blocks a Save that a rescan reveals is no longer valid, and does not overwrite the file', async () => {
    const { fileSystem } = await renderOpenWorkspace({
      'branches/attention.md': attentionFile,
      'branches/optimisers.md': optimisersFile(ATTENTION),
    })

    await userEvent.click(screen.getByRole('treeitem', { name: /Optimisers/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.type(editor, ' A change that should never land.')

    // An external change to a *different* file: Optimisers' own file content
    // never moves, so `editItem`'s own hash check on the target file cannot
    // catch this by itself -- only a rescan that rebuilds the whole Garden's
    // Diagnostics (via the Parent relationship this file declares) can.
    fileSystem.remove(['branches', 'attention.md'])

    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/unresolved Garden Diagnostics/i),
    )
    expect(fileSystem.snapshot()['branches/optimisers.md']).toBe(optimisersFile(ATTENTION))
  })

  it('reflects an addition made since the last edit once Undo runs', async () => {
    const { fileSystem } = await renderOpenWorkspace({ 'branches/attention.md': attentionFile })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Changed for a moment.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

    await fileSystem.write(['branches', 'optimisers.md'], optimisersFile())
    await userEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() =>
      expect(fileSystem.snapshot()['branches/attention.md']).toBe(attentionFile),
    )
    // The write landing is not the same moment as the Tree reflecting it: the
    // post-restore rescan that picks up Optimisers runs after the write, in
    // its own render pass, so this needs its own `waitFor` rather than
    // assuming it has already settled by the line above.
    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: /Optimisers/ })).toBeInTheDocument(),
    )
  })
})

describe('a rescan that surfaces newly invalid content', () => {
  it('produces a Diagnostic for the broken file without disrupting an unrelated in-progress edit', async () => {
    const { fileSystem } = await renderOpenWorkspace({
      'branches/attention.md': attentionFile,
      'branches/optimisers.md': optimisersFile(),
    })

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.type(editor, ' A draft still being written.')

    // A hand edit to the *other* item, outside Research Garden, that breaks
    // the schema.
    await fileSystem.write(
      ['branches', 'optimisers.md'],
      optimisersFile().replace('kind: branch', 'kind: not-a-real-kind'),
    )
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /1 Diagnostic/i })).toBeInTheDocument(),
    )
    // The draft the person was mid-way through typing on the unrelated,
    // still-valid item survives the rescan untouched -- both the part that
    // was already there and the part just typed.
    const draft = (screen.getByRole('textbox') as HTMLTextAreaElement).value
    expect(draft).toContain('Original body text.')
    expect(draft).toContain('A draft still being written.')
  })
})
