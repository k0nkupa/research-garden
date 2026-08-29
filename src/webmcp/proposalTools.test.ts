import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import type { GardenActivityEntry } from '../garden/gardenActivity'
import type { OpenedGarden } from '../garden/openGarden'
import { createProposalTools, createProposalToolsBundles } from './proposalTools'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const BRANCH_2 = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B2W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
const NOW = '2026-08-29T01:00:00Z'
const branch = (id: string, title: string) => `---\nschema_version: 1\nid: ${id}\nkind: branch\ntitle: ${title}\nstate: active\ncreated_at: ${NOW}\nupdated_at: ${NOW}\n---\n\nBody.\n`
const root = `---\nschema_version: 1\nid: ${ROOT}\nkind: root\ntitle: Evidence\ncaptured_at: ${NOW}\ncontent_hash: sha256:abc\ncreated_at: ${NOW}\nupdated_at: ${NOW}\n---\n\nExact evidence.\n`

async function fixture(): Promise<{ garden: OpenedGarden; activity: GardenActivityEntry[] }> {
  const fileSystem = new InMemoryGardenFileSystem({ 'branches/a.md': branch(BRANCH, 'A'), 'branches/b.md': branch(BRANCH_2, 'B'), 'roots/e.md': root }, 'garden')
  const index = await buildGardenIndex([
    { path: ['branches', 'a.md'], text: branch(BRANCH, 'A') },
    { path: ['branches', 'b.md'], text: branch(BRANCH_2, 'B') },
    { path: ['roots', 'e.md'], text: root },
  ])
  const activity: GardenActivityEntry[] = []
  return { garden: { repositoryName: 'garden', fileSystem, index }, activity }
}

describe('proposal WebMCP tools', () => {
  it('returns the common envelope and records Activity while refreshing the tray', async () => {
    const { garden, activity } = await fixture()
    let refreshed = 0
    const tools = createProposalTools({ getGarden: () => garden, refreshGarden: async () => { refreshed += 1 }, recordActivity: (entry) => activity.push(entry), nextActivityId: () => 'activity-1', clock: () => NOW })
    const relation = tools.find((tool) => tool.name === 'propose_relation')!
    const result = await relation.execute({ sourceId: BRANCH, targetId: BRANCH_2, type: 'relates_to' }, { signal: new AbortController().signal }) as { ok: boolean; gardenRevision: string; data?: { previewHash: string } }
    expect(result.ok).toBe(true)
    expect(result.data?.previewHash).toMatch(/^sha256:/)
    expect(result.gardenRevision).toBe(garden.index.revision)
    expect(refreshed).toBe(1)
    expect(activity[0]).toMatchObject({ action: 'propose_relation', outcome: 'success', itemIds: [BRANCH, BRANCH_2] })
  })

  it('keeps proposal bundles state-aware and non-read-only', async () => {
    const { garden } = await fixture()
    const bundles = createProposalToolsBundles({ getGarden: () => garden, recordActivity: () => {}, nextActivityId: () => 'a', clock: () => NOW })
    expect(bundles.map((bundle) => bundle.id)).toEqual(['proposal-selected', 'proposal-focused-branch'])
    expect(bundles[0]!.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: BRANCH, selectedItemKind: 'branch', focusedBranchId: undefined, hasPendingChanges: false })).toBe(true)
    expect(bundles[1]!.isRelevant({ agentAccess: true, gardenOpen: true, selectedItemId: undefined, selectedItemKind: undefined, focusedBranchId: BRANCH, hasPendingChanges: false })).toBe(true)
    expect(bundles[0]!.tools.every((tool) => !tool.annotations?.readOnlyHint)).toBe(true)
  })
})
