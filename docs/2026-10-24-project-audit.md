# 專案檢查與修正紀錄

日期：2026-10-24

## 已修正問題

1. **Whisper 備援成功仍回報無逐字稿**：`wait` 原本只判斷字幕段數。現在沒有字幕、但 Whisper JSON 有有效內容且 Markdown 存在時，結束碼為 0，並回報 `WHISPER_SEGMENTS`；空白或損毀的備援不算成功。`UTTERANCES` 維持字幕段數。
2. **背景啟動失敗仍回報成功**：啟動器沒有回傳有效的正整數 PID 時，現在將會議標記為 `failed/crashed`，結束碼為 1，不再印出成功啟動用的 `MEETING_ID`。
3. **缺少參數值會吃掉下一個選項**：例如 `join abc-defg-hij --name --foreground`。現在保留下一個選項，回報 `ERROR=invalid_arguments`，在建立會議或啟動機器人前結束。
4. **損毀逐字稿被計為有效發言**：原本直接計算非空行數，現在只計算可解析且含非空文字的 JSON 紀錄，避免意外中止留下的半行資料造成成功誤判。

新增 5 項回歸測試，均先確認在修改前失敗，再確認修改後通過。同步更新 README 與 Claude Code 外掛範本的結果處理說明。

## 驗證結果

| 檢查 | 結果 |
|---|---|
| 完整單元測試，含新增回歸測試 | 450 通過，0 失敗，0 跳過 |
| 整合測試，含實際 Chrome、本機模擬 Meet、WMI / job object、Whisper | 73 項均取得通過結果，詳見下方環境說明 |
| Claude 外掛與 marketplace 官方驗證 | 通過，包含在單元測試內 |
| JavaScript 語法檢查 | 21 個產品與安裝腳本檔案通過 |
| Python 轉錄腳本語法檢查 | 通過 |
| `npm audit --omit=dev` | 0 個已知漏洞 |
| `doctor` | `DOCTOR=ok`；Node 24.13.0、Chrome、Whisper 環境可用 |
| `git diff --check` | 通過 |

整合測試首次為 69 通過、4 失敗，4 項皆為 `spawnSync powershell.exe ENOENT`。本次工具執行環境的 PATH 缺少開發工具及 Windows PowerShell，使用已安裝工具的絕對路徑並補齊測試程序 PATH 後，重跑 `chrome-launch.test.js`（7 通過）與 `stt.test.js`（1 通過），原先失敗的 4 項全部通過。未修改系統永久 PATH。

Whisper 實測使用 Windows 中文語音產生 WAV，經 `large-v3-turbo` 在 CPU 上轉錄並檢查繁體中文結果；這項測試實際執行，沒有跳過。

主要測試命令（Node 必須可從 PATH 找到）：

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js"
node --test --test-concurrency=1 "test/integration/**/*.test.js"
node --test test/integration/chrome-launch.test.js
node --test test/integration/stt.test.js
npm audit --omit=dev
node bin/openmeeting.js doctor
```

本機忽略追蹤的測試紀錄：`test-unit-final.log`、`test-integration-audit.log`、`test-chrome-audit.log`、`test-stt-audit.log`。

## 實測範圍與限制

- 已驗證模擬會議中的麥克風與攝影機關閉、逐字稿內容、音訊、字幕語言選擇與恢復、加入失敗、被移出、單人離場、停止收尾及背景程序生命週期。
- 初次檢查時尚未加入真人 Google Meet。後續已完成登入與真人錄音修正、驗證，詳見 [真人錄音驗證紀錄](2026-10-24-live-meet-recording.md)。
- 語音辨識仍可能有同音字或專有名詞錯誤；自動測試通過不代表逐字稿沒有辨識錯誤。
- 程式、測試與本紀錄納入版本控制；測試暫存資料、實際錄音與 Chrome 設定檔不納入提交。
