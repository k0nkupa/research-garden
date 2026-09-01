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

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const branch = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention mechanisms
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

Collected evidence.
`

function useNarrowViewport() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
}

afterEach(() => Reflect.deleteProperty(window, 'matchMedia'))

describe('the narrow Garden workspace', () => {
  it('opens the Tree in a drawer and returns to the selected item after a choice', async () => {
    useNarrowViewport()
    const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branch }, 'my-garden')
    const index = await buildGardenIndex([{ path: ['branches', 'attention.md'], text: branch }])
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} />)

    const openTree = screen.getByRole('button', { name: /^tree$/i })
    expect(openTree).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(openTree)

    const drawer = screen.getByRole('dialog', { name: /garden tree/i })
    await userEvent.click(within(drawer).getByRole('treeitem', { name: /attention mechanisms/i }))

    expect(screen.getByRole('button', { name: /^tree$/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('complementary', { name: /selected item/i })).toHaveTextContent('Collected evidence.')
  })

  it('moves focus into narrow drawers and sheets, then restores it on Escape', async () => {
    useNarrowViewport()
    const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branch }, 'my-garden')
    const index = await buildGardenIndex([{ path: ['branches', 'attention.md'], text: branch }])
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} />)
    const user = userEvent.setup()

    const tree = screen.getByRole('button', { name: /^tree$/i })
    await user.click(tree)
    expect(screen.getByRole('button', { name: /close tree/i })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(tree).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: /garden tree/i })).not.toBeInTheDocument()

    const activity = screen.getByRole('button', { name: /^activity/i })
    await user.click(activity)
    expect(screen.getByRole('dialog', { name: /activity panel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^close$/i })).toHaveFocus()
    expect(document.querySelector('.workspace__bar')).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(activity).toHaveFocus()
  })

  it('restores focus after reviewing a narrow Change Tray proposal', async () => {
    useNarrowViewport()
    const fileSystem = new InMemoryGardenFileSystem({ 'branches/attention.md': branch }, 'my-garden')
    const index = await buildGardenIndex([{ path: ['branches', 'attention.md'], text: branch }])
    const proposed = await proposeChange(fileSystem, index, {
      itemId: BRANCH,
      baseText: branch,
      newBody: 'Proposed body.',
    }, { now: () => '2026-08-02T10:00:00Z' })
    expect(proposed.kind).toBe('proposed')
    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} />)
    const user = userEvent.setup()

    const trayEntry = await screen.findByRole('button', { name: /attention mechanisms/i })
    await user.click(trayEntry)
    expect(screen.getByRole('dialog', { name: /change panel/i })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /^tree$/i })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: /attention mechanisms/i }))
    await user.click(screen.getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(screen.getByText(/no changes to review/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^tree$/i })).toHaveFocus()
  })
})
