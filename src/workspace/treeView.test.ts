import { describe, expect, it } from 'vitest'
import { buildGardenIndex, type GardenIndex } from '../domain/index/gardenIndex'
import { UNFOCUSED, applyTreeAction, visibleTreeRows, treeKeyAction } from './treeView'

const B = (n: string) => `branch_01HQ8X2K3M4N5P6Q7R8S9T0${n}W`
const L = (n: string) => `question_leaf_01HQ8X2K3M4N5P6Q7R8S9T0${n}W`

const TOPIC = B('B1')
const NESTED = B('B2')
const DORMANT = B('B3')
const OTHER = B('B4')
const LEAF = L('Q1')
const LEAF_2 = L('Q2')

function file(lines: string[]) {
  return [
    '---',
    'schema_version: 1',
    ...lines,
    'created_at: 2026-08-01T10:00:00Z',
    'updated_at: 2026-08-01T10:00:00Z',
    '---',
    '',
    'A body.',
    '',
  ].join('\n')
}

const branch = (id: string, title: string, state = 'active', parentId?: string) => ({
  path: ['branches', `${id}.md`],
  text: file([
    `id: ${id}`,
    'kind: branch',
    `title: ${title}`,
    `state: ${state}`,
    ...(parentId ? [`parent_id: ${parentId}`] : []),
  ]),
})

const leaf = (id: string, title: string, parentId: string) => ({
  path: ['leaves', `${id}.md`],
  text: file([`id: ${id}`, 'kind: question_leaf', `title: ${title}`, `parent_id: ${parentId}`]),
})

/**
 * Topic
 *   Nested
 *     Deep leaf
 *   A leaf
 * Dormant topic
 * Other topic
 */
async function garden(): Promise<GardenIndex> {
  const index = await buildGardenIndex([
    branch(TOPIC, 'Topic'),
    branch(NESTED, 'Nested', 'active', TOPIC),
    leaf(LEAF_2, 'Deep leaf', NESTED),
    leaf(LEAF, 'A leaf', TOPIC),
    branch(DORMANT, 'Dormant topic', 'dormant'),
    branch(OTHER, 'Other topic'),
  ])

  // A fixture that quietly failed to validate would make every test below pass
  // against an empty Garden.
  if (index.diagnostics.length > 0) {
    throw new Error(`the fixture did not validate: ${JSON.stringify(index.diagnostics)}`)
  }
  return index
}

const titlesOf = (rows: readonly { title: string }[]) => rows.map((row) => row.title)

describe('what the Tree is showing', () => {
  it('lists every node depth-first, matching the order it is drawn in', async () => {
    const outline = visibleTreeRows(await garden(), UNFOCUSED)

    // Top-level Branches in title order, then each one's subtree depth-first.
    expect(titlesOf(outline)).toEqual([
      'Dormant topic',
      'Other topic',
      'Topic',
      'A leaf',
      'Nested',
      'Deep leaf',
    ])
  })

  it('counts depth from one, as ARIA levels do', async () => {
    const outline = visibleTreeRows(await garden(), UNFOCUSED)

    expect(outline.find((row) => row.title === 'Topic')?.depth).toBe(1)
    expect(outline.find((row) => row.title === 'Nested')?.depth).toBe(2)
    expect(outline.find((row) => row.title === 'Deep leaf')?.depth).toBe(3)
  })

  it('says which rows have children and which are open', async () => {
    const outline = visibleTreeRows(await garden(), UNFOCUSED)

    expect(outline.find((row) => row.title === 'Topic')).toMatchObject({
      hasChildren: true,
      expanded: true,
    })
    expect(outline.find((row) => row.title === 'A leaf')).toMatchObject({
      hasChildren: false,
      expanded: false,
    })
  })

  // ADR 0031: dormant recedes; it does not disappear.
  it('keeps a Dormant Branch in the Tree and marks it', async () => {
    const outline = visibleTreeRows(await garden(), UNFOCUSED)

    expect(outline.find((row) => row.title === 'Dormant topic')).toMatchObject({ dormant: true })
  })

  it('does not mark an active Branch as dormant', async () => {
    const outline = visibleTreeRows(await garden(), UNFOCUSED)

    expect(outline.find((row) => row.title === 'Topic')?.dormant).toBe(false)
  })
})

// ADR 0061: collapse bounds what is drawn. That is the whole point of it.
describe('collapsing a Branch', () => {
  it('folds its descendants away', async () => {
    const outline = visibleTreeRows(await garden(), {
      ...UNFOCUSED,
      collapsedIds: new Set([TOPIC]),
    })

    expect(titlesOf(outline)).not.toContain('A leaf')
    expect(titlesOf(outline)).not.toContain('Deep leaf')
  })

  it('keeps the collapsed Branch itself visible', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, collapsedIds: new Set([TOPIC]) })

    expect(titlesOf(outline)).toContain('Topic')
  })

  it('marks it as closed rather than childless', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, collapsedIds: new Set([TOPIC]) })

    expect(outline.find((row) => row.title === 'Topic')).toMatchObject({
      hasChildren: true,
      expanded: false,
    })
  })

  it('leaves other Branches alone', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, collapsedIds: new Set([TOPIC]) })

    expect(titlesOf(outline)).toContain('Other topic')
  })

  it('measurably reduces how much has to be drawn', async () => {
    const index = await garden()
    const open = visibleTreeRows(index, UNFOCUSED).length
    const folded = visibleTreeRows(index, { ...UNFOCUSED, collapsedIds: new Set([TOPIC]) }).length

    expect(folded).toBeLessThan(open)
  })

  it('collapses a nested Branch without collapsing its parent', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, collapsedIds: new Set([NESTED]) })

    expect(titlesOf(outline)).toContain('Nested')
    expect(titlesOf(outline)).toContain('A leaf')
    expect(titlesOf(outline)).not.toContain('Deep leaf')
  })
})

// ADR 0014: focus changes the view and nothing else.
describe('focusing a Branch', () => {
  it('shows only that Branch and what is under it', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, focusedId: TOPIC })

    expect(titlesOf(outline)).toEqual(['Topic', 'A leaf', 'Nested', 'Deep leaf'])
  })

  it('makes the focused Branch the outermost row', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, focusedId: TOPIC })

    expect(outline[0]).toMatchObject({ title: 'Topic', depth: 1 })
  })

  it('can focus a Dormant Branch, which stays focusable', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, focusedId: DORMANT })

    expect(titlesOf(outline)).toEqual(['Dormant topic'])
  })

  it('falls back to the whole Tree when the focused Branch is gone', async () => {
    const outline = visibleTreeRows(await garden(), { ...UNFOCUSED, focusedId: B('ZZ') })

    expect(titlesOf(outline)).toContain('Other topic')
  })

  it('changes nothing about the index it was given', async () => {
    const index = await garden()
    const before = JSON.stringify([...index.items.keys()].sort())

    visibleTreeRows(index, { ...UNFOCUSED, focusedId: TOPIC })

    expect(JSON.stringify([...index.items.keys()].sort())).toBe(before)
  })

  it('leaves every canonical relationship where it was', async () => {
    const index = await garden()
    const before = JSON.stringify(index.graph.relationships)

    visibleTreeRows(index, { ...UNFOCUSED, focusedId: NESTED })

    expect(JSON.stringify(index.graph.relationships)).toBe(before)
  })
})

/**
 * The ARIA tree pattern, rather than one of our own: a person who already knows
 * how to drive a tree should not have to learn ours.
 */
describe('the keyboard', () => {
  async function outline(view = UNFOCUSED) {
    return visibleTreeRows(await garden(), view)
  }

  it('moves down the visible rows', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, rows[0]?.id, 'ArrowDown')).toEqual({
      kind: 'move',
      toId: rows[1]?.id,
    })
  })

  it('moves up the visible rows', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, rows[1]?.id, 'ArrowUp')).toEqual({ kind: 'move', toId: rows[0]?.id })
  })

  it('stops at the top rather than wrapping', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, rows[0]?.id, 'ArrowUp')).toEqual({ kind: 'none' })
  })

  it('stops at the bottom rather than wrapping', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, rows.at(-1)?.id, 'ArrowDown')).toEqual({ kind: 'none' })
  })

  it('jumps to the first row', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, rows[3]?.id, 'Home')).toEqual({ kind: 'move', toId: rows[0]?.id })
  })

  it('jumps to the last row', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, rows[0]?.id, 'End')).toEqual({ kind: 'move', toId: rows.at(-1)?.id })
  })

  it('opens a closed Branch with the right arrow', async () => {
    const rows = await outline({ ...UNFOCUSED, collapsedIds: new Set([TOPIC]) })

    expect(treeKeyAction(rows, TOPIC, 'ArrowRight')).toEqual({ kind: 'expand', id: TOPIC })
  })

  it('steps into an open Branch with the right arrow', async () => {
    const rows = await outline()
    const at = rows.findIndex((row) => row.id === TOPIC)

    expect(treeKeyAction(rows, TOPIC, 'ArrowRight')).toEqual({
      kind: 'move',
      toId: rows[at + 1]?.id,
    })
  })

  it('does nothing with the right arrow on a childless row', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, LEAF, 'ArrowRight')).toEqual({ kind: 'none' })
  })

  it('closes an open Branch with the left arrow', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, TOPIC, 'ArrowLeft')).toEqual({ kind: 'collapse', id: TOPIC })
  })

  it('steps out to the parent with the left arrow', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, LEAF, 'ArrowLeft')).toEqual({ kind: 'move', toId: TOPIC })
  })

  it('does nothing stepping out of an outermost row', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, OTHER, 'ArrowLeft')).toEqual({ kind: 'none' })
  })

  it('selects with Enter', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, LEAF, 'Enter')).toEqual({ kind: 'select', id: LEAF })
  })

  it('selects with Space', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, LEAF, ' ')).toEqual({ kind: 'select', id: LEAF })
  })

  it('focuses a Branch', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, TOPIC, 'f')).toEqual({ kind: 'focus', id: TOPIC })
  })

  // Focus narrows the Tree to a subtree, and only a Branch has one.
  it('refuses to focus something that is not a Branch', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, LEAF, 'f')).toEqual({ kind: 'none' })
  })

  it('leaves focus with Escape when there is focus to leave', async () => {
    const rows = await outline({ ...UNFOCUSED, focusedId: TOPIC })

    expect(treeKeyAction(rows, TOPIC, 'Escape', true)).toEqual({ kind: 'clear-focus' })
  })

  // A stray Escape has to reach whatever else on the page is listening for it.
  it('ignores Escape when nothing is focused', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, TOPIC, 'Escape', false)).toEqual({ kind: 'none' })
  })

  it('starts at the top when nothing is current yet', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, undefined, 'ArrowDown')).toEqual({ kind: 'move', toId: rows[0]?.id })
  })

  it('ignores a key it has no meaning for', async () => {
    const rows = await outline()

    expect(treeKeyAction(rows, TOPIC, 'q')).toEqual({ kind: 'none' })
  })

  it('does nothing at all in an empty Tree', async () => {
    expect(treeKeyAction([], undefined, 'ArrowDown')).toEqual({ kind: 'none' })
  })
})

describe('applying an action to the view', () => {
  it('collapses', () => {
    expect(applyTreeAction(UNFOCUSED, { kind: 'collapse', id: TOPIC }).collapsedIds.has(TOPIC)).toBe(
      true,
    )
  })

  it('expands what was collapsed', () => {
    const collapsed = applyTreeAction(UNFOCUSED, { kind: 'collapse', id: TOPIC })

    expect(applyTreeAction(collapsed, { kind: 'expand', id: TOPIC }).collapsedIds.has(TOPIC)).toBe(
      false,
    )
  })

  it('focuses', () => {
    expect(applyTreeAction(UNFOCUSED, { kind: 'focus', id: TOPIC }).focusedId).toBe(TOPIC)
  })

  it('clears focus', () => {
    const focused = applyTreeAction(UNFOCUSED, { kind: 'focus', id: TOPIC })

    expect(applyTreeAction(focused, { kind: 'clear-focus' }).focusedId).toBeUndefined()
  })

  it('leaves the view untouched for a move, which changes nothing', () => {
    expect(applyTreeAction(UNFOCUSED, { kind: 'move', toId: TOPIC })).toBe(UNFOCUSED)
  })

  it('does not mutate the state it was given', () => {
    const before = UNFOCUSED

    applyTreeAction(before, { kind: 'collapse', id: TOPIC })

    expect(before.collapsedIds.size).toBe(0)
  })
})

describe('actions that change nothing', () => {
  it('returns the same view when expanding what is already open', () => {
    expect(applyTreeAction(UNFOCUSED, { kind: 'expand', id: TOPIC })).toBe(UNFOCUSED)
  })

  it('returns the same view when collapsing what is already closed', () => {
    const collapsed = applyTreeAction(UNFOCUSED, { kind: 'collapse', id: TOPIC })

    expect(applyTreeAction(collapsed, { kind: 'collapse', id: TOPIC })).toBe(collapsed)
  })

  it('returns the same view when focusing what is already focused', () => {
    const focused = applyTreeAction(UNFOCUSED, { kind: 'focus', id: TOPIC })

    expect(applyTreeAction(focused, { kind: 'focus', id: TOPIC })).toBe(focused)
  })

  /**
   * A new object here would invalidate the layout memo and re-walk the whole
   * Tree, which is exactly the work ADR 0061 asks to be bounded.
   */
  it('returns the same view when clearing focus that is not set', () => {
    expect(applyTreeAction(UNFOCUSED, { kind: 'clear-focus' })).toBe(UNFOCUSED)
  })
})
