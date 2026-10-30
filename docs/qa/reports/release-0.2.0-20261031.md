# Release 0.2.0 — 2026-10-31

## Changes

- Four interface locales (Traditional Chinese, English, Japanese, Korean), independent of original captions and translation targets. Protected user titles/transcripts/source notes remain unchanged.
- Responsive international toolbar, footer, settings/disclosure and meeting overflow menu; consistent 36px transcript controls and compact meeting/archive switch.
- Local SVG platform icons and exact trusted-host Meet/Teams return links. Generic desktop/microphone captures have separate identities; switching meetings clears stale hrefs.
- Chinese→English is the first/default preset. Explicit URL choices, including All originals / No translation, survive selection and reload. German/Japanese/Korean original views honor record language metadata and retain unclassified originals with a localized notice.
- Package and Claude plugin manifest versions are 0.2.0; dependency resolutions are unchanged. English README remains the repository default.

## Verification

Full unit and QA suite: `node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"` — **678 tests, 662 passed, 0 failed, 16 pre-existing BUG-004 skips**, 457.368 seconds.

Final explicit-language URL preservation follow-up: `node --test --test-concurrency=1 test/qa/language-presets.test.js test/qa/e2e.test.js test/qa/record-flow.test.js test/qa/integrity.test.js` — **45 tests, 34 passed, 0 failed, 11 existing BUG-004 skips**, 95.666 seconds.

The final URL preference fix was validated by that follow-up. Generic journey tests now explicitly request All originals / No translation instead of depending on the old default; dedicated preset tests still validate the real new default. The previous UI intentionally hides detailed activity text; tests verify the visible completed state instead of requiring that hidden activity line to appear. No new skips or dependencies were added.

Local doctor returned `DOCTOR=ok`. Unified installation `node scripts/install.js --target both --skip-audio` succeeded. Codex runtime references this checkout. Claude CLI confirms openmeeting@openmeeting-local 0.2.0 is enabled, and its installed skill points at this checkout. Browser assets app.js / emerald.css / i18n.js / locales.js matched repository bytes via localhost HTTP. Claude requires /reload-plugins or a restart to load a newly cached manifest; Codex can use a new chat. Existing workspace tabs require refresh for new client code.

## Evidence and limits

Latest synthetic captures: `docs/design/release-0.2.0/zh-TW/actual.png` and `docs/design/release-0.2.0/en/actual.png`. Design explorations and focused reports are retained with their historical dates; old similarity scores are not reapplied to this release.

No new live meeting was joined during this release run. ASR accuracy for German/Japanese/Korean is not established by interface tests. Platform spoken-language settings remain independent; unlabeled original segments deliberately remain visible. Known raw device/Agent diagnostic strings preserve their original language.

The staged-path check excludes private meetings, browser profiles, environment secrets and test temporary data. Text token-pattern scanning was clean. Recordings/models were not uploaded or re-downloaded; only synthetic screenshots and fixtures are versioned.
