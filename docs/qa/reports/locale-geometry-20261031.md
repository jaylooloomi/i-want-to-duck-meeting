# Shared locale layout — 2026-10-31

The Traditional Chinese sidebar widths and main pane proportions now apply to all four interface locales. Removed language-specific sidebar widths, grid ratios, toolbar arrangements and a Japanese navigation ratio. Long-label support uses shared search/language rows, two-line source-file metadata, stable notes-header rows and bounded navigation labels. Sidebar preference/footer rows have consistent heights. No translation, recording or meeting data logic changed.

The archived label is wrapped in a span so text can shrink inside its existing button without pushing the container. Full accessible names remain localized; truncated long labels do not widen the sidebar.

## Validation

```powershell
node --test --test-concurrency=1 test/qa/locale-geometry.test.js test/qa/i18n-layout.test.js test/qa/i18n.test.js test/qa/mail-draft.test.js test/qa/integrity.test.js
```

The new geometry suite switches all four locales in the same browser page and compares sizes against its initial Chinese state. Eight viewport/theme cases cover 390, 900, 1280 and 1920 widths in both themes. Existing locale and mail tests exercise settings, navigation, source privacy, recording/playback continuity, copy/save/download and no nested mail scrolling. Shared console/pageerror guards remain enabled.

The tab-position check uses document coordinates: browser auto-scroll while bringing an off-screen button into view must not be mistaken for a layout shift. No product-bug skips or error exclusions were added. Screenshots use synthetic meeting content. This is focused layout validation, not live-platform or ASR acceptance.


Final locale/layout/mail/integrity regression: **46 passed, 0 failed, 0 skipped**, 172.3 s (`test-locale-unified-verified.log`). Includes 8 same-page cross-locale geometry cases across four widths and both themes.


## Storage footer follow-up

Storage uses fixed icon and text tracks (14px title, 14px capacity, 5px meter) rather than text-dependent vertical alignment. Same-page language switching now compares exact document rectangles for the icon, heading, capacity and meter as well as the outer layout. Geometry/integrity replay: 11 passed, zero failed/skipped, 35.4 s (`test-storage-locale.log`). Mobile keeps the existing hidden storage row.


## Footer picker alignment

The global select margin shifted the language picker 6px right; a global max-width also shortened its right edge on wide screens. Scoped margin/width/text-alignment overrides now match the footer grid. Same-page locale tests assert both horizontal edges and left-aligned selected text at all four widths. Geometry/integrity: 11 passed, zero failed/skipped, 35.1 s (`test-footer-left-aligned-final.log`). Local Windows installation CSS synchronized.
