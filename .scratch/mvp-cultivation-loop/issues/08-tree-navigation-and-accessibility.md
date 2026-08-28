# 08: Tree navigation, focus, collapse, dormancy, and accessibility

**What to build:** A person can actually work in a Tree that has grown past a handful of items. They pan, zoom, select, collapse a Branch to bound what is drawn, and focus on one Branch without altering any canonical relationship. Everything reachable by mouse is reachable by keyboard, screen readers get the structure as text, and nobody is made unwell by motion. Restructuring stays deliberate: there is no drag gesture that can rearrange knowledge by accident.

**Blocked by:** 04

**Status:** resolved

- [x] Pan, zoom, and selection work with the pointer
- [x] Tree traversal, selection, Branch collapse, and Branch focus are all reachable from the keyboard alone
- [x] Every node and relationship exposes a semantic label to assistive technology
- [x] Reduced-motion preference is honoured throughout the Tree
- [x] Collapsing a Branch bounds the visible SVG workload
- [x] Focusing a Branch changes only the view and leaves every canonical relationship untouched
- [x] Branches carry an explicit active or dormant state; Dormant Branches visually recede while remaining canonical, searchable, and focusable
- [x] No drag-to-reparent or free node positioning exists; structural movement is only ever a proposed action
- [x] The Tree remains a navigational projection and is never presented as a folder browser

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 929 passing across 26 files, `pnpm build`
succeeds.

Driven in real headless Chromium with CDP key dispatch against a Garden of six items
including a nested Branch and a Dormant Branch:

- six nodes drawn, exactly one in the tab order, `aria-setsize`/`aria-posinset` correct
- ArrowDown and ArrowUp moved DOM focus through four nodes in sequence and back, and
  Enter selected the focused item into the panel -- no pointer involved
- ArrowLeft collapsed a Branch and the drawn nodes went from six to three: the SVG
  genuinely shrank rather than hiding anything
- `f` narrowed the Tree to one Branch and its subtree, with a banner offering the way back
- under emulated `prefers-reduced-motion: reduce` the Tree's transition fell from 0.12s to
  0.01ms, and was unchanged otherwise

### Bugs the review caught

- **Panning could stick.** A drag armed on any button, so a right-click left the Tree
  panning on buttonless movement with no matching release. Primary button only now, with
  pointer capture so a drag that leaves the pane keeps working.
- **Panning was unbounded**, so a person could push their Garden off the pane with no way
  back short of reloading. Bounded now.
- **Escape was always claimed and always rebuilt the view**, even when nothing was
  focused, which re-walked the whole Tree on every stray press and would have stolen the
  key from the future Change Tray. Every no-op action now returns the same object.
- **The Tree could lose its tab stop entirely.** The tabbable id had no fallback for an id
  that was no longer visible, so collapsing away the selected item would have dropped the
  Tree out of the tab order.
- **The Tree was walked twice** per view change -- once by the component and once inside
  the layout -- which is precisely the cost ADR 0061 asks to be bounded.
- **A dead reduced-motion rule** claimed an effect the `!important` above it already had.
- **The zoom bound test asserted `scale > 0`**, which would have passed with the bound
  deleted. It asserts the actual limits now.

### A defect only a real browser could show

Arrow keys moved the tab order while the browser's focus stayed put, so a keyboard user
was stuck on the first node and every subsequent arrow arrived from it. The jsdom test
passed because it asserted `tabindex` had moved rather than that focus had. It now asserts
`document.activeElement`.

### Where the accessible labelling stops

Every node states its kind, title, level, position among siblings, dormancy, and any
Garden Diagnostic. A Cross-link is described by type and count -- "Contradicts 1,
Supports 2" -- but not by naming the item at the other end. Following a relationship to
its far end is the evidence-tracing interaction, and that is ticket 09.

### Scope note

Dormancy is conveyed by opacity alone. Dashing the glyph outline was tried and fragments
the shape at this size, and ADR 0044 makes shape the carrier that has to survive: a Branch
must still read as a Branch when it is dormant. The accessible name says "dormant"
outright, so nothing rests on the visual.
