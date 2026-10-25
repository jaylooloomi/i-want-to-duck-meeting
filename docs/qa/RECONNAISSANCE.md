# Phase 1：全端逆向盤點

基準分支：codex/fullstack-qa-audit；基準commit 8210051。產品檔案SHA-256見production-baseline.json；本輪不得修改產品檔案。既有測試存在，並非空白測試專案；歷史數字不充當本輪執行結果。

## 架構與啟動
- Windows本機單體，Node.js ES modules >=22；唯一npm runtime依賴playwright-core。Python負責離線ASR、VAD／講者／WASAPI，模型與虛擬環境在本機。
- 後端src/live-server.js的startLiveServer同時serve靜態前端；沒有React/Vue、前端build/dev server、DB或migration。
- 人工啟動：node bin/openmeeting.js live --no-open --port 8791；測試以startLiveServer({port:0,meetingsDir:臨時路徑,microphone:隔離adapter})自動啟閉，不接觸真實會議或既有錄音。
- CLI：join/wait/status/list/leave/transcript/login/doctor/live/setup-stt/setup-audio/audio-devices/audio-confirm/transcribe。meet錄製生命週期src/session.js，Teams src/teams-recording.js，收音src/microphone.js。

## 前端路由與頁面
| URL | 用途 | 權限／錯誤頁 |
|---|---|---|
| / | 即時逐字稿與本機／Teams收音 | localhost公開，沒有帳號登入 |
| /?id=會議ID | 指定會議；latest跟隨最新 | URL初始化selected；下拉選擇replaceState |
| /?source=teams | 初始Teams收音控制 | 讀Windows裝置清單 |
| 未知路徑 | HTTP404 | 無HTML自訂404頁 |
- 靜態asset：/app.js、/microphone.js、/pcm-worklet.js、/style.css；不算使用者頁面。
- 沒有受保護登入／管理員路由，相關登入跳轉矩陣為N/A；不得憑空加入401跳登入需求。

## 狀態、互動與API客戶端
- 無Redux/Pinia、local/sessionStorage或Cookie Token。app.js閉包：selected/signature；microphone.js閉包：session token、音訊graph、upload佇列、sequence與stopping。
- URLSearchParams初始化；replaceState更新選擇與錄音id。未見popstate處理，應驗證瀏覽器上一頁／下一頁是否同步，不直接當正常行為。
- 表單：會議來源、麥克風、Teams輸入／輸出裝置、會議下拉、自動捲動checkbox；按鈕更新裝置／開始／結束。沒有登入表單、modal、分頁或排序表格。
- 開始即disabled防連點；停止有stopping guard；佇列>40停止。Teams heartbeat2000ms，本機AudioWorklet傳PCM；pagehide用sendBeacon停止。
- fetch原生：GET失敗顯示「連線中斷／畫面可能不是最新」；POST JSON錯誤顯示error.message。沒有Axios或401攔截器；所有狀態錯誤需依實際產品類型驗收。
- 750ms輪詢。textContent渲染發言與姓名，外連僅允許https://meet.google.com。空清單可能保留舊逐字稿，列疑似缺陷待動態證明。

## 後端端點
| Method/Path | 輸入/輸出 | 邊界 |
|---|---|---|
| GET /api/meetings | [{id,state,code}] | meeting目錄狀態，不含token |
| GET /api/transcript?id= | {id,status,records,pending,activeSpeakers}；無資料404 | resolveMeeting路徑限制、terminal清pending |
| GET /api/audio-devices | Python Windows裝置清單 | execFile10秒，失敗500 |
| POST /api/microphone/start | mode/input/output；回{id,token} | 拒絕跨origin、不傳入任意filesystem/managed參數 |
| POST /api/microphone/audio | PCM octet-stream、X-Session-Token、X-Audio-Sequence | 64KiB上限、token/順序/型別 |
| POST /api/microphone/stop | {token} | MicrophoneService生命週期 |
| POST /api/microphone/heartbeat | {token} | token與lease |
- 所有請求驗Host，帶Origin時須同源；POST必須Origin；CSP self、frame-ancestors none、nosniff、no-store。無SQL/資料庫，SQL injection為字串邊界而非DB測試。
- 存儲：status.json原子merge、transcript.jsonl與live.json、WAV、音訊設定；只用測試獨立目錄。
- 第三方：Chrome/CDP、Google Meet／Teams頁面、模型初次下載、Python子程序。新QA不登入、不加入會議、不下載模型。測試邊界明確mock子程序/語音服務，不把stub ASR當真人辨識證明。

## 採用測試工具
- Node node:test/assert：後端Unit/API Integration。
- Playwright-core＋本機Headless Chrome：獨立app.js/microphone.js前端元件測試與完整server UI E2E。
- 以test fixture lifecycle代替Playwright Test的webServer；自動start/shutdown、context tracing及失敗截圖。不存在框架元件，不引入Vitest/Jest模擬不存在的React/Vue。
- 每個新瀏覽器案例統一收集pageerror及console.error，結束前強制判定；不使用CSS class/XPath定位或固定sleep。
- Node V8＋Chrome precise JS coverage：分別呈現執行區段覆蓋，不能把route coverage當code coverage；既有套件未提供branch instrumentation時如實標記。

Phase 1完成。下一步先保存TEST_MATRIX.md，再撰寫測試。

## Authorized repair contract update

POST /api/microphone/start now validates that JSON is a non-null, non-array object before forwarding the existing three allowlisted fields. Viewer ID updates retain other URL parameters; unknown IDs synchronize latest fallback. Teams readiness and generation checks are frontend state, not browser persistent storage or a new framework.
