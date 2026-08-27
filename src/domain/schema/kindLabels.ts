import type { GardenItemKind } from './gardenItem'

/**
 * The human-facing label for each botanical kind.
 *
 * ADR 0044 requires every kind to carry a text label alongside its shape, icon,
 * and colour, so meaning never depends on colour alone. One map serves the Tree
 * and the reading panel: two hand-written labels would be free to disagree.
 */
export const KIND_LABELS: Record<GardenItemKind, string> = {
  branch: 'Branch',
}

export function labelForKind(kind: GardenItemKind): string {
  return KIND_LABELS[kind]
}
