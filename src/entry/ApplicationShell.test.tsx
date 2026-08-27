import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationShell } from './ApplicationShell'
import type { Readiness } from '../capabilities/capabilities'

const ready: Readiness = { kind: 'ready', agentInterfaceAvailable: true }
const readyWithoutAgent: Readiness = { kind: 'ready', agentInterfaceAvailable: false }
const noFolderAccess: Readiness = {
  kind: 'unsupported-browser',
  missing: 'local-folder-access',
}
const smallScreen: Readiness = { kind: 'unsupported-viewport' }

describe('the bare trunk entry screen', () => {
  // ADR 0046: before a Garden exists the product shows a bare trunk with its
  // two actions at the soil line, not a conventional landing page.
  it('offers Create Garden and Open Garden when the environment is ready', () => {
    render(<ApplicationShell readiness={ready} />)

    expect(screen.getByRole('button', { name: /create garden/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open garden/i })).toBeInTheDocument()
  })

  it('renders the bare trunk as decoration rather than as content', () => {
    const { container } = render(<ApplicationShell readiness={ready} />)

    const trunk = container.querySelector('[data-testid="bare-trunk"]')
    expect(trunk).toBeInTheDocument()
    expect(trunk).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows no marketing landing page in place of the Garden', () => {
    render(<ApplicationShell readiness={ready} />)

    expect(screen.queryByRole('link', { name: /pricing/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /get started free/i })).not.toBeInTheDocument()
  })

  it('runs Create Garden when a ready person chooses it', async () => {
    const onCreateGarden = vi.fn()
    render(<ApplicationShell readiness={ready} onCreateGarden={onCreateGarden} />)

    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))

    expect(onCreateGarden).toHaveBeenCalledOnce()
  })

  it('runs Open Garden when a ready person chooses it', async () => {
    const onOpenGarden = vi.fn()
    render(<ApplicationShell readiness={ready} onOpenGarden={onOpenGarden} />)

    await userEvent.click(screen.getByRole('button', { name: /open garden/i }))

    expect(onOpenGarden).toHaveBeenCalledOnce()
  })
})

describe('the absence of an account model', () => {
  // ADR 0002: the product requires no login or hosted account, so no surface
  // may imply one exists.
  const everyReadiness: readonly Readiness[] = [
    ready,
    readyWithoutAgent,
    noFolderAccess,
    smallScreen,
  ]

  it.each(everyReadiness)('offers no account affordance in %o', (readiness) => {
    render(<ApplicationShell readiness={readiness} />)

    for (const account of [/log ?in/i, /sign ?in/i, /sign ?up/i, /create account/i, /register/i]) {
      expect(screen.queryByRole('button', { name: account })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: account })).not.toBeInTheDocument()
    }
  })
})

describe('a browser without local-folder access', () => {
  it('names the missing capability rather than failing generically', () => {
    render(<ApplicationShell readiness={noFolderAccess} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/local[- ]folder access/i)
  })

  // "An unsupported environment never partially executes an action": the
  // actions are absent, not merely disabled or failing on invocation.
  it('offers neither Create Garden nor Open Garden', () => {
    render(<ApplicationShell readiness={noFolderAccess} />)

    expect(screen.queryByRole('button', { name: /create garden/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open garden/i })).not.toBeInTheDocument()
  })
})

describe('a browser without WebMCP', () => {
  // ADR 0059: WebMCP's absence must not degrade the human interface.
  it('still offers the complete human interface', () => {
    render(<ApplicationShell readiness={readyWithoutAgent} />)

    expect(screen.getByRole('button', { name: /create garden/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open garden/i })).toBeInTheDocument()
  })

  it('explains that the agent interface specifically is unavailable', () => {
    render(<ApplicationShell readiness={readyWithoutAgent} />)

    expect(screen.getByRole('status')).toHaveTextContent(/webmcp/i)
  })

  it('says nothing about WebMCP when the agent interface is available', () => {
    render(<ApplicationShell readiness={ready} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('a screen below the supported desktop size', () => {
  it('explains the compatible desktop browser requirement', () => {
    render(<ApplicationShell readiness={smallScreen} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/desktop/i)
  })

  it('offers neither Create Garden nor Open Garden', () => {
    render(<ApplicationShell readiness={smallScreen} />)

    expect(screen.queryByRole('button', { name: /create garden/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open garden/i })).not.toBeInTheDocument()
  })

  // A small screen usually also lacks File System Access. Since the viewport
  // gate resolves first, this explanation must still name the capability, or
  // that person never learns which one a desktop browser is needed for.
  it('also names local-folder access', () => {
    render(<ApplicationShell readiness={smallScreen} />)

    expect(screen.getByRole('main')).toHaveTextContent(/local[- ]folder access/i)
  })
})

describe('domain vocabulary (docs/agents/domain.md)', () => {
  const everyScreen: readonly Readiness[] = [ready, readyWithoutAgent, noFolderAccess, smallScreen]

  // CONTEXT.md and ADR 0047 name this the Change Tray; the glossary rejects
  // ad-hoc synonyms.
  it.each(everyScreen)('uses no rejected synonym for the Change Tray in %o', (readiness) => {
    const { container } = render(<ApplicationShell readiness={readiness} />)

    expect(container.textContent).not.toMatch(/review tray|change drawer|diff tray/i)
  })

  it.each(everyScreen)('uses no rejected synonym for the Garden in %o', (readiness) => {
    const { container } = render(<ApplicationShell readiness={readiness} />)

    expect(container.textContent).not.toMatch(/\bvault\b|second brain|knowledge base/i)
  })
})
