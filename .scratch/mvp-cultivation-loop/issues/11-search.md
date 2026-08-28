# 11: Search over the Garden Index

**What to build:** A person can find material in their Garden without traversing the Tree. Search returns useful matches with enough surrounding text to recognize what was found, and returns a bounded number of them so one query never floods the interface.

**Blocked by:** 04

**Status:** resolved

- [x] Search runs over the in-memory Garden Index and returns matching items with snippets
- [x] Results identify each match by kind, title, and stable item ID
- [x] Search returns ten results by default
- [x] Search returns at most twenty-five results regardless of what is requested
- [x] Dormant Branches and the items beneath them remain searchable
- [x] Items carrying Diagnostics remain findable
- [x] Search is reachable from the workspace and its results select into the Tree

## Notes

**What was built.** `searchGardenIndex` (`src/domain/index/gardenSearch.ts`) is a
pure function over an already-built `GardenIndex`: it matches the query against
each item's title and raw body (case-insensitive substring), ranks title
matches above body-only matches and earlier matches above later ones, and
returns a `snippet` sliced from the raw body -- never rendered Markdown --
around the match, or the start of the body for a title-only match. The
ten-default / twenty-five-cap bound from ADR 0038 is enforced inside the
function itself (`Math.min(Math.max(limit, 0), MAX_SEARCH_RESULTS)` before the
slice), not merely by the UI declining to ask for more. `SearchBox`
(`src/workspace/SearchBox.tsx`) is a thin layer on top: it calls the pure
function on every keystroke and renders each result's kind, title, and snippet
as plain text children (never `dangerouslySetInnerHTML`), so a snippet sliced
out of a hostile body can print literal `<img onerror=...>` text but can never
become markup (ADR 0056). `treeView.ts` gained `revealItem`, which expands
whatever collapsed ancestors stand between a selected item and what is
currently drawn, and drops focus on a different Branch if the item is outside
it, so a result chosen from search actually appears selected in the Tree
rather than only updating the reading panel. `Workspace.tsx`'s `selectItem`
now calls `revealItem` for every selection, which also benefits the existing
Garden Diagnostics panel (a diagnosed item behind a collapsed Branch is now
revealed too) -- the same code path, not a second one.

**Dormant Branches and Diagnostics.** Both are structural guarantees rather
than something search has to special-case: `searchGardenIndex` walks
`index.items.values()` with no filter, and the Garden Index (ADR 0050, ADR
0052) already keeps a Dormant Branch and an item carrying a relationship-level
Diagnostic in that map regardless of Tree state. Tests pin both directly
(`gardenSearch.test.ts`: "keeps a Dormant Branch and the items beneath it
searchable", "keeps an item carrying a Garden Diagnostic findable") and at the
UI layer (`Workspace.test.tsx`: "finds a Dormant Branch and selects it into the
Tree").

**Verification.** `pnpm typecheck`, `pnpm test` (967 tests, all passing), and
`pnpm build` all pass. Real-browser verification per the established pattern:
built the app, served it with `vite preview`, drove headless Chrome over CDP
with a faked `window.showDirectoryPicker`/`FileSystemDirectoryHandle`, and
confirmed by screenshot and DOM inspection that (1) the search box renders in
the workspace bar and returns ranked, snippeted results as a person types; (2)
selecting a result nested under a Branch the person had collapsed re-expands
that Branch and marks the item selected in the Tree, not just in the panel;
(3) a Dormant Branch is findable by search and selects into the Tree with its
dormant styling intact; (4) a hostile `<img onerror>` body renders as literal
text in the snippet, never as an element; (5) Escape closes the results
dropdown without leaking to the Tree's own Escape handling; (6) a result can be
reached and chosen by Tab and Enter alone, no pointer involved.

**Code review.** Both Standards- and Spec-axis reviews (opus) ran against the
diff. Fixed from their findings: a broken sentence in `gardenSearch.ts`'s
header comment; a dead ternary in the snippet-selection branch (both arms were
calling `snippetFor` with `bodyMatchAt`, which already equals `-1` in the
`else` case); an overloaded snippet function that used `-1` as a sentinel to
switch between two unrelated behaviours, now split into `contextAround` and
`leadingContext`; a test that asserted `collapsedIds` internals rather than
the observable outcome (what `visibleTreeRows` actually draws); `revealItem`
returning a literal instead of spreading `{ ...view, ... }`, the same pattern
`applyTreeAction` uses elsewhere in the file; an unused speculative `parentId`
parameter on a test fixture helper; and a real ARIA defect -- each search
result was a `role="option"` wrapping a nested interactive `<button>`, which
the listbox pattern does not permit and which meant a keyboard-only person
tabbing to a result had no way to activate it without a pointer. The option is
now the interactive element itself (`tabIndex={0}`, `onClick`, and Enter/Space
via `onKeyDown`), verified in the real browser with Tab-then-Enter and no
mouse. Also addressed: `searchGardenIndex` re-lowercased every item's title
and body on every keystroke; a `WeakMap` cache keyed on the item object now
computes each item's lowercased copy once and reuses it for the life of the
Garden Index (a rebuild produces new item objects, so the cache invalidates
itself for free).

Pushed back on, with reasons: (1) "Feature Envy" for `revealItem` rebuilding a
parent map from `childIds` rather than reusing `TreeRow.parentId` --
`visibleTreeRows` output is already filtered by the very view `revealItem`
exists to override, so the rows for a folded-away item are not there to reuse;
the function needs a view-independent parent map and computes exactly that.
(2) The `gardenWith` test helper being a "Middle Man" that just calls
`buildGardenIndex` -- this matches the existing convention of a thin
per-file render/build helper used throughout `Workspace.test.tsx`,
`gardenIndex.test.ts`, and `treeView.test.ts`. (3) `font: inherit` followed by
explicit `font-family`/`font-size` overrides on `.workspace__search-input`,
flagged as redundant -- it isn't: `font: inherit` resets an `<input>`'s
UA-default font shorthand (weight, style, line-height) to match the
surrounding app before the two properties that should differ (family, size)
are set explicitly; `.diagnostics__link` uses the identical pattern elsewhere
in `app.css`. (4) Snippet-related assertions appearing at three test layers
(pure function, component, workspace integration) -- each layer asserts a
different property (matching/ranking; snippet-is-text-not-markup safety;
end-to-end wiring through the real Tree), mirroring this codebase's existing
precedent of testing Tree keyboard behaviour at both `treeView.test.ts` and
`Workspace.test.tsx`.

Left undone by design, not by omission: a full ARIA combobox model with
`aria-activedescendant` and arrow-key traversal between results. The ticket
asks only that search be "reachable" and that results "select into the
Tree" -- both hold via mouse click and via Tab-then-Enter/Space, confirmed in
a real browser. Building the complete roving-focus combobox pattern for a
handful of results, purely on spec-speculation, would be the kind of
unrequested generality the Tree's own purpose-built keyboard model (ticket 08)
exists to avoid needing here.

One accepted, documented limitation: `contextAround`/`leadingContext` slice
the snippet from the original `item.body`, while the match position is found
against a lower-cased copy. A body containing certain characters whose
lower-cased form changes length (Turkish İ is the standard example) could
shift a snippet's window by a character. The match itself is never affected,
only, rarely, how tightly the snippet is centred on it -- judged not worth an
`O(n·m)` case-insensitive scan given ADR 0061's performance target for this
ticket's search over a 1,000-item Garden.
