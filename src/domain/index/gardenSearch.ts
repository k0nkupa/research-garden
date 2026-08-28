import type { GardenItemKind } from '../schema/itemIdentity'
import type { GardenIndex } from './gardenIndex'

/**
 * Search over the Garden Index.
 *
 * ADR 0038 fixes the two numbers this module answers to: ten results by
 * default, twenty-five no matter how many are asked for. Both are enforced
 * here, at the seam, rather than trusted to whatever calls in -- a UI that
 * forgets to slice, or a future WebMCP tool (ticket 18) that asks for
 * everything, gets the same bound a person typing in a box gets.
 *
 * This is a pure function over an already-built `GardenIndex` (ADR 0050): no
 * filesystem access, no DOM, nothing that cannot be constructed in a test.
 * The index holds every item that parsed and validated regardless of Tree
 * state, so a Dormant Branch (ADR 0031) and an item carrying a Garden
 * Diagnostic from an unresolved relationship (ADR 0052) are exactly as
 * searchable as anything else -- there is no separate "searchable" flag to
 * forget to set.
 *
 * Matching runs over the raw canonical body, not rendered HTML. Rendering is
 * the boundary where untrusted Markdown becomes markup (ADR 0056), and
 * searching has no reason to cross it: a snippet sliced from raw text and
 * handed to a caller as a plain string can never itself become markup, no
 * matter what a hostile file's body contains. Callers must render it as text,
 * never as HTML -- `SearchBox` does this by never using
 * `dangerouslySetInnerHTML` for a snippet.
 */

export const DEFAULT_SEARCH_RESULTS = 10
export const MAX_SEARCH_RESULTS = 25

/** How much text surrounds a match, on each side, in the returned snippet. */
const SNIPPET_RADIUS = 40

export interface SearchResult {
  readonly itemId: string
  readonly kind: GardenItemKind
  readonly title: string
  /** A fragment of matching text with enough surrounding context to recognise it. */
  readonly snippet: string
}

interface Candidate {
  readonly result: SearchResult
  /** -1 when the query did not match the title. */
  readonly titleMatchAt: number
  /** -1 when the query did not match the body. */
  readonly bodyMatchAt: number
}

/**
 * Lowercased title and body, cached per item.
 *
 * A person searches by typing, which means this runs on every keystroke, and
 * a Garden at the challenge performance target (ADR 0061) has a thousand
 * items to lower-case on each one. `WeakMap` keys on the item object itself,
 * so the cache costs nothing to invalidate: `buildGardenIndex` produces new
 * item objects on every rebuild, so a stale entry can never outlive the
 * Garden Index it was computed from, and the cache is dropped for free once
 * that index is no longer referenced.
 */
const loweredCache = new WeakMap<object, { readonly title: string; readonly body: string }>()

function lowered(item: { readonly title: string; readonly body: string }) {
  const cached = loweredCache.get(item)
  if (cached) return cached

  const computed = { title: item.title.toLowerCase(), body: item.body.toLowerCase() }
  loweredCache.set(item, computed)
  return computed
}

/** A fragment of `body` around `matchAt`, with an ellipsis where it was cut. */
function contextAround(body: string, matchAt: number, matchLength: number): string {
  const start = Math.max(0, matchAt - SNIPPET_RADIUS)
  const end = Math.min(body.length, matchAt + matchLength + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < body.length ? '…' : ''
  return `${prefix}${body.slice(start, end).trim()}${suffix}`
}

/**
 * The start of `body`, for a result whose match was in the title only.
 *
 * A result never carries an empty snippet merely because the match happened
 * to land in the title -- this gives it the same kind of surrounding context
 * a body match would have.
 */
function leadingContext(body: string): string {
  const trimmedBody = body.trim()
  if (trimmedBody === '') return ''

  const lead = trimmedBody.slice(0, SNIPPET_RADIUS * 2)
  return lead.length < trimmedBody.length ? `${lead}…` : lead
}

/** Title matches outrank body-only matches; earlier matches outrank later ones. */
function compareCandidates(a: Candidate, b: Candidate): number {
  const aInTitle = a.titleMatchAt !== -1
  const bInTitle = b.titleMatchAt !== -1
  if (aInTitle !== bInTitle) return aInTitle ? -1 : 1
  if (aInTitle) return a.titleMatchAt - b.titleMatchAt
  return a.bodyMatchAt - b.bodyMatchAt
}

/**
 * Searches title and body for `query`, returning matches ranked by where the
 * match landed -- title before body, earlier before later -- with ties broken
 * by the index's own title order (ADR 0050's `buildGardenIndex` already sorts
 * this way, and `Array.prototype.sort` is stable, so that order survives
 * untouched).
 *
 * An empty or whitespace-only query returns no results. Nothing was asked for,
 * so nothing is a match; returning the whole Garden instead would be exactly
 * the flood ADR 0038 exists to prevent.
 */
export function searchGardenIndex(
  index: GardenIndex,
  query: string,
  limit: number = DEFAULT_SEARCH_RESULTS,
): readonly SearchResult[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const bounded = Math.min(Math.max(limit, 0), MAX_SEARCH_RESULTS)
  if (bounded === 0) return []

  const candidates: Candidate[] = []

  for (const indexed of index.items.values()) {
    const { item } = indexed
    // Matched against a cached lower-cased copy (see `lowered`) rather than
    // `item.body`/`item.title` directly, so repeated searches over one open
    // Garden do not re-lower-case every item on every keystroke.
    const { title: lowerTitle, body: lowerBody } = lowered(item)
    const titleMatchAt = lowerTitle.indexOf(needle)
    const bodyMatchAt = lowerBody.indexOf(needle)
    if (titleMatchAt === -1 && bodyMatchAt === -1) continue

    // Sliced from the original `item.body`, not the lower-cased copy: a
    // handful of characters change length under `toLowerCase` (Turkish İ is
    // the common example), which could shift a snippet's window by a
    // character for a body containing one before the match. The match itself
    // is unaffected -- only, rarely, how the snippet is centred on it.
    const snippet =
      bodyMatchAt !== -1
        ? contextAround(item.body, bodyMatchAt, needle.length)
        : leadingContext(item.body)

    candidates.push({
      titleMatchAt,
      bodyMatchAt,
      result: { itemId: item.id, kind: item.kind, title: item.title, snippet },
    })
  }

  return candidates
    .sort(compareCandidates)
    .slice(0, bounded)
    .map((candidate) => candidate.result)
}
