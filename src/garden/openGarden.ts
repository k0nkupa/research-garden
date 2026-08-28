import {
  GardenFileSystemError,
  type GardenFileSystem,
  type GardenPath,
} from '../filesystem/GardenFileSystem'
import { scanGardenWithCache, type GardenIndex, type ScannedFile } from '../domain/index/gardenIndex'
import { CANONICAL_DIRECTORIES } from '../domain/schema/itemIdentity'
import { readIndexCache, writeIndexCache } from './indexCacheStore'

/**
 * The Garden Action layer.
 *
 * ADR 0003 requires the human interface and the WebMCP tools to operate on the
 * same underlying behaviour. That means actions live here, and both surfaces
 * call them; neither reimplements one. Actions return described outcomes rather
 * than throwing, so a surface never has to invent its own error handling and an
 * unsupported or unpermitted state can never half-execute.
 */

export interface OpenedGarden {
  readonly repositoryName: string
  readonly index: GardenIndex
  /**
   * The folder this Garden was read from.
   *
   * Carried so Attachments can be read out of it on demand (ADR 0057). The
   * index itself stays free of the filesystem.
   */
  readonly fileSystem: GardenFileSystem
}

export type OpenGardenResult =
  | { readonly kind: 'opened'; readonly garden: OpenedGarden }
  /** Recoverable: the person can re-grant access and try again. */
  | { readonly kind: 'permission-required'; readonly repositoryName: string }
  | { readonly kind: 'failed'; readonly message: string }

function isMarkdown(path: GardenPath): boolean {
  return path.at(-1)?.endsWith('.md') ?? false
}

/**
 * Scans a Garden Repository into a Garden Index.
 *
 * Only the typed canonical directories are read. The operational directory is
 * never scanned as knowledge: Pending Changes, Undo Snapshots, and the Index
 * Cache are operational records and do not become canonical merely by living
 * beside it (ADR 0026, ADR 0050).
 *
 * This is also the entire rescan operation (ADR 0053, ticket 13): a rescan is
 * calling this again on the same folder, at window focus, on Refresh, or
 * immediately before a mutation -- never on a timer. There is deliberately no
 * separate "rescan" function; one scanning path is what keeps the first open
 * and every later rescan from being able to drift apart.
 *
 * An Index Cache (ticket 15, ADR 0062), if one is present and verifies, lets
 * a large Garden skip reparsing and revalidating files that have not
 * changed since the last open. It is read before scanning and a fresh one is
 * written after -- both best-effort: a cache that fails to read is treated
 * as absent (an uncertain manifest invalidates the whole cache, and this is
 * simplest way to guarantee that), and a cache that fails to write never
 * fails an open that already succeeded (ADR 0050: it is derived state, never
 * a competing authority, so its own persistence is never load-bearing).
 */
export async function openGarden(fileSystem: GardenFileSystem): Promise<OpenGardenResult> {
  const repositoryName = fileSystem.repositoryName

  try {
    if ((await fileSystem.permission()) !== 'granted') {
      return { kind: 'permission-required', repositoryName }
    }

    const cache = await readIndexCache(fileSystem)

    const scanned: ScannedFile[] = []
    for (const directory of CANONICAL_DIRECTORIES) {
      const paths = await fileSystem.listFiles([directory])
      for (const path of paths.filter(isMarkdown)) {
        scanned.push({ path, text: await fileSystem.read(path) })
      }
    }

    const scan = await scanGardenWithCache(scanned, cache.entries)
    await writeIndexCache(fileSystem, scan.cache)

    return {
      kind: 'opened',
      garden: { repositoryName, fileSystem, index: scan.index },
    }
  } catch (error) {
    // Permission can lapse between the check above and any read that follows, so
    // the recoverable case is recognised wherever it surfaces rather than only
    // up front.
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required', repositoryName }
    }

    // A folder that has been moved or deleted since it was remembered is worth
    // saying plainly, rather than reporting whatever the browser called it.
    if (error instanceof GardenFileSystemError && error.code === 'not-found') {
      return {
        kind: 'failed',
        message: `${repositoryName} could not be found. It may have been moved, renamed, or deleted.`,
      }
    }

    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'The folder could not be read.',
    }
  }
}
