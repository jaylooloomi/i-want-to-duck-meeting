# Sidebar platform icons — 2026-10-30

Google Meet and Microsoft Teams use local accessible SVG icons in sidebar cards. Microphone, generic desktop audio and unknown sources have separate symbols. Exact HTTPS platform hosts are recognized from saved meeting URLs; legacy Meet source/code metadata is supported. The public list exposes only a platform identifier, never the meeting URL.

Validation: `node --test --test-concurrency=1 test/unit/workspace-data.test.js test/qa/sidebar.test.js test/qa/backend.test.js test/qa/integrity.test.js`

Result: 25 passed, 0 failed, 0 skipped. Includes desktop/mobile and light/dark browser checks with strict console/page-error guards, public API privacy, invalid/spoofed hosts and legacy metadata. Screenshots inspected from `test/.tmp/qa/manual/SIDEBAR-02_platform_icons_retain_identities_in_light_and_dark_1280/light.png`.

The initial browser check clicked the card center, where hover export controls can appear. The final interaction clicks the visible platform icon inside the selection button, matching the intended platform affordance without force clicks. No production selection behavior was changed.

The standalone local viewer was restarted only after confirming zero active meeting sessions. This change does not exercise real meeting admission, ASR or recording quality.
