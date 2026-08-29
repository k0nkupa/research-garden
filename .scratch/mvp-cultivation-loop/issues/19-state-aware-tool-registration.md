# 19: State-aware tool registration bundles

**What to build:** A browser agent sees a compact set of tools relevant to where the person actually is — which Garden is open, what is selected, which Branch is focused, and whether anything is waiting for review — rather than one permanently enormous surface it has to disambiguate. Schemas do not shift underneath it; only relevance changes.

**Blocked by:** 18

**Status:** resolved

- [ ] Registered tools are determined by the open Garden, the selected item, the focused Branch, and the presence of Pending Changes
- [ ] Tool schemas remain stable across registration changes; only availability varies
- [ ] Tools irrelevant to the current state are unregistered rather than left registered and failing
- [ ] Registration updates promptly when the person changes selection or focus
- [ ] Registration updates when a Pending Change appears or is resolved
- [ ] Disconnecting unregisters every bundle immediately
- [ ] The registered surface at any moment is inspectable for testing without a live agent host

## Answer

Implemented state-aware, inspectable WebMCP registration bundles with stable
schemas, immediate disconnect revocation, and Workspace updates for selection,
focus, and Pending Changes. Committed as `2a5365c`.
