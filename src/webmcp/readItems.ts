import { z } from 'zod'
import type { OpenedGarden } from '../garden/openGarden'
import type { GardenItemKind } from '../domain/schema/itemIdentity'
import { errorEnvelope, okEnvelope, type ToolEnvelope } from './envelope'
import type { ReadToolSpec } from './readTool'

/**
 * `read_items`: the one core read tool that returns a full body (ADR 0038),
 * so it is the one bounded the most tightly -- at most five stable item IDs
 * per call, and each body itself capped at `MAX_BODY_CHARS`. A cap is
 * reported explicitly (`bodyTruncated`, `bodyLength`) rather than silently
 * cutting the text off: an agent that needs the rest calls again with
 * `bodyOffset` set to how much it already has, the same shape a person
 * scrolling further would use, just addressed by a number instead of a
 * scroll position.
 *
 * A batch only partly found is not a call-level failure (`ok` stays `true`):
 * working through IDs from an earlier search or a stale reference and
 * getting some hits is normal, not a reason to refuse the ones that *were*
 * found. But a batch where *nothing* resolves is a genuine `lookup` failure
 * -- the one case this tool has of the ADR 0036 code with that exact name --
 * rather than a technically-successful envelope whose data is entirely
 * `found: false`. A malformed *request* itself (empty, too many IDs) is a
 * separate `invalid-input` failure, refused before any lookup is attempted.
 */

/** ~800 words -- generous for a Harvest or Root excerpt without risking one call flooding an agent's context. */
export const MAX_BODY_CHARS = 4000
export const MAX_READ_ITEMS = 5

export const ReadItemsInput = z.strictObject({
  itemIds: z.array(z.string()).min(1).max(MAX_READ_ITEMS),
  bodyOffset: z.number().int().nonnegative().optional(),
})
export type ReadItemsInput = z.infer<typeof ReadItemsInput>

export type ReadItemResult =
  | {
      readonly itemId: string
      readonly found: true
      readonly kind: GardenItemKind
      readonly title: string
      readonly body: string
      readonly bodyTruncated: boolean
      readonly bodyLength: number
    }
  | { readonly itemId: string; readonly found: false }

export interface ReadItemsData {
  readonly items: readonly ReadItemResult[]
}

export function runReadItems(garden: OpenedGarden, input: ReadItemsInput): ToolEnvelope<ReadItemsData> {
  const offset = input.bodyOffset ?? 0

  const items = input.itemIds.map((itemId): ReadItemResult => {
    const indexed = garden.index.items.get(itemId)
    if (!indexed) return { itemId, found: false }

    const fullBody = indexed.item.body
    const slice = fullBody.slice(offset, offset + MAX_BODY_CHARS)
    return {
      itemId,
      found: true,
      kind: indexed.item.kind,
      title: indexed.item.title,
      body: slice,
      bodyTruncated: offset + slice.length < fullBody.length,
      bodyLength: fullBody.length,
    }
  })

  if (items.every((item) => !item.found)) {
    const plural = input.itemIds.length === 1 ? '' : 's'
    return errorEnvelope(
      'lookup',
      `None of the requested item ID${plural} were found in this Garden.`,
      garden.index.revision,
    )
  }

  return okEnvelope({ items }, garden.index.revision)
}

export const READ_ITEMS_SPEC: ReadToolSpec<ReadItemsInput, ReadItemsData> = {
  name: 'read_items',
  description:
    `Reads up to ${MAX_READ_ITEMS} items by stable ID, including their full body (bounded at ` +
    `${MAX_BODY_CHARS} characters per item; use bodyOffset to continue a truncated one). An ID this ` +
    'Garden does not currently have is reported per item, not as a failure of the whole call.',
  inputSchema: ReadItemsInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'read_items',
  run: runReadItems,
  itemIdsFor: (input) => input.itemIds,
}
