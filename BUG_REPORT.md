# 缺陷與驗收限制報告

初始 QA 稽核時產品唯讀；其後使用者明確授權修復七項產品問題。本報告保留修復前的真 HTTP／Headless Chrome 證據。未確認的RWD疑慮（暫稱BUG-007）已在390/1920實測排除，不列缺陷。

7個產品問題：P1×1、P2×5、P3×1。另有1個故障注入下的零console驗收限制，與未捕獲Runtime Error分開。七項產品問題的測試已取消 skip 並啟用。只有 BUG-004 的 16 個故障注入案例仍因嚴格零 console 驗收限制保留 skip；QA_REPRODUCE_BUGS=1 會啟用它們，預期因瀏覽器資源錯誤而非零退出。跳過不等於通過。

## 執行與證據

- 首輪探索含測試定位／等待問題，已修正測試：label包含option文字改用語義role；延遲請求先註冊事件；reload的beacon改由真HTTP finish事件核對。這些不是產品缺陷，也沒有修改產品。
- Chrome trace.zip、DOM與原始console在test/.tmp/qa下；下方精選截圖與錯誤已複製到docs/qa/evidence持久保存，全部是合成QA文字，無私人會議資料。
- 完整重現：PowerShell先設定 `$env:QA_REPRODUCE_BUGS='1'`、`$env:QA_OUTPUT='test/.tmp/qa/reproduce'`，再執行 `node --test --test-concurrency=1 test/qa/backend.test.js test/qa/frontend.test.js test/qa/e2e.test.js`。已知缺陷存在時退出碼1是預期的規格失敗，不能稱全綠。

## BUG-001 — 無會議狀態仍顯示已刪除逐字稿與舊計數

**修復狀態：已修復，對應案例已通過針對性驗證。** 空清單分支清除逐字稿、計數、Meet href 與同步時間，並重設內容簽章，讓同一份內容重新出現時可再次渲染。FE-03、E2E-03 已啟用。

- 嚴重度：P1；案例：FE-03、E2E-03。
- 修復前原始碼定位（歷史證據）：`src/live/app.js:40-43`。
- 重現：載入包含一段逐字稿的會議；刪除測試會議目錄或令/api/meetings回傳[]；等待UI顯示「尚無會議」。
- 預期：清空舊逐字稿／計數／進入Meet連結，顯示空態。
- 實際：標頭已是尚無會議，但仍顯示DELETED_PRIVATE_TEXT與1段發言。空清單分支提早return，沒有清除既有畫面。
- Console／Page Error：[]；無Runtime Error。這是資料／隱私呈現缺陷。
- [失敗截圖](docs/qa/evidence/BUG-001/failure.png)、[assertion](docs/qa/evidence/BUG-001/failure.txt)、[console完整內容](docs/qa/evidence/BUG-001/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/E2E-03_deleting_the_last_meeting_removes_private_content_from_the_viewer/trace.zip`。

## BUG-002 — 無效深層連結默默改顯示另一場會議，URL仍指向不存在ID

**修復狀態：已修復，對應案例已通過針對性驗證。** 不存在的 id 回退 latest 時同步網址，保留其餘 query 參數。E2E-05 已啟用。

- 嚴重度：P2；案例：E2E-05。
- 修復前原始碼定位（歷史證據）：`src/live/app.js:35-37`。
- 重現：先建立qa-first；開啟/?id=missing。
- 預期：顯示找不到會議，或明確fallback並同步URL為latest。
- 實際：UI顯示UNRELATED_LATEST，URL仍?id=missing；分享／重新整理時目標與畫面不一致。
- Console／Page Error：[]；無Runtime Error。
- [失敗截圖](docs/qa/evidence/BUG-002/failure.png)、[assertion](docs/qa/evidence/BUG-002/failure.txt)、[console完整內容](docs/qa/evidence/BUG-002/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/E2E-05_unknown_deep_link_cannot_silently_display_latest_under_a_stale_URL/trace.zip`。

## BUG-003 — 開始Teams收音會移除source=teams，重新整理回到麥克風模式

**修復狀態：已修復，對應案例已通過針對性驗證。** 使用 URL.searchParams 更新 id，不覆蓋 source=teams 或其他 query。E2E-17 已啟用。

- 嚴重度：P2；案例：E2E-17。
- 修復前原始碼定位（歷史證據）：`src/live/app.js:5-7；src/live/microphone.js:120`。
- 重現：開啟/?source=teams；選擇裝置並開始；結束；重新整理。
- 預期：模式保持Teams，且會議ID與來源query並存。
- 實際：microphone-started以?id=...取代所有query；reload後來源值為microphone而非teams。
- Console／Page Error：[]；無Runtime Error。
- [失敗截圖](docs/qa/evidence/BUG-003/failure.png)、[assertion](docs/qa/evidence/BUG-003/failure.txt)、[console完整內容](docs/qa/evidence/BUG-003/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/E2E-17_Teams_mode_query_survives_start_stop_and_reload/trace.zip`。

## BUG-004 — 故障注入與字面零console規則衝突

- 嚴重度：驗收限制／非已證實Runtime缺陷；案例：FE-04、E2E-04、E2E-10、E2E-16。
- 修復前原始碼定位（歷史證據）：`src/live/app.js:29,67；src/live/microphone.js:7-9,15,49-50`。
- 重現：Playwright route對API回傳400/401/403/500，或abort timedout；同時監聽所有console.error與pageerror。
- 預期：依本次字面規則：即使UI有錯誤提示，也不得存在任何console.error。
- 實際：UI確實顯示錯誤且恢復案例會恢復；Chromium自己輸出Failed to load resource，strict guard按要求判Failed。沒有發現未捕獲JS Runtime Error或framework error，不能把這些資源錯誤謊稱產品崩潰。
- Console／Page Error：Failed to load resource: the server responded with a status of 500 (Internal Server Error)；斷線為net::ERR_TIMED_OUT。
- [失敗截圖](docs/qa/evidence/BUG-004/failure.png)、[assertion](docs/qa/evidence/BUG-004/failure.txt)、[console完整內容](docs/qa/evidence/BUG-004/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/E2E-04_poll_HTTP_500_visible_error_and_strict_console/trace.zip`。

## BUG-005 — 沒有任何Teams裝置仍宣稱雙路收音已就緒

**修復狀態：已修復，對應案例已通過針對性驗證。** 缺少任一必要裝置時顯示明確提示，禁止開始；錯誤或格式不符的裝置回應也不會被當成就緒。FE-06、E2E-14 已啟用。

- 嚴重度：P2；案例：FE-06。
- 修復前原始碼定位（歷史證據）：`src/live/microphone.js:17-22`。
- 重現：裝置API回傳inputs=[]、outputs=[]、defaultInput/defaultOutput=null；開啟Teams來源。
- 預期：明確顯示沒有可用裝置，不宣稱可以開始雙路收音。
- 實際：兩個select都空，但訊息仍為Windows雙路收音已就緒。點開始後另外擋下，未送出start；錯誤在就緒提示不是後端裝置驗證。
- Console／Page Error：[]；無Runtime Error。
- [失敗截圖](docs/qa/evidence/BUG-005/failure.png)、[assertion](docs/qa/evidence/BUG-005/failure.txt)、[console完整內容](docs/qa/evidence/BUG-005/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/FE-06_empty_Teams_devices_do_not_claim_capture_readiness/trace.zip`。

## BUG-006 — Teams裝置請求的過期回應覆寫麥克風模式提示

**修復狀態：已修復，對應案例已通過針對性驗證。** 裝置查詢綁定遞增 generation 與來源模式，忽略過期成功／失敗回應，切回麥克風恢復對應提示。FE-08 已啟用。

- 嚴重度：P2；案例：FE-08。
- 修復前原始碼定位（歷史證據）：`src/live/microphone.js:11-22,110-114`。
- 重現：進入麥克風模式；切Teams並延遲裝置回應；切回microphone；放行舊Teams回應。
- 預期：過期回應不得覆寫新來源狀態。
- 實際：來源已為microphone，仍顯示Windows雙路收音已就緒；devices await後沒有檢查請求世代或當前mode。
- Console／Page Error：[]；無Runtime Error。
- [失敗截圖](docs/qa/evidence/BUG-006/failure.png)、[assertion](docs/qa/evidence/BUG-006/failure.txt)、[console完整內容](docs/qa/evidence/BUG-006/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/FE-08_outdated_Teams_response_cannot_overwrite_current_microphone_feedback/trace.zip`。

## BUG-008 — Teams必要裝置載入期間開始按鈕仍可點擊

**修復狀態：已修復，對應案例已通過針對性驗證。** Teams 裝置讀取中禁用開始；完成後僅在必要裝置齊全且未啟動／錄製／停止中才允許開始。E2E-15 已啟用。

- 嚴重度：P3；案例：E2E-15。
- 修復前原始碼定位（歷史證據）：`src/live/microphone.js:11-15,110-114；src/live/index.html:16`。
- 重現：延遲/api/audio-devices回應；開啟/?source=teams；在裝置仍載入時觀察開始按鈕。
- 預期：載入必要裝置期間開始按鈕disabled，待裝置有效才啟用。
- 實際：有正在讀取提示，但開始按鈕enabled；點擊只會得到尚未選擇裝置錯誤。不是重複提交或後端安全漏洞。
- Console／Page Error：[]；無Runtime Error。
- [失敗截圖](docs/qa/evidence/BUG-008/failure.png)、[assertion](docs/qa/evidence/BUG-008/failure.txt)、[console完整內容](docs/qa/evidence/BUG-008/console.json)。
- 原始trace：`D:/git/openmeeting/test/.tmp/qa/confirmed-bugs/E2E-15_pending_Teams_device_request_blocks_unsafe_start_and_shows_loading/trace.zip`。

## 修復與驗收建議（未實作）

先處理BUG-001的舊資料殘留，再處理query真實性／模式保留及裝置請求世代管理。BUG-004需釐清是否只禁止未捕獲JS／framework錯誤，允許故障注入必然產生的Chromium資源錯誤；本輪沒有自行放寬guard，沒有建議把HTTP錯誤偽裝成200來湊零console。

未驗證外部Meet/Teams真人、新帳號／MFA、跨組織與多小時語音品質；這些是測試範圍限制，不列為通過，也不擅自標成程式Bug。

## BUG-009 — start API接受非物件JSON並建立預設工作

**修復狀態：已修復，對應案例已通過針對性驗證。** start body 必須為非 null、非陣列 JSON 物件；不合法時回傳 400，且不得呼叫 capture service。保留 mode/input/output 白名單。BE-07 四個型別案例已啟用。

- 嚴重度P2；案例BE-07。原始碼：src/live-server.js:64-69（JSON.parse後直接destructure，未檢查plain object）。
- 同源POST `/api/microphone/start`，application/json，分別送 `[]`、`"text"`、`123`、`true`。
- 預期400且不呼叫start；實際4個隔離案例均200並呼叫預設收音。這不是跨Origin繞過；現有Origin防護仍通過。
- 這是後端契約缺陷，無前端截圖或Console；[完整assertion](docs/qa/evidence/BUG-009/failure.txt)，各body的JSON回應在同目錄invalid-start-*.json。
- 測試使用隔離service，沒有實際啟動麥克風／ASR或存取私人錄音。產品保持未修改，規格測試skip標記BUG-009，重現模式會失敗。

## 最終重現核對

修正測試自身定位／替身後，最終重現59個案例：32通過、27個預期規格失敗、0取消、0 skip。27個失敗均對應上述已知問題，沒有新增未知失敗；原始輸出見docs/qa/reports/confirmed-bugs.txt。最新精選截圖與console已更新為同一次confirmed-bugs執行。

## 本次修復與驗收界線

只修改 src/live-server.js、src/live/app.js、src/live/microphone.js，未加依賴或 data-testid。原始唯讀基準保留於 docs/qa/production-baseline.json；本次授權變更的三個檔案雜湊另列 docs/qa/authorized-fixes.json，完整性測試仍檢查其餘檔案不變。

BUG-004 保持開放為驗收限制：Chromium 在 HTTP 400/401/403/500 或連線中斷時產生 Failed to load resource console.error。不能藉由忽略 console、把 API 一律改成 200、或冒稱未捕獲 JS 崩潰來消除此限制。既有故障恢復斷言仍可重跑；本次未將這 16 個案例計為通過。離線回歸不證明真人雙端聲音、模型辨識正確率、WASAPI 實體裝置或外部平台相容性。

### 修復後定位

- BUG-001：`src/live/app.js:46`。
- BUG-002：`src/live/app.js:41`。
- BUG-003：`src/live/app.js:5`。
- BUG-005：`src/live/microphone.js:30`。
- BUG-006：`src/live/microphone.js:15`。
- BUG-008：`src/live/microphone.js:8`。
- BUG-009：`src/live-server.js:64`。

## 修復後故障注入複核

另外啟用 16 個 BUG-004 案例實跑，16 個均在功能斷言完成後由嚴格 console guard 判定失敗（退出 1）；所有錯誤都是 Chromium `Failed to load resource`，沒有 pageerror 或其他錯誤種類。這是預期限制重現，不與兩輪正常回歸的成功混算。[當次分類與完整診斷](docs/qa/reports/repaired-fault-confirmation.json)、[原始 log](docs/qa/reports/repaired-fault-confirmation.txt)。

## BUG-010 — 多帳號登入後 Meet 仍使用原預設帳號

- 嚴重度：P1；後續真人操作確認的身分錯用問題，與原七項產品修復分開。
- 原因：Google 登入完成／Chrome account_info 只表示設定檔有帳號；加入第二個帳號後直接開 Meet 並不保證使用該帳號。
- 狀態：程式已補上入會前選擇、authuser 綁定及可見 Google Account 控制項核對；真實 Google 頁面相容性待驗證。
- 預期：即使已有登入，也必須先明確選帳號；實際身分不符、缺失、多重時都不點加入。
- 修正定位：src/meet/account.js、src/session.js 的 selecting_account/beforeJoin，src/meet/join.js 的入會前 gate。
- 證據：ACCOUNT-01、ACCOUNT-02 與 ACCOUNT-03 三種參數案例直接核對 Meet 加入按鈕點擊數；錯誤／缺失／多重皆 0，選定 B 且身分相符才 1。
- 限制：只採實際 Meet 可見帳號控制項為證據；若平台 UI 改版不能核對，會停止而非繞過。不能把受控頁面測試當作真人 Google 登入已通過。

## 後續：移除自製帳號頁並修正真實 Meet 預備頁核對

原生頁面實查發現目前 Meet 在「切換帳戶」區域顯示 email，沒有先前要求的 Google Account aria-label。新版限定從該帳號區域或 Google 帳號控制項取值，並改用 Google 原生 AccountChooser 取得使用者選擇，移除本機選帳號頁與導航競爭。

已有真正 Google 原生選帳號與預備頁身分一致的唯讀證據，加入按鈕點擊 0。新帳號認證／主持人放行／真人音訊不在該證據內。NATIVE-01–12 共十四例取代歷史 ACCOUNT 表單案例。

BUG-010 後續真人核對：原生選定帳號與實際身分一致，主持人放行及入會成功；核對過實際錄音與 1357。語音品牌／姓名錯字仍保留為辨識限制，不與帳號修復混為一談。去識別證據見 docs/qa/reports/native-account-live-validation.json。


## Workspace reference follow-up — resolved during 2026-10-30 verification

- **REF-UI-01 (resolved):** notes typography consumed the available pane and clipped a second action row; row sizing, source-review layout and pane geometry were corrected. The actual accepted fixture renders both rows; browser tests exercise notes tabs and action cells.
- **REF-UI-02 (resolved):** full language labels were truncated in compact selects. A same-origin SVG arrow and explicit padding preserve the full target-language text while retaining native semantic controls.
- **REF-CSP-01 (resolved):** the first arrow used a data URI, which strict `default-src 'self'` blocked and logged as a console error (iteration 16). Moved to `/assets/chevron.svg`; the security policy was not relaxed. Later captures pass the unchanged zero-console guard.
- **REF-UI-03 (resolved):** completed status wording, single-track controls, known-speaker metadata and ordered decisions differed from the intended flow. The viewer uses truthful session/evidence state, hides unnecessary single-track selection and renders numbered decisions semantically as an ordered list.

These resolved items do not waive historical BUG-004 skips. See docs/qa/reports/visual-reference-20261030.md for final counts and limits. No private recording or live conference was used for this UI audit.


## Emerald style migration — resolved regressions (2026-10-30)

- **EM-01, recording feedback hidden (resolved):** the first theme hid `.activity`, suppressing speaker/stopped/stale/count feedback. Moved the existing live status nodes into the meeting metadata line and explicitly kept them visible. Affected FE-01/FE-03/E2E-01/E2E-06 checks pass after correction. Locations: `src/live/index.html`, final activity rule in `src/live/emerald.css`.
- **EM-02, search accessible name polluted (resolved):** a CSS-generated decorative suffix became part of the search label. Removed the pseudo text and set explicit searchbox accessible labels. Actual semantic fill and Ctrl/Cmd focus tests now pass.
- **EM-03, outdated test contracts (updated):** source-platform icons need the non-sensitive `source` list field; the whitelist test was updated while continuing to forbid token/pid leakage. Search is now persistent, so tests focus the real searchbox instead of a removed expand-search affordance. The current geometry check targets the newly selected 1280×800 design.
- **EM-04, state-file/revision safeguards (resolved):** null/corrupt action state falls back safely; action writes require a current summary revision and known row key, persist atomically and preserve source Markdown. Duplicate rows and nested action headings have executable unit coverage.

The failed discovery logs are retained (`test-emerald-first.log`, `test-emerald-corrected.log`, `test-emerald-full-1.log`); they are not counted as final acceptance. Historical BUG-004 strict-console HTTP-error limits remain explicit skips.


## Resolved during 0.2.0 consolidation — 2026-10-31

- **Explicit all/none preferences lost after reload:** `syncSelection` omitted values that had previously been defaults. After changing the implicit default to Chinese-English, this could restore the wrong choices. Both display and translation values are now serialized explicitly. LANG-01/LANG-02 cover persistence.
- **Teams return action absent / Meet-only wording:** return-link rendering accepted only Meet hosts. Trusted Teams hosts and correct localized labels are now supported; stale hrefs are removed. SIDEBAR-04 covers valid and hostile links and exact session switching.
- **Localized layout truncation:** fixed-width Chinese controls truncated English and split Korean source labels. Fluid international rows, two-line file metadata and responsive footer/settings/menu layouts are covered by I18N-LAYOUT and localization tests.

Known BUG-004 skips remain unchanged and are not counted as passes. No new live-meeting/ASR claims are attached to these UI fixes.


## BUG-ZIP-001 — Existing full-session ZIP audio CRC corruption (P1)

Status: confirmed, not changed in this release scope. `src/live-server.js:122` enqueues a subarray of a reusable read buffer, then reads the next chunk before asynchronous writes finish. A 320044-byte synthetic WAV exported through `/api/export` fails `zipfile.ZipFile.testzip()` at audio.wav; its leading RIFF header can be overwritten. This predates the source-link integration.

Independent reproduction used the isolated 8793 synthetic preview, saved to ignored `test/.tmp/source-export.zip`; CRC validation returned `20261031-linked-source-demo/audio.wav`. Original WAV and notes remain intact. Until fixed, retain/backup original WAV files directly rather than relying on ZIP audio. The full unit/QA suite does not assert ZIP audio CRC, so its passing count does not establish ZIP integrity.
