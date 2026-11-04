# Highlight toolbar height — 2026-11-03

The toolbar now uses a single non-wrapping row with a fixed 54px desktop height and 64px mobile height (44px mobile controls). Overflow stays inside the toolbar with horizontal scrolling instead of increasing row height. Text and controls remain available, including long feedback messages.

Verification: four browser cases passed, each switching zh-TW/en/ja/ko, covering 390/1280px and light/dark; checkbox interaction and document overflow checked. Shared console/page error guard enabled. Integrity: 3/3 passed. Log: test/.tmp/highlight-toolbar.log. Frontend CSS/index deployed to installed local site; HTTP 200 verified.

Scope: toolbar height only. Its absolute page position may still change on mobile when other translated header content above it wraps; that is separate from this row height fix. No installer/release or Git push performed.
