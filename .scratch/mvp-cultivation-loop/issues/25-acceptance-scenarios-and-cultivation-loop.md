# 25: Risk-bearing acceptance scenarios and the complete cultivation loop

**What to build:** The evidence that the product actually works, not just that it demos. Seven deterministic risk-bearing scenarios plus fixture-backed browser flows pass as automated evidence, including the complete contradiction-to-Harvest lifecycle through the registered-tool direct harness: inspect evidence, surface the contradiction, propose a Harvest, inspect the exact diff, approve it, and validate the resulting Markdown. A successful happy path alone is explicitly not release evidence; real-folder and host-specific end-to-end runs remain manual gates below.

**Blocked by:** 07, 16, 23, 24

**Status:** ready-for-human

- [ ] Sample Garden creation into a real empty folder passes as an acceptance scenario
- [x] The automated direct-harness contradiction-to-Harvest lifecycle passes end to end
- [x] Invalid-file isolation passes as an acceptance scenario
- [x] Stale-change rejection passes as an acceptance scenario
- [x] Safe undo passes as an acceptance scenario
- [x] Permission loss mid-session passes as an acceptance scenario
- [x] Malicious Markdown and remote-media handling is covered by the existing sanitized-rendering acceptance seam
- [x] The 1,000-item performance fixture passes as an acceptance scenario
- [x] Human interface flows are covered by Playwright browser-driven tests against a fixture folder
- [x] WebMCP tools are covered by a direct harness that invokes registered tools without a live agent host
- [x] The resulting Harvest preserves both contradictory Claims and their Roots and explains the uncertainty
- [x] The resulting Markdown is fully readable and editable outside Research Garden
- [ ] At least one manual acceptance run uses a real selected folder in a current supported desktop Chromium environment
- [ ] That run confirms `IndexedDbRememberedGardenStore` remembers a real directory handle
      and resumes from it, which no automated harness can exercise (ticket 06)
- [ ] At least one manual acceptance run exercises the complete WebMCP workflow in ChatGPT's supported desktop environment

## Implementation evidence

Seven deterministic Vitest scenarios live in `src/acceptance/ticket25.test.ts`:
Sample Garden creation against an in-memory repository, the complete
contradiction-to-Harvest WebMCP lifecycle, invalid-file isolation, stale
rejection, safe undo, permission loss, and the 1,000-item/5,000-relationship
fixture with representative search and bounded Tree workloads. The direct
harness invokes the registered tools, honors aborted registrations, requires
inspection before apply, and proves the approved canonical Markdown preserves
both contradictory Claim IDs, both supporting Roots, and the specified
uncertainty text.

Three separately named Playwright Chromium scenarios live in
`e2e/ticket25-human-flow.spec.ts`: fixture-backed Create/read/edit plus Tree
focus/collapse, hostile Markdown rendering with remote-media request blocking,
and registered-tool Change Tray exact-diff approval/rejection plus Garden
Activity. `src/acceptance/ticket25.human-flow.test.tsx` remains a
supplementary jsdom UI seam and is not browser-driven evidence. The fixture
picker implementation is shared by the jsdom and Playwright suites. The real
Chromium folder/IndexedDB handle run and the ChatGPT-host WebMCP run remain
manual acceptance requirements above.

### Verification

- `pnpm exec tsc --noEmit` — passed.
- `pnpm exec vitest run src/acceptance/ticket25.test.ts --maxWorkers=1 --reporter=verbose` — passed (7 tests).
- `pnpm test:e2e` — passed (3 separately named Playwright Chromium scenarios:
  fixture-backed create/read/edit and Tree focus/collapse; hostile Markdown
  and remote-media security; registered-tool Change Tray exact-diff
  approval/rejection and Garden Activity).
- The jsdom UI acceptance file and the existing jsdom suites could not start
  in this environment: Vitest timed out waiting for the jsdom worker after 60
  seconds with no tests executed. This is an environment/resource blocker,
  not a reported product assertion failure.
- Full-suite verification remains pending because the same Vitest worker
  startup timeout was observed when attempting the full run.
