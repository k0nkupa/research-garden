import type { PendingChangeRecord } from '../garden/pendingChange'

/**
 * The Change Tray (ADR 0047, ticket 14): a thin status rail when there is
 * nothing to review, expanding only once a Pending Change exists. It never
 * grows to cover the Tree -- opening a change is a click that changes what
 * the right-hand panel shows (`ChangeDiffPanel`), the same panel `ItemPanel`
 * and `GardenActivityFeed` already share, not an overlay on top of anything.
 */
export interface ChangeTrayProps {
  readonly changes: readonly PendingChangeRecord[]
  readonly staleIds: ReadonlySet<string>
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
  readonly titleFor: (itemId: string) => string | undefined
}

export function ChangeTray({ changes, staleIds, selectedId, onSelect, titleFor }: ChangeTrayProps) {
  if (changes.length === 0) {
    return (
      <div className="change-tray change-tray--empty" role="status">
        No changes to review
      </div>
    )
  }

  return (
    <div className="change-tray" role="region" aria-label="Change Tray">
      <p className="change-tray__heading">
        {changes.length} {changes.length === 1 ? 'change' : 'changes'} to review
      </p>

      <ul className="change-tray__list">
        {changes.map((change) => {
          const title = titleFor(change.itemId) ?? change.itemId
          const stale = staleIds.has(change.id)

          return (
            <li key={change.id}>
              <button
                type="button"
                className="change-tray__entry"
                aria-pressed={selectedId === change.id}
                onClick={() => onSelect(change.id)}
              >
                {title}
                {stale && <span className="change-tray__stale-badge">Stale</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
