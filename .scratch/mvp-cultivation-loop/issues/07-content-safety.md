# 07: Content safety — sanitization, remote media, Attachments, link isolation

**What to build:** A person can open a Garden containing hostile Markdown without the application being compromised, and without opening a note silently announcing their activity to a third party. Their own supporting files still render. A file's presence in a folder they selected does not make its active content trustworthy.

**Blocked by:** 03

**Status:** resolved

- [x] Raw HTML in canonical Markdown is disabled and the rendered result is sanitized
- [x] Remote image and embed URLs remain visible as links and are never fetched automatically
- [x] Attachments referenced by validated relative links within the selected Garden Repository render
- [x] A relative reference that escapes the Garden Repository is refused
- [x] External links open with isolation from the application context
- [x] Script, event-handler, and styling injection attempts in canonical Markdown are neutralized rather than rendered
- [x] Hostile content in an item title or frontmatter value is treated with the same distrust as body content

## Notes

Verified: `pnpm typecheck` clean, `pnpm test` 849 passing across 25 files, `pnpm build`
succeeds.

The load-bearing verification is a real-browser run with CDP network interception, because
"never fetched" is a claim about requests and no unit test can settle it. Against a Garden
containing a remote tracker image, a raw `<img onerror>`, a real Attachment, an Attachment
with an accented filename, a PDF link, an escaping image path, and an escaping link:

- both images rendered from `blob:` URLs read out of the folder
- the PDF opened as a `blob:` download named `paper.pdf`
- the tracker became a link, never an image
- both escaping references were refused and shown as text
- no relative `href` survived anywhere, so nothing could navigate the Garden away
- no `on*` attribute existed and the injected `window.__owned` stayed false
- **zero external network requests were made**

### Bugs the review caught

- **Escaping was enforced for images but not for links.** `[escape](../../../etc/passwd)`
  rendered a live anchor, and `[paper](attachments/paper.pdf)` a relative one, which would
  navigate the application away and take the folder permission with it. Links now go
  through the same classification, and a valid Attachment link is opened from bytes.
- **Percent-encoded filenames never resolved.** markdown-it encodes link destinations, so
  every Attachment whose name contained a space or any non-ASCII character was silently
  unrenderable. Segments are now decoded -- after the traversal check, so `%2e%2e` cannot
  sneak through as `..`.
- **A query string survived into the path**, so `attachments/x.png?v=2` looked like a file
  named `x.png?v=2`.
- **`FORBID_TAGS` omitted every media tag but the ones already listed.** markdown-it
  escapes them today, but the module claimed a second layer that holds when the first one
  does not, and for remote media that claim was false. `video`, `audio`, `source`,
  `track`, `picture` are refused now, along with the `srcset`, `ping`, `loading`, and
  `poster` attributes.
- **A dead cast** on the sanitizer's return suppressed the one check that mattered:
  dropping `RETURN_DOM_FRAGMENT` would have failed in production rather than at compile
  time.
- **The DOMPurify hook mutated the shared singleton** at import time, which also threw
  under the node test environment. It is now registered on an instance of our own, created
  on first use.

### A test that could not have caught its own bug

`readBytes` exists so Attachments are not corrupted by being read as text -- but both fake
adapters stored only strings, so the contract could never have detected corruption. Both
now hold real bytes, and the contract round-trips all 256 byte values through each adapter.

### Scope note

`.item-panel__body img` is bounded to the panel width so an Attachment cannot break the
layout. Everything else about how an image looks is ticket 10.
