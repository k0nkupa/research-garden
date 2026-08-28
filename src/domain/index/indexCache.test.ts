import { describe, expect, it } from 'vitest'
import {
  CACHE_SCHEMA_VERSION,
  cacheEntryMatches,
  emptyIndexCache,
  parseIndexCache,
  serializeIndexCache,
  type CacheEntry,
  type IndexCacheRecord,
} from './indexCache'
import type { GardenItem } from '../schema/gardenItem'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'

const branchItem: GardenItem = {
  kind: 'branch',
  schemaVersion: 1,
  id: BRANCH,
  title: 'Attention mechanisms',
  parentId: undefined,
  relations: [],
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:00:00Z',
  body: 'What I am collecting about attention.\n',
  state: 'active',
}

const acceptedEntry: CacheEntry = {
  length: 200,
  hash: 'sha256:aaaa',
  outcome: { kind: 'accepted', item: branchItem },
}

const invalidEntry: CacheEntry = {
  length: 40,
  hash: 'sha256:bbbb',
  outcome: {
    kind: 'invalid',
    problems: [{ field: 'kind', message: 'must be one of: seed, root, branch' }],
    identity: { itemId: undefined, title: 'A broken file' },
  },
}

function recordWith(entries: Record<string, CacheEntry>): IndexCacheRecord {
  return { schemaVersion: CACHE_SCHEMA_VERSION, entries: new Map(Object.entries(entries)) }
}

describe('round-tripping the Index Cache', () => {
  it('parses exactly what it serialized, including an accepted entry', () => {
    const record = recordWith({ 'branches/attention.md': acceptedEntry })
    const parsed = parseIndexCache(serializeIndexCache(record))

    expect(parsed?.entries.get('branches/attention.md')).toEqual(acceptedEntry)
  })

  it('parses exactly what it serialized, including an invalid entry', () => {
    const record = recordWith({ 'branches/broken.md': invalidEntry })
    const parsed = parseIndexCache(serializeIndexCache(record))

    expect(parsed?.entries.get('branches/broken.md')).toEqual(invalidEntry)
  })

  it('round-trips an empty cache', () => {
    const parsed = parseIndexCache(serializeIndexCache(emptyIndexCache()))

    expect(parsed?.entries.size).toBe(0)
    expect(parsed?.schemaVersion).toBe(CACHE_SCHEMA_VERSION)
  })
})

describe('an uncertain or unverifiable manifest invalidates the entire cache (ADR 0062)', () => {
  it('rejects text that is not JSON at all', () => {
    expect(parseIndexCache('not json { at all')).toBeUndefined()
  })

  it('rejects a JSON value that is not an object', () => {
    expect(parseIndexCache('[1, 2, 3]')).toBeUndefined()
    expect(parseIndexCache('"a string"')).toBeUndefined()
  })

  it('rejects a schema_version other than the one this build understands', () => {
    const wrongVersion = JSON.stringify({ schema_version: CACHE_SCHEMA_VERSION + 1, entries: {} })
    expect(parseIndexCache(wrongVersion)).toBeUndefined()
  })

  it('rejects a missing schema_version', () => {
    expect(parseIndexCache(JSON.stringify({ entries: {} }))).toBeUndefined()
  })

  it('rejects entries that is not a plain object', () => {
    const asArray = JSON.stringify({ schema_version: CACHE_SCHEMA_VERSION, entries: [] })
    expect(parseIndexCache(asArray)).toBeUndefined()
  })

  it('rejects an entry missing its hash', () => {
    const broken = serializeIndexCache(
      recordWith({ 'branches/attention.md': { ...acceptedEntry, hash: undefined as never } }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an entry with a negative length', () => {
    const broken = serializeIndexCache(
      recordWith({ 'branches/attention.md': { ...acceptedEntry, length: -1 } }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an entry with a non-integer length', () => {
    const broken = serializeIndexCache(
      recordWith({ 'branches/attention.md': { ...acceptedEntry, length: 12.5 } }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an accepted outcome whose item is missing a required field', () => {
    const { id: _id, ...withoutId } = branchItem
    const broken = serializeIndexCache(
      recordWith({
        'branches/attention.md': {
          ...acceptedEntry,
          outcome: { kind: 'accepted', item: withoutId as GardenItem },
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an accepted item whose relations are not an array -- what buildGardenGraph would iterate', () => {
    const broken = serializeIndexCache(
      recordWith({
        'branches/attention.md': {
          ...acceptedEntry,
          outcome: {
            kind: 'accepted',
            item: { ...branchItem, relations: 'not an array' as unknown as [] },
          },
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  // Found in review: the array-shape check above passed a malformed *element*
  // through, which `buildGardenGraph`'s `for (const relation of item.relations)`
  // then dereferenced `.type` on and crashed -- reproduced end to end in
  // `openGardenIndexCache.test.ts`.
  it('rejects an accepted item whose relations array contains a malformed element', () => {
    const broken = serializeIndexCache(
      recordWith({
        'branches/attention.md': {
          ...acceptedEntry,
          outcome: {
            kind: 'accepted',
            item: { ...branchItem, relations: [null] as unknown as [] },
          },
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects a relation element missing its target', () => {
    const broken = serializeIndexCache(
      recordWith({
        'branches/attention.md': {
          ...acceptedEntry,
          outcome: {
            kind: 'accepted',
            item: { ...branchItem, relations: [{ type: 'relates_to' }] as unknown as [] },
          },
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects a claim_leaf item whose supportedBy array contains a non-string element', () => {
    const claim = { ...branchItem, kind: 'claim_leaf', supportedBy: [42] } as unknown as GardenItem
    const broken = serializeIndexCache(
      recordWith({
        'leaves/claim.md': { ...acceptedEntry, outcome: { kind: 'accepted', item: claim } },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an item whose schemaVersion is missing or the wrong type', () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = branchItem
    const broken = serializeIndexCache(
      recordWith({
        'branches/attention.md': {
          ...acceptedEntry,
          outcome: { kind: 'accepted', item: withoutVersion as unknown as GardenItem },
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects a claim_leaf item whose supportedBy is missing', () => {
    const { state: _state, ...withoutState } = branchItem
    const claim = {
      ...withoutState,
      kind: 'claim_leaf',
      supportedBy: undefined,
    } as unknown as GardenItem
    const broken = serializeIndexCache(
      recordWith({
        'leaves/claim.md': { ...acceptedEntry, outcome: { kind: 'accepted', item: claim } },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an invalid outcome whose problems are not an array', () => {
    const broken = serializeIndexCache(
      recordWith({
        'branches/broken.md': {
          ...invalidEntry,
          outcome: { ...invalidEntry.outcome, problems: 'oops' as unknown as [] } as never,
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  it('rejects an invalid outcome with a malformed identity', () => {
    const broken = serializeIndexCache(
      recordWith({
        'branches/broken.md': {
          ...invalidEntry,
          outcome: { ...invalidEntry.outcome, identity: { itemId: 42 } as never } as never,
        },
      }),
    )
    expect(parseIndexCache(broken)).toBeUndefined()
  })

  // The core "all-or-nothing" property: one bad entry among otherwise
  // well-formed ones must not leave the good ones trusted.
  it('rejects the entire cache when only one of several entries is malformed', () => {
    const text = JSON.stringify({
      schema_version: CACHE_SCHEMA_VERSION,
      entries: {
        'branches/good.md': acceptedEntry,
        'branches/bad.md': { length: 'not a number', hash: 'sha256:cccc', outcome: acceptedEntry.outcome },
      },
    })

    expect(parseIndexCache(text)).toBeUndefined()
  })
})

describe('cacheEntryMatches', () => {
  it('matches when length and hash both agree', () => {
    expect(cacheEntryMatches(acceptedEntry, 200, 'sha256:aaaa')).toBe(true)
  })

  it('does not match a different length', () => {
    expect(cacheEntryMatches(acceptedEntry, 201, 'sha256:aaaa')).toBe(false)
  })

  it('does not match a different hash at the same length', () => {
    expect(cacheEntryMatches(acceptedEntry, 200, 'sha256:zzzz')).toBe(false)
  })
})
