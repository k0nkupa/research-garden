import type { GardenFileSystem, GardenPath } from '../filesystem/GardenFileSystem'
import {
  isOperationalRecordShape,
  operationalRecordPath,
  readOperationalRecord,
  writeOperationalRecord,
} from './operationalRecord'

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
  return operationalRecordPath(UNDO_DIRECTORY, id)
}

export async function writeUndoSnapshot(
  fileSystem: GardenFileSystem,
  record: UndoSnapshotRecord,
): Promise<void> {
  await writeOperationalRecord(fileSystem, UNDO_DIRECTORY, record)
}

const STRING_FIELDS = ['id', 'itemId', 'previousText', 'previousHash', 'resultingHash', 'appliedAt'] as const

function isUndoSnapshotRecord(value: unknown): value is UndoSnapshotRecord {
  return isOperationalRecordShape(value, STRING_FIELDS)
}

/** `undefined` when no snapshot exists at that id, or what is there is not one. */
export async function readUndoSnapshot(
  fileSystem: GardenFileSystem,
  id: string,
): Promise<UndoSnapshotRecord | undefined> {
  return readOperationalRecord(fileSystem, UNDO_DIRECTORY, id, isUndoSnapshotRecord)
}
