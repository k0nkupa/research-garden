import { describeApproveChangeFailure, type ApproveChangeResult } from './approveChange'
import { describeEditItemFailure, type EditItemResult } from './editItem'
import { describeRejectChangeFailure, type RejectChangeResult } from './rejectChange'
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
 *
 * `inspect_garden`/`search_garden`/`read_items`/`audit_garden` (ticket 18)
 * have no `activityForX` builder here, unlike every action above: their
 * entries are built directly in `readTool.ts`'s `createReadTool`, from the
 * common WebMCP result envelope every one of them already returns, rather
 * than from a bespoke per-action result union each `describeXFailure` would
 * otherwise exist only to unwrap.
 */

export type GardenActivityAction =
  | 'edit_item'
  | 'undo_change'
  | 'approve_change'
  | 'reject_change'
  | 'connect_agent'
  | 'disconnect_agent'
  | 'inspect_garden'
  | 'search_garden'
  | 'read_items'
  | 'audit_garden'
  | 'plant_seed'
  | 'capture_root'
  | 'add_leaf'
  | 'explore_branch'
  | 'trace_evidence'
  | 'find_open_questions'
  | 'find_contradictions'
  | 'prepare_source_comparison'
  | 'prepare_seed_cultivation'
  | 'propose_relation'
  | 'propose_move'
  | 'propose_harvest'
  | 'list_pending_changes'
  | 'inspect_pending_change'
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

export function activityForApproveChange(
  itemId: string,
  result: ApproveChangeResult,
  id: string,
  at: string,
): GardenActivityEntry {
  return {
    id,
    action: 'approve_change',
    at,
    itemIds: [itemId],
    outcome: result.kind === 'applied' ? 'success' : 'failure',
    detail: describeApproveChangeFailure(result),
  }
}

export function activityForRejectChange(
  itemId: string,
  result: RejectChangeResult,
  id: string,
  at: string,
): GardenActivityEntry {
  return {
    id,
    action: 'reject_change',
    at,
    itemIds: [itemId],
    outcome: result.kind === 'rejected' ? 'success' : 'failure',
    detail: describeRejectChangeFailure(result),
  }
}

/**
 * Connect and Disconnect (ticket 17) are local state flips, not Garden
 * Actions that can be refused -- there is no `ConnectAgentResult` to
 * describe a failure from, so unlike every action above, these two always
 * report success and name no affected item.
 */
export function activityForConnectAgent(id: string, at: string): GardenActivityEntry {
  return { id, action: 'connect_agent', at, itemIds: [], outcome: 'success', detail: undefined }
}

export function activityForDisconnectAgent(id: string, at: string): GardenActivityEntry {
  return { id, action: 'disconnect_agent', at, itemIds: [], outcome: 'success', detail: undefined }
}
