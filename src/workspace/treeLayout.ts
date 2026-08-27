import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import type { GardenIndex } from '../domain/index/gardenIndex'
import type { GardenItemKind } from '../domain/schema/gardenItem'

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

export interface TreeViewBox {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

export interface TreeLayout {
  readonly nodes: readonly TreeNode[]
  readonly links: readonly TreeLink[]
  readonly viewBox: TreeViewBox
}

/** Horizontal room per sibling and vertical room per generation, in SVG units. */
const SIBLING_SPACING = 180
const GENERATION_SPACING = 120
const MARGIN = 80

/** The implicit trunk holding top-level Branches (ADR 0014). Never an item. */
const TRUNK = Symbol('implicit-trunk')

interface LayoutSubject {
  readonly id: string | typeof TRUNK
  readonly title: string
  readonly kind: GardenItemKind | undefined
  readonly childIds: readonly string[]
}

export function computeTreeLayout(index: GardenIndex): TreeLayout {
  const subjectFor = (id: string): LayoutSubject => {
    const indexed = index.items.get(id)
    return {
      id,
      title: indexed?.item.title ?? id,
      kind: indexed?.item.kind,
      childIds: indexed?.childIds ?? [],
    }
  }

  const root = hierarchy<LayoutSubject>(
    { id: TRUNK, title: 'Garden', kind: undefined, childIds: index.topLevelIds },
    (subject) => subject.childIds.map(subjectFor),
  )

  const positioned = tree<LayoutSubject>()
    .nodeSize([SIBLING_SPACING, GENERATION_SPACING])
    .separation(() => 1)(root)

  const placed = positioned.descendants().filter((node) => node.data.id !== TRUNK)

  const nodes: TreeNode[] = placed.map((node) => ({
    id: node.data.id as string,
    title: node.data.title,
    kind: node.data.kind ?? 'branch',
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

  return { nodes, links, viewBox: viewBoxAround(nodes) }
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
