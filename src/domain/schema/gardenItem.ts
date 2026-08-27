import { z } from 'zod'
import { GARDEN_ITEM_KINDS, isValidItemId, parseItemId, type GardenItemKind } from './itemIdentity'

/**
 * Schema validation for canonical Garden items.
 *
 * ADR 0054 sets the shape of this layer: validate strictly what Research Garden
 * understands, and stay silent about what it does not, so hand-authored
 * metadata and compatible extensions survive a read and write cycle.
 *
 * Validation covers the body as well as the frontmatter, because two kinds
 * carry invariants that live there: a Root's body *is* its captured evidence
 * (ADR 0029), and a Harvest's body must be evidence-shaped (ADR 0030). Every
 * other kind stays deliberately lightweight (ADR 0032).
 *
 * What this layer does NOT do is resolve references. That a `supported_by` id
 * names a Root that actually exists in this Garden is a graph invariant, and
 * belongs with the rest of them in ticket 04.
 */

/** ADR 0076: every canonical item declares the version it was written against. */
export const CURRENT_SCHEMA_VERSION = 1

export type { GardenItemKind }

export type BranchState = 'active' | 'dormant'

/** ADR 0017 owns the vocabulary; this layer only checks the shape. */
export interface ItemRelation {
  readonly type: string
  readonly target: string
}

interface UniversalFields {
  readonly schemaVersion: number
  readonly id: string
  readonly title: string
  readonly parentId: string | undefined
  readonly relations: readonly ItemRelation[]
  readonly createdAt: string
  readonly updatedAt: string
  /** Everything after the frontmatter, verbatim. */
  readonly body: string
}

export interface SeedItem extends UniversalFields {
  readonly kind: 'seed'
}

export interface RootItem extends UniversalFields {
  readonly kind: 'root'
  readonly originUrl: string | undefined
  readonly capturedAt: string
  readonly contentHash: string
  readonly attribution: string | undefined
}

export interface BranchItem extends UniversalFields {
  readonly kind: 'branch'
  readonly state: BranchState
}

export interface ClaimLeafItem extends UniversalFields {
  readonly kind: 'claim_leaf'
  readonly supportedBy: readonly string[]
}

export interface UnsupportedLeafItem extends UniversalFields {
  readonly kind: 'question_leaf' | 'idea_leaf' | 'observation_leaf'
}

export interface HarvestItem extends UniversalFields {
  readonly kind: 'harvest'
  readonly supportedBy: readonly string[]
}

export type GardenItem =
  | SeedItem
  | RootItem
  | BranchItem
  | ClaimLeafItem
  | UnsupportedLeafItem
  | HarvestItem

export interface ValidationProblem {
  /** The on-disk field name, so a Diagnostic can point a person at their file. */
  readonly field: string
  readonly message: string
}

export type ValidationResult =
  | { readonly ok: true; readonly item: GardenItem }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] }

/** ADR 0077: ISO 8601 serialized in UTC. A local offset is not canonical. */
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function isRealCalendarInstant(value: string): boolean {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  // Date rolls 2026-02-30 forward into March; comparing back catches that.
  return parsed.toISOString().startsWith(value.slice(0, 10))
}

const utcTimestamp = z
  .string()
  .regex(UTC_TIMESTAMP, 'must be an ISO 8601 timestamp in UTC, such as 2026-08-01T10:00:00Z')
  .refine(isRealCalendarInstant, 'must be a real date')

function itemIdOfKind(kind: GardenItemKind) {
  return z
    .string()
    .refine(
      (value) => isValidItemId(value, kind),
      `must be a ${kind}-prefixed ULID, such as ${kind}_01HQ8X2K3M4N5P6Q7R8S9T0V1W`,
    )
}

const anyItemId = z
  .string()
  .refine((value) => parseItemId(value) !== undefined, 'must be a kind-prefixed ULID')

const relation = z.looseObject({
  type: z.string().min(1, 'must name a relationship'),
  target: anyItemId,
})

/** ADR 0028: a Branch is the only kind that can *be* a parent. */
const parentId = itemIdOfKind('branch')

function universalShape(kind: GardenItemKind) {
  return {
    schema_version: z.literal(
      CURRENT_SCHEMA_VERSION,
      `must be ${CURRENT_SCHEMA_VERSION}, the schema version this build understands`,
    ),
    id: itemIdOfKind(kind),
    kind: z.literal(kind),
    title: z.string().trim().min(1, 'must be a non-empty title'),
    parent_id: parentId.optional(),
    relations: z.array(relation).default([]),
    created_at: utcTimestamp,
    updated_at: utcTimestamp,
  }
}

const lightweight = (kind: GardenItemKind) => z.looseObject(universalShape(kind))

const rootSchema = z.looseObject({
  ...universalShape('root'),
  origin_url: z
    .string()
    .refine((value) => /^https?:\/\//i.test(value), 'must be an http or https URL')
    .optional(),
  captured_at: utcTimestamp,
  content_hash: z.string().min(1, 'must record the hash of the captured content'),
  attribution: z.string().optional(),
})

/**
 * Fields whose mere presence is wrong for a kind.
 *
 * Expressed here rather than in the schema because absence and "present but
 * undefined" are different things, and what matters is that the person never
 * wrote the field at all.
 */
const FORBIDDEN_FIELDS: Partial<Record<GardenItemKind, Record<string, string>>> = {
  root: {
    // ADR 0028: Roots occupy their own stratum and take no Tree parent, so
    // evidence can support knowledge across Branches without belonging to one.
    parent_id: 'must not be set: a Root is not placed under a Branch',
    // ADR 0029: interpretation belongs in Leaves and Harvests, never in evidence.
    summary: 'must not be set: a Root records evidence, not interpretation',
  },
}

/**
 * ADR 0028: every Leaf and Harvest requires a Branch parent, while a Branch may
 * be top-level and Seeds and Roots take no parent at all.
 *
 * That the named Branch actually exists is a graph invariant and belongs with
 * ticket 04; that the placement was declared at all is frontmatter shape, and
 * belongs here alongside the Root rule it mirrors.
 */
const KINDS_REQUIRING_A_PARENT: readonly GardenItemKind[] = [
  'claim_leaf',
  'question_leaf',
  'idea_leaf',
  'observation_leaf',
  'harvest',
]

function missingParentProblems(
  kind: GardenItemKind,
  frontmatter: Record<string, unknown>,
): readonly ValidationProblem[] {
  if (!KINDS_REQUIRING_A_PARENT.includes(kind)) return []
  if (frontmatter['parent_id'] !== undefined) return []

  return [{ field: 'parent_id', message: 'must name the Branch this item is placed under' }]
}

function forbiddenFieldProblems(
  kind: GardenItemKind,
  frontmatter: Record<string, unknown>,
): readonly ValidationProblem[] {
  return Object.entries(FORBIDDEN_FIELDS[kind] ?? {})
    .filter(([field]) => field in frontmatter)
    .map(([field, message]) => ({ field, message }))
}

const branchSchema = z.looseObject({
  ...universalShape('branch'),
  // ADR 0031 requires this to be explicit, so a missing state is a Diagnostic
  // rather than a silent assumption of active.
  state: z.enum(['active', 'dormant']),
})

/** ADR 0010: a Claim or Harvest is only knowledge if it cites evidence. */
const supportedBy = z
  .array(itemIdOfKind('root'))
  .min(1, 'must cite at least one Root, because a Claim without evidence is not a Claim')

const claimLeafSchema = z.looseObject({
  ...universalShape('claim_leaf'),
  supported_by: supportedBy,
})

const harvestSchema = z.looseObject({
  ...universalShape('harvest'),
  supported_by: supportedBy.clone(),
})

const SCHEMA_BY_KIND = {
  seed: lightweight('seed'),
  root: rootSchema,
  branch: branchSchema,
  claim_leaf: claimLeafSchema,
  question_leaf: lightweight('question_leaf'),
  idea_leaf: lightweight('idea_leaf'),
  observation_leaf: lightweight('observation_leaf'),
  harvest: harvestSchema,
} as const

/**
 * ADR 0078: newly created files use a documented canonical field order, while
 * existing files are never reordered merely because one field changed.
 *
 * Declared here so the order has one definition. Applying it is the business of
 * whichever ticket first writes a file; nothing in this build writes one yet.
 */
export const CANONICAL_FIELD_ORDER: readonly string[] = [
  'schema_version',
  'id',
  'kind',
  'title',
  // Kind-specific fields sit between identity and placement.
  'state',
  'origin_url',
  'captured_at',
  'content_hash',
  'attribution',
  'supported_by',
  'parent_id',
  'relations',
  'created_at',
  'updated_at',
]

/** ADR 0030: the fixed Markdown contract every Harvest keeps. */
export const REQUIRED_HARVEST_SECTIONS = [
  'Question',
  'Synthesis',
  'Evidence',
  'Contradictions and uncertainty',
  'Open questions',
] as const

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*$/gm

export function headingsIn(body: string): readonly string[] {
  return [...body.matchAll(HEADING)].map((match) => (match[1] ?? '').trim())
}

export function missingHarvestSections(body: string): readonly string[] {
  const present = new Set(headingsIn(body).map((heading) => heading.toLowerCase()))
  return REQUIRED_HARVEST_SECTIONS.filter((section) => !present.has(section.toLowerCase()))
}

function bodyProblems(kind: GardenItemKind, body: string): readonly ValidationProblem[] {
  if (kind === 'root' && body.trim() === '') {
    return [{ field: 'body', message: 'must contain the captured excerpt, which is the evidence' }]
  }

  if (kind === 'harvest') {
    const missing = missingHarvestSections(body)
    if (missing.length > 0) {
      return [
        {
          field: 'body',
          message: `must contain a section for each of: ${missing.join(', ')}`,
        },
      ]
    }
  }

  return []
}

function isKnownKind(candidate: unknown): candidate is GardenItemKind {
  return typeof candidate === 'string' && (GARDEN_ITEM_KINDS as readonly string[]).includes(candidate)
}

export function validateGardenItem(
  frontmatter: Record<string, unknown>,
  body: string,
): ValidationResult {
  const kind = frontmatter['kind']
  if (!isKnownKind(kind)) {
    return {
      ok: false,
      problems: [{ field: 'kind', message: `must be one of: ${GARDEN_ITEM_KINDS.join(', ')}` }],
    }
  }

  const placement = [
    ...forbiddenFieldProblems(kind, frontmatter),
    ...missingParentProblems(kind, frontmatter),
  ]
  if (placement.length > 0) return { ok: false, problems: placement }

  const parsed = SCHEMA_BY_KIND[kind].safeParse(frontmatter)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'frontmatter',
        message: issue.message,
      })),
    }
  }

  const data = parsed.data
  const problems = [...bodyProblems(kind, body)]

  // ADR 0077: creation time is stable for an item's lifetime, so an update can
  // never predate it. Compared as instants rather than as strings: fractional
  // seconds are permitted, and '.' sorts before 'Z', so a lexical comparison
  // reads 10:00:00.500Z as earlier than 10:00:00Z.
  if (Date.parse(data.updated_at) < Date.parse(data.created_at)) {
    problems.push({ field: 'updated_at', message: 'must not be earlier than created_at' })
  }

  if (problems.length > 0) return { ok: false, problems }

  const universal = {
    schemaVersion: data.schema_version,
    id: data.id,
    title: data.title,
    parentId: 'parent_id' in data ? (data.parent_id as string | undefined) : undefined,
    relations: data.relations.map((entry) => ({ type: entry.type, target: entry.target })),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    body,
  }

  switch (kind) {
    case 'root': {
      const root = data as z.infer<typeof rootSchema>
      return {
        ok: true,
        item: {
          ...universal,
          kind,
          originUrl: root.origin_url,
          capturedAt: root.captured_at,
          contentHash: root.content_hash,
          attribution: root.attribution,
        },
      }
    }
    case 'branch':
      return {
        ok: true,
        item: { ...universal, kind, state: (data as z.infer<typeof branchSchema>).state },
      }
    case 'claim_leaf':
    case 'harvest':
      return {
        ok: true,
        item: {
          ...universal,
          kind,
          supportedBy: (data as z.infer<typeof claimLeafSchema>).supported_by,
        },
      }
    default:
      return { ok: true, item: { ...universal, kind } }
  }
}
