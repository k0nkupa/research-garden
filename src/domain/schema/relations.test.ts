import { describe, expect, it } from 'vitest'
import { GARDEN_ITEM_KINDS } from './itemIdentity'
import {
  RELATIONS_IN_FRONTMATTER,
  RELATION_FIELD,
  RELATION_PAIRINGS,
  RELATION_TYPES,
  isPermittedPairing,
  isRelationType,
  isSymmetricRelation,
} from './relations'

// ADR 0017: exactly six, so an agent cannot fragment the graph with synonyms.
describe('the controlled vocabulary', () => {
  it('recognizes exactly the six relationships the design record names', () => {
    expect([...RELATION_TYPES]).toEqual([
      'parent',
      'derived_from',
      'supports',
      'answers',
      'contradicts',
      'relates_to',
    ])
  })

  it('rejects an invented relationship name', () => {
    expect(isRelationType('inspires')).toBe(false)
  })

  it('rejects a plausible synonym for one it does know', () => {
    expect(isRelationType('proves')).toBe(false)
    expect(isRelationType('disproves')).toBe(false)
    expect(isRelationType('related_to')).toBe(false)
  })

  it('rejects a non-string', () => {
    expect(isRelationType(undefined)).toBe(false)
    expect(isRelationType(7)).toBe(false)
  })
})

// ADR 0079: Contradicts and Relates To are symmetric; the rest are directional.
describe('direction', () => {
  it.each(['parent', 'derived_from', 'supports', 'answers'] as const)(
    '%s is directional',
    (type) => {
      expect(isSymmetricRelation(type)).toBe(false)
    },
  )

  it.each(['contradicts', 'relates_to'] as const)('%s is a symmetric Cross-link', (type) => {
    expect(isSymmetricRelation(type)).toBe(true)
  })

  it('classifies every relation one way or the other', () => {
    const classified = RELATION_TYPES.filter(
      (type) => isSymmetricRelation(type) || !isSymmetricRelation(type),
    )

    expect(classified).toHaveLength(RELATION_TYPES.length)
  })
})

/**
 * ADR 0020: Parent lives in `parent_id` and Supports lives in `supported_by`,
 * so neither may also be spelled in `relations`. Two spellings of one fact is
 * the fragmentation the vocabulary exists to prevent.
 */
describe('where each relation is written', () => {
  it('carries Parent in parent_id', () => {
    expect(RELATION_FIELD['parent']).toBe('parent_id')
  })

  it('carries Supports in supported_by, on the Claim rather than the Root', () => {
    expect(RELATION_FIELD['supports']).toBe('supported_by')
  })

  it('allows only the remaining four in the relations list', () => {
    expect([...RELATIONS_IN_FRONTMATTER]).toEqual([
      'derived_from',
      'answers',
      'contradicts',
      'relates_to',
    ])
  })

  it('gives every relation exactly one home', () => {
    for (const type of RELATION_TYPES) {
      expect(RELATION_FIELD[type]).toBeTruthy()
    }
  })
})

// ADR 0079: kind pairings, so a relation that could not mean anything is refused.
describe('permitted kind pairings', () => {
  it('lets a Leaf be placed under a Branch', () => {
    expect(isPermittedPairing('parent', 'claim_leaf', 'branch')).toBe(true)
  })

  it('lets a Branch nest under another Branch', () => {
    expect(isPermittedPairing('parent', 'branch', 'branch')).toBe(true)
  })

  it('refuses to place a Seed under a Branch, because Seeds occupy their own stratum', () => {
    expect(isPermittedPairing('parent', 'seed', 'branch')).toBe(false)
  })

  it('refuses to place a Root under a Branch', () => {
    expect(isPermittedPairing('parent', 'root', 'branch')).toBe(false)
  })

  it('refuses a parent that is not a Branch', () => {
    expect(isPermittedPairing('parent', 'claim_leaf', 'harvest')).toBe(false)
  })

  it('lets a Root support a Claim Leaf', () => {
    expect(isPermittedPairing('supports', 'root', 'claim_leaf')).toBe(true)
  })

  it('lets a Root support a Harvest', () => {
    expect(isPermittedPairing('supports', 'root', 'harvest')).toBe(true)
  })

  it('refuses to let a Root support a Question Leaf, which asserts nothing', () => {
    expect(isPermittedPairing('supports', 'root', 'question_leaf')).toBe(false)
  })

  it('refuses to let anything but a Root be evidence', () => {
    expect(isPermittedPairing('supports', 'claim_leaf', 'harvest')).toBe(false)
  })

  it('lets a Harvest answer a Question Leaf', () => {
    expect(isPermittedPairing('answers', 'harvest', 'question_leaf')).toBe(true)
  })

  it('refuses to let a Claim Leaf answer a Question Leaf', () => {
    expect(isPermittedPairing('answers', 'claim_leaf', 'question_leaf')).toBe(false)
  })

  it('refuses to let a Harvest answer something that is not a question', () => {
    expect(isPermittedPairing('answers', 'harvest', 'idea_leaf')).toBe(false)
  })

  it('lets a Claim Leaf contradict another Claim Leaf', () => {
    expect(isPermittedPairing('contradicts', 'claim_leaf', 'claim_leaf')).toBe(true)
  })

  it('refuses to let an Idea Leaf contradict anything, since it asserts nothing', () => {
    expect(isPermittedPairing('contradicts', 'idea_leaf', 'claim_leaf')).toBe(false)
  })

  it('lets any kind be derived from a Seed', () => {
    for (const kind of GARDEN_ITEM_KINDS) {
      if (kind === 'seed') continue
      expect(isPermittedPairing('derived_from', kind, 'seed')).toBe(true)
    }
  })

  it('refuses to derive a Seed from a Seed, because a Seed is the original capture', () => {
    expect(isPermittedPairing('derived_from', 'seed', 'seed')).toBe(false)
  })

  it('refuses to derive something from anything but a Seed', () => {
    expect(isPermittedPairing('derived_from', 'harvest', 'branch')).toBe(false)
  })

  it('lets Relates To join any two kinds, being the fallback Cross-link', () => {
    for (const source of GARDEN_ITEM_KINDS) {
      for (const target of GARDEN_ITEM_KINDS) {
        expect(isPermittedPairing('relates_to', source, target)).toBe(true)
      }
    }
  })

  it('defines a pairing for every relation, so none is silently unconstrained', () => {
    for (const type of RELATION_TYPES) {
      expect(RELATION_PAIRINGS[type].sources.length).toBeGreaterThan(0)
      expect(RELATION_PAIRINGS[type].targets.length).toBeGreaterThan(0)
    }
  })

  it('names only real kinds in every pairing', () => {
    for (const type of RELATION_TYPES) {
      for (const kind of [...RELATION_PAIRINGS[type].sources, ...RELATION_PAIRINGS[type].targets]) {
        expect(GARDEN_ITEM_KINDS).toContain(kind)
      }
    }
  })
})
