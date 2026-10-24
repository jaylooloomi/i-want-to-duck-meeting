# CLI 參考

## CLI 指令

`node bin/openmeeting.js <指令>`（Codex 或 Claude 可依使用者要求呼叫）：

| 指令 | 說明 | 結束碼 |
|---|---|---|
| `join <連結> [--name 名稱] [--lang 代碼] [--foreground]` | 檢查連結、建立會議資料夾、在背景啟動機器人；印出 `LAUNCHER=`（`wmi`／`spawn`／`spawn-fallback`）、`MEETING_ID=`、`MEETING_DIR=`。已有會議在記錄時拒絕並印出 `ERROR=already_recording`、`ACTIVE_MEETING_ID=`；背景機器人沒有啟動時印出 `ERROR=crashed`（沒有 `MEETING_ID=`，原因在 stderr 與 `worker.out`） | 0 成功、1 連結無效或機器人沒啟動、5 已有會議在記錄 |
| `wait <id\|latest> [--timeout-min N]` | 等到會議結束；印出 `STATE=` 進度與 `RESULT=`、`TRANSCRIPT=`、`UTTERANCES=`、`ERROR=`。沒有字幕但有 Whisper 備援逐字稿時，印出 `TRANSCRIPT_WHISPER=`、`WHISPER_SEGMENTS=` | 0 有字幕或 Whisper 逐字稿、2 兩者皆無內容、3 失敗、4 等待逾時 |
| `status [id\|latest]` | 印出 status.json | 0／1 找不到 |
| `list` | 列出所有會議（新到舊）：id、狀態、段數 | 0 |
| `leave [id\|latest]` | 要求機器人離開，最多等 30 秒 | 0 |
| `transcript [id\|latest]` | 印出目前的逐字稿 | 0／1 |
| `live [id\|latest] [--port 8791]` | 啟動本機即時逐字稿網頁；Ctrl+C 收尾網頁的本機收音，保留獨立 Meet 機器人 | 0／1 |
| `login` | 開啟機器人的 Chrome 設定檔讓你手動登入 Google，關閉視窗後結束 | 0 |
| `doctor` | 檢查 Chrome、設定檔、登入狀態、Node 版本、語音辨識環境 | 0／1 |
| `setup-stt` | 用 uv 建立 Python 3.12 環境並安裝 faster-whisper（可重複執行，會就地修復） | 0／1 |
| `transcribe <id\|latest> [--model M]` | 用 Whisper 離線轉錄 `audio.wav` | 0／1 |

失敗時的錯誤代碼：`signin_required`、`not_found`、`blocked`、`denied`、`lobby_timeout`、`chrome_not_found`、`chrome_launch_failed`、`join_failed`、`crashed`。

需要值的選項（例如 `--name`、`--lang`、`--timeout-min`）若沒有提供值，CLI 會印出 `ERROR=invalid_arguments` 並以結束碼 1 結束，不會啟動機器人。`UTTERANCES` 只計算字幕段數；Whisper 備援段數另以 `WHISPER_SEGMENTS` 回報。

常用環境變數：`OPENMEETING_HOME`（資料位置）、`OPENMEETING_NAME`（機器人顯示名稱，預設「Arthur 的會議記錄」）、`OPENMEETING_CAPTION_LANG`（字幕語言，預設 `cmn-Hant-TW`）、`CHROME_PATH`、`OPENMEETING_PROFILE`（Chrome 設定檔位置）、`OPENMEETING_MUTE=0`（讓電腦喇叭播放會議聲音）。

Windows 上 `join` 預設透過 WMI（`Win32_Process.Create`）啟動背景機器人，讓它脫離 Claude Code 的程序樹與 job，Claude Code 結束背景工作時不會連帶關掉機器人；WMI 失敗時自動改用一般方式（`LAUNCHER=spawn-fallback`）。其他環境變數：`OPENMEETING_LAUNCHER=spawn`（一律用一般方式啟動）、`OPENMEETING_TRACK_MIRROR=1`（開啟 RTCPeerConnection 音軌鏡像，預設關閉）、`OPENMEETING_LANG_CHECK_MS`（會議中多久檢查一次字幕語言，預設 60 秒；被切走時最多自動切回 2 次）、`OPENMEETING_NO_AUDIO_WARN_MS`（多久沒有遠端音軌就警告一次並記錄 `stats.audioTracks=0`，預設 60 秒）。

## Teams 自動入口

`join "<Teams連結>" [--no-open] [--input <裝置ID>] [--output <裝置ID>]` 保留完整加入參數，自動補齊本機環境並在獨立背景工作收音。開啟會議連結不代表已登入／加入；in_call 代表音訊擷取已啟動，不能當成 Teams 的加入證明。

- `setup-audio`：自動準備 uv、Python、套件與模型。
- `audio-devices`：列出裝置及 Windows 預設 ID。
- `audio-confirm <ID>`：僅在使用者確認兩路內容後呼叫；檢查 done、兩路非零及兩路文字後保存裝置。這不是自動聲音身分驗證。
- `status <ID>`：查看 captureDevices、deviceSelection 與 audioHealth。Teams 私有設定未被讀取，teamsDeviceDetected 固定為 false。
- `leave <ID>`：停止雙路收音並保存。關閉 Teams 不會等同 leave。

裝置 ID 只用於當次明確覆寫，保存設定以名稱、聲道及取樣率比對，不依賴會變動的 ID。符合多個裝置時不猜測，回到 Windows 預設。持續無訊號會標示 no_signal；signal_only 仍需播放或轉錄核對。
