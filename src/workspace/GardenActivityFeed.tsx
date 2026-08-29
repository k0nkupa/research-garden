import type { GardenActivityAction, GardenActivityEntry } from '../garden/gardenActivity'

/**
 * The Garden Activity feed.
 *
 * ADR 0067: action name, time, affected item IDs, and outcome -- never a raw
 * file body or tool result. Every field this renders comes straight off the
 * entry (`gardenActivity.ts` is what keeps raw content out of it in the first
 * place); this component adds nothing beyond a title alongside the id, for
 * readability. The id itself is always shown -- ticket 12 asks for "affected
 * item IDs" specifically, not a title in place of one.
 */
export interface GardenActivityFeedProps {
  readonly entries: readonly GardenActivityEntry[]
  readonly titleFor: (itemId: string) => string | undefined
}

const ACTION_LABELS: Record<GardenActivityAction, string> = {
  edit_item: 'Edit',
  undo_change: 'Undo',
  approve_change: 'Approve',
  reject_change: 'Reject',
  connect_agent: 'Connect',
  disconnect_agent: 'Disconnect',
  inspect_garden: 'Inspect',
  search_garden: 'Search',
  read_items: 'Read',
  audit_garden: 'Audit',
  plant_seed: 'Plant Seed',
  capture_root: 'Capture Root',
  add_leaf: 'Add Leaf',
  explore_branch: 'Explore Branch',
  trace_evidence: 'Trace Evidence',
  find_open_questions: 'Find Open Questions',
  find_contradictions: 'Find Contradictions',
  prepare_source_comparison: 'Prepare Source Comparison',
  prepare_seed_cultivation: 'Prepare Seed Cultivation',
}

function formatTime(at: string): string {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleString()
}

export function GardenActivityFeed({ entries, titleFor }: GardenActivityFeedProps) {
  if (entries.length === 0) {
    return (
      <aside className="item-panel item-panel--empty" aria-label="Garden Activity">
        <p className="item-panel__invitation">
          Nothing has happened in this Garden yet this session.
        </p>
      </aside>
    )
  }

  return (
    <aside className="item-panel" aria-label="Garden Activity">
      <header className="item-panel__header">
        <p className="item-panel__kind">Garden Activity</p>
        <h2 className="item-panel__title">This session</h2>
      </header>

      <ul className="activity">
        {entries.map((entry) => (
          <li key={entry.id} className="activity__entry" data-entry-id={entry.id}>
            <p className="activity__summary">
              <span className="activity__action">{ACTION_LABELS[entry.action]}</span>{' '}
              <span
                className={
                  entry.outcome === 'success' ? 'activity__outcome' : 'activity__outcome activity__outcome--failure'
                }
              >
                {entry.outcome === 'success' ? 'succeeded' : 'failed'}
              </span>
            </p>
            {entry.itemIds.length > 0 && (
              <p className="activity__subjects">
                {entry.itemIds
                  .map((itemId) => {
                    const title = titleFor(itemId)
                    return title ? `${title} (${itemId})` : itemId
                  })
                  .join(', ')}
              </p>
            )}
            <p className="activity__time">{formatTime(entry.at)}</p>
            {entry.detail && <p className="activity__detail">{entry.detail}</p>}
          </li>
        ))}
      </ul>
    </aside>
  )
}
