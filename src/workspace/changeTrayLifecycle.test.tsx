/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import type { UlidEntropy } from '../domain/schema/ulid'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { proposeChange } from '../garden/proposeChange'
import { proposeHarvest } from '../garden/proposalTools'
import { Workspace } from './Workspace'

/**
 * The full Pending Change lifecycle through the real Workspace (ticket 14):
 * a proposal appears in the tray, opening it shows the diff without losing
 * the Tree, and approving or rejecting it does what each promises. The unit
 * suites for `proposeChange`/`approveChange`/`rejectChange` and the
 * `ChangeTray`/`ChangeDiffPanel` components each exercise one seam in
 * isolation; this is the one place that proves they are actually wired
 * together the way a person -- reviewing something an agent proposed --
 * would use them.
 *
 * `proposeChange` is called directly against the same folder Workspace has
 * open, standing in for the agent tool ticket 22 will eventually wire to it;
 * the lifecycle from a Pending Change record onward is identical either way.
 */

function countingEntropy(startAt = 1_700_000_000_000): UlidEntropy {
  let tick = 0
  let counter = 0
  return {
    now: () => startAt + tick++,
    randomBytes: (into) => into.map(() => counter++ % 256),
  }
}

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
const CREATED = '2026-08-01T10:00:00Z'

const branchFile = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention mechanisms
state: active
created_at: ${CREATED}
updated_at: ${CREATED}
---

Original body text.
`

const rootFile = `---
schema_version: 1
id: ${ROOT}
kind: root
title: Captured evidence
captured_at: ${CREATED}
content_hash: sha256:captured
created_at: ${CREATED}
updated_at: ${CREATED}
---

Exact captured evidence.
`

async function renderOpenWorkspace(
  files: Record<string, string>,
  options: { now?: () => string; entropy?: UlidEntropy } = {},
) {
  const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
  const index = await buildGardenIndex(
    Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
  )
  render(
    <Workspace
      garden={{ repositoryName: 'my-garden', index, fileSystem }}
      now={options.now}
      entropy={options.entropy}
    />,
  )
  return { fileSystem, index }
}

async function proposeAgainst(fileSystem: InMemoryGardenFileSystem, index: Awaited<ReturnType<typeof buildGardenIndex>>, newBody: string) {
  const result = await proposeChange(
    fileSystem,
    index,
    { itemId: BRANCH, baseText: branchFile, newBody },
    { now: () => CREATED, entropy: countingEntropy() },
  )
  if (result.kind !== 'proposed') throw new Error(`expected proposed, got ${result.kind}`)
  return result
}

describe('a proposed change appearing in the tray', () => {
  it('shows once proposed and a rescan boundary is crossed', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    expect(screen.getByText(/no changes to review/i)).toBeInTheDocument()

    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /change tray/i })).toBeInTheDocument(),
    )
    expect(within(screen.getByRole('region', { name: /change tray/i })).getByText(/Attention mechanisms/)).toBeInTheDocument()
  })

  it('does not touch the canonical file merely by being proposed', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })

    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(screen.getByRole('region', { name: /change tray/i })).toBeInTheDocument())

    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })
})

describe('a Pending Change already on disk when Workspace mounts', () => {
  it('survives a reload -- shows in the tray without proposeChange ever being called this render', async () => {
    // Every other test in this file proposes against a Workspace that is
    // already rendered, which only proves a change appears once proposed
    // live. A real reload (closing and reopening the folder) mounts a fresh
    // Workspace against a folder that already has the operational record on
    // disk from a previous session -- so this writes the record first, with
    // no Workspace mounted yet, and only then renders one against that same
    // folder, to prove the mount-time load is what surfaces it, not
    // something carried over in memory from proposing it.
    const files = { 'branches/attention.md': branchFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
    const index = await buildGardenIndex(
      Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })),
    )
    const proposed = await proposeChange(
      fileSystem,
      index,
      { itemId: BRANCH, baseText: branchFile, newBody: 'A proposed replacement body.' },
      { now: () => CREATED, entropy: countingEntropy() },
    )
    if (proposed.kind !== 'proposed') throw new Error(`expected proposed, got ${proposed.kind}`)

    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} />)

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /change tray/i })).toBeInTheDocument(),
    )
    expect(
      within(screen.getByRole('region', { name: /change tray/i })).getByText(/Attention mechanisms/),
    ).toBeInTheDocument()
  })
})

describe('opening a change', () => {
  it('shows its diff without hiding the Tree', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))

    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))

    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getByLabelText(/proposed change/i)).toBeInTheDocument()
    expect(screen.getByText(/A proposed replacement body\./)).toBeInTheDocument()
  })
})

describe('approving a change', () => {
  it('shows a new Harvest proposal as reviewable and applies it from the real Change Tray', async () => {
    const files = { 'branches/attention.md': branchFile, 'roots/evidence.md': rootFile }
    const fileSystem = new InMemoryGardenFileSystem(files, 'my-garden')
    const index = await buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
    const proposed = await proposeHarvest(fileSystem, {
      title: 'A Harvest', parentId: BRANCH, supportedBy: [ROOT],
      question: 'Question', synthesis: 'Synthesis', evidence: 'Evidence',
      contradictionsAndUncertainty: 'No contradiction was identified; uncertainty is explicit.', openQuestions: 'Open',
    }, { now: () => CREATED, entropy: countingEntropy() })
    if (proposed.kind !== 'proposed') throw new Error(`expected Harvest proposal, got ${proposed.kind}`)

    render(<Workspace garden={{ repositoryName: 'my-garden', index, fileSystem }} />)
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))
    expect(screen.getByText(/A Harvest/)).toBeInTheDocument()
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /A Harvest/i }))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() => expect(Object.keys(fileSystem.snapshot()).some((path) => path.startsWith('harvests/'))).toBe(true))
    await waitFor(() => expect(screen.getByText(/no changes to review/i)).toBeInTheDocument())
  })

  it('writes the file and removes the change from the tray', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))
    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))

    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() =>
      expect(fileSystem.snapshot()['branches/attention.md']).toContain('A proposed replacement body.'),
    )
    // The write landing is not the same moment as the tray reflecting it:
    // the post-approval rescan that empties the tray runs after the write,
    // in its own render pass, so this needs its own `waitFor`.
    await waitFor(() => expect(screen.getByText(/no changes to review/i)).toBeInTheDocument())
  })

  it('lands on the applied item with Undo available, and Undo actually restores the previous file', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))
    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))

    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument())
    // Undo becoming available and the post-approval rescan finishing are two
    // different state updates, not guaranteed to land in the same render.
    await waitFor(() =>
      expect(screen.getByText(/A proposed replacement body\./)).toBeInTheDocument(),
    )

    // Undo being offered proves nothing about what it does -- the Undo
    // Snapshot `approveChange` writes has to be readable by the exact same
    // `undoChange` a person's own edit uses, so this actually clicks it.
    await userEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() => expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile))

    await userEvent.click(screen.getByRole('button', { name: /^activity/i }))
    const feed = screen.getByLabelText('Garden Activity')
    const undoEntry = within(feed).getByText(/undo/i).closest('li')
    if (!undoEntry) throw new Error('expected the Undo entry to be inside a list item')
    expect(within(undoEntry).getByText(/succeeded/i)).toBeInTheDocument()
  })

  it('records the approval in the Garden Activity feed', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))
    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() => expect(fileSystem.snapshot()['branches/attention.md']).toContain('A proposed replacement body.'))

    await userEvent.click(screen.getByRole('button', { name: /^activity/i }))

    const feed = screen.getByLabelText('Garden Activity')
    expect(within(feed).getByText(/approve/i)).toBeInTheDocument()
    expect(within(feed).getByText(/succeeded/i)).toBeInTheDocument()
  })
})

describe('rejecting a change', () => {
  it('removes it from the tray without touching the canonical file', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))
    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))

    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }))

    await waitFor(() => expect(screen.getByText(/no changes to review/i)).toBeInTheDocument())
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(branchFile)
  })

  it('records the rejection in the Garden Activity feed as a first-class outcome', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))
    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(screen.getByText(/no changes to review/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^activity/i }))

    const feed = screen.getByLabelText('Garden Activity')
    expect(within(feed).getByText(/reject/i)).toBeInTheDocument()
    expect(within(feed).getByText(/succeeded/i)).toBeInTheDocument()
  })
})

describe('a change whose target moved on since it was proposed', () => {
  it('shows Stale in the tray and refuses to approve', async () => {
    const { fileSystem, index } = await renderOpenWorkspace({ 'branches/attention.md': branchFile })
    await proposeAgainst(fileSystem, index, 'A proposed replacement body.')

    // Simulates a second tab (or a person's own hand edit) landing after the
    // proposal but before review (ADR 0063, the "two tabs" criterion).
    const overtaken = branchFile.replace('Original body text.', "Someone else's newer edit.")
    await fileSystem.write(['branches', 'attention.md'], overtaken)
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => screen.getByRole('region', { name: /change tray/i }))

    expect(screen.getByText(/stale/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Attention mechanisms/i }))
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled()

    // Rejecting a Stale proposal is still allowed -- it never touches the
    // canonical file either way.
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(screen.getByText(/no changes to review/i)).toBeInTheDocument())
    expect(fileSystem.snapshot()['branches/attention.md']).toBe(overtaken)
  })
})
