# 07: Content safety — sanitization, remote media, Attachments, link isolation

**What to build:** A person can open a Garden containing hostile Markdown without the application being compromised, and without opening a note silently announcing their activity to a third party. Their own supporting files still render. A file's presence in a folder they selected does not make its active content trustworthy.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Raw HTML in canonical Markdown is disabled and the rendered result is sanitized
- [ ] Remote image and embed URLs remain visible as links and are never fetched automatically
- [ ] Attachments referenced by validated relative links within the selected Garden Repository render
- [ ] A relative reference that escapes the Garden Repository is refused
- [ ] External links open with isolation from the application context
- [ ] Script, event-handler, and styling injection attempts in canonical Markdown are neutralized rather than rendered
- [ ] Hostile content in an item title or frontmatter value is treated with the same distrust as body content
