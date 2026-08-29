import { z } from 'zod'
import type { OpenedGarden } from '../garden/openGarden'
import type { ValidationProblem } from '../domain/schema/gardenItem'
import { okEnvelope, type ToolEnvelope } from './envelope'
import type { ReadToolSpec } from './readTool'

/**
 * `audit_garden`: every Garden Diagnostic (ticket 05), the same list
 * `DiagnosticsPanel` shows a person -- including files that failed to parse
 * or validate at all, which is why `itemId`/`title` are optional here just
 * as they are on `GardenDiagnostic` itself. No separate audit computation
 * exists to reimplement (ADR 0003): `index.diagnostics` already is this.
 */

export const AuditGardenInput = z.strictObject({})
export type AuditGardenInput = z.infer<typeof AuditGardenInput>

export interface AuditGardenDiagnostic {
  readonly path: string
  readonly itemId: string | undefined
  readonly title: string | undefined
  readonly problems: readonly ValidationProblem[]
}

export interface AuditGardenData {
  readonly diagnostics: readonly AuditGardenDiagnostic[]
  readonly totalDiagnostics: number
}

export function runAuditGarden(garden: OpenedGarden): ToolEnvelope<AuditGardenData> {
  const diagnostics = garden.index.diagnostics.map(
    (diagnostic): AuditGardenDiagnostic => ({
      path: diagnostic.path.join('/'),
      itemId: diagnostic.itemId,
      title: diagnostic.title,
      problems: diagnostic.problems,
    }),
  )

  return okEnvelope({ diagnostics, totalDiagnostics: diagnostics.length }, garden.index.revision)
}

export const AUDIT_GARDEN_SPEC: ReadToolSpec<AuditGardenInput, AuditGardenData> = {
  name: 'audit_garden',
  description:
    'Lists every Garden Diagnostic in the currently open Garden -- files that failed to parse, ' +
    'validate, or satisfy a graph invariant, including items that are not readable as any kind.',
  inputSchema: AuditGardenInput,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  action: 'audit_garden',
  run: (garden) => runAuditGarden(garden),
  itemIdsFor: () => [],
}
