import { z } from 'zod'
import type { OpenedGarden } from '../garden/openGarden'
import { GARDEN_ITEM_KINDS, type GardenItemKind } from '../domain/schema/itemIdentity'
import { okEnvelope, type ToolEnvelope } from './envelope'
import type { ReadToolSpec } from './readTool'

/**
 * `inspect_garden`: how a connected agent orients itself before asking for
 * anything specific (ticket 18) -- counts and the top-level Tree structure,
 * never a body or an excerpt. Titles are still a person's own free text
 * (ADR 0037), so this result is marked untrusted even though it carries no
 * body content.
 */

export const InspectGardenInput = z.strictObject({})
export type InspectGardenInput = z.infer<typeof InspectGardenInput>

export interface InspectGardenTopLevelEntry {
  readonly itemId: string
  readonly kind: GardenItemKind
  readonly title: string
}

export interface InspectGardenData {
  readonly repositoryName: string
  readonly totalItems: number
  readonly itemCounts: Readonly<Record<GardenItemKind, number>>
  readonly diagnosticsCount: number
  readonly topLevel: readonly InspectGardenTopLevelEntry[]
}

function emptyItemCounts(): Record<GardenItemKind, number> {
  return Object.fromEntries(GARDEN_ITEM_KINDS.map((kind) => [kind, 0])) as Record<GardenItemKind, number>
}

export function runInspectGarden(garden: OpenedGarden): ToolEnvelope<InspectGardenData> {
  const { index } = garden
  const itemCounts = emptyItemCounts()
  for (const indexed of index.items.values()) itemCounts[indexed.item.kind] += 1

  const topLevel: InspectGardenTopLevelEntry[] = []
  for (const itemId of index.topLevelIds) {
    const indexed = index.items.get(itemId)
    if (indexed) topLevel.push({ itemId: indexed.item.id, kind: indexed.item.kind, title: indexed.item.title })
  }

  return okEnvelope(
    {
      repositoryName: garden.repositoryName,
      totalItems: index.items.size,
      itemCounts,
      diagnosticsCount: index.diagnostics.length,
      topLevel,
    },
    index.revision,
  )
}

export const INSPECT_GARDEN_SPEC: ReadToolSpec<InspectGardenInput, InspectGardenData> = {
  name: 'inspect_garden',
  description:
    'Orients an agent in the currently open Garden: item counts by kind, the number of Garden ' +
    'Diagnostics, and the top-level Tree structure. Carries no body or excerpt content.',
  inputSchema: InspectGardenInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'inspect_garden',
  run: (garden) => runInspectGarden(garden),
  itemIdsFor: () => [],
}
