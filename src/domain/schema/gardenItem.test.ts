import { describe, expect, it } from 'vitest'
import { validateGardenItem } from './gardenItem'

const wellFormedBranch = {
  schema_version: 1,
  id: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
  kind: 'branch',
  title: 'Attention mechanisms',
  state: 'active',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-02T11:30:00Z',
}

function expectValid(frontmatter: Record<string, unknown>) {
  const result = validateGardenItem(frontmatter)
  if (!result.ok) throw new Error(`expected valid, got: ${JSON.stringify(result.problems)}`)
  return result.item
}

function expectInvalid(frontmatter: Record<string, unknown>) {
  const result = validateGardenItem(frontmatter)
  if (result.ok) throw new Error('expected invalid, but validation succeeded')
  return result.problems
}

describe('a well-formed Branch', () => {
  it('validates', () => {
    expect(expectValid(wellFormedBranch)).toMatchObject({
      id: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
      kind: 'branch',
      title: 'Attention mechanisms',
      state: 'active',
    })
  })

  it('exposes its fields in domain casing rather than on-disk casing', () => {
    const item = expectValid(wellFormedBranch)

    expect(item.schemaVersion).toBe(1)
    expect(item.createdAt).toBe('2026-08-01T10:00:00Z')
    expect(item.updatedAt).toBe('2026-08-02T11:30:00Z')
  })

  it('accepts a dormant Branch', () => {
    expect(expectValid({ ...wellFormedBranch, state: 'dormant' }).state).toBe('dormant')
  })

  // ADR 0031 requires the state to be explicit, so it is not defaulted.
  it('rejects a Branch with no state rather than assuming one', () => {
    const { state: _omitted, ...withoutState } = wellFormedBranch

    expect(expectInvalid(withoutState).map((p) => p.field)).toContain('state')
  })

  it('accepts a nested Branch with a parent', () => {
    const nested = { ...wellFormedBranch, parent_id: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X' }

    expect(expectValid(nested).parentId).toBe('branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X')
  })

  it('accepts a top-level Branch with no parent', () => {
    expect(expectValid(wellFormedBranch).parentId).toBeUndefined()
  })

  // ADR 0054: unknown frontmatter is retained, not rejected.
  it('accepts unknown fields alongside the ones it understands', () => {
    const extended = { ...wellFormedBranch, my_own_field: 'kept', reading_order: 3 }

    expect(expectValid(extended).kind).toBe('branch')
  })
})

describe('a malformed Branch', () => {
  it('rejects a missing title', () => {
    const { title: _omitted, ...withoutTitle } = wellFormedBranch

    expect(expectInvalid(withoutTitle).map((p) => p.field)).toContain('title')
  })

  it('rejects an empty title', () => {
    expect(expectInvalid({ ...wellFormedBranch, title: '   ' }).map((p) => p.field)).toContain(
      'title',
    )
  })

  it('rejects a title that is not a string', () => {
    expect(expectInvalid({ ...wellFormedBranch, title: 42 }).map((p) => p.field)).toContain('title')
  })

  it('rejects a missing id', () => {
    const { id: _omitted, ...withoutId } = wellFormedBranch

    expect(expectInvalid(withoutId).map((p) => p.field)).toContain('id')
  })

  // ADR 0034: a kind-prefixed ULID, so identity carries its own kind.
  it('rejects an id whose prefix does not match its kind', () => {
    const mismatched = { ...wellFormedBranch, id: 'leaf_01HQ8X2K3M4N5P6Q7R8S9T0V1W' }

    expect(expectInvalid(mismatched).map((p) => p.field)).toContain('id')
  })

  it('rejects an id that is not a ULID', () => {
    expect(expectInvalid({ ...wellFormedBranch, id: 'branch_nope' }).map((p) => p.field)).toContain(
      'id',
    )
  })

  it('rejects an id using letters excluded from the ULID alphabet', () => {
    const ambiguous = { ...wellFormedBranch, id: 'branch_01HQ8X2K3M4N5P6Q7R8S9T0VIL' }

    expect(expectInvalid(ambiguous).map((p) => p.field)).toContain('id')
  })

  it('rejects an unrecognized kind', () => {
    expect(expectInvalid({ ...wellFormedBranch, kind: 'sapling' }).map((p) => p.field)).toContain(
      'kind',
    )
  })

  it('rejects a missing kind', () => {
    const { kind: _omitted, ...withoutKind } = wellFormedBranch

    expect(expectInvalid(withoutKind).map((p) => p.field)).toContain('kind')
  })

  it('rejects a state outside the permitted vocabulary', () => {
    expect(expectInvalid({ ...wellFormedBranch, state: 'archived' }).map((p) => p.field)).toContain(
      'state',
    )
  })

  it('rejects a missing schema version', () => {
    const { schema_version: _omitted, ...withoutVersion } = wellFormedBranch

    expect(expectInvalid(withoutVersion).map((p) => p.field)).toContain('schema_version')
  })

  it('rejects an unsupported schema version', () => {
    expect(
      expectInvalid({ ...wellFormedBranch, schema_version: 99 }).map((p) => p.field),
    ).toContain('schema_version')
  })

  // ADR 0077: canonical timestamps are ISO 8601 UTC.
  it('rejects a timestamp that is not ISO 8601 UTC', () => {
    const local = { ...wellFormedBranch, created_at: '2026-08-01 10:00:00 +01:00' }

    expect(expectInvalid(local).map((p) => p.field)).toContain('created_at')
  })

  it('rejects a timestamp carrying a non-UTC offset', () => {
    const offset = { ...wellFormedBranch, updated_at: '2026-08-01T10:00:00+02:00' }

    expect(expectInvalid(offset).map((p) => p.field)).toContain('updated_at')
  })

  it('rejects a calendar-impossible timestamp', () => {
    expect(
      expectInvalid({ ...wellFormedBranch, created_at: '2026-02-30T10:00:00Z' }).map((p) => p.field),
    ).toContain('created_at')
  })

  it('reports every problem it found rather than only the first', () => {
    const problems = expectInvalid({ ...wellFormedBranch, title: '', state: 'archived' })

    expect(problems.map((p) => p.field).sort()).toEqual(['state', 'title'])
  })

  it('explains each problem in a readable sentence', () => {
    const [problem] = expectInvalid({ ...wellFormedBranch, state: 'archived' })

    expect(problem?.message).toBeTruthy()
  })
})
