import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GardenIndex } from '../domain/index/gardenIndex'
import { labelForKind } from '../domain/schema/kindLabels'
import { labelForRelation } from '../domain/schema/relations'
import { GLYPH_GEOMETRY, GLYPH_MARK, glyphForKind } from './kindGlyphs'
import { computeTreeLayout, displayLabel, type TreeCrossLink, type TreeProjection } from './treeLayout'
import type { RelationType } from '../domain/schema/relations'
import { edgeKey, isTracing, traceEvidence } from './evidenceTrace'
import {
  applyTreeAction,
  visibleTreeRows,
  treeKeyAction,
  UNFOCUSED,
  type TreeRow,
  type TreeViewState,
} from './treeView'

/**
 * The Tree.
 *
 * ADR 0049: a purpose-built accessible SVG. The hierarchy library supplied the
 * geometry; every semantic here is ours. Kind is carried by shape, fill, colour,
 * and text label together and never by colour alone (ADR 0044), and the
 * accessible name states the kind so the distinction survives for anyone not
 * looking at the drawing.
 *
 * ADR 0042 draws the line on interaction: pan, zoom, select, collapse, focus,
 * and keyboard traversal, and deliberately no drag-to-reparent. A drag moves
 * the view and never an item, because restructuring a person's knowledge is a
 * proposed action they review, not a gesture they can make by accident.
 *
 * ADR 0045 is the signature interaction: selecting an item softens everything
 * unrelated and illuminates its complete provenance and evidence path
 * (`evidenceTrace.ts`). Selection is one path for pointer and keyboard alike,
 * so the illumination follows both without a separate code path for either.
 */
export interface GardenTreeProps {
  readonly index: GardenIndex
  readonly selectedId: string | undefined
  /** Items that loaded but carry a Garden Diagnostic (ADR 0052). */
  readonly diagnosedIds?: ReadonlySet<string>
  readonly onSelect: (id: string) => void
  /** What the Tree is showing. View state only; nothing canonical (ADR 0014). */
  readonly view?: TreeViewState
  readonly onViewChange?: (view: TreeViewState) => void
  /** Changes whenever the explorer enters a new branch, resetting pan/zoom. */
  readonly scopeKey?: string | undefined
  /**
   * Rows to draw instead of deriving them from the view. Lets the explorer
   * bound a Canopy to its own handful of leaves while keeping every part of
   * the botanical rendering. When absent, the view decides the rows.
   */
  readonly rows?: readonly TreeRow[]
  /** The overview map uses organic limbs; focused Trees keep analytical geometry. */
  readonly projection?: TreeProjection
}

/**
 * Reads every item's Cross-links back as a sentence, for assistive technology.
 *
 * Built once for the whole Tree rather than rescanned per node: a Garden at the
 * challenge performance target has thousands of relationships, and a per-node
 * scan would be quadratic in exactly the case that matters (ADR 0061).
 */
function describeCrossLinksByItem(
  crossLinks: readonly TreeCrossLink[],
): ReadonlyMap<string, string> {
  const counts = new Map<string, Map<RelationType, number>>()

  const tally = (id: string, type: RelationType) => {
    const forItem = counts.get(id) ?? new Map<RelationType, number>()
    forItem.set(type, (forItem.get(type) ?? 0) + 1)
    counts.set(id, forItem)
  }

  for (const link of crossLinks) {
    tally(link.sourceId, link.type)
    if (link.targetId !== link.sourceId) tally(link.targetId, link.type)
  }

  return new Map(
    [...counts].map(([id, byType]) => [
      id,
      [...byType].map(([type, count]) => `${labelForRelation(type)} ${count}`).join(', '),
    ]),
  )
}

const NOTHING_DIAGNOSED: ReadonlySet<string> = new Set()

const MINIMUM_SCALE = 0.3
const MAXIMUM_SCALE = 3
const ZOOM_STEP = 1.15
const PAN_START_DISTANCE = 4

/**
 * A limb's stroke width from the generation it belongs to.
 *
 * Depth 1 is a limb springing straight from the trunk, so it is the thickest
 * thing that is not the trunk itself. Each further generation tapers, and the
 * taper bottoms out so a deep Tree does not keep shrinking into invisibility.
 */
const limbStrokeFor = (depth: number) => Math.max(2.5, 6.5 - (depth - 1) * 1.25)

interface Viewport {
  readonly x: number
  readonly y: number
  readonly scale: number
}

interface PendingPan {
  /** Viewport position at pointer-down, used to keep the drag anchored. */
  readonly x: number
  readonly y: number
  /** Pointer position at pointer-down, used to distinguish a click from a pan. */
  readonly originX: number
  readonly originY: number
  readonly pointerId: number
  readonly captured: boolean
}

const AT_REST: Viewport = { x: 0, y: 0, scale: 1 }

/**
 * How far the Tree may be pushed from where it started.
 *
 * Unbounded panning lets a person drag their Garden off the pane with no way
 * back short of reloading, which is a poor trade for a gesture that is easy to
 * make by accident.
 */
const PAN_REACH = 2000

const withinReach = (value: number) => Math.min(PAN_REACH, Math.max(-PAN_REACH, value))

export function GardenTree({
  index,
  selectedId,
  diagnosedIds = NOTHING_DIAGNOSED,
  onSelect,
  view = UNFOCUSED,
  onViewChange,
  scopeKey,
  rows: rowsOverride,
  projection = 'default',
}: GardenTreeProps) {
  const rows = useMemo(
    () => rowsOverride ?? visibleTreeRows(index, view),
    [index, rowsOverride, view],
  )
  // The rows are handed on rather than recomputed: walking the Tree twice per
  // view change is exactly the cost ADR 0061 asks to be bounded.
  const layout = useMemo(() => computeTreeLayout(index, view, rows, projection), [index, rows, view, projection])
  const crossLinksByItem = useMemo(
    () => describeCrossLinksByItem(layout.crossLinks),
    [layout.crossLinks],
  )

  /**
   * ADR 0045: selecting an item illuminates its complete provenance and
   * evidence path and softens everything else. Recomputed from `selectedId`
   * alone, so choosing a different item clears the previous illumination for
   * free -- there is no separate "illuminated" state to forget to reset.
   *
   * `tracing` is not "something is selected": a Root or a bare Branch is a
   * legitimate selection with nothing upstream of it, and softening the whole
   * Tree for that would read as broken rather than quiet -- caught in a
   * real-browser check during development.
   */
  const trace = useMemo(() => traceEvidence(index, selectedId), [index, selectedId])
  const tracing = isTracing(trace)
  const isLit = (id: string) =>
    id === selectedId || trace.evidencePathIds.has(id) || trace.contradictingIds.has(id)

  const [viewport, setViewport] = useState<Viewport>(AT_REST)
  const [keyboardId, setKeyboardId] = useState<string | undefined>(undefined)
  const panningFrom = useRef<PendingPan | undefined>(undefined)
  const svg = useRef<SVGSVGElement>(null)
  /** Set when a keypress moved the current node, so focus follows it there. */
  const followFocus = useRef(false)

  useEffect(() => {
    setViewport(AT_REST)
    setKeyboardId(undefined)
    panningFrom.current = undefined
  }, [scopeKey])

  /**
   * Moving the tab order is not the same as moving focus.
   *
   * Without this the arrow keys would shift which node is tabbable while the
   * browser's focus stayed put -- so a screen reader would keep reading the
   * first node and every subsequent arrow would arrive from it. Navigation
   * would look correct in the DOM and be entirely broken for the person using
   * it.
   */
  useEffect(() => {
    if (!followFocus.current || keyboardId === undefined) return
    followFocus.current = false

    svg.current
      ?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(keyboardId)}"]`)
      ?.focus()
  }, [keyboardId])

  /**
   * Exactly one node is in the tab order at a time, so a person reaches the
   * Tree with one Tab and then navigates inside it with the arrows, rather than
   * tabbing through every item in their Garden.
   */
  const shownIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows])

  /**
   * Where each row sits among its siblings.
   *
   * The drawn nodes are a flat list of `treeitem` elements rather than nested
   * ones, so ARIA needs `aria-setsize` and `aria-posinset` alongside
   * `aria-level` for the hierarchy to be readable at all.
   */
  const positions = useMemo(() => {
    const byParent = new Map<string, string[]>()
    for (const row of rows) {
      const key = row.parentId ?? ''
      byParent.set(key, [...(byParent.get(key) ?? []), row.id])
    }

    return new Map(
      rows.map((row) => {
        const siblings = byParent.get(row.parentId ?? '') ?? []
        return [row.id, { size: siblings.length, position: siblings.indexOf(row.id) + 1 }]
      }),
    )
  }, [rows])
  const preferred = [keyboardId, selectedId].find((id) => id !== undefined && shownIds.has(id))
  const tabbableId = preferred ?? rows[0]?.id

  const handleKey = useCallback(
    (event: React.KeyboardEvent, nodeId: string) => {
      const action = treeKeyAction(rows, nodeId, event.key, view.focusedId !== undefined)
      if (action.kind === 'none') return

      event.preventDefault()
      event.stopPropagation()

      if (action.kind === 'move') {
        followFocus.current = true
        setKeyboardId(action.toId)
        return
      }
      if (action.kind === 'select') {
        onSelect(action.id)
        return
      }

      onViewChange?.(applyTreeAction(view, action))
    },
    [onSelect, onViewChange, rows, view],
  )

  const { minX, minY, width, height } = layout.viewBox

  return (
    <div
      className="garden-tree__canvas"
      data-testid="tree-canvas"
      onPointerDown={(event) => {
        // Primary button only: a right-click opens a context menu and never
        // starts a pan.
        if (event.button !== 0) return

        // Do not capture until this becomes a drag. Capturing on every
        // pointer-down retargets the pointer-up to the canvas, which prevents
        // a Tree node beneath it from receiving its native click event.
        panningFrom.current = {
          x: event.clientX - viewport.x,
          y: event.clientY - viewport.y,
          originX: event.clientX,
          originY: event.clientY,
          pointerId: event.pointerId,
          captured: false,
        }
      }}
      onPointerMove={(event) => {
        const from = panningFrom.current
        if (!from || from.pointerId !== event.pointerId) return

        const moved = Math.hypot(event.clientX - from.originX, event.clientY - from.originY)
        if (!from.captured && moved < PAN_START_DISTANCE) return

        if (!from.captured) {
          // Once a drag is intentional, keep it alive outside the pane and
          // make its release belong to the canvas rather than the node.
          event.currentTarget.setPointerCapture?.(event.pointerId)
          panningFrom.current = { ...from, captured: true }
        }

        setViewport((at) => ({
          ...at,
          x: withinReach(event.clientX - from.x),
          y: withinReach(event.clientY - from.y),
        }))
      }}
      onPointerUp={(event) => {
        const from = panningFrom.current
        if (!from || from.pointerId !== event.pointerId) return

        panningFrom.current = undefined
        if (from.captured) event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => {
        panningFrom.current = undefined
      }}
      onWheel={(event) => {
        const towards = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
        setViewport((at) => ({
          ...at,
          scale: Math.min(MAXIMUM_SCALE, Math.max(MINIMUM_SCALE, at.scale * towards)),
        }))
      }}
    >
      <svg
        ref={svg}
        className="garden-tree"
        role="tree"
        aria-label="Garden Tree"
        viewBox={`${minX} ${minY} ${width} ${height}`}
        // Natural size, not stretched to the pane: a label is the same size in a
        // small Garden as in a large one. Zoom is explicit, above.
        width={width}
        height={height}
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {/*
          The botanical form (ADR 0043): a trunk rising through a soil line,
          with roots spreading below it. Decoration, so it is hidden from
          assistive technology -- the structure it depicts is already carried by
          the treeitem levels.
        */}
        <g className="garden-tree__form" aria-hidden="true">
          {/* The ground lens sits behind everything, so the roots read as
              emerging from the soil rather than lying on top of it. */}
          <path
            className="garden-tree__ground"
            data-role="root-ground"
            data-layer="structural"
            d={layout.trunk.flarePath}
          />
          <line
            className="garden-tree__soil"
            x1={layout.trunk.soilFrom}
            y1={layout.trunk.soilY}
            x2={layout.trunk.soilTo}
            y2={layout.trunk.soilY}
          />
          {/* The filled silhouette gives the trunk its taper; the strokes
              below give it grain. Drawn first so the roots can reach over it. */}
          <path
            className="garden-tree__trunk-body"
            data-role="trunk-body"
            data-layer="structural"
            d={layout.trunk.bodyPath}
          />
          {layout.trunk.rootPaths.map((path) => (
            <path
              key={path}
              className="garden-tree__root-flare"
              data-role="root-flare"
              data-layer="structural"
              d={path}
            />
          ))}
          {layout.trunk.rootHairPaths.map((path) => (
            <path
              key={path}
              className="garden-tree__root-hair"
              data-role="root-hair"
              data-layer="detail"
              d={path}
            />
          ))}
          <path
            className="garden-tree__trunk"
            data-role="permanent-trunk"
            data-layer="structural"
            d={layout.trunk.path}
          />
          <path
            className="garden-tree__trunk-detail"
            data-role="permanent-trunk"
            data-layer="detail"
            d={layout.trunk.detailPath}
          />
        </g>

        <g className="garden-tree__links" aria-hidden="true">
          {layout.links.map((link) => {
            const key = `${link.sourceId ?? 'trunk'}->${link.targetId}`
            // Softened once anything is illuminated, unless the limb touches a
            // lit node -- both visual layers must fade as one (ADR 0045).
            const dimmed =
              tracing &&
              !(link.sourceId !== undefined && isLit(link.sourceId)) &&
              !isLit(link.targetId)

            return (
              <g key={key} data-role="parent-limb" data-link-key={key}>
                <path
                  className={dimmed ? 'garden-tree__link garden-tree__link--dimmed' : 'garden-tree__link'}
                  data-role="parent-limb"
                  data-layer="structural"
                  // A limb thins as it grows outward: the trunk is the
                  // thickest thing, the first generation tapers from it, and
                  // each further generation recedes further (ADR 0043).
                  style={{ strokeWidth: limbStrokeFor(link.depth) }}
                  d={link.path}
                />
                <path
                  className={
                    dimmed
                      ? 'garden-tree__link-detail garden-tree__link--dimmed'
                      : 'garden-tree__link-detail'
                  }
                  data-role="parent-limb"
                  data-layer="detail"
                  d={link.path}
                />
              </g>
            )
          })}
        </g>

        {/*
          Cross-links: relationships outside an item's primary placement. Drawing
          them keeps the Tree a legible one-parent projection while the graph
          underneath stays truthful (ADR 0008). Contradicts is dashed mulberry
          (ADR 0045). A selection illuminates the edges `traceEvidence` walked
          and softens the rest; the relationships themselves are conveyed to
          assistive technology through each node's accessible name below, since
          this whole group is decorative.
        */}
        <g className="garden-tree__cross-links" aria-hidden="true">
          {layout.crossLinks.map((link) => {
            // The same key `evidenceTrace.ts` uses for `litEdges`, imported
            // rather than re-spelled here, so the two cannot silently drift.
            const key = edgeKey(link)
            return (
              <path
                key={key}
                // Kebab-cased so the stylesheet is not coupled to identifier spelling.
                className={[
                  'garden-tree__cross-link',
                  `garden-tree__cross-link--${link.type.replace(/_/g, '-')}`,
                  tracing && !trace.litEdges.has(key) && 'garden-tree__cross-link--dimmed',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-relation={link.type}
                d={link.path}
              />
            )
          })}
        </g>

        {layout.nodes.map((node) => {
          const selected = node.id === selectedId
          const among = positions.get(node.id)
          const glyph = glyphForKind(node.kind)
          const crossLinks = crossLinksByItem.get(node.id)
          const diagnosed = diagnosedIds.has(node.id)
          const onEvidencePath = !selected && trace.evidencePathIds.has(node.id)
          const contradictsSelection = trace.contradictingIds.has(node.id)
          // Reuses `isLit` rather than re-deriving the same fact a second way,
          // so "dimmed" and "lit" cannot silently disagree with each other.
          const dimmed = tracing && !isLit(node.id)

          return (
            <g
              key={node.id}
              className={[
                'garden-tree__node',
                selected && 'garden-tree__node--selected',
                diagnosed && 'garden-tree__node--diagnosed',
                node.dormant && 'garden-tree__node--dormant',
                dimmed && 'garden-tree__node--dimmed',
              ]
                .filter(Boolean)
                .join(' ')}
              role="treeitem"
              aria-level={node.depth}
              aria-setsize={among?.size}
              aria-posinset={among?.position}
              aria-selected={selected}
              // Absent on a childless node, as the tree pattern requires.
              aria-expanded={node.hasChildren ? node.expanded : undefined}
              // Marked rather than hidden: a Diagnostic is something to fix, not a
              // reason to make an item disappear (ADR 0052).
              aria-invalid={diagnosed || undefined}
              // ADR 0031: dormancy is stated, not left to the drawing. The
              // evidence path and a Contradicts relationship are stated here
              // too (ticket 09) -- softening and illumination are a visual
              // treatment, and this is how the same fact reaches assistive
              // technology (ADR 0045).
              aria-label={`${labelForKind(node.kind)}: ${node.title}${
                node.dormant ? ', dormant' : ''
              }${onEvidencePath ? ', on the evidence path' : ''}${
                contradictsSelection ? ', contradicts the selection' : ''
              }`}
              aria-describedby={crossLinks ? `${node.id}-cross-links` : undefined}
              data-node-id={node.id}
              tabIndex={node.id === tabbableId ? 0 : -1}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => {
                setKeyboardId(node.id)
                onSelect(node.id)
              }}
              onFocus={() => setKeyboardId(node.id)}
              onKeyDown={(event) => handleKey(event, node.id)}
            >
              {/* The inner group is the hover surface. A CSS transform here is
                  safe, unlike on the node group itself, whose translate
                  attribute would be overridden by any CSS transform. */}
              <g className="garden-tree__node-body">
              <path
                className={`garden-tree__glyph garden-tree__glyph--${glyph.tone}${
                  glyph.filled ? ' garden-tree__glyph--filled' : ''
                }`}
                // Exposed so a test can assert the shape without reading pixels.
                data-shape={glyph.shape}
                d={GLYPH_GEOMETRY[glyph.shape]}
              />

              {/* ADR 0044's icon: a mark inside the form, not the form itself. */}
              <path
                className={`garden-tree__mark${
                  glyph.filled ? ' garden-tree__mark--on-fill' : ''
                }`}
                data-mark={glyph.shape}
                d={GLYPH_MARK[glyph.shape]}
              />
              {/*
                Cross-links are drawn as curves, so without this they would be
                visible only to someone looking at the picture.
              */}
              {crossLinks && (
                <desc id={`${node.id}-cross-links`}>{crossLinks}</desc>
              )}

              {diagnosed && (
                <circle className="garden-tree__diagnostic-mark" r={4} cx={13} cy={-13} />
              )}

              {/* A collapsed Branch says so, so folded work is never simply absent. */}
              {node.hasChildren && !node.expanded && (
                <text
                  className="garden-tree__collapsed-marker"
                  x={16}
                  y={-10}
                  aria-hidden="true"
                >
                  +
                </text>
              )}

              {/*
                Kind above, title below, as the design record's reference shows.
                ADR 0044 wants the kind carried by a text label and not only by
                the glyph, and a person scanning a Tree of eight forms should
                not have to remember which is which.
              */}
              <text className="garden-tree__kind" y={-21} textAnchor="middle" aria-hidden="true">
                {labelForKind(node.kind)}
              </text>

              {/* The full title stays in the node's accessible name above. */}
              <text className="garden-tree__label" y={33} textAnchor="middle">
                {displayLabel(node.title)}
              </text>
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
