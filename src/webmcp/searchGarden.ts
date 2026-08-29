import { z } from 'zod'
import { DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, searchGardenIndex, type SearchResult } from '../domain/index/gardenSearch'
import type { OpenedGarden } from '../garden/openGarden'
import { okEnvelope, type ToolEnvelope } from './envelope'
import type { ReadToolSpec } from './readTool'

/**
 * `search_garden`: wraps `searchGardenIndex` directly (ADR 0003) -- the exact
 * same bound (ten default, twenty-five cap) a person's search box gets, not
 * a stricter or looser one reimplemented here. An empty query already
 * returns no results inside `searchGardenIndex` itself, so this schema does
 * not additionally refuse one. A `limit` above the cap is not refused either
 * -- `searchGardenIndex` already clamps it silently, exactly as it would a
 * UI that forgot to slice -- but silently is not the same as invisibly: this
 * says so in `warnings`, so an agent asking for more than the cap can tell
 * it did not get everything without a second call.
 */

export const SearchGardenInput = z.strictObject({
  query: z.string(),
  limit: z.number().int().positive().optional(),
})
export type SearchGardenInput = z.infer<typeof SearchGardenInput>

export interface SearchGardenData {
  readonly results: readonly SearchResult[]
}

export function runSearchGarden(garden: OpenedGarden, input: SearchGardenInput): ToolEnvelope<SearchGardenData> {
  const requested = input.limit ?? DEFAULT_SEARCH_RESULTS
  const results = searchGardenIndex(garden.index, input.query, requested)
  const warnings =
    requested > MAX_SEARCH_RESULTS
      ? [`limit ${requested} exceeds the maximum of ${MAX_SEARCH_RESULTS}; capped to ${MAX_SEARCH_RESULTS}.`]
      : []
  return okEnvelope({ results }, garden.index.revision, warnings)
}

export const SEARCH_GARDEN_SPEC: ReadToolSpec<SearchGardenInput, SearchGardenData> = {
  name: 'search_garden',
  description:
    `Searches item titles and bodies in the currently open Garden. Returns at most ${MAX_SEARCH_RESULTS} ` +
    `results (${DEFAULT_SEARCH_RESULTS} by default), each a title and a short snippet -- never a full body.`,
  inputSchema: SearchGardenInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'search_garden',
  run: runSearchGarden,
  itemIdsFor: () => [],
}
