import { useState } from 'react'
import { describeApproveChangeFailure, type ApproveChangeResult } from '../garden/approveChange'
import type { PendingChangeRecord } from '../garden/pendingChange'
import { describeRejectChangeFailure, type RejectChangeResult } from '../garden/rejectChange'
import { lineDiff } from './lineDiff'

/**
 * The selected Pending Change's diff (ADR 0025, ADR 0047, ticket 14).
 *
 * Shares the item panel's own layout and classes with `ItemPanel` and
 * `GardenActivityFeed` -- one right-hand panel with several things it can
 * show, not a special overlay for this one. Approve and Reject follow
 * `ItemPanel`'s own Save/Undo shape exactly: a callback that resolves with
 * whatever the Garden Action reported, with this panel owning its own
 * busy/error state rather than pushing that up to `Workspace`.
 */
export interface ChangeDiffPanelProps {
  readonly change: PendingChangeRecord | undefined
  readonly isStale: boolean
  readonly titleFor: (itemId: string) => string | undefined
  readonly onApprove: (change: PendingChangeRecord) => Promise<ApproveChangeResult>
  readonly onReject: (change: PendingChangeRecord) => Promise<RejectChangeResult>
}

export function ChangeDiffPanel({ change, isStale, titleFor, onApprove, onReject }: ChangeDiffPanelProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!change) {
    return (
      <aside className="item-panel item-panel--empty" aria-label="Pending Change">
        <p className="item-panel__invitation">Select a change in the tray to review it.</p>
      </aside>
    )
  }

  const title = titleFor(change.itemId) ?? change.itemId
  const diff = lineDiff(change.baseText, change.previewText)

  const approve = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await onApprove(change)
      if (result.kind !== 'applied') setError(describeApproveChangeFailure(result))
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await onReject(change)
      if (result.kind !== 'rejected') setError(describeRejectChangeFailure(result))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="item-panel" aria-label="Pending Change">
      <header className="item-panel__header">
        <p className="item-panel__kind">Pending Change</p>
        <h2 className="item-panel__title">{title}</h2>
      </header>

      {isStale && (
        <p className="notice" role="status">
          This item changed since the proposal was made. Approving is refused to avoid
          overwriting that newer change -- reject it, or reopen the current item to propose again.
        </p>
      )}

      <pre className="change-diff" aria-label={`Proposed change to ${title}`}>
        {diff.map((line, index) => (
          <div key={index} className={`change-diff__line change-diff__line--${line.kind}`}>
            <span className="change-diff__marker" aria-hidden="true">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
            </span>
            {line.text}
          </div>
        ))}
      </pre>

      {error && (
        <p className="notice notice--failure" role="alert">
          {error}
        </p>
      )}

      <div className="item-panel__actions">
        <button
          type="button"
          className="action action--primary"
          onClick={() => void approve()}
          disabled={busy || isStale}
        >
          {busy ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" className="action action--quiet" onClick={() => void reject()} disabled={busy}>
          {busy ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </aside>
  )
}
