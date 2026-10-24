# 明確啟用的 Google Meet 測試主持端

```powershell
node scripts/verify-meet-live-host.js --live --seconds 30
```

此命令會存取真實 Google Meet，使用工具既有的專用登入設定檔建立測試會議；不另行註冊帳號或複製登入資訊。先關閉使用該專用設定檔的記錄工作。未登入時回報 signin_required；不處理密碼或驗證碼。

輸入由既有 Windows System.Speech 腳本當次生成，是明確的合成測試句，不接受私人舊錄音。Chrome 的假媒體旗標僅限這個測試入口，不會錄取實體麥克風／鏡頭。產物在 test/.tmp/live-meet-host-<隨機ID>/，不提交。

成功輸出 HOST_READY 與私有測試連結，預設保留30秒，限制10到120秒，正常／錯誤／訊號時收尾瀏覽器。也可在該輸出目錄建立 STOP 檔案提早結束。

**本入口目前僅是主持端第一片。** completed_host_only 不代表另一個端點加入、收到遠端聲音或逐字稿成功；remoteContentMatched 固定為false。完整雙頁測試原始證據與界線見 [本夜驗證紀錄](2026-10-25-google-meet-autonomous-validation.md)。

## 合成雙頁完整驗證

```powershell
node scripts/verify-meet-live.js --live --seconds 30
```

此入口在同一專用登入context建立第二個靜音頁面，使用正式入會／字幕／音訊模組，接收指定秒數，離線Paraformer解碼並核對完整合成測試句與1357。主持準備最長90秒，接收與解碼另有「指定收音秒數＋300秒」總期限；完成即關閉，不再額外保留。離線解碼子程序本身最長120秒。

輸出 verification.json、remote.wav、receiver-captions.json、recording-asr.json 與雜湊綁定的 evidence-result.json。缺字、英文名稱錯誤或字幕不符時回報partial／exit2，不修飾平台原文；發生入會或辨識環境錯誤則failed／exit1。全通過仍只代表同帳號兩頁的合成遠端測試，humanSpeakerVerified永遠false，不代表真人或跨組織會議已驗證。
