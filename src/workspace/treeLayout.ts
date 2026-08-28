import { hierarchy, tree } from 'd3-hierarchy'
import type { GardenIndex } from '../domain/index/gardenIndex'
import type { GardenItemKind } from '../domain/schema/gardenItem'
import type { RelationType } from '../domain/schema/relations'
import { UNFOCUSED, visibleTreeRows, type TreeRow, type TreeViewState } from './treeView'

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
  /** ADR 0031: a Dormant Branch recedes without leaving the Tree. */
  readonly dormant: boolean
  readonly hasChildren: boolean
  readonly expanded: boolean
}

export interface TreeLink {
  /** Absent when the limb springs from the trunk rather than from an item. */
  readonly sourceId: string | undefined
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

/**
 * The trunk the whole Garden grows from, and the soil line it grows through.
 *
 * ADR 0043 asks the Tree to stay recognizably botanical while knowledge nodes
 * dominate, and ADR 0028 already puts Seeds and Roots in their own stratum.
 * Drawing the soil line makes that separation something a person can see:
 * evidence is what the Garden is rooted in, and it sits below ground, while
 * everything grown from it rises above.
 */
export interface TreeTrunk {
  /** The trunk itself, from the root flare up to where the limbs begin. */
  readonly path: string
  /** The spreading roots below the soil line. */
  readonly rootPaths: readonly string[]
  readonly soilY: number
  readonly soilFrom: number
  readonly soilTo: number
}

export interface TreeLayout {
  readonly nodes: readonly TreeNode[]
  readonly links: readonly TreeLink[]
  readonly crossLinks: readonly TreeCrossLink[]
  readonly trunk: TreeTrunk
  readonly viewBox: TreeViewBox
}

/** Horizontal room per sibling and vertical room per generation, in SVG units. */
const SIBLING_SPACING = 180
const GENERATION_SPACING = 120

/** The soil line sits at the origin; everything else is measured from it. */
const SOIL_Y = 0

/** How far the first canopy generation clears the soil, leaving room for a trunk. */
const TRUNK_HEIGHT = 150

/** How far the first buried generation hangs below it. */
const ROOT_DROP = 130

/**
 * Which stratum a kind belongs to.
 *
 * ADR 0028 gives Seeds and Roots strata of their own -- plural -- and takes no
 * Tree parent for either, so evidence can support knowledge across Branches
 * without belonging to one. Here that becomes literal: a Seed is the original
 * capture and sits just under the surface, evidence lies deeper still, and
 * everything grown from them rises above the soil.
 */
function isBuried(kind: GardenItemKind): boolean {
  return kind === 'root' || kind === 'seed'
}

/** A Seed rests near the surface; evidence is what the Garden reaches down to. */
const SEED_DEPTH = 62

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

/**
 * Only what the current view is showing reaches the layout.
 *
 * This is where ADR 0061's promise that collapse and focus bound the drawn Tree
 * is actually kept: a folded Branch's descendants are never laid out, never
 * measured, and never emitted, so the SVG shrinks rather than merely hiding
 * things.
 */
export function computeTreeLayout(
  index: GardenIndex,
  view: TreeViewState = UNFOCUSED,
  /** Passed in when the caller already has them, so the Tree is walked once. */
  rows: readonly TreeRow[] = visibleTreeRows(index, view),
): TreeLayout {
  const shown = new Map(rows.map((row) => [row.id, row]))

  // Only rows the view is showing become subjects. An id that resolved to
  // nothing would otherwise have to be drawn as some kind, and drawing it as
  // the wrong one is worse than not drawing it (ADR 0052).
  const subjectsFor = (ids: readonly string[]): LayoutSubject[] =>
    ids.flatMap((id) => {
      const row = shown.get(id)
      const indexed = index.items.get(id)
      if (!row || !indexed) return []
      return [
        {
          id,
          title: row.title,
          kind: row.kind,
          // A collapsed Branch contributes no descendants to the drawing.
          childIds: row.expanded ? indexed.childIds : [],
        },
      ]
    })

  const topLevel = rows.filter((row) => row.depth === 1)

  /**
   * Each stratum is laid out on its own, then moved into place: the canopy
   * rises from the trunk and the evidence hangs beneath it. Running one tree
   * over both would put Roots among the Leaves.
   */
  const layOut = (rootIds: readonly string[]) => {
    const root = hierarchy<LayoutSubject>(
      { id: TRUNK, title: 'Garden', kind: undefined, childIds: rootIds },
      (subject) => subjectsFor(subject.childIds),
    )

    const positioned = tree<LayoutSubject>()
      .nodeSize([SIBLING_SPACING, GENERATION_SPACING])
      .separation(() => 1)(root)

    return positioned
  }

  const canopy = layOut(topLevel.filter((row) => !isBuried(row.kind)).map((row) => row.id))
  const understory = layOut(topLevel.filter((row) => isBuried(row.kind)).map((row) => row.id))

  /** Depth 1 lands one trunk-height above the soil, and grows upward from there. */
  const canopyY = (depth: number) => SOIL_Y - TRUNK_HEIGHT - (depth - 1) * GENERATION_SPACING
  /** Depth 1 lands one drop below the soil, and hangs further down from there. */
  const understoryY = (depth: number) => SOIL_Y + ROOT_DROP + (depth - 1) * GENERATION_SPACING

  const placedIn = (
    positioned: ReturnType<typeof layOut>,
    yFor: (depth: number) => number,
  ): TreeNode[] =>
    positioned
      .descendants()
      .filter((node) => node.data.id !== TRUNK)
      .map((node) => {
        const row = shown.get(node.data.id as string)

        return {
          id: node.data.id as string,
          title: node.data.title,
          // Every drawn node came from the index, so its kind is known.
          kind: node.data.kind as GardenItemKind,
          // The synthetic trunk occupies depth 0, so a top-level item reads as depth 1.
          depth: node.depth,
          x: node.x,
          y: node.data.kind === 'seed' ? SOIL_Y + SEED_DEPTH : yFor(node.depth),
          dormant: row?.dormant ?? false,
          hasChildren: row?.hasChildren ?? false,
          expanded: row?.expanded ?? false,
        }
      })

  const nodes: TreeNode[] = [...placedIn(canopy, canopyY), ...placedIn(understory, understoryY)]
  const positionOf = new Map(nodes.map((node) => [node.id, node]))

  const linksIn = (positioned: ReturnType<typeof layOut>): TreeLink[] =>
    positioned
      .links()
      // A top-level item hangs from the implicit trunk, which is drawn as the
      // trunk itself rather than as an edge.
      .filter((link) => link.source.data.id !== TRUNK)
      .flatMap((link) => {
        const source = positionOf.get(link.source.data.id as string)
        const target = positionOf.get(link.target.data.id as string)
        if (!source || !target) return []

        return [
          {
            sourceId: source.id,
            targetId: target.id,
            path: verticalPath(source, target),
          },
        ]
      })

  const links: TreeLink[] = [...linksIn(canopy), ...linksIn(understory)]

  // Limbs from the trunk out to whatever stands directly on it.
  for (const row of topLevel) {
    const node = positionOf.get(row.id)
    if (!node) continue

    const fromTrunk = { x: 0, y: isBuried(row.kind) ? SOIL_Y : SOIL_Y - TRUNK_HEIGHT }

    links.push({ sourceId: undefined, targetId: node.id, path: verticalPath(fromTrunk, node) })
  }

  const crossLinks: TreeCrossLink[] = index.graph.relationships
    .filter((relationship) => relationship.type !== 'parent')
    .flatMap((relationship) => {
      // A Cross-link to something the view has folded away is not drawn: it
      // would have nowhere to land.
      const source = positionOf.get(relationship.sourceId)
      const target = positionOf.get(relationship.targetId)
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

  const trunk = trunkFor(nodes)

  return { nodes, links, crossLinks, trunk, viewBox: viewBoxAround(nodes, trunk) }
}

/**
 * The trunk, its root flare, and the soil line.
 *
 * Sized from what is actually drawn so the soil always spans the Garden and the
 * roots always reach the deepest evidence -- ADR 0043 wants a recognizable
 * botanical form, not a fixed decoration pasted behind the work.
 */
function trunkFor(nodes: readonly TreeNode[]): TreeTrunk {
  const xs = nodes.map((node) => node.x)
  const buried = nodes.filter((node) => node.y > SOIL_Y)

  const soilFrom = Math.min(-SIBLING_SPACING, ...xs) - SIBLING_SPACING / 2
  const soilTo = Math.max(SIBLING_SPACING, ...xs) + SIBLING_SPACING / 2
  const deepest = buried.length === 0 ? SOIL_Y + ROOT_DROP : Math.max(...buried.map((n) => n.y))

  return {
    // Stops short of the first canopy generation so the trunk never runs
    // through a Branch's glyph or its label.
    path: `M0,${SOIL_Y + 18} L0,${SOIL_Y - TRUNK_HEIGHT + 30}`,
    /*
     * Fine rootlets, kept deliberately short. The limbs down to the evidence
     * are the real root system; these only suggest the rest of it. Drawing
     * them as far as the nodes would duplicate those limbs, which is precisely
     * the decoration ADR 0043 asks to reduce.
     */
    rootPaths: [-1, -0.4, 0.4, 1].map((spread) => {
      const toX = spread * SIBLING_SPACING * 0.55
      const toY = SOIL_Y + (deepest - SOIL_Y) * 0.4
      return `M0,${SOIL_Y} C${toX * 0.2},${SOIL_Y + 26} ${toX * 0.65},${toY * 0.7} ${toX},${toY}`
    }),
    soilY: SOIL_Y,
    soilFrom,
    soilTo,
  }
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

interface Point {
  readonly x: number
  readonly y: number
}

/** A smooth vertical join, so limbs read as growth rather than as a flowchart. */
function verticalPath(source: Point, target: Point): string {
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
function viewBoxAround(nodes: readonly TreeNode[], trunk: TreeTrunk): TreeViewBox {
  // The trunk and soil line are drawn whether or not anything grows on them, so
  // an empty Garden still shows the bare Tree it will grow from (ADR 0046).
  const xs = [...nodes.map((node) => node.x), trunk.soilFrom, trunk.soilTo]
  const ys = [
    ...nodes.map((node) => node.y),
    trunk.soilY,
    trunk.soilY - TRUNK_HEIGHT,
    trunk.soilY + ROOT_DROP,
  ]

  const minX = Math.min(...xs) - MARGIN
  const minY = Math.min(...ys) - MARGIN

  return {
    minX,
    minY,
    width: Math.max(...xs) + MARGIN - minX,
    height: Math.max(...ys) + MARGIN - minY,
  }
}
