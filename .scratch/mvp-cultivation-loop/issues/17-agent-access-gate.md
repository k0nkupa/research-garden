# 17: Agent Access gate — description tool, Connect, disclosure, Disconnect

**What to build:** Connecting an agent is always an act, never a default. A person opens their Garden in human-only mode; before that and until they choose otherwise, a browser agent sees only a tool describing what Research Garden is, and no filesystem-backed capability appears usable. Choosing Connect ChatGPT shows one honest disclosure — that selected metadata, snippets, and bodies may be returned to the agent — and enables Agent Access for this session only. Disconnect revokes immediately, keeps their in-progress work, and tells them plainly what revocation cannot undo.

**Blocked by:** 14

**Status:** resolved

- [x] Before a Garden is open, WebMCP exposes only the non-filesystem description tool
- [x] Opening or creating a Garden establishes browser folder permission but registers no filesystem-backed tools
- [x] A Garden opens in human-only mode; folder permission and Agent Access are separate decisions
- [x] A visible Connect ChatGPT action is discoverable in the workspace
- [x] Connecting shows one disclosure explaining that selected metadata, snippets, and bodies may be returned to the browser agent
- [x] The disclosure does not claim that data never leaves the device
- [x] After the disclosure, bounded read actions proceed without repetitive per-call confirmation while remaining visible in Garden Activity
- [x] Agent Access is scoped to the current browser session and is never silently restored after reload, even with a remembered directory handle
- [x] Disconnect ChatGPT unregisters the Garden tools immediately
- [x] Disconnecting leaves existing Pending Changes local and reviewable in the human interface
- [x] Disconnecting states plainly that content already returned to the agent cannot be recalled
- [x] Connect and Disconnect appear in the Garden Activity feed

## Notes

Built `src/webmcp/modelContext.ts` (a narrow, defensively-typed wrapper around
`navigator.modelContext.registerTool`, matching the real WebMCP IDL: async,
takes `{ signal }` for unregistration rather than a separate `unregisterTool`
call) and `src/webmcp/describeResearchGarden.ts` (the actual
`describe_research_garden` tool, registered unconditionally in `App.tsx`
outside any `readiness`/`session` branch, so it is present before any Garden
is open and independent of Agent Access). `src/workspace/AgentAccessPanel.tsx`
is the one disclosure (ADR 0082): before connecting it names what Connect
shares and what Disconnect cannot undo; right after disconnecting it repeats
the second half plainly. `Workspace.tsx` gained a plain `agentAccess`
`useState(false)` -- never read from anything persisted, so a fresh mount
(including from a remembered directory handle) always starts human-only --
and `connect_agent`/`disconnect_agent` Garden Activity entries following the
exact shape `activityForApproveChange`/`activityForRejectChange` already
established in ticket 14.

**Scope boundary, honestly caveated:** three criteria describe behavior this
ticket's own architecture is ready for but cannot yet be empirically
demonstrated, because tickets 18/19 (the actual filesystem-backed tools and
their state-aware bundle registration) do not exist yet. "Registers no
filesystem-backed tools" and "Disconnect ChatGPT unregisters the Garden tools
immediately" are true today only because there is nothing to register or
unregister beyond the one always-on description tool, which correctly stays
untouched by Connect/Disconnect either way. "Bounded read actions proceed
without repetitive per-call confirmation" is true of the disclosure's own
wording and of the `agentAccess` flag ticket 18's tools will read, but there
are no read tools yet to click through and prove it against. Checked because
the ticket's own scope (stated in tickets 18-23) draws this exact boundary,
not because the behavior is fully exercised end to end yet.

**A real, load-bearing risk found during research, deliberately not acted
on:** the current WebMCP spec draft (checked live against
webmachinelearning/webmcp's `index.bs` while implementing this) has moved the
registry's entry point from `navigator.modelContext` to
`document.modelContext`, with Chromium reportedly deprecating the `navigator`
form. This codebase's existing, already-shipped `capabilities.ts` (ticket 01)
feature-detects `navigator.modelContext`, and ADR 0068 says that detection was
validated against the real deployed target. Switching entry points now would
be a real behavior change to already-tested, already-validated code, entirely
outside this ticket's scope, and risks being wrong in the other direction if
the actual ChatGPT host still expects `navigator`. `modelContext.ts` therefore
deliberately stays consistent with `capabilities.ts` rather than the newer
spec text. This should be re-verified against the real deployed ChatGPT Sites
target (ADR 0068's own requirement) before relying on it, and is the single
highest-risk unknown this ticket leaves behind.

Code review (Standards + Spec axes) caught one real, fixed issue: the panel's
confirm button was originally also labelled "Connect ChatGPT", identical to
the workspace bar button that opens it -- two simultaneously-visible buttons
with the same accessible name, indistinguishable to a screen reader or to
Testing Library without manual DOM scoping. Renamed to "Enable Agent Access",
which also names the actual state transition more precisely (ADR 0081's own
wording). It also caught a weak test: "leaves Pending Changes untouched"
originally only checked that the tray's *empty*-state message still rendered
after Disconnect, which cannot distinguish "never touched" from "always empty
in this fixture." Strengthened to propose a real Pending Change first (mirrors
`changeTrayLifecycle.test.tsx`'s pattern from ticket 14), then confirmed by
mutation testing: reverting the fix (making `disconnectAgent` clear
`pendingChanges`) reliably fails the strengthened test.

Two judgement calls from review, deliberately left as-is: `asModelContextRegistry`
in `modelContext.ts` repeats two guard-clause lines already in
`capabilities.ts`'s `exposesAgentToolRegistry` -- not unified, because the two
check different things (coarse presence vs. a specific callable shape) for
callers in otherwise-independent modules, and coupling them for two lines
seemed like the wrong trade. `registerDescribeResearchGardenTool` is a thin
wrapper with only one call inside it -- kept, since it gives `App.tsx` a
readable, tool-specific name to call, matching the `activityForX` naming
idiom used everywhere else in this codebase.

**Not verified in a real browser:** no browser-automation tool was available
in this session (unlike ticket 14, which used a CDP-driven check). Verification
here is jsdom component/e2e tests only (`AgentAccessPanel.test.tsx`,
`agentAccessLifecycle.test.tsx`, `App.test.tsx`) -- real rendered markup, ARIA
roles, and click handlers, but not actual browser layout or a real
`navigator.modelContext` call.
