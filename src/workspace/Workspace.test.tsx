/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { GARDEN_ITEM_KINDS } from '../domain/schema/itemIdentity'
import { KIND_LABELS } from '../domain/schema/kindLabels'
import { KIND_GLYPHS } from './kindGlyphs'
import { Workspace } from './Workspace'

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'

function branchFile(id: string, title: string, body: string, parentId?: string) {
  return `---
schema_version: 1
id: ${id}
kind: branch
title: ${title}
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
${parentId ? `parent_id: ${parentId}\n` : ''}---

${body}
`
}

async function renderWorkspace(
  files: { id: string; title: string; body: string; parentId?: string }[],
) {
  const index = await buildGardenIndex(
    files.map((file, position) => ({
      path: ['branches', `${position}.md`],
      text: branchFile(file.id, file.title, file.body, file.parentId),
    })),
  )
  return render(<Workspace garden={{ repositoryName: 'my-garden', index }} />)
}

const oneBranch = [{ id: ATTENTION, title: 'Attention mechanisms', body: 'What I am collecting.' }]

describe('the Tree', () => {
  // ADR 0049: a purpose-built SVG with semantic labels, not a generic graph.
  it('is exposed as a tree to assistive technology', async () => {
    await renderWorkspace(oneBranch)

    expect(screen.getByRole('tree')).toBeInTheDocument()
  })

  it('gives the Tree an accessible name', async () => {
    await renderWorkspace(oneBranch)

    expect(screen.getByRole('tree')).toHaveAccessibleName(/garden/i)
  })

  it('renders a semantically labelled node for each item', async () => {
    await renderWorkspace(oneBranch)

    expect(screen.getByRole('treeitem', { name: /Attention mechanisms/ })).toBeInTheDocument()
  })

  // ADR 0044: kind is carried by shape, icon, label, and colour together, so a
  // node's accessible name must state its kind rather than rely on appearance.
  it('names the kind of each node, not only its title', async () => {
    await renderWorkspace(oneBranch)

    expect(screen.getByRole('treeitem', { name: /Branch/i })).toBeInTheDocument()
  })

  it('renders a node for a nested item too', async () => {
    await renderWorkspace([
      ...oneBranch,
      { id: OPTIMISERS, title: 'Optimisers', body: 'Nested.', parentId: ATTENTION },
    ])

    expect(screen.getByRole('treeitem', { name: /Optimisers/ })).toBeInTheDocument()
  })

  it('reports how deep each node sits', async () => {
    await renderWorkspace([
      ...oneBranch,
      { id: OPTIMISERS, title: 'Optimisers', body: 'Nested.', parentId: ATTENTION },
    ])

    expect(screen.getByRole('treeitem', { name: /Optimisers/ })).toHaveAttribute(
      'aria-level',
      '2',
    )
  })

  it('shows an empty Garden without failing', async () => {
    await renderWorkspace([])

    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.queryAllByRole('treeitem')).toEqual([])
  })

  it('names the Garden Repository so a person knows which folder is open', async () => {
    await renderWorkspace(oneBranch)

    expect(screen.getByText('my-garden')).toBeInTheDocument()
  })
})

describe('the reading panel', () => {
  it('invites a selection before anything is chosen', async () => {
    await renderWorkspace(oneBranch)

    expect(screen.getByRole('complementary')).toHaveTextContent(/select/i)
  })

  it('opens the selected item’s content', async () => {
    await renderWorkspace(oneBranch)

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))

    expect(screen.getByRole('complementary')).toHaveTextContent('What I am collecting.')
  })

  it('shows the selected item’s title', async () => {
    await renderWorkspace(oneBranch)

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Attention mechanisms' }),
    ).toBeInTheDocument()
  })

  it('marks the selected node as selected', async () => {
    await renderWorkspace(oneBranch)

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))

    expect(screen.getByRole('treeitem', { name: /Attention mechanisms/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('switches to a different item when another node is chosen', async () => {
    await renderWorkspace([
      ...oneBranch,
      { id: OPTIMISERS, title: 'Optimisers', body: 'Nested body.', parentId: ATTENTION },
    ])

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention mechanisms/ }))
    await userEvent.click(screen.getByRole('treeitem', { name: /Optimisers/ }))

    expect(screen.getByRole('complementary')).toHaveTextContent('Nested body.')
    expect(screen.getByRole('complementary')).not.toHaveTextContent('What I am collecting.')
  })

  it('renders the body as Markdown rather than as raw text', async () => {
    await renderWorkspace([
      { id: ATTENTION, title: 'Attention', body: '## A subheading\n\n- a list item' },
    ])

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention/ }))

    expect(screen.getByRole('heading', { level: 2, name: 'A subheading' })).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('a list item')
  })

  // ADR 0056: the panel renders untrusted content, so the sanitizing boundary
  // has to hold here and not only in the renderer's own unit tests.
  it('renders hostile Markdown without creating active content', async () => {
    await renderWorkspace([
      {
        id: ATTENTION,
        title: 'Attention',
        body: '<img src=x onerror="globalThis.owned = true">\n\n<script>globalThis.owned = true</script>',
      },
    ])

    await userEvent.click(screen.getByRole('treeitem', { name: /Attention/ }))

    const panel = screen.getByRole('complementary')
    expect(panel.querySelector('script')).toBeNull()
    expect(
      [...panel.querySelectorAll('*')].flatMap((element) =>
        [...element.attributes].map((attribute) => attribute.name),
      ),
    ).not.toContain('onerror')
  })
})

/**
 * ADR 0044: every kind carries shape, icon, text label, and colour together.
 * Rendering one Garden holding all eight proves the Tree can tell them apart.
 */
describe('a Garden holding every kind', () => {
  const ULID = (n: number) => `01HQ8X2K3M4N5P6Q7R8S9T0V${n}W`
  const BRANCH_ID = `branch_${ULID(9)}`
  const ROOT_ID = `root_${ULID(8)}`

  const HARVEST_BODY = [
    '## Question',
    'q',
    '## Synthesis',
    's',
    '## Evidence',
    'e',
    '## Contradictions and uncertainty',
    'c',
    '## Open questions',
    'o',
  ].join('\n\n')

  function fileFor(kind: string, index: number) {
    const extra: Record<string, string[]> = {
      root: [
        'captured_at: 2026-08-01T09:00:00Z',
        'content_hash: sha256:abc123',
        'origin_url: https://example.com/paper',
      ],
      branch: ['state: active'],
      claim_leaf: [`parent_id: ${BRANCH_ID}`, `supported_by:`, `  - ${ROOT_ID}`],
      question_leaf: [`parent_id: ${BRANCH_ID}`],
      idea_leaf: [`parent_id: ${BRANCH_ID}`],
      observation_leaf: [`parent_id: ${BRANCH_ID}`],
      harvest: [`parent_id: ${BRANCH_ID}`, `supported_by:`, `  - ${ROOT_ID}`],
    }
    const id = kind === 'branch' ? BRANCH_ID : kind === 'root' ? ROOT_ID : `${kind}_${ULID(index)}`

    return {
      path: ['x', `${index}.md`],
      text: [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `kind: ${kind}`,
        `title: A ${KIND_LABELS[kind as keyof typeof KIND_LABELS]}`,
        ...(extra[kind] ?? []),
        'created_at: 2026-08-01T10:00:00Z',
        'updated_at: 2026-08-01T10:00:00Z',
        '---',
        '',
        kind === 'harvest' ? HARVEST_BODY : 'A body.',
        '',
      ].join('\n'),
    }
  }

  async function renderEveryKind() {
    const index = await buildGardenIndex(GARDEN_ITEM_KINDS.map((kind, at) => fileFor(kind, at)))
    expect(index.diagnostics, JSON.stringify(index.diagnostics)).toEqual([])
    return render(<Workspace garden={{ repositoryName: 'every-kind', index }} />)
  }

  it('renders a node for every kind', async () => {
    await renderEveryKind()

    expect(screen.getAllByRole('treeitem')).toHaveLength(GARDEN_ITEM_KINDS.length)
  })

  it.each([...GARDEN_ITEM_KINDS])('names the %s kind in its accessible label', async (kind) => {
    await renderEveryKind()

    expect(
      screen.getByRole('treeitem', { name: new RegExp(`^${KIND_LABELS[kind]}:`) }),
    ).toBeInTheDocument()
  })

  it('draws each kind with its own shape', async () => {
    const { container } = await renderEveryKind()

    const shapes = [...container.querySelectorAll('[data-shape]')].map((node) =>
      node.getAttribute('data-shape'),
    )
    expect(new Set(shapes).size).toBe(GARDEN_ITEM_KINDS.length)
  })

  it.each([...GARDEN_ITEM_KINDS])('draws the %s with the form ADR 0044 names', async (kind) => {
    const { container } = await renderEveryKind()

    const node = screen.getByRole('treeitem', { name: new RegExp(`^${KIND_LABELS[kind]}:`) })
    expect(node.querySelector('[data-shape]')?.getAttribute('data-shape')).toBe(
      KIND_GLYPHS[kind].shape,
    )
    expect(container).toBeTruthy()
  })

  it('shows the kind label in the reading panel too', async () => {
    await renderEveryKind()

    await userEvent.click(screen.getByRole('treeitem', { name: /^Harvest:/ }))

    expect(screen.getByRole('complementary')).toHaveTextContent('Harvest')
  })
})

/**
 * ADR 0008: the Tree gives each item one primary location while Cross-links
 * keep the graph underneath truthful. ADR 0018: neither side of a contradiction
 * is discarded.
 */
describe('Cross-links in the Tree', () => {
  const ROOT_ID = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
  const CLAIM_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
  const CLAIM_2_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C2W'
  const BRANCH_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'

  const front = (lines: string[]) =>
    ['---', 'schema_version: 1', ...lines, 'created_at: 2026-08-01T10:00:00Z',
      'updated_at: 2026-08-01T10:00:00Z', '---', '', 'A body.', ''].join('\n')

  async function renderContradiction() {
    const index = await buildGardenIndex([
      { path: ['branches', 'b.md'], text: front([`id: ${BRANCH_ID}`, 'kind: branch', 'title: Topic', 'state: active']) },
      { path: ['roots', 'r.md'], text: front([`id: ${ROOT_ID}`, 'kind: root', 'title: Evidence', 'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x']) },
      { path: ['leaves', 'c1.md'], text: front([`id: ${CLAIM_ID}`, 'kind: claim_leaf', 'title: Costs fall', `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`, 'relations:', '  - type: contradicts', `    target: ${CLAIM_2_ID}`]) },
      { path: ['leaves', 'c2.md'], text: front([`id: ${CLAIM_2_ID}`, 'kind: claim_leaf', 'title: Costs rise', `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`]) },
    ])
    expect(index.diagnostics, JSON.stringify(index.diagnostics)).toEqual([])
    return render(<Workspace garden={{ repositoryName: 'g', index }} />)
  }

  it('draws the Contradicts Cross-link', async () => {
    const { container } = await renderContradiction()

    expect(container.querySelector('[data-relation="contradicts"]')).toBeInTheDocument()
  })

  it('draws the evidence Cross-links from the Root', async () => {
    const { container } = await renderContradiction()

    expect(container.querySelectorAll('[data-relation="supports"]')).toHaveLength(2)
  })

  it('keeps both contradicting Claims in the Tree', async () => {
    await renderContradiction()

    expect(screen.getByRole('treeitem', { name: /Costs fall/ })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /Costs rise/ })).toBeInTheDocument()
  })

  it('leaves both Claims under their Branch, unmoved by the Cross-link', async () => {
    await renderContradiction()

    expect(screen.getByRole('treeitem', { name: /Costs fall/ })).toHaveAttribute('aria-level', '2')
    expect(screen.getByRole('treeitem', { name: /Costs rise/ })).toHaveAttribute('aria-level', '2')
  })

  // Cross-links are curves, so without a description they would be visible only
  // to someone looking at the picture.
  it('describes a node’s Cross-links to assistive technology', async () => {
    await renderContradiction()

    expect(screen.getByRole('treeitem', { name: /Costs fall/ })).toHaveAccessibleDescription(
      /Contradicts 1/,
    )
  })

  it('describes the Root’s evidence Cross-links', async () => {
    await renderContradiction()

    expect(screen.getByRole('treeitem', { name: /Evidence/ })).toHaveAccessibleDescription(
      /Supports 2/,
    )
  })

  it('gives a node with no Cross-links no description', async () => {
    await renderContradiction()

    expect(screen.getByRole('treeitem', { name: /^Branch:/ })).not.toHaveAccessibleDescription()
  })
})

describe('Cross-link styling hooks', () => {
  const ROOT_ID = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
  const CLAIM_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
  const CLAIM_2_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C2W'
  const BRANCH_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'

  const front = (lines: string[]) =>
    ['---', 'schema_version: 1', ...lines, 'created_at: 2026-08-01T10:00:00Z',
      'updated_at: 2026-08-01T10:00:00Z', '---', '', 'A body.', ''].join('\n')

  it('names the Cross-link class in kebab case, not identifier case', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'b.md'], text: front([`id: ${BRANCH_ID}`, 'kind: branch', 'title: T', 'state: active']) },
      { path: ['roots', 'r.md'], text: front([`id: ${ROOT_ID}`, 'kind: root', 'title: E', 'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x']) },
      { path: ['leaves', 'c1.md'], text: front([`id: ${CLAIM_ID}`, 'kind: claim_leaf', 'title: One', `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`, 'relations:', '  - type: relates_to', `    target: ${CLAIM_2_ID}`]) },
      { path: ['leaves', 'c2.md'], text: front([`id: ${CLAIM_2_ID}`, 'kind: claim_leaf', 'title: Two', `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`]) },
    ])
    const { container } = render(<Workspace garden={{ repositoryName: 'g', index }} />)

    expect(container.querySelector('.garden-tree__cross-link--relates-to')).toBeInTheDocument()
    expect(container.querySelector('.garden-tree__cross-link--relates_to')).toBeNull()
  })
})
