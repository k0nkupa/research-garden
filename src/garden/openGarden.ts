import {
  GardenFileSystemError,
  type GardenFileSystem,
  type GardenPath,
} from '../filesystem/GardenFileSystem'
import { buildGardenIndex, type GardenIndex, type ScannedFile } from '../domain/index/gardenIndex'

/**
 * The Garden Action layer.
 *
 * ADR 0003 requires the human interface and the WebMCP tools to operate on the
 * same underlying behaviour. That means actions live here, and both surfaces
 * call them; neither reimplements one. Actions return described outcomes rather
 * than throwing, so a surface never has to invent its own error handling and an
 * unsupported or unpermitted state can never half-execute.
 */

/** ADR 0011: canonical Markdown is organized by botanical type. */
export const CANONICAL_DIRECTORIES: readonly string[] = [
  'seeds',
  'roots',
  'branches',
  'leaves',
  'harvests',
]

export interface OpenedGarden {
  readonly repositoryName: string
  readonly index: GardenIndex
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
 */
export async function openGarden(fileSystem: GardenFileSystem): Promise<OpenGardenResult> {
  const repositoryName = fileSystem.repositoryName

  try {
    if ((await fileSystem.permission()) !== 'granted') {
      return { kind: 'permission-required', repositoryName }
    }

    const scanned: ScannedFile[] = []
    for (const directory of CANONICAL_DIRECTORIES) {
      const paths = await fileSystem.listFiles([directory])
      for (const path of paths.filter(isMarkdown)) {
        scanned.push({ path, text: await fileSystem.read(path) })
      }
    }

    return { kind: 'opened', garden: { repositoryName, index: await buildGardenIndex(scanned) } }
  } catch (error) {
    // Permission can lapse between the check above and any read that follows, so
    // the recoverable case is recognised wherever it surfaces rather than only
    // up front.
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required', repositoryName }
    }

    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'The folder could not be read.',
    }
  }
}
