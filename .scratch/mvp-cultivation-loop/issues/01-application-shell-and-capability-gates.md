# 01: Application shell, capability gates, and the bare trunk

**What to build:** A person visits the public site and lands on a bare trunk with Create Garden and Open Garden at the soil line — not a conventional landing page. No login, signup, or account prompt appears anywhere. If their browser lacks local-folder access or WebMCP, they get a polished explanation naming the specific missing capability rather than a generic failure. On a small screen they are told plainly that the Garden workspace needs a compatible desktop browser.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The application builds and serves as a client-only React and TypeScript PWA with no application data backend, accounts, or server-side rendering
- [x] The entry screen is a bare trunk with Create Garden and Open Garden at the soil line
- [x] No login, signup, or account affordance exists anywhere in the interface
- [x] Local-folder access and WebMCP are feature-detected independently of each other
- [x] A browser missing local-folder access receives an explanation naming that capability
- [x] A browser missing WebMCP receives an explanation naming that capability, and the human interface remains fully usable
- [x] A screen below the supported desktop size receives a clear compatible-desktop-browser explanation
- [x] An unsupported environment never partially executes an action
- [x] The build contains no analytics scripts, behavioral tracking, remote error payloads, or content telemetry
- [x] The dependency surface is limited to libraries serving a named product boundary; no note-editor or graph-editor framework is introduced

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 56 passing across 4 files, `pnpm build`
succeeds, and the built output was rendered in real desktop Chromium at 1440x900,
1200x760, and true-390px emulated metrics.

Deliberately deferred, with the ticket that owns each:

- The two Garden Actions render inert. Folder selection, the filesystem port, and the
  Garden Index are ticket 02; half-wiring them here would be the partial execution this
  shell exists to prevent.
- The service worker is ticket 16. Only the web app manifest is present.
- The manifest ships a single SVG icon. Whether that satisfies installability across
  target browsers is unverified and belongs with ticket 16, which owns the PWA shell.
- Self-hosted Literata, Instrument Sans, and IBM Plex Mono are ticket 10. The palette and
  font stacks are declared as ADR 0039 specifies them; no webfont is fetched, because a
  font request to a third party would be a passive disclosure of use (ADR 0073).
