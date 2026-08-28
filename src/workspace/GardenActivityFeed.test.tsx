/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import { GardenActivityFeed } from './GardenActivityFeed'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'

const saved: GardenActivityEntry = {
  id: 'entry-1',
  action: 'edit_item',
  at: '2026-08-27T12:00:00Z',
  itemIds: [BRANCH],
  outcome: 'success',
  detail: undefined,
}

const refused: GardenActivityEntry = {
  id: 'entry-2',
  action: 'edit_item',
  at: '2026-08-27T12:05:00Z',
  itemIds: [BRANCH],
  outcome: 'failure',
  detail: 'This item changed on disk since it was opened for editing.',
}

describe('an empty Garden Activity feed', () => {
  it('says nothing has happened yet', () => {
    render(<GardenActivityFeed entries={[]} titleFor={() => undefined} />)

    expect(screen.getByText(/nothing/i)).toBeInTheDocument()
  })
})

describe('a feed with entries', () => {
  it('names the action', () => {
    render(<GardenActivityFeed entries={[saved]} titleFor={() => 'Attention mechanisms'} />)

    expect(screen.getByText(/edit/i)).toBeInTheDocument()
  })

  it('shows the affected item by its title when known', () => {
    render(<GardenActivityFeed entries={[saved]} titleFor={() => 'Attention mechanisms'} />)

    expect(screen.getByText(/Attention mechanisms/)).toBeInTheDocument()
  })

  // ticket 12: "affected item IDs" is what the feed is asked to show, not a
  // title standing in for one -- so the id is always present, title or not.
  it('shows the stable item id even when a title is also known', () => {
    render(<GardenActivityFeed entries={[saved]} titleFor={() => 'Attention mechanisms'} />)

    expect(screen.getByText(new RegExp(BRANCH))).toBeInTheDocument()
  })

  it('falls back to the item id alone when no title is known', () => {
    render(<GardenActivityFeed entries={[saved]} titleFor={() => undefined} />)

    expect(screen.getByText(new RegExp(BRANCH))).toBeInTheDocument()
  })

  it('shows the outcome', () => {
    render(<GardenActivityFeed entries={[saved, refused]} titleFor={() => 'Attention mechanisms'} />)

    expect(screen.getAllByText(/succeeded/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/failed/i).length).toBeGreaterThan(0)
  })

  it('shows the failure reason for a failed action', () => {
    render(<GardenActivityFeed entries={[refused]} titleFor={() => 'Attention mechanisms'} />)

    expect(screen.getByText(/changed on disk/i)).toBeInTheDocument()
  })

  it('never renders raw body content -- only the short detail message', () => {
    render(<GardenActivityFeed entries={[refused]} titleFor={() => 'Attention mechanisms'} />)

    // The detail on a real entry is always a short reason (see gardenActivity.ts),
    // never file content; this asserts the feed renders exactly that string and
    // nothing beyond it for the entry.
    expect(screen.getByText(refused.detail as string)).toBeInTheDocument()
  })

  it('orders entries newest first, as given', () => {
    const { container } = render(
      <GardenActivityFeed entries={[refused, saved]} titleFor={() => 'Attention mechanisms'} />,
    )

    const ids = [...container.querySelectorAll('[data-entry-id]')].map((node) =>
      node.getAttribute('data-entry-id'),
    )
    expect(ids).toEqual(['entry-2', 'entry-1'])
  })
})
