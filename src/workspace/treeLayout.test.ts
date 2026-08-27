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

    expect(layout.links).toEqual([
      expect.objectContaining({ sourceId: ATTENTION, targetId: OPTIMISERS }),
    ])
  })

  it('draws no link from the implicit trunk to a top-level item', async () => {
    const layout = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers' },
    ])

    expect(layout.links).toEqual([])
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

  // The Tree is drawn at natural size, so the box stays tight to the content:
  // a label must not change size with how much research a person has done.
  it('keeps the viewBox tight to the content rather than padding it out', async () => {
    const small = await layoutOf([{ id: ATTENTION, title: 'Attention' }])
    const larger = await layoutOf([
      { id: ATTENTION, title: 'Attention' },
      { id: OPTIMISERS, title: 'Optimisers', parentId: ATTENTION },
      { id: SCALING, title: 'Scaling', parentId: ATTENTION },
    ])

    expect(larger.viewBox.width).toBeGreaterThan(small.viewBox.width)
  })

  it('lays out an empty Garden without failing', async () => {
    const layout = await layoutOf([])

    expect(layout.nodes).toEqual([])
    expect(layout.links).toEqual([])
    expect(layout.viewBox.width).toBeGreaterThan(0)
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
