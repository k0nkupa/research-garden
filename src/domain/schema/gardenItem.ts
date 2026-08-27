import { z } from 'zod'

/**
 * Schema validation for canonical Garden items.
 *
 * ADR 0054 sets the shape of this layer: validate strictly what Research Garden
 * understands, and stay silent about what it does not, so hand-authored
 * metadata and compatible extensions survive. Ticket 02 knows one kind; later
 * kinds extend the discriminated union rather than loosening these rules.
 */

/** ADR 0076: every canonical item declares the version it was written against. */
export const CURRENT_SCHEMA_VERSION = 1

export type GardenItemKind = 'branch'

export type BranchState = 'active' | 'dormant'

export interface BranchItem {
  readonly schemaVersion: number
  readonly id: string
  readonly kind: 'branch'
  readonly title: string
  /**
   * ADR 0031 requires this to be explicit, so a missing state is a Diagnostic
   * rather than a silent assumption of active.
   */
  readonly state: BranchState
  readonly parentId: string | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

export type GardenItem = BranchItem

export interface ValidationProblem {
  /** The on-disk field name, so a Diagnostic can point a person at their file. */
  readonly field: string
  readonly message: string
}

export type ValidationResult =
  | { readonly ok: true; readonly item: GardenItem }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] }

/** Crockford base32 without I, L, O, or U — the ULID alphabet (ADR 0034). */
const ULID = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/

/** ADR 0077: ISO 8601 serialized in UTC. A local offset is not canonical. */
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function isRealCalendarInstant(value: string): boolean {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  // Date rolls 2026-02-30 forward to March; comparing back catches that.
  return parsed.toISOString().startsWith(value.slice(0, 10))
}

const utcTimestamp = z
  .string()
  .regex(UTC_TIMESTAMP, 'must be an ISO 8601 timestamp in UTC, such as 2026-08-01T10:00:00Z')
  .refine(isRealCalendarInstant, 'must be a real date')

function kindPrefixedUlid(kind: GardenItemKind) {
  return z.string().refine((value) => {
    const [prefix, ulid, ...rest] = value.split('_')
    return rest.length === 0 && prefix === kind && ulid !== undefined && ULID.test(ulid)
  }, `must be a ${kind}-prefixed ULID, such as ${kind}_01HQ8X2K3M4N5P6Q7R8S9T0V1W`)
}

const branchSchema = z.looseObject({
  schema_version: z.literal(
    CURRENT_SCHEMA_VERSION,
    `must be ${CURRENT_SCHEMA_VERSION}, the schema version this build understands`,
  ),
  id: kindPrefixedUlid('branch'),
  kind: z.literal('branch'),
  title: z.string().trim().min(1, 'must be a non-empty title'),
  state: z.enum(['active', 'dormant']),
  parent_id: kindPrefixedUlid('branch').optional(),
  created_at: utcTimestamp,
  updated_at: utcTimestamp,
})

const KNOWN_KINDS: readonly string[] = ['branch']

export function validateGardenItem(frontmatter: Record<string, unknown>): ValidationResult {
  const kind = frontmatter['kind']
  if (typeof kind !== 'string' || !KNOWN_KINDS.includes(kind)) {
    return {
      ok: false,
      problems: [
        {
          field: 'kind',
          message: `must be one of: ${KNOWN_KINDS.join(', ')}`,
        },
      ],
    }
  }

  const parsed = branchSchema.safeParse(frontmatter)
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
  return {
    ok: true,
    item: {
      schemaVersion: data.schema_version,
      id: data.id,
      kind: 'branch',
      title: data.title,
      state: data.state,
      parentId: data.parent_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }
}
