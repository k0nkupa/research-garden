import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { OPERATIONAL_DIRECTORY } from '../domain/schema/itemIdentity'

/**
 * The read/write/validate shape every operational record shares (ADR 0021,
 * ADR 0026, ADR 0050): a Pending Change and an Undo Snapshot are unrelated in
 * what they hold, but identical in how they are addressed, serialized, and
 * distrusted once read back off disk. Extracted once both grew this same
 * ~35-line shape independently (Undo Snapshot in ticket 12, Pending Change in
 * ticket 14), so a change to the shape itself -- how a record is addressed,
 * or how a corrupted one is handled -- cannot drift between the two.
 */

/** Addressed by the record's own operational id, never a caller-supplied path. */
export function operationalRecordPath(subdirectory: string, id: string): GardenPath {
  return [OPERATIONAL_DIRECTORY, subdirectory, `${id}.json`]
}

export async function writeOperationalRecord<T extends { readonly id: string; readonly path: GardenPath }>(
  fileSystem: GardenFileSystem,
  subdirectory: string,
  record: T,
): Promise<void> {
  const serializable = { ...record, path: [...record.path] }
  await fileSystem.write(operationalRecordPath(subdirectory, record.id), JSON.stringify(serializable, null, 2))
}

/**
 * `undefined` when no record exists at that id, or what is there is not one.
 *
 * A corrupted or truncated record is reported the same way a missing one is:
 * there is nothing here a caller can safely act on. The parse error itself is
 * deliberately not surfaced -- it can quote fragments of the surrounding
 * text, and that text is a person's own file content (ADR 0067: Garden
 * Activity never carries that).
 */
export async function readOperationalRecord<T>(
  fileSystem: GardenFileSystem,
  subdirectory: string,
  id: string,
  isValid: (value: unknown) => value is T,
): Promise<T | undefined> {
  let text: string
  try {
    text = await fileSystem.read(operationalRecordPath(subdirectory, id))
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'not-found') return undefined
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }

  return isValid(parsed) ? parsed : undefined
}

/**
 * Whether parsed JSON has the shape a genuine record of type `T` has: every
 * named field a string, plus a non-empty `path` of string segments. Nothing
 * else in this codebase trusts a value off disk without validating it first
 * (`parseGardenDocument` + `validateGardenItem` do the equivalent job for
 * canonical Markdown) -- an operational record still reaches a filesystem
 * write or a comparison with a path taken from it, so a hand-edited or
 * truncated one has to be caught here rather than surfacing as an uncaught
 * `SyntaxError` or an unchecked path.
 */
export function isOperationalRecordShape<Field extends string>(
  value: unknown,
  stringFields: readonly Field[],
): value is Record<Field, string> & { readonly path: GardenPath } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>

  if (!stringFields.every((field) => typeof record[field] === 'string')) return false

  const path = record['path']
  return Array.isArray(path) && path.length > 0 && path.every((segment) => typeof segment === 'string')
}
