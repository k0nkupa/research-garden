import type { GardenItemKind } from '../domain/schema/itemIdentity'

/**
 * How each botanical kind is drawn in the Tree.
 *
 * ADR 0044 requires four independent carriers of meaning -- shape, icon, text
 * label, and colour -- so that meaning never depends on colour alone. The shape
 * is the load-bearing one: it is what still distinguishes a Claim Leaf from a
 * Question Leaf for a person who cannot tell canopy green from mulberry.
 *
 * Tones name entries in the Botanical Instrument palette (ADR 0039) rather than
 * hex values, so the palette stays defined in one place: the stylesheet.
 */
export type GlyphShape =
  | 'pod'
  | 'evidence-node'
  | 'junction'
  | 'filled-leaf'
  | 'open-ring'
  | 'bud'
  | 'lens'
  | 'fruit'

export type GlyphTone = 'bark' | 'canopy' | 'lichen' | 'pollen' | 'mulberry'

export interface KindGlyph {
  readonly shape: GlyphShape
  /** Filled forms read as established; outlined forms read as open or provisional. */
  readonly filled: boolean
  readonly tone: GlyphTone
}

export const KIND_GLYPHS: Record<GardenItemKind, KindGlyph> = {
  seed: { shape: 'pod', filled: true, tone: 'lichen' },
  root: { shape: 'evidence-node', filled: false, tone: 'bark' },
  // Bark rather than canopy: a Branch is structure, like the trunk it grows from.
  branch: { shape: 'junction', filled: true, tone: 'bark' },
  claim_leaf: { shape: 'filled-leaf', filled: true, tone: 'canopy' },
  question_leaf: { shape: 'open-ring', filled: false, tone: 'mulberry' },
  idea_leaf: { shape: 'bud', filled: false, tone: 'pollen' },
  observation_leaf: { shape: 'lens', filled: false, tone: 'lichen' },
  harvest: { shape: 'fruit', filled: true, tone: 'pollen' },
}

export function glyphForKind(kind: GardenItemKind): KindGlyph {
  return KIND_GLYPHS[kind]
}

/**
 * The path or primitive geometry for each shape, drawn around the origin.
 *
 * Kept as data rather than as branching JSX so the Tree component stays a
 * renderer and the vocabulary of forms stays inspectable in one place.
 */
export const GLYPH_GEOMETRY: Record<GlyphShape, string> = {
  // A pod: flat-shouldered at the top, tapering to a point. Distinct in outline
  // from the bud, which is the reverse.
  pod: 'M-5,-9 L5,-9 C8,-2 7,4 0,11 C-7,4 -8,-2 -5,-9 Z',
  // A squared record, deliberately unlike every organic form around it.
  'evidence-node': 'M-9,-7 L9,-7 L9,7 L-9,7 Z',
  // A junction: where limbs meet.
  junction: 'M0,-9 L9,0 L0,9 L-9,0 Z',
  // A leaf, tilted and asymmetric so it reads as foliage rather than a seed.
  'filled-leaf': 'M-3,11 C-11,4 -9,-7 4,-12 C9,-3 6,8 -3,11 Z',
  // An open ring: an inquiry that is not closed.
  'open-ring': 'M0,-9 A9,9 0 1,1 -0.01,-9',
  // A bud: rounded cap, straight shoulders, not yet a leaf.
  bud: 'M0,-11 C5,-6 7,0 5,9 L-5,9 C-7,0 -5,-6 0,-11 Z',
  // A lens: something seen through, and therefore subjective.
  lens: 'M-11,0 C-6,-7 6,-7 11,0 C6,7 -6,7 -11,0 Z',
  // A seed head: faceted, and never a plain circle, so it cannot be mistaken
  // for the open ring at a glance (ADR 0044).
  fruit: 'M0,-10 L9,-5 L9,5 L0,10 L-9,5 L-9,-5 Z',
}
