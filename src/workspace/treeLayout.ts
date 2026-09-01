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
  /** The target's depth, so strokes can taper as the Tree grows outward. */
  readonly depth: number
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
  /** A fine inner stroke that gives the permanent trunk its engraved grain. */
  readonly detailPath: string
  /**
   * A filled, tapering body that gives the trunk its silhouette.
   *
   * The stroke paths alone read as a wire; a body that widens toward the soil
   * reads as a growing thing. ADR 0043 wants a recognizable botanical form,
   * and the taper is the part that makes the difference between a line and a
   * trunk. Decorative, so it is kept out of the accessible structure.
   */
  readonly bodyPath: string
  /** A filled flare where the trunk meets the soil, spreading into the roots. */
  readonly flarePath: string
  /** The spreading roots below the soil line. */
  readonly rootPaths: readonly string[]
  /** Fine root hairs, derived alongside the spreading roots. */
  readonly rootHairPaths: readonly string[]
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

export type TreeProjection = 'default' | 'overview' | 'nested'

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
  projection: TreeProjection = 'default',
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

  const overviewOffsets = [-26, 18, 34, -14, 28]
  const overviewLifts = [42, 108, 62, 132, 78]

  const overviewPosition = (nodeId: string, baseX: number, fallbackY: number): Point => {
    const position = topLevel.findIndex((row) => row.id === nodeId)
    if (position < 0) return { x: baseX, y: fallbackY }
    return {
      x: baseX + (overviewOffsets[position % overviewOffsets.length] ?? 0),
      y: fallbackY - (overviewLifts[position % overviewLifts.length] ?? 0),
    }
  }

  const nestedPosition = (nodeId: string, baseX: number, baseY: number, depth: number): Point => {
    if (projection !== 'nested' || depth < 2) return { x: baseX, y: baseY }
    const seed = stableGeometrySeed(nodeId)
    const sway = ((seed % 1000) / 1000 - 0.5) * 54
    const lift = 12 + ((seed >>> 9) % 4) * 9
    return { x: baseX + sway, y: baseY - lift }
  }

  const placedIn = (
    positioned: ReturnType<typeof layOut>,
    yFor: (depth: number) => number,
  ): TreeNode[] =>
    positioned
      .descendants()
      .filter((node) => node.data.id !== TRUNK)
      .map((node) => {
        const row = shown.get(node.data.id as string)
        const overview = projection === 'overview' && node.depth === 1
          ? overviewPosition(node.data.id as string, node.x, yFor(node.depth))
          : undefined
        const nested = nestedPosition(node.data.id as string, node.x, yFor(node.depth), node.depth)

        return {
          id: node.data.id as string,
          title: node.data.title,
          // Every drawn node came from the index, so its kind is known.
          kind: node.data.kind as GardenItemKind,
          // The synthetic trunk occupies depth 0, so a top-level item reads as depth 1.
          depth: node.depth,
          x: overview?.x ?? nested.x,
          y: node.data.kind === 'seed' ? SOIL_Y + SEED_DEPTH : overview?.y ?? nested.y,
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
            depth: target.depth,
            path: projection === 'nested' ? nestedLimbPath(source, target) : verticalPath(source, target, true),
          },
        ]
      })

  const links: TreeLink[] = [...linksIn(canopy), ...linksIn(understory)]

  // Limbs from the trunk out to whatever stands directly on it. The seam stays
  // on the trunk itself, so the source is never pulled back to a glyph edge.
  for (const row of topLevel) {
    const node = positionOf.get(row.id)
    if (!node) continue

    const fromTrunk = { x: 0, y: isBuried(row.kind) ? SOIL_Y : SOIL_Y - TRUNK_HEIGHT }
    const topLevelPosition = topLevel.findIndex((candidate) => candidate.id === row.id)

    links.push({
      sourceId: undefined,
      targetId: node.id,
      depth: node.depth,
      path:
        projection === 'overview' && !isBuried(row.kind)
          ? overviewLimbPath(fromTrunk, node, topLevelPosition)
          : verticalPath(fromTrunk, node, false),
    })
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
 * Overview limbs are deliberately more organic than the focused Tree's
 * analytical joins. Each one leaves the crown with a different sweep and
 * arrives at a different height, so the map reads as a living canopy rather
 * than a row of identical branches.
 */
function overviewLimbPath(from: Point, target: TreeNode, position: number): string {
  const bends = [-54, 38, 72, -34, 58]
  const rises = [42, 76, 58, 92, 64]
  const bend = bends[position % bends.length] ?? 0
  const rise = rises[position % rises.length] ?? 0
  const direction = target.x === 0 ? (position % 2 === 0 ? -1 : 1) : Math.sign(target.x)
  const firstControlX = target.x * 0.28 + bend
  const secondControlX = target.x * 0.74 + bend * 0.45 + direction * 10

  return `M${from.x},${from.y} C${firstControlX},${from.y - rise} ${secondControlX},${target.y + 34} ${target.x},${target.y}`
}

/** Stable integer derived from identity; deliberately independent of render order. */
function stableGeometrySeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Organic child limb with identity-seeded departure and curvature. */
export function nestedLimbPath(source: TreeNode, target: TreeNode): string {
  const seed = stableGeometrySeed(target.id)
  const side = ((seed % 9) - 4) * 7
  const bend = ((seed >>> 8) % 7) - 3
  const end = pullBackToward(target, source, NODE_EDGE_INSET)
  const dx = end.x - source.x
  const dy = end.y - source.y
  const firstX = source.x + dx * 0.28 + side
  const firstY = source.y + dy * 0.3 - 18 - ((seed >>> 16) % 18)
  const secondX = source.x + dx * 0.78 + bend * 10
  const secondY = source.y + dy * 0.82 + side * 0.18
  return `M${source.x},${source.y} C${firstX},${firstY} ${secondX},${secondY} ${end.x},${end.y}`
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

  // The crown is the width of the trunk where it meets the soil, and the flare
  // is how far it widens into the ground. Kept in one place so the silhouette
  // and the roots agree about where the trunk stops being a trunk.
  const crownHalfWidth = SIBLING_SPACING * 0.13
  const flareReach = SIBLING_SPACING * 0.32
  const flareDepth = SOIL_Y + 30

  return {
    // The organic curve reaches the top-level limb seam at -TRUNK_HEIGHT. It
    // remains clear of the first node while removing the old 30-unit gap.
    path: `M0,${SOIL_Y + 18} C-7,${SOIL_Y - 23} -7,${SOIL_Y - 91} 2,${SOIL_Y - TRUNK_HEIGHT}`,
    detailPath: `M1,${SOIL_Y + 14} C-2,${SOIL_Y - 27} -3,${SOIL_Y - 93} 3,${SOIL_Y - TRUNK_HEIGHT + 5}`,
    /*
     * A filled silhouette, so the trunk tapers instead of reading as a wire.
     * The stroke paths above give it grain; this gives it body: narrow at the
     * limb seam, widening through the soil, and flaring into the root crown.
     * One closed path, so it is cheap to fill and stays a single form.
     */
    bodyPath: [
      `M-3,${SOIL_Y - TRUNK_HEIGHT}`,
      `C-9,${SOIL_Y - 95} -11,${SOIL_Y - 45} -${crownHalfWidth},${SOIL_Y}`,
      `C-${crownHalfWidth},${SOIL_Y + 12} -${crownHalfWidth * 1.6},${SOIL_Y + 20} -${flareReach},${flareDepth}`,
      `C-${flareReach * 0.6},${flareDepth - 6} -${crownHalfWidth * 0.7},${flareDepth - 8} -${crownHalfWidth * 0.4},${flareDepth - 9}`,
      `L${crownHalfWidth * 0.4},${flareDepth - 9}`,
      `C${crownHalfWidth * 0.7},${flareDepth - 8} ${flareReach * 0.6},${flareDepth - 6} ${flareReach},${flareDepth}`,
      `C${crownHalfWidth * 1.6},${SOIL_Y + 20} ${crownHalfWidth},${SOIL_Y + 12} ${crownHalfWidth},${SOIL_Y}`,
      `C11,${SOIL_Y - 45} 9,${SOIL_Y - 95} 7,${SOIL_Y - TRUNK_HEIGHT}`,
      'Z',
    ].join(' '),
    /*
     * The ground the trunk rises from: a flat lens under the soil that widens
     * the base beyond the crown, so the tree reads as planted rather than
     * dropped on the line. Drawn behind the body and the roots.
     */
    flarePath: [
      `M0,${SOIL_Y + 2}`,
      `C-${flareReach * 0.9},${SOIL_Y + 8} -${flareReach * 1.25},${SOIL_Y + 20} -${flareReach * 1.35},${flareDepth + 4}`,
      `C-${flareReach * 0.9},${flareDepth - 4} -${flareReach * 0.4},${flareDepth - 6} 0,${flareDepth - 7}`,
      `C${flareReach * 0.4},${flareDepth - 6} ${flareReach * 0.9},${flareDepth - 4} ${flareReach * 1.35},${flareDepth + 4}`,
      `C${flareReach * 1.25},${SOIL_Y + 20} ${flareReach * 0.9},${SOIL_Y + 8} 0,${SOIL_Y + 2}`,
      'Z',
    ].join(' '),
    /*
     * Rootlets from the crown out to the evidence below. Kept shorter than the
     * limbs down to the evidence, which are the real root system; these only
     * suggest the rest of it. Drawing them as far as the nodes would duplicate
     * those limbs, which is precisely the decoration ADR 0043 asks to reduce.
     */
    rootPaths: [-1, -0.45, 0.45, 1].map((spread) => {
      const toX = spread * SIBLING_SPACING * 0.58
      const toY = SOIL_Y + (deepest - SOIL_Y) * 0.42
      return `M0,${SOIL_Y} C${toX * 0.2},${SOIL_Y + 26} ${toX * 0.68},${toY * 0.72} ${toX},${toY}`
    }),
    rootHairPaths: [-1, -0.45, 0.45, 1].map((spread) => {
      const toX = spread * SIBLING_SPACING * 0.58
      const toY = SOIL_Y + (deepest - SOIL_Y) * 0.42
      const direction = toX < 0 ? -1 : 1
      return `M${toX},${toY} l${direction * 16},6 M${toX},${toY} l${direction * 9},12`
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
  const from = pullBackToward(source, target, NODE_EDGE_INSET)
  const to = pullBackToward(target, source, NODE_EDGE_INSET)
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const span = Math.hypot(to.x - from.x, to.y - from.y)
  const bow = Math.min(span / 4, 90)

  return `M${from.x},${from.y} Q${midX},${midY + bow} ${to.x},${to.y}`
}

interface Point {
  readonly x: number
  readonly y: number
}

/**
 * How far a limb pulls back from a node's centre before it lands.
 *
 * Glyphs are roughly 20 units across, so a limb drawn to the exact centre
 * disappears behind the glyph and its join reads as a collision rather than a
 * connection. Pulling both ends back to the glyph's edge makes the attachment
 * visible. The trunk is not a node: a limb springing from it keeps its seam
 * point, which the tests pin to the trunk geometry.
 */
const NODE_EDGE_INSET = 12

/**
 * A smooth vertical join, so limbs read as growth rather than as a flowchart.
 *
 * `insetSource` is false only for limbs springing from the trunk, whose seam
 * is a point on the trunk itself rather than the centre of a glyph.
 */
function verticalPath(source: Point, target: Point, insetSource = true): string {
  const start = insetSource ? pullBackToward(source, target, NODE_EDGE_INSET) : source
  const end = pullBackToward(target, source, NODE_EDGE_INSET)
  const midway = (start.y + end.y) / 2
  return `M${start.x},${start.y} C${start.x},${midway} ${end.x},${midway} ${end.x},${end.y}`
}

/** Moves `from` toward `to` by `distance`, stopping short if they are close. */
function pullBackToward(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const span = Math.hypot(dx, dy)
  if (span === 0) return from
  const pull = Math.min(distance, span / 2)
  return { x: from.x + (dx / span) * pull, y: from.y + (dy / span) * pull }
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
