import type { GardenItemKind } from './itemIdentity'

/**
 * ULID generation for new canonical items.
 *
 * ADR 0034 asks for a kind-prefixed ULID: sortable by creation time, unique
 * without coordination, and readable enough to survive being pasted into a
 * frontmatter field by hand.
 *
 * Time and randomness are injected rather than reached for, so the same
 * generator is deterministic under test and genuinely random in a browser --
 * and so nothing in the domain depends on `Date.now` or `crypto` directly.
 */

/** Crockford base32 without I, L, O, or U (ADR 0034). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const TIME_CHARACTERS = 10
/** 10 bytes is 80 bits, which is exactly 16 base32 characters. */
const RANDOM_CHARACTERS = 16
const RANDOM_BYTES = 10

export interface UlidEntropy {
  /** Milliseconds since the epoch. */
  now(): number
  /**
   * Fills the given array with random bytes.
   *
   * Typed against a plain ArrayBuffer because that is what the browser's own
   * random source accepts; a shared buffer cannot be used as entropy.
   */
  randomBytes(into: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>
}

/**
 * The largest instant a 48-bit ULID timestamp can hold, in the year 10889.
 * Beyond it the encoding would silently wrap and stop sorting.
 */
const MAXIMUM_TIME = 2 ** 48 - 1

function encodeTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAXIMUM_TIME) {
    throw new RangeError(`${milliseconds} is outside the range a ULID timestamp can encode.`)
  }

  let remaining = Math.floor(milliseconds)
  let encoded = ''
  for (let at = 0; at < TIME_CHARACTERS; at += 1) {
    encoded = ALPHABET[remaining % 32] + encoded
    remaining = Math.floor(remaining / 32)
  }
  return encoded
}

/**
 * Encodes 80 bits of randomness as 16 base32 characters.
 *
 * Taken five bits at a time across the byte boundaries, so every bit of the
 * supplied entropy reaches the output; slicing per byte would waste three bits
 * in eight and shrink the space that makes collisions negligible.
 */
function encodeRandom(bytes: Uint8Array): string {
  let bitsHeld = 0
  let accumulator = 0
  let encoded = ''

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bitsHeld += 8

    while (bitsHeld >= 5) {
      bitsHeld -= 5
      encoded += ALPHABET[(accumulator >>> bitsHeld) & 31]
    }
  }

  return encoded
}

export function createUlidFactory(entropy: UlidEntropy): () => string {
  return () => {
    const bytes = entropy.randomBytes(new Uint8Array(RANDOM_BYTES))
    return encodeTime(entropy.now()) + encodeRandom(bytes)
  }
}

/** The entropy a browser actually has. */
export const browserEntropy: UlidEntropy = {
  now: () => Date.now(),
  randomBytes: (into) => {
    crypto.getRandomValues(into)
    return into
  },
}

export interface ItemIdFactory {
  (kind: GardenItemKind): string
}

export function createItemIdFactory(entropy: UlidEntropy = browserEntropy): ItemIdFactory {
  const nextUlid = createUlidFactory(entropy)
  return (kind) => `${kind}_${nextUlid()}`
}
