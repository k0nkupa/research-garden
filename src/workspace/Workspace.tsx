import { useMemo, useState } from 'react'
import type { OpenedGarden } from '../garden/openGarden'
import { diagnosticsForItem } from '../garden/mutationGuard'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { GardenTree } from './GardenTree'
import { ItemPanel } from './ItemPanel'

/**
 * The Garden workspace.
 *
 * ADR 0019 centres the Tree and opens the selected item beside it. The Change
 * Tray (ticket 14), the Garden Activity feed (ticket 12), and the Agent Access
 * bar (ticket 17) join this layout later.
 *
 * Garden Diagnostics share the right-hand panel rather than taking space of
 * their own. This is a deliberate deviation from ADR 0019, which assigns that
 * panel to the selected item: Diagnostics are something a person visits when a
 * file needs attention rather than a permanent fixture, and giving them their
 * own region would take space from the Tree that ADR 0019 makes primary. The
 * panel returns to the selected item as soon as one is chosen.
 */
export interface WorkspaceProps {
  readonly garden: OpenedGarden
}

export function Workspace({ garden }: WorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [showingDiagnostics, setShowingDiagnostics] = useState(false)

  const selected = selectedId === undefined ? undefined : garden.index.items.get(selectedId)
  const diagnostics = garden.index.diagnostics

  /** Items that loaded but carry a Garden Diagnostic, so the Tree can mark them. */
  const diagnosedIds = useMemo(
    () =>
      new Set(
        diagnostics
          .map((diagnostic) => diagnostic.itemId)
          .filter((id): id is string => id !== undefined && garden.index.items.has(id)),
      ),
    [diagnostics, garden.index.items],
  )

  const selectItem = (id: string) => {
    setSelectedId(id)
    setShowingDiagnostics(false)
  }

  return (
    <main className="workspace">
      <div className="workspace__bar">
        <span className="workspace__repository">{garden.repositoryName}</span>

        {diagnostics.length > 0 && (
          <button
            type="button"
            className="workspace__diagnostics-toggle"
            aria-pressed={showingDiagnostics}
            onClick={() => setShowingDiagnostics((showing) => !showing)}
          >
            {diagnostics.length} {diagnostics.length === 1 ? 'Diagnostic' : 'Diagnostics'}
          </button>
        )}
      </div>

      <div className="workspace__panes">
        <div className="workspace__tree">
          <GardenTree
            index={garden.index}
            selectedId={selectedId}
            diagnosedIds={diagnosedIds}
            onSelect={selectItem}
          />
        </div>

        {showingDiagnostics ? (
          <DiagnosticsPanel
            diagnostics={diagnostics}
            onSelectItem={selectItem}
            isLoaded={(itemId) => garden.index.items.has(itemId)}
          />
        ) : (
          <ItemPanel
            selected={selected}
            diagnostics={selectedId === undefined ? [] : diagnosticsForItem(garden.index, selectedId)}
          />
        )}
      </div>
    </main>
  )
}
