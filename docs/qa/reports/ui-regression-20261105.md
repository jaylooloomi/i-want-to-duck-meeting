# 畫面回歸腳本驗收（2026-11-05）

## 交付

`npm run test:ui:recent` 執行近期4個測試檔、17個案例。`npm run test:ui` 執行21個測試檔、164個案例。入口 scripts/test-ui.js 讀取 scripts/ui-suites.json，每次產生獨立證據目錄及 result.json；失敗保留截圖、DOM、trace及console錯誤。可加 --serial 降低資源用量。完整用法與已知問題對照見 docs/qa/UI_REGRESSION.md。

## 實跑紀錄

- 主套件首輪：124項，110通過、14失敗、0跳過，耗時約20分鐘（序列執行）。保留原始失敗結果，不將首輪冒稱全綠。test/.tmp/ui-full-regression-20261105.log。
- 其中12項為舊多語系測試沒有明確指定全部原文；目前預設中文會隱藏英文測資，導致等不到翻譯。改用明確 primary=all，12項重跑通過。test/.tmp/i18n-layout-current.log。
- 另2項揭露手機英文模板區多換一列的產品問題。固定窄版三列配置，縮短翻譯按鈕文案；保留跨語系高度一致檢查，增加文字不溢出斷言，淺深色2項重跑通過。test/.tmp/locale-button-fit.log。
- 補充星標／音軌標記、Banner、語言快捷與逐字稿標頭：40項通過、0失敗、0跳過。test/.tmp/ui-extra-regression-20261105.log。
- 新一鍵近期入口實跑：17項通過、0失敗、0跳過。test/.tmp/ui-recent-runner.log；獨立輸出 test/.tmp/qa/ui-2026-11-04T18-53-38-206Z/result.json。
- 教學控制文字對比追加驗證：淺深色各25個項目，最低標準4.5:1，影片保持深色，結束不循環。test/.tmp/tutorial-ui-contrast-final.log。

上述164個不同案例皆有通過證據（包含修正後的相關重跑）；沒有宣稱修正後再整批重跑164項。Chrome真實瀏覽器驗證採隔離站台與虛構資料，不讀寫正式會議、不聯絡第三人、不上傳錄音。這不是完整逐像素比對、真人錄音辨識或外部翻譯服務驗收。
