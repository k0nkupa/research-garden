import type { GardenItemKind, RootItem } from './gardenItem'

/**
 * Which parts of a Root may be corrected, and which may not.
 *
 * ADR 0012 draws the line: a Root's captured evidence is immutable after
 * creation, and only its metadata may be corrected through an approved change.
 * The reason is ADR 0029's -- later reasoning must not be able to silently
 * rewrite the evidence that earlier conclusions were built on.
 *
 * `origin_url` sits on the correctable side because ADR 0029 explicitly calls
 * it origin *metadata*: a mistyped URL should be fixable without discarding the
 * excerpt it points at. What was captured, its hash, and when it was captured
 * are not correctable, because changing any of them would make the Root claim
 * to be evidence it never was.
 */
export const ROOT_EVIDENCE_FIELDS = ['body', 'contentHash', 'capturedAt'] as const

export const ROOT_METADATA_FIELDS = ['title', 'originUrl', 'attribution'] as const

export type RootEvidenceField = (typeof ROOT_EVIDENCE_FIELDS)[number]

export interface RootEvidenceChange {
  readonly field: RootEvidenceField
  readonly from: string
  readonly to: string
}

/**
 * Reports which pieces of immutable evidence a proposed Root would change.
 *
 * Returning the changes rather than a boolean lets the caller say exactly what
 * would have been rewritten, which is what an approval surface needs to show.
 * An empty result means the change touches metadata only.
 */
export function rootEvidenceChanges(
  before: RootItem,
  after: RootItem,
): readonly RootEvidenceChange[] {
  return ROOT_EVIDENCE_FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    from: before[field],
    to: after[field],
  }))
}

export function wouldRewriteRootEvidence(before: RootItem, after: RootItem): boolean {
  return rootEvidenceChanges(before, after).length > 0
}

/**
 * Whether a whole-body edit is even worth attempting for this kind.
 *
 * A Root's only body-shaped field, `body`, is itself the captured evidence
 * (`ROOT_EVIDENCE_FIELDS`), so replacing it is always a `rootEvidenceChanges`
 * violation unless the replacement is byte-identical. Naming that here, once,
 * keeps the "Roots don't take body edits" rule owned by the module ADR 0012
 * already assigns it to, rather than re-decided wherever an edit surface
 * checks a kind (ticket 12).
 */
export function isBodyEditableKind(kind: GardenItemKind): kind is Exclude<GardenItemKind, 'root'> {
  return kind !== 'root'
}
