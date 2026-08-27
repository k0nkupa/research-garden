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
    write: (path, contents) => fileSystem.write(path, contents),
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
      write: async () => {},
    }

    await expect(openGarden(broken)).resolves.toMatchObject({ kind: 'failed' })
  })
})
