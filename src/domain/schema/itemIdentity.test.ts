import { describe, expect, it } from 'vitest'
import {
  ATTACHMENTS_DIRECTORY,
  CANONICAL_DIRECTORIES,
  GARDEN_ITEM_KINDS,
  OPERATIONAL_DIRECTORY,
  directoryForKind,
  fileNameFor,
  isValidItemId,
  parseItemId,
  titleSlug,
} from './itemIdentity'

const ULID = '01HQ8X2K3M4N5P6Q7R8S9T0V1W'

describe('the eight canonical kinds', () => {
  it('covers exactly the kinds the design record names', () => {
    expect([...GARDEN_ITEM_KINDS]).toEqual([
      'seed',
      'root',
      'branch',
      'claim_leaf',
      'question_leaf',
      'idea_leaf',
      'observation_leaf',
      'harvest',
    ])
  })
})

// ADR 0034: a kind-prefixed ULID, so identity carries its own kind and survives
// renaming the file.
describe('item identity', () => {
  it.each([...GARDEN_ITEM_KINDS])('accepts a %s id carrying its own kind', (kind) => {
    expect(isValidItemId(`${kind}_${ULID}`, kind)).toBe(true)
  })

  it.each([...GARDEN_ITEM_KINDS])('reads the kind and ULID back out of a %s id', (kind) => {
    expect(parseItemId(`${kind}_${ULID}`)).toEqual({ kind, ulid: ULID })
  })

  it('rejects an id whose prefix names a different kind', () => {
    expect(isValidItemId(`seed_${ULID}`, 'harvest')).toBe(false)
  })

  it('reads a multi-word kind without mistaking the underscore for the separator', () => {
    expect(parseItemId(`claim_leaf_${ULID}`)).toEqual({ kind: 'claim_leaf', ulid: ULID })
  })

  /**
   * What actually makes an id unambiguous. Parsing tries kinds longest-first,
   * but that alone would silently pick a winner if one kind were ever a prefix
   * of another; this is the invariant that keeps the choice from arising.
   */
  it('has no kind that is a prefix of another kind', () => {
    const colliding = GARDEN_ITEM_KINDS.flatMap((kind) =>
      GARDEN_ITEM_KINDS.filter((other) => other !== kind && other.startsWith(`${kind}_`)).map(
        (other) => `${kind} / ${other}`,
      ),
    )

    expect(colliding).toEqual([])
  })

  it('rejects an unknown prefix', () => {
    expect(parseItemId(`sapling_${ULID}`)).toBeUndefined()
  })

  it('rejects an id with no ULID', () => {
    expect(parseItemId('branch_')).toBeUndefined()
  })

  it('rejects a ULID of the wrong length', () => {
    expect(parseItemId('branch_01HQ8X2K3M')).toBeUndefined()
  })

  it('rejects letters excluded from the ULID alphabet', () => {
    expect(parseItemId('branch_01HQ8X2K3M4N5P6Q7R8S9T0VIL')).toBeUndefined()
  })

  it('rejects a lowercase ULID, so one identity has one spelling', () => {
    expect(parseItemId(`branch_${ULID.toLowerCase()}`)).toBeUndefined()
  })

  it('rejects a ULID whose first character overflows the timestamp', () => {
    expect(parseItemId('branch_81HQ8X2K3M4N5P6Q7R8S9T0V1W')).toBeUndefined()
  })
})

// ADR 0034: the Garden Repository stays pleasant to browse without Research
// Garden, so the filename is a readable title slug rather than the identity.
describe('deriving a filename from a title', () => {
  it('slugs an ordinary title', () => {
    expect(titleSlug('Attention mechanisms')).toBe('attention-mechanisms')
  })

  it('collapses punctuation and repeated separators', () => {
    expect(titleSlug('What *is* attention, really?!')).toBe('what-is-attention-really')
  })

  it('trims separators from the ends', () => {
    expect(titleSlug('  --- Attention ---  ')).toBe('attention')
  })

  it('keeps digits', () => {
    expect(titleSlug('GPT-4 scaling')).toBe('gpt-4-scaling')
  })

  it('transliterates accented characters rather than dropping them', () => {
    expect(titleSlug('Café résumé')).toBe('cafe-resume')
  })

  it('falls back to a readable stem when a title slugs to nothing', () => {
    expect(titleSlug('???')).toBe('untitled')
  })

  it('bounds a very long title so the filename stays usable', () => {
    expect(titleSlug('a'.repeat(200)).length).toBeLessThanOrEqual(80)
  })

  it('does not end the bounded slug on a separator', () => {
    expect(titleSlug(`${'word '.repeat(40)}`).endsWith('-')).toBe(false)
  })
})

describe('choosing a file name', () => {
  const item = { id: `branch_${ULID}`, kind: 'branch' as const, title: 'Attention mechanisms' }

  it('uses the title slug when nothing else claims it', () => {
    expect(fileNameFor(item, new Set())).toBe('attention-mechanisms.md')
  })

  // ADR 0034: a short identity suffix only when needed to resolve a collision.
  it('adds a short identity suffix when the slug is already taken', () => {
    const chosen = fileNameFor(item, new Set(['attention-mechanisms.md']))

    expect(chosen).not.toBe('attention-mechanisms.md')
    expect(chosen).toMatch(/^attention-mechanisms-[0-9A-Z]{6}\.md$/)
  })

  it('derives the suffix from the item’s own identity, so it is stable', () => {
    const taken = new Set(['attention-mechanisms.md'])

    expect(fileNameFor(item, taken)).toBe(fileNameFor(item, taken))
  })

  it('adds no suffix to a name that merely resembles a taken one', () => {
    expect(fileNameFor(item, new Set(['attention.md']))).toBe('attention-mechanisms.md')
  })

  it('lengthens the suffix if even that collides', () => {
    const suffixed = fileNameFor(item, new Set(['attention-mechanisms.md']))

    const further = fileNameFor(item, new Set(['attention-mechanisms.md', suffixed]))
    expect(further).not.toBe(suffixed)
    expect(further).toMatch(/^attention-mechanisms-[0-9A-Z]+\.md$/)
  })
})

// ADR 0011: canonical Markdown is organized by botanical type, attachments are
// separate, and rebuildable state lives under the operational directory.
describe('the per-kind directory layout', () => {
  it.each([
    ['seed', 'seeds'],
    ['root', 'roots'],
    ['branch', 'branches'],
    ['harvest', 'harvests'],
  ] as const)('files a %s under %s', (kind, directory) => {
    expect(directoryForKind(kind)).toBe(directory)
  })

  it.each(['claim_leaf', 'question_leaf', 'idea_leaf', 'observation_leaf'] as const)(
    'files a %s under leaves, because every Leaf kind shares one directory',
    (kind) => {
      expect(directoryForKind(kind)).toBe('leaves')
    },
  )

  it('files every kind into a canonical directory', () => {
    for (const kind of GARDEN_ITEM_KINDS) {
      expect(directoryForKind(kind)).toBeTruthy()
    }
  })

  it('never files a canonical item into attachments or the operational directory', () => {
    const directories = GARDEN_ITEM_KINDS.map(directoryForKind)

    expect(directories).not.toContain(ATTACHMENTS_DIRECTORY)
    expect(directories).not.toContain(OPERATIONAL_DIRECTORY)
  })

  it('scans only the canonical directories, so neither is ever read as knowledge', () => {
    expect(CANONICAL_DIRECTORIES).not.toContain(ATTACHMENTS_DIRECTORY)
    expect(CANONICAL_DIRECTORIES).not.toContain(OPERATIONAL_DIRECTORY)
  })

  it('derives the scanned directories from the kinds rather than restating them', () => {
    expect([...CANONICAL_DIRECTORIES].sort()).toEqual(
      [...new Set(GARDEN_ITEM_KINDS.map(directoryForKind))].sort(),
    )
  })
})
