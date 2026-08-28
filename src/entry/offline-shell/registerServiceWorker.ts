/**
 * Registers the offline application shell's service worker (ticket 16, ADR 0072).
 *
 * Mirrors capabilities.ts's environment-injection pattern: the decision of
 * *whether* to register is a pure function over an injected environment, so it
 * is verifiable without a real browser or a real production build. *Whether
 * registration itself then succeeds* is exactly the kind of thing this
 * repo verifies with a real browser instead (see the ticket's Notes).
 */
export interface ServiceWorkerRegistrationEnvironment {
  /** True only for a production build (`import.meta.env.PROD`). */
  readonly isProduction: boolean
  /** Absent in browsers with no Service Worker support at all. */
  readonly serviceWorker?: { register(url: string): Promise<unknown> } | undefined
  readonly addEventListener: (type: 'load', listener: () => void) => void
}

function defaultEnvironment(): ServiceWorkerRegistrationEnvironment {
  return {
    isProduction: import.meta.env.PROD,
    serviceWorker: typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
  }
}

/**
 * Registration is deferred to `window`'s `load` event and its failure is
 * swallowed: offline capability is a progressive enhancement, not a
 * requirement, so neither slowing down first paint nor a registration error
 * may affect the human interface either way (ADR 0059's spirit extended to
 * connectivity).
 */
export function registerServiceWorker(
  environment: ServiceWorkerRegistrationEnvironment = defaultEnvironment(),
): void {
  if (!environment.isProduction) return
  const { serviceWorker } = environment
  if (!serviceWorker) return

  environment.addEventListener('load', () => {
    serviceWorker.register('/sw.js').catch(() => {
      // See the doc comment above: offline capability is optional.
    })
  })
}
