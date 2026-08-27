# Rebuild the Garden Index from Markdown

Opening a Garden Repository will scan its canonical Markdown into an in-memory Garden Index. Research Garden may persist a derived `.research-garden/index.json` cache for faster subsequent opens, but the cache must be disposable and verifiable against canonical file content. IndexedDB and SQLite will not become competing authorities.
