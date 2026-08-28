import { describeEditItemFailure, type EditItemResult } from './editItem'
import { describeUndoChangeFailure, type UndoChangeResult } from './undoChange'

/**
 * Garden Activity: a session-visible record that a Garden Action occurred.
 *
 * ADR 0067: activity is private and session-scoped -- held in memory for this
 * browser tab, never persisted -- and it never carries a raw file body or tool
 * result. An entry's `detail` is only ever `describeEditItemFailure` or
 * `describeUndoChangeFailure`'s output, and both of those are built from a
 * fixed set of app-authored sentences -- the action's own `blocked`/`stale`/
 * refusal messages -- never from a caught error's own message, which is where
 * file content could otherwise leak in (see the `catch` blocks in `editItem.ts`
 * and `undoChange.ts`, which deliberately never surface `error.message`).
 */

export type GardenActivityAction = 'edit_item' | 'undo_change'
export type GardenActivityOutcome = 'success' | 'failure'

export interface GardenActivityEntry {
  readonly id: string
  readonly action: GardenActivityAction
  readonly at: string
  readonly itemIds: readonly string[]
  readonly outcome: GardenActivityOutcome
  /** A short, person-facing reason for a failure. Never raw file content. */
  readonly detail: string | undefined
}

/** Keeps the session feed bounded; older entries are simply not needed. */
const MAX_ENTRIES = 100

export function recordGardenActivity(
  log: readonly GardenActivityEntry[],
  entry: GardenActivityEntry,
): readonly GardenActivityEntry[] {
  return [entry, ...log].slice(0, MAX_ENTRIES)
}

export function activityForEditItem(
  itemId: string,
  result: EditItemResult,
  id: string,
  at: string,
): GardenActivityEntry {
  return {
    id,
    action: 'edit_item',
    at,
    itemIds: [itemId],
    outcome: result.kind === 'saved' ? 'success' : 'failure',
    detail: describeEditItemFailure(result),
  }
}

export function activityForUndoChange(
  itemId: string,
  result: UndoChangeResult,
  id: string,
  at: string,
): GardenActivityEntry {
  return {
    id,
    action: 'undo_change',
    at,
    itemIds: [itemId],
    outcome: result.kind === 'restored' ? 'success' : 'failure',
    detail: describeUndoChangeFailure(result),
  }
}
