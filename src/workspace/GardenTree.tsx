import { useMemo } from 'react'
import type { GardenIndex } from '../domain/index/gardenIndex'
import { labelForKind } from '../domain/schema/kindLabels'
import { labelForRelation } from '../domain/schema/relations'
import { GLYPH_GEOMETRY, glyphForKind } from './kindGlyphs'
import { computeTreeLayout, displayLabel, type TreeCrossLink } from './treeLayout'
import type { RelationType } from '../domain/schema/relations'

/**
 * The Tree.
 *
 * ADR 0049: a purpose-built accessible SVG. The hierarchy library supplied the
 * geometry; every semantic here is ours. Kind is carried by shape, fill, colour,
 * and text label together and never by colour alone (ADR 0044), and the
 * accessible name states the kind so the distinction survives for anyone not
 * looking at the drawing.
 *
 * Pan, zoom, collapse, focus, and keyboard traversal are ticket 08.
 */
export interface GardenTreeProps {
  readonly index: GardenIndex
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
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

export function GardenTree({ index, selectedId, onSelect }: GardenTreeProps) {
  const layout = useMemo(() => computeTreeLayout(index), [index])
  const crossLinksByItem = useMemo(
    () => describeCrossLinksByItem(layout.crossLinks),
    [layout.crossLinks],
  )
  const { minX, minY, width, height } = layout.viewBox

  return (
    <svg
      className="garden-tree"
      role="tree"
      aria-label="Garden Tree"
      viewBox={`${minX} ${minY} ${width} ${height}`}
      // Natural size, not stretched to the pane: a label is the same size in a
      // small Garden as in a large one. Pan and zoom is ticket 08.
      width={width}
      height={height}
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
        const glyph = glyphForKind(node.kind)
        const crossLinks = crossLinksByItem.get(node.id)

        return (
          <g
            key={node.id}
            className={`garden-tree__node${selected ? ' garden-tree__node--selected' : ''}`}
            role="treeitem"
            aria-level={node.depth}
            aria-selected={selected}
            aria-label={`${labelForKind(node.kind)}: ${node.title}`}
            aria-describedby={crossLinks ? `${node.id}-cross-links` : undefined}
            tabIndex={0}
            transform={`translate(${node.x}, ${node.y})`}
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(node.id)
              }
            }}
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

            {/* The full title stays in the node's accessible name above. */}
            <text className="garden-tree__label" y={30} textAnchor="middle">
              {displayLabel(node.title)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
