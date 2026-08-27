import type { GardenPath } from '../../filesystem/GardenFileSystem'
import { parseGardenDocument } from '../document/gardenDocument'
import {
  validateGardenItem,
  type GardenItem,
  type ValidationProblem,
} from '../schema/gardenItem'
import { deriveGardenRevision, type GardenRevision } from './gardenRevision'

/**
 * The Garden Index: a rebuildable in-memory projection of canonical Markdown.
 *
 * ADR 0050 makes this derived state and nothing more -- it supports the Tree,
 * search, and validation, but the files remain the system of record. Building
 * it is therefore a pure function of the scanned files, with no filesystem
 * access of its own, so the same inputs always produce the same index and the
 * same Garden Revision.
 */

export interface ScannedFile {
  readonly path: GardenPath
  readonly text: string
}

export interface IndexedItem {
  readonly item: GardenItem
  readonly path: GardenPath
  readonly body: string
  readonly childIds: readonly string[]
}

/**
 * A Garden Diagnostic: a noncanonical validation finding about a Garden file.
 *
 * ADR 0052 keeps the affected item visible and lets unrelated valid items load.
 * Ticket 05 surfaces these in the interface, exposes them to auditing, and
 * blocks mutations against the items they name.
 */
export interface GardenDiagnostic {
  readonly path: GardenPath
  readonly problems: readonly ValidationProblem[]
}

export interface GardenIndex {
  readonly items: ReadonlyMap<string, IndexedItem>
  /** Items with no parent placement, in Tree order. */
  readonly topLevelIds: readonly string[]
  readonly diagnostics: readonly GardenDiagnostic[]
  readonly revision: GardenRevision
}

interface Accepted {
  readonly item: GardenItem
  readonly path: GardenPath
  readonly body: string
}

export async function buildGardenIndex(files: readonly ScannedFile[]): Promise<GardenIndex> {
  const accepted: Accepted[] = []
  const diagnostics: GardenDiagnostic[] = []
  const claimedIds = new Map<string, GardenPath>()

  for (const file of files) {
    const parsed = parseGardenDocument(file.text)
    if (!parsed.ok) {
      diagnostics.push({
        path: file.path,
        problems: [{ field: 'frontmatter', message: parsed.error.message }],
      })
      continue
    }

    const validated = validateGardenItem(parsed.document.frontmatter)
    if (!validated.ok) {
      diagnostics.push({ path: file.path, problems: validated.problems })
      continue
    }

    // Two files claiming one identity is a conflict, not a silent last-wins:
    // relationships address items by id, so the ambiguity has to be visible.
    const alreadyClaimed = claimedIds.get(validated.item.id)
    if (alreadyClaimed) {
      diagnostics.push({
        path: file.path,
        problems: [
          { field: 'id', message: `duplicates the id already used by ${alreadyClaimed.join('/')}` },
        ],
      })
      continue
    }

    claimedIds.set(validated.item.id, file.path)
    accepted.push({ item: validated.item, path: file.path, body: parsed.document.body })
  }

  // Title order gives the Tree a stable shape between opens without letting
  // filesystem enumeration order leak into what a person sees.
  const byTitle = [...accepted].sort((a, b) => a.item.title.localeCompare(b.item.title))
  const childIdsByParent = new Map<string, string[]>()
  const topLevelIds: string[] = []

  for (const entry of byTitle) {
    const parentId = entry.item.parentId

    if (parentId === undefined) {
      topLevelIds.push(entry.item.id)
      continue
    }

    if (!claimedIds.has(parentId)) {
      // The Tree must still be able to show the item, so it is placed at the top
      // level and the broken relationship is reported rather than dropped.
      diagnostics.push({
        path: entry.path,
        problems: [{ field: 'parent_id', message: 'names an item that is not in this Garden' }],
      })
      topLevelIds.push(entry.item.id)
      continue
    }

    const siblings = childIdsByParent.get(parentId) ?? []
    siblings.push(entry.item.id)
    childIdsByParent.set(parentId, siblings)
  }

  const items = new Map<string, IndexedItem>(
    byTitle.map((entry) => [
      entry.item.id,
      {
        item: entry.item,
        path: entry.path,
        body: entry.body,
        childIds: childIdsByParent.get(entry.item.id) ?? [],
      },
    ]),
  )

  return {
    items,
    topLevelIds,
    diagnostics,
    // Every scanned file counts, including invalid ones: fixing a broken file
    // must move the revision so held results are known to be out of date.
    revision: await deriveGardenRevision(files),
  }
}
