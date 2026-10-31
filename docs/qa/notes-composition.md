# 決議／待辦來源與郵件內容選擇器

已整合至 0.3.1 候選版，與 Agent 整理及郵件功能共同驗證。最新發行狀態見 release-0.3.1.md；以下保留原始實作驗證紀錄。沒有建立或寄出信件。

## 使用

- 摘要、決議或待辦頁中的「連結來源」可選擇逐字稿原文，儲存完整文字、原始時間及發言者。已連結的項目可「查看原文」、「定位逐字稿」或「回放錄音」。無錄音、缺時間或缺錄音起點時停用回放；原文仍可定位。
- 來源連結另存該會議的 `summary-evidence.json`，不修改摘要或逐字稿。摘要項目改動、逐字稿原文／時間／發言者改動，舊連結不會套到新內容。來源變更時保留舊快照供核對，顯示未連結。重複決議與待辦可分別連結。
- 新的 Agent 匯出提示提供原始來源索引，要求決議表及待辦表附「來源原文」「來源時間」。只有與原始逐字稿完整文字及原始時間精確且唯一匹配時才連結，未知時間保留未知。來源索引為有大小上限的節錄，未包含的來源需查原始逐字稿或手動連結。
- 舊摘要不會自動猜來源。可逐筆手動連結；解除連結也適用於 Agent 的來源欄位。
- 郵件頁展開「選擇郵件內容」，逐項勾選決議／待辦。「預覽勾選內容」不修改正文，「套用到正文」才替換正文，可按「復原套用前正文」。收件人與手動主旨保留，整封編輯、複製與 TXT 下載沿用既有功能。
- 勾選 ID 存入 `mail-draft.json` 的 `selectedItemIds`。來源摘要變更會使預覽失效；手動草稿仍保留，失效項目需重新勾選。勾選不代表已把內容套用到正文，也不代表寄出郵件。

## API 與版本

`GET /api/transcript?id=<確切ID>` 回傳 `noteItems`：摘要 revision、evidenceRevision、逐筆 ID、類型、原文行號與 source。

`POST /api/summary-source` 使用相同 origin 與 JSON，必須提供確切會議 ID、itemId、revision、evidenceRevision、recordIndex，並同時傳 recordText、recordTime、recordSpeaker 以核對目前逐字稿。recordIndex 為 null 代表解除連結。過期版本、猜造原文及不存在的記錄不寫入檔案；寫入使用鎖與暫存檔替換。

郵件寫入 API 支援可選的 `selectedItemIds`，驗證不重複且都屬於目前摘要。舊草稿格式仍可讀取。

## 驗證

- 完整單元回歸：534 項，532 通過，2 項因未安裝 Claude CLI 跳過，0 失敗。記錄：`test-notes-composition-unit-final.log`。
- 首輪單元回歸有 1 項 Windows 命令列測試因 PATH 無 cmd.exe 而失敗；補上測試程序的 Windows 系統路徑後通過。未改系統 PATH 或測試斷言。
- 最終相關單元與 Chrome 整合測試：16 項全數通過。`test-notes-composition-focused-final.log`。包括來源未知／缺時間／無錄音、精確來源欄位、重複項目、解除連結、摘要／逐字稿變更、並行版本、同源／確切 ID 檢查、勾選與取消、預覽／套用／復原、手動草稿、重載、複製／下載、窄版邊界與前端例外檢查。
- 截圖 `notes-evidence-demo.png`、`mail-selection-demo.png` 皆使用臨時建立的示範逐字稿與靜音 WAV；已視覺檢查。測試結束清除其臨時會議。
- 未跑整套既有 integration、真實會議／麥克風錄音或 Windows 安裝包重建。本輪以真實 Chrome、本機 HTTP 與人工示範資料驗證功能。

目前沒有待使用者決策或外部阻塞。
