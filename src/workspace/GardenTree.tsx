import { useMemo } from 'react'
import type { GardenIndex } from '../domain/index/gardenIndex'
import { labelForKind } from '../domain/schema/kindLabels'
import { GLYPH_GEOMETRY, glyphForKind } from './kindGlyphs'
import { computeTreeLayout, displayLabel } from './treeLayout'

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

export function GardenTree({ index, selectedId, onSelect }: GardenTreeProps) {
  const layout = useMemo(() => computeTreeLayout(index), [index])
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

      {layout.nodes.map((node) => {
        const selected = node.id === selectedId
        const glyph = glyphForKind(node.kind)

        return (
          <g
            key={node.id}
            className={`garden-tree__node${selected ? ' garden-tree__node--selected' : ''}`}
            role="treeitem"
            aria-level={node.depth}
            aria-selected={selected}
            aria-label={`${labelForKind(node.kind)}: ${node.title}`}
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
