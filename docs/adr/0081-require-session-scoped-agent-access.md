# Require session-scoped Agent Access

Opening a Garden starts in human-only mode. A visible Connect ChatGPT action enables Agent Access and dynamically registers filesystem-backed Garden tools for the current browser session. The connection is not silently restored after reload, even when the Garden directory handle is remembered.
