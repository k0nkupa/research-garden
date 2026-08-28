import { describe, expect, it } from 'vitest'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { parseGardenDocument } from '../domain/document/gardenDocument'
import { CANONICAL_FIELD_ORDER } from '../domain/schema/gardenItem'
import { OPERATIONAL_DIRECTORY } from '../domain/schema/itemIdentity'
import { neighboursOf } from '../domain/index/gardenGraph'
import type { UlidEntropy } from '../domain/schema/ulid'
import { createGarden, planFiles } from './createGarden'
import type { SampleItem } from './sampleGarden'
import type { OpenedGarden } from './openGarden'

/**
 * The Sample Garden's own canonical files, excluding whatever `openGarden`
 * (called at the end of Create Garden to read back what was written) leaves
 * behind in the operational directory -- the Index Cache (ticket 15), in
 * particular, which is JSON, not a Garden document, and was never meant to
 * be covered by assertions about the Sample Garden's own Markdown.
 */
function canonicalPaths(snapshot: Record<string, string>): string[] {
  return Object.keys(snapshot).filter((path) => !path.startsWith(`${OPERATIONAL_DIRECTORY}/`))
}

function canonicalFiles(snapshot: Record<string, string>): string[] {
  return canonicalPaths(snapshot).map((path) => snapshot[path] as string)
}

/** Deterministic, so a created Garden can be compared rather than sampled. */
function testEntropy(): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => 1_700_000_000_000 + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

const NOW = '2026-08-01T10:00:00Z'

async function create(files: Record<string, string> = {}) {
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const result = await createGarden(fileSystem, { entropy: testEntropy(), now: () => NOW })
  return { fileSystem, result }
}

function expectCreated(result: Awaited<ReturnType<typeof create>>['result']): OpenedGarden {
  if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`)
  if (result.result.kind !== 'opened') {
    throw new Error(`expected the new Garden to open, got ${result.result.kind}`)
  }
  return result.result.garden
}

describe('creating a Garden in an empty folder', () => {
  it('writes real files', async () => {
    const { fileSystem } = await create()

    expect(Object.keys(fileSystem.snapshot()).length).toBeGreaterThan(0)
  })

  it('opens the Garden by reading back what it wrote', async () => {
    const { result } = await create()

    expect(expectCreated(result).index.items.size).toBeGreaterThan(0)
  })

  it('reports no Diagnostics, so what it wrote validates completely', async () => {
    const { result } = await create()
    const garden = expectCreated(result)

    expect(garden.index.diagnostics, JSON.stringify(garden.index.diagnostics)).toEqual([])
  })

  it('names the folder the person chose', async () => {
    const { result } = await create()

    expect(expectCreated(result).repositoryName).toBe('my-garden')
  })

  it('grows a Tree with something at the top level', async () => {
    const { result } = await create()

    expect(expectCreated(result).index.topLevelIds.length).toBeGreaterThan(0)
  })
})

// ADR 0011: canonical Markdown is organized by botanical type.
describe('where the files land', () => {
  it('files each item under the directory for its kind', async () => {
    const { fileSystem } = await create()
    const paths = Object.keys(fileSystem.snapshot())

    expect(paths.some((path) => path.startsWith('seeds/'))).toBe(true)
    expect(paths.some((path) => path.startsWith('roots/'))).toBe(true)
    expect(paths.some((path) => path.startsWith('branches/'))).toBe(true)
    expect(paths.some((path) => path.startsWith('leaves/'))).toBe(true)
  })

  it('writes nothing outside the typed directories', async () => {
    const { fileSystem } = await create()

    for (const path of canonicalPaths(fileSystem.snapshot())) {
      expect(path).toMatch(/^(seeds|roots|branches|leaves|harvests)\//)
    }
  })

  it('writes no Harvest, because the Harvest is what the demo produces', async () => {
    const { fileSystem } = await create()

    expect(Object.keys(fileSystem.snapshot()).some((p) => p.startsWith('harvests/'))).toBe(false)
  })

  // ADR 0034: a readable title slug, not the identity.
  it('names every file after its title', async () => {
    const { fileSystem } = await create()

    for (const path of canonicalPaths(fileSystem.snapshot())) {
      expect(path).toMatch(/^[a-z]+\/[a-z0-9-]+\.md$/)
    }
  })

  it('gives the Branch a filename derived from its title', async () => {
    const { fileSystem } = await create()

    expect(Object.keys(fileSystem.snapshot())).toContain('branches/deliberate-practice.md')
  })

  it('adds no identity suffix when no two titles collide', async () => {
    const { fileSystem } = await create()

    for (const path of canonicalPaths(fileSystem.snapshot())) {
      expect(path).not.toMatch(/-[0-9A-Z]{6}\.md$/)
    }
  })
})

// ADR 0078: newly created files use the documented canonical field order.
describe('what the files look like', () => {
  it('writes fields in the canonical order', async () => {
    const { fileSystem } = await create()
    const branch = fileSystem.snapshot()['branches/deliberate-practice.md'] as string

    const fields = [...branch.matchAll(/^([a-z_]+):/gm)].map((match) => match[1] as string)
    const ranked = fields.map((field) => CANONICAL_FIELD_ORDER.indexOf(field))

    expect([...ranked].sort((a, b) => a - b)).toEqual(ranked)
  })

  it('opens every file with its schema version and identity', async () => {
    const { fileSystem } = await create()

    for (const text of canonicalFiles(fileSystem.snapshot())) {
      expect(text.startsWith('---\nschema_version: 1\nid: ')).toBe(true)
    }
  })

  it('writes files that parse back', async () => {
    const { fileSystem } = await create()

    for (const text of canonicalFiles(fileSystem.snapshot())) {
      expect(parseGardenDocument(text).ok).toBe(true)
    }
  })

  it('ends every file with exactly one newline', async () => {
    const { fileSystem } = await create()

    for (const text of canonicalFiles(fileSystem.snapshot())) {
      expect(text).toMatch(/[^\n]\n$/)
    }
  })
})

/**
 * ADR 0070: the Sample Garden has to make the defining workflow demonstrable
 * from a standing start.
 */
describe('the Sample Garden', () => {
  async function created() {
    const { result } = await create()
    return expectCreated(result)
  }

  const kindsIn = (garden: OpenedGarden) =>
    [...garden.index.items.values()].map((indexed) => indexed.item.kind)

  it('contains two Claim Leaves', async () => {
    expect(kindsIn(await created()).filter((kind) => kind === 'claim_leaf')).toHaveLength(2)
  })

  it('gives each Claim Leaf its own Root', async () => {
    const garden = await created()
    const claims = [...garden.index.items.values()].filter(
      (indexed) => indexed.item.kind === 'claim_leaf',
    )

    const roots = claims.flatMap((indexed) =>
      indexed.item.kind === 'claim_leaf' ? [...indexed.item.supportedBy] : [],
    )
    expect(roots).toHaveLength(2)
    expect(new Set(roots).size).toBe(2)
  })

  it('joins the two Claim Leaves with an explicit Contradicts relationship', async () => {
    const garden = await created()
    const contradicts = garden.index.graph.relationships.filter((r) => r.type === 'contradicts')

    expect(contradicts).toHaveLength(1)
  })

  it('makes the contradiction readable from both Claims', async () => {
    const garden = await created()
    const [first] = garden.index.graph.relationships.filter((r) => r.type === 'contradicts')

    expect(neighboursOf(garden.index.graph, first?.sourceId as string, 'contradicts')).toEqual([
      first?.targetId,
    ])
    expect(neighboursOf(garden.index.graph, first?.targetId as string, 'contradicts')).toEqual([
      first?.sourceId,
    ])
  })

  it('contains a Question Leaf a Harvest could later answer', async () => {
    expect(kindsIn(await created())).toContain('question_leaf')
  })

  it('contains a Seed the topic was derived from', async () => {
    const garden = await created()

    expect(kindsIn(garden)).toContain('seed')
    expect(garden.index.graph.relationships.some((r) => r.type === 'derived_from')).toBe(true)
  })

  it('marks that Seed as cultivated, derived rather than declared', async () => {
    const garden = await created()
    const seed = [...garden.index.items.values()].find((i) => i.item.kind === 'seed')

    expect(seed?.cultivated).toBe(true)
  })

  it('records a real content hash for every Root', async () => {
    const garden = await created()
    const roots = [...garden.index.items.values()].filter((i) => i.item.kind === 'root')

    expect(roots).toHaveLength(2)
    for (const indexed of roots) {
      if (indexed.item.kind !== 'root') continue
      expect(indexed.item.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it('gives the two Roots different content hashes, being different evidence', async () => {
    const garden = await created()
    const hashes = [...garden.index.items.values()]
      .filter((i) => i.item.kind === 'root')
      .map((i) => (i.item.kind === 'root' ? i.item.contentHash : ''))

    expect(new Set(hashes).size).toBe(2)
  })

  it('places every Leaf under the Branch', async () => {
    const garden = await created()
    const branch = [...garden.index.items.values()].find((i) => i.item.kind === 'branch')

    expect(branch?.childIds.length).toBeGreaterThanOrEqual(4)
  })

  it('gives every item a distinct identity', async () => {
    const garden = await created()

    expect(garden.index.items.size).toBe(8)
  })
})

// "Create Garden refuses a folder that already contains conflicting content,
// without overwriting anything."
describe('creating a Garden where one already exists', () => {
  const existingItem = '---\nschema_version: 1\nid: x\n---\n\nmine\n'

  it('refuses rather than writing', async () => {
    const { result } = await create({ 'branches/mine.md': existingItem })

    expect(result.kind).toBe('conflicting')
  })

  it('says what it found', async () => {
    const { result } = await create({ 'branches/mine.md': existingItem })

    if (result.kind !== 'conflicting') throw new Error('expected a refusal')
    expect(result.found).toContain('branches/mine.md')
  })

  it('leaves the existing file exactly as it was', async () => {
    const { fileSystem } = await create({ 'branches/mine.md': existingItem })

    expect(fileSystem.snapshot()['branches/mine.md']).toBe(existingItem)
  })

  it('writes nothing at all', async () => {
    const { fileSystem } = await create({ 'branches/mine.md': existingItem })

    expect(Object.keys(fileSystem.snapshot())).toEqual(['branches/mine.md'])
  })

  it('refuses when only the operational directory is present', async () => {
    const { result } = await create({ '.research-garden/index.json': '{}' })

    expect(result.kind).toBe('conflicting')
  })

  it('refuses on any typed directory, not only branches', async () => {
    const { result } = await create({ 'harvests/old.md': existingItem })

    expect(result.kind).toBe('conflicting')
  })

  // Refusing on unrelated files would be officious: nothing collides with them.
  it('proceeds in a folder holding files that are not canonical Markdown', async () => {
    const { result, fileSystem } = await create({
      'notes.txt': 'a shopping list',
      'attachments/paper.pdf': 'binary',
    })

    expect(result.kind).toBe('created')
    expect(fileSystem.snapshot()['notes.txt']).toBe('a shopping list')
  })
})

describe('when the folder cannot be written', () => {
  it('reports that permission is required rather than throwing', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    fileSystem.revokePermission()

    await expect(createGarden(fileSystem)).resolves.toMatchObject({
      kind: 'permission-required',
      repositoryName: 'my-garden',
    })
  })

  it('writes nothing when permission has lapsed', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')
    fileSystem.revokePermission()

    await createGarden(fileSystem)

    fileSystem.grantPermission()
    expect(fileSystem.snapshot()).toEqual({})
  })

  it('reports a failure rather than throwing when the folder breaks', async () => {
    const broken = {
      repositoryName: 'unreadable',
      permission: async () => 'granted' as const,
      requestPermission: async () => 'granted' as const,
      listFiles: async () => [],
      read: async () => '',
      readBytes: async () => new Uint8Array(),
      write: async () => {
        throw new Error('the disk went away')
      },
    }

    await expect(createGarden(broken)).resolves.toMatchObject({ kind: 'failed' })
  })
})

describe('two Gardens created separately', () => {
  it('do not share item identities', async () => {
    const first = expectCreated((await create()).result)

    const otherFileSystem = new InMemoryGardenFileSystem({}, 'other-garden')
    let otherCounter = 0
    const otherResult = await createGarden(otherFileSystem, {
      entropy: {
        now: () => 1_800_000_000_000,
        // Must actually vary: identical entropy would give every item the same
        // id, which the read-back check correctly refuses to call a Garden.
        randomBytes: (into) => into.map(() => (otherCounter++ * 7 + 3) % 256),
      },
      now: () => NOW,
    })
    const second = expectCreated(otherResult)

    const shared = [...first.index.items.keys()].filter((id) => second.index.items.has(id))
    expect(shared).toEqual([])
  })
})

/**
 * The contradiction is the whole point of the Sample Garden, so the two Claims
 * have to be tellable apart in the Tree, where labels are truncated.
 */
describe('the two Claims are distinguishable at a glance', () => {
  it('gives them titles that differ before the truncation point', async () => {
    const { result } = await create()
    const claims = [...expectCreated(result).index.items.values()]
      .filter((indexed) => indexed.item.kind === 'claim_leaf')
      .map((indexed) => indexed.item.title)

    expect(claims).toHaveLength(2)
    const [first, second] = claims as [string, string]
    expect(first.slice(0, 20)).not.toBe(second.slice(0, 20))
  })

  it('gives them different filenames', async () => {
    const { fileSystem } = await create()
    const leaves = Object.keys(fileSystem.snapshot()).filter((p) => p.startsWith('leaves/'))

    expect(new Set(leaves).size).toBe(leaves.length)
  })
})

/**
 * ADR 0034: the identity suffix appears only when two titles in one directory
 * would collide. The Sample Garden has no collisions, so the behaviour is
 * exercised here through the writer rather than only on the naming function.
 */
describe('placing items whose titles collide', () => {
  const sameTitle = (id: string): SampleItem => ({
    id,
    kind: 'branch',
    title: 'Deliberate practice',
    frontmatter: { schema_version: 1, id, kind: 'branch', title: 'Deliberate practice' },
    body: 'A body.\n',
  })

  const ONE = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
  const TWO = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B2W'
  const THREE = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B3W'

  it('gives the first item the plain slug', () => {
    expect(planFiles([sameTitle(ONE)])[0]?.path).toEqual(['branches', 'deliberate-practice.md'])
  })

  it('suffixes only the ones that would collide', () => {
    const planned = planFiles([sameTitle(ONE), sameTitle(TWO), sameTitle(THREE)])

    expect(planned[0]?.path).toEqual(['branches', 'deliberate-practice.md'])
    expect(planned[1]?.path.at(-1)).toMatch(/^deliberate-practice-[0-9A-Z]{6}\.md$/)
    expect(planned[2]?.path.at(-1)).toMatch(/^deliberate-practice-[0-9A-Z]{6}\.md$/)
  })

  it('gives every colliding item a different name', () => {
    const planned = planFiles([sameTitle(ONE), sameTitle(TWO), sameTitle(THREE)])
    const names = planned.map((file) => file.path.join('/'))

    expect(new Set(names).size).toBe(3)
  })

  it('tracks taken names per directory, so one directory does not affect another', () => {
    const leafId = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
    const leaf: SampleItem = {
      id: leafId,
      kind: 'claim_leaf',
      title: 'Deliberate practice',
      frontmatter: { schema_version: 1, id: leafId, kind: 'claim_leaf', title: 'Deliberate practice' },
      body: 'A body.\n',
    }

    const planned = planFiles([sameTitle(ONE), leaf])
    expect(planned[1]?.path).toEqual(['leaves', 'deliberate-practice.md'])
  })
})

// ADR 0078: the order bites hardest on the kinds with the most fields.
describe('the canonical field order on a Root', () => {
  it('writes a Root’s kind-specific fields in the documented order', async () => {
    const { fileSystem } = await create()
    const rootPath = Object.keys(fileSystem.snapshot()).find((p) => p.startsWith('roots/'))
    const text = fileSystem.snapshot()[rootPath as string] as string

    const fields = [...text.matchAll(/^([a-z_]+):/gm)].map((match) => match[1] as string)
    const ranked = fields.map((field) => CANONICAL_FIELD_ORDER.indexOf(field))

    expect(fields).toContain('origin_url')
    expect(fields).toContain('content_hash')
    expect([...ranked].sort((a, b) => a - b)).toEqual(ranked)
  })
})
