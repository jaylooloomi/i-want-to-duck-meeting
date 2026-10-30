# Google 原生選帳號與自動接續：發佈驗收報告

2026-10-26：原生選帳號、身分核對與主持人放行後自動接續已完成。最新完整離線回歸 **699 例：676 通過、23 略過、0 失敗**，所有子程序退出碼 0。本次重新執行一輪；前次七項缺陷修復的兩輪報告屬歷史，不能當成此次版本的兩輪證據。

## 修正內容

- 每次 Google Meet 加入先開 Google 原生 AccountChooser，可選既有帳號或使用其他帳號登入，移除自製 localhost 選帳號表單。
- 在非會議首頁確認選擇，再綁定 authuser，於 Meet 預備頁核對實際身分後才按加入。不同、缺失、多重身分或沒有明確選擇時停止，不猜帳號索引。
- 同一工作與視窗自動接續登入、等待放行、入會、字幕及錄音；不需回覆「選好了」「已放行」。AI 回合結束後的主動通知仍取決於宿主追蹤能力，不承諾永久監控。
- 逾時、關窗與取消明確停止；不讀取密碼或登入欄位值。CLI、Codex 技能、Claude Code 範本與安裝提示同步更新，沒有新增依賴。

流程與原因見 [登入流程報告](docs/meet-login-flow.md)，逐案追蹤見 [測試矩陣](TEST_MATRIX.md)，缺陷與限制見 [BUG_REPORT](BUG_REPORT.md)。

## 最新完整回歸

| 群組 | 總數 | 通過 | 略過 | 失敗 |
|---|---:|---:|---:|---:|
| Node unit | 510 | 510 | 0 | 0 |
| 受控 integration | 81 | 76 | 5 | 0 |
| 嚴格 QA／瀏覽器 | 83 | 67 | 16 | 0 |
| Python | 25 | 23 | 2 | 0 |
| 合計 | 699 | 676 | 23 | 0 |

[實際退出碼與各組原始輸出索引](docs/qa/reports/native-release-results.json)。十四個原生帳號案例包含在 QA；十三個瀏覽器案例涵蓋選第二帳號、實際預備頁格式、錯帳號／缺失／多重身分拒絕、原生登入、無操作跳轉、逾時、關窗及取消，console/pageerror 均無錯誤。新增案例採語義定位、條件等待及嚴格錯誤攔截；既有 legacy 測試的舊定位／等待寫法不因此宣稱全部符合新標準。

### 略過與未驗收範圍

- 16 項 BUG-004：故意注入 HTTP 400/401/403/500 或網路失敗時，Chrome 會產生資源錯誤；依零 console 規則保留 skip。未放寬 guard，不能算通過。可用下方重現指令啟用，預期失敗。
- 另 7 項為裝置、音訊或模型的 opt-in 案例；離線回歸不使用私人錄音、外部會議或下載模型。另有需下載模型的 TTS 案例由 runner 明確排除，不在 699 分母內。
- 當次完整回歸一輪，不能宣稱兩輪零偶發失敗或全面無缺陷。Google 改版、全新密碼／二階段驗證及不同組織政策仍有外部驗收限制。

## 真人操作與錄音證據

使用者實際完成原生選帳號，預備頁身分相符；主持人放行後自動入會並正常結束約 **121.7 秒錄音**。錄音內容已離線核對，原生字幕與錄音轉錄均含 **1357**。Google Meet／Arthur 仍有辨識錯字，**完整測試句未通過逐字驗收**，不把測試提示內容當作會議決議。

[去識別真人結果](docs/qa/reports/native-account-live-validation.json) 與早期 [零加入唯讀檢查](docs/qa/reports/native-account-results.json) 為分開證據。WAV、私人帳號、會議網址與實際逐字稿留在本機 ignored meetings 目錄，不提交至 Git。

## 覆蓋率與架構

Node.js ES modules 單體，同一 localhost server 提供原生 HTML/CSS/JS，沒有 React/Vue、前端 Router、登入／管理員頁或 SQL DB。盤點見 [架構逆向](docs/qa/RECONNAISSANCE.md)。專案 UI 路由 `/` **1/1**、API 入口 **7/7**；自製帳號頁已移除，Google 原生頁屬外部旅程，不冒稱可控制其全部路由。

[Node V8 覆蓋率](docs/qa/reports/native-release-node-coverage.json) 各組獨立計算，不能平均成全端覆蓋率：

| 群組 | Line % | Branch % | Function % |
|---|---:|---:|---:|
| unit | 66.02 | 84.89 | 76.83 |
| integration | 65.91 | 66.13 | 62.75 |
| strict QA | 56.01 | 72.90 | 44.39 |

[瀏覽器覆蓋率](docs/qa/reports/native-release-browser-coverage.json)：app.js 73/77 非空行（94.81%）、microphone.js 134/136（98.53%）。以任一字元命中計行，非 statement/branch 指標；HTML/CSS、其他執行緒 Worklet 不在分母。[Python 覆蓋率](docs/qa/reports/native-release-python-coverage.json) 為 247/907 可執行行（27.23%），採 stdlib trace 指標，含未測 stt 腳本，沒有 branch 指標；實體 Windows 音訊依賴仍未由離線套件驗收。

## 一鍵與分層命令

需 Windows、Node >=22、已安裝 Chrome、專案依賴及既有 .venv-stt。測試不安裝套件或要求登入。

```powershell
# 預設兩輪完整離線回歸；本次執行 --once
node test/qa/run.mjs --once
node test/qa/run.mjs
# 分層
node --test test/unit/**/*.test.js
node --test --test-concurrency=1 test/integration/**/*.test.js
node --test --test-concurrency=1 test/qa/*.test.js
.venv-stt/Scripts/python.exe test/qa/python-coverage.py --out test/.tmp/qa/python-coverage.json
# BUG-004 嚴格驗收限制重現（預期失敗）
$env:QA_REPRODUCE_BUGS='1'
node --test --test-concurrency=1 test/qa/frontend.test.js test/qa/e2e.test.js
Remove-Item Env:QA_REPRODUCE_BUGS
```

runner 自動啟閉受控服務及 headless Chrome，保存各程序退出碼、覆蓋率與失敗 trace／DOM／截圖／console；任一非預期失敗退出 1，最新索引為 test/.tmp/qa/latest.json。個別 integration 指令可能包含 opt-in 案例；發佈離線驗收以 runner 的明確範圍為準。

歷史七項修復的兩輪結果保留在 docs/qa/reports/repaired-*；登入中間版本 login-*、account-binding-* 與 native-account-* 報告亦保留，不與最新 native-release-* 合併計數。


## 2026-10-30 workspace reference acceptance

The frozen 1586×992 comparison reached **90.1619245994**, every region ≥80, with zero console/page errors in the accepted capture. See [method/evidence](docs/design/visual-audit/README.md) and [current functional report](docs/qa/reports/visual-reference-20261030.md). This follow-up does not relabel historical reports or count existing skipped cases as passes. The actual browser suite and Python metric checks can be replayed using the commands in the method document.

Final follow-up: both frozen-source full runs completed with **629 cases / 613 passed / 0 failed / 16 existing skips** each; 5/5 metric tests passed. The two canonical screenshots have identical PNG hashes. Current details remain in `docs/qa/reports/visual-reference-20261030.md`.


## 2026-10-30 Emerald selected-style release

Current selected design: [Emerald report](docs/qa/reports/emerald-20261030.md). Two final full runs: **635 cases / 619 passed / 0 failed / 16 existing BUG-004 skips** each. Final expanded control replay: 4/4 passed. New completion overlay, storage measurements, paragraph/source menus and responsive UI are included; no real meeting was joined. Previous 90.16% is an archived result for another reference image, not this new style.


## 2026-10-30 light/dark appearance

Current full suite: **643 tests / 627 passed / 0 failed / 16 existing BUG-004 skips**. Both palettes and all three workspace widths are replayed; five theme-specific checks include persistence, synchronization, denied storage, measured contrast and uninterrupted WAV playback. See `docs/qa/reports/themes-20261030.md`.


## Interface localization follow-up — 2026-10-30

Traditional Chinese / English / Japanese / Korean UI switching is available from the sidebar footer. Latest successful unit + QA regression: **661 tests, 645 passed, 16 pre-existing BUG-004 skips, 0 failed**. Final localization/integrity replay: **16 passed, 0 skipped, 0 failed**. These results cover the four interface locales and preserved source content; they do not establish Japanese/Korean ASR accuracy. Commands, evidence, limitations and synthetic screenshots are documented in [the localization report](docs/qa/reports/i18n-20261030.md). Earlier sections above retain their historical scopes and counts.


## International layout follow-up — 2026-10-30

Responsive English/Korean layout fixes were checked with **28 relevant browser/integrity tests: 28 passed, 0 failed, 0 skipped**. This includes 12 new geometry cases across 1440/1280/390 widths and both themes. This focused CSS follow-up does not replace or repeat the earlier full-suite count above. Evidence: [layout report](docs/qa/reports/i18n-layout-20261030.md).


## Consolidated release 0.2.0 — 2026-10-31

Latest release unit/QA regression: **678 tests, 662 passed, 0 failed, 16 existing BUG-004 skips**. Final URL preference/navigation follow-up: **45 tests, 34 passed, 0 failed, 11 existing skips**. Local Codex integration was synchronized, Claude plugin 0.2.0 is enabled, and doctor returned `DOCTOR=ok`. No dependency resolutions changed. Full scope, test commands and limitations: [release report](docs/qa/reports/release-0.2.0-20261031.md). Earlier sections above are historical snapshots.


## Local email draft delivery — 2026-10-31

Unit + QA regression: **692 tests, 676 passed, 0 failed, 16 pre-existing BUG-004 skips**, 488.8 seconds (`test-mail-full-verified.log`). Final focused replay against the completed mail code: **17 passed, 0 failed, 0 skipped**, 31.4 seconds (`test-mail-final.log`). The focused replay includes the late mail deep-link/CSS follow-up. No new product-bug skips or browser-console exclusions were introduced. The earlier development run is not counted as successful.

`node bin/openmeeting.js doctor` returned `DOCTOR=ok`. Codex and Claude Code local skills were reinstalled and verified for the direct draft fields and stale-source handling. Four synthetic real-app screenshots cover desktop/mobile, both themes and English. A fictional local Teams draft with empty recipients was seeded using the CLI; no real mailbox action occurred. Usage and boundaries: [mail draft report](docs/qa/reports/mail-drafts-20261031.md). The App does not perform mailbox creation, delivery, attachments or provider-status tracking.


## Consolidated mail release verification — 2026-10-31

Two unit + QA runs passed: 692 tests / 676 passed / 0 failed / 16 existing BUG-004 skips, in 488.8 s and 556.9 s (`test-mail-full-verified.log`, `test-mail-release.log`). The latter includes the final default-generation skill instructions. Mail/integrity replay: 17 passed; default-generation unit/integrity follow-up: 7 passed. No new skips.

Additional integration run: 81 tests, 72 passed, 4 failed, 5 existing environment/opt-in skips. All four failures were `spawnSync powershell.exe ENOENT` caused by the invocation PATH, not changed product logic. With Windows PowerShell on PATH, the entire Chrome-launch file passed 7/7 and the TTS/STT file passed 1/1 (`test-mail-release-chrome.log`, `test-mail-release-stt.log`). All failed cases therefore passed targeted replay; the full integration suite was not rerun afterward. Use the normal Windows shell PATH (including WindowsPowerShell/v1.0) when running it.

Included earlier UI changes: vertically centered notes tabs, plain utterance overflow button, and wider highlighted utterance background. Design evidence uses synthetic content. Private meeting folders, recordings, local mail drafts, browser profiles and model files are excluded from this commit. No real mailbox creation or sending was tested.


## Mail layout release follow-up — 2026-10-31

Final browser/API/integrity replay: **13 passed, 0 failed, 0 skipped**, 37.9 s (`test-mail-layout-release.log`). Covers centered action labels, stable tab/header geometry, shared mail copy, and 80-line mail expansion without inner scrollbars across desktop/mobile and both themes. This focused layout validation supplements the prior 692-case regression; it is not a new full-suite run. README and synthetic screenshots updated.
