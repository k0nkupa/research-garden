import { describe, expect, it } from 'vitest'
import type { GardenItem } from '../schema/gardenItem'
import { buildGardenGraph, inboundOf, neighboursOf, type GraphSubject } from './gardenGraph'

const U = (n: string) => `01HQ8X2K3M4N5P6Q7R8S9T0${n}`
const SEED = `seed_${U('S1')}`
const ROOT = `root_${U('R1')}`
const ROOT_2 = `root_${U('R2')}`
const BRANCH = `branch_${U('B1')}`
const BRANCH_2 = `branch_${U('B2')}`
const CLAIM = `claim_leaf_${U('C1')}`
const CLAIM_2 = `claim_leaf_${U('C2')}`
const QUESTION = `question_leaf_${U('Q1')}`
const IDEA = `idea_leaf_${U('I1')}`
const HARVEST = `harvest_${U('H1')}`

const base = {
  schemaVersion: 1 as const,
  title: 'An item',
  relations: [] as GardenItem['relations'],
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:00:00Z',
  body: 'A body.',
}

function item(partial: Partial<GardenItem> & Pick<GardenItem, 'id' | 'kind'>): GardenItem {
  const built = {
    ...base,
    parentId: undefined,
    ...partial,
  } as GardenItem
  return built
}

function graphOf(...items: GardenItem[]) {
  const subjects = new Map<string, GraphSubject>(
    items.map((entry, at) => [entry.id, { item: entry, path: ['x', `${at}.md`] }]),
  )
  return buildGardenGraph(subjects)
}

const seed = () => item({ id: SEED, kind: 'seed' })
const root = (id = ROOT) => item({ id, kind: 'root' } as Partial<GardenItem> & { id: string; kind: 'root' })
const branch = (id = BRANCH, parentId?: string) =>
  item({ id, kind: 'branch', state: 'active', parentId } as never)
const claim = (id = CLAIM, supportedBy: string[] = [ROOT], parentId = BRANCH) =>
  item({ id, kind: 'claim_leaf', parentId, supportedBy } as never)
const question = (id = QUESTION, parentId = BRANCH) =>
  item({ id, kind: 'question_leaf', parentId } as never)
const harvest = (id = HARVEST, supportedBy: string[] = [ROOT], parentId = BRANCH) =>
  item({ id, kind: 'harvest', parentId, supportedBy } as never)

function messagesOf(graph: ReturnType<typeof graphOf>) {
  return graph.diagnostics.flatMap((entry) => entry.problems.map((p) => p.message)).join(' | ')
}

describe('resolving references', () => {
  it('accepts a relationship whose target exists', () => {
    const graph = graphOf(branch(), claim(), root())

    expect(graph.diagnostics).toEqual([])
  })

  it('reports a parent that is not in this Garden', () => {
    const graph = graphOf(claim(CLAIM, [ROOT], BRANCH_2), root())

    expect(messagesOf(graph)).toContain('not an item in this Garden')
  })

  it('reports evidence that is not in this Garden', () => {
    const graph = graphOf(branch(), claim(CLAIM, [ROOT_2]))

    expect(messagesOf(graph)).toContain('not an item in this Garden')
  })

  it('reports a Cross-link target that is not in this Garden', () => {
    const dangling = item({
      id: SEED,
      kind: 'seed',
      relations: [{ type: 'relates_to', target: BRANCH_2 }],
    })

    expect(messagesOf(graphOf(dangling))).toContain('not an item in this Garden')
  })

  it('points the Diagnostic at the field that carries the broken reference', () => {
    const graph = graphOf(branch(), claim(CLAIM, [ROOT_2]))

    expect(graph.diagnostics[0]?.problems[0]?.field).toBe('supported_by')
  })

  it('names the file that declared the broken reference', () => {
    const graph = graphOf(branch(), claim(CLAIM, [ROOT_2]))

    expect(graph.diagnostics[0]?.path).toEqual(['x', '1.md'])
  })

  it('keeps every other relationship when one is broken', () => {
    const graph = graphOf(branch(), claim(CLAIM, [ROOT, ROOT_2]), root())

    expect(graph.relationships.some((r) => r.type === 'supports' && r.sourceId === ROOT)).toBe(true)
  })
})

// ADR 0079: a relationship that could not mean anything is refused.
describe('kind pairings', () => {
  it('refuses a Harvest that answers something that is not a Question Leaf', () => {
    const wrong = item({
      id: HARVEST,
      kind: 'harvest',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'answers', target: IDEA }],
    } as never)

    const graph = graphOf(branch(), root(), wrong, item({ id: IDEA, kind: 'idea_leaf', parentId: BRANCH } as never))
    expect(messagesOf(graph)).toContain('cannot join')
  })

  it('refuses an Idea Leaf that contradicts a Claim Leaf', () => {
    const wrong = item({
      id: IDEA,
      kind: 'idea_leaf',
      parentId: BRANCH,
      relations: [{ type: 'contradicts', target: CLAIM }],
    } as never)

    expect(messagesOf(graphOf(branch(), root(), claim(), wrong))).toContain('cannot join')
  })

  it('refuses a Harvest derived from a Branch rather than a Seed', () => {
    const wrong = item({
      id: HARVEST,
      kind: 'harvest',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'derived_from', target: BRANCH }],
    } as never)

    expect(messagesOf(graphOf(branch(), root(), wrong))).toContain('cannot join')
  })

  it('names both kinds it refused to join', () => {
    const wrong = item({
      id: IDEA,
      kind: 'idea_leaf',
      parentId: BRANCH,
      relations: [{ type: 'contradicts', target: CLAIM }],
    } as never)

    const message = messagesOf(graphOf(branch(), root(), claim(), wrong))
    expect(message).toContain('idea_leaf')
    expect(message).toContain('claim_leaf')
  })

  it('accepts a Harvest answering a Question Leaf', () => {
    const answering = item({
      id: HARVEST,
      kind: 'harvest',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'answers', target: QUESTION }],
    } as never)

    expect(graphOf(branch(), root(), question(), answering).diagnostics).toEqual([])
  })
})

// ADR 0079: Parent placement determines the Tree, so it must be acyclic.
// Non-parent Cross-links place nothing and may cycle freely.
describe('Parent cycles', () => {
  it('accepts a chain of nested Branches', () => {
    const graph = graphOf(branch(BRANCH), branch(BRANCH_2, BRANCH))

    expect(graph.diagnostics).toEqual([])
    expect(graph.unplacedIds.size).toBe(0)
  })

  it('rejects two Branches that parent each other', () => {
    const graph = graphOf(branch(BRANCH, BRANCH_2), branch(BRANCH_2, BRANCH))

    expect(messagesOf(graph)).toContain('cycle')
  })

  it('reports every Branch taking part in the cycle', () => {
    const graph = graphOf(branch(BRANCH, BRANCH_2), branch(BRANCH_2, BRANCH))

    expect(graph.diagnostics).toHaveLength(2)
  })

  it('unplaces the items on a cycle so the Tree can still show them', () => {
    const graph = graphOf(branch(BRANCH, BRANCH_2), branch(BRANCH_2, BRANCH))

    expect([...graph.unplacedIds].sort()).toEqual([BRANCH, BRANCH_2].sort())
  })

  it('drops the Parent relationships on a cycle rather than keeping them', () => {
    const graph = graphOf(branch(BRANCH, BRANCH_2), branch(BRANCH_2, BRANCH))

    expect(graph.relationships.filter((r) => r.type === 'parent')).toEqual([])
  })

  it('rejects a longer cycle', () => {
    const third = `branch_${U('B3')}`
    const graph = graphOf(
      branch(BRANCH, BRANCH_2),
      branch(BRANCH_2, third),
      branch(third, BRANCH),
    )

    expect(graph.unplacedIds.size).toBe(3)
  })

  it('leaves a Branch outside the cycle alone', () => {
    const spare = `branch_${U('B4')}`
    const graph = graphOf(branch(BRANCH, BRANCH_2), branch(BRANCH_2, BRANCH), branch(spare))

    expect(graph.unplacedIds.has(spare)).toBe(false)
  })

  // The point of the exception: Cross-links do not place anything.
  it('permits a cycle of Relates To Cross-links', () => {
    const one = item({
      id: SEED,
      kind: 'seed',
      relations: [{ type: 'relates_to', target: BRANCH }],
    })
    const two = item({
      id: BRANCH,
      kind: 'branch',
      state: 'active',
      relations: [{ type: 'relates_to', target: SEED }],
    } as never)

    expect(graphOf(one, two).diagnostics).toEqual([])
  })

  it('permits two Claim Leaves that contradict each other in both directions', () => {
    const one = item({
      id: CLAIM,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'contradicts', target: CLAIM_2 }],
    } as never)
    const two = item({
      id: CLAIM_2,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT_2],
      relations: [{ type: 'contradicts', target: CLAIM }],
    } as never)

    expect(graphOf(branch(), root(), root(ROOT_2), one, two).diagnostics).toEqual([])
  })
})

/**
 * ADR 0021: inverse relationships are derived at scan and never written into a
 * second file. ADR 0020 puts Supports on the Claim so that adding knowledge
 * never mutates immutable Root evidence.
 */
describe('derived inverses', () => {
  it('stores Supports running from the Root, though the Claim declares it', () => {
    const graph = graphOf(branch(), root(), claim())
    const supports = graph.relationships.find((r) => r.type === 'supports')

    expect(supports).toMatchObject({ sourceId: ROOT, targetId: CLAIM, declaredOn: CLAIM })
  })

  it('lets a Root see what it supports without the Root declaring anything', () => {
    const graph = graphOf(branch(), root(), claim(), harvest())

    expect(inboundOf(graph, ROOT, 'supports')).toEqual([])
    expect([...neighboursOf(graph, ROOT, 'supports')].sort()).toEqual([CLAIM, HARVEST].sort())
  })

  it('lets a Question Leaf see the Harvest that answers it', () => {
    const answering = item({
      id: HARVEST,
      kind: 'harvest',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'answers', target: QUESTION }],
    } as never)
    const graph = graphOf(branch(), root(), question(), answering)

    expect(inboundOf(graph, QUESTION, 'answers')).toEqual([HARVEST])
  })

  it('reads a symmetric Cross-link from the side that did not declare it', () => {
    const one = item({
      id: CLAIM,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'contradicts', target: CLAIM_2 }],
    } as never)
    const two = claim(CLAIM_2, [ROOT_2])
    const graph = graphOf(branch(), root(), root(ROOT_2), one, two)

    expect(neighboursOf(graph, CLAIM_2, 'contradicts')).toEqual([CLAIM])
  })

  it('does not read a directional relationship backwards', () => {
    const graph = graphOf(branch(), root(), claim())

    expect(neighboursOf(graph, CLAIM, 'supports')).toEqual([])
  })

  it('stores each relationship exactly once, however many sides can see it', () => {
    const one = item({
      id: CLAIM,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'contradicts', target: CLAIM_2 }],
    } as never)
    const graph = graphOf(branch(), root(), root(ROOT_2), one, claim(CLAIM_2, [ROOT_2]))

    expect(graph.relationships.filter((r) => r.type === 'contradicts')).toHaveLength(1)
  })
})

// ADR 0015: cultivation never rewrites, moves, or replaces a Seed; its status
// is derived from what points back at it.
describe('Cultivated Seeds', () => {
  it('treats a Seed nothing points at as uncultivated', () => {
    expect(graphOf(seed()).cultivatedSeedIds.has(SEED)).toBe(false)
  })

  it('treats a Seed something was derived from as cultivated', () => {
    const grown = item({
      id: BRANCH,
      kind: 'branch',
      state: 'active',
      relations: [{ type: 'derived_from', target: SEED }],
    } as never)

    expect(graphOf(seed(), grown).cultivatedSeedIds.has(SEED)).toBe(true)
  })

  it('derives the status without the Seed declaring anything', () => {
    const grown = item({
      id: BRANCH,
      kind: 'branch',
      state: 'active',
      relations: [{ type: 'derived_from', target: SEED }],
    } as never)
    const graph = graphOf(seed(), grown)

    expect(graph.relationships.every((r) => r.declaredOn !== SEED)).toBe(true)
    expect(graph.cultivatedSeedIds.has(SEED)).toBe(true)
  })

  it('lists everything that grew from a Seed', () => {
    const one = item({
      id: BRANCH,
      kind: 'branch',
      state: 'active',
      relations: [{ type: 'derived_from', target: SEED }],
    } as never)
    const two = item({
      id: ROOT,
      kind: 'root',
      relations: [{ type: 'derived_from', target: SEED }],
    } as never)
    const graph = graphOf(seed(), one, two)

    expect([...inboundOf(graph, SEED, 'derived_from')].sort()).toEqual([BRANCH, ROOT].sort())
  })

  it('does not count a broken derivation as cultivation', () => {
    const grown = item({
      id: BRANCH,
      kind: 'branch',
      state: 'active',
      relations: [{ type: 'derived_from', target: SEED }],
    } as never)

    expect(graphOf(grown).cultivatedSeedIds.size).toBe(0)
  })
})

// ADR 0018: neither side of a contradiction is discarded.
describe('contradictory Claims', () => {
  it('keeps both Claims, their Roots, and the Contradicts relationship', () => {
    const one = item({
      id: CLAIM,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'contradicts', target: CLAIM_2 }],
    } as never)
    const graph = graphOf(branch(), root(), root(ROOT_2), one, claim(CLAIM_2, [ROOT_2]))

    expect(graph.diagnostics).toEqual([])
    expect(neighboursOf(graph, CLAIM, 'contradicts')).toEqual([CLAIM_2])
    expect(neighboursOf(graph, CLAIM, 'supports')).toEqual([])
    expect(inboundOf(graph, CLAIM, 'supports')).toEqual([ROOT])
    expect(inboundOf(graph, CLAIM_2, 'supports')).toEqual([ROOT_2])
  })
})

// ADR 0079: no self-links and no duplicate relationships. Both live here with
// the rest of the edge checks, so one place decides what an edge is.
describe('self-links', () => {
  it('rejects an item that relates to itself', () => {
    const narcissist = item({
      id: SEED,
      kind: 'seed',
      relations: [{ type: 'relates_to', target: SEED }],
    })

    expect(messagesOf(graphOf(narcissist))).toMatch(/itself/i)
  })

  it('rejects a Branch that is its own parent', () => {
    expect(messagesOf(graphOf(branch(BRANCH, BRANCH)))).toMatch(/itself/i)
  })

  it('unplaces a Branch that is its own parent, so the Tree can still show it', () => {
    expect(graphOf(branch(BRANCH, BRANCH)).unplacedIds.has(BRANCH)).toBe(true)
  })

  it('points the Diagnostic at the field carrying the self-link', () => {
    const graph = graphOf(branch(BRANCH, BRANCH))

    expect(graph.diagnostics[0]?.problems[0]?.field).toBe('parent_id')
  })

  it('rejects a Harvest that claims to be its own evidence', () => {
    const circular = item({
      id: HARVEST,
      kind: 'harvest',
      parentId: BRANCH,
      supportedBy: [HARVEST],
    } as never)

    expect(messagesOf(graphOf(branch(), circular))).toMatch(/itself/i)
  })
})

describe('duplicate relationships', () => {
  it('rejects the same relationship written twice in one file', () => {
    const repeated = item({
      id: SEED,
      kind: 'seed',
      relations: [
        { type: 'relates_to', target: BRANCH },
        { type: 'relates_to', target: BRANCH },
      ],
    })

    expect(messagesOf(graphOf(branch(), repeated))).toMatch(/repeats/i)
  })

  it('keeps the relationship once despite the repeat', () => {
    const repeated = item({
      id: SEED,
      kind: 'seed',
      relations: [
        { type: 'relates_to', target: BRANCH },
        { type: 'relates_to', target: BRANCH },
      ],
    })

    expect(graphOf(branch(), repeated).relationships.filter((r) => r.type === 'relates_to')).toHaveLength(1)
  })

  it('rejects the same Root cited twice as evidence', () => {
    const repeated = claim(CLAIM, [ROOT, ROOT])

    expect(messagesOf(graphOf(branch(), root(), repeated))).toMatch(/repeats/i)
  })

  it('accepts two different relationships to the same item', () => {
    const both = item({
      id: CLAIM,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [
        { type: 'relates_to', target: CLAIM_2 },
        { type: 'contradicts', target: CLAIM_2 },
      ],
    } as never)

    expect(graphOf(branch(), root(), root(ROOT_2), both, claim(CLAIM_2, [ROOT_2])).diagnostics).toEqual([])
  })

  it('accepts the same relationship to two different items', () => {
    const two = item({
      id: SEED,
      kind: 'seed',
      relations: [
        { type: 'relates_to', target: BRANCH },
        { type: 'relates_to', target: ROOT },
      ],
    })

    expect(graphOf(branch(), root(), two).diagnostics).toEqual([])
  })
})

/**
 * ADR 0021: one fact is one relationship, however many files state it. A
 * symmetric relation declared by both sides is redundant rather than wrong --
 * both statements are true -- so the second is absorbed instead of drawn twice.
 */
describe('a symmetric relationship declared by both sides', () => {
  const bothWays = () => {
    const one = item({
      id: CLAIM,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT],
      relations: [{ type: 'contradicts', target: CLAIM_2 }],
    } as never)
    const two = item({
      id: CLAIM_2,
      kind: 'claim_leaf',
      parentId: BRANCH,
      supportedBy: [ROOT_2],
      relations: [{ type: 'contradicts', target: CLAIM }],
    } as never)
    return graphOf(branch(), root(), root(ROOT_2), one, two)
  }

  it('stores the contradiction exactly once', () => {
    expect(bothWays().relationships.filter((r) => r.type === 'contradicts')).toHaveLength(1)
  })

  it('complains about neither file, because both statements are true', () => {
    expect(bothWays().diagnostics).toEqual([])
  })

  it('is still readable from both sides', () => {
    const graph = bothWays()

    expect(neighboursOf(graph, CLAIM, 'contradicts')).toEqual([CLAIM_2])
    expect(neighboursOf(graph, CLAIM_2, 'contradicts')).toEqual([CLAIM])
  })

  it('does the same for a Relates To written both ways', () => {
    const one = item({
      id: SEED,
      kind: 'seed',
      relations: [{ type: 'relates_to', target: BRANCH }],
    })
    const two = item({
      id: BRANCH,
      kind: 'branch',
      state: 'active',
      relations: [{ type: 'relates_to', target: SEED }],
    } as never)

    expect(graphOf(one, two).relationships.filter((r) => r.type === 'relates_to')).toHaveLength(1)
  })

  // Directional relationships are not the same fact in reverse, so they stay two.
  it('does not collapse a directional relationship stated in reverse', () => {
    const graph = graphOf(branch(), root(), claim(), harvest())

    expect(graph.relationships.filter((r) => r.type === 'supports')).toHaveLength(2)
  })
})
