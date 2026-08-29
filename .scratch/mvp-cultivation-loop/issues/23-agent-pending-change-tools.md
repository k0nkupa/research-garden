# 23: Agent pending-change tools with inspect-gated apply

**What to build:** A browser agent can carry a proposal through to a written file, but only along a path where a human is unavoidably in the loop and the application checks everything itself. The apply tool does not exist until the agent has actually opened one exact diff, and the request must carry that change's identity and preview hash. Even then, the host's confirmation is not treated as authorization: Research Garden revalidates the world before it writes, and a changed target makes the proposal stale rather than a silent overwrite.

**Blocked by:** 22

**Status:** resolved

- [ ] List pending changes returns identified Pending Changes within read bounds
- [ ] Inspect pending change opens one exact diff for one identified change
- [ ] Apply pending change is registered only after inspect has opened that exact diff
- [ ] An apply request must carry the change identity and the preview hash from the inspection
- [ ] Apply revalidates directory permission, target content hash, preview hash, one-file scope, schema, and graph invariants before writing
- [ ] Tool availability and host confirmation never substitute for application-enforced revalidation
- [ ] A mismatch on any revalidation marks the proposal stale and returns the staleness error rather than overwriting
- [ ] Apply runs the full snapshot, write once, reread, revalidate, confirm-hash sequence before reporting success
- [ ] Reject pending change is scoped to one identified change and subject to the host's confirmation flow
- [ ] Undo change is scoped to one identified change and permitted only while the current file matches that change's resulting hash
- [ ] Apply, reject, and undo each appear in the Garden Activity feed with their outcome
- [ ] No deletion or pruning capability is exposed by any tool

## Answer

Implemented bounded pending-change list and exact-diff inspection tools, with
apply registered only after the matching inspection identity is present. Apply
now reuses the verified approval action to recheck permission, hashes,
one-file scope, schema, and graph invariants before snapshot/write/reread/hash
confirmation; stale targets remain unwritten. Reject and undo are identified,
confirmation-marked mutation tools with Activity entries, and undo remains
available after the final proposal is applied. Focused pending-change tests,
typecheck, and production build passed. The full Vitest suite was attempted
but made no progress during worker startup and was stopped without reporting
test failures.
