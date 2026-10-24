<h1 align="center">openmeeting 🎙️</h1>

<p align="center"><b>貼上 Meet 連結，讓 AI 幫你留下會議重點。</b><br>貼上 Google Meet／Teams 連結，自動準備環境、選擇收音裝置並保存逐字稿與錄音。</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-informational" alt="0.1.0">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-blue" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Node.js-22%2B-green" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/Codex-skill-black" alt="Codex skill">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-orange" alt="Claude Code plugin">
</p>

## 可以拿來做什麼？

| 情境 | 怎麼用 | 會得到什麼 |
|---|---|---|
| Google Meet 專案會議 | 在 Codex 或 Claude Code 貼上連結要求記錄 | 靜音機器人加入、中文字幕、發言者、時間與 WAV 錄音 |
| 會議中查看內容 | `node bin/openmeeting.js live` | 本機網頁即時顯示已定稿及更新中的字幕，可切換歷史會議 |
| 現場多人討論 | 網頁選擇麥克風並開始收音 | 本機 Whisper 轉為繁體中文，以 A、B 等代號估計不同講者 |
| Teams 聲音記錄（實驗性） | 網頁選 Teams，再選播放裝置與自己的麥克風 | Windows 雙路錄音、對齊混音與分來源逐字稿 |
| 會後整理 | 對 AI 說「離開會議並整理摘要」 | 重點、決議、待辦與待確認問題 |
| 確認有錄到發言 | 檢查峰值，再轉錄或播放錄音 | 核對實際聲音內容，避免只有空白 WAV |

**目前支援 Windows 10/11 的本機使用。** Codex 以技能整合，Claude Code 以外掛整合，兩者呼叫同一份 CLI。Teams 雙路錄音已核對真人電腦端與手機端發言；逐字稿仍可能錯字、漏字及產生多餘片段，詳見[驗證範圍](docs/teams-audio-validation.md)。

## 安裝

需要 Node.js 22 以上、Google Chrome，以及可操作本機檔案與程序的 Codex 或 Claude Code。只有 Claude 整合需要 `claude` CLI。儲存庫目前為私有，下載者須有讀取權限。

### 1. 下載與統一安裝

在 PowerShell 執行：

```powershell
git clone https://github.com/jaylooloomi/open-meeting.git
cd open-meeting
npm install
npm run setup
```

`npm run setup` 自動準備 uv、Python 3.12、音訊套件與本機模型，再安裝 Codex 技能，並安裝／更新及啟用 Claude 外掛。首次需要連網下載，時間取決於網路速度。uv 缺少時從官方安裝器裝到資料目錄的 `tools/`，不修改全域 PATH。只有其中一個工具時，改用：

```powershell
npm run setup -- --target codex
npm run setup -- --target claude
```

Codex 安裝後開啟新對話，必要時重啟；Claude Code 執行 `/reload-plugins` 或重啟。`npm install` 本身只安裝依賴，不會修改 AI 工具設定。

### 2. 貼上連結開始（Teams）

在 Codex 或 Claude Code 貼上 Teams 連結並說「幫我記錄」。程式會開啟會議連結、採用已確認裝置或 Windows 預設裝置，啟動獨立背景雙路錄音。環境缺少時也會自動補裝。只在 Teams 要求時手動登入、加入或授權麥克風；若已在會議中，AI 可加 `--no-open` 避免另開視窗。

Teams 是從你這台電腦收音，不是邀請機器人加入。請在這台電腦加入會議，確認能與對方互相聽見。Windows 預設值不一定與 Teams 自訂設定相同；初次使用若發言後某路仍無聲，才需確認裝置。成功後對 AI 說「確認這兩路內容正確，記住裝置」，下次依裝置名稱、聲道與取樣率重新比對，裝置拔除則回到預設值。

錄音不需保持網頁或對話開著。結束對 AI 說「停止記錄」，程式會保存最後音訊與文字；關閉 Teams 本身不會自動停止錄音，最長預設四小時。

### 3. 準備機器人帳號（Google Meet）

```powershell
node bin/openmeeting.js doctor
node bin/openmeeting.js login
```

在專用 Chrome 視窗手動登入機器人的 Google 帳號；完成後關閉整個專用視窗，讓程式取得設定檔。使用者以自己的帳號、平常的 Chrome 參加同一場會議。機器人保持麥克風與攝影機關閉，接收會議聲音不需要啟用它的麥克風。

### 4. 在 AI 對話開始使用

**Codex**：在新的本機對話貼上會議連結並說「幫我加入並記錄」，或明確指定：

```text
$openmeeting https://meet.google.com/abc-defg-hij
```

**Claude Code**：

```text
/openmeeting:meet https://meet.google.com/abc-defg-hij
```

上面的會議代碼是範例，請換成實際連結。主持人須放行機器人；記錄前告知與會者。已登入的機器人通常顯示 Google 帳號名稱，`--name` 不保證改掉該名稱。

<details>
<summary><b>自訂位置、更新、遷移與移除</b></summary>

```powershell
npm run setup -- --dry-run
npm run setup -- --skip-audio  # 只裝整合；Teams 首次使用再自動準備
npm run setup -- --target codex --skills-dir "$HOME/.agents/skills"
# 更新後／搬移專案或 Node 後
npm run setup
# 移除 Claude 整合
claude plugin uninstall openmeeting@openmeeting-local
claude plugin marketplace remove openmeeting-local
```

Codex 預設位於 `$CODEX_HOME/skills/openmeeting`，未設定時為 `~/.codex/skills/openmeeting`。選擇一個技能目錄，避免同名技能重複安裝。移除時刪除實際安裝位置的 `openmeeting` 技能資料夾即可。

舊的手動技能需要先備份，再用 `--force` 遷移；安裝器只更新已知檔案，不刪除額外自訂檔案。技能指向本機專案，請保留專案資料夾。完整步驟見[安裝指南](docs/installation.md)。
</details>

更多原理、裝置選擇與驗證範圍見[自動音訊設定說明](docs/automatic-audio.md)。

## 日常使用

### Google Meet 記錄流程

1. 貼上實際 Meet 連結，要求加入並記錄。
2. 等 AI 回報 `waiting_admission` 後，由主持人放行機器人；`in_call` 才是已加入。
3. 使用自己的帳號開麥克風發言。機器人背景保存字幕與聲音。
4. 隨時說「查看目前逐字稿」或啟動下方即時網頁。
5. 結束時說「離開會議並整理摘要」，由 AI 根據實際逐字稿整理內容。

背景程序不保證自動喚醒 AI 對話；宿主沒有完成通知時，會後回到原對話說「整理這場會議」。摘要由 AI 整理，CLI 本身不生成摘要。

### 即時逐字稿網頁

```powershell
node bin/openmeeting.js live
# 指定場次與連接埠
node bin/openmeeting.js live <會議ID> --port 8791
```

開啟輸出的 `LIVE_URL`（預設 `http://127.0.0.1:8791`）。網頁每 750 毫秒同步，提供發言者、時間、更新中字幕、歷史場次與自動捲動。字幕活動表示最近有文字更新，並非聲紋辨識。

Ctrl+C 會停止網頁服務並收尾該服務啟動的本機麥克風／Teams 收音；另行啟動的 Meet 機器人持續記錄。

### 現場會議：本機麥克風

統一安裝已準備套件及模型。若先前使用 `--skip-audio` 或需修復，執行一個指令即可：

```powershell
node bin/openmeeting.js setup-audio
node bin/openmeeting.js live
```

在網頁選擇麥克風，按「開始收音」，允許瀏覽器使用麥克風。模型載入完成後再發言，結束按「結束記錄」，等待狀態變成「已結束」。

辨識使用 CPU、Whisper small、Silero VAD 與聲音特徵分群。講者 A／B 是該場估計代號，並非人名或持久化身分；短句、模糊或證據不足時顯示「講者未確認」。電腦速度會影響辨識延遲。

### Teams：播放聲音＋自己的麥克風

建議直接貼連結交給 AI，或執行 `node bin/openmeeting.js join "<Teams連結>"`。想手動指定裝置時也可在網頁把來源改成 **Teams**：

1. 選擇與 Teams 相同的 Windows 播放裝置。
2. 選擇自己的實體麥克風，建議戴耳機。
3. 按「開始收音」，確認兩路音量有變化，再開始會議。
4. 結束按「結束記錄」，等候剩餘辨識及檔案保存。

不需要邀請 Meet 機器人，也不依賴 Teams 字幕。WASAPI loopback 會擷取所選裝置上**所有應用程式**的播放聲音，並非只擷取 Teams。正常使用不需要虛擬音效驅動程式。

本機輸入固定為講者 A，遠端從 B 開始分群。多人共用本機麥克風都視為 A。兩路可同時辨識，但沒有房間回音消除；擴音可能重複收錄遠端聲音。背景分頁原生收音持續。網頁手動模式失去心跳超過 3 分鐘才自動收尾；CLI 背景模式由獨立工作管理，不依賴瀏覽器心跳。

更多操作與可重跑命令見[即時逐字稿與本機收音](docs/live-transcription.md)。

## 確認字幕與錄音成功

```powershell
node bin/openmeeting.js status <會議ID>
node bin/openmeeting.js transcript <會議ID>
node bin/openmeeting.js transcribe <會議ID>
```

- 有字幕：逐字稿應包含剛才說的測試句及正確的來源。
- 有聲音訊號：`stats.audioPeak` 應大於零。只有檔案大小、音軌數或 `audioSeconds` 增加不能證明收到聲音。
- 有錄到你的發言：播放 WAV，或讀取 Whisper 轉錄結果核對測試句。非零峰值只證明有訊號。
- `state=done` 表示流程完成，不代表逐字稿無錯字，也不保證特定發言有被收錄。

`transcribe` 需要先完成 `setup-stt`；自動備援只在字幕為零且本機辨識環境可用時使用。Whisper 備援不提供 Google Meet 發言者身分，不能把它當成有逐段人名的字幕。

## 如何運作

```text
Codex 技能 / Claude Code 外掛
             │
             ▼
        openmeeting CLI
             │
   ┌─────────┴──────────┐
   ▼                    ▼
Meet 專用 Chrome       本機逐字稿網頁
   │                    │
字幕 DOM + WebAudio    麥克風 / WASAPI 雙路
   │                    │
   │               VAD → 講者分群 → Whisper
   └─────────┬──────────┘
             ▼
     本機 meetings/<ID>/
  逐字稿、狀態、WAV → AI 摘要
```

Meet 預設擷取會議接收端的 WebAudio 輸出，機器人本身不開麥克風；字幕從網頁讀取並組合為穩定片段。即時網頁只監聽 `127.0.0.1`，不是遠端共用服務。

### 保存哪些檔案？

| 檔案 | 用途 |
|---|---|
| `status.json` | 狀態、錯誤、段數、錄音時間與峰值 |
| `transcript.jsonl` | 帶時間、講者與來源的逐段文字 |
| `transcript.md` | 可閱讀的逐字稿 |
| `live.json` | 尚未定稿的即時文字 |
| `audio.wav` | Meet／麥克風原始錄音，或 Teams 對齊混音 |
| `audio-microphone.wav`、`audio-system.wav` | Teams 兩路原始錄音 |
| `transcript-whisper.json`、`transcript-whisper.md` | 執行 Whisper 備援轉錄後產生 |
| `summary.md` | AI 依要求整理的摘要 |
| `bot.log`、`worker.out`、`screens/`、`capture.log` | 各模式需要的診斷記錄，不一定全部存在 |

## CLI 與設定

```powershell
node bin/openmeeting.js join https://meet.google.com/abc-defg-hij
node bin/openmeeting.js list
node bin/openmeeting.js status <會議ID>
node bin/openmeeting.js wait <會議ID> --timeout-min 110
node bin/openmeeting.js leave <會議ID>
```

用明確會議 ID 避免 `latest` 指到另一場。Meet 同時只能由機器人記錄一場；本機網頁一次只能啟動一個收音工作。

| 環境變數 | 用途 |
|---|---|
| `OPENMEETING_HOME` | 資料根目錄，含 meetings、設定檔及模型環境 |
| `CHROME_PATH` | 指定 Chrome 執行檔 |
| `OPENMEETING_PROFILE` | 指定機器人 Chrome 設定檔 |
| `OPENMEETING_CAPTION_LANG` | 字幕語言，預設 `cmn-Hant-TW` |
| `audio-settings.json`（資料根目錄） | 由 `audio-confirm <ID>` 保存已由使用者確認的成功裝置；不含會議連結或憑證 |
| `OPENMEETING_NAME` | 訪客顯示名稱設定，不保證覆蓋登入帳號名稱 |
| `OPENMEETING_MUTE=0` | 讓電腦喇叭播放 Meet 聲音 |

`status` 的 `audioHealth` 分別標示 `checking`、`no_signal` 或 `signal_only`；後者只證明訊號，不證明有發言。程式不讀取 Teams 私有設定、不自動切換到其他麥克風；若需調整，用 `audio-devices` 查裝置，結束舊場後以 `join "<Teams連結>" --input <ID> --output <ID> --no-open` 啟動。

完整參數、結束碼及進階設定見 [CLI 參考](docs/cli.md)。使用自訂資料根目錄時，本機模型與 Python 環境也須安裝至該根目錄；詳見 [STT 程式設定](src/stt.js)。

## 驗證與相容性

| 項目 | 目前狀態與範圍 |
|---|---|
| Codex 技能、Claude Code 外掛 | Windows 本機安裝；共用 CLI |
| Google Meet | 已做真人發言、字幕及錄音轉錄核對；網頁改版仍可能影響擷取 |
| 單元與模擬 Meet 整合 | 自動測試涵蓋狀態、字幕、Chrome、錄音及錯誤處理 |
| 本機麥克風 | 已知雙人錄音經 Chrome 音訊流程、真實模型與逐輪核對；[證據範圍](docs/local-microphone-validation.md) |
| Teams 雙路 | 已知語音自動驗證，以及真人電腦／手機雙路發言核對；[文字誤差與驗證範圍](docs/teams-audio-validation.md) |
| macOS、Linux、雲端純聊天 | 目前不支援完整錄音流程 |

自動測試中的已知錄音不等於所有實體房間或真人通話都通過。多人重疊、短句、背景噪音、麥克風距離與專有名詞都可能影響結果。

## FAQ

**機器人一直等候加入？** 由主持人查看加入請求並放行；組織政策、外部訪客限制或未登入帳號可能造成拒絕。不要反覆建立新機器人。

**Chrome 無法啟動？** 關閉機器人專用的登入視窗後重試；不要關閉正在參加會議的個人 Chrome，也不要讓兩個程序共用同一設定檔。先跑 `doctor`，再查看該場診斷檔。

**機器人麥克風有驚嘆號，錄音會失敗嗎？** 它的麥克風維持封鎖是正常設計；錄音接收會議聲音。是否成功應檢查峰值與錄音內容。

**有字幕但沒有聲音？** 字幕與音訊是不同流程。檢查 WAV／峰值，再看 `bot.log`；有字幕不代表 WAV 一定有效。

**講者 A／B 是誰？** 本機模式是聲音分群代號；Teams 的 A 固定代表本機輸入。Meet 字幕則使用 Google 顯示名稱。共用帳號或麥克風不能保證區分每個人。

**會議結束會自動有摘要嗎？** CLI 保存記錄；AI 要能讀取結果並繼續執行才會產生摘要。沒有背景通知時，回到對話要求整理。

**電腦可以睡眠或關機嗎？** 記錄期間要保持電腦醒著，Meet 機器人的 Chrome 也須持續開啟。

## 隱私與限制

記錄前告知與會者並遵循適用規定。錄音、逐字稿與 Google 設定檔保存在本機，不會由 openmeeting 自行上傳；Meet 字幕仍由 Google 服務產生。要求 Codex 或 Claude 摘要時，逐字稿內容會依該 AI 工具的服務及資料設定處理。

首次安裝依賴與模型需要連網。麥克風／Teams 辨識執行時強制離線載入模型。請勿分享或提交 `chrome-profile/`、`meetings/`、自訂資料根目錄或登入憑證。沒有專門保存持久化聲紋資料庫，但錄音與逐字稿本身仍是敏感資料。

Meet 組織政策與網頁改版可能影響加入或字幕擷取；選擇器集中在 `src/meet/selectors.js`。本專案不是 Google 或 Microsoft 官方服務。

## 開發與測試

```powershell
npm test
npm run test:integration
npm run test:all
.venv-stt/Scripts/python.exe -m unittest discover -s stt -p 'test*.py'
```

Node 整合測試會啟動真的 Chrome 操作本機模擬頁面，不代表連上真人 Meet。需要語音樣本或特定裝置的測試採明確 opt-in，預設會跳過；[完整語音測試指令](docs/live-transcription.md)提供設定方式。請確認測試輸出的跳過數量，不要把跳過當作已驗證。

| 路徑 | 責任 |
|---|---|
| `codex/skills/openmeeting/` | 可攜 Codex 技能、 metadata 與 PowerShell 入口 |
| `plugin/`、`.claude-plugin/` | Claude Code 技能範本與 marketplace |
| `scripts/install.js` | 統一安裝與本機路徑設定 |
| `src/session.js`、`src/meet/`、`src/captions/` | Meet 加入、擷取及字幕組合 |
| `src/live/`、`src/live-server.js` | 即時網頁與本機 HTTP API |
| `src/microphone.js`、`src/audio/` | 收音生命週期、原始音軌及混音 |
| `stt/` | Whisper、VAD、分群、WASAPI 與音訊驗證工具 |
| `test/unit/`、`test/integration/` | 單元與 Chrome／語音流程測試 |

修改後請補上可重現的測試，說明輸入、預期結果與實際驗證範圍。架構背景見[設計規格](docs/superpowers/specs/2026-10-04-openmeeting-design.md)。

README 的呈現方式參考 [i-want-to-sleep](https://github.com/jaylooloomi/i-want-to-sleep/tree/main)，依本專案功能及已驗證範圍重寫。

## 授權

[MIT](LICENSE)
