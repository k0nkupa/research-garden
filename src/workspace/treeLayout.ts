import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import type { GardenIndex } from '../domain/index/gardenIndex'
import type { GardenItemKind } from '../domain/schema/gardenItem'
import type { RelationType } from '../domain/schema/relations'

/**
 * Geometry for the Tree.
 *
 * ADR 0049 confines the hierarchy library to exactly this: it computes
 * positions and paths and nothing else. It holds no application state, decides
 * no interaction, and never touches the DOM. The Tree component reads this
 * result and draws its own accessible SVG, which is what keeps the botanical
 * structure ours rather than a generic graph editor's.
 */

export interface TreeNode {
  readonly id: string
  readonly title: string
  readonly kind: GardenItemKind
  readonly depth: number
  readonly x: number
  readonly y: number
}

export interface TreeLink {
  readonly sourceId: string
  readonly targetId: string
  readonly path: string
}

/**
 * A relationship drawn outside an item's primary placement.
 *
 * CONTEXT.md defines a Cross-link as an explicit relationship between items
 * outside their placement in the Tree, which is every relationship that is not
 * Parent. Drawing them is what lets the Tree stay a legible one-parent
 * projection while the graph underneath stays truthful (ADR 0008).
 */
export interface TreeCrossLink {
  readonly type: RelationType
  readonly sourceId: string
  readonly targetId: string
  readonly path: string
}

export interface TreeViewBox {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

export interface TreeLayout {
  readonly nodes: readonly TreeNode[]
  readonly links: readonly TreeLink[]
  readonly crossLinks: readonly TreeCrossLink[]
  readonly viewBox: TreeViewBox
}

/** Horizontal room per sibling and vertical room per generation, in SVG units. */
const SIBLING_SPACING = 180
const GENERATION_SPACING = 120

/**
 * Room around the Tree for labels, which extend either side of their node.
 * Sized from the widest a label can be, so an outermost node's text is never
 * clipped by the viewBox.
 */
const MARGIN = 110

/**
 * A label is truncated to fit the room between siblings.
 *
 * ADR 0044 makes the text label one of the carriers of meaning, and ADR 0043
 * asks for labels that stay immediately scannable -- overlapping titles satisfy
 * neither. The full title is still the node's accessible name, so nothing is
 * lost to anyone reading the Tree as text.
 */
const MAXIMUM_LABEL_CHARACTERS = 22

export function displayLabel(title: string): string {
  if (title.length <= MAXIMUM_LABEL_CHARACTERS) return title

  // Trim back to a word boundary anywhere in the latter half, so the ellipsis
  // does not land mid-word while still keeping most of the title.
  const clipped = title.slice(0, MAXIMUM_LABEL_CHARACTERS - 1)
  const lastSpace = clipped.lastIndexOf(' ')
  const stem =
    lastSpace >= Math.floor(MAXIMUM_LABEL_CHARACTERS / 2) ? clipped.slice(0, lastSpace) : clipped

  return `${stem.trimEnd()}\u2026`
}

/** The implicit trunk holding top-level Branches (ADR 0014). Never an item. */
const TRUNK = Symbol('implicit-trunk')

interface LayoutSubject {
  readonly id: string | typeof TRUNK
  readonly title: string
  /** Absent only for the implicit trunk, which is never drawn as an item. */
  readonly kind: GardenItemKind | undefined
  readonly childIds: readonly string[]
}

export function computeTreeLayout(index: GardenIndex): TreeLayout {
  // Only ids the index actually holds become subjects. An id that resolved to
  // nothing would otherwise have to be drawn as some kind, and drawing it as
  // the wrong one is worse than not drawing it (ADR 0052).
  const subjectsFor = (ids: readonly string[]): LayoutSubject[] =>
    ids.flatMap((id) => {
      const indexed = index.items.get(id)
      if (!indexed) return []
      return [
        {
          id,
          title: indexed.item.title,
          kind: indexed.item.kind,
          childIds: indexed.childIds,
        },
      ]
    })

  const root = hierarchy<LayoutSubject>(
    { id: TRUNK, title: 'Garden', kind: undefined, childIds: index.topLevelIds },
    (subject) => subjectsFor(subject.childIds),
  )

  const positioned = tree<LayoutSubject>()
    .nodeSize([SIBLING_SPACING, GENERATION_SPACING])
    .separation(() => 1)(root)

  const placed = positioned.descendants().filter((node) => node.data.id !== TRUNK)

  const nodes: TreeNode[] = placed.map((node) => ({
    id: node.data.id as string,
    title: node.data.title,
    // Every drawn node came from the index, so its kind is known.
    kind: node.data.kind as GardenItemKind,
    // The synthetic trunk occupies depth 0, so a top-level item reads as depth 1.
    depth: node.depth,
    x: node.x,
    y: node.y,
  }))

  const links: TreeLink[] = positioned
    .links()
    // A top-level item hangs from the implicit trunk, which is not drawn, so the
    // edge to it is not drawn either.
    .filter((link) => link.source.data.id !== TRUNK)
    .map((link) => ({
      sourceId: link.source.data.id as string,
      targetId: link.target.data.id as string,
      path: verticalPath(link.source, link.target),
    }))

  const placedById = new Map(nodes.map((node) => [node.id, node]))

  const crossLinks: TreeCrossLink[] = index.graph.relationships
    .filter((relationship) => relationship.type !== 'parent')
    .flatMap((relationship) => {
      const source = placedById.get(relationship.sourceId)
      const target = placedById.get(relationship.targetId)
      if (!source || !target) return []

      return [
        {
          type: relationship.type,
          sourceId: relationship.sourceId,
          targetId: relationship.targetId,
          path: bowedPath(source, target),
        },
      ]
    })

  return { nodes, links, crossLinks, viewBox: viewBoxAround(nodes) }
}

/**
 * A curve bowed away from the straight line between two nodes.
 *
 * Cross-links frequently join nodes that sit far apart or on the same row, and
 * a straight chord between siblings would disappear into their own limbs. The
 * bow scales with distance so short links stay gentle and long ones stay
 * distinguishable from the Tree's own structure.
 */
function bowedPath(source: TreeNode, target: TreeNode): string {
  const midX = (source.x + target.x) / 2
  const midY = (source.y + target.y) / 2
  const span = Math.hypot(target.x - source.x, target.y - source.y)
  const bow = Math.min(span / 4, 90)

  return `M${source.x},${source.y} Q${midX},${midY + bow} ${target.x},${target.y}`
}

/** A smooth vertical join, so limbs read as growth rather than as a flowchart. */
function verticalPath(
  source: HierarchyPointNode<LayoutSubject>,
  target: HierarchyPointNode<LayoutSubject>,
): string {
  const midway = (source.y + target.y) / 2
  return `M${source.x},${source.y} C${source.x},${midway} ${target.x},${midway} ${target.x},${target.y}`
}

/**
 * A box just large enough to hold the Tree.
 *
 * The Tree is drawn at natural size rather than stretched to the pane, so a
 * label is the same size in a three-item Garden as in a thousand-item one. That
 * is what makes this box tight to the content: scaling it to fit would make
 * type size a function of how much research a person has done. Deliberate pan
 * and zoom is ticket 08.
 */
function viewBoxAround(nodes: readonly TreeNode[]): TreeViewBox {
  if (nodes.length === 0) {
    return { minX: -MARGIN, minY: -MARGIN, width: MARGIN * 2, height: MARGIN * 2 }
  }

  const xs = nodes.map((node) => node.x)
  const ys = nodes.map((node) => node.y)
  const minX = Math.min(...xs) - MARGIN
  const minY = Math.min(...ys) - MARGIN

  return {
    minX,
    minY,
    width: Math.max(...xs) + MARGIN - minX,
    height: Math.max(...ys) + MARGIN - minY,
  }
}
