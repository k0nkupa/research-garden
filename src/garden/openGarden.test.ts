import { describe, expect, it } from 'vitest'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { openGarden } from './openGarden'

const ATTENTION = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'

const attentionFile = `---
schema_version: 1
id: ${ATTENTION}
kind: branch
title: Attention mechanisms
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

What I am collecting about attention.
`

function gardenWith(files: Record<string, string>) {
  return new InMemoryGardenFileSystem(files, 'my-garden')
}

/**
 * Explicit delegation rather than a Proxy: the adapters use `#private` fields,
 * and a Proxy receiver breaks those, which fails in a way that looks like a
 * product bug rather than a harness one.
 */
function delegateTo(fileSystem: GardenFileSystem): GardenFileSystem {
  return {
    repositoryName: fileSystem.repositoryName,
    permission: () => fileSystem.permission(),
    requestPermission: () => fileSystem.requestPermission(),
    listFiles: (directory) => fileSystem.listFiles(directory),
    read: (path) => fileSystem.read(path),
    readBytes: (path) => fileSystem.readBytes(path),
    write: (path, contents) => fileSystem.write(path, contents),
    delete: (path) => fileSystem.delete(path),
  }
}

function expectOpened(result: Awaited<ReturnType<typeof openGarden>>) {
  if (result.kind !== 'opened') throw new Error(`expected opened, got ${result.kind}`)
  return result.garden
}

describe('opening a Garden', () => {
  it('scans canonical Markdown into an index', async () => {
    const garden = expectOpened(
      await openGarden(gardenWith({ 'branches/attention.md': attentionFile })),
    )

    expect(garden.index.items.get(ATTENTION)?.item.title).toBe('Attention mechanisms')
  })

  it('reports the repository name for the interface', async () => {
    const garden = expectOpened(
      await openGarden(gardenWith({ 'branches/attention.md': attentionFile })),
    )

    expect(garden.repositoryName).toBe('my-garden')
  })

  it('carries a Garden Revision derived from the canonical content', async () => {
    const garden = expectOpened(
      await openGarden(gardenWith({ 'branches/attention.md': attentionFile })),
    )

    expect(garden.index.revision).toMatch(/^[0-9a-f]{64}$/)
  })

  it('opens an empty folder as an empty Garden rather than failing', async () => {
    const garden = expectOpened(await openGarden(gardenWith({})))

    expect(garden.index.items.size).toBe(0)
    expect(garden.index.topLevelIds).toEqual([])
  })

  // ADR 0011: canonical Markdown lives in typed directories, and the visible
  // Tree comes from frontmatter rather than from that layout.
  it('scans every canonical typed directory', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    const scanned: string[] = []

    await openGarden({
      ...delegateTo(fileSystem),
      listFiles: async (directory) => {
        scanned.push(directory.join('/'))
        return fileSystem.listFiles(directory)
      },
    })

    expect(scanned.sort()).toEqual(['branches', 'harvests', 'leaves', 'roots', 'seeds'])
  })

  it('ignores files that are not Markdown', async () => {
    const garden = expectOpened(
      await openGarden(
        gardenWith({
          'branches/attention.md': attentionFile,
          'branches/.DS_Store': 'binary noise',
          'branches/notes.txt': 'not canonical',
        }),
      ),
    )

    expect(garden.index.items.size).toBe(1)
    expect(garden.index.diagnostics).toEqual([])
  })

  it('never reads Attachments as canonical knowledge', async () => {
    const garden = expectOpened(
      await openGarden(
        gardenWith({
          'branches/attention.md': attentionFile,
          'attachments/paper.md': 'a user-owned supporting file, not a Garden item',
        }),
      ),
    )

    expect(garden.index.items.size).toBe(1)
    expect(garden.index.diagnostics).toEqual([])
  })

  it('never reads the operational directory as canonical knowledge', async () => {
    const garden = expectOpened(
      await openGarden(
        gardenWith({
          'branches/attention.md': attentionFile,
          '.research-garden/index.json': '{"not":"canonical"}',
          '.research-garden/pending/change.json': '{}',
        }),
      ),
    )

    expect(garden.index.items.size).toBe(1)
    expect(garden.index.diagnostics).toEqual([])
  })
})

// "Losing folder permission mid-operation produces a clear recoverable state
// rather than a crash or a partially executed action."
describe('when folder permission has lapsed', () => {
  it('reports that permission is required rather than throwing', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    fileSystem.revokePermission()

    await expect(openGarden(fileSystem)).resolves.toMatchObject({
      kind: 'permission-required',
    })
  })

  it('names the repository so a person knows what to re-grant', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    fileSystem.revokePermission()

    await expect(openGarden(fileSystem)).resolves.toMatchObject({
      repositoryName: 'my-garden',
    })
  })

  it('reports permission required when access lapses part way through a scan', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })

    const lapsingPartWayThrough = {
      ...delegateTo(fileSystem),
      read: async (path: readonly string[]) => {
        fileSystem.revokePermission()
        return fileSystem.read(path)
      },
    }

    await expect(openGarden(lapsingPartWayThrough)).resolves.toMatchObject({
      kind: 'permission-required',
    })
  })

  it('opens normally once permission is restored', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    fileSystem.revokePermission()
    await openGarden(fileSystem)

    fileSystem.grantPermission()

    expect(expectOpened(await openGarden(fileSystem)).index.items.size).toBe(1)
  })
})

describe('when the folder cannot be read at all', () => {
  it('reports a failure rather than throwing', async () => {
    const broken = {
      repositoryName: 'unreadable',
      permission: async () => 'granted' as const,
      requestPermission: async () => 'granted' as const,
      listFiles: async () => {
        throw new Error('the disk went away')
      },
      read: async () => '',
      readBytes: async () => new Uint8Array(),
      write: async () => {},
      delete: async () => {},
    }

    await expect(openGarden(broken)).resolves.toMatchObject({ kind: 'failed' })
  })
})

/**
 * ADR 0053: Research Garden never polls, so a rescan is nothing more than
 * calling `openGarden` again on the same folder at an explicit boundary
 * (window focus, Refresh, or immediately before a mutation). These tests
 * exercise that reuse directly, at the seam that actually does the scanning,
 * rather than through the human interface that merely decides when to call it
 * (`Workspace.rescanGarden`, tested separately for the timing itself).
 */
describe('rescanning at consistency boundaries (ticket 13)', () => {
  const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'
  const optimisersFile = `---
schema_version: 1
id: ${OPTIMISERS}
kind: branch
title: Optimisers
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

What I am collecting about optimisers.
`

  it('reflects an edit made outside Research Garden at the next rescan', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    await openGarden(fileSystem)

    await fileSystem.write(
      ['branches', 'attention.md'],
      attentionFile.replace('Attention mechanisms', 'Attention mechanisms, revised elsewhere'),
    )

    const rescanned = expectOpened(await openGarden(fileSystem))
    expect(rescanned.index.items.get(ATTENTION)?.item.title).toBe(
      'Attention mechanisms, revised elsewhere',
    )
  })

  it('reflects a file added outside Research Garden at the next rescan', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    const before = expectOpened(await openGarden(fileSystem))
    expect(before.index.items.size).toBe(1)

    await fileSystem.write(['branches', 'optimisers.md'], optimisersFile)

    const rescanned = expectOpened(await openGarden(fileSystem))
    expect(rescanned.index.items.size).toBe(2)
    expect(rescanned.index.items.get(OPTIMISERS)?.item.title).toBe('Optimisers')
  })

  it('reflects a file deleted outside Research Garden at the next rescan', async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': attentionFile,
      'branches/optimisers.md': optimisersFile,
    })
    const before = expectOpened(await openGarden(fileSystem))
    expect(before.index.items.size).toBe(2)

    fileSystem.remove(['branches', 'optimisers.md'])

    const rescanned = expectOpened(await openGarden(fileSystem))
    expect(rescanned.index.items.size).toBe(1)
    expect(rescanned.index.items.has(OPTIMISERS)).toBe(false)
  })

  it('changes the Garden Revision when a rescan finds different canonical content', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    const before = expectOpened(await openGarden(fileSystem))

    await fileSystem.write(['branches', 'optimisers.md'], optimisersFile)

    const after = expectOpened(await openGarden(fileSystem))
    expect(after.index.revision).not.toBe(before.index.revision)
  })

  it('leaves the Garden Revision unchanged when a rescan finds nothing different', async () => {
    const fileSystem = gardenWith({ 'branches/attention.md': attentionFile })
    const before = expectOpened(await openGarden(fileSystem))

    const rescanned = expectOpened(await openGarden(fileSystem))
    expect(rescanned.index.revision).toBe(before.index.revision)
  })

  // ADR 0052: a rescan that finds a file has gone bad reports it as a
  // Diagnostic. The rest of the Garden -- files a rescan had no reason to
  // touch -- must load exactly as before, so newly invalid content in one
  // file never disrupts the rest of what a person is doing.
  it('produces a Diagnostic for content that turned invalid outside Research Garden, without disturbing an unrelated item', async () => {
    const fileSystem = gardenWith({
      'branches/attention.md': attentionFile,
      'branches/optimisers.md': optimisersFile,
    })
    const before = expectOpened(await openGarden(fileSystem))
    expect(before.index.diagnostics).toEqual([])

    // A hand edit outside Research Garden that breaks the schema (kind is
    // rewritten to something the schema does not recognize).
    await fileSystem.write(
      ['branches', 'optimisers.md'],
      optimisersFile.replace('kind: branch', 'kind: not-a-real-kind'),
    )

    const rescanned = expectOpened(await openGarden(fileSystem))
    expect(rescanned.index.diagnostics).toHaveLength(1)
    expect(rescanned.index.diagnostics[0]?.itemId).toBe(OPTIMISERS)
    expect(rescanned.index.items.has(OPTIMISERS)).toBe(false)

    // The unrelated item is untouched: still present, still valid, still
    // exactly what it was.
    expect(rescanned.index.items.get(ATTENTION)?.item.title).toBe('Attention mechanisms')
    expect(rescanned.index.diagnostics.some((d) => d.itemId === ATTENTION)).toBe(false)
  })
})
