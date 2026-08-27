# 17: Agent Access gate — description tool, Connect, disclosure, Disconnect

**What to build:** Connecting an agent is always an act, never a default. A person opens their Garden in human-only mode; before that and until they choose otherwise, a browser agent sees only a tool describing what Research Garden is, and no filesystem-backed capability appears usable. Choosing Connect ChatGPT shows one honest disclosure — that selected metadata, snippets, and bodies may be returned to the agent — and enables Agent Access for this session only. Disconnect revokes immediately, keeps their in-progress work, and tells them plainly what revocation cannot undo.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] Before a Garden is open, WebMCP exposes only the non-filesystem description tool
- [ ] Opening or creating a Garden establishes browser folder permission but registers no filesystem-backed tools
- [ ] A Garden opens in human-only mode; folder permission and Agent Access are separate decisions
- [ ] A visible Connect ChatGPT action is discoverable in the workspace
- [ ] Connecting shows one disclosure explaining that selected metadata, snippets, and bodies may be returned to the browser agent
- [ ] The disclosure does not claim that data never leaves the device
- [ ] After the disclosure, bounded read actions proceed without repetitive per-call confirmation while remaining visible in Garden Activity
- [ ] Agent Access is scoped to the current browser session and is never silently restored after reload, even with a remembered directory handle
- [ ] Disconnect ChatGPT unregisters the Garden tools immediately
- [ ] Disconnecting leaves existing Pending Changes local and reviewable in the human interface
- [ ] Disconnecting states plainly that content already returned to the agent cannot be recalled
- [ ] Connect and Disconnect appear in the Garden Activity feed
