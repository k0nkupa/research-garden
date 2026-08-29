/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PendingChangeRecord } from '../garden/pendingChange'
import { ChangeTray } from './ChangeTray'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'

const CHANGE: PendingChangeRecord = {
  id: 'change-1',
  itemId: BRANCH,
  path: ['branches', 'attention.md'],
  baseText: 'old\n',
  baseHash: 'sha256:old',
  previewText: 'new\n',
  previewHash: 'sha256:new',
  proposedAt: '2026-08-01T10:00:00Z',
}

describe('the Change Tray with nothing to review', () => {
  it('is a thin status rail, not an expanded list', () => {
    render(
      <ChangeTray
        changes={[]}
        staleIds={new Set()}
        selectedId={undefined}
        onSelect={() => {}}
        titleFor={() => undefined}
      />,
    )

    expect(screen.getByText(/no changes to review/i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /change tray/i })).not.toBeInTheDocument()
  })
})

describe('the Change Tray with a Pending Change', () => {
  it('expands and names the change by its item title', () => {
    render(
      <ChangeTray
        changes={[CHANGE]}
        staleIds={new Set()}
        selectedId={undefined}
        onSelect={() => {}}
        titleFor={() => 'Attention mechanisms'}
      />,
    )

    expect(screen.getByRole('region', { name: /change tray/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Attention mechanisms/i })).toBeInTheDocument()
  })

  it('falls back to the item id when no title is available', () => {
    render(
      <ChangeTray
        changes={[CHANGE]}
        staleIds={new Set()}
        selectedId={undefined}
        onSelect={() => {}}
        titleFor={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: new RegExp(BRANCH) })).toBeInTheDocument()
  })

  it('opens a change on click', async () => {
    const onSelect = vi.fn()
    render(
      <ChangeTray
        changes={[CHANGE]}
        staleIds={new Set()}
        selectedId={undefined}
        onSelect={onSelect}
        titleFor={() => 'Attention mechanisms'}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))

    expect(onSelect).toHaveBeenCalledWith(CHANGE.id)
  })

  it('marks the selected change as pressed', () => {
    render(
      <ChangeTray
        changes={[CHANGE]}
        staleIds={new Set()}
        selectedId={CHANGE.id}
        onSelect={() => {}}
        titleFor={() => 'Attention mechanisms'}
      />,
    )

    expect(screen.getByRole('button', { name: /Attention mechanisms/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows a Stale badge for a change whose target has moved on', () => {
    render(
      <ChangeTray
        changes={[CHANGE]}
        staleIds={new Set([CHANGE.id])}
        selectedId={undefined}
        onSelect={() => {}}
        titleFor={() => 'Attention mechanisms'}
      />,
    )

    expect(screen.getByText(/stale/i)).toBeInTheDocument()
  })

  it('shows no Stale badge for a change that still matches its target', () => {
    render(
      <ChangeTray
        changes={[CHANGE]}
        staleIds={new Set()}
        selectedId={undefined}
        onSelect={() => {}}
        titleFor={() => 'Attention mechanisms'}
      />,
    )

    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument()
  })

  it('names how many changes there are to review', () => {
    const second: PendingChangeRecord = { ...CHANGE, id: 'change-2' }
    render(
      <ChangeTray
        changes={[CHANGE, second]}
        staleIds={new Set()}
        selectedId={undefined}
        onSelect={() => {}}
        titleFor={() => 'Attention mechanisms'}
      />,
    )

    expect(screen.getByText(/2 changes to review/i)).toBeInTheDocument()
  })
})
