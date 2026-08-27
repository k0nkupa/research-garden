import { describe, expect, it } from 'vitest'
import { GARDEN_ITEM_KINDS, parseItemId } from './itemIdentity'
import { createItemIdFactory, createUlidFactory, type UlidEntropy } from './ulid'

/** Deterministic entropy, so a generator can be judged rather than guessed at. */
function fixedEntropy(milliseconds: number, byteValue = 0): UlidEntropy {
  return {
    now: () => milliseconds,
    randomBytes: (into) => into.fill(byteValue),
  }
}

function countingEntropy(startAt = 1_700_000_000_000): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => startAt + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

describe('generating a ULID', () => {
  it('produces 26 characters', () => {
    expect(createUlidFactory(fixedEntropy(0))()).toHaveLength(26)
  })

  // ADR 0034: Crockford base32 without the ambiguous letters.
  it('uses only the ULID alphabet', () => {
    const generated = createUlidFactory(countingEntropy())()

    expect(generated).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
  })

  it('never emits I, L, O, or U', () => {
    const factory = createUlidFactory(countingEntropy())
    const many = Array.from({ length: 200 }, () => factory()).join('')

    expect(many).not.toMatch(/[ILOU]/)
  })

  it('encodes the epoch as all zeroes in the time half', () => {
    expect(createUlidFactory(fixedEntropy(0)).call(null).slice(0, 10)).toBe('0000000000')
  })

  it('encodes a later instant as a larger time half', () => {
    const earlier = createUlidFactory(fixedEntropy(1_700_000_000_000))().slice(0, 10)
    const later = createUlidFactory(fixedEntropy(1_800_000_000_000))().slice(0, 10)

    expect(later > earlier).toBe(true)
  })

  // What sortability is for: ids created later sort after ids created earlier.
  it('sorts lexicographically in creation order', () => {
    const factory = createUlidFactory(countingEntropy())
    const generated = Array.from({ length: 50 }, () => factory())

    expect([...generated].sort()).toEqual(generated)
  })

  it('differs between calls at the same instant', () => {
    let counter = 0
    const factory = createUlidFactory({
      now: () => 1_700_000_000_000,
      randomBytes: (into) => into.map(() => counter++ % 256),
    })

    expect(factory()).not.toBe(factory())
  })

  it('uses every bit of the supplied randomness', () => {
    const allZero = createUlidFactory(fixedEntropy(0, 0))().slice(10)
    const allOnes = createUlidFactory(fixedEntropy(0, 0xff))().slice(10)

    expect(allZero).toBe('0000000000000000')
    expect(allOnes).toBe('ZZZZZZZZZZZZZZZZ')
  })

  it('changes the last character when only the last bits of entropy change', () => {
    const one = createUlidFactory({ now: () => 0, randomBytes: (into) => into.fill(0) })()
    const other = createUlidFactory({
      now: () => 0,
      randomBytes: (into) => {
        into.fill(0)
        into[into.length - 1] = 1
        return into
      },
    })()

    expect(other).not.toBe(one)
  })

  it('refuses an instant beyond what 48 bits can hold', () => {
    expect(() => createUlidFactory(fixedEntropy(2 ** 48))()).toThrow(RangeError)
  })

  it('refuses a negative instant', () => {
    expect(() => createUlidFactory(fixedEntropy(-1))()).toThrow(RangeError)
  })
})

describe('generating an item id', () => {
  it.each([...GARDEN_ITEM_KINDS])('prefixes a new %s id with its kind', (kind) => {
    const id = createItemIdFactory(countingEntropy())(kind)

    expect(parseItemId(id)).toMatchObject({ kind })
  })

  it.each([...GARDEN_ITEM_KINDS])('produces a %s id the schema accepts', (kind) => {
    const id = createItemIdFactory(countingEntropy())(kind)

    expect(parseItemId(id)).toBeDefined()
  })

  it('produces a different id every time', () => {
    const nextId = createItemIdFactory(countingEntropy())
    const generated = Array.from({ length: 100 }, () => nextId('branch'))

    expect(new Set(generated).size).toBe(100)
  })
})
