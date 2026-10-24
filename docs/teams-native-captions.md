# Teams 原生字幕與 Paraformer 備援

## 使用

將實際 Teams 會議連結貼給 AI，或執行 `node bin/openmeeting.js join '<完整連結>'`。加入參數會保留。程式準備音訊環境，使用已確認／Windows 預設裝置，開啟 `chrome-profile/teams-notetaker` 專用 Chrome。首次登入、必要權限與主持人放行仍需使用者完成；不要求手動啟用字幕／設定字幕語言。

專用頁面嘗試加入、關閉麥克風與攝影機、啟用即時字幕、選擇台灣中文。UI 沒有該選項或沒有權限時不宣稱設定成功；`teamsBrowser.captionLanguage=unverified` 表示尚未驗證語言。Teams 頁面必須保持開啟。

`--no-open` 明確選擇只有雙路音訊與 Paraformer，不開原生字幕瀏覽器。不會附加到一般 Chrome，也不讀取一般 Chrome 帳號資料。專用頁面是額外與會端，可能需要主持人放行；它不代替使用者發言。

## 資料與狀態

- `teamsBrowser.state`：`needs_login`、`joining`、`waiting_admission`、`in_call`、`waiting_page`、`setup_retry` 或 `unavailable`。與頂層音訊擷取狀態分開。
- `nativeCaptions.state=receiving`：曾收到有效原生文字，不保證持續連線或雙方都完整。`messages` 是平台主鍵數，`revisions` 是接受的更新數。
- `transcript-native.jsonl`：原生訊息及修訂，附接收時間。
- `transcript-paraformer.jsonl`：兩路原始 ASR 結果，用於錄音驗證；不因主逐字稿採平台文字而刪除。
- `transcript.jsonl`／`.md`：原生訊息依 session、speaker、message id 去重，只接受新版本；與 ASR 近時且正規化後等值時採原生，其他 ASR 保留。

不把平台時間戳擅自當成 epoch；原生文字使用接收時間。沒有參與者名稱時不推測真實身分。跨來源的文字不同時可能重複，這比以時間接近為由刪掉另一位講者安全。Paraformer 仍在背景辨識兩路，以保留字幕中斷／部分缺失時的備援。

## 實作範圍

`src/teams-captions.js` 為自行實作的頁面 init script 與來源路由，未載入 Tactiq bundle。監看本機／遠端 `main-channel` 的 recognitionResults；可取得 calling service 時訂閱 V2 事件，原始呼叫與回傳值保持。

`src/teams-browser.js` 使用 Playwright 控制允許的 Teams 主機 UI。沒有攔截登入憑證、重播權杖或呼叫私有 oncommand 端點。登入表單由使用者操作。平台內部物件與字幕格式不是穩定官方 API，真人驗證及失效回報仍必要。

錄音仍是 Windows 麥克風與整個播放裝置，尚未做到 Teams 專屬媒體隔離。其他應用的音樂仍可能進入 WAV／ASR；原生字幕也無法修復錄音。不要把平台文字成功當成兩路音檔成功。

## 驗證

```powershell
npm test
node --test test/integration/teams-captions.test.js
```

受控 Chrome 測試攔截 Teams URL 並回傳本機 HTML，不連線到 Microsoft／真人會議。驗證實際 RTCDataChannel 事件、V2 handler 不破壞原始結果、自動靜音／關鏡頭／加入／字幕與中文選單。單元測試涵蓋修訂、亂序、重送、兩人／跨 session、來源優先及 ASR 保留。它們不能證明現行真人 Teams 的私有介面相容。

真人驗收：使用者提供目前會議連結，程式自動設定；必要登入與放行完成後，先確認入會及字幕來源，再請電腦與手機依序說不同完整測試句。核對 Microsoft Teams、1357、發言者、原生字幕與兩路原始 WAV／ASR，不能把測試程式裡的固定文字當作真人結果。截止本文件建立，新版真人驗證尚未完成。

2026-10-25 本機驗證：完整 Node 單元測試 **490 通過、0 失敗、0 略過**；新增受控 Chrome 整合測試 **2 通過**；技能 frontmatter 驗證通過。另有 25 項安裝／Teams 聚焦測試通過。測試日誌保留於本機 `test-teams-native-*.log`，不提交會議或個人資料。
