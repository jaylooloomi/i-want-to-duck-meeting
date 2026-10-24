# 明確啟用的 Google Meet 測試主持端

```powershell
node scripts/verify-meet-live-host.js --live --seconds 30
```

此命令會存取真實 Google Meet，使用工具既有的專用登入設定檔建立測試會議；不另行註冊帳號或複製登入資訊。先關閉使用該專用設定檔的記錄工作。未登入時回報 signin_required；不處理密碼或驗證碼。

輸入由既有 Windows System.Speech 腳本當次生成，是明確的合成測試句，不接受私人舊錄音。Chrome 的假媒體旗標僅限這個測試入口，不會錄取實體麥克風／鏡頭。產物在 test/.tmp/live-meet-host-<隨機ID>/，不提交。

成功輸出 HOST_READY 與私有測試連結，預設保留30秒，限制10到120秒，正常／錯誤／訊號時收尾瀏覽器。也可在該輸出目錄建立 STOP 檔案提早結束。

**本入口目前僅是主持端第一片。** completed_host_only 不代表另一個端點加入、收到遠端聲音或逐字稿成功；remoteContentMatched 固定為false。完整雙頁測試原始證據與界線見 [本夜驗證紀錄](2026-10-25-google-meet-autonomous-validation.md)。
