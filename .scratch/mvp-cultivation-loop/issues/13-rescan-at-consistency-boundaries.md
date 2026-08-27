# 13: Rescan at consistency boundaries

**What to build:** A person who edits a file in another editor finds that Research Garden notices. The Garden is rescanned when the window regains focus, when they press Refresh, and immediately before any action whose correctness depends on current files — but the folder is never continuously polled.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] The Garden Repository is rescanned when the window regains focus
- [ ] An explicit Refresh control rescans on demand
- [ ] A rescan runs immediately before any consistency-sensitive action
- [ ] There is no continuous polling of the folder
- [ ] The Garden Revision updates when canonical content has changed
- [ ] An external edit made outside Research Garden is reflected at the next consistency boundary
- [ ] An external deletion or addition is reflected at the next consistency boundary
- [ ] A rescan that surfaces newly invalid content produces Diagnostics without disrupting unrelated work
