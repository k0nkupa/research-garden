import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from './gardenIndex'
import { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, searchGardenIndex } from './gardenSearch'

function file(lines: string[], body: string) {
  return [
    '---',
    'schema_version: 1',
    ...lines,
    'created_at: 2026-08-01T10:00:00Z',
    'updated_at: 2026-08-01T10:00:00Z',
    '---',
    '',
    body,
    '',
  ].join('\n')
}

const B = (n: string) => `branch_01HQ8X2K3M4N5P6Q7R8S9T0${n}W`
const L = (n: string) => `question_leaf_01HQ8X2K3M4N5P6Q7R8S9T0${n}W`
const R = (n: string) => `root_01HQ8X2K3M4N5P6Q7R8S9T0${n}W`

// Crockford base32 without I, L, O, U -- matching ULID_PATTERN in itemIdentity.ts
// -- so a generated batch of ids is guaranteed valid rather than merely likely to be.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function bulkSuffix(n: number): string {
  const high = CROCKFORD[Math.floor(n / CROCKFORD.length) % CROCKFORD.length] as string
  const low = CROCKFORD[n % CROCKFORD.length] as string
  return high + low
}

const branch = (id: string, title: string, body = 'A body.', state = 'active') => ({
  path: ['branches', `${id}.md`],
  text: file([`id: ${id}`, 'kind: branch', `title: ${title}`, `state: ${state}`], body),
})

const question = (id: string, title: string, body: string, parentId: string) => ({
  path: ['leaves', `${id}.md`],
  text: file(['id: ' + id, 'kind: question_leaf', `title: ${title}`, `parent_id: ${parentId}`], body),
})

const root = (id: string, title: string, body: string) => ({
  path: ['roots', `${id}.md`],
  text: file(
    ['id: ' + id, 'kind: root', `title: ${title}`, 'captured_at: 2026-08-01T10:00:00Z', 'content_hash: abc123'],
    body,
  ),
})

const OPTIMISERS = B('B1')
const DORMANT = B('B2')

describe('searching the Garden Index', () => {
  it('finds an item whose title contains the query', async () => {
    const index = await buildGardenIndex([branch(OPTIMISERS, 'Gradient descent optimisers')])

    const results = searchGardenIndex(index, 'descent')

    expect(results).toEqual([
      expect.objectContaining({ itemId: OPTIMISERS, kind: 'branch', title: 'Gradient descent optimisers' }),
    ])
  })

  it('finds an item whose body contains the query but whose title does not', async () => {
    const index = await buildGardenIndex([
      branch(OPTIMISERS, 'Optimisers', 'Adam converges faster than plain SGD in practice.'),
    ])

    const results = searchGardenIndex(index, 'converges')

    expect(results.map((r) => r.itemId)).toEqual([OPTIMISERS])
  })

  it('matches case-insensitively', async () => {
    const index = await buildGardenIndex([branch(OPTIMISERS, 'Optimisers')])

    expect(searchGardenIndex(index, 'OPTIMISERS')).toHaveLength(1)
    expect(searchGardenIndex(index, 'optimisers')).toHaveLength(1)
  })

  it('identifies each match by kind, title, and stable item id', async () => {
    const index = await buildGardenIndex([branch(OPTIMISERS, 'Optimisers')])

    const [result] = searchGardenIndex(index, 'Optimisers')

    expect(result).toMatchObject({ itemId: OPTIMISERS, kind: 'branch', title: 'Optimisers' })
  })

  it('returns a snippet with surrounding context around a body match', async () => {
    const index = await buildGardenIndex([
      branch(
        OPTIMISERS,
        'Optimisers',
        'Long before the interesting part, there is a discussion of Adam and how it converges quickly in most cases we tried, long after too.',
      ),
    ])

    const [result] = searchGardenIndex(index, 'converges')

    expect(result?.snippet).toContain('converges')
    // Context on both sides, not just the bare match.
    expect(result?.snippet).toContain('Adam')
    expect(result?.snippet).toContain('quickly')
    // The snippet is shorter than the whole body -- it is a fragment, not everything.
    expect(result?.snippet.length).toBeLessThan(
      'Long before the interesting part, there is a discussion of Adam and how it converges quickly in most cases we tried, long after too.'
        .length,
    )
  })

  it('gives a title-only match a snippet drawn from the body for context', async () => {
    const index = await buildGardenIndex([
      branch(OPTIMISERS, 'Optimisers', 'What this Branch is collecting.'),
    ])

    const [result] = searchGardenIndex(index, 'Optimisers')

    expect(result?.snippet).toContain('What this Branch is collecting')
  })

  it('ranks a title match above a body-only match', async () => {
    const bodyOnly = R('R1')
    const titleMatch = B('B3')

    const index = await buildGardenIndex([
      root(bodyOnly, 'Some evidence', 'Discusses gradients at length.'),
      branch(titleMatch, 'Gradients', 'Nothing relevant here.'),
    ])

    const results = searchGardenIndex(index, 'gradient')

    expect(results.map((r) => r.itemId)).toEqual([titleMatch, bodyOnly])
  })

  it('returns nothing for an empty query', async () => {
    const index = await buildGardenIndex([branch(OPTIMISERS, 'Optimisers')])

    expect(searchGardenIndex(index, '')).toEqual([])
    expect(searchGardenIndex(index, '   ')).toEqual([])
  })

  it('returns nothing when nothing matches', async () => {
    const index = await buildGardenIndex([branch(OPTIMISERS, 'Optimisers')])

    expect(searchGardenIndex(index, 'nonexistent-term')).toEqual([])
  })

  it('defaults to ten results', async () => {
    const files = Array.from({ length: 14 }, (_, n) =>
      branch(B(bulkSuffix(n)), `Growth topic ${n}`),
    )
    const index = await buildGardenIndex(files)
    // The generated ids must all be valid, or an id collision or diagnostic
    // would understate the pool and this test would pass for the wrong reason.
    expect(index.items.size).toBe(14)

    expect(searchGardenIndex(index, 'growth')).toHaveLength(DEFAULT_SEARCH_RESULTS)
  })

  it('caps results at twenty-five even when more are requested', async () => {
    const files = Array.from({ length: 30 }, (_, n) =>
      branch(B(bulkSuffix(n)), `Growth topic ${n}`),
    )
    const index = await buildGardenIndex(files)
    expect(index.items.size).toBe(30)

    expect(searchGardenIndex(index, 'growth', 1000)).toHaveLength(MAX_SEARCH_RESULTS)
  })

  it('honours a requested limit below the default', async () => {
    const files = Array.from({ length: 5 }, (_, n) => branch(B(bulkSuffix(n)), `Growth topic ${n}`))
    const index = await buildGardenIndex(files)
    expect(index.items.size).toBe(5)

    expect(searchGardenIndex(index, 'growth', 2)).toHaveLength(2)
  })

  it('keeps a Dormant Branch and the items beneath it searchable', async () => {
    const child = L('G1')
    const index = await buildGardenIndex([
      branch(DORMANT, 'Wintering research', 'Set aside for the season.', 'dormant'),
      question(child, 'Still worth asking', 'A question left under the dormant Branch.', DORMANT),
    ])

    const results = searchGardenIndex(index, 'wintering')
    expect(results.map((r) => r.itemId)).toContain(DORMANT)

    const childResults = searchGardenIndex(index, 'still worth asking')
    expect(childResults.map((r) => r.itemId)).toContain(child)
  })

  it('keeps an item carrying a Garden Diagnostic findable', async () => {
    // A parent that does not exist produces a Diagnostic (ADR 0052) but the
    // item itself still validates and stays in the index.
    const orphan = L('G2')
    const index = await buildGardenIndex([question(orphan, 'Orphaned but valid', 'Body text.', OPTIMISERS)])

    expect(index.diagnostics.length).toBeGreaterThan(0)
    expect(searchGardenIndex(index, 'orphaned').map((r) => r.itemId)).toEqual([orphan])
  })

  it('never returns a file that failed to validate at all', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'broken.md'], text: 'not a Garden item, just the word growth\n' },
    ])

    expect(searchGardenIndex(index, 'growth')).toEqual([])
  })
})
