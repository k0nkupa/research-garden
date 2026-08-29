import { contentHash } from '../domain/hash'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { OPERATIONAL_DIRECTORY } from '../domain/schema/itemIdentity'
import {
  isOperationalRecordShape,
  operationalRecordPath,
  readOperationalRecord,
  writeOperationalRecord,
} from './operationalRecord'

/**
 * A Pending Change: an agent's proposed edit, staged for a person's review
 * rather than applied (ADR 0005, ADR 0025, ticket 14).
 *
 * Persisted under the operational directory, exactly as an Undo Snapshot is
 * (ADR 0021, ADR 0026, ADR 0050) -- noncanonical, never scanned into the
 * Garden Index, never appearing in the Tree or search. `baseText`/`baseHash`
 * are what `record.path` held when this was proposed; approval refuses the
 * moment the file's current content no longer matches `baseHash` (ADR 0063:
 * no cross-tab writer-ownership protocol, just a hash comparison that turns
 * a stale proposal into a refusal rather than a silent overwrite).
 * `baseText` itself is carried so the Change Tray can show a real diff
 * -- old lines against new -- without a second read racing against whatever
 * the file has become by the time someone opens it (that race is exactly
 * what `baseHash` alone would leave: the *comparison* stays trustworthy, but
 * the *display* would silently drift from what was actually proposed).
 * `previewText`/`previewHash` are the exact one-file diff a person -- or
 * `inspect_pending_change`, once ticket 18 exists -- reviews; approval is
 * asked to name the hash it inspected, and a mismatch is refused rather
 * than trusted (ADR 0025).
 */
interface PendingChangeFields {
  readonly id: string
  readonly itemId: string
  readonly path: GardenPath
  readonly baseText: string
  readonly baseHash: string
  readonly previewText: string
  readonly previewHash: string
  readonly proposedAt: string
}

/**
 * Existing-file proposals are the legacy default when `baseState` is absent;
 * new records state their target existence explicitly. The absent variant is
 * intentionally constrained to an empty base, making an invalid new-file
 * record unrepresentable at the action seam.
 */
export type PendingChangeRecord = PendingChangeFields & (
  | { readonly baseState: 'present' }
  | { readonly baseState: 'absent'; readonly baseText: '' }
  | { readonly baseState?: undefined }
)

/** Legacy records omitted `baseState`; absence is never inferred from empty text. */
export function pendingChangeBaseState(record: PendingChangeRecord): 'present' | 'absent' {
  return record.baseState === 'absent' ? 'absent' : 'present'
}

export function isAbsentPendingChange(record: PendingChangeRecord): boolean {
  return pendingChangeBaseState(record) === 'absent' && record.baseText === '' && record.path[0] === 'harvests' && record.itemId.startsWith('harvest_')
}

const PENDING_DIRECTORY = 'pending'

/** Addressed by the change's own operational id, never a caller-supplied path. */
export function pendingChangePath(id: string): GardenPath {
  return operationalRecordPath(PENDING_DIRECTORY, id)
}

export async function writePendingChange(
  fileSystem: GardenFileSystem,
  record: PendingChangeRecord,
): Promise<void> {
  await writeOperationalRecord(fileSystem, PENDING_DIRECTORY, record)
}

/** A canonical write never happens here: rejecting is deleting this one operational record. */
export async function deletePendingChange(fileSystem: GardenFileSystem, id: string): Promise<void> {
  await fileSystem.delete(pendingChangePath(id))
}

const STRING_FIELDS = [
  'id',
  'itemId',
  'baseText',
  'baseHash',
  'previewText',
  'previewHash',
  'proposedAt',
] as const

function isPendingChangeRecord(value: unknown): value is PendingChangeRecord {
  if (!isOperationalRecordShape(value, STRING_FIELDS)) return false
  const record = value as Record<string, unknown>
  return record.baseState === undefined || record.baseState === 'present' || (record.baseState === 'absent' && record.baseText === '')
}

/** `undefined` when no change exists at that id, or what is there is not one. */
export async function readPendingChange(
  fileSystem: GardenFileSystem,
  id: string,
): Promise<PendingChangeRecord | undefined> {
  return readOperationalRecord(fileSystem, PENDING_DIRECTORY, id, isPendingChangeRecord)
}

/**
 * Every currently proposed change, oldest first. A record that fails to
 * parse or validate is silently skipped rather than shown broken -- the
 * Change Tray has nothing useful to do with a Pending Change it cannot read.
 */
export async function listPendingChanges(
  fileSystem: GardenFileSystem,
): Promise<readonly PendingChangeRecord[]> {
  const paths = await fileSystem.listFiles([OPERATIONAL_DIRECTORY, PENDING_DIRECTORY])
  const ids = paths
    .filter((path) => path.at(-1)?.endsWith('.json'))
    .map((path) => path.at(-1)!.replace(/\.json$/, ''))

  const records = await Promise.all(ids.map((id) => readPendingChange(fileSystem, id)))
  return records
    .filter((record): record is PendingChangeRecord => record !== undefined)
    .sort((a, b) => (a.proposedAt < b.proposedAt ? -1 : a.proposedAt > b.proposedAt ? 1 : 0))
}

/**
 * Whether a Pending Change's target no longer matches the state it was
 * proposed against (ADR 0063, ticket 14) -- the same check `approveChange`
 * makes before writing, run here so the Change Tray can show Stale before a
 * person ever attempts to approve it, not only once they try.
 */
export async function isPendingChangeStale(
  fileSystem: GardenFileSystem,
  record: PendingChangeRecord,
): Promise<boolean> {
  let currentText: string
  try {
    currentText = await fileSystem.read(record.path)
  } catch (error) {
    // A Harvest proposal intentionally targets a file that does not exist yet.
    // Its empty base is the explicit new-file state; all other missing targets
    // remain stale as before.
    if (error instanceof GardenFileSystemError && error.code === 'not-found') {
      return !isAbsentPendingChange(record) || record.baseHash !== await contentHash('')
    }
    throw error
  }

  // An explicitly absent target is a create-if-absent proposal. Even an empty
  // file at its path is a concurrent write and must not be overwritten merely
  // because its content hash happens to equal the empty base hash.
  if (isAbsentPendingChange(record)) return true

  return (await contentHash(currentText)) !== record.baseHash
}
