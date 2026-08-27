/**
 * Shown when Create Garden was pointed at a folder that already holds a Garden.
 *
 * ADR 0006: nothing was written. The one thing Create Garden must never do is
 * overwrite research someone already has, so this is a refusal rather than a
 * merge or a prompt to continue.
 */
export interface AlreadyAGardenProps {
  readonly repositoryName: string
  readonly found: readonly string[]
  readonly onOpenInstead: () => void
  readonly onDismiss: () => void
}

const SHOWN = 5

export function AlreadyAGarden({
  repositoryName,
  found,
  onOpenInstead,
  onDismiss,
}: AlreadyAGardenProps) {
  return (
    <main className="shell shell--explanation">
      <div className="explanation">
        <h1>There is already a Garden in that folder</h1>
        <p>
          <strong>{repositoryName}</strong> already contains canonical Markdown, so nothing
          was written to it. Creating a Garden there would risk overwriting research you
          already have.
        </p>

        <ul className="explanation__found">
          {found.slice(0, SHOWN).map((path) => (
            <li key={path}>{path}</li>
          ))}
          {found.length > SHOWN && <li>and {found.length - SHOWN} more</li>}
        </ul>

        <p>Open it instead, or choose a different folder to create a new Garden in.</p>

        <div className="explanation__actions">
          <button type="button" className="action action--primary" onClick={onOpenInstead}>
            Open this Garden
          </button>
          <button type="button" className="action" onClick={onDismiss}>
            Choose a different folder
          </button>
        </div>
      </div>
    </main>
  )
}
