import { describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from './registerServiceWorker'

function fakeEnvironment(overrides: Partial<Parameters<typeof registerServiceWorker>[0]> = {}) {
  const register = vi.fn().mockResolvedValue(undefined)
  const listeners: Record<string, () => void> = {}

  return {
    register,
    fireLoad: () => listeners.load?.(),
    environment: {
      isProduction: true,
      serviceWorker: { register },
      addEventListener: (type: 'load', listener: () => void) => {
        listeners[type] = listener
      },
      ...overrides,
    },
  }
}

describe('registerServiceWorker', () => {
  it('registers the offline shell at the site root once the page has loaded', () => {
    const { register, fireLoad, environment } = fakeEnvironment()

    registerServiceWorker(environment)
    expect(register).not.toHaveBeenCalled()

    fireLoad()

    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('does nothing outside a production build, so the dev server is never intercepted', () => {
    const { register, fireLoad, environment } = fakeEnvironment({ isProduction: false })

    registerServiceWorker(environment)
    fireLoad()

    expect(register).not.toHaveBeenCalled()
  })

  it('does nothing when the browser exposes no service worker container', () => {
    const { environment } = fakeEnvironment({ serviceWorker: undefined })

    expect(() => registerServiceWorker(environment)).not.toThrow()
  })

  // Offline capability is a progressive enhancement (ADR 0059's spirit
  // extended to connectivity): a registration failure must never surface as
  // an application error or block the human interface.
  it('swallows a registration failure rather than throwing', async () => {
    const register = vi.fn().mockRejectedValue(new Error('registration failed'))
    const { fireLoad, environment } = fakeEnvironment({ serviceWorker: { register } })

    registerServiceWorker(environment)
    fireLoad()
    await Promise.resolve()
    await Promise.resolve()

    expect(register).toHaveBeenCalled()
  })
})
