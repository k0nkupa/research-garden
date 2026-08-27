# 11: Search over the Garden Index

**What to build:** A person can find material in their Garden without traversing the Tree. Search returns useful matches with enough surrounding text to recognize what was found, and returns a bounded number of them so one query never floods the interface.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Search runs over the in-memory Garden Index and returns matching items with snippets
- [ ] Results identify each match by kind, title, and stable item ID
- [ ] Search returns ten results by default
- [ ] Search returns at most twenty-five results regardless of what is requested
- [ ] Dormant Branches and the items beneath them remain searchable
- [ ] Items carrying Diagnostics remain findable
- [ ] Search is reachable from the workspace and its results select into the Tree
