import type { GardenIndex } from '../domain/index/gardenIndex'
import type { GardenItemKind } from '../domain/schema/itemIdentity'
import { visibleTreeRows, type TreeRow, type TreeViewState } from './treeView'

/**
 * The large-garden projection is view state only. Canonical items continue to
 * live in the Index and the Markdown files; these modes only decide which
 * small surface is worth putting in front of someone.
 */
export type ExploreScope =
  | { readonly kind: 'overview'; readonly page?: number }
  | { readonly kind: 'branch'; readonly id: string; readonly page?: number }
  | { readonly kind: 'canopy'; readonly branchId: string; readonly canopyId: string }

export interface OverviewEntry {
  readonly id: string
  readonly title: string
  readonly count: number
}

export interface CanopyEntry {
  readonly id: string
  readonly branchId: string
  readonly title: string
  readonly description: string
  readonly itemIds: readonly string[]
}

/** A Canopy is intentionally small enough to stay legible as a single limb. */
export const MAX_ITEMS_PER_CANOPY = 5
/** The focused thread shows a handful of limbs, then asks the person to explore. */
export const MAX_CANOPIES_PER_THREAD = 5
export const MAX_BRANCHES_ON_MAP = 5

export function usesExploreProjection(index: GardenIndex): boolean {
  // A living Garden starts from research threads, regardless of its current
  // size. The legacy all-record Tree remains a truthful fallback only when a
  // repository has not cultivated an active Branch yet.
  return index.topLevelIds.some((id) => {
    const item = index.items.get(id)?.item
    return item?.kind === 'branch' && item.state === 'active'
  })
}

function directThreadItems(index: GardenIndex, branchId: string) {
  return index.items.get(branchId)?.childIds
    .map((id) => index.items.get(id)?.item)
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .filter((item) => item.kind !== 'branch') ?? []
}

export function nestedBranchIds(index: GardenIndex, branchId: string): readonly string[] {
  return index.items.get(branchId)?.childIds
    .filter((id) => index.items.get(id)?.item.kind === 'branch')
    ?? []
}

function canopyDefinition(kind: GardenItemKind): { title: string; description: string } {
  switch (kind) {
    case 'question_leaf': return { title: 'Open questions', description: 'Questions this thread is still carrying.' }
    case 'claim_leaf': return { title: 'Working claims', description: 'Source-backed assertions being tested.' }
    case 'idea_leaf': return { title: 'Possible directions', description: 'Explanations or actions worth exploring.' }
    case 'observation_leaf': return { title: 'Observations', description: 'Provisional things noticed in this thread.' }
    case 'harvest': return { title: 'Harvests', description: 'Synthesis ready to be read in context.' }
    default: return { title: 'Cultivated material', description: 'Material attached to this research thread.' }
  }
}

/** Semantic first; deterministic title ordering second. */
export function allCanopyEntries(index: GardenIndex, branchId: string): readonly CanopyEntry[] {
  const grouped = new Map<GardenItemKind, string[]>()
  for (const item of directThreadItems(index, branchId)) {
    const entries = grouped.get(item.kind) ?? []
    entries.push(item.id)
    grouped.set(item.kind, entries)
  }

  const canopies: CanopyEntry[] = []
  for (const [kind, ids] of grouped) {
    const sorted = [...ids].sort((left, right) =>
      (index.items.get(left)?.item.title ?? '').localeCompare(index.items.get(right)?.item.title ?? ''),
    )
    const definition = canopyDefinition(kind)
    for (let offset = 0; offset < sorted.length; offset += MAX_ITEMS_PER_CANOPY) {
      const page = Math.floor(offset / MAX_ITEMS_PER_CANOPY)
      canopies.push({
        id: `canopy:${branchId}:${kind}:${page + 1}`,
        branchId,
        title: page === 0 ? definition.title : `${definition.title} ${page + 1}`,
        description: definition.description,
        itemIds: sorted.slice(offset, offset + MAX_ITEMS_PER_CANOPY),
      })
    }
  }
  return canopies.sort((left, right) => left.title.localeCompare(right.title))
}

/** One limb per semantic thought type; individual Canopies page their plants. */
export function canopyEntries(index: GardenIndex, branchId: string): readonly CanopyEntry[] {
  return allCanopyEntries(index, branchId)
    .filter((canopy) => canopy.id.endsWith(':1'))
    .slice(0, MAX_CANOPIES_PER_THREAD)
}

export function canopyEntry(index: GardenIndex, branchId: string, canopyId: string): CanopyEntry | undefined {
  return allCanopyEntries(index, branchId).find((canopy) => canopy.id === canopyId)
}

/** Only active research threads appear in the initial living-Garden map. */
export function overviewPageCount(index: GardenIndex): number {
  const count = index.topLevelIds
    .map((id) => index.items.get(id)?.item)
    .filter((item): item is NonNullable<typeof item> => item?.kind === 'branch' && item.state === 'active')
    .length
  return Math.max(1, Math.ceil(count / MAX_BRANCHES_ON_MAP))
}

export function overviewEntries(index: GardenIndex, page = 0): readonly OverviewEntry[] {
  return index.topLevelIds
    .map((id) => index.items.get(id)?.item)
    .filter((item): item is NonNullable<typeof item> => item?.kind === 'branch' && item.state === 'active')
    .map((branch) => ({ id: branch.id, title: branch.title, count: directThreadItems(index, branch.id).length }))
    .slice(page * MAX_BRANCHES_ON_MAP, (page + 1) * MAX_BRANCHES_ON_MAP)
}

/** Finds the containing research thread for a selected result. */
export function containingBranchId(index: GardenIndex, itemId: string): string | undefined {
  const item = index.items.get(itemId)
  if (item?.item.kind === 'branch') return itemId
  return item?.item.parentId
}

export function canopyForItem(index: GardenIndex, branchId: string, itemId: string): CanopyEntry | undefined {
  return allCanopyEntries(index, branchId).find((canopy) => canopy.itemIds.includes(itemId))
}

/**
 * Rows for the overview projection: one row per active Branch, nothing deeper.
 *
 * The overview is the Garden's front door, and the Tree it draws is the map:
 * a trunk with a Branch per living research thread. Everything beneath a
 * Branch is intentionally left for the Branch's own focused view, so the map
 * stays small no matter how large the Garden underneath it grows (ADR 0061).
 */
export function overviewTreeRows(index: GardenIndex, page = 0): readonly TreeRow[] {
  const entries = overviewEntries(index, page)
  const entryIds = new Set(entries.map((entry) => entry.id))
  return visibleTreeRows(index, { collapsedIds: new Set(index.topLevelIds), focusedId: undefined })
    .filter((row) => entryIds.has(row.id))
}

/**
 * Rows for a Canopy projection: the owning Branch plus exactly its leaves.
 *
 * The rows override lets the explorer bound a Canopy to its own handful of
 * leaves while every part of the botanical rendering -- trunk, limbs, glyphs,
 * cross-links -- keeps working unchanged. ADR 0045's illumination still
 * traces the evidence path through the leaves the view is actually showing.
 */
export function canopyTreeRows(index: GardenIndex, branchId: string, canopyId: string): readonly TreeRow[] {
  const canopy = canopyEntry(index, branchId, canopyId)
  if (!canopy) return []
  const visibleIds = new Set([branchId, ...canopy.itemIds])
  return visibleTreeRows(index, { collapsedIds: new Set(), focusedId: branchId })
    .filter((row) => visibleIds.has(row.id))
}

export function scopedItemIds(
  index: GardenIndex,
  scope: ExploreScope,
  _view: TreeViewState,
): readonly string[] {
  if (scope.kind === 'overview') return overviewEntries(index, scope.page ?? 0).map((entry) => entry.id)
  if (scope.kind === 'branch') return allCanopyEntries(index, scope.id).flatMap((canopy) => canopy.itemIds)
  return canopyEntry(index, scope.branchId, scope.canopyId)?.itemIds ?? []
}

export function scopeLabel(index: GardenIndex, scope: ExploreScope): string {
  if (scope.kind === 'overview') return 'Garden map'
  if (scope.kind === 'branch') return index.items.get(scope.id)?.item.title ?? 'Research thread'
  return canopyEntry(index, scope.branchId, scope.canopyId)?.title ?? 'Canopy'
}

export function scopeDescription(index: GardenIndex, scope: ExploreScope): string {
  if (scope.kind === 'overview') return 'Choose a living research thread'
  if (scope.kind === 'branch') return `${scopeLabel(index, scope)} research thread`
  const count = scopedItemIds(index, scope, { collapsedIds: new Set(), focusedId: undefined }).length
  return `${scopeLabel(index, scope)}, ${count} ${count === 1 ? 'leaf' : 'leaves'}`
}

export function nextScopedId(
  ids: readonly string[],
  selectedId: string | undefined,
  direction: -1 | 1,
): string | undefined {
  if (ids.length === 0) return undefined
  const at = selectedId === undefined ? (direction > 0 ? -1 : ids.length) : ids.indexOf(selectedId)
  const next = at + direction
  return ids[next]
}
