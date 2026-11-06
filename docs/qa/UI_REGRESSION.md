# 畫面回歸檢查

在專案根目錄執行：

```powershell
npm run test:ui:recent
npm run test:ui
```

- `test:ui:recent`：近期修正（37項），包含模板寬高、換色無閃爍、郵件勾選與按鈕、11 個視窗 X、待辦篩選對齊、教學單次播放與風格、狀態提示不蓋住錄音控制、文字對比。
- `test:ui`：上述項目（完整共184項），加上來源定位、逐字稿／會議紀錄捲動、搜尋高亮、星標、智慧跟隨、郵件編輯與保存、多語系排版及主題切換。

預設同時執行 2 個測試檔；每個檔案內案例依序執行。資源較少的電腦可執行 `npm run test:ui -- --serial`，改為依序執行。

需要 Node.js 22+、專案依賴（`npm ci`）及已安裝的 Google Chrome。使用現有 playwright-core + node:test，無需另外安裝 Playwright Test；均以 Headless Chrome 真正操作本機網頁。

每個案例自動啟動隔離站台與虛構會議，結束後關閉，不要求先啟動 8792，不讀寫正式會議，不登入外部會議或呼叫外部翻譯／模型。UI 合成資料不代表真人語音辨識驗證。

## 問題與測試對照

| 曾發生問題 | 回歸腳本 |
| --- | --- |
| X 大小、底色、線寬不一致 | recent-ui.test.js；tutorial.test.js |
| 模板下拉與按鈕大小不同、換色閃爍 | recent-ui.test.js |
| 郵件勾選區深色模式底色異常、選項與按鈕樣式 | recent-ui.test.js；mail-draft.test.js |
| 跨會議待辦欄位錯位、手機溢出 | recent-ui.test.js；followup.test.js |
| 待辦提示遮住錄音控制 | status-feedback.test.js |
| 按鈕與文字看不清楚 | control-contrast.test.js |
| 教學播放完自動重播、控制列不跟主題 | recent-ui.test.js；tutorial.test.js |
| 郵件頁底部按鈕看不到、切頁計數改變 | mail-footer.test.js；mail-draft.test.js |
| 逐字稿／會議紀錄不能捲動 | transcript-scroll.test.js |
| 決議／待辦點擊來源定位與高亮 | decision-source.test.js；source-picker.test.js |
| 待辦欄寬、來源與垂直置中 | action-columns.test.js |
| 搜尋原文／譯文高亮 | search-highlights.test.js |
| 星標狀態、工具列高度、往上閱讀被拉回底部 | highlight-toolbar.test.js；smart-follow.test.js |
| Banner 素材／選單切換、逐字稿標頭裁切、星標對應錄音位置 | banner-assets.test.js；transcript-header.test.js；highlights.test.js |
| 原文與翻譯欄寬、預設中英與英中切換 | language-presets.test.js |
| 中英日韓切換跑版 | i18n-layout.test.js；locale-geometry.test.js |

## 證據與失敗定位

一鍵指令每次輸出在獨立的 `test/.tmp/qa/ui-<UTC時間>/<案例名稱>/`，避免與上次失敗證據混在一起；同層的 `run.log` 與 `result.json` 保存完整輸出、案例數與退出碼。直接呼叫單一測試時預設輸出在 `test/.tmp/qa/manual/<案例名稱>/`，可用 `QA_OUTPUT` 指定另一個資料夾。失敗會保存 `failure.png`、`dom.html`、`failure.txt`、`console.json` 及 `trace.zip`；以 `npx playwright show-trace <trace.zip>` 開啟 trace（需自行備妥 Playwright CLI）。成功案例保存 console 與 JS coverage，部分案例另存操作截圖。

所有瀏覽器案例共用 console/pageerror guard；未捕獲錯誤或 console.error 都會失敗。測試使用使用者可見定位與狀態等待，不使用固定 sleep。近期視覺斷言包含實際矩形、樣式、重疊、狀態與操作結果，不把假畫面當成功證據。

注意：這是針對已知問題的功能／幾何／樣式回歸，不是所有像素的完整視覺比對，也不保證未涵蓋區域沒有其他問題。

## 元件一致性分支補驗

`component-consistency.test.js` 另檢查手機正文閱讀寬度、姓名換行、郵件上下操作尺寸與停用配色，避免重新退回76px窄欄。修正與前後畫面見 [元件一致性紀錄](style-consistency-after-20261105/CHANGES.md)。

`responsive-breakpoints.test.js` 新增720/721/800/928/1024/1050/1051/1280px與低高度視窗，確認側欄不會把主內容推到視窗下方；含淺深色16項。
