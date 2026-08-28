/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { GARDEN_ITEM_KINDS } from '../domain/schema/itemIdentity'
import { KIND_LABELS } from '../domain/schema/kindLabels'
import { KIND_GLYPHS } from './kindGlyphs'
import { Workspace } from './Workspace'

/** A Garden with no Attachments; individual tests supply their own. */
const emptyRepository = () => new InMemoryGardenFileSystem({}, 'test-garden')

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
  return render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem: emptyRepository() }} />)
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
    return render(<Workspace garden={{ repositoryName: 'every-kind', index, fileSystem: emptyRepository() }} />)
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
    return render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)
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
    const { container } = render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)

    expect(container.querySelector('.garden-tree__cross-link--relates-to')).toBeInTheDocument()
    expect(container.querySelector('.garden-tree__cross-link--relates_to')).toBeNull()
  })
})

/**
 * ADR 0052: neither hide invalid files nor let one malformed file stop
 * unrelated research from opening.
 */
describe('Garden Diagnostics in the workspace', () => {
  const BRANCH_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
  const ROOT_ID = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
  const CLAIM_ID = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
  const NOWHERE = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0ZZW'

  const front = (lines: string[]) =>
    ['---', 'schema_version: 1', ...lines, 'created_at: 2026-08-01T10:00:00Z',
      'updated_at: 2026-08-01T10:00:00Z', '---', '', 'A body.', ''].join('\n')

  const healthy = {
    path: ['branches', 'topic.md'],
    text: front([`id: ${BRANCH_ID}`, 'kind: branch', 'title: A healthy topic', 'state: active']),
  }
  const evidence = {
    path: ['roots', 'e.md'],
    text: front([`id: ${ROOT_ID}`, 'kind: root', 'title: Evidence',
      'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x']),
  }
  /** Loads fine, but points at an item that is not here. */
  const flaggedClaim = {
    path: ['leaves', 'c.md'],
    text: front([`id: ${CLAIM_ID}`, 'kind: claim_leaf', 'title: Points nowhere',
      `parent_id: ${BRANCH_ID}`, 'supported_by:', `  - ${ROOT_ID}`,
      'relations:', '  - type: contradicts', `    target: ${NOWHERE}`]),
  }
  /** Never parses at all, so it has no identity to report. */
  const rubbish = { path: ['branches', 'rubbish.md'], text: 'not a Garden item\n' }

  async function renderWith(files: { path: string[]; text: string }[]) {
    const index = await buildGardenIndex(files)
    return { ...render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />), index }
  }

  it('shows how many files need attention', async () => {
    await renderWith([healthy, evidence, flaggedClaim, rubbish])

    expect(screen.getByRole('button', { name: /2 Diagnostics/ })).toBeInTheDocument()
  })

  it('uses the singular when only one file needs attention', async () => {
    await renderWith([healthy, rubbish])

    expect(screen.getByRole('button', { name: /1 Diagnostic$/ })).toBeInTheDocument()
  })

  it('offers nothing to open when every file validated', async () => {
    await renderWith([healthy, evidence])

    expect(screen.queryByRole('button', { name: /Diagnostic/ })).not.toBeInTheDocument()
  })

  it('opens the list of Diagnostics', async () => {
    await renderWith([healthy, evidence, flaggedClaim, rubbish])

    await userEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))

    expect(screen.getByRole('complementary', { name: /Garden Diagnostics/ })).toBeInTheDocument()
  })

  it('explains what needs attention on each file', async () => {
    await renderWith([healthy, evidence, flaggedClaim, rubbish])
    await userEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))

    const panel = screen.getByRole('complementary', { name: /Garden Diagnostics/ })
    expect(panel).toHaveTextContent('Points nowhere')
    expect(panel).toHaveTextContent(/not an item in this Garden/)
  })

  it('names the path of a file that never parsed, having no item to name', async () => {
    await renderWith([healthy, rubbish])
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    expect(screen.getByRole('complementary', { name: /Garden Diagnostics/ })).toHaveTextContent(
      'branches/rubbish.md',
    )
  })

  it('reassures that everything else opened normally', async () => {
    await renderWith([healthy, evidence, flaggedClaim])
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    expect(screen.getByRole('complementary', { name: /Garden Diagnostics/ })).toHaveTextContent(
      /Everything else opened normally/i,
    )
  })

  it('jumps to an item that did load', async () => {
    await renderWith([healthy, evidence, flaggedClaim])
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Points nowhere' }))

    expect(screen.getByRole('heading', { level: 2, name: 'Points nowhere' })).toBeInTheDocument()
  })

  it('offers no jump for a file that never loaded', async () => {
    await renderWith([healthy, rubbish])
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    expect(
      screen.queryByRole('button', { name: 'branches/rubbish.md' }),
    ).not.toBeInTheDocument()
  })

  it('keeps every valid item in the Tree', async () => {
    await renderWith([healthy, evidence, flaggedClaim, rubbish])

    expect(screen.getByRole('treeitem', { name: /A healthy topic/ })).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /Evidence/ })).toBeInTheDocument()
  })

  // Marked, not hidden.
  it('keeps a flagged item in the Tree and marks it as needing attention', async () => {
    await renderWith([healthy, evidence, flaggedClaim])

    const node = screen.getByRole('treeitem', { name: /Points nowhere/ })
    expect(node).toBeInTheDocument()
    expect(node).toHaveAttribute('aria-invalid', 'true')
  })

  it('does not mark an item that is fine', async () => {
    await renderWith([healthy, evidence, flaggedClaim])

    expect(screen.getByRole('treeitem', { name: /A healthy topic/ })).not.toHaveAttribute(
      'aria-invalid',
    )
  })

  it('says on the item itself that it cannot be changed yet', async () => {
    await renderWith([healthy, evidence, flaggedClaim])
    await userEvent.click(screen.getByRole('treeitem', { name: /Points nowhere/ }))

    expect(screen.getByRole('complementary', { name: /Selected item/ })).toHaveTextContent(
      /cannot be changed until it validates/i,
    )
  })

  it('says nothing of the sort on an item that is fine', async () => {
    await renderWith([healthy, evidence, flaggedClaim])
    await userEvent.click(screen.getByRole('treeitem', { name: /A healthy topic/ }))

    expect(screen.getByRole('complementary', { name: /Selected item/ })).not.toHaveTextContent(
      /cannot be changed/i,
    )
  })

  it('still shows the flagged item’s content, because it is readable', async () => {
    await renderWith([healthy, evidence, flaggedClaim])
    await userEvent.click(screen.getByRole('treeitem', { name: /Points nowhere/ }))

    expect(screen.getByRole('complementary', { name: /Selected item/ })).toHaveTextContent(
      'A body.',
    )
  })

  it('returns to the item panel after jumping from the list', async () => {
    await renderWith([healthy, evidence, flaggedClaim])
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Points nowhere' }))

    expect(
      screen.queryByRole('complementary', { name: /Garden Diagnostics/ }),
    ).not.toBeInTheDocument()
  })
})

// "A Garden whose every file is malformed still opens and explains itself."
describe('a workspace where nothing is valid', () => {
  it('opens, shows an empty Tree, and explains every file', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'a.md'], text: 'no frontmatter\n' },
      { path: ['roots', 'b.md'], text: '---\nkind: [unclosed\n---\n\nbody\n' },
    ])
    render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)

    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.queryAllByRole('treeitem')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: /2 Diagnostics/ }))
    const panel = screen.getByRole('complementary', { name: /Garden Diagnostics/ })
    expect(panel).toHaveTextContent('branches/a.md')
    expect(panel).toHaveTextContent('roots/b.md')
  })
})

describe('a Diagnostic for a file with nothing to name', () => {
  it('heads the entry with its path once, not twice', async () => {
    const index = await buildGardenIndex([
      { path: ['seeds', 'lost-note.md'], text: 'pasted in without frontmatter\n' },
    ])
    render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    const panel = screen.getByRole('complementary', { name: /Garden Diagnostics/ })
    const occurrences = (panel.textContent ?? '').split('seeds/lost-note.md').length - 1
    expect(occurrences).toBe(1)
  })

  it('still shows the path for a file that does name an item', async () => {
    const index = await buildGardenIndex([
      {
        path: ['branches', 'broken.md'],
        text: ['---', 'schema_version: 1', 'id: branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W',
          'kind: branch', 'title: Missing its state', 'created_at: 2026-08-01T10:00:00Z',
          'updated_at: 2026-08-01T10:00:00Z', '---', '', 'b', ''].join('\n'),
      },
    ])
    render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    const panel = screen.getByRole('complementary', { name: /Garden Diagnostics/ })
    expect(panel).toHaveTextContent('Missing its state')
    expect(panel).toHaveTextContent('branches/broken.md')
  })
})

describe('two files claiming one id, in the workspace', () => {
  const ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
  const claimant = (title: string) =>
    ['---', 'schema_version: 1', `id: ${ID}`, 'kind: branch', `title: ${title}`, 'state: active',
      'created_at: 2026-08-01T10:00:00Z', 'updated_at: 2026-08-01T10:00:00Z', '---', '', 'b', ''].join('\n')

  async function renderDuplicated() {
    const index = await buildGardenIndex([
      { path: ['branches', 'real.md'], text: claimant('The real one') },
      { path: ['branches', 'copy.md'], text: claimant('The impostor') },
    ])
    return render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)
  }

  it('does not mark the surviving item as needing attention', async () => {
    await renderDuplicated()

    expect(screen.getByRole('treeitem', { name: /The real one/ })).not.toHaveAttribute(
      'aria-invalid',
    )
  })

  it('does not tell the surviving item it cannot be changed', async () => {
    await renderDuplicated()
    await userEvent.click(screen.getByRole('treeitem', { name: /The real one/ }))

    expect(screen.getByRole('complementary', { name: /Selected item/ })).not.toHaveTextContent(
      /cannot be changed/i,
    )
  })

  it('lists the losing file without offering a jump to the surviving item', async () => {
    await renderDuplicated()
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    const panel = screen.getByRole('complementary', { name: /Garden Diagnostics/ })
    expect(panel).toHaveTextContent('The impostor')
    expect(panel).toHaveTextContent('branches/copy.md')
    expect(screen.queryByRole('button', { name: 'The impostor' })).not.toBeInTheDocument()
  })
})

/**
 * ADR 0057: a validated relative Attachment renders, and it does so from bytes
 * read out of the chosen folder — never from a URL the browser resolves.
 */
describe('Attachments in the reading panel', () => {
  const BRANCH_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'

  const itemWith = (body: string) =>
    ['---', 'schema_version: 1', `id: ${BRANCH_ID}`, 'kind: branch', 'title: A topic',
      'state: active', 'created_at: 2026-08-01T10:00:00Z', 'updated_at: 2026-08-01T10:00:00Z',
      '---', '', body, ''].join('\n')

  async function renderWithAttachment(body: string, files: Record<string, string> = {}) {
    const index = await buildGardenIndex([{ path: ['branches', 'b.md'], text: itemWith(body) }])
    const fileSystem = new InMemoryGardenFileSystem(files, 'test-garden')
    const rendered = render(
      <Workspace garden={{ repositoryName: 'g', index, fileSystem }} />,
    )
    await userEvent.click(screen.getByRole('treeitem', { name: /A topic/ }))
    return rendered
  }

  it('gives a valid Attachment a source read from the folder', async () => {
    const { container } = await renderWithAttachment('![diagram](attachments/diagram.png)', {
      'attachments/diagram.png': 'pretend png bytes',
    })

    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('blob:')),
    )
  })

  // The point: nothing is fetched, and no path is resolved against the page.
  it('never gives an Attachment a path the browser would resolve', async () => {
    const { container } = await renderWithAttachment('![diagram](attachments/diagram.png)', {
      'attachments/diagram.png': 'bytes',
    })

    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src'))
    expect(container.querySelector('img')?.getAttribute('src')).not.toContain('attachments/')
  })

  it('says what was meant to be there when the Attachment is missing', async () => {
    const { container } = await renderWithAttachment('![diagram](attachments/absent.png)')

    await waitFor(() => expect(container.querySelector('.refused-media')).not.toBeNull())
    expect(container.textContent).toContain('diagram')
  })

  // SVG can carry script, and an Attachment is untrusted like anything else.
  it('refuses to render an SVG Attachment', async () => {
    const { container } = await renderWithAttachment('![logo](attachments/logo.svg)', {
      'attachments/logo.svg': '<svg onload="globalThis.owned = true"></svg>',
    })

    await waitFor(() => expect(container.querySelector('.refused-media')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders a remote image as a link rather than fetching it', async () => {
    const { container } = await renderWithAttachment('![tracker](https://evil.example/p.png)')

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a.remote-media')).toHaveAttribute(
      'href',
      'https://evil.example/p.png',
    )
  })

  it('renders nothing loadable for a path that leaves the Garden', async () => {
    const { container } = await renderWithAttachment('![x](../../../etc/passwd)')

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-attachment]')).toBeNull()
  })
})

/**
 * "Hostile content in an item title or frontmatter value is treated with the
 * same distrust as body content."
 */
describe('hostile titles', () => {
  const HOSTILE = '<img src=x onerror="globalThis.owned = true">'

  async function renderHostileTitle() {
    const index = await buildGardenIndex([
      {
        path: ['branches', 'b.md'],
        text: ['---', 'schema_version: 1', 'id: branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W',
          'kind: branch', `title: '${HOSTILE}'`, 'state: active',
          'created_at: 2026-08-01T10:00:00Z', 'updated_at: 2026-08-01T10:00:00Z',
          '---', '', 'A body.', ''].join('\n'),
      },
    ])
    expect(index.diagnostics, JSON.stringify(index.diagnostics)).toEqual([])
    return render(<Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />)
  }

  it('creates no element from a hostile title in the Tree', async () => {
    const { container } = await renderHostileTitle()

    expect(container.querySelector('img[onerror]')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })

  it('creates no active attribute anywhere from a hostile title', async () => {
    const { container } = await renderHostileTitle()

    const active = [...container.querySelectorAll('*')].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.name).filter((n) => n.startsWith('on')),
    )
    expect(active).toEqual([])
  })

  it('shows the hostile title as text instead', async () => {
    const { container } = await renderHostileTitle()

    expect(container.textContent).toContain('onerror')
  })

  it('creates no element from a hostile title in the reading panel', async () => {
    await renderHostileTitle()
    await userEvent.click(screen.getAllByRole('treeitem')[0] as HTMLElement)

    const panel = screen.getByRole('complementary', { name: /Selected item/ })
    expect(panel.querySelector('img')).toBeNull()
    expect(panel.querySelector('script')).toBeNull()
  })

  it('creates no element from a hostile Diagnostic message either', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', `${HOSTILE}.md`], text: 'no frontmatter\n' },
    ])
    const { container } = render(
      <Workspace garden={{ repositoryName: 'g', index, fileSystem: emptyRepository() }} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Diagnostic/ }))

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('onerror')
  })
})

/**
 * CONTEXT.md defines an Attachment as any user-owned supporting file, not only
 * an image. A relative href would navigate the application away and take the
 * folder permission with it, so a link gets its bytes the same way.
 */
describe('non-image Attachments', () => {
  const BRANCH_ID = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'

  async function renderLinkTo(body: string, files: Record<string, string | Uint8Array> = {}) {
    const index = await buildGardenIndex([
      {
        path: ['branches', 'b.md'],
        text: ['---', 'schema_version: 1', `id: ${BRANCH_ID}`, 'kind: branch', 'title: A topic',
          'state: active', 'created_at: 2026-08-01T10:00:00Z', 'updated_at: 2026-08-01T10:00:00Z',
          '---', '', body, ''].join('\n'),
      },
    ])
    const rendered = render(
      <Workspace
        garden={{ repositoryName: 'g', index, fileSystem: new InMemoryGardenFileSystem(files, 'g') }}
      />,
    )
    await userEvent.click(screen.getByRole('treeitem', { name: /A topic/ }))
    return rendered
  }

  it('opens a PDF Attachment from bytes read out of the folder', async () => {
    const { container } = await renderLinkTo('[paper](attachments/paper.pdf)', {
      'attachments/paper.pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    })

    await waitFor(() =>
      expect(container.querySelector('a[download]')).toHaveAttribute(
        'href',
        expect.stringContaining('blob:'),
      ),
    )
  })

  it('names the file it downloads', async () => {
    const { container } = await renderLinkTo('[paper](attachments/paper.pdf)', {
      'attachments/paper.pdf': 'bytes',
    })

    await waitFor(() =>
      expect(container.querySelector('a[download]')).toHaveAttribute('download', 'paper.pdf'),
    )
  })

  it('opens it away from the Garden, so the folder stays open behind it', async () => {
    const { container } = await renderLinkTo('[paper](attachments/paper.pdf)', {
      'attachments/paper.pdf': 'bytes',
    })

    await waitFor(() => expect(container.querySelector('a[download]')).not.toBeNull())
    expect(container.querySelector('a[download]')).toHaveAttribute('target', '_blank')
  })

  it('says so when the linked Attachment is not there', async () => {
    const { container } = await renderLinkTo('[paper](attachments/absent.pdf)')

    await waitFor(() => expect(container.querySelector('.refused-media')).not.toBeNull())
    expect(container.textContent).toContain('paper')
  })

  it('renders no link at all for a path that leaves the Garden', async () => {
    const { container } = await renderLinkTo('[escape](../../../etc/passwd)')

    expect(container.querySelector('.item-panel__body a')).toBeNull()
    expect(container.textContent).toContain('escape')
  })
})
