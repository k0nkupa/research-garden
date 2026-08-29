/**
 * The Connect ChatGPT disclosure, and the notice shown right after
 * disconnecting (ADR 0081, ADR 0082, ADR 0083, ticket 17).
 *
 * One disclosure, not a wall of separate prompts (ADR 0082): everything a
 * person needs to decide -- what Connect shares, that reads then proceed
 * without asking again, that Disconnect cannot recall what was already
 * shared -- is said once here, before the decision, rather than doled out
 * across several screens. `Workspace` owns the actual `agentAccess` flag;
 * this component only ever asks to flip it, exactly like `ChangeDiffPanel`
 * only ever asks to approve or reject.
 */
export interface AgentAccessPanelProps {
  /** True for one render right after Disconnect, before the panel is closed. */
  readonly justDisconnected: boolean
  readonly onConnect: () => void
  readonly onClose: () => void
}

export function AgentAccessPanel({ justDisconnected, onConnect, onClose }: AgentAccessPanelProps) {
  if (justDisconnected) {
    return (
      <aside className="item-panel" aria-label="Agent Access">
        <header className="item-panel__header">
          <p className="item-panel__kind">Agent Access</p>
          <h2 className="item-panel__title">Disconnected</h2>
        </header>

        <p className="notice" role="status">
          ChatGPT can no longer reach Research Garden&rsquo;s tools. Content already returned to
          it during this session cannot be recalled. Your Garden and any Pending Changes are
          untouched.
        </p>

        <div className="item-panel__actions">
          <button type="button" className="action" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="item-panel" aria-label="Agent Access">
      <header className="item-panel__header">
        <p className="item-panel__kind">Agent Access</p>
        <h2 className="item-panel__title">Connect ChatGPT</h2>
      </header>

      <p className="item-panel__invitation">
        Connecting lets ChatGPT use Research Garden&rsquo;s tools for this browser session only.
        Selected metadata, snippets, and bodies you interact with may be returned to it &mdash;
        Research Garden does not claim your files never leave this device. Bounded reads then
        proceed without asking you to confirm each one, but every action stays visible in Garden
        Activity. Edits, moves, and other changes still need your explicit review before anything
        is written. Disconnecting later stops new sharing immediately, but content already
        returned to ChatGPT during this session cannot be recalled.
      </p>

      <div className="item-panel__actions">
        {/*
         * Not "Connect ChatGPT" again -- the bar button of that name is what
         * opened this disclosure, and Testing Library (like a screen reader
         * listing buttons by name) cannot tell two identically-named buttons
         * apart. "Enable Agent Access" names the actual state transition this
         * one performs (ADR 0081's own words), and reads as the deliberate
         * second step a disclosure is supposed to be.
         */}
        <button type="button" className="action action--primary" onClick={onConnect}>
          Enable Agent Access
        </button>
        <button type="button" className="action action--quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </aside>
  )
}
