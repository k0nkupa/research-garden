import type { GardenItemKind } from './itemIdentity'

/**
 * The human-facing label for each botanical kind.
 *
 * ADR 0044 requires every kind to carry a text label alongside its shape, icon,
 * and colour, so meaning never depends on colour alone. One map serves the Tree
 * and the reading panel: two hand-written labels would be free to disagree.
 *
 * The labels are the canonical terms from CONTEXT.md, not paraphrases.
 */
export const KIND_LABELS: Record<GardenItemKind, string> = {
  seed: 'Seed',
  root: 'Root',
  branch: 'Branch',
  claim_leaf: 'Claim Leaf',
  question_leaf: 'Question Leaf',
  idea_leaf: 'Idea Leaf',
  observation_leaf: 'Observation Leaf',
  harvest: 'Harvest',
}

export function labelForKind(kind: GardenItemKind): string {
  return KIND_LABELS[kind]
}
