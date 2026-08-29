/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { App } from './App'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

function grantLocalFolderAccess() {
  Object.defineProperty(window, 'showDirectoryPicker', {
    value: () => Promise.resolve(),
    configurable: true,
  })
}

function grantWebMcp(registerTool?: (tool: unknown, options?: unknown) => Promise<undefined>) {
  Object.defineProperty(navigator, 'modelContext', {
    value: registerTool ? { registerTool } : {},
    configurable: true,
  })
}

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'showDirectoryPicker')
  Reflect.deleteProperty(navigator, 'modelContext')
  setViewport(1440, 900)
  setOnLine(true)
})

describe('App', () => {
  it('shows the bare trunk when the real environment supports a Garden', () => {
    setViewport(1440, 900)
    grantLocalFolderAccess()

    render(<App />)

    expect(screen.getByRole('button', { name: /create garden/i })).toBeInTheDocument()
  })

  it('explains the missing capability when the real environment cannot open a folder', () => {
    setViewport(1440, 900)

    render(<App />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/local[- ]folder access/i)
  })

  // ADR 0040: the desktop requirement is evaluated against the live viewport,
  // so narrowing the window explains rather than silently degrading.
  it('re-resolves when the viewport is resized below the supported size', () => {
    setViewport(1440, 900)
    grantLocalFolderAccess()

    render(<App />)
    expect(screen.getByRole('button', { name: /create garden/i })).toBeInTheDocument()

    act(() => {
      setViewport(390, 720)
      window.dispatchEvent(new Event('resize'))
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/desktop/i)
    expect(screen.queryByRole('button', { name: /create garden/i })).not.toBeInTheDocument()
  })

  it('re-resolves when the viewport is restored to a supported size', () => {
    setViewport(390, 720)
    grantLocalFolderAccess()

    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/desktop/i)

    act(() => {
      setViewport(1440, 900)
      window.dispatchEvent(new Event('resize'))
    })

    expect(screen.getByRole('button', { name: /create garden/i })).toBeInTheDocument()
  })

  // ADR 0072: agent workflows require the host connection, and that can be
  // lost or regained without a reload, so the shell must react live.
  it('re-resolves the agent interface when connectivity is lost and regained', () => {
    setViewport(1440, 900)
    grantLocalFolderAccess()
    grantWebMcp()

    render(<App />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i)

    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // ADR 0035, ticket 17: the one tool WebMCP always exposes, independent of
  // whether a Garden is open or Agent Access is on.
  it('registers describe_research_garden through WebMCP as soon as it mounts', () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    setViewport(1440, 900)
    grantWebMcp(registerTool)

    render(<App />)

    expect(registerTool).toHaveBeenCalledTimes(1)
    const [tool] = registerTool.mock.calls[0] as [{ name: string }]
    expect(tool.name).toBe('describe_research_garden')
  })

  it('registers it before any Garden is open and without local folder access', () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    setViewport(1440, 900)
    grantWebMcp(registerTool)
    // Deliberately no grantLocalFolderAccess(): this browser cannot open a
    // Garden at all, and the description tool must still be there.

    render(<App />)

    expect(registerTool).toHaveBeenCalledTimes(1)
  })

  it('registers nothing when WebMCP is not present', () => {
    setViewport(1440, 900)
    grantLocalFolderAccess()

    expect(() => render(<App />)).not.toThrow()
  })
})
