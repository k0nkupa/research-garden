import type { GardenDiagnostic } from '../domain/index/gardenIndex'
import { ProblemList } from './ProblemList'

/**
 * The Garden Diagnostics list.
 *
 * ADR 0052: neither hide invalid files nor let one malformed file stop
 * unrelated research from opening. Hiding them would be the easy thing and the
 * wrong one -- a person cannot fix what they cannot see, and a file Research
 * Garden silently ignored would look like a file it had lost.
 *
 * A Diagnostic names the item where the file got far enough to declare one, and
 * falls back to the path where it did not, because that is all there is to say
 * about a file that never parsed.
 */
export interface DiagnosticsPanelProps {
  readonly diagnostics: readonly GardenDiagnostic[]
  /** Present only for Diagnostics whose item actually loaded into the Tree. */
  readonly onSelectItem: (itemId: string) => void
  readonly isLoaded: (itemId: string) => boolean
}

export function DiagnosticsPanel({
  diagnostics,
  onSelectItem,
  isLoaded,
}: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) {
    return (
      <aside className="item-panel item-panel--empty" aria-label="Garden Diagnostics">
        <p className="item-panel__invitation">
          Nothing in this Garden needs attention. Every file validated.
        </p>
      </aside>
    )
  }

  return (
    <aside className="item-panel" aria-label="Garden Diagnostics">
      <header className="item-panel__header">
        <p className="item-panel__kind">Garden Diagnostics</p>
        <h2 className="item-panel__title">
          {diagnostics.length} {diagnostics.length === 1 ? 'file needs' : 'files need'} attention
        </h2>
        <p className="diagnostics__preamble">
          Everything else opened normally. These files stay in your Garden and stay
          readable; Research Garden will not change them until they validate.
        </p>
      </header>

      <ul className="diagnostics">
        {diagnostics.map((diagnostic) => {
          const pathText = diagnostic.path.join('/')
          const itemId = diagnostic.itemId
          const subject = diagnostic.title ?? itemId ?? pathText

          return (
            <li key={pathText} className="diagnostics__entry">
              <h3 className="diagnostics__subject">
                {itemId !== undefined && isLoaded(itemId) ? (
                  <button
                    type="button"
                    className="diagnostics__link"
                    onClick={() => onSelectItem(itemId)}
                  >
                    {subject}
                  </button>
                ) : (
                  subject
                )}
              </h3>

              {/* A file with nothing to name is already headed by its path. */}
              {subject !== pathText && <p className="diagnostics__path">{pathText}</p>}

              <ProblemList problems={diagnostic.problems} />
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
