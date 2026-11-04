# 會議模板與後續追蹤驗收

## 實作
每場summary-plan.json保存模板；notes-plan與notes-pending、匯出提示帶入一致規格。未確認事項與風險獨立檢視。跨會議總表重用每場action-items.json完成狀態，來源逐字核對，同名不同場不合併。待辦寫入以原子替換與鎖檔避免互相覆蓋；版本不符拒絕。

## 驗證
- 單元＋既有紀錄整合回歸：549通過，0失敗、0跳過（test/.tmp/followup-regression.log）。
- 真實CLI notes-plan：1通過。
- 新功能瀏覽器：7通過；重複執行7通過，0瀏覽器錯誤。
- 相關Agent交接＋郵件編輯器＋新功能瀏覽器回歸：12通過。
- 測試覆蓋模板保存、未改寫舊摘要、衝突／生成中／CSRF／錯誤重試、來源定位、跨場同名任務隔離、完成狀態重載、封存／逾期／未知日期、空清單與390/1440淺深色。

CLI：node --test test/unit/summary-plan.test.js test/unit/open-issues.test.js test/unit/task-board.test.js test/integration/followup-cli.test.js

Browser：node --test --test-concurrency=1 test/qa/followup.test.js

## 範圍
合成與虛構來源的本機驗證，沒有聯絡第三人或上傳私人錄音；未額外驗收真人會議或第三方郵件。Agent語意整理需有有效來源及運行中的已授權對話；模板本身不啟動模型，不會自動重整歷史會議。未指定負責人／期限保持未指定，未列風險不表示無風險。

## 本機套用

已同步至本機8792站台；唯讀驗證可開待辦總表、模板與待確認頁籤，無Console/PageError。未用真人歷史會議做寫入測試。Codex技能及Claude Code外掛以既有統一安裝流程更新；已開啟的Claude工作階段需reload或重啟才能讀取新指引。此次來源碼提交涵蓋上述功能；Windows安裝包不在本次重新發布。

## 提交前檢查

獨立唯讀檢查確認模組、路由、CLI、Agent傳遞與打包接線完整。統一匯出提示的新舊缺漏規則：模板固定段落保留，缺資料標示未提及；非必要細項可省略，不能推定沒有風險。新增提示一致性斷言並重跑相關單元/API檢查。
