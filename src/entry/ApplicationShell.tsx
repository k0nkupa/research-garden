import type { ReactNode } from 'react'
import {
  MINIMUM_WORKSPACE_HEIGHT,
  MINIMUM_WORKSPACE_WIDTH,
  type AgentInterfaceStatus,
  type MissingCapability,
  type Readiness,
} from '../capabilities/capabilities'
import { BareTrunk } from './BareTrunk'

export interface ApplicationShellProps {
  readonly readiness: Readiness
  readonly onCreateGarden?: () => void
  readonly onOpenGarden?: () => void
  /** A folder is being scanned; the actions must not be invoked twice. */
  readonly busy?: boolean
  /** A Garden could not be opened, in the person's terms. */
  readonly failure?: string | undefined
  /** ADR 0060: the folder this browser remembers, if any. */
  readonly remembered?: { readonly name: string } | undefined
  readonly onResume?: () => void
  readonly onForget?: () => void
}

/**
 * The application shell.
 *
 * Every unsupported environment resolves to an explanation naming the specific
 * missing capability, and the Garden actions are absent from those screens
 * rather than present-and-failing — an unsupported environment must never
 * partially execute an action (ADR 0059).
 */
export function ApplicationShell({
  readiness,
  onCreateGarden,
  onOpenGarden,
  busy = false,
  failure,
  remembered,
  onResume,
  onForget,
}: ApplicationShellProps) {
  if (readiness.kind === 'unsupported-viewport') {
    return <UnsupportedViewport />
  }

  if (readiness.kind === 'unsupported-browser') {
    return <UnsupportedBrowser missing={readiness.missing} />
  }

  return (
    <main className="shell shell--trunk">
      <div className="trunk-scene">
        <header className="trunk-scene__header">
          <h1 className="trunk-scene__title">Research Garden</h1>
          <p className="trunk-scene__promise">
            A local-first research interface. Your Garden is made of Markdown files in a
            folder you choose, and it stays there.
          </p>
        </header>

        {/* ADR 0046: the two actions sit at the soil line of a bare trunk. */}
        <div className="trunk-scene__figure">
          <BareTrunk />
          <div className="trunk-scene__buttons">
            <button
              type="button"
              className="action action--primary"
              onClick={onCreateGarden}
              disabled={busy}
            >
              Create Garden
            </button>
            <button type="button" className="action" onClick={onOpenGarden} disabled={busy}>
              {busy ? 'Opening…' : 'Open Garden'}
            </button>
          </div>
        </div>

        {remembered && (
          <p className="trunk-scene__remembered">
            <button type="button" className="action action--quiet" onClick={onResume}>
              Resume {remembered.name}
            </button>
            <button type="button" className="trunk-scene__forget" onClick={onForget}>
              Forget it
            </button>
          </p>
        )}

        {failure !== undefined && (
          <p className="notice notice--failure" role="alert">
            {failure}
          </p>
        )}

        {readiness.agentInterface !== 'available' && (
          <AgentInterfaceUnavailable reason={readiness.agentInterface} />
        )}
      </div>
    </main>
  )
}

/**
 * Every unavailable reason a status other than `'available'` can name, mirroring
 * MISSING_CAPABILITY_HEADINGS below: an exhaustive map means a third reason
 * added later fails to typecheck here instead of silently falling through an
 * `if`/`else`.
 */
type AgentInterfaceUnavailableReason = Exclude<AgentInterfaceStatus, 'available'>

/**
 * ADR 0059/0072: neither an unsupported browser nor a lost connection is a
 * barrier to the human interface — only to agent workflows, so this is a
 * notice, not a blocking screen. The two reasons get different copy because
 * they call for different next steps: "offline" resolves itself the moment
 * connectivity returns, "unsupported" never will in this browser.
 */
const AGENT_INTERFACE_UNAVAILABLE_COPY: Record<AgentInterfaceUnavailableReason, ReactNode> = {
  offline: (
    <>
      You are offline, so ChatGPT cannot connect to a Garden here right now. Everything else
      works: you can create, open, read, and edit a Garden exactly as normal. Agent workflows
      will resume once your connection returns.
    </>
  ),
  unsupported: (
    <>
      This browser does not support <strong>WebMCP</strong>, so ChatGPT cannot connect to a
      Garden here. Everything else works: you can create, open, read, and edit a Garden
      exactly as normal.
    </>
  ),
}

function AgentInterfaceUnavailable({ reason }: { readonly reason: AgentInterfaceUnavailableReason }) {
  return (
    <p className="notice" role="status">
      {AGENT_INTERFACE_UNAVAILABLE_COPY[reason]}
    </p>
  )
}

const MISSING_CAPABILITY_HEADINGS: Record<MissingCapability, string> = {
  'local-folder-access': 'This browser does not support local-folder access',
}

function UnsupportedBrowser({ missing }: { readonly missing: MissingCapability }) {
  return (
    <main className="shell shell--explanation">
      <div className="explanation">
        <h1>{MISSING_CAPABILITY_HEADINGS[missing]}</h1>
        <p>
          Research Garden works directly with Markdown files in a folder on your computer,
          so it needs the browser&rsquo;s File System Access capability to open one. This
          browser does not provide it, and there is no hosted copy of your Garden to fall
          back to &mdash; that is the point of the product.
        </p>
        <p>A current desktop Chromium browser &mdash; Chrome or Edge &mdash; provides it.</p>
      </div>
    </main>
  )
}

/**
 * The desktop requirement is resolved before any capability check (ADR 0040),
 * so this explanation also names local-folder access: a small screen very often
 * lacks it too, and that person should still learn which capability a desktop
 * browser is needed for rather than only that their screen is small.
 */
function UnsupportedViewport() {
  return (
    <main className="shell shell--explanation">
      <div className="explanation">
        <h1>Research Garden needs a desktop browser</h1>
        <p>
          The Garden workspace puts a navigable Tree, a selected item, and the Change Tray
          side by side, and it needs room to do that. This screen is smaller than the{' '}
          {MINIMUM_WORKSPACE_WIDTH}&times;{MINIMUM_WORKSPACE_HEIGHT} the workspace is
          designed for.
        </p>
        <p>
          A desktop browser is also where you will find <strong>local-folder access</strong>,
          the File System Access capability Research Garden needs to open your Markdown
          directly. Mobile browsers do not offer it.
        </p>
        <p>
          Rather than offer folder access, Tree navigation, and editing in a form that would
          not work, we would rather say plainly: open this on a desktop.
        </p>
      </div>
    </main>
  )
}
