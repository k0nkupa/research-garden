import { contentHash } from '../domain/hash'
import { parseGardenDocument, serializeGardenDocument, setBody, setFrontmatterField } from '../domain/document/gardenDocument'
import type { GardenIndex } from '../domain/index/gardenIndex'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { rootEvidenceChanges, type RootEvidenceChange } from '../domain/schema/rootEvidence'
import { createUlidFactory, browserEntropy, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { ensureMutable } from './mutationGuard'
import { writeUndoSnapshot } from './undoSnapshot'
import { writeAndVerify } from './verifiedWrite'

/**
 * Human edit with a verified write.
 *
 * The first Garden Action that changes a person's files (ticket 12). ADR 0055
 * fixes the sequence: revalidate permission and the target's content hash,
 * snapshot the previous content as an Undo Snapshot, write once, reread,
 * revalidate, confirm the content hash, then report. Only body text is edited
 * -- frontmatter Research Garden did not ask to change survives untouched
 * (ADR 0078), and `updated_at` is the only field this action itself sets
 * (ADR 0077).
 *
 * At most one canonical file is touched per call (ADR 0021): the Undo
 * Snapshot is an operational write, not a second canonical one. A body that
 * comes back identical to what is already on disk is not an edit and writes
 * nothing at all, so `updated_at` never moves for a no-op save.
 */

export interface EditItemInput {
  readonly itemId: string
  /** The raw file text as read when editing began, so a concurrent change is detectable. */
  readonly baseText: string
  readonly newBody: string
}

export interface EditItemOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export type EditItemResult =
  | {
      readonly kind: 'saved'
      readonly itemId: string
      readonly path: GardenPath
      /**
       * Addresses the Undo Snapshot this save produced; pass to `undoChange`.
       * `undefined` when the edit was a no-op (ADR 0077: `updated_at` moves
       * only when the item is actually edited, so a no-op writes nothing and
       * has no snapshot to undo).
       */
      readonly snapshotId: string | undefined
      readonly previousHash: string
      readonly resultingHash: string
    }
  | { readonly kind: 'blocked'; readonly reason: string }
  | {
      readonly kind: 'evidence-refused'
      readonly message: string
      readonly changes: readonly RootEvidenceChange[]
    }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'verification-failed'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

/** A fixed, generic reason for an unexpected failure -- never the raw error. */
const GENERIC_FAILURE_MESSAGE =
  'The edit could not be saved. Check that the Garden Repository is still available and try again.'

export async function editItem(
  fileSystem: GardenFileSystem,
  index: GardenIndex,
  input: EditItemInput,
  options: EditItemOptions = {},
): Promise<EditItemResult> {
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
  // this is the one place it is checked for real (ItemPanel's own use of it
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

  try {
    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }

    // "Revalidate ... target content hash": the file has to still be exactly
    // what the person was shown when they opened Edit mode, or a concurrent
    // change (another tab, an agent) could be silently discarded.
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
    // body identical to what is already on disk is not an edit -- nothing is
    // written, and there is no Undo Snapshot for a change that never happened.
    if (input.newBody === parsed.document.body) {
      return {
        kind: 'saved',
        itemId: input.itemId,
        path: indexed.path,
        snapshotId: undefined,
        previousHash: currentHash,
        resultingHash: currentHash,
      }
    }

    const now = (options.now ?? nowAsCanonicalTimestamp)()
    const edited = setFrontmatterField(setBody(parsed.document, input.newBody), 'updated_at', now)
    const newText = serializeGardenDocument(edited)
    const resultingHash = await contentHash(newText)

    const nextSnapshotId = createUlidFactory(options.entropy ?? browserEntropy)
    const snapshotId = nextSnapshotId()

    // Snapshot before the write, so the previous content is recoverable even
    // if the write itself fails partway (ADR 0055).
    await writeUndoSnapshot(fileSystem, {
      id: snapshotId,
      itemId: input.itemId,
      path: indexed.path,
      previousText: currentText,
      previousHash: currentHash,
      resultingHash,
      appliedAt: now,
    })

    const verified = await writeAndVerify(fileSystem, indexed.path, newText)
    if (verified.kind === 'verification-failed') return verified

    return {
      kind: 'saved',
      itemId: input.itemId,
      path: indexed.path,
      snapshotId,
      previousHash: currentHash,
      resultingHash: verified.hash,
    }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required' }
    }
    // The underlying error is deliberately not surfaced: it may be a
    // filesystem or parser error carrying fragments of file content, and
    // Garden Activity (which this result eventually reaches) never carries
    // raw content (ADR 0067).
    return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * The one place `EditItemResult`'s non-`saved` variants become a sentence.
 *
 * Both the Activity feed (`gardenActivity.ts`) and the Edit form itself
 * (`ItemPanel.tsx`) need to say why a save did not succeed, in the same words
 * -- so this is written once, next to the result type it describes, rather
 * than as two switches that could drift apart.
 */
export function describeEditItemFailure(result: EditItemResult): string | undefined {
  switch (result.kind) {
    case 'saved':
      return undefined
    case 'blocked':
      return result.reason
    case 'evidence-refused':
      return result.message
    case 'permission-required':
      return 'Permission for this Garden Repository was not available. Try again.'
    case 'stale':
      return result.message
    case 'verification-failed':
      return result.message
    case 'failed':
      return result.message
  }
}
