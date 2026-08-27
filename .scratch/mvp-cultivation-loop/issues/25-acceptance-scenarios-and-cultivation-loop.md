# 25: Risk-bearing acceptance scenarios and the complete cultivation loop

**What to build:** The evidence that the product actually works, not just that it demos. All eight risk-bearing scenarios pass as automated evidence, and the complete cultivation loop runs end to end: select an empty folder, create the Sample Garden, connect ChatGPT, have it inspect evidence and surface the contradiction, propose a Harvest, inspect the exact diff, approve it, and find the resulting Markdown sitting in the folder — readable and editable without Research Garden. A successful happy path alone is explicitly not release evidence.

**Blocked by:** 07, 16, 23, 24

**Status:** ready-for-agent

- [ ] Sample Garden creation into a real empty folder passes as an acceptance scenario
- [ ] The complete contradiction-to-Harvest flow passes end to end
- [ ] Invalid-file isolation passes as an acceptance scenario
- [ ] Stale-change rejection passes as an acceptance scenario
- [ ] Safe undo passes as an acceptance scenario
- [ ] Permission loss mid-session passes as an acceptance scenario
- [ ] Malicious Markdown and remote-media handling passes as an acceptance scenario
- [ ] The 1,000-item performance fixture passes as an acceptance scenario
- [ ] Human interface flows are covered by browser-driven tests against a fixture folder
- [ ] WebMCP tools are covered by a direct harness that invokes registered tools without a live agent host
- [ ] The resulting Harvest preserves both contradictory Claims and their Roots and explains the uncertainty
- [ ] The resulting Markdown is fully readable and editable outside Research Garden
- [ ] At least one manual acceptance run uses a real selected folder in a current supported desktop Chromium environment
- [ ] That run confirms `IndexedDbRememberedGardenStore` remembers a real directory handle
      and resumes from it, which no automated harness can exercise (ticket 06)
- [ ] At least one manual acceptance run exercises the complete WebMCP workflow in ChatGPT's supported desktop environment
