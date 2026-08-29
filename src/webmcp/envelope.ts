import type { GardenRevision } from '../domain/index/gardenRevision'

/**
 * The common WebMCP result envelope (ADR 0036, ticket 18).
 *
 * Every read tool wraps its data in this, success or failure, so a host
 * agent never has to infer outcome from prose or an uncaught exception. The
 * ticket's own list -- "browser, permission, lookup, schema, relation,
 * inspection, staleness, confirmation, write" -- is the starting taxonomy
 * ADR 0036 asks for, and each of those names an already-specific concept
 * elsewhere in this design: `schema` is a canonical item failing
 * `gardenItem.ts`'s own validation (a mutation concern), and `inspection` is
 * ADR 0025's "bind application to an inspected preview" -- `apply_pending_change`
 * (ticket 23) refusing because `inspect_pending_change` was never called
 * first, not a generic "something about this call looked wrong." Neither
 * fits "the raw WebMCP call arguments did not match this tool's own
 * `inputSchema`", which none of the ADR's nine names describe, so
 * `invalid-input` is added here for exactly that, alongside `internal` as a
 * defensive fallback for a bug in a tool's own logic (never returned by
 * domain logic itself). Ticket 18's four read tools only ever produce
 * `invalid-input` and `lookup`: they run purely over the Garden Index already
 * held in memory, the same one the Tree renders from, so `browser` (no
 * WebMCP), `permission`, `schema`, `relation`, `inspection`, `staleness`,
 * `confirmation`, and `write` describe failures reachable only by actions
 * that touch the filesystem, canonical validation, or another tab's state --
 * tickets 20-23's mutating tools, not these.
 */
export type EnvelopeErrorCode =
  | 'browser'
  | 'permission'
  | 'lookup'
  | 'schema'
  | 'relation'
  | 'inspection'
  | 'staleness'
  | 'confirmation'
  | 'write'
  | 'invalid-input'
  | 'internal'

export interface EnvelopeError {
  readonly code: EnvelopeErrorCode
  readonly message: string
  /** Whether the exact same call, retried later, could plausibly succeed. */
  readonly retryable: boolean
}

/**
 * Every result -- success or failure -- carries the Garden Revision it was
 * computed against, so a host agent can tell whether what it is holding is
 * still true (ADR 0036) by comparing revisions across calls, rather than
 * needing a fresh read to find out.
 */
export type ToolEnvelope<T> =
  | {
      readonly ok: true
      readonly data: T
      readonly gardenRevision: GardenRevision
      readonly warnings: readonly string[]
    }
  | {
      readonly ok: false
      readonly error: EnvelopeError
      readonly gardenRevision: GardenRevision
      readonly warnings: readonly string[]
    }

/**
 * Centralised, not left to each call site, so retryability can never
 * disagree between two callers returning the same code.
 */
const RETRYABLE_ERROR_CODES: ReadonlySet<EnvelopeErrorCode> = new Set(['permission', 'staleness', 'write'])

export function okEnvelope<T>(
  data: T,
  gardenRevision: GardenRevision,
  warnings: readonly string[] = [],
): ToolEnvelope<T> {
  return { ok: true, data, gardenRevision, warnings }
}

export function errorEnvelope<T>(
  code: EnvelopeErrorCode,
  message: string,
  gardenRevision: GardenRevision,
  warnings: readonly string[] = [],
): ToolEnvelope<T> {
  return { ok: false, error: { code, message, retryable: RETRYABLE_ERROR_CODES.has(code) }, gardenRevision, warnings }
}
