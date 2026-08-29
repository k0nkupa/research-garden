/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ApproveChangeResult } from '../garden/approveChange'
import type { PendingChangeRecord } from '../garden/pendingChange'
import type { RejectChangeResult } from '../garden/rejectChange'
import { ChangeDiffPanel } from './ChangeDiffPanel'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'

const CHANGE: PendingChangeRecord = {
  id: 'change-1',
  itemId: BRANCH,
  path: ['branches', 'attention.md'],
  baseText: 'a\nold line\nc',
  baseHash: 'sha256:old',
  previewText: 'a\nnew line\nc',
  previewHash: 'sha256:new',
  proposedAt: '2026-08-01T10:00:00Z',
}

function renderPanel(options: {
  change?: PendingChangeRecord | undefined
  isStale?: boolean
  onApprove?: (change: PendingChangeRecord) => Promise<ApproveChangeResult>
  onReject?: (change: PendingChangeRecord) => Promise<RejectChangeResult>
} = {}) {
  render(
    <ChangeDiffPanel
      change={'change' in options ? options.change : CHANGE}
      isStale={options.isStale ?? false}
      titleFor={() => 'Attention mechanisms'}
      onApprove={options.onApprove ?? (async () => ({ kind: 'applied', itemId: BRANCH, path: CHANGE.path, snapshotId: 'snap-1', resultingHash: 'sha256:new' }))}
      onReject={options.onReject ?? (async () => ({ kind: 'rejected', itemId: BRANCH }))}
    />,
  )
}

describe('with nothing selected', () => {
  it('invites a person to select a change from the tray', () => {
    renderPanel({ change: undefined })

    expect(screen.getByText(/select a change in the tray/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})

describe('a selected change', () => {
  it('names the item the change targets', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: /Attention mechanisms/i })).toBeInTheDocument()
  })

  it('shows the exact one-file diff: the old line struck, the new line added', () => {
    renderPanel()

    const diff = screen.getByLabelText(/proposed change/i)
    expect(diff).toHaveTextContent('old line')
    expect(diff).toHaveTextContent('new line')
  })

  it('offers Approve and Reject', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
  })
})

describe('approving', () => {
  it('calls onApprove with the change being reviewed', async () => {
    const onApprove = vi.fn(
      async () =>
        ({ kind: 'applied', itemId: BRANCH, path: CHANGE.path, snapshotId: 'snap-1', resultingHash: 'x' }) as const,
    )
    renderPanel({ onApprove })

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    expect(onApprove).toHaveBeenCalledWith(CHANGE)
  })

  it('shows the failure reason when approval is refused', async () => {
    renderPanel({
      onApprove: async () => ({ kind: 'stale', message: 'This item changed since the proposal was made.' }),
    })

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/this item changed/i),
    )
  })

  it('is disabled while the change is Stale', () => {
    renderPanel({ isStale: true })

    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
  })

  it('shows a Stale notice, distinct from a failure, before anyone tries to approve', () => {
    renderPanel({ isStale: true })

    expect(screen.getByRole('status')).toHaveTextContent(/changed since the proposal/i)
  })
})

describe('rejecting', () => {
  it('calls onReject with the change being reviewed', async () => {
    const onReject = vi.fn(async () => ({ kind: 'rejected', itemId: BRANCH }) as const)
    renderPanel({ onReject })

    await userEvent.click(screen.getByRole('button', { name: /reject/i }))

    expect(onReject).toHaveBeenCalledWith(CHANGE)
  })

  it('remains available even while the change is Stale -- rejecting a Stale proposal is still allowed', () => {
    renderPanel({ isStale: true })

    expect(screen.getByRole('button', { name: /reject/i })).not.toBeDisabled()
  })

  it('shows the failure reason when rejection itself fails', async () => {
    renderPanel({
      onReject: async () => ({ kind: 'permission-required' }),
    })

    await userEvent.click(screen.getByRole('button', { name: /reject/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/permission/i))
  })
})
