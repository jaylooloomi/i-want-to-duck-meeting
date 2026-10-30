# Duck Meeting 圖稿與功能驗收 — 2026-10-30

狀態：**受控 UI 驗收完成**。固定規則分數 **90.16192%**，兩次獨立截圖分數及 PNG SHA-256 完全一致。並非宣稱每個像素相同或已重新通過真人語音辨識。

## 視覺證據

- [參考圖](../../design/workspace-reference-target-20261030.png)、[實際頁面](../../design/visual-audit/iteration-21/actual.png)、[獨立重播](../../design/visual-audit/iteration-22/actual.png)。
- [凍結規則與歷次結果](../../design/visual-audit/README.md)：結構 70%、矩形 IoU 20%、RGB 10%；門檻 90，所有分區至少 80。沒有為過關修改權重、範圍或門檻。
- 接受的兩次截圖 Console/page errors 均為 0；CSP 箭頭失敗輪保留，未算通過。沒有改圖、遮罩、以參考圖片當背景或把示例資料放進產品。
- 圖片 SHA-256：`33e483717e96609b77d3e50491a5621f6bc468d62b840cd7803e0b35a4bf9390`。
- 結構分數 86.56677、幾何 99.43044、色彩 96.79096。

| 分區 | 結構分數 |
| --- | ---: |
| sidebar | 84.62% |
| sidebar_footer | 88.91% |
| title_header | 91.71% |
| source_strip | 90.96% |
| transcript_header | 85.41% |
| transcript_body | 87.84% |
| audio_player | 80.54% |
| notes_header | 91.75% |
| notes_body | 82.99% |
| source_review | 85.39% |

## 完整回歸

| 執行 | 案例 | 通過 | 失敗 | 既有跳過 | 秒 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一輪 | 629 | 613 | 0 | 16 | 275.58 |
| 第二輪 | 629 | 613 | 0 | 16 | 275.46 |

同一份凍結的產品原始碼連續兩輪通過，沒有觀察到本次測試範圍內的偶發性失敗。Python 計分工具另有 **5/5** 可執行測試：PNG 五種 filter／RGBA、SSIM、下採樣／IoU、空白頁拒絕，以及即使圖片相同仍因 Console 錯誤而回傳非零退出碼。

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js" "test/qa/*.test.js"
node test/qa/capture-reference.mjs test/.tmp/visual-replay
.venv-stt/Scripts/python.exe test/qa/visual-score.py test/.tmp/visual-replay
.venv-stt/Scripts/python.exe test/qa/visual_score_test.py
```

原始完整日誌位於本機 `test-visual-full-regression-1.log`、`test-visual-full-regression-2.log`；日誌雜湊、產品原始碼雜湊與分數存於[機器可讀報告](visual-reference-20261030.json)。

## 功能核對

| 功能 | 已執行驗證 |
| --- | --- |
| 左側清單 | 日期分組、41 筆可讀捲動、搜尋、切換、封存、重新命名、整場 ZIP 匯出、重新整理保持狀態 |
| 新增與結束記錄 | 麥克風／雙路模式、裝置載入、防重複啟動、精確場次停止、等待收尾、權限與重試提示 |
| 逐字稿／翻譯 | 原文保留、英中／中英、日／德等目標語言傳入 provider、未定稿暫譯、舊請求隔離、搜尋與空狀態 |
| 重點 | 即時標記、整段星號、篩選、刷新保留、取消、定稿後跳至實際 PCM 播放位置 |
| 錄音 | 真實合成 WAV、HTTP Range、播放／暫停／定位、速度、音量、三音軌切換；僅單音軌時隱藏多餘選單 |
| 會議紀錄 | Agent ready／waiting 狀態、摘要／決議／待辦、原生四大結構、編號清單、負責人提示、複製／下載與剪貼簿失敗替代操作 |
| 來源核對 | 實際來源平台、未對齊／缺資料、措辭／數字差異提示、跳至錄音；不把任一來源自動當正確答案 |
| 版面與安全 | 1920／1280／390 寬度完整操作、無水平溢出、語義定位、沒有硬等待、XSS 以文字呈現、strict console guard、同源與精確 ID 保護 |
| 本機資源 | Inter／Roboto 字型與 SIL OFL、同源 SVG 箭頭，原 CSP 不放寬；實際工作台資源 HTTP 200 |

本機工作台在確認 0 場進行中的會議後重啟；只重啟獨立 viewer，沒有加入、停止或整理其他會議。刷新 [本機工作台](http://127.0.0.1:8791/) 即載入新版。

## 已修復問題與定位

- 摘要／待辦列被擠壓：調整 notes 內容尺寸、表格與來源列，完整顯示兩列待辦。`src/live/style.css` 的 workspace/refinement 規則。
- 精簡下拉選單截字與 CSP 錯誤：原 data URI 被嚴格 guard 抓出，改成 `src/live/assets/chevron.svg`；靜態白名單 `src/live-server.js:534`、選單樣式 `src/live/style.css:89`。未放寬安全政策。
- 控制與字級定位：`src/live/style.css:112` 起的最終對齊；按鈕保持原生 HTML／SVG，可實際操作。
- 編號決議與負責人提示：`src/live/app.js:256` 的安全 Markdown renderer、`:280` 的唯一已知講者縮寫。原始負責人文字未被補造或改派。

## 驗收限制

1. **16 項既有 BUG-004 保持明列跳過**：HTTP 400/401/403/500／傳輸失敗等嚴格 Console 驗收限制仍在，不計入通過，沒有隱藏 guard 或假裝修復。
2. 本次圖稿／UI 重播使用合成資料與受控翻譯邊界，不使用私人錄音、不連入真人會議、不使用 Ollama。平台登入／放行、現場 ASR 準確度、真人翻譯延遲及 Agent 背景喚醒仍需各自的真人會議證據。
3. 原文／翻譯／錄音核對和時間定位是輔助，不保證逐字正確、說話者身分或字級精準時間對齊；缺資料時維持明確空／等待狀態。
4. 90.16% 是此專案固定方法在 Windows Chrome 156.0.8078.73／已安裝 Noto Sans TC 下的結果；不同瀏覽器／中文字型可能改變量測。Inter／Roboto 已由本機提供，附正式開源授權。
