import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeDirectoryHandle } from '../filesystem/fakeDirectoryHandle'
import { App } from './App'

/**
 * The tracer, end to end: a person chooses Open Garden, picks a folder, and
 * sees the Branch it contains in the Tree; selecting it opens the content.
 *
 * This drives the real picker path, the real File System Access adapter, the
 * real document model, schema, index, layout, and renderer. Only the browser's
 * directory handle is faked.
 */

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'

function branchFile(id: string, title: string, body: string, parentId?: string) {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
${parentId ? `parent_id: ${parentId}\n` : ''}---

${body}
`
}

const oneBranchGarden = {
  'branches/attention.md': branchFile(
    ATTENTION,
    'Attention mechanisms',
    'What I am collecting about attention.',
  ),
}

function supportedDesktop() {
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
}

function pickerReturning(handle: FakeDirectoryHandle | Error) {
  const picker = vi.fn(async () => {
    if (handle instanceof Error) throw handle
    return handle
  })
  Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true })
  return picker
}

afterEach(() => {
  Reflect.deleteProperty(window, 'showDirectoryPicker')
})

describe('opening a Garden from the bare trunk', () => {
  it('shows the Branch it found in the Tree', async () => {
    supportedDesktop()
    pickerReturning(FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(
      await screen.findByRole('treeitem', { name: /Attention mechanisms/ }),
    ).toBeInTheDocument()
  })

  it('names the folder that was opened', async () => {
    supportedDesktop()
    pickerReturning(FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(await screen.findByText('my-garden')).toBeInTheDocument()
  })

  it('opens the item’s content when its node is selected', async () => {
    supportedDesktop()
    pickerReturning(FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))
    await userEvent.click(await screen.findByRole('treeitem', { name: /Attention mechanisms/ }))

    expect(screen.getByRole('complementary')).toHaveTextContent(
      'What I am collecting about attention.',
    )
  })

  it('shows a nested Branch beneath its parent', async () => {
    supportedDesktop()
    pickerReturning(
      FakeDirectoryHandle.fromFiles(
        {
          ...oneBranchGarden,
          'branches/optimisers.md': branchFile(OPTIMISERS, 'Optimisers', 'Nested.', ATTENTION),
        },
        'my-garden',
      ),
    )
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(await screen.findByRole('treeitem', { name: /Optimisers/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
  })

  it('opens an empty folder as an empty Garden', async () => {
    supportedDesktop()
    pickerReturning(FakeDirectoryHandle.fromFiles({}, 'empty-garden'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(await screen.findByRole('tree')).toBeInTheDocument()
    expect(screen.queryAllByRole('treeitem')).toEqual([])
  })

  it('stays on the bare trunk when the person dismisses the picker', async () => {
    supportedDesktop()
    const abort = new Error('dismissed')
    abort.name = 'AbortError'
    pickerReturning(abort)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open garden/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
  })

  it('reports a folder it could not open without leaving the bare trunk', async () => {
    supportedDesktop()
    pickerReturning(new Error('something went wrong'))
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open garden/i })).toBeInTheDocument()
  })
})

// "Losing folder permission mid-operation produces a clear recoverable state
// rather than a crash or a partially executed action."
describe('when permission for the chosen folder has lapsed', () => {
  it('offers a way back rather than failing', async () => {
    supportedDesktop()
    const handle = FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden')
    handle.setPermission('denied')
    pickerReturning(handle)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(await screen.findByRole('button', { name: /grant access again/i })).toBeInTheDocument()
  })

  it('names the folder whose permission lapsed', async () => {
    supportedDesktop()
    const handle = FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden')
    handle.setPermission('denied')
    pickerReturning(handle)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(await screen.findByText('my-garden')).toBeInTheDocument()
  })

  it('shows no Tree, because nothing was read', async () => {
    supportedDesktop()
    const handle = FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden')
    handle.setPermission('denied')
    pickerReturning(handle)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))
    await screen.findByRole('button', { name: /grant access again/i })

    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
  })

  it('opens the Garden once access is granted again', async () => {
    supportedDesktop()
    const handle = FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden')
    handle.setPermission('denied')
    pickerReturning(handle)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))
    const retry = await screen.findByRole('button', { name: /grant access again/i })

    handle.setPermission('granted')
    await userEvent.click(retry)

    expect(
      await screen.findByRole('treeitem', { name: /Attention mechanisms/ }),
    ).toBeInTheDocument()
  })

  it('lets the person choose a different folder instead', async () => {
    supportedDesktop()
    const handle = FakeDirectoryHandle.fromFiles(oneBranchGarden, 'my-garden')
    handle.setPermission('denied')
    pickerReturning(handle)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))
    await userEvent.click(await screen.findByRole('button', { name: /different folder/i }))

    expect(screen.getByRole('button', { name: /open garden/i })).toBeInTheDocument()
  })
})
