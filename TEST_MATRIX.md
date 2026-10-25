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
