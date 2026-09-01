import type { GardenIndex } from '../domain/index/gardenIndex'
import { useEffect, useRef, type RefObject } from 'react'
import { GardenTree } from './GardenTree'
import {
  allCanopyEntries,
  canopyEntries,
  canopyTreeRows,
  MAX_CANOPIES_PER_THREAD,
  nextScopedId,
  overviewPageCount,
  overviewTreeRows,
  scopeDescription,
  scopeLabel,
  scopedItemIds,
  type CanopyEntry,
  type ExploreScope,
} from './exploreTree'
import type { TreeViewState } from './treeView'

export interface GardenExplorerProps {
  readonly index: GardenIndex
  readonly selectedId: string | undefined
  readonly diagnosedIds: ReadonlySet<string>
  readonly scope: ExploreScope
  readonly view: TreeViewState
  readonly onSelect: (id: string) => void
  readonly onViewChange: (view: TreeViewState) => void
  readonly onOpenScope: (scope: ExploreScope) => void
}

export function GardenExplorer({
  index,
  selectedId,
  diagnosedIds,
  scope,
  view,
  onSelect,
  onViewChange,
  onOpenScope,
}: GardenExplorerProps) {
  const scopeKey = scope.kind === 'branch'
    ? `branch:${scope.id}:${scope.page ?? 0}`
    : scope.kind === 'canopy'
      ? `canopy:${scope.branchId}:${scope.canopyId}`
      : `overview:${scope.page ?? 0}`
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [scopeKey])

  const selectFromTree = (id: string) => {
    if (index.items.get(id)?.item.kind === 'branch') {
      onOpenScope({ kind: 'branch', id })
      return
    }
    onSelect(id)
  }

  const handleViewChange = (nextView: TreeViewState) => {
    // Leaving a Branch (clearing focus) returns to the Garden map rather than
    // to the unbounded top-level canvas.
    if (scope.kind === 'branch' && nextView.focusedId === undefined) {
      onOpenScope({ kind: 'overview' })
      return
    }
    if (scope.kind === 'canopy' && nextView.focusedId === undefined) {
      onOpenScope({ kind: 'branch', id: scope.branchId })
      return
    }
    onViewChange(nextView)
  }

  return (
    <div className="workspace__explorer-stage" key={scopeKey}>
      {scope.kind === 'overview' && (
        <GardenOverviewMap
          index={index}
          page={scope.page ?? 0}
          selectedId={selectedId}
          diagnosedIds={diagnosedIds}
          onOpenScope={onOpenScope}
          headingRef={headingRef}
        />
      )}
      {scope.kind === 'branch' && (
        <LivingThreadTree
          index={index}
          branchId={scope.id}
          page={scope.page ?? 0}
          selectedId={selectedId}
          diagnosedIds={diagnosedIds}
          view={view}
          onSelect={selectFromTree}
          onViewChange={handleViewChange}
          onOpenCanopy={(canopyId) => onOpenScope({ kind: 'canopy', branchId: scope.id, canopyId })}
          headingRef={headingRef}
        />
      )}
      {scope.kind === 'canopy' && (
        <CanopyTree
          index={index}
          branchId={scope.branchId}
          canopyId={scope.canopyId}
          selectedId={selectedId}
          diagnosedIds={diagnosedIds}
          view={view}
          onSelect={onSelect}
          onViewChange={handleViewChange}
          onOpenCanopy={(canopyId) => onOpenScope({ kind: 'canopy', branchId: scope.branchId, canopyId })}
          headingRef={headingRef}
        />
      )}
    </div>
  )
}

interface GardenOverviewMapProps {
  readonly index: GardenIndex
  readonly page: number
  readonly selectedId: string | undefined
  readonly diagnosedIds: ReadonlySet<string>
  readonly onOpenScope: (scope: ExploreScope) => void
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}

/**
 * The overview is a real Tree, not a card grid: a trunk with one limb per
 * living research thread. Each limb is the Branch itself -- choosing one is
 * the drill-down, and the map never grows with the Garden beneath it.
 */
function GardenOverviewMap({ index, page, selectedId, diagnosedIds, onOpenScope, headingRef }: GardenOverviewMapProps) {
  const pages = overviewPageCount(index)
  return (
    <section className="garden-map" aria-labelledby="garden-map-title">
      <div className="garden-map__intro">
        <p className="garden-overview__eyebrow">Garden map</p>
        <h2 id="garden-map-title" ref={headingRef} tabIndex={-1}>Choose a living branch</h2>
        <p>Each limb is a research thread. Choose one to see what it carries.</p>
        {pages > 1 && (
          <div className="garden-overview__pages" aria-label="Garden map pages">
            <button type="button" disabled={page === 0} onClick={() => onOpenScope({ kind: 'overview', page: page - 1 })}>Previous threads</button>
            <span>Threads {page + 1} of {pages}</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => onOpenScope({ kind: 'overview', page: page + 1 })}>More threads</button>
          </div>
        )}
      </div>
      <GardenTree
        index={index}
        selectedId={selectedId}
        diagnosedIds={diagnosedIds}
        onSelect={(id) => onOpenScope({ kind: 'branch', id })}
        view={{ collapsedIds: new Set(index.topLevelIds), focusedId: undefined }}
        onViewChange={() => undefined}
        rows={overviewTreeRows(index, page)}
        projection="overview"
        scopeKey={`overview:${page}`}
      />
    </section>
  )
}

interface LivingThreadTreeProps {
  readonly index: GardenIndex
  readonly branchId: string
  readonly page: number
  readonly selectedId: string | undefined
  readonly diagnosedIds: ReadonlySet<string>
  readonly view: TreeViewState
  readonly onSelect: (id: string) => void
  readonly onViewChange: (view: TreeViewState) => void
  readonly onOpenCanopy: (canopyId: string) => void
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}

/**
 * A research thread: the Branch focused as a full Tree, with a limb rail for
 * the semantic Canopies it carries. Choosing a Canopy bounds the drawing to
 * that kind's own leaves; the Tree stays the canvas either way.
 */
function LivingThreadTree({ index, branchId, page, selectedId, diagnosedIds, view, onSelect, onViewChange, onOpenCanopy, headingRef }: LivingThreadTreeProps) {
  const branch = index.items.get(branchId)?.item
  const canopies = canopyEntries(index, branchId)
  const canopiesCount = allCanopyEntries(index, branchId).length
  return (
    <section className="living-tree" aria-labelledby="living-tree-title">
      <div className="living-tree__intro">
        <p className="garden-overview__eyebrow">Living research thread</p>
        <h2 id="living-tree-title" ref={headingRef} tabIndex={-1}>{branch?.title ?? 'Research thread'}</h2>
        <p>{branch?.body || 'Choose a limb to explore the questions, claims, and observations it carries.'}</p>
        {canopies.length > 0 && (
          <nav className="living-tree__canopies" aria-label={`${branch?.title ?? 'Research thread'} canopies`}>
            {canopies.map((canopy) => (
              <button
                type="button"
                key={canopy.id}
                className="living-tree__canopy-pill"
                onClick={() => onOpenCanopy(canopy.id)}
              >
                <span className="living-tree__canopy-pill-title">{canopy.title}</span>
                <span className="living-tree__canopy-pill-count">{canopy.itemIds.length}</span>
              </button>
            ))}
            {canopiesCount > canopies.length && (
              <span className="living-tree__canopies-more" aria-hidden="true">+{canopiesCount - canopies.length} more</span>
            )}
          </nav>
        )}
      </div>
      <GardenTree
        index={index}
        selectedId={selectedId}
        diagnosedIds={diagnosedIds}
        onSelect={onSelect}
        view={{ ...view, focusedId: branchId }}
        onViewChange={onViewChange}
        projection="nested"
        scopeKey={`branch:${branchId}:${page}`}
      />
    </section>
  )
}

interface CanopyTreeProps {
  readonly index: GardenIndex
  readonly branchId: string
  readonly canopyId: string
  readonly selectedId: string | undefined
  readonly diagnosedIds: ReadonlySet<string>
  readonly view: TreeViewState
  readonly onSelect: (id: string) => void
  readonly onViewChange: (view: TreeViewState) => void
  readonly onOpenCanopy: (canopyId: string) => void
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}

/**
 * One Canopy: the owning Branch with exactly its leaves drawn, cross-links
 * intact. This is the bounded surface the cards redesign reached for -- kept
 * as a real Tree so the relational edges between the leaves survive the zoom.
 */
function CanopyTree({ index, branchId, canopyId, selectedId, diagnosedIds, view, onSelect, onViewChange, onOpenCanopy, headingRef }: CanopyTreeProps) {
  const allCanopies = allCanopyEntries(index, branchId)
  const canopy = allCanopies.find((entry) => entry.id === canopyId)
  if (!canopy) return <p className="living-tree__empty">This Canopy is no longer available.</p>

  const kindPrefix = canopyId.slice(0, canopyId.lastIndexOf(':') + 1)
  const canopyPages = allCanopies.filter((entry) => entry.id.startsWith(kindPrefix))
  const canopyPosition = canopyPages.findIndex((entry) => entry.id === canopyId)
  const previous = canopyPages[canopyPosition - 1]
  const next = canopyPages[canopyPosition + 1]

  return (
    <section className="living-tree living-tree--canopy" aria-labelledby="canopy-tree-title">
      <div className="living-tree__intro">
        <p className="garden-overview__eyebrow">Canopy</p>
        <h2 id="canopy-tree-title" ref={headingRef} tabIndex={-1}>{canopy.title}</h2>
        <p>{canopy.description}</p>
        {(previous || next) && (
          <div className="garden-overview__pages" aria-label={`${canopy.title} pages`}>
            <button type="button" disabled={!previous} onClick={() => previous && onOpenCanopy(previous.id)}>Previous plants</button>
            <span>Canopy {canopyPosition + 1} of {canopyPages.length}</span>
            <button type="button" disabled={!next} onClick={() => next && onOpenCanopy(next.id)}>More plants</button>
          </div>
        )}
      </div>
      <GardenTree
        index={index}
        selectedId={selectedId}
        diagnosedIds={diagnosedIds}
        onSelect={onSelect}
        view={{ ...view, focusedId: branchId }}
        onViewChange={onViewChange}
        rows={canopyTreeRows(index, branchId, canopyId)}
        projection="nested"
        scopeKey={`canopy:${canopyId}`}
      />
    </section>
  )
}

export interface ExploreNavigatorProps {
  readonly index: GardenIndex
  readonly scope: ExploreScope
  readonly view: TreeViewState
  readonly selectedId: string | undefined
  readonly onBack: () => void
  readonly onMove: (id: string) => void
}

export function ExploreNavigator({ index, scope, view, selectedId, onBack, onMove }: ExploreNavigatorProps) {
  const ids = scopedItemIds(index, scope, view)
  const previous = nextScopedId(ids, selectedId, -1)
  const next = nextScopedId(ids, selectedId, 1)
  const label = scopeLabel(index, scope)
  const backLabel = scope.kind === 'canopy' ? 'Research thread' : 'Garden map'
  return (
    <nav className="garden-explorer-nav" aria-label="Garden exploration">
      <div className="garden-explorer-nav__crumbs">
        {scope.kind !== 'overview' ? (
          <button type="button" className="garden-explorer-nav__back" onClick={onBack}>
            <span aria-hidden="true">←</span> {backLabel}
          </button>
        ) : (
          <span aria-current="page">Garden map</span>
        )}
        {scope.kind !== 'overview' && <span aria-hidden="true">/</span>}
        {scope.kind !== 'overview' && <span aria-current="page">{label}</span>}
      </div>
      {scope.kind !== 'overview' && (
        <div className="garden-explorer-nav__controls" aria-label="Move through this view">
          <button type="button" onClick={() => previous && onMove(previous)} disabled={!previous}>
            Previous
          </button>
          <span className="garden-explorer-nav__status" role="status" aria-live="polite">
            {scopeDescription(index, scope)}
          </span>
          <button type="button" onClick={() => next && onMove(next)} disabled={!next}>
            Next
          </button>
        </div>
      )}
      {scope.kind === 'overview' && (
        <span className="garden-explorer-nav__status" role="status" aria-live="polite">
          {scopeDescription(index, scope)}
        </span>
      )}
    </nav>
  )
}
