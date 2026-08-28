import { GARDEN_ITEM_KINDS, type GardenItemKind } from '../schema/itemIdentity'
import type { GardenItem, ValidationProblem } from '../schema/gardenItem'

/**
 * The Index Cache: a disposable, verified record of what the last scan of
 * each canonical file produced.
 *
 * ADR 0050 and ADR 0062 fix what this is allowed to be: derived state that
 * speeds a reopen and nothing more. Every entry is addressed by content hash,
 * never trusted on a filesystem timestamp (ADR 0077 already treats those as a
 * presentation input, not canonical history) -- a file whose hash still
 * matches was, by construction, already parsed and validated correctly the
 * one time that mattered, so replaying that same input through the same
 * validation would only reproduce the same output. `length` is checked first
 * because it is free to compare and rules out most changes without paying for
 * a hash; the hash is what actually proves nothing moved.
 *
 * Kept free of filesystem access, exactly as `gardenIndex.ts` and
 * `gardenRevision.ts` are: the same manifest always produces the same
 * verdict about the same files, so that can be tested without a browser.
 * Reading and writing the cache file itself belongs to `indexCacheStore.ts`,
 * one layer up.
 */

/** Bumped whenever the cache's own shape, or `GardenItem`'s, changes underneath it. */
export const CACHE_SCHEMA_VERSION = 1

/** Everything a file's frontmatter declared, whether or not it went on to validate. */
export interface CachedIdentity {
  readonly itemId: string | undefined
  readonly title: string | undefined
}

/** What one file produced the last time it was actually parsed and validated. */
export type CachedOutcome =
  | { readonly kind: 'accepted'; readonly item: GardenItem }
  | {
      readonly kind: 'invalid'
      readonly problems: readonly ValidationProblem[]
      readonly identity: CachedIdentity
    }

/** One file's manifest entry: what it looked like, and what it produced. */
export interface CacheEntry {
  /** `text.length` at the time this entry was recorded -- cheap to compare, checked first. */
  readonly length: number
  readonly hash: string
  readonly outcome: CachedOutcome
}

/** The whole cache, keyed by the file's path joined with `/`. */
export interface IndexCacheRecord {
  readonly schemaVersion: typeof CACHE_SCHEMA_VERSION
  readonly entries: ReadonlyMap<string, CacheEntry>
}

export function emptyIndexCache(): IndexCacheRecord {
  return { schemaVersion: CACHE_SCHEMA_VERSION, entries: new Map() }
}

/**
 * A file's cached entry is trustworthy only while its content has not moved.
 * `length` first, because it costs nothing and already rules out most edits;
 * the hash is what actually proves nothing did.
 */
export function cacheEntryMatches(entry: CacheEntry, length: number, hash: string): boolean {
  return entry.length === length && entry.hash === hash
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isValidationProblem(value: unknown): value is ValidationProblem {
  if (typeof value !== 'object' || value === null) return false
  const problem = value as Record<string, unknown>
  return isNonEmptyString(problem['field']) && isNonEmptyString(problem['message'])
}

function isCachedIdentity(value: unknown): value is CachedIdentity {
  if (typeof value !== 'object' || value === null) return false
  const identity = value as Record<string, unknown>
  return isStringOrUndefined(identity['itemId']) && isStringOrUndefined(identity['title'])
}

const KNOWN_KINDS: readonly string[] = GARDEN_ITEM_KINDS

/** What `gardenGraph.ts`'s `declaredEdges` reads off every relation: `.type` and `.target`. */
function isPlausibleRelation(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const relation = value as Record<string, unknown>
  return isNonEmptyString(relation['type']) && isNonEmptyString(relation['target'])
}

/**
 * A moderate, not exhaustive, structural check on a cached `GardenItem`.
 *
 * Re-running full schema validation here (every field, every kind-specific
 * rule, every cross-reference) would do the expensive work the cache exists
 * to skip, just to decide whether to trust the cache -- that defeats the
 * point. This checks only what downstream code (`buildGardenGraph`'s
 * `for (const relation of item.relations)` and
 * `for (const rootId of item.supportedBy)`, in particular) would otherwise
 * crash on if it were missing or the wrong shape, down to each array's own
 * elements: the fields every kind carries, typed correctly, plus the
 * array-shaped fields the kind in question actually has. It does not
 * re-check ULID format, timestamp ordering, or any of the rest -- the
 * content hash already stands for that.
 */
function isPlausibleGardenItem(value: unknown): value is GardenItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>

  if (typeof item['schemaVersion'] !== 'number') return false
  if (!isNonEmptyString(item['id'])) return false
  if (!isNonEmptyString(item['title'])) return false
  if (!isNonEmptyString(item['createdAt'])) return false
  if (!isNonEmptyString(item['updatedAt'])) return false
  if (typeof item['body'] !== 'string') return false
  if (!isStringOrUndefined(item['parentId'])) return false
  // Every element, not just the array itself: `buildGardenGraph`'s
  // `for (const relation of item.relations)` reads `.type`/`.target` off
  // each one, and a malformed element (not an object, or missing either
  // field) would otherwise reach that loop and throw.
  if (!Array.isArray(item['relations']) || !item['relations'].every(isPlausibleRelation)) {
    return false
  }

  const kind = item['kind']
  if (typeof kind !== 'string' || !KNOWN_KINDS.includes(kind)) return false

  if (kind === 'root') {
    if (!isStringOrUndefined(item['originUrl'])) return false
    if (!isNonEmptyString(item['capturedAt'])) return false
    if (!isNonEmptyString(item['contentHash'])) return false
    if (!isStringOrUndefined(item['attribution'])) return false
  }

  if (kind === 'branch' && item['state'] !== 'active' && item['state'] !== 'dormant') return false

  if (kind === 'claim_leaf' || kind === 'harvest') {
    // `buildGardenGraph`'s `for (const rootId of item.supportedBy)` treats
    // each element as a bare id string.
    if (!Array.isArray(item['supportedBy']) || !item['supportedBy'].every((id) => typeof id === 'string')) {
      return false
    }
  }

  return true
}

function isCachedOutcome(value: unknown): value is CachedOutcome {
  if (typeof value !== 'object' || value === null) return false
  const outcome = value as Record<string, unknown>

  if (outcome['kind'] === 'accepted') return isPlausibleGardenItem(outcome['item'])

  if (outcome['kind'] === 'invalid') {
    return (
      Array.isArray(outcome['problems']) &&
      outcome['problems'].every(isValidationProblem) &&
      isCachedIdentity(outcome['identity'])
    )
  }

  return false
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>

  return (
    typeof entry['length'] === 'number' &&
    Number.isInteger(entry['length']) &&
    entry['length'] >= 0 &&
    isNonEmptyString(entry['hash']) &&
    isCachedOutcome(entry['outcome'])
  )
}

interface SerializableCacheRecord {
  readonly schema_version: number
  readonly entries: Record<string, CacheEntry>
}

/**
 * Whether parsed JSON is a trustworthy Index Cache.
 *
 * All-or-nothing, deliberately (ADR 0062: "an uncertain manifest invalidates
 * the entire cache"). One malformed entry does not disqualify only itself --
 * a manifest that is wrong about one file is a manifest whose bookkeeping
 * cannot be trusted about any of the others either, and the whole point of
 * this check is to fail toward a full rescan rather than toward partial
 * trust.
 */
function isSerializableCacheRecord(value: unknown): value is SerializableCacheRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>

  if (record['schema_version'] !== CACHE_SCHEMA_VERSION) return false

  const entries = record['entries']
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return false

  return Object.values(entries).every(isCacheEntry)
}

/** `undefined` for anything that is not a genuine, current-schema Index Cache. */
export function parseIndexCache(text: string): IndexCacheRecord | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }

  if (!isSerializableCacheRecord(parsed)) return undefined

  return { schemaVersion: CACHE_SCHEMA_VERSION, entries: new Map(Object.entries(parsed.entries)) }
}

export function serializeIndexCache(record: IndexCacheRecord): string {
  const serializable: SerializableCacheRecord = {
    schema_version: record.schemaVersion,
    entries: Object.fromEntries(record.entries),
  }
  return JSON.stringify(serializable, null, 2)
}
