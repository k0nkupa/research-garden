import type { GardenIndex } from '../domain/index/gardenIndex'
import type { GardenItemKind } from '../domain/schema/itemIdentity'

/**
 * What the Tree is currently showing, and what the keyboard does to it.
 *
 * All of this is view state. ADR 0014 is explicit that focusing a Branch
 * changes the view and nothing else, and collapse is the same: a person can
 * fold half their Garden away and every canonical relationship is exactly where
 * it was. Nothing here writes, and nothing here is persisted.
 *
 * Kept as a pure model over the index so the navigation a person actually
 * performs -- traverse, collapse, focus -- can be judged without a browser, and
 * so ADR 0061's promise that collapse and focus *bound* the drawn Tree is a
 * property of a function rather than a hope about rendering.
 */

export interface TreeViewState {
  /** Branches whose descendants are folded away. */
  readonly collapsedIds: ReadonlySet<string>
  /** The one Branch the Tree is showing, if any (ADR 0014). */
  readonly focusedId: string | undefined
}

export const UNFOCUSED: TreeViewState = { collapsedIds: new Set(), focusedId: undefined }

export interface TreeRow {
  readonly id: string
  readonly title: string
  readonly kind: GardenItemKind
  /** 1 for the outermost visible row, as ARIA levels count. */
  readonly depth: number
  readonly parentId: string | undefined
  readonly hasChildren: boolean
  readonly expanded: boolean
  /** ADR 0031: a dormant Branch recedes without leaving the Tree. */
  readonly dormant: boolean
}

/**
 * The rows the Tree is showing, in the order a person reads and traverses them.
 *
 * Depth-first, because that is the order the drawing puts them in and the order
 * a screen reader walks them; keeping one order for both is what stops keyboard
 * navigation from disagreeing with what is on screen.
 */
export function visibleTreeRows(index: GardenIndex, view: TreeViewState): readonly TreeRow[] {
  const rows: TreeRow[] = []

  const visit = (id: string, depth: number, parentId: string | undefined): void => {
    const indexed = index.items.get(id)
    if (!indexed) return

    const hasChildren = indexed.childIds.length > 0
    const expanded = hasChildren && !view.collapsedIds.has(id)

    rows.push({
      id,
      title: indexed.item.title,
      kind: indexed.item.kind,
      depth,
      parentId,
      hasChildren,
      expanded,
      dormant: indexed.item.kind === 'branch' && indexed.item.state === 'dormant',
    })

    if (!expanded) return
    for (const childId of indexed.childIds) visit(childId, depth + 1, id)
  }

  // Focus replaces the trunk's children with one Branch, so the rest of the
  // Garden is out of view without being out of existence (ADR 0014).
  const roots =
    view.focusedId !== undefined && index.items.has(view.focusedId)
      ? [view.focusedId]
      : index.topLevelIds

  for (const id of roots) visit(id, 1, undefined)
  return rows
}

export type TreeKeyAction =
  | { readonly kind: 'move'; readonly toId: string }
  | { readonly kind: 'expand'; readonly id: string }
  | { readonly kind: 'collapse'; readonly id: string }
  | { readonly kind: 'select'; readonly id: string }
  | { readonly kind: 'focus'; readonly id: string }
  | { readonly kind: 'clear-focus' }
  | { readonly kind: 'none' }

const NOTHING: TreeKeyAction = { kind: 'none' }

/**
 * What a keypress means, given what is on screen.
 *
 * This follows the ARIA tree pattern rather than inventing one, because a
 * person who already knows how to drive a tree should not have to learn ours.
 * Focus and clearing focus are the two additions, and they are the two things
 * the pattern has no opinion about.
 */
export function treeKeyAction(
  rows: readonly TreeRow[],
  currentId: string | undefined,
  key: string,
  /** Whether the Tree is currently narrowed to one Branch. */
  focused = false,
): TreeKeyAction {
  if (rows.length === 0) return NOTHING

  const first = rows[0] as TreeRow
  const last = rows[rows.length - 1] as TreeRow

  if (key === 'Home') return { kind: 'move', toId: first.id }
  if (key === 'End') return { kind: 'move', toId: last.id }

  // Only claimed when there is focus to leave, so a stray Escape reaches
  // whatever else on the page is listening for it.
  if (key === 'Escape') return focused ? { kind: 'clear-focus' } : NOTHING

  const at = rows.findIndex((row) => row.id === currentId)
  if (at === -1) {
    // Nothing is current yet, so any navigating key starts at the top.
    return key.startsWith('Arrow') ? { kind: 'move', toId: first.id } : NOTHING
  }

  const current = rows[at] as TreeRow
  const next = rows[at + 1]

  switch (key) {
    case 'ArrowDown':
      return next ? { kind: 'move', toId: next.id } : NOTHING

    case 'ArrowUp':
      return at > 0 ? { kind: 'move', toId: (rows[at - 1] as TreeRow).id } : NOTHING

    case 'ArrowRight':
      if (current.hasChildren && !current.expanded) return { kind: 'expand', id: current.id }
      // An expanded row always has a child below it, but the guard keeps this
      // honest rather than relying on that from a distance.
      if (current.expanded && next) return { kind: 'move', toId: next.id }
      return NOTHING

    case 'ArrowLeft':
      if (current.expanded) return { kind: 'collapse', id: current.id }
      return current.parentId === undefined
        ? NOTHING
        : { kind: 'move', toId: current.parentId }

    case 'Enter':
    case ' ':
      return { kind: 'select', id: current.id }

    // Only a Branch can be focused: focus narrows the Tree to a subtree, and
    // nothing else has one.
    case 'f':
    case 'F':
      return current.kind === 'branch' ? { kind: 'focus', id: current.id } : NOTHING

    default:
      return NOTHING
  }
}

/** Applies an action to the view state, leaving canonical relationships alone. */
export function applyTreeAction(view: TreeViewState, action: TreeKeyAction): TreeViewState {
  switch (action.kind) {
    case 'expand': {
      if (!view.collapsedIds.has(action.id)) return view
      const collapsedIds = new Set(view.collapsedIds)
      collapsedIds.delete(action.id)
      return { ...view, collapsedIds }
    }
    case 'collapse':
      return view.collapsedIds.has(action.id)
        ? view
        : { ...view, collapsedIds: new Set(view.collapsedIds).add(action.id) }
    case 'focus':
      return view.focusedId === action.id ? view : { ...view, focusedId: action.id }
    case 'clear-focus':
      // Returning the same object when nothing changed matters: a new one
      // invalidates the layout memo and re-walks the whole Tree (ADR 0061).
      return view.focusedId === undefined ? view : { ...view, focusedId: undefined }
    default:
      return view
  }
}
