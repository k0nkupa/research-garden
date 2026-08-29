/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentAccessPanel } from './AgentAccessPanel'

describe('before connecting', () => {
  it('shows one disclosure naming metadata, snippets, and bodies', () => {
    render(<AgentAccessPanel justDisconnected={false} onConnect={() => {}} onClose={() => {}} />)

    const disclosure = screen.getByText(/metadata, snippets, and bodies/i)
    expect(disclosure).toBeInTheDocument()
  })

  it('does not claim data never leaves the device (ADR 0080)', () => {
    render(<AgentAccessPanel justDisconnected={false} onConnect={() => {}} onClose={() => {}} />)

    expect(screen.getByLabelText('Agent Access').textContent).toMatch(/does not claim/i)
  })

  it('states that disconnecting cannot recall content already returned', () => {
    render(<AgentAccessPanel justDisconnected={false} onConnect={() => {}} onClose={() => {}} />)

    expect(screen.getByLabelText('Agent Access').textContent).toMatch(/cannot be recalled/i)
  })

  it('calls onConnect when Enable Agent Access is clicked', async () => {
    const onConnect = vi.fn()
    render(<AgentAccessPanel justDisconnected={false} onConnect={onConnect} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /^enable agent access$/i }))

    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Cancel is clicked, without calling onConnect', async () => {
    const onConnect = vi.fn()
    const onClose = vi.fn()
    render(<AgentAccessPanel justDisconnected={false} onConnect={onConnect} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConnect).not.toHaveBeenCalled()
  })
})

describe('right after disconnecting', () => {
  it('states plainly that content already returned cannot be recalled', () => {
    render(<AgentAccessPanel justDisconnected={true} onConnect={() => {}} onClose={() => {}} />)

    expect(screen.getByRole('status')).toHaveTextContent(/cannot be recalled/i)
  })

  it('states that Pending Changes are untouched', () => {
    render(<AgentAccessPanel justDisconnected={true} onConnect={() => {}} onClose={() => {}} />)

    expect(screen.getByRole('status')).toHaveTextContent(/pending changes are untouched/i)
  })

  it('offers no way to reconnect from here -- only Close', () => {
    render(<AgentAccessPanel justDisconnected={true} onConnect={() => {}} onClose={() => {}} />)

    expect(screen.queryByRole('button', { name: /enable agent access/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn()
    render(<AgentAccessPanel justDisconnected={true} onConnect={() => {}} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /^close$/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
