# 08: Tree navigation, focus, collapse, dormancy, and accessibility

**What to build:** A person can actually work in a Tree that has grown past a handful of items. They pan, zoom, select, collapse a Branch to bound what is drawn, and focus on one Branch without altering any canonical relationship. Everything reachable by mouse is reachable by keyboard, screen readers get the structure as text, and nobody is made unwell by motion. Restructuring stays deliberate: there is no drag gesture that can rearrange knowledge by accident.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Pan, zoom, and selection work with the pointer
- [ ] Tree traversal, selection, Branch collapse, and Branch focus are all reachable from the keyboard alone
- [ ] Every node and relationship exposes a semantic label to assistive technology
- [ ] Reduced-motion preference is honoured throughout the Tree
- [ ] Collapsing a Branch bounds the visible SVG workload
- [ ] Focusing a Branch changes only the view and leaves every canonical relationship untouched
- [ ] Branches carry an explicit active or dormant state; Dormant Branches visually recede while remaining canonical, searchable, and focusable
- [ ] No drag-to-reparent or free node positioning exists; structural movement is only ever a proposed action
- [ ] The Tree remains a navigational projection and is never presented as a folder browser
