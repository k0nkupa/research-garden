import { useEffect, useState } from 'react'
import {
  detectCapabilities,
  resolveReadiness,
  type Readiness,
} from '../capabilities/capabilities'
import { ApplicationShell } from './ApplicationShell'

function readReadiness(): Readiness {
  return resolveReadiness(detectCapabilities(window), {
    width: window.innerWidth,
    height: window.innerHeight,
  })
}

/**
 * Wires live browser capability and viewport state into the shell.
 *
 * Capabilities and viewport are re-read together on resize, because the
 * viewport is the only one of the two that changes during a session: a browser
 * does not gain or lose File System Access or WebMCP mid-page.
 */
export function App() {
  const [readiness, setReadiness] = useState<Readiness>(readReadiness)

  useEffect(() => {
    const resolve = () => setReadiness(readReadiness())

    resolve()
    window.addEventListener('resize', resolve)
    return () => window.removeEventListener('resize', resolve)
  }, [])

  return <ApplicationShell readiness={readiness} />
}
