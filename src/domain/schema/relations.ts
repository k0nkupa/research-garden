import { GARDEN_ITEM_KINDS, type GardenItemKind } from './itemIdentity'

/**
 * The controlled relationship vocabulary.
 *
 * ADR 0017 fixes it at six, precisely so an agent cannot fragment a person's
 * graph by inventing synonyms. ADR 0079 adds the rest of the shape: which
 * relations are directional, which are symmetric Cross-links, and which pairs
 * of kinds a relation may legitimately join.
 *
 * Where each relation is *written* matters as much as which are recognized.
 * Parent lives in `parent_id` and Supports lives in `supported_by`, so neither
 * may also be spelled in `relations` -- two spellings of one fact is exactly the
 * fragmentation the controlled vocabulary exists to prevent. ADR 0020 puts
 * Supports on the Claim or Harvest rather than the Root so that growing new
 * knowledge never has to mutate immutable evidence.
 */
export const RELATION_TYPES = [
  'parent',
  'derived_from',
  'supports',
  'answers',
  'contradicts',
  'relates_to',
] as const

export type RelationType = (typeof RELATION_TYPES)[number]

/**
 * ADR 0079: Contradicts and Relates To are symmetric Cross-links; the rest are
 * directional. A symmetric relation written on one side is true of both.
 */
const SYMMETRIC: readonly RelationType[] = ['contradicts', 'relates_to']

export function isSymmetricRelation(type: RelationType): boolean {
  return SYMMETRIC.includes(type)
}

export function isRelationType(candidate: unknown): candidate is RelationType {
  return typeof candidate === 'string' && (RELATION_TYPES as readonly string[]).includes(candidate)
}

/** Which frontmatter field carries each relation. */
export const RELATION_FIELD: Record<RelationType, 'parent_id' | 'supported_by' | 'relations'> = {
  parent: 'parent_id',
  supports: 'supported_by',
  derived_from: 'relations',
  answers: 'relations',
  contradicts: 'relations',
  relates_to: 'relations',
}

/** The relations that may appear in the `relations` list. */
export const RELATIONS_IN_FRONTMATTER: readonly RelationType[] = RELATION_TYPES.filter(
  (type) => RELATION_FIELD[type] === 'relations',
)

const LEAF_KINDS: readonly GardenItemKind[] = [
  'claim_leaf',
  'question_leaf',
  'idea_leaf',
  'observation_leaf',
]

/** Everything that can grow from a Seed: evidence, structure, thought, synthesis. */
const CULTIVATED_KINDS: readonly GardenItemKind[] = ['root', 'branch', ...LEAF_KINDS, 'harvest']

interface Pairing {
  readonly sources: readonly GardenItemKind[]
  readonly targets: readonly GardenItemKind[]
}

/**
 * ADR 0079: which kinds each relation may join.
 *
 * These are the pairings that mean something. A Root cannot answer a question,
 * a Seed cannot be derived from itself, and only a Claim Leaf can contradict
 * another Claim Leaf -- disagreement is between assertions, and an Idea or an
 * Observation is not asserting anything to disagree with (ADR 0010).
 */
export const RELATION_PAIRINGS: Record<RelationType, Pairing> = {
  // ADR 0028: a Branch is the only kind that can be a parent, and Seeds and
  // Roots occupy their own strata rather than being placed under one.
  parent: { sources: ['branch', ...LEAF_KINDS, 'harvest'], targets: ['branch'] },
  // ADR 0015: provenance runs from cultivated knowledge back to its Seed.
  derived_from: { sources: CULTIVATED_KINDS, targets: ['seed'] },
  // ADR 0010: evidence supports assertions and syntheses, nothing else.
  supports: { sources: ['root'], targets: ['claim_leaf', 'harvest'] },
  // A Harvest is what answers a Question Leaf.
  answers: { sources: ['harvest'], targets: ['question_leaf'] },
  // ADR 0018: conflict is between supported assertions.
  contradicts: { sources: ['claim_leaf'], targets: ['claim_leaf'] },
  // The Cross-link used when no more precise relationship applies.
  relates_to: { sources: GARDEN_ITEM_KINDS, targets: GARDEN_ITEM_KINDS },
}

export function isPermittedPairing(
  type: RelationType,
  sourceKind: GardenItemKind,
  targetKind: GardenItemKind,
): boolean {
  const pairing = RELATION_PAIRINGS[type]
  return pairing.sources.includes(sourceKind) && pairing.targets.includes(targetKind)
}

/**
 * The human-facing name of each relationship.
 *
 * These are the canonical terms from CONTEXT.md, not paraphrases of the
 * machine-readable spelling. One map so the interface and any future tool
 * description cannot drift apart, exactly as `kindLabels` does for kinds.
 */
export const RELATION_LABELS: Record<RelationType, string> = {
  parent: 'Parent',
  derived_from: 'Derived From',
  supports: 'Supports',
  answers: 'Answers',
  contradicts: 'Contradicts',
  relates_to: 'Relates To',
}

export function labelForRelation(type: RelationType): string {
  return RELATION_LABELS[type]
}
