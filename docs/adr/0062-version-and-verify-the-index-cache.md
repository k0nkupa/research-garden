# Version and verify the Index Cache

The Index Cache will record its schema version and a manifest of file metadata and content hashes. Unchanged entries may be reused and changed files reparsed, but a schema mismatch or uncertain manifest invalidates the entire cache. Cache reuse must never weaken the Garden Revision or pre-write consistency checks.
