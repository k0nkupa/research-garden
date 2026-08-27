import { useState } from 'react'
import type { OpenedGarden } from '../garden/openGarden'
import { GardenTree } from './GardenTree'
import { ItemPanel } from './ItemPanel'

/**
 * The Garden workspace.
 *
 * ADR 0019 centres the Tree and opens the selected item beside it. The Change
 * Tray (ticket 14), the Garden Activity feed (ticket 12), and the Agent Access
 * bar (ticket 17) join this layout later.
 */
export interface WorkspaceProps {
  readonly garden: OpenedGarden
}

export function Workspace({ garden }: WorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const selected = selectedId === undefined ? undefined : garden.index.items.get(selectedId)

  return (
    <main className="workspace">
      <div className="workspace__bar">
        <span className="workspace__repository">{garden.repositoryName}</span>
      </div>

      <div className="workspace__panes">
        <div className="workspace__tree">
          <GardenTree
            index={garden.index}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <ItemPanel selected={selected} />
      </div>
    </main>
  )
}
