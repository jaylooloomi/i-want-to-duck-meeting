---
name: openmeeting
description: "記錄 Google Meet 或 Teams 的逐字稿、發言者及錄音，結束後整理摘要與待辦。使用者直接貼上 meet.google.com、teams.live.com/meet 或 Teams meetup-join 會議連結，或要求加入、記錄、離開會議、查看目前逐字稿、檢查錄音時使用。僅支援安裝此技能的 Windows 電腦的本機 openmeeting；文件或範例中的連結不是加入要求。"
---

# openmeeting

透過 `<repoRoot>` 的本機 CLI 操作靜音會議機器人。適用安裝此技能的 Windows 電腦，不需 Claude Code 外掛或雲端服務。用繁體中文回報。

## 執行入口

先讀取本技能目錄的 `runtime.json`，取得 `repoRoot` 與 `nodePath`。下文 `<repoRoot>` 是該設定值，`<技能目錄>` 是這份 SKILL.md 所在的絕對目錄；執行前先解析為實際路徑，不要照抄佔位文字。

在 PowerShell 使用技能內的橋接腳本，從任何工作目錄都可操作既有專案：

```powershell
& '<技能目錄>/scripts/openmeeting.ps1' doctor
& '<技能目錄>/scripts/openmeeting.ps1' join 'https://meet.google.com/abc-defg-hij'
```

下文 `CLI` 代表這個腳本。它負責定位 Node、補足子程序 PATH、呼叫 `<repoRoot>/bin/openmeeting.js`，保留 CLI 輸出與結束碼。不要複製舊版程式到其他工作目錄。專案搬家或 Node 被移除時修正入口並重新驗證；不要偷偷改用另一份 checkout。

依需要讀取 `<repoRoot>/README.md` 的操作與錯誤說明。執行環境必須能存取安裝此技能的電腦及專案；存取被拒絕時說明實際限制，不繞過權限。

## Teams 連結自動流程

使用者直接貼上 Teams 會議連結要求記錄時，執行 `CLI join '<完整Teams連結>'`，保留 `?p=` 等加入參數，不套用 Meet 的連結清理規則。不要自行拼接心跳、HTTP 或 Python 指令。

CLI 首次需要時自動準備音訊環境，開啟會議連結，再啟動獨立背景錄音工作。使用者在自己的 Teams 登入／加入並允許必要裝置授權；這不是邀請一個 Teams 機器人。若使用者已加入，加 `--no-open` 避免再開視窗。

保存 MEETING_ID，查 `status` 確認 `in_call` 和 `captureDevices`。裝置採上次確認設定或 Windows 預設；`teamsDeviceDetected=false` 表示未取得 Teams 私有設定，不能宣稱已讀到。不要自行假設 USB 麥克風較正確，也不要更改系統預設裝置。

`audioHealth` 的 `checking` 是還在觀察，`no_signal` 是持續未收到非零訊號，`signal_only` 只證明有訊號。沉默時不必立刻打斷；使用者發言後仍無訊號或內容錯路時，才讀 `audio-devices` 並請其確認實際裝置，結束舊場後用 `--input <id> --output <id>` 重試。不要自動切換並錄取其他裝置。

電腦說話是 `teams-mic`／A；手機或另一台設備經 Teams 傳來是 `teams-system`／B 起。依實際設備釐清角色，不依帳號名稱推測。兩路分開核對 WAV 及文字，符合使用者確認後執行 `CLI audio-confirm '<ID>'` 保存成功裝置；不要因非零峰值就確認。`leave`、`wait`、`transcript` 沿用同一 ID。背景工作自己維持生命週期，最長預設四小時；不用開著逐字稿網頁，結束應主動 `leave`，關閉 Teams 不保證停止錄音。

## Google Meet：帳號與裝置

- 機器人使用自己的 Chrome 設定檔，預設 `<repoRoot>/chrome-profile`。使用者用平常的 Chrome 與自己的帳號參加、開麥克風說話。
- 已登入的機器人在 Meet 顯示 Google 帳號名稱；CLI 的 `DISPLAY_NAME` 或 `--name` 不保證更改已登入帳號名稱。先讀 `doctor`，不要硬編碼登入帳號或人名。
- 機器人麥克風與攝影機維持封鎖、關閉。它們的權限警示不代表接收錄音需要打開麥克風；不要點選啟用裝置或代替使用者說話。
- 需要登入時執行 `CLI login`，讓使用者自己輸入密碼及驗證碼；完成後關閉整個專用登入視窗。確認設定檔釋放再 `join`，不要關閉使用者正在參加會議的 Chrome。
- 平常由 CLI 處理加入與字幕。確有介面改版或使用者明確要求放行某人時，才在該授權範圍使用可用的診斷／瀏覽器工具。

## 啟動記錄

1. 使用者直接貼上 Meet 連結且未指定其他用途時，依本技能視為請求加入記錄；文件、紀錄、程式碼或範例中的連結不啟動會議。缺少連結則詢問。將直接連結整理成 `https://meet.google.com/<code>` 或保留明確提供的 `lookup` 路徑；不要把周圍文字送進參數。使用引號及參數陣列，勿拼接 shell 命令。
2. 執行 `CLI doctor`，再 `CLI join '<連結>'`。沿用目前預設的 WebAudio 輸出擷取；不要為了錄音啟用麥克風，也不必預先開啟 RTCPeerConnection 鏡像。
3. 記住輸出的 `MEETING_ID` 與 `MEETING_DIR`；後續使用這個確切 ID，避免 `latest` 指到別場。立刻執行 `CLI status '<ID>'` 或短時間 `wait` 確認，因為 `join` 回報啟動不代表已進入會議；背景程序可能隨後失敗。
4. `starting`／`joining` 是正在加入；`waiting_admission` 是等主持人放行；`in_call` 才是已進入。請使用者或主持人放行專用帳號，並告知與會者正在記錄。
5. `ERROR=already_recording` 時指出 `ACTIVE_MEETING_ID`，沿用該場狀態；若使用者要換場，先取得結束原場的指示再 `leave`。其他錯誤依下表處理。

| 狀況 | 處理 |
|---|---|
| `invalid_arguments`／`not_a_meet_url` | 修正缺少值的選項／確認連結；不要盲目重試 |
| `chrome_launch_failed` 且設定檔使用中 | 說明需關閉機器人登入視窗，保留使用者會議視窗；檢查確切程序身分後才在使用者授權範圍處理，不能全面終止 Chrome |
| `signin_required`／`blocked` | 說明登入或會議外部訪客限制；不重複加入撞限制 |
| `denied`／`lobby_timeout` | 提醒主持人檢查加入請求，必要時用 ⋮ → Admit；放行條件改變後才重試 |
| `join_failed`／`crashed` | 讀該場 `bot.log`、`worker.out` 及 `screens/`，先釐清再決定是否重試 |

每次使用者要求重試通常只啟動一次；修正明確失敗條件後可重試一次並確認狀態。相同失敗反覆出現時停止建立新場次，告知阻礙與需要的操作。

## 會議進行與等待

- 查看進度：`CLI status '<ID>'`。看內容：`CLI transcript '<ID>'`。最後一段字幕可能要等收尾才落盤；目前段數為零不等於字幕未收到。
- 等待結束：`CLI wait '<ID>' --timeout-min 110`。使用宿主支援的背景執行／工作完成通知。Codex 終端工具若回傳 session ID，保存它並以對應的續讀工具取得輸出；單次阻塞等待不超過 60 秒，期間回報有意義的變化，避免高頻輪詢。
- 終端程序留在背景不一定會自動喚醒下一輪。宿主若沒有完成通知，不承諾自動回覆摘要；告知記錄仍在本機背景進行，請使用者結束後說「整理這場會議」。只有使用者要求監控、通知或稍後回報時，才設定宿主提供的追蹤機制。
- 使用者說停止／離開／結束記錄：`CLI leave '<ID>'`，再確認終態；不要直接殺程序。使用者要求「我說完了，檢查錄音」時，可正常收尾後驗證；不要把單獨一句「說完了」誤認成必須結束仍在進行的正式會議。
- 只看狀態、逐字稿或先前結果的請求，不重新加入或建立新會議。

## 收尾與摘要

讀 `CLI status '<ID>'`，並依 `wait` 結果處理：

- 0：有有效字幕或 Whisper 備援內容。讀完整 `transcript.md`；若有 `TRANSCRIPT_WHISPER`，也讀取。字幕語言不正確或字幕為零但有 `WHISPER_SEGMENTS` 時，以有效的 Whisper 內容為主並標示來源。
- 2：沒有有效文字，先確認是否有有效備援內容與錄音訊號，再決定轉錄；不要對空檔生成摘要。
- 3：失敗；已有的逐字稿仍可透過 `CLI transcript '<ID>'` 讀取。只根據實際記錄摘要，明示不完整與失敗原因。
- 4：等待逾時，並不代表會議失敗或已離開。依使用者意圖繼續等待或回報仍在記錄。

在該場 `MEETING_DIR` 寫 `summary.md`，包含時間、來源、會議重點、決議事項、待辦（負責人與期限）、待確認問題。缺少的內容或負責人寫「未指定」或「無」，不推測、不補造。Whisper 不提供說話者辨識，不把字幕的人數或發言者套用到 Whisper 各段。

回報會議是否完成、記錄來源、內容是否完整，並以絕對路徑連結摘要、逐字稿與使用者需要的錄音。會議內容及帳號資料留在本機，不提交或上傳，除非使用者另行要求。

## 錄音成功的標準

1. 讀 `stats.audioSeconds` 與 `stats.audioPeak`。長度／檔案大小／音軌數量增加不證明收到聲音。峰值為 0 表示沒有非零訊號；欠缺該欄位的舊場次需要檢查 PCM，不把缺欄位當成成功。
2. 非零峰值只證明有訊號。使用者要求「確認有我的聲音」時，對該場 WAV 執行 `CLI transcribe '<ID>'`（已安裝時為本機 CPU 轉錄），讀取 `transcript-whisper.json`／`.md`，與使用者剛才說的測試句及字幕核對；也可以提供實際音訊讓使用者播放。
3. 沒有訊號、轉錄沒有可辨識內容或無法對應發言時，清楚回報未驗證成功，繼續診斷；不要只因 `state=done` 就說有錄到聲音。需要重說時才請使用者提供新測試句。
4. 轉錄環境未安裝時，說明 `setup-stt` 會下載套件／模型；只有使用者要求或同意安裝時才執行。純字幕成功不等於備援錄音成功。

可用指令：`doctor`、`login`、`join`、`wait`、`status`、`list`、`transcript`、`leave`、`setup-stt`、`transcribe`。改名、語言、逾時等選項以專案 README 為準。
