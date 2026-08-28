import { describe, expect, it } from 'vitest'
import { GARDEN_ITEM_KINDS } from '../domain/schema/itemIdentity'
import { KIND_LABELS } from '../domain/schema/kindLabels'
import { GLYPH_GEOMETRY, GLYPH_MARK, KIND_GLYPHS, glyphForKind } from './kindGlyphs'

/**
 * ADR 0044: shape, icon, label, and colour work together, so meaning never
 * depends on colour alone.
 */
describe('encoding kind by more than colour', () => {
  it('gives every kind a glyph', () => {
    for (const kind of GARDEN_ITEM_KINDS) {
      expect(glyphForKind(kind)).toBeTruthy()
    }
  })

  it('gives every kind a distinct shape', () => {
    const shapes = GARDEN_ITEM_KINDS.map((kind) => KIND_GLYPHS[kind].shape)

    expect(new Set(shapes).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  it('gives every kind a distinct text label', () => {
    const labels = GARDEN_ITEM_KINDS.map((kind) => KIND_LABELS[kind])

    expect(new Set(labels).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  /**
   * The load-bearing assertion, and it compares drawn geometry rather than
   * shape names -- two shapes can carry different names and still be the same
   * circle at different radii, which would quietly make colour the only
   * carrier. That is exactly what ADR 0044 forbids.
   */
  it('draws every kind with different geometry, not merely a different name', () => {
    const paths = GARDEN_ITEM_KINDS.map((kind) => GLYPH_GEOMETRY[KIND_GLYPHS[kind].shape])

    expect(new Set(paths).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  /**
   * Stronger still, and the assertion that would have caught the real defect:
   * two shapes that are the same form at different sizes. Scaling every path to
   * a common size makes a circle of radius 9 and a circle of radius 10 collapse
   * onto each other, while a rectangle and a diamond stay apart.
   */
  it('draws every kind with a different form, not the same form resized', () => {
    const scaleInvariant = (path: string) => {
      const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
      const largest = Math.max(...numbers.map(Math.abs))
      const normalized = numbers.map((value) => (value / largest).toFixed(2))
      const commands = (path.match(/[A-Z]/g) ?? []).join('')
      return `${commands}|${normalized.join(',')}`
    }

    const forms = GARDEN_ITEM_KINDS.map((kind) =>
      scaleInvariant(GLYPH_GEOMETRY[KIND_GLYPHS[kind].shape]),
    )

    expect(new Set(forms).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  it('still distinguishes every kind when colour is removed', () => {
    const withoutColour = GARDEN_ITEM_KINDS.map((kind) => {
      const { shape, filled } = KIND_GLYPHS[kind]
      return `${shape}:${filled}`
    })

    expect(new Set(withoutColour).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  // The ticket asks for a distinct colour treatment per kind, which means the
  // tone-and-fill pairing, not eight separate hues.
  it('gives every kind a distinct colour treatment', () => {
    const treatments = GARDEN_ITEM_KINDS.map((kind) => {
      const { tone, filled } = KIND_GLYPHS[kind]
      return `${tone}:${filled}`
    })

    expect(new Set(treatments).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  it('reuses tones across kinds, proving colour is not carrying the meaning', () => {
    const tones = GARDEN_ITEM_KINDS.map((kind) => KIND_GLYPHS[kind].tone)

    expect(new Set(tones).size).toBeLessThan(GARDEN_ITEM_KINDS.length)
  })

  it('names tones from the palette rather than inlining hex values', () => {
    for (const kind of GARDEN_ITEM_KINDS) {
      expect(KIND_GLYPHS[kind].tone).not.toMatch(/#/)
    }
  })
})

// ADR 0044 names the specific forms; they are not interchangeable decoration.
describe('the forms the design record names', () => {
  it.each([
    ['seed', 'pod'],
    ['root', 'evidence-node'],
    ['branch', 'junction'],
    ['claim_leaf', 'filled-leaf'],
    ['question_leaf', 'open-ring'],
    ['idea_leaf', 'bud'],
    ['observation_leaf', 'lens'],
    ['harvest', 'fruit'],
  ] as const)('draws a %s as a %s', (kind, shape) => {
    expect(KIND_GLYPHS[kind].shape).toBe(shape)
  })

  it('fills a Claim Leaf and leaves a Question Leaf open', () => {
    expect(KIND_GLYPHS['claim_leaf'].filled).toBe(true)
    expect(KIND_GLYPHS['question_leaf'].filled).toBe(false)
  })

  it('outlines a Root, because evidence is a record rather than a growth', () => {
    expect(KIND_GLYPHS['root'].filled).toBe(false)
  })

  it('gives a Harvest the golden tone', () => {
    expect(KIND_GLYPHS['harvest'].tone).toBe('pollen')
  })

  it('does not draw the Harvest as a plain circle, which is the Question Leaf', () => {
    expect(GLYPH_GEOMETRY['fruit']).not.toContain('A')
  })
})

describe('glyph geometry', () => {
  it('has drawable geometry for every shape in use', () => {
    for (const kind of GARDEN_ITEM_KINDS) {
      expect(GLYPH_GEOMETRY[KIND_GLYPHS[kind].shape]).toMatch(/^M/)
    }
  })

  it('defines no geometry that no kind uses', () => {
    const inUse = new Set(GARDEN_ITEM_KINDS.map((kind) => KIND_GLYPHS[kind].shape))

    expect(Object.keys(GLYPH_GEOMETRY).filter((shape) => !inUse.has(shape as never))).toEqual([])
  })

  it('draws every shape at a comparable size, so no kind dominates the Tree', () => {
    for (const [shape, path] of Object.entries(GLYPH_GEOMETRY)) {
      const magnitudes = [...path.matchAll(/-?\d+(\.\d+)?/g)]
        .map((match) => Math.abs(Number(match[0])))
        .filter((value) => value > 0)

      expect(Math.max(...magnitudes), `${shape} is out of scale`).toBeLessThanOrEqual(14)
    }
  })
})

/**
 * ADR 0044 names four carriers: shape, icon, label, and colour. The outline is
 * only one of them, and at small sizes two organic outlines can converge while
 * their interiors stay clearly different.
 */
describe('the icon inside each glyph', () => {
  it('gives every kind a mark', () => {
    for (const kind of GARDEN_ITEM_KINDS) {
      expect(GLYPH_MARK[KIND_GLYPHS[kind].shape]).toMatch(/^M/)
    }
  })

  it('gives every kind a different mark', () => {
    const marks = GARDEN_ITEM_KINDS.map((kind) => GLYPH_MARK[KIND_GLYPHS[kind].shape])

    expect(new Set(marks).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  it('defines no mark that no kind uses', () => {
    const inUse = new Set(GARDEN_ITEM_KINDS.map((kind) => KIND_GLYPHS[kind].shape))

    expect(Object.keys(GLYPH_MARK).filter((shape) => !inUse.has(shape as never))).toEqual([])
  })

  // ADR 0043: reduced until the knowledge nodes dominate. An icon that competes
  // with the label has gone too far.
  it('keeps every mark small enough to sit inside its glyph', () => {
    for (const [shape, path] of Object.entries(GLYPH_MARK)) {
      const magnitudes = [...path.matchAll(/-?\d+(\.\d+)?/g)]
        .map((match) => Math.abs(Number(match[0])))
        .filter((value) => value > 0)

      expect(Math.max(...magnitudes), `${shape} overflows its glyph`).toBeLessThanOrEqual(8)
    }
  })

  it('distinguishes every kind by icon alone, with shape and colour removed', () => {
    const icons = GARDEN_ITEM_KINDS.map((kind) => GLYPH_MARK[KIND_GLYPHS[kind].shape])

    expect(new Set(icons).size).toBe(GARDEN_ITEM_KINDS.length)
  })
})
