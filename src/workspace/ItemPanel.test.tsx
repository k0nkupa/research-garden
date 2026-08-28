/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import type { EditItemResult } from '../garden/editItem'
import type { UndoChangeResult } from '../garden/undoChange'
import { ItemPanel } from './ItemPanel'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'

const branchFile = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention mechanisms
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

Original body text.
`

const rootFile = `---
schema_version: 1
id: ${ROOT}
kind: root
title: A captured paper
captured_at: 2026-08-01T09:00:00Z
content_hash: sha256:original
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

The captured excerpt.
`

async function renderPanel(options: {
  files?: Record<string, string>
  itemId?: string
  onSave?: (itemId: string, baseText: string, newBody: string) => Promise<EditItemResult>
  onUndo?: () => Promise<UndoChangeResult>
  undoAvailable?: boolean
} = {}) {
  const files = options.files ?? { 'branches/attention.md': branchFile }
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  const selected = index.items.get(options.itemId ?? BRANCH)

  render(
    <ItemPanel
      selected={selected}
      diagnostics={[]}
      fileSystem={fileSystem}
      onSave={options.onSave ?? (async () => ({ kind: 'saved' }) as unknown as EditItemResult)}
      onUndo={options.onUndo}
      undoAvailable={options.undoAvailable}
    />,
  )

  return { fileSystem, index }
}

describe('reading an item', () => {
  it('offers an explicit Edit affordance', async () => {
    await renderPanel()

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
  })

  it('does not show an editing surface until Edit is chosen', async () => {
    await renderPanel()

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('choosing Edit', () => {
  it('presents the plain Markdown body in an editable field', async () => {
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))

    const editor = await screen.findByRole('textbox')
    expect((editor as HTMLTextAreaElement).value).toContain('Original body text.')
  })

  it('offers Save and Cancel', async () => {
    await renderPanel()

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await screen.findByRole('textbox')

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('returns to reading on Cancel without saving', async () => {
    const onSave = vi.fn()
    await renderPanel({ onSave })

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await screen.findByRole('textbox')
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('saving an edit', () => {
  it('calls onSave with the base text and the edited body', async () => {
    const onSave = vi.fn(
      async (_itemId: string, _baseText: string, _newBody: string) =>
        ({ kind: 'saved' }) as unknown as EditItemResult,
    )
    await renderPanel({ onSave })

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Freshly edited text.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [itemId, baseText, newBody] = onSave.mock.calls[0]!
    expect(itemId).toBe(BRANCH)
    expect(baseText).toBe(branchFile)
    expect(newBody).toBe('Freshly edited text.')
  })

  it('returns to reading after a successful save', async () => {
    const onSave = async () => ({ kind: 'saved' }) as unknown as EditItemResult
    await renderPanel({ onSave })

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await screen.findByRole('textbox')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })

  it('stays in Edit mode and shows the reason when the save is refused', async () => {
    const onSave = async () =>
      ({ kind: 'stale', message: 'This item changed on disk since it was opened for editing.' }) as EditItemResult
    await renderPanel({ onSave })

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    await screen.findByRole('textbox')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText(/changed on disk/i)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('keeps the person\'s draft text after a refused save', async () => {
    const onSave = async () => ({ kind: 'stale', message: 'Refused.' }) as EditItemResult
    await renderPanel({ onSave })

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Do not lose this.')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText(/refused/i)
    expect(screen.getByRole('textbox')).toHaveValue('Do not lose this.')
  })
})

describe('an item carrying a Garden Diagnostic', () => {
  it('hides the Edit affordance when Diagnostics are present', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
    const index = await buildGardenIndex(
      Object.entries(files).map(([path, text]) => [path, text] as const).map(([path, text]) => ({
        path: path.split('/'),
        text,
      })),
    )
    const selected = index.items.get(BRANCH)

    render(
      <ItemPanel
        selected={selected}
        diagnostics={[
          { path: ['branches', 'attention.md'], itemId: BRANCH, title: 'Attention mechanisms', problems: [{ field: 'state', message: 'must be set' }] },
        ]}
        fileSystem={fileSystem}
        onSave={async () => ({ kind: 'saved' }) as unknown as EditItemResult}
      />,
    )

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe("a Root's captured evidence", () => {
  it('does not offer Edit, because the body is immutable evidence', async () => {
    await renderPanel({ files: { 'roots/paper.md': rootFile }, itemId: ROOT })

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe('Undo', () => {
  it('is not offered when nothing has been saved this session', async () => {
    await renderPanel()

    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  })

  it('is offered for the item a save was just applied to', async () => {
    await renderPanel({ undoAvailable: true, onUndo: async () => ({ kind: 'restored' }) as unknown as UndoChangeResult })

    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
  })

  it('calls onUndo when chosen', async () => {
    const onUndo = vi.fn(async () => ({ kind: 'restored' }) as unknown as UndoChangeResult)
    await renderPanel({ undoAvailable: true, onUndo })

    await userEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1))
  })

  it('shows the reason when Undo is refused', async () => {
    const onUndo = async () =>
      ({ kind: 'stale', message: 'This item changed again after the edit Undo would revert.' }) as UndoChangeResult
    await renderPanel({ undoAvailable: true, onUndo })

    await userEvent.click(screen.getByRole('button', { name: /undo/i }))

    await screen.findByText(/changed again/i)
  })
})

describe('a failure while opening Edit mode', () => {
  it('shows an error rather than doing nothing', async () => {
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
    fileSystem.revokePermission()
    const index = await buildGardenIndex(
      Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
    )

    render(
      <ItemPanel
        selected={index.items.get(BRANCH)}
        diagnostics={[]}
        fileSystem={fileSystem}
        onSave={async () => ({ kind: 'saved' }) as unknown as EditItemResult}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /edit/i }))

    await screen.findByRole('alert')
    // Reading failed, so Edit mode never actually opened -- the person is
    // told why rather than clicking Edit and seeing nothing happen.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
