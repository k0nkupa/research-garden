import { contentHash } from '../domain/hash'
import { parseGardenDocument, serializeGardenDocument, setBody, setFrontmatterField } from '../domain/document/gardenDocument'
import type { GardenIndex, IndexedItem } from '../domain/index/gardenIndex'
import { rootEvidenceChanges, type RootEvidenceChange } from '../domain/schema/rootEvidence'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { ensureMutable } from './mutationGuard'

/**
 * Everything a body edit has to check and compute before it is either
 * written directly (`editItem`, ticket 12) or staged for review
 * (`proposeChange`, ticket 14) -- the two differ only in what happens once
 * this says the edit is `'ready'`. Kept as one function so the checks
 * themselves, and their order, cannot drift between a person's own edit and
 * an agent's proposed one.
 */
export type BodyEditDerivation =
  | {
      readonly kind: 'ready'
      readonly indexed: IndexedItem
      readonly currentText: string
      readonly currentHash: string
      readonly newText: string
      readonly resultingHash: string
    }
  /** The body is identical to what is already on disk -- not an edit at all. */
  | { readonly kind: 'no-op'; readonly indexed: IndexedItem; readonly currentHash: string }
  | { readonly kind: 'blocked'; readonly reason: string }
  | {
      readonly kind: 'evidence-refused'
      readonly message: string
      readonly changes: readonly RootEvidenceChange[]
    }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * The five ways a body edit can be refused, before it is ever `'ready'` --
 * shared verbatim, not just in shape, by `EditItemResult` and
 * `ProposeChangeResult`. A caller narrows `derived` to this with one guard
 * (`derived.kind !== 'ready' && derived.kind !== 'no-op'`) and returns it
 * directly, rather than a `switch` repeating the same five cases in both
 * `editItem.ts` and `proposeChange.ts`.
 */
export type BodyEditRefusal = Exclude<BodyEditDerivation, { kind: 'ready' } | { kind: 'no-op' }>

export interface BodyEditInput {
  readonly itemId: string
  /** The raw file text as read when editing began, so a concurrent change is detectable. */
  readonly baseText: string
  readonly newBody: string
}

/**
 * May throw a `GardenFileSystemError` (permission lapsing mid-read, in
 * particular) -- deliberately not caught here, so each caller keeps its own
 * try/catch and its own choice of what a caught error becomes.
 */
export async function deriveBodyEdit(
  fileSystem: GardenFileSystem,
  index: GardenIndex,
  input: BodyEditInput,
  /**
   * Already read, not a clock to call: the caller needs this exact same
   * instant again for its own record (`appliedAt` on an Undo Snapshot,
   * `proposedAt` on a Pending Change), and calling `now()` a second time
   * would let a real clock tick between the two, so `updated_at` and the
   * record that describes writing it would silently disagree.
   */
  now: string,
): Promise<BodyEditDerivation> {
  // ADR 0052 / ticket 05: an item carrying a Garden Diagnostic is readable but
  // not writable, and this is the check that makes that criterion falsifiable.
  const block = ensureMutable(index, input.itemId)
  if (block) return { kind: 'blocked', reason: block.reason }

  // `ensureMutable` above already refused a missing item, so this is present.
  const indexed = index.items.get(input.itemId)!

  // ADR 0012 / ADR 0020 / ticket 03: a Root's body is its captured evidence.
  // Only its metadata may be corrected, and this action only ever edits body
  // text, so any body change to a Root is refused outright. Written as a
  // literal `kind` comparison (rather than calling `isBodyEditableKind`) so
  // TypeScript narrows `indexed.item` to `RootItem` for `rootEvidenceChanges`;
  // `isBodyEditableKind` in `rootEvidence.ts` still owns the rule itself, and
  // this is the one place it is checked for real (`ItemPanel`'s own use of it
  // is UI-only, to decide whether to offer Edit at all).
  if (indexed.item.kind === 'root') {
    const changes = rootEvidenceChanges(indexed.item, { ...indexed.item, body: input.newBody })
    if (changes.length > 0) {
      return {
        kind: 'evidence-refused',
        message:
          "A Root's captured evidence cannot be edited; only its metadata (such as attribution) may be corrected.",
        changes,
      }
    }
  }

  if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }

  // "Revalidate ... target content hash": the file has to still be exactly
  // what the person (or the proposal) was built against, or a concurrent
  // change (another tab, an agent, a hand edit) could be silently discarded.
  const currentText = await fileSystem.read(indexed.path)
  const [currentHash, baseHash] = await Promise.all([
    contentHash(currentText),
    contentHash(input.baseText),
  ])
  if (currentHash !== baseHash) {
    return {
      kind: 'stale',
      message: 'This item changed on disk since it was opened for editing. Reopen it to edit the current version.',
    }
  }

  const parsed = parseGardenDocument(currentText)
  if (!parsed.ok) {
    // The parser's own message can quote fragments of the file it failed on
    // (ADR 0067: Garden Activity never carries file content), so only the
    // failure code is reported.
    return {
      kind: 'failed',
      message: `The file at ${indexed.path.join('/')} could not be parsed (${parsed.error.code}).`,
    }
  }

  // ADR 0077: `updated_at` moves only when the item is actually edited. A
  // body identical to what is already on disk is not an edit.
  if (input.newBody === parsed.document.body) {
    return { kind: 'no-op', indexed, currentHash }
  }

  const edited = setFrontmatterField(setBody(parsed.document, input.newBody), 'updated_at', now)
  const newText = serializeGardenDocument(edited)
  const resultingHash = await contentHash(newText)

  return { kind: 'ready', indexed, currentText, currentHash, newText, resultingHash }
}
