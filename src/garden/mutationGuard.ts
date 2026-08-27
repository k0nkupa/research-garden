import type { GardenDiagnostic, GardenIndex } from '../domain/index/gardenIndex'

/**
 * Whether an item may be mutated.
 *
 * ADR 0052: a Diagnostic makes an item visible, auditable, and readable, but
 * not writable. Editing a file Research Garden does not fully understand risks
 * discarding the very fields it could not parse, which is the opposite of the
 * promise that a person's Markdown survives contact with this application.
 *
 * The block is lifted by fixing the file, not by overriding it -- hence
 * "blocked until its known fields and relationships validate" rather than
 * "blocked unless forced".
 *
 * Nothing calls this yet, because nothing in this build writes. It is the check
 * every mutation path will run before proposing or applying -- ticket 12 for
 * human edits, tickets 20 and 22 for agent additions and proposals -- and the
 * ticket 05 criterion it serves stays unticked until one of them does.
 */
export interface MutationBlock {
  readonly itemId: string
  /** In the person's terms, naming what has to be fixed first. */
  readonly reason: string
  readonly diagnostics: readonly GardenDiagnostic[]
}

/** Every Diagnostic reported against one item, by id. */
export function diagnosticsForItem(
  index: GardenIndex,
  itemId: string,
): readonly GardenDiagnostic[] {
  return index.diagnostics.filter((diagnostic) => diagnostic.itemId === itemId)
}

/**
 * Refuses a mutation when its target is not fully understood.
 *
 * Returns the reason rather than a boolean, because a surface that blocks an
 * action has to be able to say why, and an agent needs a stable explanation
 * rather than a bare refusal (ADR 0036).
 */
export function blockOnDiagnostics(
  index: GardenIndex,
  itemId: string,
): MutationBlock | undefined {
  const diagnostics = diagnosticsForItem(index, itemId)
  if (diagnostics.length === 0) return undefined

  const problems = diagnostics.flatMap((diagnostic) => diagnostic.problems)
  const summary = problems.map((problem) => `${problem.field} ${problem.message}`).join('; ')

  return {
    itemId,
    reason: `This item has unresolved Garden Diagnostics and cannot be changed until they are fixed: ${summary}`,
    diagnostics,
  }
}

/**
 * Refuses a mutation whose target is not an item at all.
 *
 * A file that never parsed has no id, so a mutation cannot name it; and an id
 * that resolves to nothing cannot be edited either. Both are refused with an
 * explanation rather than silently doing nothing.
 */
export function blockOnMissingItem(index: GardenIndex, itemId: string): MutationBlock | undefined {
  if (index.items.has(itemId)) return undefined

  const unparsed = index.diagnostics.find((diagnostic) => diagnostic.itemId === itemId)
  return {
    itemId,
    reason: unparsed
      ? `${itemId} did not load as a Garden item and cannot be changed until its file validates`
      : `${itemId} is not an item in this Garden`,
    diagnostics: unparsed ? [unparsed] : [],
  }
}

/** The single check every mutation path runs before touching an item. */
export function ensureMutable(index: GardenIndex, itemId: string): MutationBlock | undefined {
  return blockOnMissingItem(index, itemId) ?? blockOnDiagnostics(index, itemId)
}
