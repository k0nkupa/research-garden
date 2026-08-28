import { describe, expect, it } from 'vitest'
import type { EditItemResult } from './editItem'
import type { UndoChangeResult } from './undoChange'
import {
  activityForEditItem,
  activityForUndoChange,
  recordGardenActivity,
  type GardenActivityEntry,
} from './gardenActivity'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const AT = '2026-08-27T12:00:00Z'

describe('an entry for a successful edit', () => {
  const saved: EditItemResult = {
    kind: 'saved',
    itemId: BRANCH,
    path: ['branches', 'attention.md'],
    snapshotId: 'snap-1',
    previousHash: 'sha256:before',
    resultingHash: 'sha256:after',
  }

  it('names the action, time, item, and a success outcome', () => {
    const entry = activityForEditItem(BRANCH, saved, 'entry-1', AT)

    expect(entry).toMatchObject({
      id: 'entry-1',
      action: 'edit_item',
      at: AT,
      itemIds: [BRANCH],
      outcome: 'success',
    })
  })

  it('carries no detail, and therefore no body content', () => {
    const entry = activityForEditItem(BRANCH, saved, 'entry-1', AT)

    expect(entry.detail).toBeUndefined()
  })
})

describe('an entry for a failed edit', () => {
  const evidenceRefused: EditItemResult = {
    kind: 'evidence-refused',
    message: "A Root's captured evidence cannot be edited.",
    changes: [{ field: 'body', from: 'the entire original excerpt text', to: 'a rewritten excerpt' }],
  }

  it('reports a failure outcome', () => {
    const entry = activityForEditItem(BRANCH, evidenceRefused, 'entry-2', AT)

    expect(entry.outcome).toBe('failure')
  })

  it('carries a short detail message, not the raw evidence text', () => {
    const entry = activityForEditItem(BRANCH, evidenceRefused, 'entry-2', AT)

    expect(entry.detail).toBe("A Root's captured evidence cannot be edited.")
    expect(entry.detail).not.toContain('the entire original excerpt text')
    expect(entry.detail).not.toContain('a rewritten excerpt')
  })

  it('never exposes the raw body content anywhere on the entry', () => {
    const entry = activityForEditItem(BRANCH, evidenceRefused, 'entry-2', AT)
    const serialized = JSON.stringify(entry)

    expect(serialized).not.toContain('the entire original excerpt text')
    expect(serialized).not.toContain('a rewritten excerpt')
  })
})

describe('an entry for a successful Undo', () => {
  const restored: UndoChangeResult = {
    kind: 'restored',
    itemId: BRANCH,
    path: ['branches', 'attention.md'],
    restoredHash: 'sha256:restored',
    snapshotId: 'snap-2',
  }

  it('names the action as undo_change with a success outcome', () => {
    const entry = activityForUndoChange(BRANCH, restored, 'entry-3', AT)

    expect(entry).toMatchObject({ action: 'undo_change', outcome: 'success', itemIds: [BRANCH] })
  })
})

describe('an entry for a refused Undo', () => {
  const stale: UndoChangeResult = {
    kind: 'stale',
    message: 'This item changed again after the edit Undo would revert.',
  }

  it('reports a failure outcome with the refusal reason', () => {
    const entry = activityForUndoChange(BRANCH, stale, 'entry-4', AT)

    expect(entry.outcome).toBe('failure')
    expect(entry.detail).toBe('This item changed again after the edit Undo would revert.')
  })
})

describe('recording activity into a session log', () => {
  const entry = (id: string): GardenActivityEntry => ({
    id,
    action: 'edit_item',
    at: AT,
    itemIds: [BRANCH],
    outcome: 'success',
    detail: undefined,
  })

  it('adds the newest entry to the front', () => {
    const log = recordGardenActivity([entry('older')], entry('newer'))

    expect(log.map((e) => e.id)).toEqual(['newer', 'older'])
  })

  it('does not mutate the log it was given', () => {
    const original = [entry('older')]

    recordGardenActivity(original, entry('newer'))

    expect(original).toHaveLength(1)
  })
})
