import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import {
  blockOnDiagnostics,
  blockOnMissingItem,
  diagnosticsForItem,
  ensureMutable,
} from './mutationGuard'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const BRANCH_2 = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B2W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
const CLAIM = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'

const file = (lines: string[]) =>
  [
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

const healthyBranch = {
  path: ['branches', 'topic.md'],
  text: file([`id: ${BRANCH}`, 'kind: branch', 'title: A healthy topic', 'state: active']),
}

const evidence = {
  path: ['roots', 'e.md'],
  text: file([
    `id: ${ROOT}`,
    'kind: root',
    'title: Evidence',
    'captured_at: 2026-08-01T09:00:00Z',
    'content_hash: sha256:x',
  ]),
}

describe('an item with no Diagnostics', () => {
  it('may be mutated', async () => {
    const index = await buildGardenIndex([healthyBranch])

    expect(ensureMutable(index, BRANCH)).toBeUndefined()
  })

  it('reports no Diagnostics of its own', async () => {
    const index = await buildGardenIndex([healthyBranch])

    expect(diagnosticsForItem(index, BRANCH)).toEqual([])
  })
})

// ADR 0052: a Diagnostic makes an item visible and auditable, but not writable.
describe('an item carrying a Diagnostic', () => {
  async function gardenWithBrokenRelationship() {
    return buildGardenIndex([
      healthyBranch,
      evidence,
      {
        path: ['leaves', 'c.md'],
        text: file([
          `id: ${CLAIM}`,
          'kind: claim_leaf',
          'title: A Claim pointing nowhere',
          `parent_id: ${BRANCH}`,
          'supported_by:',
          `  - ${ROOT}`,
          'relations:',
          '  - type: contradicts',
          `    target: claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0ZZW`,
        ]),
      },
    ])
  }

  it('is refused for mutation', async () => {
    const index = await gardenWithBrokenRelationship()

    expect(ensureMutable(index, CLAIM)).toBeDefined()
  })

  it('explains why, in terms of what has to be fixed', async () => {
    const index = await gardenWithBrokenRelationship()

    expect(ensureMutable(index, CLAIM)?.reason).toMatch(/Diagnostic/i)
    expect(ensureMutable(index, CLAIM)?.reason).toMatch(/not an item in this Garden/)
  })

  it('carries the Diagnostics themselves, so a surface can show them', async () => {
    const index = await gardenWithBrokenRelationship()

    expect(ensureMutable(index, CLAIM)?.diagnostics).toHaveLength(1)
  })

  it('leaves unrelated items mutable', async () => {
    const index = await gardenWithBrokenRelationship()

    expect(ensureMutable(index, BRANCH)).toBeUndefined()
    expect(ensureMutable(index, ROOT)).toBeUndefined()
  })

  it('still loads the item, because a Diagnostic is not a deletion', async () => {
    const index = await gardenWithBrokenRelationship()

    expect(index.items.get(CLAIM)?.item.title).toBe('A Claim pointing nowhere')
  })
})

describe('an item that never loaded', () => {
  async function gardenWithUnvalidatedFile() {
    return buildGardenIndex([
      healthyBranch,
      {
        path: ['branches', 'broken.md'],
        text: file([`id: ${BRANCH_2}`, 'kind: branch', 'title: Missing its state']),
      },
    ])
  }

  it('is refused for mutation', async () => {
    const index = await gardenWithUnvalidatedFile()

    expect(ensureMutable(index, BRANCH_2)).toBeDefined()
  })

  it('says the file has to validate first, rather than that it does not exist', async () => {
    const index = await gardenWithUnvalidatedFile()

    expect(ensureMutable(index, BRANCH_2)?.reason).toMatch(/did not load/i)
  })

  it('remains enumerable for auditing rather than being hidden', async () => {
    const index = await gardenWithUnvalidatedFile()

    expect(diagnosticsForItem(index, BRANCH_2)).toHaveLength(1)
  })

  it('names the item, not merely the path', async () => {
    const index = await gardenWithUnvalidatedFile()
    const [diagnostic] = diagnosticsForItem(index, BRANCH_2)

    expect(diagnostic?.itemId).toBe(BRANCH_2)
    expect(diagnostic?.title).toBe('Missing its state')
  })
})

describe('an id that names nothing at all', () => {
  it('is refused with a plain explanation', async () => {
    const index = await buildGardenIndex([healthyBranch])

    expect(blockOnMissingItem(index, BRANCH_2)?.reason).toMatch(/not an item in this Garden/)
  })

  it('is refused by the combined check too', async () => {
    const index = await buildGardenIndex([healthyBranch])

    expect(ensureMutable(index, BRANCH_2)).toBeDefined()
  })
})

describe('a file that never parsed', () => {
  async function gardenWithUnparseableFile() {
    return buildGardenIndex([
      healthyBranch,
      { path: ['branches', 'rubbish.md'], text: 'not a Garden item at all\n' },
    ])
  }

  it('produces a Diagnostic with no item identity, because there is none', async () => {
    const index = await gardenWithUnparseableFile()
    const unidentified = index.diagnostics.filter((d) => d.itemId === undefined)

    expect(unidentified).toHaveLength(1)
    expect(unidentified[0]?.itemId).toBeUndefined()
  })

  it('names the path, so a person can find the file', async () => {
    const index = await gardenWithUnparseableFile()
    const unidentified = index.diagnostics.filter((d) => d.itemId === undefined)

    expect(unidentified[0]?.path).toEqual(['branches', 'rubbish.md'])
  })

  it('does not stop the rest of the Garden loading', async () => {
    const index = await gardenWithUnparseableFile()

    expect(index.items.get(BRANCH)).toBeDefined()
  })
})

describe('collecting problems per file', () => {
  it('reports one Diagnostic per file, however many problems it has', async () => {
    const index = await buildGardenIndex([
      {
        path: ['branches', 'bad.md'],
        text: file([`id: ${BRANCH}`, 'kind: branch', 'title: ', 'state: archived']),
      },
    ])

    expect(index.diagnostics).toHaveLength(1)
    expect(index.diagnostics[0]?.problems.length).toBeGreaterThan(1)
  })

  it('merges a schema problem and a graph problem for the same file', async () => {
    const index = await buildGardenIndex([
      healthyBranch,
      evidence,
      {
        path: ['leaves', 'c.md'],
        text: file([
          `id: ${CLAIM}`,
          'kind: claim_leaf',
          'title: Two problems',
          `parent_id: ${BRANCH}`,
          'supported_by:',
          `  - ${ROOT}`,
          'relations:',
          '  - type: relates_to',
          '    target: branch_01HQ8X2K3M4N5P6Q7R8S9T0YYW',
          '  - type: answers',
          '    target: branch_01HQ8X2K3M4N5P6Q7R8S9T0YYW',
        ]),
      },
    ])

    const forClaim = diagnosticsForItem(index, CLAIM)
    expect(forClaim).toHaveLength(1)
    expect(forClaim[0]?.problems.length).toBeGreaterThan(1)
  })
})

// "A Garden whose every file is malformed still opens and explains itself."
describe('a Garden where nothing is valid', () => {
  async function allBroken() {
    return buildGardenIndex([
      { path: ['branches', 'a.md'], text: 'no frontmatter\n' },
      { path: ['roots', 'b.md'], text: '---\nkind: [unclosed\n---\n\nbody\n' },
      { path: ['leaves', 'c.md'], text: file(['id: nonsense', 'kind: sapling', 'title: T']) },
    ])
  }

  it('opens rather than failing', async () => {
    await expect(allBroken()).resolves.toBeDefined()
  })

  it('holds no items', async () => {
    expect((await allBroken()).items.size).toBe(0)
  })

  it('explains every file', async () => {
    expect((await allBroken()).diagnostics).toHaveLength(3)
  })

  it('still derives a Garden Revision, so the state is identifiable', async () => {
    expect((await allBroken()).revision).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to mutate an item whose own file is one of the broken ones', async () => {
    const index = await buildGardenIndex([
      { path: ['branches', 'a.md'], text: 'no frontmatter\n' },
      {
        path: ['branches', 'b.md'],
        text: file([`id: ${BRANCH}`, 'kind: branch', 'title: Nearly valid']),
      },
    ])

    expect(index.items.size).toBe(0)
    expect(ensureMutable(index, BRANCH)?.reason).toMatch(/did not load/i)
  })
})

describe('blockOnDiagnostics on its own', () => {
  it('ignores whether the item loaded, reporting only on Diagnostics', async () => {
    const index = await buildGardenIndex([healthyBranch])

    expect(blockOnDiagnostics(index, BRANCH)).toBeUndefined()
    expect(blockOnDiagnostics(index, 'branch_01HQ8X2K3M4N5P6Q7R8S9T0XXW')).toBeUndefined()
  })
})

/**
 * The id belongs to whichever file claimed it first. Attributing the loser's
 * Diagnostic to that id blamed the innocent file: it was marked in the Tree,
 * told it could not be changed, and linked to under the other file's title.
 */
describe('two files claiming one id', () => {
  const claimant = (title: string) => file([`id: ${BRANCH}`, 'kind: branch', `title: ${title}`, 'state: active'])

  async function duplicated() {
    return buildGardenIndex([
      { path: ['branches', 'real.md'], text: claimant('The real one') },
      { path: ['branches', 'copy.md'], text: claimant('The impostor') },
    ])
  }

  it('keeps the file that claimed the id first', async () => {
    expect((await duplicated()).items.get(BRANCH)?.item.title).toBe('The real one')
  })

  it('leaves that file mutable, because nothing is wrong with it', async () => {
    const index = await duplicated()

    expect(ensureMutable(index, BRANCH)).toBeUndefined()
  })

  it('attributes the Diagnostic to no item, since the id is not the loser’s', async () => {
    const index = await duplicated()

    expect(index.diagnostics).toHaveLength(1)
    expect(index.diagnostics[0]?.itemId).toBeUndefined()
  })

  it('still names the losing file by its title and path, so it can be found', async () => {
    const index = await duplicated()

    expect(index.diagnostics[0]?.title).toBe('The impostor')
    expect(index.diagnostics[0]?.path).toEqual(['branches', 'copy.md'])
  })

  it('reports no Diagnostic against the surviving item', async () => {
    const index = await duplicated()

    expect(diagnosticsForItem(index, BRANCH)).toEqual([])
  })
})
