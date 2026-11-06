# 淺深色控制元件與文字可讀性

## 原因與修正
全域button:disabled使用0.45/0.5透明度，連文字一起淡化；部分深色欄位標籤沿用淺色字色，淺色摘要／表格小字也偏淡。新增共享色彩變數：停用狀態改以灰底、灰字、邊框區分，保留原本disabled行為；啟用主要操作採用更深的綠／藍底白字。補齊未選分頁、語言快捷鍵、翻譯與摘要表格、來源、側欄資訊及表單標籤。鍵盤焦點使用明確外框。不修改業務邏輯或錄音資料。

## 驗證
- audit-controls.mjs：工作台、郵件、待確認、待辦、進階設定、原文來源、使用說明、新增記錄、跨會議待辦，light/dark共18畫面。
- 掃描2058筆可見文字／控制元件樣本（含畫面重複），依瀏覽器計算色彩、背景與透明度估算對比；未發現低於4.5:1的樣本。這不是完整WCAG認證；僅適用本次覆蓋狀態。
- control-contrast.test.js：390/1440 × light/dark，停用／啟用／選取／hover／focus、郵件按鈕與進階設定。4通過，確認停用按鈕仍不能操作、修改模板才可儲存。
- 主題／後續追蹤／郵件捲軸回歸另行執行，原始紀錄test/.tmp/contrast-final-regression.log。
- 已人工看淺深色工作台與郵件截圖；所有瀏覽器測試使用虛構資料及共用零Console/PageError檢查。

## 重現
node test/qa/audit-controls.mjs
node --test --test-concurrency=1 test/qa/control-contrast.test.js test/qa/theme.test.js test/qa/followup.test.js test/qa/mail-footer.test.js

證據：test/.tmp/control-contrast/audit.json、low-contrast.json與18張PNG；test/.tmp/qa/manual/CONTRAST_*。
# 儲存模板按鈕樣式補驗

依網站風格將模板選單與儲存按鈕統一為 34px 高、細框圓角與垂直置中，加入既有線條風格的 SVG 儲存圖示。可操作時沿用網站淺綠／深藍主色，停用時採接近面板的淡底細框；儲存邏輯未更動。

`node --test --test-concurrency=1 test/qa/control-contrast.test.js`：390/1440、淺深色共 4 項通過，涵蓋停用、啟用、hover、鍵盤焦點及無水平溢出，無 Console/Page Error。`test/qa/integrity.test.js` 3 項通過。已同步目前本機 8792 站台的 HTML/CSS，未重啟或停止會議程序；重新整理可載入。
