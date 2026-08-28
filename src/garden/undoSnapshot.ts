import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { OPERATIONAL_DIRECTORY } from '../domain/schema/itemIdentity'

/**
 * The Undo Snapshot: a recoverable record of one applied file change.
 *
 * ADR 0021 requires every MVP Garden Action that writes a canonical file to
 * record one of these, and it lives under `OPERATIONAL_DIRECTORY` for the same
 * reason every other operational record does (ADR 0026, ADR 0050, ADR 0067):
 * it is not knowledge, and the Garden Index never scans it. `resultingHash` is
 * what the applied edit produced; `undoChange` refuses to restore once the
 * file no longer matches it, so recovery cannot silently overwrite work done
 * after the edit (ADR 0027).
 */
export interface UndoSnapshotRecord {
  readonly id: string
  readonly itemId: string
  readonly path: GardenPath
  readonly previousText: string
  readonly previousHash: string
  readonly resultingHash: string
  readonly appliedAt: string
}

const UNDO_DIRECTORY = 'undo'

/** Addressed by the snapshot's own operational id, never a caller-supplied path. */
export function undoSnapshotPath(id: string): GardenPath {
  return [OPERATIONAL_DIRECTORY, UNDO_DIRECTORY, `${id}.json`]
}

export async function writeUndoSnapshot(
  fileSystem: GardenFileSystem,
  record: UndoSnapshotRecord,
): Promise<void> {
  const serializable = { ...record, path: [...record.path] }
  await fileSystem.write(undoSnapshotPath(record.id), JSON.stringify(serializable, null, 2))
}

const STRING_FIELDS = ['id', 'itemId', 'previousText', 'previousHash', 'resultingHash', 'appliedAt'] as const

/**
 * Whether parsed JSON has the shape a genuine Undo Snapshot record has.
 *
 * Nothing else in this codebase trusts a value off disk without validating it
 * first (`parseGardenDocument` + `validateGardenItem` do the equivalent job
 * for canonical Markdown). A snapshot is this action's own operational state,
 * not a person's file, but it still reaches a filesystem write with a path
 * taken from it, so a truncated or hand-edited record has to be caught here
 * rather than surfacing as an uncaught `SyntaxError` or an unchecked path.
 */
function isUndoSnapshotRecord(value: unknown): value is UndoSnapshotRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>

  if (!STRING_FIELDS.every((field) => typeof record[field] === 'string')) return false

  const path = record['path']
  return Array.isArray(path) && path.length > 0 && path.every((segment) => typeof segment === 'string')
}

/** `undefined` when no snapshot exists at that id, or what is there is not one. */
export async function readUndoSnapshot(
  fileSystem: GardenFileSystem,
  id: string,
): Promise<UndoSnapshotRecord | undefined> {
  let text: string
  try {
    text = await fileSystem.read(undoSnapshotPath(id))
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'not-found') return undefined
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A corrupted operational record is reported the same way a missing one
    // is: there is nothing here `undoChange` can safely restore from. The
    // parse error itself is deliberately not returned to any caller -- it can
    // quote fragments of the surrounding text, and that text is `previousText`,
    // a person's file content (ADR 0067: Garden Activity never carries that).
    return undefined
  }

  return isUndoSnapshotRecord(parsed) ? parsed : undefined
}
