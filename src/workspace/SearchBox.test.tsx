/**
 * @vitest-environment jsdom
 */
import type { KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { SearchBox } from './SearchBox'

function file(lines: string[], body: string) {
  return [
    '---',
    'schema_version: 1',
    ...lines,
    'created_at: 2026-08-01T10:00:00Z',
    'updated_at: 2026-08-01T10:00:00Z',
    '---',
    '',
    body,
    '',
  ].join('\n')
}

const OPTIMISERS = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V2X'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'

async function gardenWith(files: { path: string[]; text: string }[]) {
  return buildGardenIndex(files)
}

const branch = (id: string, title: string, body = 'A body.') => ({
  path: ['branches', `${id}.md`],
  text: file([`id: ${id}`, 'kind: branch', `title: ${title}`, 'state: active'], body),
})

describe('the search box', () => {
  it('is reachable as a search landmark', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('shows no results until a person types something', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lists a matching item as the query is typed', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    await userEvent.type(screen.getByRole('combobox', { name: /search the garden/i }), 'optim')

    expect(screen.getByRole('option', { name: /Optimisers/ })).toBeInTheDocument()
  })

  it('shows the kind alongside the title', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    await userEvent.type(screen.getByRole('combobox'), 'optim')

    expect(screen.getByRole('option', { name: /Branch/ })).toBeInTheDocument()
  })

  it('shows a snippet of surrounding text for a body match', async () => {
    const index = await gardenWith([
      branch(OPTIMISERS, 'Optimisers', 'Adam converges faster than SGD in most of what was tried.'),
    ])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    await userEvent.type(screen.getByRole('combobox'), 'converges')

    expect(screen.getByRole('option')).toHaveTextContent(/converges/)
  })

  it('says plainly when nothing matched', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    await userEvent.type(screen.getByRole('combobox'), 'nonexistent-term')

    expect(screen.getByText(/No matches/)).toBeInTheDocument()
  })

  it('calls onSelect with the item id when a result is chosen', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    const onSelect = vi.fn()
    render(<SearchBox index={index} onSelect={onSelect} />)

    await userEvent.type(screen.getByRole('combobox'), 'optim')
    await userEvent.click(screen.getByRole('option', { name: /Optimisers/ }))

    expect(onSelect).toHaveBeenCalledWith(OPTIMISERS)
  })

  // The option is the tabbable, interactive element -- not a button nested
  // inside it -- so Tab and Enter alone must be able to choose a result.
  it('chooses a result reached by Tab with Enter, no pointer involved', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    const onSelect = vi.fn()
    render(<SearchBox index={index} onSelect={onSelect} />)

    await userEvent.type(screen.getByRole('combobox'), 'optim')
    screen.getByRole('option', { name: /Optimisers/ }).focus()
    await userEvent.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(OPTIMISERS)
  })

  it('closes the results after a choice is made', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    await userEvent.type(screen.getByRole('combobox'), 'optim')
    await userEvent.click(screen.getByRole('option', { name: /Optimisers/ }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('renders a snippet as plain text rather than markup, even when the body looks like HTML', async () => {
    const index = await gardenWith([
      {
        path: ['roots', `${ROOT}.md`],
        text: file(
          [`id: ${ROOT}`, 'kind: root', 'title: Hostile evidence', 'captured_at: 2026-08-01T09:00:00Z', 'content_hash: sha256:x'],
          '<img src=x onerror="window.__pwned = true">gotcha marker text',
        ),
      },
    ])
    render(<SearchBox index={index} onSelect={vi.fn()} />)

    await userEvent.type(screen.getByRole('combobox'), 'gotcha')

    // The tag text is visible as literal characters, not parsed as an element:
    // no <img> ever mounts, and "onerror" survives as plain text in the DOM.
    expect(screen.getByRole('option')).toHaveTextContent(/onerror.*gotcha marker text/)
    expect(document.querySelector('img')).toBeNull()
  })

  it('closes on Escape without leaking the keypress to anything listening above it', async () => {
    const index = await gardenWith([branch(OPTIMISERS, 'Optimisers')])
    const escapesSeenAbove: string[] = []
    const onKeyDownAbove = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escapesSeenAbove.push(event.key)
    }
    render(
      <div onKeyDown={onKeyDownAbove}>
        <SearchBox index={index} onSelect={vi.fn()} />
      </div>,
    )

    await userEvent.type(screen.getByRole('combobox'), 'optim')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(escapesSeenAbove).toEqual([])
  })
})
