import type { GardenPath } from '../../filesystem/GardenFileSystem'
import { sha256Hex } from '../hash'
import { parseGardenDocument } from '../document/gardenDocument'
import {
  validateGardenItem,
  type GardenItem,
  type ValidationProblem,
} from '../schema/gardenItem'
import { buildGardenGraph, type GardenGraph, type GraphSubject } from './gardenGraph'
import { deriveGardenRevision, type GardenRevision } from './gardenRevision'
import {
  CACHE_SCHEMA_VERSION,
  cacheEntryMatches,
  type CacheEntry,
  type CachedOutcome,
  type IndexCacheRecord,
} from './indexCache'

/**
 * The Garden Index: a rebuildable in-memory projection of canonical Markdown.
 *
 * ADR 0050 makes this derived state and nothing more -- it supports the Tree,
 * search, and validation, but the files remain the system of record. Building
 * it is therefore a pure function of the scanned files, with no filesystem
 * access of its own, so the same inputs always produce the same index and the
 * same Garden Revision.
 *
 * An optional Index Cache (ticket 15, ADR 0062) can be passed in to skip
 * reparsing and revalidating a file whose content has not moved since it was
 * cached. Nothing about what gets *checked* changes: every file is still
 * scanned, whole-Garden invariants (`buildGardenGraph`) still run over every
 * item every time, and the Garden Revision is still derived from every
 * file's actual current text -- a cache hit only skips redoing work whose
 * answer, for byte-identical input, could not have changed.
 */

export interface ScannedFile {
  readonly path: GardenPath
  readonly text: string
}

export interface IndexedItem {
  readonly item: GardenItem
  readonly path: GardenPath
  readonly childIds: readonly string[]
  /** ADR 0015: derived from what points back at a Seed, never stored on it. */
  readonly cultivated: boolean
}

/**
 * A Garden Diagnostic: a noncanonical validation finding about a Garden file.
 *
 * ADR 0052 keeps the affected item visible and lets unrelated valid items load.
 * One Diagnostic per file, carrying every problem found in it, because that is
 * how a person reads their Garden -- "this file needs attention, and here is
 * everything wrong with it" rather than the same file listed four times.
 *
 * Identity is recorded whenever the file parsed far enough to declare it, even
 * if validation then failed, so a Diagnostic can say *which item* rather than
 * only which path.
 */
export interface GardenDiagnostic {
  readonly path: GardenPath
  /** Present when the file declared an id, even if the rest did not validate. */
  readonly itemId: string | undefined
  /** Present when the file declared a title, so a person can recognize it. */
  readonly title: string | undefined
  readonly problems: readonly ValidationProblem[]
}

export interface GardenIndex {
  readonly items: ReadonlyMap<string, IndexedItem>
  /** Items with no parent placement, in Tree order. */
  readonly topLevelIds: readonly string[]
  /** The resolved relationship graph, with inverses derived rather than stored. */
  readonly graph: GardenGraph
  readonly diagnostics: readonly GardenDiagnostic[]
  readonly revision: GardenRevision
}

interface Accepted {
  readonly item: GardenItem
  readonly path: GardenPath
}

/** Collects every problem found in a file, so one file yields one Diagnostic. */
class DiagnosticCollector {
  #byPath = new Map<string, GardenDiagnostic>()

  add(path: GardenPath, problems: readonly ValidationProblem[], identity?: FileIdentity): void {
    const key = path.join('/')
    const existing = this.#byPath.get(key)

    this.#byPath.set(key, {
      path,
      itemId: identity?.itemId ?? existing?.itemId,
      title: identity?.title ?? existing?.title,
      problems: [...(existing?.problems ?? []), ...problems],
    })
  }

  all(): readonly GardenDiagnostic[] {
    return [...this.#byPath.values()]
  }
}

interface FileIdentity {
  readonly itemId: string | undefined
  readonly title: string | undefined
}

/** Reads whatever identity a file declared, without trusting it to be valid. */
function declaredIdentity(frontmatter: Record<string, unknown>): FileIdentity {
  const asText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)
  return { itemId: asText(frontmatter['id']), title: asText(frontmatter['title']) }
}

/**
 * What one file, taken alone, produces: an accepted item or the reasons it
 * was refused. The one thing this cannot decide is a duplicate id -- that
 * depends on every *other* file too, so it stays in the main loop below,
 * applied after this runs. That split is what makes this function a pure
 * function of one file's text, and therefore the unit the Index Cache caches.
 */
function deriveFileOutcome(text: string): CachedOutcome {
  const parsed = parseGardenDocument(text)
  if (!parsed.ok) {
    // Nothing parsed, so there is no identity to report -- only the path.
    return {
      kind: 'invalid',
      problems: [{ field: 'frontmatter', message: parsed.error.message }],
      identity: { itemId: undefined, title: undefined },
    }
  }

  const identity = declaredIdentity(parsed.document.frontmatter)

  const validated = validateGardenItem(parsed.document.frontmatter, parsed.document.body)
  if (!validated.ok) {
    return { kind: 'invalid', problems: validated.problems, identity }
  }

  return { kind: 'accepted', item: validated.item }
}

interface IndexScan {
  readonly index: GardenIndex
  /**
   * What each file, taken *alone*, produced this scan -- before the
   * duplicate-id check or any whole-Garden invariant is applied. Those two
   * corrections depend on every other file, are never stable per-file facts,
   * and must never be cached: a file that lost a duplicate-id conflict today
   * because another file also claims its id may not lose it tomorrow, if
   * that other file is the one that changes or disappears. Caching the
   * *post-correction* outcome would let that stale correction survive long
   * after the file that caused it was gone.
   */
  readonly freshEntries: ReadonlyMap<string, CacheEntry>
}

async function scanGardenIndex(
  files: readonly ScannedFile[],
  cache: ReadonlyMap<string, CacheEntry>,
): Promise<IndexScan> {
  const accepted: Accepted[] = []
  const collector = new DiagnosticCollector()
  const claimedIds = new Map<string, GardenPath>()
  const freshEntries = new Map<string, CacheEntry>()

  for (const file of files) {
    const key = file.path.join('/')
    const length = file.text.length
    // Every file is hashed regardless of whether a cache entry exists for it:
    // the fresh entry below needs this file's real current hash either way,
    // to be there for whichever *later* open can actually skip the work this
    // one could not.
    const hash = await sha256Hex(file.text)
    const cached = cache.get(key)

    const outcome =
      cached && cacheEntryMatches(cached, length, hash) ? cached.outcome : deriveFileOutcome(file.text)

    freshEntries.set(key, { length, hash, outcome })

    if (outcome.kind === 'invalid') {
      collector.add(file.path, outcome.problems, outcome.identity)
      continue
    }

    // Two files claiming one identity is a conflict, not a silent last-wins:
    // relationships address items by id, so the ambiguity has to be visible.
    const alreadyClaimed = claimedIds.get(outcome.item.id)
    if (alreadyClaimed) {
      collector.add(
        file.path,
        [{ field: 'id', message: `duplicates the id already used by ${alreadyClaimed.join('/')}` }],
        // Deliberately not the id: it belongs to the file that claimed it first,
        // and attributing this Diagnostic to it would blame the innocent file.
        { itemId: undefined, title: outcome.item.title },
      )
      continue
    }

    claimedIds.set(outcome.item.id, file.path)
    accepted.push({ item: outcome.item, path: file.path })
  }

  // Title order gives the Tree a stable shape between opens without letting
  // filesystem enumeration order leak into what a person sees.
  const byTitle = [...accepted].sort((a, b) => a.item.title.localeCompare(b.item.title))

  // Whole-Garden invariants: reference resolution, kind pairings, and Parent
  // acyclicity all need every item in hand (ADR 0079).
  const graph = buildGardenGraph(
    new Map<string, GraphSubject>(
      byTitle.map((entry) => [entry.item.id, { item: entry.item, path: entry.path }]),
    ),
  )

  for (const diagnostic of graph.diagnostics) {
    collector.add(diagnostic.path, diagnostic.problems, {
      itemId: diagnostic.itemId,
      title: diagnostic.title,
    })
  }

  const childIdsByParent = new Map<string, string[]>()
  const topLevelIds: string[] = []

  for (const entry of byTitle) {
    const parentId = entry.item.parentId

    // An item whose placement was refused still appears, at the top level, so a
    // broken relationship never makes knowledge disappear (ADR 0052).
    if (parentId === undefined || graph.unplacedIds.has(entry.item.id)) {
      topLevelIds.push(entry.item.id)
      continue
    }

    const siblings = childIdsByParent.get(parentId) ?? []
    siblings.push(entry.item.id)
    childIdsByParent.set(parentId, siblings)
  }

  const items = new Map<string, IndexedItem>(
    byTitle.map((entry) => [
      entry.item.id,
      {
        item: entry.item,
        path: entry.path,
        childIds: childIdsByParent.get(entry.item.id) ?? [],
        cultivated: graph.cultivatedSeedIds.has(entry.item.id),
      },
    ]),
  )

  return {
    index: {
      items,
      topLevelIds,
      graph,
      diagnostics: collector.all(),
      // Every scanned file counts, including invalid ones: fixing a broken file
      // must move the revision so held results are known to be out of date.
      revision: await deriveGardenRevision(files),
    },
    freshEntries,
  }
}

export async function buildGardenIndex(files: readonly ScannedFile[]): Promise<GardenIndex> {
  return (await scanGardenIndex(files, new Map())).index
}

/**
 * `buildGardenIndex`, plus the Index Cache a subsequent open of the same
 * files could reuse (ticket 15). Kept separate from `buildGardenIndex`
 * itself rather than changing what it returns, so every existing caller that
 * only ever wanted a `GardenIndex` -- the whole rest of this codebase --
 * stays exactly as it was. `cache` has no default: every real caller
 * (`openGarden`) has an actual cache to offer, even if it is empty, and a
 * silently-defaulted "no cache" here would be easy to pass by accident.
 */
export async function scanGardenWithCache(
  files: readonly ScannedFile[],
  cache: ReadonlyMap<string, CacheEntry>,
): Promise<{ readonly index: GardenIndex; readonly cache: IndexCacheRecord }> {
  const scanned = await scanGardenIndex(files, cache)
  return {
    index: scanned.index,
    cache: { schemaVersion: CACHE_SCHEMA_VERSION, entries: scanned.freshEntries },
  }
}
