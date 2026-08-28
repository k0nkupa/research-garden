import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GardenIndex } from '../domain/index/gardenIndex'
import { labelForKind } from '../domain/schema/kindLabels'
import { labelForRelation } from '../domain/schema/relations'
import { GLYPH_GEOMETRY, glyphForKind } from './kindGlyphs'
import { computeTreeLayout, displayLabel, type TreeCrossLink } from './treeLayout'
import type { RelationType } from '../domain/schema/relations'
import {
  applyTreeAction,
  visibleTreeRows,
  treeKeyAction,
  UNFOCUSED,
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

interface Viewport {
  readonly x: number
  readonly y: number
  readonly scale: number
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
}: GardenTreeProps) {
  const rows = useMemo(() => visibleTreeRows(index, view), [index, view])
  // The rows are handed on rather than recomputed: walking the Tree twice per
  // view change is exactly the cost ADR 0061 asks to be bounded.
  const layout = useMemo(() => computeTreeLayout(index, view, rows), [index, rows, view])
  const crossLinksByItem = useMemo(
    () => describeCrossLinksByItem(layout.crossLinks),
    [layout.crossLinks],
  )

  const [viewport, setViewport] = useState<Viewport>(AT_REST)
  const [keyboardId, setKeyboardId] = useState<string | undefined>(undefined)
  const panningFrom = useRef<{ x: number; y: number } | undefined>(undefined)
  const svg = useRef<SVGSVGElement>(null)
  /** Set when a keypress moved the current node, so focus follows it there. */
  const followFocus = useRef(false)

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
        // sends a matching pointerup here, which would leave the Tree panning
        // on buttonless movement.
        if (event.button !== 0) return

        panningFrom.current = { x: event.clientX - viewport.x, y: event.clientY - viewport.y }
        // Captured so a drag that leaves the pane keeps working, and so its
        // release is always heard.
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        const from = panningFrom.current
        if (!from) return

        setViewport((at) => ({
          ...at,
          x: withinReach(event.clientX - from.x),
          y: withinReach(event.clientY - from.y),
        }))
      }}
      onPointerUp={(event) => {
        panningFrom.current = undefined
        event.currentTarget.releasePointerCapture?.(event.pointerId)
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
        <g className="garden-tree__links" aria-hidden="true">
          {layout.links.map((link) => (
            <path key={`${link.sourceId}->${link.targetId}`} d={link.path} />
          ))}
        </g>

        {/*
          Cross-links: relationships outside an item's primary placement. Drawing
          them keeps the Tree a legible one-parent projection while the graph
          underneath stays truthful (ADR 0008). Contradicts is dashed mulberry
          (ADR 0045); the illumination that makes tracing a signature interaction
          is ticket 09.
        */}
        <g className="garden-tree__cross-links" aria-hidden="true">
          {layout.crossLinks.map((link) => (
            <path
              key={`${link.type}:${link.sourceId}->${link.targetId}`}
              // Kebab-cased so the stylesheet is not coupled to identifier spelling.
              className={`garden-tree__cross-link garden-tree__cross-link--${link.type.replace(
                /_/g,
                '-',
              )}`}
              data-relation={link.type}
              d={link.path}
            />
          ))}
        </g>

        {layout.nodes.map((node) => {
          const selected = node.id === selectedId
          const among = positions.get(node.id)
          const glyph = glyphForKind(node.kind)
          const crossLinks = crossLinksByItem.get(node.id)
          const diagnosed = diagnosedIds.has(node.id)

          return (
            <g
              key={node.id}
              className={[
                'garden-tree__node',
                selected && 'garden-tree__node--selected',
                diagnosed && 'garden-tree__node--diagnosed',
                node.dormant && 'garden-tree__node--dormant',
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
              // ADR 0031: dormancy is stated, not left to the drawing.
              aria-label={`${labelForKind(node.kind)}: ${node.title}${
                node.dormant ? ', dormant' : ''
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
              <path
                className={`garden-tree__glyph garden-tree__glyph--${glyph.tone}${
                  glyph.filled ? ' garden-tree__glyph--filled' : ''
                }`}
                // Exposed so a test can assert the shape without reading pixels.
                data-shape={glyph.shape}
                d={GLYPH_GEOMETRY[glyph.shape]}
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
                <text className="garden-tree__collapsed-marker" y={-15} textAnchor="middle" aria-hidden="true">
                  +
                </text>
              )}

              {/* The full title stays in the node's accessible name above. */}
              <text className="garden-tree__label" y={30} textAnchor="middle">
                {displayLabel(node.title)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
