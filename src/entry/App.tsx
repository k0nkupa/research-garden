import { useEffect, useState } from 'react'
import {
  detectCapabilities,
  resolveReadiness,
  type Readiness,
} from '../capabilities/capabilities'
import { useGardenSession } from '../garden/useGardenSession'
import { Workspace } from '../workspace/Workspace'
import { registerDescribeResearchGardenTool } from '../webmcp/describeResearchGarden'
import { AlreadyAGarden } from './AlreadyAGarden'
import { ApplicationShell } from './ApplicationShell'
import { PermissionLapsed } from './PermissionLapsed'

function readReadiness(): Readiness {
  return resolveReadiness(detectCapabilities(window))
}

/**
 * Wires live browser capability state into the shell, and holds the open
 * Garden for this session.
 *
 * Connectivity is re-read on `online`/`offline` because it can legitimately
 * change mid-session (ADR 0072). File System Access and WebMCP do not depend
 * on viewport size and do not change because a person resizes the window.
 *
 * `describe_research_garden` (ticket 17, ADR 0035) registers here,
 * unconditionally and once, independent of `readiness` or `session`: it is
 * the one tool WebMCP always exposes, before any Garden is open and before
 * Agent Access is ever enabled, so it cannot wait on either. The effect's own
 * cleanup aborts the registration signal, which is what lets Strict Mode's
 * mount-cleanup-mount cycle in development register it twice without the
 * second call ever seeing a "this name is already registered" failure from
 * the first.
 */
export function App() {
  const [readiness, setReadiness] = useState<Readiness>(readReadiness)
  const {
    session,
    createFromPicker,
    openFromPicker,
    openImportedFiles,
    openChosen,
    retryPermission,
    dismiss,
    remembered,
    resumeRemembered,
    forgetRemembered,
    discardImported,
  } = useGardenSession()

  useEffect(() => {
    const resolve = () => setReadiness(readReadiness())

    resolve()
    window.addEventListener('online', resolve)
    window.addEventListener('offline', resolve)
    return () => {
      window.removeEventListener('online', resolve)
      window.removeEventListener('offline', resolve)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void registerDescribeResearchGardenTool(window.navigator, controller.signal)
    return () => controller.abort()
  }, [])

  // An unsupported environment is described before anything else, so a Garden
  // can never be half-opened somewhere it could not work (ADR 0059).
  if (readiness.kind !== 'ready') {
    return <ApplicationShell readiness={readiness} />
  }

  if (session.kind === 'open') {
    return <Workspace garden={session.garden} agentInterface={readiness.agentInterface} sourceMode={session.sourceMode} onDiscardImported={discardImported} />
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
      onImportGarden={openImportedFiles}
      busy={session.kind === 'working'}
      failure={session.kind === 'failed' ? session.message : undefined}
      remembered={remembered}
      onResume={resumeRemembered}
      onForget={forgetRemembered}
    />
  )
}
