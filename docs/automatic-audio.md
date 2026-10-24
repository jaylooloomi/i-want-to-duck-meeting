# 安裝後貼連結：自動音訊設定與驗證

## 使用流程

1. `npm install` 後執行 `npm run setup`；只有單一 AI 工具時加 `--target codex` 或 `--target claude`。
2. 安裝器準備 uv、Python 3.12、音訊套件、Whisper small、VAD 與講者模型。uv 缺少時使用 [官方安裝器](https://docs.astral.sh/uv/getting-started/installation/)，只安裝在資料根目錄 `tools/`，不修改全域 PATH。
3. 在新 Codex 對話或已重新載入外掛的 Claude Code 貼上 Meet／Teams 連結要求記錄。
4. Meet 沿用靜音機器人流程；Teams 開啟連結並以獨立背景工作擷取本機麥克風及播放聲音。使用者在 Teams 完成必要登入、加入及裝置授權；已加入則使用 `--no-open`。
5. 結束時要求停止記錄；CLI `leave <ID>` 保存最後音訊與文字。Teams 背景錄音不依賴對話、網頁或臨時 HTTP 心跳。預設最長四小時，關閉 Teams 本身不會停止錄音。

`--skip-audio` 只安裝整合，Teams 首次使用會檢查並補裝；手動修復使用 `setup-audio`。Google Meet 的字幕記錄不強制要求模型。下載失敗會明示失敗，不把尚未備妥當成安裝完成。

## 裝置與成功設定

- 優先使用 `audio-confirm <ID>` 保存的成功設定，按名稱、聲道及取樣率重新比對，不依賴重開機後可能改變的 ID。
- 沒有有效保存設定時採 Windows 預設實體輸入與播放端；不因名稱含 USB 就猜它較正確。
- 同名裝置不唯一、已拔除或設定檔損毀時回到 Windows 預設；沒有有效預設才要求選擇裝置。
- Teams 的自訂音訊設定沒有可靠公開介面可由此流程讀取；狀態明示 `teamsDeviceDetected=false`，不宣稱已讀到 Teams 裝置，也不改動系統或 Teams 設定。
- `audioHealth` 在前 15 秒為 `checking`；之後累積峰值仍為零則 `no_signal`，非零為 `signal_only`。沉默不代表故障，非零也不代表收到正確發言；仍需內容核對。
- 電腦發言是 `teams-mic`／A，另一端經 Teams 傳來是 `teams-system`／B 起。只在使用者確認兩路內容後保存裝置。CLI 另檢查工作完成、兩路非零及兩路文字，避免保存空錄音。

必要時用 `audio-devices` 列出 ID，結束舊場，再以 `join "<連結>" --input <ID> --output <ID> --no-open` 重試。網頁手動收音仍可用，維持自己的瀏覽器斷線保護；HTTP 呼叫不能指定背景工作的資料夾、身分或繞過斷線租約。

## 2026-10-24 驗證

- 單元測試最終重跑：481 項通過、0 失敗、0 跳過。
- 完整 Node 回歸初次完成時為 552 通過、1 失敗、4 個選用語音測試跳過；唯一失敗是技能參數提示仍期待舊的 Google Meet 專用文字，更新預期後，以上全部單元測試通過。該完整回歸的 Chrome／模擬 Meet 功能整合沒有失敗。
- 真實 Windows 背景測試另以 opt-in 啟用並通過：不開會議頁、不送瀏覽器心跳，兩路擷取、到期自停、三份 WAV 標頭及大小正確；另立即執行 leave，驗證模型啟動期間停止不會重新打開裝置。
- Python 14 項通過，含本機四人 embeddings 回歸；Codex 技能格式驗證通過。
- 實際統一安裝通過，含當時 PATH 中沒有 uv 的官方 bootstrap、套件與模型準備、Codex 技能安裝及 Claude 同版本快取更新。沒有聲稱在另一台全新 Windows 上完成驗收。
- 使用先前使用者接受的真人 Teams 場次保存成功裝置；另一次背景錄音確認能自動沿用，並以 leave 正常收尾。原始音訊與會議連結仍留在忽略的本機資料目錄。

回歸另發現舊 Chrome 強制收尾時限太短：忙碌機器上 taskkill 尚未完成就被 1.5 秒時限終止。調整為最多 5 秒的終止／退出等待，保留指定程序樹範圍及有界等待，相關 Chrome 整合通過。

此輪沒有要求使用者重新說真人測試句。先前真人雙路結果與文字誤差見 [Teams 驗證紀錄](teams-audio-validation.md)。本輪選用樣本語音測試的跳過不代表再次驗證成功。

背景工作測試命令：

```powershell
$env:OPENMEETING_TEAMS_AUTO_TEST = '1'
node --test test/integration/teams-auto.test.js
```

測試記錄保存在本機 `test-auto-*.log`，不提交錄音、模型、工具執行檔或個人裝置設定。
