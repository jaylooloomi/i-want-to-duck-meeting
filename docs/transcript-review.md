# 會議視窗與雙來源核對

## 會議視窗

專用 Meet 或 Teams 記錄視窗有可收合的 meeting AI 面板，顯示最近的字幕和收音狀態。登入與 Google 選帳號頁面維持原有流程。面板在 Chrome 隔離的執行環境中操作，逐字稿不放在會議網站可讀取的 JavaScript 介面。面板與工作台的「結束記錄」都會讓本場正常收尾；其他與會者不受影響。會後仍在 Duck Meeting 工作台看摘要、來源連結、待辦與郵件。

Meet 沿用自動起錄，可在面板暫停和繼續。若需要一開始就等手動操作，啟動前設定 `OPENMEETING_MANUAL_START=1`。暫停期間以靜音維持錄音時間軸，並略過字幕。仍停留在畫面上的舊字幕區塊會等它換新後才繼續收錄；平台延遲或回送仍可能影響邊界。Teams 沿用自動雙路收音，只提供結束記錄，沒有手動暫停。

從面板結束後，另外以當時可用的字幕與錄音轉錄保存本機原文摘錄 `meeting-report.auto.md`／`.json`。沒有已完成的錄音轉錄時，只使用現有字幕；這一步不會安裝或啟動新的辨識模型。摘錄是核對材料，正式整理仍沿用 Agent 流程。

## CLI

對已收尾的場次執行，請指定完整的會議 ID：

```text
openmeeting transcribe <ID>
openmeeting crosscheck <ID>
openmeeting report <ID>
openmeeting report <ID> <審閱JSON路徑>
```

已有錄音轉錄時可略過 `transcribe`。`crosscheck` 產出 `transcript-crosscheck.md`／`.json`。它依文字順序估計配對、保留兩邊未配對的段落，並提示數字、小數、否定、日期與關鍵詞差異。可選擇在該場資料夾放置 `meeting-terms.json`（非空字串陣列）增加詞表。這和工作台依時間估計的「來源與核對」互補。文字相似度不代表辨識正確率；太長的輸入會回報 `alignment_limit_exceeded`，不截掉段落來產出結果。

`report` 可在缺少錄音轉錄時使用字幕。沒有審閱 JSON 時產生 `meeting-report.draft.json`／`.md`。可複製草稿 JSON 填寫，依 [JSON 格式](meeting-minutes.schema.json) 附上每筆引文，來源段號從 1 起，對應核對 JSON 中的 `captions` 或 `recordingSegments` 陣列。再執行帶 JSON 的指令會驗證場次 ID、段號、引文是否存在以及字幕發言者名稱，產生獨立的 `meeting-report.json`／`.md`。引文存在只證明它出現在來源，審閱者仍需確認它是否支持結論。所有輸出留在該場本機資料夾。
