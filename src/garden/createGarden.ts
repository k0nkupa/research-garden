import {
  GardenFileSystemError,
  type GardenFileSystem,
  type GardenPath,
} from '../filesystem/GardenFileSystem'
import { serializeNewGardenDocument } from '../domain/document/gardenDocument'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { CANONICAL_FIELD_ORDER } from '../domain/schema/gardenItem'
import {
  CANONICAL_DIRECTORIES,
  OPERATIONAL_DIRECTORY,
  directoryForKind,
  fileNameFor,
} from '../domain/schema/itemIdentity'
import { createItemIdFactory, type UlidEntropy } from '../domain/schema/ulid'
import { openGarden, type OpenGardenResult } from './openGarden'
import { sampleGardenDrafts, type SampleItem } from './sampleGarden'

/**
 * Create Garden.
 *
 * ADR 0006: every Garden is a folder the person selected, and creating one
 * writes real files into it. The refusal below is the important part -- a
 * folder that already holds a Garden is left completely untouched, because the
 * one thing this action must never do is overwrite research someone already
 * has.
 *
 * Only canonical Markdown counts as conflicting. A folder that happens to
 * contain a PDF or a README is fine: nothing Research Garden writes would
 * collide with it, and refusing would be officious.
 */

export type CreateGardenResult =
  | { readonly kind: 'created'; readonly result: OpenGardenResult }
  /** The folder already holds a Garden. Nothing was written. */
  | { readonly kind: 'conflicting'; readonly found: readonly string[] }
  | { readonly kind: 'permission-required'; readonly repositoryName: string }
  | { readonly kind: 'failed'; readonly message: string }

export interface CreateGardenOptions {
  readonly entropy?: UlidEntropy
  /** Injected so a created Garden is deterministic under test (ADR 0077). */
  readonly now?: () => string
}

/**
 * Whatever would make this folder already a Garden, as readable paths.
 *
 * Canonical Markdown counts, and so does anything under the operational
 * directory, because that only exists where Research Garden has been before.
 * A PDF sitting in `roots/` does not: nothing written here would collide with
 * it, and refusing would be officious.
 */
async function existingGardenContent(
  fileSystem: GardenFileSystem,
): Promise<readonly string[]> {
  const found: string[] = []

  for (const directory of CANONICAL_DIRECTORIES) {
    const paths = await fileSystem.listFiles([directory])
    found.push(
      ...paths.filter((path) => path.at(-1)?.endsWith('.md')).map((path) => path.join('/')),
    )
  }

  const operational = await fileSystem.listFiles([OPERATIONAL_DIRECTORY])
  found.push(...operational.map((path) => path.join('/')))

  return found
}

/**
 * Places each item in its typed directory under a readable filename.
 *
 * ADR 0034: the filename is a title slug, and gains a short identity suffix
 * only when two titles in one directory would otherwise collide. The names
 * already taken are tracked per directory as the Garden is written, so the
 * suffix appears exactly when it is needed and not before.
 *
 * Exported so the collision behaviour can be exercised through the writer,
 * rather than only on the naming function in isolation.
 */
export function planFiles(
  items: readonly SampleItem[],
): readonly { path: GardenPath; text: string }[] {
  const takenByDirectory = new Map<string, Set<string>>()

  return items.map((item) => {
    const directory = directoryForKind(item.kind)
    const taken = takenByDirectory.get(directory) ?? new Set<string>()

    const fileName = fileNameFor(item, taken)
    taken.add(fileName)
    takenByDirectory.set(directory, taken)

    return {
      path: [directory, fileName],
      text: serializeNewGardenDocument(item.frontmatter, item.body, CANONICAL_FIELD_ORDER),
    }
  })
}

export async function createGarden(
  fileSystem: GardenFileSystem,
  options: CreateGardenOptions = {},
): Promise<CreateGardenResult> {
  const repositoryName = fileSystem.repositoryName

  try {
    if ((await fileSystem.permission()) !== 'granted') {
      return { kind: 'permission-required', repositoryName }
    }

    const existing = await existingGardenContent(fileSystem)
    if (existing.length > 0) {
      // Nothing has been written at this point, and nothing will be.
      return { kind: 'conflicting', found: existing }
    }

    const items = await sampleGardenDrafts({
      nextId: createItemIdFactory(options.entropy),
      now: options.now ?? nowAsCanonicalTimestamp,
    })

    const planned = planFiles(items)
    let written = 0
    try {
      for (const file of planned) {
        await fileSystem.write(file.path, file.text)
        written += 1
      }
    } catch (error) {
      // The browser filesystem offers no transaction, so a Garden can be left
      // part-written. Saying so is the honest thing: the folder is no longer
      // empty, and Open Garden is now the way back into it.
      if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
        return { kind: 'permission-required', repositoryName }
      }
      return {
        kind: 'failed',
        message:
          written === 0
            ? 'Nothing could be written to that folder, so no Garden was created.'
            : `Writing stopped after ${written} of ${planned.length} files, so that folder now holds a part-written Garden. Open it to see what is there.`,
      }
    }

    // Read back rather than trusting what was written: the Tree a person sees
    // is grown from the files on their disk (ADR 0055).
    const opened = await openGarden(fileSystem)
    if (opened.kind === 'opened' && opened.garden.index.diagnostics.length > 0) {
      return {
        kind: 'failed',
        message:
          'The Garden was written but did not read back cleanly, so it may be incomplete. Open the folder to see what needs attention.',
      }
    }

    return { kind: 'created', result: opened }
  } catch (error) {
    if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
      return { kind: 'permission-required', repositoryName }
    }

    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'The Garden could not be created.',
    }
  }
}
