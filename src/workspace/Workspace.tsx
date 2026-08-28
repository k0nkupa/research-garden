import { useCallback, useMemo, useState } from 'react'
import { editItem, type EditItemResult } from '../garden/editItem'
import {
  activityForEditItem,
  activityForUndoChange,
  recordGardenActivity,
  type GardenActivityEntry,
} from '../garden/gardenActivity'
import { diagnosticsForItem } from '../garden/mutationGuard'
import type { OpenedGarden } from '../garden/openGarden'
import { openGarden } from '../garden/openGarden'
import { undoChange, type UndoChangeResult } from '../garden/undoChange'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { browserEntropy, createUlidFactory, type UlidEntropy } from '../domain/schema/ulid'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { GardenActivityFeed } from './GardenActivityFeed'
import { GardenTree } from './GardenTree'
import { ItemPanel } from './ItemPanel'
import { SearchBox } from './SearchBox'
import { revealItem, UNFOCUSED, type TreeViewState } from './treeView'

/**
 * The Garden workspace.
 *
 * ADR 0019 centres the Tree and opens the selected item beside it. The Change
 * Tray (ticket 14) and the Agent Access bar (ticket 17) join this layout
 * later. The Garden Activity feed (ticket 12) shares the right-hand panel with
 * Garden Diagnostics and the selected item, for the same reason Diagnostics
 * already do: neither is a permanent fixture, so neither should take space
 * from the Tree that ADR 0019 makes primary.
 *
 * `garden` is held as local state, seeded from the prop, because a successful
 * edit or Undo changes files on disk and the Tree, the panel, and Diagnostics
 * all need to reflect that -- so this is where the Garden is reopened after
 * either one succeeds (ADR 0055: a write is not trusted until it is reread).
 */
export interface WorkspaceProps {
  readonly garden: OpenedGarden
  /** Injected rather than reached for, matching `editItem`/`ulid.ts` (ADR 0077). */
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

type PanelMode = 'item' | 'diagnostics' | 'activity'

export function Workspace({ garden: initialGarden, now, entropy }: WorkspaceProps) {
  const [garden, setGarden] = useState<OpenedGarden>(initialGarden)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [panelMode, setPanelMode] = useState<PanelMode>('item')
  // View state only: what the Tree is showing, never what the Garden holds.
  const [view, setView] = useState<TreeViewState>(UNFOCUSED)
  const [activity, setActivity] = useState<readonly GardenActivityEntry[]>([])
  /** The most recent successful edit, while its Undo Snapshot still applies. */
  const [lastEdit, setLastEdit] = useState<{ itemId: string; snapshotId: string } | undefined>(
    undefined,
  )

  const clock = useCallback(() => (now ?? nowAsCanonicalTimestamp)(), [now])
  const nextActivityId = useMemo(() => createUlidFactory(entropy ?? browserEntropy), [entropy])

  const selected = selectedId === undefined ? undefined : garden.index.items.get(selectedId)
  const diagnostics = garden.index.diagnostics
  const undoableSelected = lastEdit !== undefined && selectedId === lastEdit.itemId

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
    setPanelMode('item')
    // ticket 11: a result chosen from search (or a Diagnostic) may name an
    // item the Tree currently has folded away or focused past. Without this,
    // selecting it would update the panel while the Tree kept showing
    // something else -- selection would not actually reach the Tree.
    setView((current) => revealItem(garden.index, current, id))
  }

  /** Reopens the Garden after a write, so the Tree and index reflect it (ADR 0055). */
  const refreshGarden = useCallback(async () => {
    const reopened = await openGarden(garden.fileSystem)
    // A write that was itself verified (ADR 0055) succeeding while the
    // subsequent reopen fails is a rarer, secondary failure -- most likely
    // permission lapsing in the moment between the two. The Tree is simply
    // left showing the pre-write state rather than a half-updated one; the
    // write's own result (already returned to the caller) still reports what
    // actually happened on disk.
    if (reopened.kind === 'opened') setGarden(reopened.garden)
  }, [garden.fileSystem])

  const saveEdit = useCallback(
    async (itemId: string, baseText: string, newBody: string): Promise<EditItemResult> => {
      const result = await editItem(
        garden.fileSystem,
        garden.index,
        { itemId, baseText, newBody },
        { now, entropy },
      )

      setActivity((log) => recordGardenActivity(log, activityForEditItem(itemId, result, nextActivityId(), clock())))

      if (result.kind === 'saved') {
        // A no-op save (identical body) writes nothing and produces no Undo
        // Snapshot, so there is nothing for the Undo button to offer.
        setLastEdit(result.snapshotId ? { itemId, snapshotId: result.snapshotId } : undefined)
        await refreshGarden()
      }

      return result
    },
    [clock, entropy, garden.fileSystem, garden.index, nextActivityId, now, refreshGarden],
  )

  const undoLastEdit = useCallback(async (): Promise<UndoChangeResult | undefined> => {
    if (!lastEdit) return undefined

    const result = await undoChange(garden.fileSystem, lastEdit, { now, entropy })

    setActivity((log) =>
      recordGardenActivity(log, activityForUndoChange(lastEdit.itemId, result, nextActivityId(), clock())),
    )

    if (result.kind === 'restored') {
      setLastEdit(undefined)
      await refreshGarden()
    }

    return result
  }, [clock, entropy, garden.fileSystem, lastEdit, nextActivityId, now, refreshGarden])

  return (
    <main className="workspace">
      <div className="workspace__bar">
        <span className="workspace__repository">{garden.repositoryName}</span>

        <SearchBox index={garden.index} onSelect={selectItem} />

        {view.focusedId !== undefined && (
          <button
            type="button"
            className="workspace__focus"
            onClick={() => setView({ ...view, focusedId: undefined })}
          >
            Focused on {garden.index.items.get(view.focusedId)?.item.title ?? 'a Branch'} — show
            the whole Tree
          </button>
        )}

        <button
          type="button"
          className="workspace__panel-toggle"
          aria-pressed={panelMode === 'activity'}
          onClick={() => setPanelMode((mode) => (mode === 'activity' ? 'item' : 'activity'))}
        >
          {activity.length > 0 ? `Activity (${activity.length})` : 'Activity'}
        </button>

        {diagnostics.length > 0 && (
          <button
            type="button"
            className="workspace__panel-toggle"
            aria-pressed={panelMode === 'diagnostics'}
            onClick={() => setPanelMode((mode) => (mode === 'diagnostics' ? 'item' : 'diagnostics'))}
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
            view={view}
            onViewChange={setView}
          />
        </div>

        {panelMode === 'diagnostics' && (
          <DiagnosticsPanel
            diagnostics={diagnostics}
            onSelectItem={selectItem}
            isLoaded={(itemId) => garden.index.items.has(itemId)}
          />
        )}

        {panelMode === 'activity' && (
          <GardenActivityFeed
            entries={activity}
            titleFor={(itemId) => garden.index.items.get(itemId)?.item.title}
          />
        )}

        {panelMode === 'item' && (
          <ItemPanel
            selected={selected}
            diagnostics={selectedId === undefined ? [] : diagnosticsForItem(garden.index, selectedId)}
            fileSystem={garden.fileSystem}
            onSave={saveEdit}
            undoAvailable={undoableSelected}
            onUndo={undoableSelected ? undoLastEdit : undefined}
          />
        )}
      </div>
    </main>
  )
}
