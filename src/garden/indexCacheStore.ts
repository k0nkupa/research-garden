import { emptyIndexCache, parseIndexCache, serializeIndexCache, type IndexCacheRecord } from '../domain/index/indexCache'
import { OPERATIONAL_DIRECTORY } from '../domain/schema/itemIdentity'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'

/**
 * Reading and writing the Index Cache file itself.
 *
 * ADR 0050 names the location: `.research-garden/index.json`, a single
 * operational record rather than one file per entry (unlike Undo Snapshots,
 * which are individually addressed) -- there is exactly one cache for the
 * whole Garden, and it is replaced whole on every open. The parsing and
 * shape-validation this defers to are in `indexCache.ts`, which stays free
 * of filesystem access so the same input always produces the same verdict.
 */

export function indexCachePath(): GardenPath {
  return [OPERATIONAL_DIRECTORY, 'index.json']
}

/**
 * Absent, corrupted, and schema-mismatched all read the same way: an empty
 * cache, meaning nothing is available to reuse (ADR 0062). A person deleting
 * `.research-garden` must be indistinguishable, from here, to Research
 * Garden having never written a cache at all -- that is what "the cache can
 * be deleted at any moment with no loss of knowledge" actually requires.
 */
export async function readIndexCache(fileSystem: GardenFileSystem): Promise<IndexCacheRecord> {
  let text: string
  try {
    text = await fileSystem.read(indexCachePath())
  } catch (error) {
    if (
      error instanceof GardenFileSystemError &&
      (error.code === 'not-found' || error.code === 'not-a-file')
    ) {
      return emptyIndexCache()
    }
    throw error
  }

  return parseIndexCache(text) ?? emptyIndexCache()
}

/**
 * Persists a fresh cache after a scan. Best-effort and silent on failure:
 * the cache is purely a derived performance layer, never a second authority
 * (ADR 0050), so a Garden that scanned correctly must open successfully
 * even if the cache write itself fails -- a lapsed permission mid-write, a
 * folder that is read-only, or anything else. The scan that already
 * succeeded is not undone by a cache that could not be saved.
 */
export async function writeIndexCache(
  fileSystem: GardenFileSystem,
  record: IndexCacheRecord,
): Promise<void> {
  try {
    await fileSystem.write(indexCachePath(), serializeIndexCache(record))
  } catch {
    // Deliberately swallowed -- see the docstring above.
  }
}
