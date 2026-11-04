# 郵件按鈕列覆蓋內文修正｜2026-11-04

根因：mail-actions使用sticky bottom:0，在較矮面板會浮到textarea上方。實際1280×720重現：textarea bottom=703.56，actions top=630，覆蓋約73.56px，文字框縮放角殘留在按鈕下方。

修正：改為正常文件流position:static，保留textarea內部捲軸與垂直縮放能力、面板本身捲動；按鈕後方的狀態與本機草稿說明正常顯示。修後相同視口actions top=713.56，沒有重疊。沒有修改草稿內容與儲存契約。

驗證：新增mail-footer.test.js 4案例（390/1280、明暗），檢查長正文內部捲動、按鈕在textarea之後、3操作與說明可捲至可視區、無頁面橫向溢出。原mail-draft四個編輯/儲存/複製/下載回歸通過，完整性3案例通過；共11通過，0失敗，console/pageerror共用防護通過。

證據：test/.tmp/mail-footer.log、mail-footer-regression.log、mail-footer-integrity.log；截圖test/.tmp/qa/manual/MAIL_footer_does_not_overlay_textarea_dark_1280/footer.png已人工檢視。

已同步本機安裝版前端CSS與index.html快取版本，重新整理正式站台即可。未提交推送或發布Release。此為正式UI修正；教學動畫SVG沒有修改，不影響三輪審查固定雜湊。
