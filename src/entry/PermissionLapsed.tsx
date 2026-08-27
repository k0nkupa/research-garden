/**
 * Shown when the browser's permission for the Garden Repository has lapsed.
 *
 * ADR 0060: permission is re-requested whenever the browser requires it, and
 * this is what that looks like. It is a recoverable state with a way back, not
 * a failure -- nothing has been read, nothing has been written, and the folder
 * the person already chose is still remembered.
 */
export interface PermissionLapsedProps {
  readonly repositoryName: string
  readonly onRetry: () => void
  readonly onDismiss: () => void
}

export function PermissionLapsed({
  repositoryName,
  onRetry,
  onDismiss,
}: PermissionLapsedProps) {
  return (
    <main className="shell shell--explanation">
      <div className="explanation">
        <h1>Research Garden needs permission for this folder again</h1>
        <p>
          The browser has stopped granting access to <strong>{repositoryName}</strong>. This
          happens routinely between sessions and after a reload; it does not mean anything
          is wrong with your Garden.
        </p>
        <p>Nothing was read and nothing was written. Grant access again to carry on.</p>

        <div className="explanation__actions">
          <button type="button" className="action action--primary" onClick={onRetry}>
            Grant access again
          </button>
          <button type="button" className="action" onClick={onDismiss}>
            Choose a different folder
          </button>
        </div>
      </div>
    </main>
  )
}
