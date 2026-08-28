import { useEffect, useState } from 'react'
import {
  detectCapabilities,
  resolveReadiness,
  type Readiness,
} from '../capabilities/capabilities'
import { useGardenSession } from '../garden/useGardenSession'
import { Workspace } from '../workspace/Workspace'
import { AlreadyAGarden } from './AlreadyAGarden'
import { ApplicationShell } from './ApplicationShell'
import { PermissionLapsed } from './PermissionLapsed'

function readReadiness(): Readiness {
  return resolveReadiness(detectCapabilities(window), {
    width: window.innerWidth,
    height: window.innerHeight,
  })
}

/**
 * Wires live browser capability and viewport state into the shell, and holds
 * the open Garden for this session.
 *
 * Capabilities and viewport are re-read together on resize, and again on
 * `online`/`offline`: of the three signals resolveReadiness depends on,
 * connectivity is the one that legitimately changes mid-session (ADR 0072). A
 * browser does not gain or lose File System Access or WebMCP mid-page.
 */
export function App() {
  const [readiness, setReadiness] = useState<Readiness>(readReadiness)
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
  } = useGardenSession()

  useEffect(() => {
    const resolve = () => setReadiness(readReadiness())

    resolve()
    window.addEventListener('resize', resolve)
    window.addEventListener('online', resolve)
    window.addEventListener('offline', resolve)
    return () => {
      window.removeEventListener('resize', resolve)
      window.removeEventListener('online', resolve)
      window.removeEventListener('offline', resolve)
    }
  }, [])

  // An unsupported environment is described before anything else, so a Garden
  // can never be half-opened somewhere it could not work (ADR 0059).
  if (readiness.kind !== 'ready') {
    return <ApplicationShell readiness={readiness} />
  }

  if (session.kind === 'open') {
    return <Workspace garden={session.garden} />
  }

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
      readiness={readiness}
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
