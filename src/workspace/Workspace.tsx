import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentInterfaceStatus } from '../capabilities/capabilities'
import { approveChange, type ApproveChangeResult } from '../garden/approveChange'
import { editItem, type EditItemResult } from '../garden/editItem'
import {
  activityForApproveChange,
  activityForConnectAgent,
  activityForDisconnectAgent,
  activityForEditItem,
  activityForRejectChange,
  activityForUndoChange,
  recordGardenActivity,
  type GardenActivityEntry,
} from '../garden/gardenActivity'
import { diagnosticsForItem } from '../garden/mutationGuard'
import type { OpenedGarden } from '../garden/openGarden'
import { openGarden } from '../garden/openGarden'
import {
  isPendingChangeStale,
  listPendingChanges,
  type PendingChangeRecord,
} from '../garden/pendingChange'
import { rejectChange, type RejectChangeResult } from '../garden/rejectChange'
import { undoChange, type UndoChangeResult } from '../garden/undoChange'
import {
  exceedsPerformanceTarget,
  PERFORMANCE_TARGET_ITEM_COUNT,
  PERFORMANCE_TARGET_RELATIONSHIP_COUNT,
} from '../domain/index/performanceTarget'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { browserEntropy, createUlidFactory, type UlidEntropy } from '../domain/schema/ulid'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { createCoreReadToolsBundle } from '../webmcp/coreReadTools'
import { createDirectAdditionToolsBundle } from '../webmcp/directAdditionTools'
import { createResearchToolsBundles } from '../webmcp/researchTools'
import {
  createStateAwareToolRegistration,
  type ToolRegistrationState,
} from '../webmcp/stateAwareTools'
import { AgentAccessPanel } from './AgentAccessPanel'
import { ChangeDiffPanel } from './ChangeDiffPanel'
import { ChangeTray } from './ChangeTray'
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
 * `garden` is held as local state, seeded from the prop, so it can be replaced
 * with a freshly rescanned one without unmounting anything below -- the Tree's
 * pan and zoom, the person's open Edit draft, and which panel is showing all
 * survive a rescan exactly because they never re-render from scratch.
 *
 * ADR 0053 fixes when a rescan happens: window focus, an explicit Refresh, and
 * immediately before a mutation -- never on a timer. `rescanGarden` is the one
 * function that does it, so every boundary calls the same path. A rescan that
 * fails (permission lapsed, the folder is gone) says so in a dismissable
 * notice rather than disturbing what is already on screen; a write's own
 * result, reported separately, is still the authority on whether that write
 * happened.
 *
 * `agentAccess` (ticket 17, ADR 0081) is plain `useState`, seeded `false` on
 * every mount, exactly like `pendingChanges` never reads from anything
 * persisted -- a Garden opened from a remembered directory handle still
 * starts every fresh `Workspace` mount in human-only mode, because nothing
 * here ever stores the flag anywhere it could be read back. Connect shows one
 * disclosure (ADR 0082) before setting it; Disconnect clears it immediately
 * and states plainly what it cannot undo (ADR 0083). Ticket 17 registers no
 * filesystem-backed tool of its own -- there are none yet -- so today this
 * flag has no tool registry to gate; it exists so ticket 18 onward has a
 * session-scoped signal already wired to Connect/Disconnect and Garden
 * Activity to gate against.
 */
export interface WorkspaceProps {
  readonly garden: OpenedGarden
  /**
   * Whether ChatGPT can currently reach this browser through WebMCP (ADR
   * 0059/0072) -- distinct from `agentAccess`, which is the person's own
   * choice to connect. Defaults to `'available'` so existing callers (tests,
   * mainly) that do not care about this gate see Connect ChatGPT enabled, as
   * they did before this prop existed.
   */
  readonly agentInterface?: AgentInterfaceStatus | undefined
  /** Injected rather than reached for, matching `editItem`/`ulid.ts` (ADR 0077). */
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

type PanelMode = 'item' | 'diagnostics' | 'activity' | 'change' | 'connect'

export function Workspace({
  garden: initialGarden,
  agentInterface = 'available',
  now,
  entropy,
}: WorkspaceProps) {
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
  const [rescanning, setRescanning] = useState(false)
  /** Set only when a rescan itself failed; a write's own outcome is reported separately. */
  const [rescanNotice, setRescanNotice] = useState<string | undefined>(undefined)
  /**
   * How many rescans are in flight, so the busy state clears only once every
   * overlapping one has finished. Each rescan still runs its own independent
   * scan rather than sharing another's -- see `rescanGarden`.
   */
  const inFlightRescans = useRef(0)
  const [pendingChanges, setPendingChanges] = useState<readonly PendingChangeRecord[]>([])
  /** Recomputed alongside `pendingChanges`, from each record's own current-hash check. */
  const [staleChangeIds, setStaleChangeIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedChangeId, setSelectedChangeId] = useState<string | undefined>(undefined)
  const [agentAccess, setAgentAccess] = useState(false)
  /** True for one render right after Disconnect, so the panel can say what it cannot undo. */
  const [justDisconnected, setJustDisconnected] = useState(false)
  /**
   * The core read tools (ticket 18) are registered once per Agent Access
   * session, not re-registered on every rescan -- so their `execute` reads
   * the Garden through this ref rather than closing over whatever `garden`
   * was current when registration ran. A WebMCP call can land long after a
   * rescan replaced it.
   */
  const gardenRef = useRef(garden)
  useEffect(() => {
    gardenRef.current = garden
  }, [garden])

  const clock = useCallback(() => (now ?? nowAsCanonicalTimestamp)(), [now])
  const nextActivityId = useMemo(() => createUlidFactory(entropy ?? browserEntropy), [entropy])

  const selected = selectedId === undefined ? undefined : garden.index.items.get(selectedId)
  const diagnostics = garden.index.diagnostics
  const undoableSelected = lastEdit !== undefined && selectedId === lastEdit.itemId
  const selectedChange = pendingChanges.find((change) => change.id === selectedChangeId)
  const titleForItem = (itemId: string) => garden.index.items.get(itemId)?.item.title
  // ADR 0061 / ticket 24: a warning, never a limit -- everything below still
  // opens and works regardless of what this says.
  const performanceWarning = exceedsPerformanceTarget(garden.index)

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

  /**
   * Rescans the Garden Repository (ADR 0053, ticket 13): reopens it and swaps
   * the local `garden` state for the result, without touching selection, the
   * Tree's view, or an in-progress Edit draft. Used for every boundary --
   * window focus, the Refresh control, immediately before Save, and (as it
   * always has) reopening after a write succeeds.
   *
   * Every call runs its own scan rather than joining another's already in
   * flight. Sharing one would be cheaper, but a call made *because* something
   * is about to depend on current files -- the reread after a write, the
   * check right before one -- would then risk being handed a scan that
   * started earlier and no longer reflects what it was asked for. There is
   * nothing here to coalesce that is worth that risk: `openGarden` is a
   * handful of local file reads.
   *
   * A rescan that itself fails -- permission lapsed, the folder is gone --
   * surfaces in `rescanNotice` and otherwise changes nothing: the Tree is left
   * showing what it last knew, exactly as an interrupted post-write reopen
   * already did, because a write's own result (returned separately) is still
   * the authority on whether that write happened.
   */
  /**
   * Reloads Pending Changes and which of them are Stale, from the operational
   * directory (ticket 14). Called once at mount below, and again inside
   * `rescanGarden` -- so window focus, Refresh, and immediately before a
   * mutation all cover it too, without a second boundary to keep in sync.
   * Pending Changes are not part of the `garden` prop `Workspace` opens with,
   * which is why mount needs its own call rather than relying on that.
   */
  const refreshPendingChanges = useCallback(async (targetFileSystem: GardenFileSystem) => {
    try {
      const changes = await listPendingChanges(targetFileSystem)
      const staleFlags = await Promise.all(
        changes.map((change) => isPendingChangeStale(targetFileSystem, change)),
      )
      setPendingChanges(changes)
      setStaleChangeIds(new Set(changes.filter((_, index) => staleFlags[index]).map((change) => change.id)))
    } catch {
      // Best-effort, matching the Index Cache and rescan's own posture: a
      // Pending Change that cannot currently be listed is not reason enough
      // to disturb a Tree that just rescanned successfully.
    }
  }, [])

  const rescanGarden = useCallback(async (): Promise<OpenedGarden | undefined> => {
    inFlightRescans.current += 1
    setRescanning(true)
    try {
      const reopened = await openGarden(garden.fileSystem)
      if (reopened.kind === 'opened') {
        setRescanNotice(undefined)
        setGarden(reopened.garden)
        await refreshPendingChanges(reopened.garden.fileSystem)
        return reopened.garden
      }
      setRescanNotice(
        reopened.kind === 'permission-required'
          ? 'Permission for this Garden Repository was not available, so it could not be rescanned.'
          : reopened.message,
      )
      return undefined
    } finally {
      inFlightRescans.current -= 1
      if (inFlightRescans.current === 0) setRescanning(false)
    }
  }, [garden.fileSystem, refreshPendingChanges])

  /**
   * Direct-addition tools keep their registration alive across rescans. The
   * callback target changes with the latest render, while the registration
   * itself remains stable so a successful write does not tear down its tools.
   */
  const rescanGardenRef = useRef(rescanGarden)
  rescanGardenRef.current = rescanGarden

  // Runs once at mount: `refreshPendingChanges` has no other dependencies of
  // its own, and `initialGarden.fileSystem` is the same object `garden`
  // holds for the life of this component (ticket 13).
  useEffect(() => {
    void refreshPendingChanges(initialGarden.fileSystem)
  }, [initialGarden.fileSystem, refreshPendingChanges])

  // ADR 0053: rescanned when the window regains focus. Not `visibilitychange`:
  // the criterion is specifically focus, and App.tsx already uses the same
  // `window`-listener idiom for `resize`/`online`/`offline`.
  useEffect(() => {
    const onFocus = () => void rescanGarden()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [rescanGarden])

  // Ticket 19: the registration controller owns the compact, state-aware
  // surface. Core reads, direct additions, and contextual research bundles all
  // share this one session-scoped registration lifetime.
  const stateAwareRegistration = useMemo(
    () => {
      const coreRuntime = {
        getGarden: () => gardenRef.current,
        recordActivity: (entry: GardenActivityEntry) =>
          setActivity((log) => recordGardenActivity(log, entry)),
        nextActivityId,
        clock,
      }
      const additionsRuntime = {
        ...coreRuntime,
        refreshGarden: () => rescanGardenRef.current(),
        entropy,
      }
      return createStateAwareToolRegistration(window.navigator, [
        createCoreReadToolsBundle(coreRuntime),
        createDirectAdditionToolsBundle(additionsRuntime),
        ...createResearchToolsBundles(coreRuntime),
      ])
    },
    [clock, entropy, nextActivityId],
  )

  useEffect(() => {
    const nextState: ToolRegistrationState = {
      agentAccess,
      gardenOpen: true,
      selectedItemId: selectedId,
      selectedItemKind: selected?.item.kind,
      focusedBranchId: view.focusedId,
      hasPendingChanges: pendingChanges.length > 0,
    }
    stateAwareRegistration.update(nextState)
  }, [agentAccess, pendingChanges.length, selected?.item.kind, selectedId, stateAwareRegistration, view.focusedId])

  useEffect(() => () => stateAwareRegistration.disconnect(), [stateAwareRegistration])

  const saveEdit = useCallback(
    async (itemId: string, baseText: string, newBody: string): Promise<EditItemResult> => {
      // ADR 0053: rescanned immediately before the mutation, so `editItem`'s
      // own Diagnostic and Root-evidence checks see the Garden as it is now --
      // not as it was when this item was last on screen. A dangling reference
      // introduced by an unrelated external change is exactly the kind of
      // thing this item's own file content would never reveal on its own.
      const rescanned = await rescanGarden()
      const active = rescanned ?? garden

      const result = await editItem(
        active.fileSystem,
        active.index,
        { itemId, baseText, newBody },
        { now, entropy },
      )

      setActivity((log) => recordGardenActivity(log, activityForEditItem(itemId, result, nextActivityId(), clock())))

      if (result.kind === 'saved') {
        // A no-op save (identical body) writes nothing and produces no Undo
        // Snapshot, so there is nothing for the Undo button to offer.
        setLastEdit(result.snapshotId ? { itemId, snapshotId: result.snapshotId } : undefined)
        await rescanGarden()
      }

      return result
    },
    [clock, entropy, garden, nextActivityId, now, rescanGarden],
  )

  const undoLastEdit = useCallback(async (): Promise<UndoChangeResult | undefined> => {
    if (!lastEdit) return undefined

    // No pre-rescan here, unlike `saveEdit`: `undoChange` takes no `index` and
    // makes its own current-files check directly against the target file's
    // hash (ADR 0027), so a rescan first would refresh the Tree a moment
    // early and change nothing about what Undo itself is protected against.
    // The rescan after a successful restore, below, is what shows the result.
    const result = await undoChange(garden.fileSystem, lastEdit, { now, entropy })

    setActivity((log) =>
      recordGardenActivity(log, activityForUndoChange(lastEdit.itemId, result, nextActivityId(), clock())),
    )

    if (result.kind === 'restored') {
      setLastEdit(undefined)
      await rescanGarden()
    }

    return result
  }, [clock, entropy, garden.fileSystem, lastEdit, nextActivityId, now, rescanGarden])

  const selectChange = (id: string) => {
    setSelectedChangeId(id)
    setPanelMode('change')
  }

  /**
   * Approving lands the person on the now-applied item, with Undo already
   * available -- the same `lastEdit`/`undoLastEdit` mechanism a direct save
   * already offers (ticket 12), reused rather than duplicated, since an
   * applied Pending Change and a direct edit both end at exactly the same
   * place: one canonical file, one Undo Snapshot, subject to the same
   * resulting-hash rule.
   */
  const approveSelectedChange = useCallback(
    async (change: PendingChangeRecord): Promise<ApproveChangeResult> => {
      const result = await approveChange(
        garden.fileSystem,
        { id: change.id, previewHash: change.previewHash },
        { now, entropy },
      )

      setActivity((log) =>
        recordGardenActivity(log, activityForApproveChange(change.itemId, result, nextActivityId(), clock())),
      )

      if (result.kind === 'applied') {
        setLastEdit({ itemId: change.itemId, snapshotId: result.snapshotId })
        setSelectedChangeId(undefined)
        setSelectedId(change.itemId)
        setPanelMode('item')
        await rescanGarden()
      } else {
        // A refusal (Stale, invalid) may itself reflect something that just
        // changed -- refresh the tray so what it shows stays accurate.
        await refreshPendingChanges(garden.fileSystem)
      }

      return result
    },
    [clock, entropy, garden.fileSystem, nextActivityId, now, refreshPendingChanges, rescanGarden],
  )

  const rejectSelectedChange = useCallback(
    async (change: PendingChangeRecord): Promise<RejectChangeResult> => {
      const result = await rejectChange(garden.fileSystem, change.id)

      setActivity((log) =>
        recordGardenActivity(log, activityForRejectChange(change.itemId, result, nextActivityId(), clock())),
      )

      if (result.kind === 'rejected') {
        const wasSelected = selectedChangeId === change.id
        if (wasSelected) {
          setSelectedChangeId(undefined)
          setPanelMode('item')
        }
        await refreshPendingChanges(garden.fileSystem)
      }

      return result
    },
    [clock, garden.fileSystem, nextActivityId, refreshPendingChanges, selectedChangeId],
  )

  /** Opens the disclosure, fresh -- not a stale Disconnected notice from earlier this session. */
  const openAgentAccessPanel = useCallback(() => {
    setJustDisconnected(false)
    setPanelMode('connect')
  }, [])

  const connectAgent = useCallback(() => {
    setAgentAccess(true)
    setActivity((log) => recordGardenActivity(log, activityForConnectAgent(nextActivityId(), clock())))
    setPanelMode('item')
  }, [clock, nextActivityId])

  /**
   * Immediate, not gated behind a second confirmation (ADR 0083): revoking
   * access should never itself be friction. `justDisconnected` sets what the
   * panel says right afterward -- Connect's own disclosure is the one place
   * requiring an explicit step; Disconnect only has to be undeniable once it
   * has happened.
   */
  const disconnectAgent = useCallback(() => {
    // Revoke all active bundle signals in the click handler itself. The state
    // update below is still reflected by the effect, but must not be the first
    // moment at which the browser loses access (ADR 0083).
    stateAwareRegistration.disconnect()
    setAgentAccess(false)
    setJustDisconnected(true)
    setActivity((log) => recordGardenActivity(log, activityForDisconnectAgent(nextActivityId(), clock())))
    setPanelMode('connect')
  }, [clock, nextActivityId, stateAwareRegistration])

  const closeAgentAccessPanel = useCallback(() => {
    setJustDisconnected(false)
    setPanelMode('item')
  }, [])

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

        {pendingChanges.length > 0 && (
          <button
            type="button"
            className="workspace__panel-toggle"
            aria-pressed={panelMode === 'change'}
            onClick={() => {
              if (panelMode === 'change') {
                setPanelMode('item')
                return
              }
              const [firstChange] = pendingChanges
              if (firstChange) selectChange(selectedChangeId ?? firstChange.id)
            }}
          >
            {pendingChanges.length} {pendingChanges.length === 1 ? 'Change' : 'Changes'}
          </button>
        )}

        {agentInterface !== 'unsupported' && (
          <button
            type="button"
            className="workspace__panel-toggle"
            aria-pressed={agentAccess}
            disabled={!agentAccess && agentInterface === 'offline'}
            title={
              !agentAccess && agentInterface === 'offline'
                ? 'No connection right now — Agent Access needs the host connection to work.'
                : undefined
            }
            onClick={() => (agentAccess ? disconnectAgent() : openAgentAccessPanel())}
          >
            {agentAccess ? 'Disconnect ChatGPT' : 'Connect ChatGPT'}
          </button>
        )}

        {/* ADR 0053: rescans on demand, on top of window focus and before a mutation. */}
        <button
          type="button"
          className="workspace__panel-toggle workspace__refresh"
          onClick={() => void rescanGarden()}
          disabled={rescanning}
        >
          {rescanning ? 'Rescanning…' : 'Refresh'}
        </button>
      </div>

      {rescanNotice && (
        <p className="notice notice--failure" role="alert">
          {rescanNotice}
        </p>
      )}

      {performanceWarning && (
        <p className="notice" role="status">
          This Garden has grown past the size Research Garden is tested against (
          {PERFORMANCE_TARGET_ITEM_COUNT.toLocaleString()} items,{' '}
          {PERFORMANCE_TARGET_RELATIONSHIP_COUNT.toLocaleString()} relationships). Everything here
          still works; some interactions may be slower than usual.
        </p>
      )}

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

        {panelMode === 'activity' && <GardenActivityFeed entries={activity} titleFor={titleForItem} />}

        {panelMode === 'change' && (
          <ChangeDiffPanel
            change={selectedChange}
            isStale={selectedChange !== undefined && staleChangeIds.has(selectedChange.id)}
            titleFor={titleForItem}
            onApprove={approveSelectedChange}
            onReject={rejectSelectedChange}
          />
        )}

        {panelMode === 'connect' && (
          <AgentAccessPanel
            justDisconnected={justDisconnected}
            onConnect={connectAgent}
            onClose={closeAgentAccessPanel}
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

      <ChangeTray
        changes={pendingChanges}
        staleIds={staleChangeIds}
        selectedId={panelMode === 'change' ? selectedChangeId : undefined}
        onSelect={selectChange}
        titleFor={titleForItem}
      />
    </main>
  )
}
