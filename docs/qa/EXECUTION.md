# Phase 3：測試實作與診斷紀錄

## 模組順序
1. 真HTTP與MicrophoneService邏輯：先11個後端案例，全部通過，再補極端JSON型別，重現BUG-009。
2. 原生逐字稿元件：隔離microphone腳本，驗證草稿／定稿、XSS、空態、故障恢復。
3. 麥克風／Teams元件：隔離app輪詢，驗證權限、載入、防雙提交、來源切換race。
4. 真server完整頁面：真正Headless Chrome、AudioWorklet PCM及HTTP、URL/history、reload/beacon、1920/390視口。
5. 既有Node unit、全部離線安全integration與Python測試，最後兩輪完整回歸。

## 已確認產品缺陷

見BUG_REPORT.md與docs/qa/bugs.json；包含7個產品問題和1個字面零console驗收限制。每個已知問題都有可執行的斷言及skip原因，QA_REPRODUCE_BUGS=1啟用，沒有把錯誤行為改寫成正常預期。

## 測試自身問題（已修正，不能當產品Bug）

- 包住select的label會包含option文字，exact getByLabel不穩定；改用getByRole combobox與語義名稱，不加testid、不改產品HTML。
- 過期回應案例需在隱藏Teams區域中確認option已被更新：使用語義role＋includeHidden，不用CSS path。
- reload的sendBeacon觀測改成真HTTP response finish，避免等待舊文件的Playwright response事件。
- 共用fixture的heartbeat原本把undefined token與沒有session的undefined視為相等。補上fixture current存在檢查，使其符合真正MicrophoneService拒絕行為。是測試替身缺陷，不修改產品來遷就。
- page default deadline設為5秒、Node testcase20秒；沒有固定sleep。超時關閉context避免孤兒測試瀏覽器；正常斷言失敗保留截圖、DOM、trace與console。

## 防止測試污染

- 每例隨機測試目錄與port0，真實會議、chrome-profile、models與既有meetings皆不讀寫。
- E2E只連127.0.0.1，Chrome fake microphone只生成測試訊號；ASR與Windows裝置列舉在新UI測試用隔離adapter／route替身，不能當真人辨識證明。
- 所有新E2E都由browserCase裝上pageerror及console.error guard，guard另有EventEmitter自我測試，任何錯誤不會被放過。
- 產品雜湊基準從8210051建立，完整性測試覆核；沒有補data-testid，沒有改動任何業務邏輯、樣式或套件檔。
- 既有歷史測試含CSS定位／固定等待／缺console.error監聽，保留作回歸基線但不冒稱符合本輪新嚴格QA規範。新test/qa嚴格套件另列結果與coverage。

Phase 3實作完成；已進Phase 4全套、覆蓋率與最終文件審計。最終數字以TEST_SUMMARY.md與原始run results.json為準。

## Authorized product repair follow-up

User explicitly authorized fixes to all seven product defects, enabling their tests, two complete regression runs, documentation, commit and push. Changed only three production JS files; original readonly audit hashes are retained and authorized-fixes.json records the reviewed replacements. Focused QA: 62 cases, 46 pass, 16 BUG-004 acceptance skips, zero failures. Early targeted runs exposed stale test copy and the now-disabled empty-device click; expectations were updated to the corrected UX, with strict assertions retained. No dependency changes. Full two-round regression launched using run.mjs default entrypoint.

Full two-round run completed successfully: each round 677 total, 654 pass, 23 skip, zero failures. Both rounds contain 28 executed strict UI cases with empty console/pageerror diagnostics. Results and raw logs persisted as reports/repaired-*. The 16 acceptance-limited fault cases are separately rerun to verify their failure classification after the product changes.
