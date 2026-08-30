import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { computeTreeLayout, displayLabel } from './treeLayout'

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'
const SCALING = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V3Y'

function branchFile(id: string, title: string, parentId?: string) {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
${parentId ? `parent_id: ${parentId}\n` : ''}---

Body.
`
}

async function layoutOf(files: { id: string; title: string; parentId?: string }[]) {
  const index = await buildGardenIndex(
    files.map((file, position) => ({
      path: ['branches', `${position}.md`],
      text: branchFile(file.id, file.title, file.parentId),
    })),
  )
  return computeTreeLayout(index)
}

describe('computing the Tree layout', () => {
  it('places a node for each indexed item', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
    ])

    expect(layout.nodes.map((node) => node.id).sort()).toEqual([ATTENTION, OPTIMISERS].sort())
  })

  it('carries the title and kind each node needs to label itself', async () => {
    const layout = await layoutOf([{ id: ATTENTION, title: 'Attention' }])

    expect(layout.nodes[0]).toMatchObject({ title: 'Attention', kind: 'branch' })
  })

  // ADR 0014: one permanent Tree with an implicit trunk for top-level Branches.
  it('does not render the implicit trunk as an item', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers' },
    ])

    expect(layout.nodes).toHaveLength(2)
  })

  it('gives a nested item a greater depth than its parent', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
    ])

    const depthOf = (id: string) => layout.nodes.find((node) => node.id === id)?.depth

    expect(depthOf(OPTIMISERS)).toBeGreaterThan(depthOf(ATTENTION) as number)
  })

  it('separates sibling nodes so neither is drawn on top of the other', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers' },
    ])

    const [first, second] = layout.nodes
    expect(first?.x).not.toBe(second?.x)
  })

  it('links each child to its parent', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
    ])

    expect(layout.links).toContainEqual(
      expect.objectContaining({ sourceId: ATTENTION, targetId: OPTIMISERS }),
    )
  })

  /**
   * ADR 0043 wants a recognizable trunk with limbs. ADR 0014's trunk is
   * "implicit" in the sense that it is not an item a person creates, which
   * drawing it does not change.
   */
  it('grows a limb from the trunk to each top-level item', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers' },
    ])

    const fromTrunk = layout.links.filter((link) => link.sourceId === undefined)
    expect(fromTrunk.map((link) => link.targetId).sort()).toEqual(
      [ATTENTION, OPTIMISERS].sort(),
    )
  })

  // ADR 0014's trunk is implicit: it is drawn, but it is never an item.
  it('never makes the trunk an item in the Tree', async () => {
    const layout = await layoutOf([{ id: ATTENTION, title: 'Attention' }])

    expect(layout.nodes.every((node) => node.id.includes('_'))).toBe(true)
    expect(layout.links.some((link) => link.sourceId === undefined)).toBe(true)
  })

  it('gives each link a path for drawing', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
    ])

    expect(layout.links[0]?.path).toMatch(/^M/)
  })

  it('reports a viewBox that contains every node', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
      { id: SCALING, title: 'Scaling', parentId: ATTENTION },
    ])

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(layout.viewBox.minX)
      expect(node.x).toBeLessThanOrEqual(layout.viewBox.minX + layout.viewBox.width)
      expect(node.y).toBeGreaterThanOrEqual(layout.viewBox.minY)
      expect(node.y).toBeLessThanOrEqual(layout.viewBox.minY + layout.viewBox.height)
    }
  })

  /*
   * The Tree is drawn at natural size, so the box grows with the content: a
   * label must not change size with how much research a person has done. The
   * trunk and soil set a floor, since they are drawn even in an empty Garden.
   */
  it('grows the viewBox as the Garden outgrows the trunk', async () => {
    const small = await layoutOf([{ id: ATTENTION, title: 'Attention' }])
    const wider = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers' },
      { id: SCALING, title: 'Scaling' },
      { id: `branch_01HQ8X2K3M4N5P6Q7R8S9T0V4Z`, title: 'Fourth' },
      { id: `branch_01HQ8X2K3M4N5P6Q7R8S9T0V5Z`, title: 'Fifth' },
    ])

    expect(wider.viewBox.width).toBeGreaterThan(small.viewBox.width)
  })

  it('draws the trunk and soil even when the Garden is empty', async () => {
    const layout = await layoutOf([])

    expect(layout.trunk.path).toMatch(/^M/)
    expect(layout.trunk.soilTo).toBeGreaterThan(layout.trunk.soilFrom)
    expect(layout.viewBox.height).toBeGreaterThan(0)
  })

  it('keeps an empty Garden branch-free', async () => {
    const layout = await layoutOf([])

    expect(layout.nodes).toEqual([])
    expect(layout.links).toEqual([])
    expect(layout.viewBox.width).toBeGreaterThan(0)
  })

  it('ends the permanent trunk at the top-level limb seam', async () => {
    const layout = await layoutOf([{ id: ATTENTION, title: 'Attention' }])

    expect(layout.trunk.path).toContain('2,-150')
    expect(layout.links.find((link) => link.sourceId === undefined)?.path).toMatch(/^M0,-150 /)
    expect(layout.trunk.detailPath).toMatch(/^M1,14 C/)
  })

  // The layout is derived from the index, so opening the same Garden twice must
  // put the Tree in the same place.
  it('is deterministic for the same index', async () => {
    const files = [
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
    ]

    expect(await layoutOf(files)).toEqual(await layoutOf(files))
  })
})

/**
 * ADR 0043 and ADR 0044: the text label carries meaning and has to stay
 * scannable. Several siblings with long titles otherwise overlap into
 * unreadable mush.
 */
describe('the label a node displays', () => {
  it('shows a short title in full', () => {
    expect(displayLabel('Optimisers')).toBe('Optimisers')
  })

  it('shortens a title that would overrun its neighbours', () => {
    const shown = displayLabel('Does sparsity hold outside its own benchmark?')

    expect(shown.length).toBeLessThanOrEqual(23)
    expect(shown.endsWith('\u2026')).toBe(true)
  })

  it('breaks at a word boundary when one is close to the limit', () => {
    expect(displayLabel('Maybe memory bandwidth dominates')).toBe('Maybe memory\u2026')
  })

  it('still shortens a single unbroken word', () => {
    const shown = displayLabel('a'.repeat(60))

    expect(shown.length).toBeLessThanOrEqual(23)
    expect(shown.endsWith('\u2026')).toBe(true)
  })

  it('leaves a title exactly at the limit untouched', () => {
    const exact = 'b'.repeat(22)

    expect(displayLabel(exact)).toBe(exact)
  })

  it('never leaves a trailing space before the ellipsis', () => {
    expect(displayLabel('Attention mechanisms and other things')).not.toMatch(/ \u2026$/)
  })
})

/**
 * CONTEXT.md: a Cross-link is an explicit relationship outside an item's
 * primary placement. Drawing them is what keeps the Tree a legible one-parent
 * projection while the graph underneath stays truthful (ADR 0008).
 */
describe('Cross-links in the layout', () => {
  const ROOT_ID = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
  const CLAIM_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
  const CLAIM_2_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C2W'
  const BRANCH_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'

  const frontmatter = (lines: string[]) =>
    ['---', 'schema_version: 1', ...lines, 'created_at: 2026-08-01T10:00:00Z',
      'updated_at: 2026-08-01T10:00:00Z', '---', '', 'A body.', ''].join('\n')

  async function contradictingClaims() {
    return computeTreeLayout(
      await buildGardenIndex([
        { path: ['branches', 'b.md'], text: frontmatter([`id: ${BRANCH_ID}`, 'kind: branch', 'title: Topic', 'state: active']) },
        { path: ['roots', 'r.md'], text: frontmatter([`id: ${ROOT_ID}`, 'kind: root', 'title: Evidence', 'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x']) },
        { path: ['leaves', 'c1.md'], text: frontmatter([`id: ${CLAIM_ID}`, 'kind: claim_leaf', 'title: One', `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`, 'relations:', '  - type: contradicts', `    target: ${CLAIM_2_ID}`]) },
        { path: ['leaves', 'c2.md'], text: frontmatter([`id: ${CLAIM_2_ID}`, 'kind: claim_leaf', 'title: Two', `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`]) },
      ]),
    )
  }

  it('draws the Contradicts relationship between the two Claims', async () => {
    const layout = await contradictingClaims()

    expect(
      layout.crossLinks.some(
        (link) =>
          link.type === 'contradicts' &&
          [link.sourceId, link.targetId].sort().join() === [CLAIM_ID, CLAIM_2_ID].sort().join(),
      ),
    ).toBe(true)
  })

  it('draws the evidence relationship from the Root to each Claim', async () => {
    const layout = await contradictingClaims()

    const supports = layout.crossLinks.filter((link) => link.type === 'supports')
    expect(supports).toHaveLength(2)
    expect(supports.every((link) => link.sourceId === ROOT_ID)).toBe(true)
  })

  it('draws no Cross-link for a Parent placement, which is structure', async () => {
    const layout = await contradictingClaims()

    expect(layout.crossLinks.some((link) => link.type === 'parent')).toBe(false)
  })

  it('leaves the primary placement untouched by a Cross-link', async () => {
    const layout = await contradictingClaims()

    const claim = layout.nodes.find((node) => node.id === CLAIM_ID)
    expect(claim?.depth).toBe(2)
  })

  it('gives every Cross-link a path for drawing', async () => {
    const layout = await contradictingClaims()

    for (const link of layout.crossLinks) expect(link.path).toMatch(/^M/)
  })

  it('bows the Cross-link away from a straight chord, so siblings stay legible', async () => {
    const layout = await contradictingClaims()
    const contradicts = layout.crossLinks.find((link) => link.type === 'contradicts')

    expect(contradicts?.path).toContain('Q')
  })

  it('draws no Cross-link when the Garden has none', async () => {
    const layout = computeTreeLayout(
      await buildGardenIndex([
        { path: ['branches', 'b.md'], text: frontmatter([`id: ${BRANCH_ID}`, 'kind: branch', 'title: Topic', 'state: active']) },
      ]),
    )

    expect(layout.crossLinks).toEqual([])
  })
})

/**
 * ADR 0061: collapse and focus bound the drawn Tree. Bounding the node count is
 * only half of it -- a Cross-link to something no longer on screen would have
 * nowhere to land.
 */
describe('what collapse and focus do to the drawing', () => {
  const R = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
  const C1 = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
  const C2 = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C2W'
  const TOPIC = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
  const OTHER = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B2W'

  const doc = (lines: string[]) =>
    ['---', 'schema_version: 1', ...lines, 'created_at: 2026-08-01T10:00:00Z',
      'updated_at: 2026-08-01T10:00:00Z', '---', '', 'A body.', ''].join('\n')

  async function contradictingGarden() {
    const index = await buildGardenIndex([
      { path: ['branches', 'a.md'], text: doc([`id: ${TOPIC}`, 'kind: branch', 'title: Topic', 'state: active']) },
      { path: ['branches', 'b.md'], text: doc([`id: ${OTHER}`, 'kind: branch', 'title: Other', 'state: active']) },
      { path: ['roots', 'r.md'], text: doc([`id: ${R}`, 'kind: root', 'title: Evidence', 'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x']) },
      { path: ['leaves', 'c1.md'], text: doc([`id: ${C1}`, 'kind: claim_leaf', 'title: One', `parent_id: ${TOPIC}`, 'supported_by:', `  - ${R}`, 'relations:', '  - type: contradicts', `    target: ${C2}`]) },
      { path: ['leaves', 'c2.md'], text: doc([`id: ${C2}`, 'kind: claim_leaf', 'title: Two', `parent_id: ${TOPIC}`, 'supported_by:', `  - ${R}`]) },
    ])
    expect(index.diagnostics, JSON.stringify(index.diagnostics)).toEqual([])
    return index
  }

  it('draws every node when nothing is collapsed', async () => {
    expect(computeTreeLayout(await contradictingGarden()).nodes).toHaveLength(5)
  })

  it('draws fewer nodes once a Branch is collapsed', async () => {
    const layout = computeTreeLayout(await contradictingGarden(), {
      collapsedIds: new Set([TOPIC]),
      focusedId: undefined,
    })

    expect(layout.nodes).toHaveLength(3)
  })

  it('draws no Cross-link to a node that has been folded away', async () => {
    const layout = computeTreeLayout(await contradictingGarden(), {
      collapsedIds: new Set([TOPIC]),
      focusedId: undefined,
    })

    expect(layout.crossLinks).toEqual([])
  })

  it('keeps the Cross-links between nodes that are both still drawn', async () => {
    const layout = computeTreeLayout(await contradictingGarden())

    expect(layout.crossLinks.filter((link) => link.type === 'contradicts')).toHaveLength(1)
  })

  it('drops a Cross-link whose far end is outside the focused Branch', async () => {
    const layout = computeTreeLayout(await contradictingGarden(), {
      collapsedIds: new Set(),
      focusedId: TOPIC,
    })

    // The Root sits outside the focused Branch, so its evidence links have
    // nowhere to land; the contradiction between the two Claims survives.
    expect(layout.crossLinks.filter((link) => link.type === 'supports')).toEqual([])
    expect(layout.crossLinks.filter((link) => link.type === 'contradicts')).toHaveLength(1)
  })

  it('shrinks the drawn box when the Tree is narrowed', async () => {
    const index = await contradictingGarden()
    const whole = computeTreeLayout(index)
    const narrowed = computeTreeLayout(index, { collapsedIds: new Set(), focusedId: OTHER })

    expect(narrowed.viewBox.height).toBeLessThan(whole.viewBox.height)
  })
})

/**
 * ADR 0028 puts Seeds and Roots in their own stratum, and ADR 0043 asks the
 * Tree to stay recognizably botanical. Together those make the separation
 * literal: evidence is what the Garden stands in, and it sits below ground.
 */
describe('the strata', () => {
  const SEED = 'seed_01HQ8X2K3M4N5P6Q7R8S9T0S1W'
  const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
  const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
  const CLAIM = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'

  const doc = (lines: string[]) =>
    ['---', 'schema_version: 1', ...lines, 'created_at: 2026-08-01T10:00:00Z',
      'updated_at: 2026-08-01T10:00:00Z', '---', '', 'A body.', ''].join('\n')

  async function layered() {
    const index = await buildGardenIndex([
      { path: ['seeds', 's.md'], text: doc([`id: ${SEED}`, 'kind: seed', 'title: A capture']) },
      { path: ['roots', 'r.md'], text: doc([`id: ${ROOT}`, 'kind: root', 'title: Evidence', 'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x']) },
      { path: ['branches', 'b.md'], text: doc([`id: ${BRANCH}`, 'kind: branch', 'title: Topic', 'state: active']) },
      { path: ['leaves', 'c.md'], text: doc([`id: ${CLAIM}`, 'kind: claim_leaf', 'title: A claim', `parent_id: ${BRANCH}`, 'supported_by:', `  - ${ROOT}`]) },
    ])
    expect(index.diagnostics, JSON.stringify(index.diagnostics)).toEqual([])
    return computeTreeLayout(index)
  }

  const nodeIn = (layout: Awaited<ReturnType<typeof layered>>, id: string) =>
    layout.nodes.find((node) => node.id === id)

  it('buries evidence below the soil line', async () => {
    const layout = await layered()

    expect(nodeIn(layout, ROOT)?.y).toBeGreaterThan(layout.trunk.soilY)
  })

  it('buries a Seed too, being the original capture the Garden grew from', async () => {
    const layout = await layered()

    expect(nodeIn(layout, SEED)?.y).toBeGreaterThan(layout.trunk.soilY)
  })

  it('raises a Branch above the soil line', async () => {
    const layout = await layered()

    expect(nodeIn(layout, BRANCH)?.y).toBeLessThan(layout.trunk.soilY)
  })

  it('raises a Claim Leaf higher still, growing outward from its Branch', async () => {
    const layout = await layered()

    expect(nodeIn(layout, CLAIM)?.y).toBeLessThan(nodeIn(layout, BRANCH)?.y as number)
  })

  it('leaves a clear trunk between the deepest canopy and the soil', async () => {
    const layout = await layered()
    const lowestAbove = Math.max(
      ...layout.nodes.filter((node) => node.y < layout.trunk.soilY).map((node) => node.y),
    )

    expect(layout.trunk.soilY - lowestAbove).toBeGreaterThan(60)
  })

  it('spans the soil line across everything drawn', async () => {
    const layout = await layered()
    const xs = layout.nodes.map((node) => node.x)

    expect(layout.trunk.soilFrom).toBeLessThanOrEqual(Math.min(...xs))
    expect(layout.trunk.soilTo).toBeGreaterThanOrEqual(Math.max(...xs))
  })

  it('spreads roots below the soil', async () => {
    const layout = await layered()

    expect(layout.trunk.rootPaths.length).toBeGreaterThan(1)
    for (const path of layout.trunk.rootPaths) expect(path).toMatch(/^M0,/)
  })

  it('grows the trunk limb to a buried item downward and to a Branch upward', async () => {
    const layout = await layered()
    const toRoot = layout.links.find((l) => l.sourceId === undefined && l.targetId === ROOT)
    const toBranch = layout.links.find((l) => l.sourceId === undefined && l.targetId === BRANCH)

    expect(toRoot?.path).toMatch(/^M0,0 /)
    expect(toBranch?.path).toMatch(/^M0,-\d+ /)
  })
})
