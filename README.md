# openmeeting

在 Claude Code 貼上 Google Meet 連結，一個**靜音**機器人就會加入會議、記錄對話文字（說話者＋時間＋內容），會議結束時自己離開，Claude 再把逐字稿和摘要呈現在對話裡。

- 機器人用你電腦上的 Google Chrome（獨立設定檔、有視窗）加入，**麥克風與鏡頭永遠關閉，不會說話**。
- 文字來源是 Meet 免費的即時字幕（預設「中文（國語，台灣）」`cmn-Hant-TW`）；同時錄下會議音訊 `audio.wav` 當備援，可用本機 Whisper 離線轉錄。
- 機器人自己偵測會議結束（會議結束、被移出、只剩自己、一直沒人加入……）並離開。
- 全部免費：不需要付費服務、API 金鑰或 Google Workspace 功能。

## 需求

- Windows 10/11（主要測試平台）
- Node.js 22 以上
- Google Chrome（已安裝；或用環境變數 `CHROME_PATH` 指定 chrome.exe）
- Claude Code CLI（`claude`）
- （選用）[uv](https://docs.astral.sh/uv/) ＋ Python 3.12：離線語音辨識備援
- （建議）一個專門給機器人用的免費 Google 帳號

## 安裝

```sh
npm install
npm run install-plugin
```

`npm run install-plugin` 會：

1. 從 `plugin/skills/meet/SKILL.md.tmpl` 產生 `SKILL.md`（寫入這個 repo 的絕對路徑）；
2. 把這個 repo 註冊成本機 marketplace `openmeeting-local`；
3. 安裝外掛 `openmeeting@openmeeting-local`（已安裝就更新）。

可以重複執行。加 `--dry-run` 只印出會執行的指令，加 `--render-only` 只產生 SKILL.md。裝好後重新啟動 Claude Code（或在工作階段中執行 `/reload-plugins`）。**搬移 repo 資料夾後要重新執行一次。**

選用但建議：

```sh
node bin/openmeeting.js login      # 讓機器人登入專用 Google 帳號（帳密由你自己在視窗中輸入）
node bin/openmeeting.js setup-stt  # 安裝離線語音辨識（faster-whisper）備援
node bin/openmeeting.js doctor     # 檢查環境
```

移除：`claude plugin uninstall openmeeting@openmeeting-local`，再 `claude plugin marketplace remove openmeeting-local`。

## 使用

在任何專案的 Claude Code 中：

```
/openmeeting:meet https://meet.google.com/abc-defg-hij
```

或直接貼上連結說「幫我參加這個會議並做記錄」。Claude 會：

1. 啟動機器人加入會議，告訴你機器人的名稱；
2. 提醒你（或主持人）放行機器人；
3. 在背景等待會議結束（期間你可以繼續用 Claude）；
4. 會議結束後讀逐字稿、寫 `summary.md`（會議重點、決議事項、待辦事項、待確認問題），並回報長度、發言者、段數與檔案路徑。

會議進行中可以說「**現在講到哪**」看目前逐字稿，或「**離開會議**」讓機器人提早離開。

第一次使用時，Claude Code 可能會詢問是否允許執行 `node` 指令、讀寫 `meetings/` 資料夾（它在目前專案之外）；允許即可。

## 你需要做的事

- **放行機器人**：主持人會看到加入請求。2026 年起 Google 可能把機器人列在「潛在風險」裡，預設按鈕是「拒絕」——請改按該請求旁的 **⋮ → 允許 (Admit)**。
- **告知與會者**：這場會議正在被記錄成逐字稿。
- 第一次使用前（建議）用 `login` 讓機器人登入專用帳號；未登入的訪客比較容易被 Google 擋下。

## 輸出

每場會議一個資料夾 `meetings/<id>/`（在 `OPENMEETING_HOME` 底下，預設為 repo 根目錄；`<id>` = `YYYYMMDD-HHmmss-<會議代碼>`）：

| 檔案 | 內容 |
|---|---|
| `transcript.md` | 逐字稿（`**[22:15:30] 王小明：** ...`） |
| `transcript.jsonl` | 每段發言一行 JSON：`t0`、`t1`、`speaker`、`text` |
| `summary.md` | Claude 寫的會議摘要 |
| `status.json` | 狀態、結束原因、統計、錯誤代碼 |
| `audio.wav` | 會議音訊（16 kHz 單聲道），字幕失敗時的備援 |
| `transcript-whisper.md` / `.json` | Whisper 離線轉錄結果（有執行時才有） |
| `bot.log`、`worker.out`、`screens/` | 除錯紀錄與截圖 |
| `worker-env.json` | Windows：交給背景機器人的 `OPENMEETING_*`、`CHROME_PATH`、`TZ` 設定（WMI 啟動時用） |

## CLI 指令

`node bin/openmeeting.js <指令>`（Claude 會自動呼叫，一般不需要手動執行）：

| 指令 | 說明 | 結束碼 |
|---|---|---|
| `join <連結> [--name 名稱] [--lang 代碼] [--foreground]` | 檢查連結、建立會議資料夾、在背景啟動機器人；印出 `LAUNCHER=`（`wmi`／`spawn`／`spawn-fallback`）、`MEETING_ID=`、`MEETING_DIR=`。已有會議在記錄時拒絕並印出 `ERROR=already_recording`、`ACTIVE_MEETING_ID=`；背景機器人沒有啟動時印出 `ERROR=crashed`（沒有 `MEETING_ID=`，原因在 stderr 與 `worker.out`） | 0 成功、1 連結無效或機器人沒啟動、5 已有會議在記錄 |
| `wait <id\|latest> [--timeout-min N]` | 等到會議結束；印出 `STATE=` 進度與 `RESULT=`、`TRANSCRIPT=`、`UTTERANCES=`、`ERROR=` | 0 有逐字稿、2 沒擷取到字幕、3 失敗、4 等待逾時 |
| `status [id\|latest]` | 印出 status.json | 0／1 找不到 |
| `list` | 列出所有會議（新到舊）：id、狀態、段數 | 0 |
| `leave [id\|latest]` | 要求機器人離開，最多等 30 秒 | 0 |
| `transcript [id\|latest]` | 印出目前的逐字稿 | 0／1 |
| `login` | 開啟機器人的 Chrome 設定檔讓你手動登入 Google，關閉視窗後結束 | 0 |
| `doctor` | 檢查 Chrome、設定檔、登入狀態、Node 版本、語音辨識環境 | 0／1 |
| `setup-stt` | 用 uv 建立 Python 3.12 環境並安裝 faster-whisper（可重複執行，會就地修復） | 0／1 |
| `transcribe <id\|latest> [--model M]` | 用 Whisper 離線轉錄 `audio.wav` | 0／1 |

失敗時的錯誤代碼：`signin_required`、`not_found`、`blocked`、`denied`、`lobby_timeout`、`chrome_not_found`、`chrome_launch_failed`、`join_failed`、`crashed`。

常用環境變數：`OPENMEETING_HOME`（資料位置）、`OPENMEETING_NAME`（機器人顯示名稱，預設「Arthur 的會議記錄」）、`OPENMEETING_CAPTION_LANG`（字幕語言，預設 `cmn-Hant-TW`）、`CHROME_PATH`、`OPENMEETING_PROFILE`（Chrome 設定檔位置）、`OPENMEETING_MUTE=0`（讓電腦喇叭播放會議聲音）。

Windows 上 `join` 預設透過 WMI（`Win32_Process.Create`）啟動背景機器人，讓它脫離 Claude Code 的程序樹與 job，Claude Code 結束背景工作時不會連帶關掉機器人；WMI 失敗時自動改用一般方式（`LAUNCHER=spawn-fallback`）。其他環境變數：`OPENMEETING_LAUNCHER=spawn`（一律用一般方式啟動）、`OPENMEETING_TRACK_MIRROR=1`（開啟 RTCPeerConnection 音軌鏡像，預設關閉）、`OPENMEETING_LANG_CHECK_MS`（會議中多久檢查一次字幕語言，預設 60 秒；被切走時最多自動切回 2 次）、`OPENMEETING_NO_AUDIO_WARN_MS`（多久沒有遠端音軌就警告一次並記錄 `stats.audioTracks=0`，預設 60 秒）。

## 限制

- **Google 2026 年起對機器人更嚴格**：無頭模式會被擋、自動化瀏覽器會被辨識；加入請求可能進入「潛在風險」佇列（預設拒絕）；未登入訪客可能被拒；組織（Workspace）會議可能不允許外部人員。
- **免費帳號的會議**若有 3 人以上（機器人也算一人），會在 60 分鐘時被 Google 結束。
- **字幕品質**取決於 Google 即時字幕：可能有錯字、專有名詞錯誤；多人同時說話可能漏字；說話者名稱就是與會者的顯示名稱；字幕語言必須和實際說的語言一致。
- **Meet 網頁改版**可能讓擷取失效。所有選擇器集中在 `src/meet/selectors.js`；出問題時看 `bot.log` 和 `screens/` 截圖。
- 一次只能記錄一場會議；只支援 Google Meet。記錄期間電腦不能睡眠，也不要關閉機器人的 Chrome 視窗。

## 隱私與同意

- 依你所在地的法律與公司規定，記錄會議前應**告知並取得與會者同意**。
- 逐字稿、音訊與機器人的 Chrome 設定檔都只存在你的電腦，openmeeting 本身不會上傳任何資料；但字幕是 Meet 在 Google 伺服器產生的，而 Claude 整理摘要時會讀取逐字稿內容（會送到 Claude）。
- 建議用專用的 Google 帳號給機器人。`chrome-profile/` 內含該帳號的登入狀態，不要分享或提交到 git。
- Claude 永遠不會替你輸入密碼或建立帳號；登入一律由你自己在視窗中完成。

## 開發

```sh
npm test                  # 單元測試
npm run test:integration  # 用本機模擬的 Meet 頁面跑真的 Chrome
```

設計規格：`docs/superpowers/specs/2026-10-04-openmeeting-design.md`。
