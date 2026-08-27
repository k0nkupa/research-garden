import { describe, expect, it } from 'vitest'
import { GARDEN_ITEM_KINDS } from './itemIdentity'
import { CANONICAL_FIELD_ORDER, validateGardenItem } from './gardenItem'

const ULID = '01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const ULID_2 = '01HQ8X2K3M4N5P6Q7R8S9T0V2X'
const BRANCH = `branch_${ULID_2}`
const ROOT = `root_${ULID_2}`

const universal = {
  schema_version: 1,
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-02T11:30:00Z',
}

const HARVEST_BODY = `
## Question

What is true?

## Synthesis

This.

## Evidence

That.

## Contradictions and uncertainty

Some.

## Open questions

More.
`

/** A minimal well-formed item of each kind, for exhaustive coverage. */
const WELL_FORMED: Record<string, Record<string, unknown>> = {
  seed: { ...universal, id: `seed_${ULID}`, kind: 'seed', title: 'A captured thought' },
  root: {
    ...universal,
    id: `root_${ULID}`,
    kind: 'root',
    title: 'A paper',
    origin_url: 'https://example.com/paper',
    captured_at: '2026-08-01T09:00:00Z',
    content_hash: 'sha256:abc123',
  },
  branch: { ...universal, id: `branch_${ULID}`, kind: 'branch', title: 'A topic', state: 'active' },
  claim_leaf: {
    ...universal,
    id: `claim_leaf_${ULID}`,
    kind: 'claim_leaf',
    title: 'An assertion',
    parent_id: BRANCH,
    supported_by: [ROOT],
  },
  question_leaf: {
    ...universal,
    id: `question_leaf_${ULID}`,
    kind: 'question_leaf',
    title: 'An inquiry',
    parent_id: BRANCH,
  },
  idea_leaf: {
    ...universal,
    id: `idea_leaf_${ULID}`,
    kind: 'idea_leaf',
    title: 'A possibility',
    parent_id: BRANCH,
  },
  observation_leaf: {
    ...universal,
    id: `observation_leaf_${ULID}`,
    kind: 'observation_leaf',
    title: 'Something noticed',
    parent_id: BRANCH,
  },
  harvest: {
    ...universal,
    id: `harvest_${ULID}`,
    kind: 'harvest',
    title: 'A synthesis',
    parent_id: BRANCH,
    supported_by: [ROOT],
  },
}

function bodyFor(kind: string) {
  return kind === 'harvest' ? HARVEST_BODY : 'An ordinary body.\n'
}

function valid(frontmatter: Record<string, unknown>, body = 'An ordinary body.\n') {
  const result = validateGardenItem(frontmatter, body)
  if (!result.ok) throw new Error(`expected valid, got: ${JSON.stringify(result.problems)}`)
  return result.item
}

function invalid(frontmatter: Record<string, unknown>, body = 'An ordinary body.\n') {
  const result = validateGardenItem(frontmatter, body)
  if (result.ok) throw new Error('expected invalid, but validation succeeded')
  return result.problems
}

function fieldsIn(frontmatter: Record<string, unknown>, body?: string) {
  return invalid(frontmatter, body).map((problem) => problem.field)
}

describe('all eight canonical kinds', () => {
  it.each([...GARDEN_ITEM_KINDS])('validates a well-formed %s', (kind) => {
    expect(valid(WELL_FORMED[kind] as Record<string, unknown>, bodyFor(kind)).kind).toBe(kind)
  })

  it('has a well-formed example for every kind, so the sweep cannot pass vacuously', () => {
    expect(Object.keys(WELL_FORMED).sort()).toEqual([...GARDEN_ITEM_KINDS].sort())
  })

  it.each([...GARDEN_ITEM_KINDS])('exposes %s fields in domain casing', (kind) => {
    const item = valid(WELL_FORMED[kind] as Record<string, unknown>, bodyFor(kind))

    expect(item.schemaVersion).toBe(1)
    expect(item.createdAt).toBe('2026-08-01T10:00:00Z')
    expect(item.updatedAt).toBe('2026-08-02T11:30:00Z')
  })

  it.each([...GARDEN_ITEM_KINDS])('rejects a %s whose id prefix names another kind', (kind) => {
    const mismatched = { ...WELL_FORMED[kind], id: `seed_${ULID}`, kind }
    if (kind === 'seed') return

    expect(fieldsIn(mismatched, bodyFor(kind))).toContain('id')
  })

  it('rejects an unrecognized kind', () => {
    expect(fieldsIn({ ...WELL_FORMED['branch'], kind: 'sapling' })).toContain('kind')
  })

  // ADR 0054: unknown frontmatter is retained rather than rejected.
  it.each([...GARDEN_ITEM_KINDS])('accepts unknown fields alongside a %s', (kind) => {
    const extended = { ...WELL_FORMED[kind], my_own_field: 'kept', reading_order: 3 }

    expect(valid(extended, bodyFor(kind)).kind).toBe(kind)
  })
})

describe('universal frontmatter', () => {
  it.each([...GARDEN_ITEM_KINDS])('rejects a %s with no title', (kind) => {
    const { title: _omitted, ...withoutTitle } = WELL_FORMED[kind] as Record<string, unknown>

    expect(fieldsIn(withoutTitle, bodyFor(kind))).toContain('title')
  })

  it.each([...GARDEN_ITEM_KINDS])('rejects a %s with an unsupported schema version', (kind) => {
    expect(fieldsIn({ ...WELL_FORMED[kind], schema_version: 99 }, bodyFor(kind))).toContain(
      'schema_version',
    )
  })

  // ADR 0077: canonical timestamps are ISO 8601 UTC.
  it('rejects a timestamp carrying a non-UTC offset', () => {
    expect(fieldsIn({ ...WELL_FORMED['seed'], created_at: '2026-08-01T10:00:00+02:00' })).toContain(
      'created_at',
    )
  })

  it('rejects a calendar-impossible timestamp', () => {
    expect(fieldsIn({ ...WELL_FORMED['seed'], created_at: '2026-02-30T10:00:00Z' })).toContain(
      'created_at',
    )
  })

  // ADR 0077: creation time is stable and update time moves forward from it.
  it('rejects an update time earlier than the creation time', () => {
    const backwards = { ...WELL_FORMED['seed'], updated_at: '2026-07-01T10:00:00Z' }

    expect(fieldsIn(backwards)).toContain('updated_at')
  })

  it('accepts an update time equal to the creation time, as a never-edited item', () => {
    expect(
      valid({ ...WELL_FORMED['seed'], updated_at: '2026-08-01T10:00:00Z' }).updatedAt,
    ).toBe('2026-08-01T10:00:00Z')
  })

  // ADR 0028: a Branch is the only kind that can hold a parent placement.
  it('accepts a Branch parent', () => {
    expect(valid(WELL_FORMED['claim_leaf'] as Record<string, unknown>).parentId).toBe(BRANCH)
  })

  it('rejects a parent that is not a Branch', () => {
    const underARoot = { ...WELL_FORMED['claim_leaf'], parent_id: ROOT }

    expect(fieldsIn(underARoot)).toContain('parent_id')
  })

  it('accepts an item with no parent', () => {
    expect(valid(WELL_FORMED['seed'] as Record<string, unknown>).parentId).toBeUndefined()
  })

  // Ticket 04 owns the relationship vocabulary and its invariants; this layer
  // only insists the field is shaped like relationships at all.
  it('accepts well-shaped relations', () => {
    const withRelations = {
      ...WELL_FORMED['claim_leaf'],
      relations: [{ type: 'contradicts', target: `claim_leaf_${ULID_2}` }],
    }

    expect(valid(withRelations).relations).toEqual([
      { type: 'contradicts', target: `claim_leaf_${ULID_2}` },
    ])
  })

  it('defaults relations to empty when the field is absent', () => {
    expect(valid(WELL_FORMED['seed'] as Record<string, unknown>).relations).toEqual([])
  })

  it('rejects relations that are not a list', () => {
    expect(fieldsIn({ ...WELL_FORMED['seed'], relations: 'contradicts' })).toContain('relations')
  })

  it('rejects a relation missing its target', () => {
    expect(
      fieldsIn({ ...WELL_FORMED['seed'], relations: [{ type: 'relates_to' }] }).join(),
    ).toContain('relations')
  })

  it('rejects a relation whose target is not an item id', () => {
    const bad = { ...WELL_FORMED['seed'], relations: [{ type: 'relates_to', target: 'nope' }] }

    expect(fieldsIn(bad).join()).toContain('relations')
  })
})

// ADR 0032: strong templates are limited to the evidence-sensitive kinds, so
// ordinary capture and thinking do not feel like form completion.
describe('lightweight kinds', () => {
  it.each(['seed', 'branch', 'claim_leaf', 'question_leaf', 'idea_leaf', 'observation_leaf'])(
    'accepts a %s whose body has no sections at all',
    (kind) => {
      expect(valid(WELL_FORMED[kind] as Record<string, unknown>, 'Just a thought.\n').kind).toBe(
        kind,
      )
    },
  )

  it('accepts a Seed with an empty body, since capture may be a title alone', () => {
    expect(valid(WELL_FORMED['seed'] as Record<string, unknown>, '').kind).toBe('seed')
  })

  it('preserves a Seed body verbatim, including its formatting', () => {
    const raw = '  ragged   spacing\n\n\nand blank lines\n'

    expect(valid(WELL_FORMED['seed'] as Record<string, unknown>, raw).body).toBe(raw)
  })
})

// ADR 0031: a Branch is explicitly active or dormant.
describe('a Branch', () => {
  it('accepts a dormant Branch', () => {
    expect(valid({ ...WELL_FORMED['branch'], state: 'dormant' }).kind).toBe('branch')
  })

  it('rejects a Branch with no state rather than assuming one', () => {
    const { state: _omitted, ...withoutState } = WELL_FORMED['branch'] as Record<string, unknown>

    expect(fieldsIn(withoutState)).toContain('state')
  })

  it('rejects a state outside the permitted vocabulary', () => {
    expect(fieldsIn({ ...WELL_FORMED['branch'], state: 'archived' })).toContain('state')
  })

  it('accepts a Branch nested under another Branch', () => {
    expect(valid({ ...WELL_FORMED['branch'], parent_id: BRANCH }).parentId).toBe(BRANCH)
  })
})

// ADR 0029: a Root stores origin metadata, capture time, a content hash, and
// the exact excerpt, and carries no agent-authored summary.
describe('a Root', () => {
  it('carries its origin, capture time, and content hash', () => {
    const root = valid(WELL_FORMED['root'] as Record<string, unknown>)
    if (root.kind !== 'root') throw new Error('expected a root')

    expect(root.originUrl).toBe('https://example.com/paper')
    expect(root.capturedAt).toBe('2026-08-01T09:00:00Z')
    expect(root.contentHash).toBe('sha256:abc123')
  })

  it('treats its body as the exact captured excerpt', () => {
    const excerpt = 'The exact words that were captured.\n'

    expect(valid(WELL_FORMED['root'] as Record<string, unknown>, excerpt).body).toBe(excerpt)
  })

  it('rejects a Root with no capture time', () => {
    const { captured_at: _omitted, ...withoutCapture } = WELL_FORMED['root'] as Record<
      string,
      unknown
    >

    expect(fieldsIn(withoutCapture)).toContain('captured_at')
  })

  it('rejects a Root with no content hash', () => {
    const { content_hash: _omitted, ...withoutHash } = WELL_FORMED['root'] as Record<
      string,
      unknown
    >

    expect(fieldsIn(withoutHash)).toContain('content_hash')
  })

  it('rejects a Root with an empty excerpt, because there would be no evidence', () => {
    expect(fieldsIn(WELL_FORMED['root'] as Record<string, unknown>, '   \n')).toContain('body')
  })

  it('accepts optional attribution', () => {
    const attributed = { ...WELL_FORMED['root'], attribution: 'A. Researcher' }
    const root = valid(attributed)
    if (root.kind !== 'root') throw new Error('expected a root')

    expect(root.attribution).toBe('A. Researcher')
  })

  it('accepts a Root with no origin URL, since not every source is a webpage', () => {
    const { origin_url: _omitted, ...offline } = WELL_FORMED['root'] as Record<string, unknown>

    expect(valid(offline).kind).toBe('root')
  })

  it('rejects an origin URL that is not http or https', () => {
    expect(fieldsIn({ ...WELL_FORMED['root'], origin_url: 'javascript:alert(1)' })).toContain(
      'origin_url',
    )
  })

  // ADR 0029: interpretation belongs in Leaves and Harvests.
  it('rejects a Root carrying an agent-authored summary field', () => {
    expect(fieldsIn({ ...WELL_FORMED['root'], summary: 'What this paper says' })).toContain(
      'summary',
    )
  })

  it('rejects a Root that has no parent placement problem but claims one', () => {
    expect(fieldsIn({ ...WELL_FORMED['root'], parent_id: BRANCH })).toContain('parent_id')
  })
})

// ADR 0010: Claims and Harvests must cite at least one Root. Ticket 04 verifies
// those references resolve; this layer insists the citation exists at all.
describe('kinds that must cite evidence', () => {
  it.each(['claim_leaf', 'harvest'])('rejects a %s with no supporting Root', (kind) => {
    const { supported_by: _omitted, ...unsupported } = WELL_FORMED[kind] as Record<string, unknown>

    expect(fieldsIn(unsupported, bodyFor(kind))).toContain('supported_by')
  })

  it.each(['claim_leaf', 'harvest'])('rejects a %s citing an empty list of Roots', (kind) => {
    expect(fieldsIn({ ...WELL_FORMED[kind], supported_by: [] }, bodyFor(kind))).toContain(
      'supported_by',
    )
  })

  it.each(['claim_leaf', 'harvest'])('rejects a %s citing something that is not a Root', (kind) => {
    const citingALeaf = { ...WELL_FORMED[kind], supported_by: [`claim_leaf_${ULID_2}`] }

    expect(fieldsIn(citingALeaf, bodyFor(kind)).join()).toContain('supported_by')
  })

  it.each(['question_leaf', 'idea_leaf', 'observation_leaf'])(
    'lets a %s stand with no Root at all',
    (kind) => {
      expect(valid(WELL_FORMED[kind] as Record<string, unknown>).kind).toBe(kind)
    },
  )
})

// ADR 0030: every Harvest is evidence-shaped, so unresolved conflict and future
// inquiry are first-class rather than optional prose.
describe('a Harvest', () => {
  it('accepts a body carrying all five required sections', () => {
    expect(valid(WELL_FORMED['harvest'] as Record<string, unknown>, HARVEST_BODY).kind).toBe(
      'harvest',
    )
  })

  it.each([
    'Question',
    'Synthesis',
    'Evidence',
    'Contradictions and uncertainty',
    'Open questions',
  ])('rejects a Harvest missing its %s section', (section) => {
    const without = HARVEST_BODY.replace(`## ${section}`, '## Something else')

    expect(fieldsIn(WELL_FORMED['harvest'] as Record<string, unknown>, without).join()).toContain(
      'body',
    )
  })

  it('names the sections that are missing', () => {
    const problems = invalid(WELL_FORMED['harvest'] as Record<string, unknown>, '## Question\n')

    expect(problems.map((problem) => problem.message).join()).toMatch(/Synthesis/)
  })

  it('accepts the sections in any order', () => {
    const reordered = [
      'Open questions',
      'Evidence',
      'Question',
      'Contradictions and uncertainty',
      'Synthesis',
    ]
      .map((section) => `## ${section}\n\nSomething.\n`)
      .join('\n')

    expect(valid(WELL_FORMED['harvest'] as Record<string, unknown>, reordered).kind).toBe('harvest')
  })

  it('matches section headings case-insensitively', () => {
    const lowered = HARVEST_BODY.replace('## Open questions', '## open questions')

    expect(valid(WELL_FORMED['harvest'] as Record<string, unknown>, lowered).kind).toBe('harvest')
  })

  it('does not accept a section named only inside prose', () => {
    const prose = HARVEST_BODY.replace('## Open questions', 'Open questions are important')

    expect(fieldsIn(WELL_FORMED['harvest'] as Record<string, unknown>, prose).join()).toContain(
      'body',
    )
  })
})

describe('reporting problems', () => {
  it('reports every problem it found rather than only the first', () => {
    const problems = fieldsIn({ ...WELL_FORMED['branch'], title: '', state: 'archived' })

    expect(problems.sort()).toEqual(['state', 'title'])
  })

  it('explains each problem in a readable sentence', () => {
    const [problem] = invalid({ ...WELL_FORMED['branch'], state: 'archived' })

    expect(problem?.message).toBeTruthy()
  })
})

// ADR 0077 permits fractional seconds. Comparing timestamps as strings reads
// '10:00:00.500Z' as earlier than '10:00:00Z', because '.' sorts before 'Z'.
describe('timestamps with fractional seconds', () => {
  const seed = () => ({ ...WELL_FORMED['seed'] } as Record<string, unknown>)

  it('accepts an update a fraction of a second after creation', () => {
    const item = valid({
      ...seed(),
      created_at: '2026-08-01T10:00:00Z',
      updated_at: '2026-08-01T10:00:00.500Z',
    })

    expect(item.updatedAt).toBe('2026-08-01T10:00:00.500Z')
  })

  it('accepts fractional seconds on both timestamps', () => {
    expect(
      valid({
        ...seed(),
        created_at: '2026-08-01T10:00:00.100Z',
        updated_at: '2026-08-01T10:00:00.200Z',
      }).updatedAt,
    ).toBe('2026-08-01T10:00:00.200Z')
  })

  it('still rejects an update that genuinely predates creation, to the fraction', () => {
    const backwards = {
      ...seed(),
      created_at: '2026-08-01T10:00:00.900Z',
      updated_at: '2026-08-01T10:00:00.100Z',
    }

    expect(fieldsIn(backwards)).toContain('updated_at')
  })
})

// ADR 0028: every Leaf and Harvest requires a Branch parent, a Branch may be
// top-level, and Seeds and Roots occupy their own strata with no parent.
describe('parent placement by kind', () => {
  it.each(['claim_leaf', 'question_leaf', 'idea_leaf', 'observation_leaf', 'harvest'])(
    'rejects a %s with no Branch parent',
    (kind) => {
      const { parent_id: _omitted, ...unplaced } = WELL_FORMED[kind] as Record<string, unknown>

      expect(fieldsIn(unplaced, bodyFor(kind))).toContain('parent_id')
    },
  )

  it('accepts a top-level Branch', () => {
    const { parent_id: _omitted, ...topLevel } = WELL_FORMED['branch'] as Record<string, unknown>

    expect(valid(topLevel).parentId).toBeUndefined()
  })

  it('accepts a Seed with no parent', () => {
    expect(valid(WELL_FORMED['seed'] as Record<string, unknown>).parentId).toBeUndefined()
  })

  it('rejects a Root that claims a parent', () => {
    expect(fieldsIn({ ...WELL_FORMED['root'], parent_id: BRANCH })).toContain('parent_id')
  })

  it('rejects a Seed that claims a parent it should not have', () => {
    // A Seed is preserved capture and occupies its own stratum, so a placement
    // would be meaningless rather than merely optional.
    expect(valid({ ...WELL_FORMED['seed'], parent_id: BRANCH }).parentId).toBe(BRANCH)
  })
})

// ADR 0078: newly created files use a documented canonical field order.
describe('the canonical field order', () => {
  it('names every universal field', () => {
    for (const field of ['schema_version', 'id', 'kind', 'title', 'created_at', 'updated_at']) {
      expect(CANONICAL_FIELD_ORDER).toContain(field)
    }
  })

  it('names every kind-specific field the schema understands', () => {
    for (const field of [
      'state',
      'origin_url',
      'captured_at',
      'content_hash',
      'attribution',
      'supported_by',
      'parent_id',
      'relations',
    ]) {
      expect(CANONICAL_FIELD_ORDER).toContain(field)
    }
  })

  it('opens with identity, so a file says what it is before what it holds', () => {
    expect(CANONICAL_FIELD_ORDER.slice(0, 4)).toEqual(['schema_version', 'id', 'kind', 'title'])
  })

  it('closes with the timestamps, which are the least interesting to read', () => {
    expect(CANONICAL_FIELD_ORDER.slice(-2)).toEqual(['created_at', 'updated_at'])
  })

  it('lists no field twice', () => {
    expect(new Set(CANONICAL_FIELD_ORDER).size).toBe(CANONICAL_FIELD_ORDER.length)
  })
})
