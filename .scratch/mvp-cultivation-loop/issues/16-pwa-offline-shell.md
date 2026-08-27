# 16: PWA offline application shell

**What to build:** A person who has loaded the application once can keep working on a permitted local folder without a network connection. The offline capability covers the application itself and nothing else — their Garden files and any tool results are never cached, so the offline shell cannot quietly become a second copy of their knowledge.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A service worker caches only versioned application assets
- [ ] Garden files are never service-worker cached
- [ ] Tool results are never service-worker cached
- [ ] After an initial load, the human interface operates on a permitted local folder with no network connection
- [ ] A new application version supersedes the cached shell rather than being shadowed by it
- [ ] The web app manifest satisfies installability in the target browsers (ticket 01 shipped an SVG-only icon set; raster or maskable icons may be required)
- [ ] Agent workflows are correctly reported as requiring their host connection when offline
