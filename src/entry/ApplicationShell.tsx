import {
  MINIMUM_WORKSPACE_HEIGHT,
  MINIMUM_WORKSPACE_WIDTH,
  type MissingCapability,
  type Readiness,
} from '../capabilities/capabilities'
import { BareTrunk } from './BareTrunk'

export interface ApplicationShellProps {
  readonly readiness: Readiness
  /**
   * Create Garden stays inert until ticket 06, which owns materializing a
   * Sample Garden into an empty folder.
   */
  readonly onCreateGarden?: () => void
  readonly onOpenGarden?: () => void
  /** A folder is being scanned; the actions must not be invoked twice. */
  readonly busy?: boolean
  /** A Garden could not be opened, in the person's terms. */
  readonly failure?: string | undefined
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

        {failure !== undefined && (
          <p className="notice notice--failure" role="alert">
            {failure}
          </p>
        )}

        {!readiness.agentInterfaceAvailable && <AgentInterfaceUnavailable />}
      </div>
    </main>
  )
}

/**
 * ADR 0059: WebMCP's absence is a notice, not a barrier. The complete human
 * interface remains usable; only agent workflows are unavailable.
 */
function AgentInterfaceUnavailable() {
  return (
    <p className="notice" role="status">
      This browser does not support <strong>WebMCP</strong>, so ChatGPT cannot connect to a
      Garden here. Everything else works: you can create, open, read, and edit a Garden
      exactly as normal.
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
