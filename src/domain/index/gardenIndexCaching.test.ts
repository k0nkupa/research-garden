import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../hash'
import { scanGardenWithCache, type ScannedFile } from './gardenIndex'
import type { CacheEntry } from './indexCache'

function branchFile(id: string, title: string, extra = '') {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
${extra}---

Body of ${title}.
`
}

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'
const PATH = ['branches', 'attention.md']

async function cacheEntryFor(text: string, item: unknown): Promise<CacheEntry> {
  return {
    length: text.length,
    hash: await sha256Hex(text),
    outcome: { kind: 'accepted', item: item as never },
  }
}

describe('reusing a matching cache entry', () => {
  it('serves the cached outcome rather than reparsing, when the hash still matches', async () => {
    const text = branchFile(ATTENTION, 'Attention')
    const wrongTitleItem = { ...(await realItem(text)), title: 'A title only the cache would say' }

    const cache = new Map([[PATH.join('/'), await cacheEntryFor(text, wrongTitleItem)]])

    const { index } = await scanGardenWithCache([{ path: PATH, text }], cache)

    expect(index.items.get(ATTENTION)?.item.title).toBe('A title only the cache would say')
  })

  it('reparses when the hash no longer matches, even if an entry exists', async () => {
    const text = branchFile(ATTENTION, 'Attention')
    const staleItem = { ...(await realItem(text)), title: 'Stale cached title' }
    // A hash that does not belong to `text` at all -- simulates the file
    // having changed since this entry was recorded.
    const cache = new Map([
      [PATH.join('/'), { length: text.length, hash: 'sha256-of-something-else', outcome: { kind: 'accepted' as const, item: staleItem as never } }],
    ])

    const { index } = await scanGardenWithCache([{ path: PATH, text }], cache)

    expect(index.items.get(ATTENTION)?.item.title).toBe('Attention')
  })

  it('reparses when the length matches but the content does not', async () => {
    // Two same-length bodies with different content: proves the hash gates
    // reuse, not `length` alone.
    const cachedText = branchFile(ATTENTION, 'Attention', 'note: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n')
    const currentText = branchFile(ATTENTION, 'Attention', 'note: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n')
    expect(currentText.length).toBe(cachedText.length)

    const staleItem = { ...(await realItem(cachedText)), title: 'From the stale text' }
    const cache = new Map([[PATH.join('/'), await cacheEntryFor(cachedText, staleItem)]])

    const { index } = await scanGardenWithCache([{ path: PATH, text: currentText }], cache)

    expect(index.items.get(ATTENTION)?.item.title).toBe('Attention')
  })

  it('produces a fresh entry for every scanned file, whether reused or freshly parsed', async () => {
    const files: ScannedFile[] = [
      { path: PATH, text: branchFile(ATTENTION, 'Attention') },
      { path: ['branches', 'optimisers.md'], text: branchFile(OPTIMISERS, 'Optimisers') },
    ]

    const { cache } = await scanGardenWithCache(files, new Map())

    expect(cache.entries.size).toBe(2)
    for (const file of files) {
      const entry = cache.entries.get(file.path.join('/'))
      expect(entry?.length).toBe(file.text.length)
      expect(entry?.hash).toBe(await sha256Hex(file.text))
    }
  })
})

describe('what never gets cached (ADR 0062: cache reuse never substitutes for a consistency check)', () => {
  it('caches a duplicate-id loser under its own standalone outcome, not the correction blaming it', async () => {
    const winner: ScannedFile = { path: ['branches', 'first.md'], text: branchFile(ATTENTION, 'First claim') }
    const loser: ScannedFile = { path: ['branches', 'second.md'], text: branchFile(ATTENTION, 'Second claim') }

    const cold = await scanGardenWithCache([winner, loser], new Map())
    // The duplicate is real in this scan's diagnostics...
    expect(cold.index.diagnostics.some((d) => d.path.join('/') === loser.path.join('/'))).toBe(true)

    // ...but the fresh cache entry for the loser is its own valid, standalone
    // outcome -- not an "invalid: duplicate id" verdict.
    const loserEntry = cold.cache.entries.get(loser.path.join('/'))
    expect(loserEntry?.outcome.kind).toBe('accepted')

    // Removing the winner and rescanning with that same cache must let the
    // former loser through: if the duplicate correction had been cached
    // instead, it would still be refused here even though nothing conflicts
    // with it any more.
    const rescanned = await scanGardenWithCache([loser], cold.cache.entries)
    expect(rescanned.index.items.get(ATTENTION)?.item.title).toBe('Second claim')
  })

  it('caches a Branch with a dangling parent under its own standalone outcome, not the placement refusal', async () => {
    const child: ScannedFile = {
      path: ['branches', 'optimisers.md'],
      text: branchFile(OPTIMISERS, 'Optimisers', `parent_id: ${ATTENTION}\n`),
    }

    // The parent this file names does not exist yet.
    const cold = await scanGardenWithCache([child], new Map())
    expect(cold.index.diagnostics.some((d) => d.itemId === OPTIMISERS)).toBe(true)
    expect(cold.index.topLevelIds).toContain(OPTIMISERS)

    const childEntry = cold.cache.entries.get(child.path.join('/'))
    expect(childEntry?.outcome.kind).toBe('accepted')

    // The parent now exists too. Rescanning with the *same* cached entry for
    // the child must place it correctly: if the placement refusal had been
    // what got cached, it would stay unplaced even though its parent is
    // right there.
    const parent: ScannedFile = { path: ['branches', 'attention.md'], text: branchFile(ATTENTION, 'Attention') }
    const rescanned = await scanGardenWithCache([parent, child], cold.cache.entries)

    expect(rescanned.index.items.get(ATTENTION)?.childIds).toContain(OPTIMISERS)
    expect(rescanned.index.topLevelIds).not.toContain(OPTIMISERS)
    expect(rescanned.index.diagnostics).toEqual([])
  })
})

describe('the Garden Revision (ADR 0062: cache reuse never alters it)', () => {
  it('is identical whether or not a matching cache was used', async () => {
    const files: ScannedFile[] = [{ path: PATH, text: branchFile(ATTENTION, 'Attention') }]

    const cold = await scanGardenWithCache(files, new Map())
    const warm = await scanGardenWithCache(files, cold.cache.entries)

    expect(warm.index.revision).toBe(cold.index.revision)
  })
})

/** The real, correctly parsed item for a piece of text -- a scan with no cache to interfere. */
async function realItem(text: string) {
  const { index } = await scanGardenWithCache([{ path: PATH, text }], new Map())
  const [entry] = index.items.values()
  return entry!.item
}
