# 15: Index Cache

**What to build:** A person reopening a large Garden does not wait for a full rescan every time. Research Garden persists a derived cache and verifies it against the actual files before trusting any of it. The cache can be deleted at any moment with no loss of knowledge, and it can never make a consistency check weaker than it would have been without it.

**Blocked by:** 12

**Status:** resolved

- [x] The Index Cache is persisted under the defined operational location as derived, disposable state
- [x] The cache records its schema version and a manifest of file metadata and content hashes
- [x] Unchanged entries are reused and changed files are reparsed
- [x] A schema version mismatch invalidates the entire cache
- [x] An uncertain or unverifiable manifest invalidates the entire cache
- [x] Deleting the cache loses no canonical knowledge and the Garden opens correctly from Markdown alone
- [x] Cache reuse never alters the Garden Revision that would have been derived from canonical content
- [x] Cache reuse never substitutes for a pre-write consistency check
- [x] A write invalidates or updates the affected cache entry so a subsequent open is correct
- [x] The cache never becomes a competing authority; canonical Markdown remains the only system of record

## Notes

### What was built

`.research-garden/index.json` (the location ADR 0050 already names), one
record for the whole Garden rather than one file per entry. `openGarden`
reads it before scanning and writes a fresh one after -- both best-effort,
so the cache can never be the reason a Garden fails to open.

Each entry is addressed by content hash, checked after a free `length`
comparison rather than a filesystem timestamp (ADR 0077 already treats
those as a presentation input, not canonical history). `buildGardenIndex`
split into an internal `scanGardenIndex` and two thin wrappers: the existing
`buildGardenIndex(files)` stays byte-identical for its ~14 existing callers
across the codebase, and a new `scanGardenWithCache(files, cache)` also
returns the fresh cache to persist. The one thing deliberately never cached
is a duplicate-id correction or a whole-Garden graph-invariant correction
(dangling relation, parent cycle) -- both depend on every *other* file, are
never stable per-file facts, and caching either would let a stale
correction survive long after the file that caused it changed or vanished.
Every file's own *standalone* outcome is what gets cached; the corrections
are always recomputed fresh, on every scan, over the current full item set.

### Verified

Typecheck, 1229 tests (up from 1204 before this ticket), and a production
build all pass; the full suite was run three times with no flake. 45 of
those tests are new, across four files: `indexCache.test.ts` (pure
shape-validation and round-tripping, including the all-or-nothing property
that one malformed entry invalidates the whole cache, not just itself),
`gardenIndexCaching.test.ts` (that a cache hit is actually served rather
than reparsed, that a hash or length mismatch forces a reparse, and --
mutation-tested against the bug directly -- that a duplicate-id loser and a
Branch with a dangling parent are cached under their own standalone
outcome, not the correction blaming them), `indexCacheStore.test.ts`
(read/write through the filesystem port, and that a write failure is
swallowed), and `openGardenIndexCache.test.ts` (the same properties
end-to-end through the real `openGarden`, plus that an edit through
`editItem` is reflected -- not shadowed by stale cached content -- on the
next open).

Verified in a real browser (headless Chrome over CDP) against the real
`FileSystemAccessGardenFileSystem` adapter, not only the in-memory one:
opening the Sample Garden twice in a row succeeds both times, with
identical item counts, an identical Garden Revision, and eight cache
entries persisted after the second open; no console errors or exceptions.

### What the review caught, and what changed

Both review axes (Standards and Spec, both Opus) independently found the
same real defect, and the Spec reviewer reproduced it directly: the shape
guard for a cached item checked that `relations` and `supportedBy` were
*arrays*, but never validated their *elements*. A cached item with
`relations: [null]` passed validation, was served on a warm open, and
crashed when `buildGardenGraph`'s `for (const relation of item.relations)`
dereferenced `.type` on it -- turning `openGarden` into `kind: 'failed'`,
with no recovery short of deleting the cache file outside the app. That is
a direct violation of two criteria at once: an uncertain manifest is
supposed to invalidate the whole cache, and the cache is never supposed to
become the reason a Garden won't open. Fixed by validating each relation
element (`type`/`target`, both non-empty strings) and each `supportedBy`
element (a string), added a docstring note connecting the check to exactly
what `gardenGraph.ts` iterates. Confirmed by reproducing the exact crash as
a failing test first, then watching it pass after the fix, then reverting
the fix to confirm the test fails again the same way.

Also fixed: a comment claiming hashing was skipped "when there is no cache
entry to check against" was false -- the code hashed every file
unconditionally regardless, needed for the fresh cache entry either way.
Rewritten to say what the code actually does. An exported `cacheEntryMatches`
helper was imported and never called (the loop hand-rolled the same
comparison inline); now the loop actually calls it. `buildGardenIndex`
had gained an unused, never-passed second parameter purely so the
internal implementation could share one signature; removed, since nothing
in or out of this codebase ever passed it -- `scanGardenWithCache` alone
carries the cache parameter now, and it has no default, since its one real
caller (`openGarden`) always has an actual cache to offer. `createGarden`'s
own tests broke because the read-back `openGarden` call at the end of
Create Garden now also writes a cache file into the same in-memory
filesystem the tests were blanket-scanning for "every file is canonical
Sample Garden Markdown" -- fixed by scoping those assertions to exclude the
operational directory, the same distinction `openGarden` itself already
draws when scanning.

### On performance, honestly

A warm reopen still reads every file's full text and now hashes every one
of them (`crypto.subtle.digest`) on every open, cache hit or not -- the
Index Cache never reduces file I/O, since verifying a hash requires the
same read a reparse would need anyway. What it actually saves is
`parseGardenDocument` and `validateGardenItem` for files whose hash still
matches: real, but a narrower win than "skip the file" would be. Whether
that saved work is *measurable* at scale is ticket 24's to establish with
the performance fixture, not asserted here as more than it is.
