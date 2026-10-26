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

CLI 自動準備環境、啟動背景錄音並開啟專用 Teams Chrome，嘗試加入、關閉麥克風／鏡頭、啟用字幕及設定中文。使用者僅在必要時登入／授權／請主持人放行。不要求手動字幕設定。一般不要加 `--no-open`，它會跳過原生字幕瀏覽器，只保留音訊／Paraformer。

保存 MEETING_ID，讀 `status` 的 `teamsBrowser.state` 判斷登入／入會，讀 `nativeCaptions` 確認實際字幕；頂層 `in_call` 僅代表音訊程序啟動。平台字幕優先，未對應的 Paraformer 結果保留，措辭不同時可能重複；原始事件另存 transcript-native.jsonl、transcript-paraformer.jsonl。字幕時間為接收時間；未知發言者不猜姓名。

`captureDevices` 採已確認或 Windows 預設裝置，`teamsDeviceDetected=false` 表示未讀取 Teams 私有裝置設定。不得宣稱已取得，也不更改系統預設。音訊和字幕分開核對。

`audioHealth` 的 `checking` 是還在觀察，`no_signal` 是持續未收到非零訊號，`signal_only` 只證明有訊號。沉默時不必立刻打斷；使用者發言後仍無訊號或內容錯路時，才讀 `audio-devices` 並請其確認實際裝置，結束舊場後用 `--input <id> --output <id>` 重試。不要自動切換並錄取其他裝置。

電腦說話是 `teams-mic`／A；手機或另一台設備經 Teams 傳來是 `teams-system`／B 起。依實際設備釐清角色，不依帳號名稱推測。兩路分開核對 WAV 及文字，符合使用者確認後執行 `CLI audio-confirm '<ID>'` 保存成功裝置；不要因非零峰值就確認。`leave`、`wait`、`transcript` 沿用同一 ID。背景工作自己維持生命週期，最長預設四小時；不用開著逐字稿網頁，結束應主動 `leave`，關閉 Teams 不保證停止錄音。

## Google Meet：帳號與裝置

- 機器人使用自己的 Chrome 設定檔，預設 `<repoRoot>/chrome-profile`。使用者用平常的 Chrome 與自己的帳號參加、開麥克風說話。
- 已登入的機器人在 Meet 顯示 Google 帳號名稱；CLI 的 `DISPLAY_NAME` 或 `--name` 不保證更改已登入帳號名稱。先讀 `doctor`，不要硬編碼登入帳號或人名。
- 機器人麥克風與攝影機維持封鎖、關閉。它們的權限警示不代表接收錄音需要打開麥克風；不要點選啟用裝置或代替使用者說話。
- join 需要登入時會進入 waiting_login；使用者在同一專用視窗自行登入並保持視窗開啟，程式自動接續。不碰日常 Chrome。只有單獨準備／切換帳號時才用 CLI login。
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

## Google Meet 登入接續

貼連結後直接 join，不必預先 login。需要登入時同一背景工作進入 waiting_login，專用 Chrome 會開啟 Google 登入頁；請使用者自行完成密碼／驗證，保持視窗開啟，登入後經 Google Meet 首頁核對身分，再接續同一會議 ID，不要另執行 login 或重複 join。等待預設十分鐘，OPENMEETING_LOGIN_TIMEOUT_MS 可調整；leave 可取消。逾時、關閉視窗或返回後仍要求登入會明確失敗，不重複撞登入限制。

GOOGLE_ACCOUNT_HINT 與 status.auth.accountHint 只是專用設定檔帳號資料，identityVerified=false，不保證 Cookie 有效或目前登入身分；顯示給使用者時明確稱「帳號提示」。已登入會沿用專用設定檔，實際與會名稱由 Google 決定，不宣稱 --name 能改已登入帳號姓名。若使用者指定換帳號，先結束既有記錄，再於下一次 join 的 Google 原生頁選擇其他帳戶；不登出日常 Chrome。

獨立 login 指令仍需關閉該視窗才結束，與 join 內自動接續流程不同。signin_required 現在代表登入等待逾時／取消關窗／接續後仍被要求登入等終態，先看該場錯誤再決定下一步。

## Google 原生選帳號與入會前核對（目前流程）

每次 Google Meet join 都直接開 Google 原生「選擇帳戶」／登入頁，不再提供自製本機選帳號頁。使用者自己點原生帳號或選「使用其他帳戶」登入；維持專用視窗開啟，不需要另執行 login 或先關窗。程式只觀察原生選擇動作，不讀取登入欄位值、密碼或驗證碼。

選擇完成先返回 Google Meet 的非會議首頁，核對 Google 顯示的實際電子郵件與原生選擇是否一致，再將帳號綁定到原會議 URL。若 Google 未經明確選擇就自動回預設帳號，不繼續加入。

入會按鈕點擊前再次核對 Meet 的可見身分：Google 帳號控制項，或原生「切換帳戶」連結旁的目前電子郵件。不能用 profile 陣列順序、網址 authuser、聊天或參與者姓名推測。不同、缺失、多重身分時停止；auth.identityVerified=true 才表示核對成功，仍需另看 in_call 與錄音／字幕。

selecting_account 是等待使用者在 Google 頁面操作，不是等待另一個本機表單。登入／選擇可用 leave 取消；逾時、關窗或無法驗證時明確失敗，不重複撞限制或跳過核對。

## 選帳號與放行的自動接續

join 的背景程序會自動觀察原生選帳號結果與主持人放行，不要把聊天回覆「選好了」「已放行」當成繼續條件。等待時保持本回合觀察狀態，入會且字幕準備後再請使用者說測試句；只在登入／驗證／主持人操作或錯誤需要人介入時提示必要動作。

不要把背景程序能自動接續等同於 AI 宿主能在回合結束後主動喚醒。使用者要求離開對話仍持續通知時，使用宿主正式背景追蹤能力並明示限制，不虛構已建立監控。

## 雙來源核對與固定格式會議紀錄

使用者要求整理 Google Meet 時，正常收尾後若本機 ASR 已安裝且錄音有訊號，執行 `CLI transcribe '<ID>'`；本場轉錄已存在可沿用。再執行 `CLI crosscheck '<ID>'` 與 `CLI report '<ID>'`。不自動為此安裝或下載模型，缺來源時明示限制。

讀取 transcript-crosscheck.md/json、原始 CC、錄音轉錄與 meeting-report.draft.json。段落以文字順序估計配對，可一對多或多對一，並非聲學時間對齊；相似度不是正確率。數字、否定詞、日期／期限、英文名稱、責任與決議差異優先核對。可在本場 meeting-terms.json 放字串陣列，標出特定人名／術語差異；它只用來檢查，不注入 ASR 答案。

另存 transcript-reviewed.md，標示來源、修訂理由與未確認詞，不覆寫原檔。重要差異需必要時回聽；若僅比對兩份文字，必須明示未回聽，不能當作已確認。錄音 ASR 沒有身分辨識，不直接歸給 CC 發言者；CC 時間為接收時間。

依草稿填寫 reviewed-minutes.json（欄位見專案 docs/meeting-minutes.schema.json），執行 `CLI report '<ID>' '<本場reviewed-minutes.json完整路徑>'`，產生 meeting-report.md/json。每個摘要、議題、決議、提案、待辦、風險、問題或追蹤項需附 evidence，source 為 captions 或 recording、recordId 為該來源從 1 起的原始段號、quote 必須是原文子字串。不要引用對齊區塊號當 recordId。引用存在不代表結論正確；分開提案與已確認決議，待辦缺負責人／期限／完成條件用 null。參與者姓名只能依 CC 明確標記，不從聲音推定。

報告固定含基本資料、參與者、重點摘要、議題、決議、提案／未決事項、待辦（負責人／期限／完成條件）、風險、待確認問題、下次追蹤、記錄品質與附件。空草稿是待審閱，不代表無討論。未解決的重要差異保留，不因輸出報告就自動解除。summary.md 如需維持舊入口，使用核對後的精簡摘要並連結 meeting-report.md。

## 專用瀏覽器頁內面板

join 自動注入 meeting AI 面板，只出現在專用 Meet／Teams 會議頁，不在 Google 登入頁、不安裝日常 Chrome 擴充功能。面板顯示開始／結束、錄音訊號狀態與即時逐字稿；Google Meet 支援暫停及恢復，Teams 維持自動雙路記錄，不提供暫停。預設仍入會自動記錄；OPENMEETING_MANUAL_START=1 僅對 Google Meet 延後保存直到按開始。

使用者在面板按結束後，背景工作自行離會、離線轉錄（已有模型及非零音訊時）、產生對齊核對／固定草稿／本機原話摘錄，並開啟獨立專用結果視窗。此按鈕不會終止所有人的會議，也不會啟用麥克風。面板暫停不保存新字幕，錄音寫靜音維持時間軸；Google CC 的晚到修訂與恢復邊界不是聲學切點，不能保證精確逐字分界。

status.panelReport 的 processing／draft_ready／partial／failed 與頂層 done 分開看。meeting-report.auto.md 是原話摘錄，不是 LLM 總結；正式摘要、決議、待辦仍由本技能依前節做證據審閱。結果頁不等於喚醒 AI 新回合；不虛構已自動驗真或主動通知。面板輪詢約 1 秒，錄音統計最長約 5 秒更新。
