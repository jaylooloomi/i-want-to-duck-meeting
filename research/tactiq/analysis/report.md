# Meet／Teams 逐字稿擷取研究

## 一、已確認的技術路徑

證據限於安裝版本 3.1.7320。各搜尋點詳見 `evidence-index.json`；不從壓縮 bundle 中的通用套件字串推論產品能力。

### Google Meet

1. `background.js` 動態註冊 `tactiq-rtc-meet-main`，指定 `googlemeet.inline.js`、`document_start`、`world: MAIN`、所有 frame。這解釋為何只看 manifest 的靜態 content scripts 不足以理解實際擷取。
2. `googlemeet.inline.js` 包裝 `RTCPeerConnection` 與 `createDataChannel`，同時監看遠端 `datachannel`。辨識 `captions`、`captions_v2`，另有 `meet_messages`、`media-session` 等資料處理。
3. 檔案包含 protobuf 讀寫器與字幕結構，欄位包含 deviceId、messageId、messageVersion、text、langId；另外有資料格式的備援解析。這是收到平台字幕的解析路徑，不等於自行做聲音辨識。
4. 訊息依 messageId／messageVersion 合併更新，以約 500ms 批次經頁面 CustomEvent 交給其餘擴充功能程式。
5. 字幕通道有衝突處理、斷線重建、語言重送；健康紀錄區分原始封包、成功字幕、控制封包與解析拒絕，避免把「通道存在」當成「逐字稿成功」。
6. 語言邏輯也包含平台偏好儲存與同步處理。直接改寫平台儲存或私有封包容易跟隨版本失效，不應先照搬。

官方 Meet 指南明確說正常使用不需要打開可見 CC，與程式的資料通道路徑相符。較通用的安裝指南仍要求開啟字幕，兩份說明存在差異；應按平台／版本實測，不能把所有平台當成一條路徑。

### Microsoft Teams

這個 bundle 明確將 `/light-meetings/` 判為 `LightMeetings`，其他為 V2。兩種情境有不同路徑：

1. WebRTC `main-channel`：對收到的二進位資料做文字解碼，找出 JSON，讀取 `recognitionResults`。字幕有 timestampAudioSent、userId、id、text 等資料。
2. V2 頁面內部 calling service：尋找 `window.msteamscalling.deref()`，取得 active call，呼叫 `startClosedCaption()`，等待開始成功，再包裝 `remoteUserEventsReceived` 的 handler，處理 recognitionResults。它也保留並呼叫原始 handler。
3. 訊息主鍵由音訊時間戳與 userId 組成，版本取自訊息 id；同一訊息更新時替換舊版，約 500ms 批次發送。
4. 發言者透過參與者資訊／rosterUpdate 對應。不能只用說話時畫面顯示的人名猜字幕歸屬。
5. Light meeting 語言設定有 UI 自動化：更多、字幕、字幕設定、語言；還有攔截既有 oncommand 呼叫以取得會話參數的路徑，之後嘗試以當前會話呼叫語言設定，失敗退回 UI。

第 5 點使用私有端點與會話參數，**不是官方開發 API**。本次沒有呼叫端點、取得權杖或複製會話資料；建議先做 UI 設定及讀取可用字幕的獨立實作，避免把這種 session/header 攔截當成產品前提。

官方 Teams 指南也指出 light meeting 可能要開啟字幕並同步語言；每位參與者自行控制姓名辨識。程式出現設定功能不代表可以越過主持人權限或組織政策。

## 二、對我們專案的意義

| 項目 | 目前專案 | 可採用的設計 |
|---|---|---|
| Meet 文字來源 | `src/page/caption-observer.js` 觀察 DOM，`src/captions/assembler.js` 重建捲動文字 | 在導航前裝入平台事件擷取，保留 DOM 備援 |
| Teams 文字來源 | 系統／麥克風錄音後經 Paraformer 辨識 | 先取得平台已辨識的字幕，減少音樂與錯誤輸入裝置影響 |
| 字幕更新 | DOM 區塊合併 | 引入平台訊息 id、版本、發言者 id，拒絕過期更新 |
| 健康檢查 | 音量／錄音狀態與逐字稿檢查 | 分開檢查入會、音訊、字幕通道、解析、摘要 |
| 語言 | 多處設定 | 開始前選定語言，驗證真正套用成功；沒有權限才請使用者介入 |
| 錄音 | Meet WebAudio；Teams 系統輸出＋麥克風 | 獨立保留；平台字幕成功並不能證明 WAV 有聲音 |

平台原生字幕可能避開我們曾碰到的桌面音樂干擾，但仍可能聽錯中文、英文或數字，不能預先保證 1357。若音樂真的進入會議本身，也可能影響平台辨識。

Tactiq 的資料通道接法不等於會議媒體錄音隔離，也不等於自動登入、入會或等待放行。採用它的設計仍需我們的會議生命週期管理。

## 三、建議實作順序與驗收

1. **先定義共用平台字幕事件**：source、meetingId、speakerId、messageId、revision、text、receivedAt。以自行建立的測試資料驗證新版覆蓋舊版、亂序、重送、兩人交錯、重新入會不同 session。不要照抄 Tactiq 程式／解碼器。
2. **Teams light meeting 做第一個最小驗證**：僅讀取測試會議的原生字幕；先驗證 document_start 安裝時機、通道標籤及實際封包，再決定解析器。測試 UI 啟動字幕／語言與無權限回報。
3. **Meet 資料通道做獨立 adapter**：資料格式由授權測試會議取得的樣本驗證；有版本偵測及解析失敗率，失效切回既有 DOM，避免雙來源重複寫入。
4. **加上獨立音訊健康檢查**：兩路聲音與文字各自驗證，不以非零 peak 當作測試句錄到；保留 Paraformer 作無字幕平台／錄音補轉錄備援。
5. **最後銜接自主會議 worker 與摘要**：入會、等候、結束、離線重試、摘要與原文依據；資料匯出仍由自己控制。

真人驗收：手機／電腦交替說完整中文句、Microsoft Teams、1357；驗證每句文字、發言者與各自音訊。另測關閉可見字幕、字幕語言錯誤、斷線重連、通道變更、主持人拒絕字幕、長句修訂。靜態掃描無法代替這些驗收。

## 四、資料下載與影片限制

`official/manifest.json` 記錄 17 次頁面下載（含語言指南的兩種網址）；均取得 HTML，另外產生文字版。`asset-manifest.json` 記錄相關插圖下載結果。影片查找紀錄見 `videos/README.md`，已下載指定文章的 3 個 GIF 操作動畫（29.55、22.80、17.20 秒），並檢視其開頭／中間／結尾影格；沒有獨立有聲影片。

本次沒有修改正式擷取程式，沒有重新加入歷史會議，也沒有承諾 Tactiq 私有介面相容。研究分支保留先前自主會議 PoC 未提交的檔案，不混入本研究。

## 五、官方來源

- [Meet 操作指南](https://help.tactiq.io/en/articles/9535734-how-to-use-tactiq-with-google-meet-meetings)
- [Teams 操作指南](https://help.tactiq.io/en/articles/9560779-how-to-use-tactiq-with-microsoft-teams-meetings)
- [安裝指南](https://help.tactiq.io/en/articles/10066236-how-to-install-the-tactiq-extension)
- [語言設定](https://help.tactiq.io/en/articles/4786785-change-the-transcription-language-during-a-meeting)
- [MCP 功能與權限](https://help.tactiq.io/en/articles/14883619-connecting-tactiq-mcp-server)

其他已下載頁面來源、雜湊及錯誤請以 manifest 為準。這份報告以自行撰寫的技術觀察為主，官方文章與廠商 bundle 保留在本機研究用途。
