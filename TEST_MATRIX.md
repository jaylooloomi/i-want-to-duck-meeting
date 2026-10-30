# 全端測試規格矩陣

Phase 2建立時間：任何新測試程式撰寫之前。判定依使用者合理行為／安全契約，不把現況Bug當預期。

`[ ]` 尚待執行；`[x]` 通過（含有證據的N/A）；`[!]` 已重現產品缺陷，對應BUG_REPORT與可重跑skip規格。Case可含參數化子案例；全部處理後才sign-off。

範圍：本機產品UI／HTTP／CLI與錄製核心，外部Meet/Teams平台透過既有controlled adapter測試；不自動登入真帳號或使用私人音檔。既有測試需與新嚴格QA方法分開標示。沒有登入／管理員路由、SQL DB、React元件，相關維度用實際Origin/token/原生DOM代替。

## 後端邏輯層

| 狀態 / ID | 層級 | 目標 | 維度 | 操作步驟 | 預期畫面／資料結果 |
|---|---|---|---|---|---|
| [x] BE-01 | Backend | GET / 與靜態assets | 路由/headers | 讀所有assets、未知path及POST GET端點 | 200正確MIME/CSP/no-store/nosniff；未知404、方法405  已執行通過 |
| [x] BE-02 | Backend | API同源邊界 | 安全 | 跨Origin、偽Host、無Origin POST | 403且不觸發service  已執行通過 |
| [x] BE-03 | Backend | GET /api/meetings | Happy/Empty | 空目錄與兩筆狀態 | 空陣列；列表只含id/state/code、不洩漏token  已執行通過 |
| [x] BE-04 | Backend | GET /api/transcript | 資料狀態 | 排序、半行JSON、pending與done | 完整文字排序；忽略半行；done無pending/active  已執行通過 |
| [x] BE-05 | Backend | GET /api/transcript | 邊界 | 未知id、../、script、極長query | 404且不得讀目錄外資料  已執行通過 |
| [x] BE-06 | Backend | POST start | 契約 | 傳mode/input/output與managed/path偽造欄位 | 只傳允許的三欄；不覆寫工作身分  已執行通過 |
| [x] BE-07 | Backend | POST start/stop/heartbeat | 驗證 | 無效JSON/null／陣列／純量、錯MIME、未知操作、超64KiB | 400且無未捕獲例外；下一請求可恢復  已修復並啟用對應測試；針對性驗證通過 |
| [x] BE-08 | Backend | MicrophoneService.start | 防重複/型別 | 非法mode、Teams非整數/相同裝置、已有current | 拒絕且不spawn模型程序  已執行通過 |
| [x] BE-09 | Backend | MicrophoneService.audio | Token/順序/PCM | 錯token、sequence、odd/empty/oversize、backpressure | 拒絕且不寫WAV/遞增序號  已執行通過 |
| [x] BE-10 | Backend | MicrophoneService.audio/stop/heartbeat | Happy/冪等 | 真方法搭配隔離session I/O | 有序PCM寫入；停止一次；錯token拒絕  已執行通過 |
| [x] BE-11 | Backend | GET /api/audio-devices | 依賴失敗 | 隔離home無Python執行檔 | 500 JSON錯誤，不崩潰、後續API正常  已執行通過 |
| [x] BE-12 | Backend | 既有核心Unit | 回歸 | 執行既有全部Node unit | URL/CLI/狀態機/字幕/WAV/安裝/Teams/router/證據案例；記錄skip與舊測試方法限制  已執行通過 |

## 前端元件／狀態層

| 狀態 / ID | 層級 | 目標 | 維度 | 操作步驟 | 預期畫面／資料結果 |
|---|---|---|---|---|---|
| [x] FE-01 | FE-Unit | 逐字稿app.js | Happy | 注入API資料，輪詢pending後final | 姓名/時間/草稿/講者/狀態更新，final取代草稿  已執行通過 |
| [x] FE-02 | FE-Unit | 逐字稿app.js | XSS/Boundaries | 長Unicode、script/SQL字串、缺speaker、非法外連 | 原文textContent，無script執行；不顯示危險外連  已執行通過 |
| [x] FE-03 | FE-Unit | 逐字稿app.js | Empty/Async | 已有內容後API變[] | 清除舊內容/計數/進入會議連結，顯示尚無會議  已修復並啟用對應測試；針對性驗證通過 |
| [!] FE-04 | FE-Unit | 逐字稿app.js | Error/Recovery | 400/401/403/500/斷線後恢復 | 可見連線錯誤；恢復資料；console/pageerror嚴格檢查，故障注入resource error另外留證  BUG-004；已重現，保留skip規格 |
| [x] FE-05 | FE-Unit | 麥克風microphone.js | Validation | 拒絕getUserMedia權限 | 顯示錯誤且開始/來源控制恢復；不得POST start  已執行通過 |
| [x] FE-06 | FE-Unit | Teams裝置控制 | Validation/Empty | 空清單、重複刷新、錯型別回應 | 空資料有可理解提示，禁止無效開始，不發非法請求  已修復並啟用對應測試；針對性驗證通過 |
| [x] FE-07 | FE-Unit | 麥克風microphone.js | Async/DoubleSubmit | hold start請求後重複點擊 | 開始立即disabled；一筆start；成功後可停止  已執行通過 |
| [x] FE-08 | FE-Unit | Teams來源切換 | Async race | Teams裝置請求延遲，切回麥克風後完成 | 過期裝置回應不得覆寫當前來源提示  已修復並啟用對應測試；針對性驗證通過 |

## 端到端使用者旅程

| 狀態 / ID | 層級 | 目標 | 維度 | 操作步驟 | 預期畫面／資料結果 |
|---|---|---|---|---|---|
| [x] E2E-01 | FE-E2E | /逐字稿 | 1 Happy | 真server讀status/JSONL更新 | 逐字稿、講者、計數與狀態正確，零console/pageerror  已執行通過 |
| [x] E2E-02 | FE-E2E | /逐字稿 | 2 Input/XSS | 寫入長字串/空白/特殊字元/缺speaker | 安全顯示完整文字，沒有執行或破版  已執行通過 |
| [x] E2E-03 | FE-E2E | /逐字稿 | 3 Async/Empty | 空啟動；記錄中更新與結束；清空列表 | 有空態、資料同步、結束停止pending，無舊資料誤導  已修復並啟用對應測試；針對性驗證通過 |
| [!] E2E-04 | FE-E2E | /逐字稿 | 4 Error UI | API400/401/403/500與network abort | 有錯誤與恢復；嚴格console guard不得放行  BUG-004；已重現，保留skip規格 |
| [x] E2E-05 | FE-E2E | /?id=與History | 5 Navigation | 指定id、切選單、reload、back/forward、未知id | URL與顯示一致；不默默保留錯誤id；無登入路由需求  已修復並啟用對應測試；針對性驗證通過 |
| [x] E2E-06 | FE-E2E | /逐字稿與toolbar | 6 RWD/A11y | 1920x1080及390x844，長會議ID/講者文字 | 核心控制在viewport可點，不橫向overflow，label/role可用  已執行通過 |
| [x] E2E-07 | FE-E2E | /麥克風 | 1 Happy | fake媒體真AudioWorklet→真HTTP→隔離ASR adapter→stop | 真正PCM與有序sequence抵達，UI更新與停止，非真人ASR聲稱  已執行通過 |
| [x] E2E-08 | FE-E2E | /麥克風 | 2 Validation | 拒絕權限／裝置不可用 | 可見錯誤、控制恢復、無遺留stream  已執行通過 |
| [x] E2E-09 | FE-E2E | /麥克風 | 3 Async/DoubleSubmit | 延遲start；快速重複click與stop | 按鈕disabled、防雙start/雙stop，最後packet flush  已執行通過 |
| [!] E2E-10 | FE-E2E | /麥克風 | 4 Error UI | start/stop400/401/403/500及傳送失敗 | 顯示失敗與恢復，不卡disabled；所有console錯誤記錄  BUG-004；已重現，保留skip規格 |
| [x] E2E-11 | FE-E2E | /麥克風 | 5 Browser Mechanics | 收音後reload/pagehide | sendBeacon stop、track停止，reload不假稱仍收音  已執行通過 |
| [x] E2E-12 | FE-E2E | /麥克風 | 6 RWD/A11y | 桌面與390x844操作開始/結束 | 按鈕可實際點擊、權限提示有role=status  已執行通過 |
| [x] E2E-13 | FE-E2E | /?source=teams | 1 Happy | 讀裝置→選輸入/輸出→start→heartbeat→stop | 正確mode與device ids，一次start/stop、meter來源正確  已執行通過 |
| [x] E2E-14 | FE-E2E | Teams裝置 | 2 Validation | 空裝置、非法/同一裝置、防XSS名稱 | 禁止無效開始；裝置名不執行HTML；可恢復  已執行通過 |
| [x] E2E-15 | FE-E2E | Teams裝置 | 3 Async/Empty | 延遲列裝置/開始；刷新兩次 | 載入防呆、無雙start，空態不聲稱就緒  已修復並啟用對應測試；針對性驗證通過 |
| [!] E2E-16 | FE-E2E | Teams裝置 | 4 Error UI | 裝置API/開始/stop失敗 | 可見操作失敗且控制可重試；嚴格console guard  BUG-004；已重現，保留skip規格 |
| [x] E2E-17 | FE-E2E | /?source=teams | 5 Navigation | query初始化、reload、離開錄音頁 | 模式/裝置同步，pagehide結束工作；無帳號路由N/A  已修復並啟用對應測試；針對性驗證通過 |
| [x] E2E-18 | FE-E2E | Teams裝置 | 6 RWD/A11y | 桌面/手機下長裝置名稱 | 輸入/輸出select與start/stop可操作且不溢出  已執行通過 |
| [x] E2E-19 | FE-E2E | 404/頁面route coverage | Routes | /、?id、?source=teams、未知path | 唯一頁面與兩個query變體及404均測，沒有虛構登入頁  已執行通過 |

## 審計與最終驗收

| 狀態 / ID | 層級 | 目標 | 維度 | 操作步驟 | 預期畫面／資料結果 |
|---|---|---|---|---|---|
| [x] QA-01 | Backend | 測試紀律 | Integrity | 檢查prod基準hash／新測試語法 | 產品零變更、新測試無sleep/class/XPath、console guard驗證  已執行通過 |
| [x] QA-02 | Backend | 全套與coverage | Sign-off | 獨立臨時資料兩輪完整套件+coverage | 記錄pass/skip/known bugs，無剩餘checkbox、無誇大覆蓋率 |


## 最終核對

初始唯讀稽核（修復前）41個規格群組全部處理：29個[x]、12個[!]，沒有未處理案例。[!]含已確認產品缺陷及BUG-004字面零console驗收限制，並非偽裝成通過。參數化實作共有62個新增QA案例；已知問題可啟用重現，詳BUG_REPORT.md。帳號登入／admin／SQL／框架Store不存在，依Phase 1標為N/A並以Origin/token、原生狀態與filesystem替代，不虛構測試。

## 授權修復後狀態（2026-10-25）

七項產品缺陷已修復，相關 skip 已移除；37 個矩陣群組為 [x]，4 個為 [!]（均為 BUG-004 驗收限制），沒有待處理案例。初始唯讀階段結論與舊報告作為歷史證據保留。Teams 空裝置／格式錯誤現在預期顯示錯誤且開始禁用，不再對無效配置嘗試送出。完整兩輪回歸結果見 TEST_SUMMARY.md。

## 後續 Google Meet 登入接續驗證

此區是七項修復後追加的需求，與上方歷史 41 組矩陣分開。

| 狀態 / ID | 層級 | 目標 | 維度 | 步驟與預期 |
|---|---|---|---|---|
| [x] LOGIN-01 | FE-E2E | Google 登入接續 | Happy/Navigation | 模擬要求登入、手動完成，返回相同 Meet URL，waiting_login → joining，只執行一次接續 |
| [x] LOGIN-02 | FE-E2E | 登入仍被要求 | Error/Loop | 返回後仍在登入頁，明確失敗，不重複登入 |
| [x] LOGIN-03 | FE-E2E | 登入等待 | Async/Timeout | 等待逾時回報 signin_required，不無限等待 |
| [x] LOGIN-04 | FE-E2E | 登入視窗 | Browser | 關窗明確失敗，不宣稱已加入 |
| [x] LOGIN-05 | FE-E2E | 取消 | Async | STOP 原因保留 user_stop，等待可取消 |
| [x] LOGIN-06 | FE-E2E | 返回網址 | Validation | 非 HTTPS Google Meet 目標拒絕，沒有導航 |
| [x] LOGIN-07 | Backend | 帳號提示 | Data | 缺檔／損壞資料安全回傳空；只回傳 metadata，不當成有效登入證據 |
| [x] LOGIN-08 | Backend | CLI join | Contract | 印出 GOOGLE_ACCOUNT_HINT 與保持視窗開啟說明，不把設定檔提示當驗證身分 |

此 LOGIN 區為受控登入測試，未包含真人驗證數。後續真人原生選帳號、放行與錄音結果另見下方目前流程及去識別報告。

## 歷史：自製帳號頁版本（已被原生流程取代）

| 狀態 / ID | 層級 | 操作與預期 |
|---|---|---|
| [x] ACCOUNT-01 | FE-E2E | 即使有預設帳號，也必須先明確選擇；選擇前無 Meet 請求 |
| [x] ACCOUNT-02 | FE-E2E | 選第二帳號 B，URL 保留 authuser=B，Meet 控制項核對後才有一次加入點擊 |
| [x] ACCOUNT-03 | FE-E2E | 錯誤、缺失、多重身分三種案例全部零加入點擊 |
| [x] ACCOUNT-04 | FE-E2E | 取消選擇不進入 Meet |
| [x] ACCOUNT-05 | FE-E2E | 選擇頁關閉與逾時明確失敗 |
| [x] ACCOUNT-06 | FE-E2E | 跨 Origin POST 拒絕，帳號名稱 XSS 不能執行 |
| [x] ACCOUNT-07 | Backend | 拒絕非法目標／非 email 帳號，不猜索引 |
| [x] ACCOUNT-08 | FE-E2E | 空值顯示驗證提示，可重新選擇成功 |
| [x] ACCOUNT-09 | FE-E2E | 1920px 與 390px 下核心按鈕可見可點 |

此區包含十二個參數案例；實際 Google 控制項相容性仍待真人驗證，不能用這些受控頁面證明實際登入身分已正確。

## 目前 Google 原生帳號流程

以下取代歷史自製表單案例，不將已移除頁面算成現行路由。

| 狀態 / ID | 層級 | 預期 |
|---|---|---|
| [x] NATIVE-01 | FE-E2E | 直接開 Google 原生選帳號頁，沒有 localhost 表單或原會議加入請求 |
| [x] NATIVE-02 | FE-E2E | 原生選 B，綁定 B，支援實際 Meet 切換帳戶區域格式，核對後一次加入 |
| [x] NATIVE-03 | FE-E2E | 不同／缺失／多重身分共三例，加入點擊全部為零 |
| [x] NATIVE-04 | FE-E2E | 選 B 但 Google 回傳 A 時拒絕接續 |
| [x] NATIVE-05 | FE-E2E | 沒有明確操作的預設帳號跳轉不接受 |
| [x] NATIVE-06 | FE-E2E | 使用其他帳戶經 Google 原生登入頁完成後接續 |
| [x] NATIVE-07 | FE-E2E | 原生選擇逾時明確停止 |
| [x] NATIVE-08 | FE-E2E | 關閉原生視窗明確停止 |
| [x] NATIVE-09 | FE-E2E | 取消保留 user_stop 原因 |
| [x] NATIVE-10 | FE-E2E | 任意聊天／頁面 email 不得替代帳號區域 |
| [x] NATIVE-11 | Backend | chooser 返回非會議首頁，拒絕不可信 host 與帳號索引猜測 |
| [x] NATIVE-12 | FE-E2E | 未登入時在原生登入頁按 Enter 可接續，不讀取欄位值 |

證據分開保存：早期 Google 唯讀檢查為零加入點擊；2026-10-26 後續使用者實際選帳號、主持人放行與約 121.7 秒錄音成功，字幕及錄音轉錄均含 1357。Google Meet／Arthur 仍有錯字，完整測試句未通過。見 [去識別真人結果](docs/qa/reports/native-account-live-validation.json)，不得把受控案例數當真人測試數。


## Workspace reference follow-up — 2026-10-30

- [x] VISUAL-REF-01 | FE-E2E | 1586×992 workspace | Frozen whole-region structure/geometry/color audit. Render the reference scene through the real local server, compare the unmodified screenshot, require ≥90 composite, every region ≥80 and zero console/page errors. Evidence: iteration-21, 90.1619245994.
- [x] VISUAL-ASSETS | Backend/FE-E2E | Local fonts and select arrow | GET font/SVG assets; validate media type, real font bytes and SIL OFL licenses. Native selects retain complete labels without relaxing CSP.
- [x] VISUAL-NOTES | FE-E2E | Notes/source metadata | Ready Agent notes show ordered decisions, actual owner identity hints, source platform and recorded-speaker count. Missing evidence never invents participant totals or audio availability.
- [x] WORK-UI | FE-E2E | Sidebar/transcript/audio/notes | Search/select/rename/archive/export, bilingual presets, real PCM playback/seek/rate/volume/tracks, copy/download, source comparison, settings/help, persistence and no horizontal overflow at 1920/1280/390 widths.
- [x] HL-UI / LIVE-TRANSLATE | FE-E2E | Live content | Mark moment/utterance, filter/reload/unmark/seek; pending text receives incremental translations and stale responses cannot replace the selected language/session.
- [x] VISUAL-SCORE | QA tooling | Metric correctness | Decode all five PNG filters and RGBA, SSIM identity/difference, downsampling/IoU, reject a blank page under the frozen protocol. Five executable Python tests.

Full regression results and acceptance limitations: docs/qa/reports/visual-reference-20261030.md. Provider services and real speech are boundary-stubbed in UI replay, not labelled live-service validation.


## Emerald selected-style implementation — 2026-10-30

This replaces the current layout target; the old 90.16% audit remains historical and is not reused as the new design's score.

- [x] EMERALD-API | Backend | Action completion | Exact id/origin, boolean and SHA-shaped keys, stale-summary rejection, unknown task rejection, persistent completion and original Markdown unchanged.
- [x] EMERALD-UNIT | Backend | Overlay parser/storage | Duplicate/escaped-pipe rows stay distinct, nested action headings parse, corrupt completion JSON is safe, actual file bytes and disk availability, symlink directories excluded.
- [x] EMERALD-UI | FE-E2E | 1586/1280/390 | Check/uncheck/reload task status, copy paragraph, mark speech, source transcript review/TXT download, expand player/Escape, Ctrl/Cmd search shortcuts, real storage display and no horizontal overflow.
- [x] WORK-UI / HL-UI / LIVE-TRANSLATE | FE-E2E | Existing workflows | Playback/range/track/rate/volume, history/search/rename/archive/export, notes/copy/download, highlights and incremental translation retained.
- [x] EMERALD-REFERENCE | FE-E2E | Selected layout | 1280×800 sidebar 224px; pane origin around 239×164, two working columns, status cards, source rows; real-app capture, zero console errors.
- [x] EMERALD-REG-ACTIVITY | FE-Unit/E2E | Live status | Recording activity, speaker feedback and record count remain visible after the visual migration; no hidden stale/error status.

Full frozen-source regression acceptance: see docs/qa/reports/emerald-20261030.md for the two final runs, rather than the earlier failed diagnostic run.


## Light/dark theme follow-up — 2026-10-30

- [x] THEME-01 | FE-E2E | 1280/390 | Footer toggle and settings selection synchronize; local preference survives reload; current meeting unchanged; no overflow.
- [x] THEME-02 | FE-E2E | Multi-tab | Another same-origin tab restores/synchronizes preference; invalid values safely use light.
- [x] THEME-03 | FE-E2E | Storage denied | Read/write exceptions do not crash; appearance changes and persistence warning stays visible.
- [x] THEME-04 | FE-E2E | Media | Switch both directions during actual synthetic WAV playback; no navigation, pause or selected-meeting change.
- [x] THEME-05 | FE-E2E | Contrast | Measure rendered transcript, main title, activity feedback and selected settings button contrast; minimum 4.5:1 on measured backgrounds.
- [x] EMERALD-UI | FE-E2E | Both themes, 1586/1280/390 | Replay completion, paragraph copy/seek/mark, source TXT, player expansion/restore and keyboard search with strict console guards.

Full regression results: docs/qa/reports/themes-20261030.md. Prior Emerald and old-reference results remain historical.


## Interface localization — 2026-10-30

- [x] I18N-01 | FE-E2E | zh-TW/en/ja/ko × 1280/390 | Switch interface language; verify button/dialog/state labels, complete localized dates, preserved meeting names/speakers/transcripts and independent original-language settings; reload retains preference.
- [x] I18N-02 | FE-E2E | All four locales, both themes | Open settings; use keyboard to switch archived/current categories; preserve selected category state and usable controls.
- [x] I18N-03 | FE-E2E | Same-origin tabs | Stored choice synchronizes; invalid preference safely falls back to Traditional Chinese.
- [x] I18N-04 | FE-E2E | Storage denied | In-place language change succeeds and reports that the preference cannot be saved.
- [x] I18N-05 | FE-E2E | Microphone session | Switch language while real browser AudioWorklet PCM is being uploaded to the isolated HTTP fixture; one start, no automatic stop, one explicit stop and completed state.
- [x] I18N-06 | FE-E2E | Authored markup | Every initial authored Chinese UI string has a bundled English translation; all catalog entries have English/Japanese/Korean values. Native language names and protected content destinations are excluded.
- [x] I18N-07 | FE-E2E | Synthetic WAV + private-content fixture | Switch English→Japanese→Korean without reload or playback pause; preserve source Markdown, user title matching a default UI label, transcript and notes card structure.

These are interface-localization tests; they do not establish Japanese/Korean ASR accuracy or live third-party meeting compatibility. Full result: `docs/qa/reports/i18n-20261030.md`.


- [x] I18N-LAYOUT | FE-E2E | English/Korean × 1440/1280/390 × light/dark | Measure selected-option text width, non-overlapping language controls, search-above-controls, unbroken source labels and zero horizontal page overflow. See docs/qa/reports/i18n-layout-20261030.md.


## Release 0.2.0 consolidation — 2026-10-31

- [x] LANG-02 | FE-E2E | Explicit all/none choices | Change or retain All originals / No translation, reload and verify both survive despite the new Chinese-English default.
- [x] LANG-03 | FE-E2E | German/Japanese/Korean originals | Filter explicit regional language metadata, preserve unknown originals, show notice and restore the selected language on reload.
- [x] SIDEBAR-04 | FE-E2E | Meeting return links | Real exact-host Meet/Teams labels and destinations, recordingUrl fallback, hidden invalid/local links and cleared stale destinations when switching sessions.
- [x] INSTALL-RELEASE | Local CLI | Codex runtime and Claude enabled plugin | Unified installer succeeds with existing audio assets; Claude reports 0.2.0 enabled, installed command points at current checkout; doctor OK.
