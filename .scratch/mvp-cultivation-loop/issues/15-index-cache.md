# 15: Index Cache

**What to build:** A person reopening a large Garden does not wait for a full rescan every time. Research Garden persists a derived cache and verifies it against the actual files before trusting any of it. The cache can be deleted at any moment with no loss of knowledge, and it can never make a consistency check weaker than it would have been without it.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] The Index Cache is persisted under the defined operational location as derived, disposable state
- [ ] The cache records its schema version and a manifest of file metadata and content hashes
- [ ] Unchanged entries are reused and changed files are reparsed
- [ ] A schema version mismatch invalidates the entire cache
- [ ] An uncertain or unverifiable manifest invalidates the entire cache
- [ ] Deleting the cache loses no canonical knowledge and the Garden opens correctly from Markdown alone
- [ ] Cache reuse never alters the Garden Revision that would have been derived from canonical content
- [ ] Cache reuse never substitutes for a pre-write consistency check
- [ ] A write invalidates or updates the affected cache entry so a subsequent open is correct
- [ ] The cache never becomes a competing authority; canonical Markdown remains the only system of record
