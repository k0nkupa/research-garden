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
interface UndoSnapshotFields {
  readonly id: string
  readonly itemId: string
  readonly path: GardenPath
  readonly resultingHash: string
  readonly appliedAt: string
}

/** The prior canonical-file state, with contradictory data made unrepresentable. */
export type UndoSnapshotPrior =
  | {
      readonly previousState: 'absent'
      readonly previousText: ''
      readonly previousHash: string
    }
  | {
      readonly previousState: 'present'
      readonly previousText: string
      readonly previousHash: string
    }

export type UndoSnapshotRecord = UndoSnapshotFields & UndoSnapshotPrior

/** Input accepted by the writer for callers and legacy tests using the old flat shape. */
type LegacyUndoSnapshotRecord = UndoSnapshotFields & {
  readonly previousText: string
  readonly previousHash: string
  readonly previousState?: undefined
}
export type UndoSnapshotRecordInput = UndoSnapshotRecord | LegacyUndoSnapshotRecord
type PersistedUndoSnapshotRecord = UndoSnapshotRecord | LegacyUndoSnapshotRecord

const UNDO_DIRECTORY = 'undo'

/** Converts the old flat shape to the explicit present-file state exactly once. */
function normalizeUndoSnapshotRecord(record: PersistedUndoSnapshotRecord): UndoSnapshotRecord {
  if ('previousState' in record && record.previousState !== undefined) return record

  return {
    id: record.id,
    itemId: record.itemId,
    path: record.path,
    previousState: 'present',
    previousText: record.previousText,
    previousHash: record.previousHash,
    resultingHash: record.resultingHash,
    appliedAt: record.appliedAt,
  }
}

/** Addressed by the snapshot's own operational id, never a caller-supplied path. */
export function undoSnapshotPath(id: string): GardenPath {
  return operationalRecordPath(UNDO_DIRECTORY, id)
}

export async function writeUndoSnapshot(
  fileSystem: GardenFileSystem,
  record: UndoSnapshotRecordInput,
): Promise<void> {
  await writeOperationalRecord(fileSystem, UNDO_DIRECTORY, normalizeUndoSnapshotRecord(record))
}

const STRING_FIELDS = ['id', 'itemId', 'previousText', 'previousHash', 'resultingHash', 'appliedAt'] as const

function isUndoSnapshotRecord(value: unknown): value is PersistedUndoSnapshotRecord {
  if (!isOperationalRecordShape(value, STRING_FIELDS)) return false
  const record = value as Record<string, unknown>
  if (record.previousState === undefined) return true
  if (record.previousState === 'present') return true
  return record.previousState === 'absent' && record.previousText === ''
}

/** `undefined` when no snapshot exists at that id, or what is there is not one. */
export async function readUndoSnapshot(
  fileSystem: GardenFileSystem,
  id: string,
): Promise<UndoSnapshotRecord | undefined> {
  const record = await readOperationalRecord<PersistedUndoSnapshotRecord>(
    fileSystem,
    UNDO_DIRECTORY,
    id,
    isUndoSnapshotRecord,
  )
  if (!record) return undefined
  // Snapshots written before direct additions had an explicit prior-file state
  // necessarily describe an existing file. Normalizing here keeps old records
  // readable without allowing their empty text to acquire absence semantics.
  return normalizeUndoSnapshotRecord(record)
}
