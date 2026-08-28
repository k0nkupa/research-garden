/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeDirectoryHandle } from '../filesystem/fakeDirectoryHandle'
import { InMemoryRememberedGardenStore } from '../filesystem/rememberedGarden'
import { FileSystemAccessGardenFileSystem } from '../filesystem/FileSystemAccessGardenFileSystem'
import { useGardenSession } from '../garden/useGardenSession'
import { ApplicationShell } from './ApplicationShell'
import { AlreadyAGarden } from './AlreadyAGarden'
import { Workspace } from '../workspace/Workspace'
import { PermissionLapsed } from './PermissionLapsed'

/**
 * The App under test, wired to an injectable picker and remembered-Garden store
 * so the whole create-and-resume path can be driven without a real browser.
 */
/** Counts folder picks, so a screen that should not re-ask can be proven not to. */
const pickerCalls = { count: 0 }

function TestApp({
  handle,
  store,
}: {
  handle: FakeDirectoryHandle
  store: InMemoryRememberedGardenStore
}) {
  const {
    session,
    createFromPicker,
    openFromPicker,
    openChosen,
    retryPermission,
    dismiss,
    remembered,
    resumeRemembered,
    forgetRemembered,
  } = useGardenSession({
    choose: async () => {
      pickerCalls.count += 1
      return { kind: 'chosen', fileSystem: new FileSystemAccessGardenFileSystem(handle), handle }
    },
    store,
  })

  if (session.kind === 'open') return <Workspace garden={session.garden} />
  if (session.kind === 'already-a-garden') {
    return (
      <AlreadyAGarden
        repositoryName={session.repositoryName}
        found={session.found}
        onOpenInstead={openChosen}
        onDismiss={dismiss}
      />
    )
  }
  if (session.kind === 'permission-required') {
    return (
      <PermissionLapsed
        repositoryName={session.repositoryName}
        onRetry={retryPermission}
        onDismiss={dismiss}
      />
    )
  }

  return (
    <ApplicationShell
      readiness={{ kind: 'ready', agentInterface: 'unsupported' }}
      onCreateGarden={createFromPicker}
      onOpenGarden={openFromPicker}
      busy={session.kind === 'working'}
      failure={session.kind === 'failed' ? session.message : undefined}
      remembered={remembered}
      onResume={resumeRemembered}
      onForget={forgetRemembered}
    />
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  pickerCalls.count = 0
})

describe('creating a Garden from the bare trunk', () => {
  it('grows a Tree from the files it wrote', async () => {
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))

    expect(await screen.findByRole('tree')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0)
  })

  it('shows the contradiction it created', async () => {
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    const { container } = render(
      <TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />,
    )

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('tree')

    expect(container.querySelector('[data-relation="contradicts"]')).toBeInTheDocument()
  })

  it('reports no Diagnostics for what it wrote', async () => {
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('tree')

    expect(screen.queryByRole('button', { name: /Diagnostic/ })).not.toBeInTheDocument()
  })

  it('names the folder it created the Garden in', async () => {
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))

    expect(await screen.findByText('my-garden')).toBeInTheDocument()
  })
})

describe('creating a Garden where one already exists', () => {
  const existing = { 'branches/mine.md': '---\nschema_version: 1\n---\n\nmine\n' }

  it('refuses and says so', async () => {
    const handle = FakeDirectoryHandle.fromFiles(existing, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))

    expect(
      await screen.findByRole('heading', { level: 1, name: /already a Garden/i }),
    ).toBeInTheDocument()
  })

  it('names what it found', async () => {
    const handle = FakeDirectoryHandle.fromFiles(existing, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('heading', { level: 1, name: /already a Garden/i })

    expect(screen.getByText('branches/mine.md')).toBeInTheDocument()
  })

  it('offers to open it instead', async () => {
    const handle = FakeDirectoryHandle.fromFiles(existing, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await userEvent.click(await screen.findByRole('button', { name: /open this garden/i }))

    expect(await screen.findByRole('tree')).toBeInTheDocument()
  })

  // The person just chose this folder; asking again would be rude.
  it('opens it without asking for the folder a second time', async () => {
    const handle = FakeDirectoryHandle.fromFiles(existing, 'my-garden')
    render(<TestApp handle={handle} store={new InMemoryRememberedGardenStore()} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    const picksBefore = pickerCalls.count

    await userEvent.click(await screen.findByRole('button', { name: /open this garden/i }))
    await screen.findByRole('tree')

    expect(pickerCalls.count).toBe(picksBefore)
  })

  // ADR 0060 remembers a folder so work can be resumed; a refusal is not work.
  it('does not remember a folder it refused to create a Garden in', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles(existing, 'my-garden')
    render(<TestApp handle={handle} store={store} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('heading', { level: 1, name: /already a Garden/i })

    expect(await store.recall()).toBeUndefined()
  })
})

// ADR 0060: the handle and the display name, and nothing else.
describe('remembering the Garden Repository', () => {
  it('remembers the folder after creating a Garden in it', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    render(<TestApp handle={handle} store={store} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('tree')

    await waitFor(async () => expect(await store.recall()).toBeDefined())
    expect((await store.recall())?.name).toBe('my-garden')
  })

  it('stores the handle and the name, and no canonical content', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    render(<TestApp handle={handle} store={store} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('tree')
    await waitFor(async () => expect(await store.recall()).toBeDefined())

    expect(Object.keys((await store.recall()) as object).sort()).toEqual(['handle', 'name'])
  })

  it('offers to resume a remembered Garden on a later visit', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    await store.remember({ handle, name: 'my-garden' })

    render(<TestApp handle={handle} store={store} />)

    expect(await screen.findByRole('button', { name: /resume my-garden/i })).toBeInTheDocument()
  })

  it('offers no resume when nothing is remembered', async () => {
    render(
      <TestApp
        handle={FakeDirectoryHandle.fromFiles({}, 'my-garden')}
        store={new InMemoryRememberedGardenStore()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create garden/i })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument()
  })

  it('opens the remembered Garden without asking for the folder again', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    await store.remember({ handle, name: 'my-garden' })

    // Prove the picker is never called: choosing would throw.
    render(<TestApp handle={handle} store={store} />)
    await userEvent.click(await screen.findByRole('button', { name: /resume my-garden/i }))

    expect(await screen.findByRole('tree')).toBeInTheDocument()
  })

  // ADR 0060: permission is never remembered.
  it('asks for permission again, and recovers when it is refused', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    handle.setPermission('denied')
    await store.remember({ handle, name: 'my-garden' })

    render(<TestApp handle={handle} store={store} />)
    await userEvent.click(await screen.findByRole('button', { name: /resume my-garden/i }))

    expect(
      await screen.findByRole('button', { name: /grant access again/i }),
    ).toBeInTheDocument()
  })

  it('forgets the folder when asked', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({}, 'my-garden')
    await store.remember({ handle, name: 'my-garden' })

    render(<TestApp handle={handle} store={store} />)
    await userEvent.click(await screen.findByRole('button', { name: /forget it/i }))

    await waitFor(async () => expect(await store.recall()).toBeUndefined())
    expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument()
  })
})

// ADR 0060: the folder is remembered, but folders move and get deleted.
describe('resuming a Garden whose folder has gone', () => {
  it('says the folder could not be found rather than showing an empty Garden', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({ 'branches/a.md': 'x' }, 'my-garden')
    await store.remember({ handle, name: 'my-garden' })
    handle.vanish()

    render(<TestApp handle={handle} store={store} />)
    await userEvent.click(await screen.findByRole('button', { name: /resume my-garden/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be found/i)
  })

  it('shows no Tree, because there was nothing to read', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({ 'branches/a.md': 'x' }, 'my-garden')
    await store.remember({ handle, name: 'my-garden' })
    handle.vanish()

    render(<TestApp handle={handle} store={store} />)
    await userEvent.click(await screen.findByRole('button', { name: /resume my-garden/i }))
    await screen.findByRole('alert')

    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
  })

  it('still offers to forget it, so the person is not stuck', async () => {
    const store = new InMemoryRememberedGardenStore()
    const handle = FakeDirectoryHandle.fromFiles({ 'branches/a.md': 'x' }, 'my-garden')
    await store.remember({ handle, name: 'my-garden' })
    handle.vanish()

    render(<TestApp handle={handle} store={store} />)
    await userEvent.click(await screen.findByRole('button', { name: /resume my-garden/i }))
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: /forget it/i })).toBeInTheDocument()
  })
})
