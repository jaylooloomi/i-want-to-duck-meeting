<h1 align="center">i-want-to-duck-meeting 🎙️</h1>

<p align="center">
  <b>你專心開會，AI 幫你留下重點。</b><br>
  貼上 Google Meet 或 Microsoft Teams 連結，記錄逐字稿與錄音。<br>
  散會後說一句「整理這場會議」，再把決議和待辦帶走。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 授權"></a>
  <img src="https://img.shields.io/badge/version-0.3.2-informational" alt="版本 0.3.2">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933" alt="Node.js 22 以上">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-D97757" alt="Claude Code 外掛">
  <img src="https://img.shields.io/badge/Codex-skill-black" alt="Codex 技能">
  <a href="README.md"><img src="https://img.shields.io/badge/lang-English-green" alt="English"></a>
  <a href="README.zh-TW.md"><img src="https://img.shields.io/badge/lang-繁體中文-brightgreen" alt="繁體中文"></a>
</p>

<p align="center"><img src="docs/images/meeting-hero-zh.png" alt="左側：參與者一邊開會一邊忙著寫筆記。右側：戴耳機的橘色章魚協助保存兩路音訊、逐字稿與待辦，讓參與者專心討論。" width="900"></p>
<p align="center"><sub>功能情境插畫，非實際介面截圖。</sub></p>

## Windows 安裝包（建議）

從 [GitHub Releases](https://github.com/jaylooloomi/i-want-to-duck-meeting/releases/latest) 下載 **DuckMeeting-0.3.2-Setup-x64.exe**，雙擊安裝，選擇 Codex／Claude Code 整合與桌面捷徑。完成後開新 Agent 對話，貼上會議連結。不需自行安裝 Git、Node.js 或 npm；Chrome、Codex／Claude Code 仍需另外安裝，Claude 整合需要 Claude CLI。

- 支援 Windows 10/11 x64；按使用者安裝至 `%LOCALAPPDATA%\Programs\DuckMeeting`，不需管理員權限。
- 會議、錄音、登入設定及模型獨立存於 `%LOCALAPPDATA%\DuckMeeting\data`，升級預設保留。原始碼版的舊資料不會自動搬移。安裝包使用本機 8792 埠，原始碼版維持 8791。
- 首次需要音訊辨識時才下載 Python／模型。也可執行「開始功能表 → Duck Meeting → Prepare speech recognition」，觀看準備進度並等完成。
- 更新：執行「Check for updates」，確認後才下載，經 SHA-256 檢查再開啟安裝精靈。私人 Repo 需要存取權；API 無法取得時改開 Releases 頁面，登入後手動下載。不內嵌或保存 GitHub Token。
- 升級：執行新版 Setup，保留資料。升級或解除安裝前須結束錄音。
- 解除安裝：Windows「設定 → 應用程式 → Duck Meeting」或開始功能表捷徑。只清除仍屬於本安裝的技能；預設保留資料，互動式移除可經第二次確認後刪除，靜默移除永遠保留資料。
- 第一版安裝包尚未購買程式碼簽章憑證，Windows 可能顯示未知發行者／SmartScreen 提示；校驗碼不等同發行者簽章。

開發者可設定官方 Inno Setup 的 `ISCC_PATH`，執行 `npm ci`、`npm run build:windows` 重建；另提供手動 GitHub Actions 打包測試流程。[測試報告與限制](docs/qa/reports/windows-installer-030.md)。

## 0.2.0 更新

新增繁中／英文／日文／韓文介面與明暗模式排版，會議小卡及返回連結依 Google Meet／Teams 顯示；重新整理設定、選單與控制項，預設「中英」。原文選單新增德／日／韓，未標註語言的舊內容仍保留。介面語言、原文顯示與翻譯語言各自獨立。

![Workspace demo — synthetic data](docs/design/release-0.2.0/zh-TW/actual.png)


## 核心功能

**一份 Windows 本機會議記錄工具，兩種 AI 入口：Codex 技能與 Claude Code 外掛。**

| 功能 | 幫你做什麼 |
|---|---|
| 🔗 **貼連結開始** | 在 AI 對話貼上 Meet／Teams 連結，由同一份本機 CLI 啟動記錄 |
| 📝 **逐字稿與發言來源** | Meet 保存字幕、姓名與時間；本機語音辨識保存文字、軌道與估計講者代號 |
| 🎙️ **錄音留存** | Meet 保存會議接收端音訊；Teams 分存電腦麥克風、會議播放聲音及對齊混音 |
| 🇹🇼 **本機中文辨識** | 麥克風與 Teams 使用 Paraformer 中文 int8、繁體字形轉換與逐字數字整理；Whisper 可做整場備援轉錄 |
| 👀 **即時查看與管理** | 啟動會議後自動開啟本機網頁面板（`http://127.0.0.1:8791`）：左側管理所有歷史會議（支援**一鍵匯出 ZIP／封存／取消封存／刪除**），右側並排顯示**會議對話逐字稿**（支援主要語言篩選與中／英／日即時雙語翻譯）與 **AI 結構化會議紀錄整理** |
| ✅ **會後智慧整理** | 散會後由所屬 Codex 對話的 Agent 親自讀取逐字稿並寫入 `summary.md`；後端由 Agent 親自整理，不以規則摘要冒充完成 |

錄音與本機辨識不需要額外的雲端語音 API 金鑰。**摘要由你使用的 AI 服務處理**，不代表整套工作流程都不上雲。

## Google Meet 自主驗證

明確執行 `node scripts/verify-meet-live.js --live --seconds 30`，可建立私人測試會議、送出當次產生的合成語音，並從同一登入context的第二個靜音頁面接收錄音。需要既有Windows／Chrome與本機Paraformer環境。[完整命令與證據界線](docs/live-google-validation.md)。

2026-10-25實跑接收到25.216秒音訊，離線Paraformer核對完整測試句、Google Meet及1357通過；Google原生字幕仍有錯字，整體標為**部分通過**。後續120.064秒場次中，兩邊至少一次完整測試句核對通過；其他重複段落仍有錯字。這是同帳號雙頁的合成遠端測試，不能當成兩位真人或跨組織驗證。字幕與錄音解碼分別核對，解碼證據綁定實際WAV雜湊；測試產物只留本機忽略目錄。

## Teams 原生字幕優先（真人驗證待完成）

貼上 Teams 連結後，背景工作開啟獨立 Chrome 設定檔，自動嘗試加入、關閉麥克風／鏡頭、開啟字幕並設定繁體中文。首次可能需要登入、授權或主持人放行；不需要手動選字幕或音訊裝置。裝置沿用上次確認設定或 Windows 預設。

平台提供的文字先寫入逐字稿；相近時間有等值文字的 Paraformer 結果會被平台字幕取代。沒有對應字幕的本機辨識仍保留，以免平台只記錄到單方。原始結果另存 `transcript-native.jsonl`、`transcript-paraformer.jsonl`，供核對與重建；措辭不同時可能同時保留兩種結果，不宣稱能完全消除重複。

用 `status <ID>` 檢查 `teamsBrowser.state`（入會／登入狀態）、`nativeCaptions`（實際收到字幕）及 `audioHealth`（音訊訊號）。原生字幕時間為接收時間，姓名未提供時保留未確認，不套用 Paraformer 講者代號。字幕與錄音各自驗證。

`--no-open` 刻意跳過專用瀏覽器，僅使用雙路音訊與 Paraformer；一般使用請省略。關閉頁面不會停止雙路錄音，請用 `leave <ID>` 收尾。專用 Teams 視窗收尾時自動關閉。

目前已通過本機受控 Chrome 測試，尚未完成新版真人 Teams 驗證。平台的私有事件格式與控制項可能改版；不可用時保留 Paraformer 備援，不把音訊啟動當作入會或字幕成功。詳見 [Teams 原生字幕說明](docs/teams-native-captions.md)。

## Google Meet 原生選帳號與登入接續

貼連結後，專用 Chrome 直接開啟 **Google 自己的「選擇帳戶」／登入頁**，不再出現自製的本機表單。請選擇帳號，或使用其他帳戶自行登入及完成驗證，保持視窗開啟即可。

程式先在 Google Meet 首頁核對已驗證身分，綁定到原會議，再於送出加入請求前核對 Meet 預備頁的實際帳號。支援 Google 帳號控制項，以及原生「切換帳戶」旁顯示的電子郵件；不同、缺失或多重身分都停止。設定檔順序、網址參數、聊天內容都不算證據。Google 未經明確選擇／登入便自動回預設帳號時，也不會直接加入。

選帳號與主持人放行後，背景程式會自動偵測並接續，無須回覆「選好了」或「已放行」。AI 主動通知取決於宿主追蹤能力，不能把程序自動接續當成聊天一定會自行喚醒。

`selecting_account` 表示等待你在 Google 原生頁操作。預設等待十分鐘（`OPENMEETING_LOGIN_TIMEOUT_MS`），`leave <ID>` 可取消。實際入會、字幕與錄音仍需分別確認。[流程與驗證](docs/meet-login-flow.md)。

2026-10-26 真人操作已確認：原生選帳號與實際身分一致、主持人放行成功，錄音約 121.7 秒；字幕與錄音轉錄都含 **1357**。「Google Meet／Arthur」仍有辨識錯字，不宣稱完整逐字通過。[實測範圍與限制](docs/meet-login-flow.md)；私人錄音、會議連結及帳號資料不提交。

## 使用情境

| 情境 | 對 AI 說 | 會留下什麼 |
|---|---|---|
| 💻 **Google Meet 專案討論** | 「這是會議連結，幫我加入並記錄」 | 字幕、發言者、時間與會議錄音 |
| 📱 **Teams 電腦＋手機通話** | 「幫我記錄這場 Teams，結束後核對兩路內容」 | 本機／遠端分軌錄音、逐字稿與混音 |
| 🪑 **現場多人會議** | 「開啟本機逐字稿，使用麥克風記錄」 | 中文逐字稿、估計講者代號與音檔 |
| 🔍 **開到一半要回顧** | 「查看這場目前的逐字稿」 | 已保存的文字與發言來源 |
| 📋 **散會後整理** | 「停止記錄，整理摘要、決議和待辦」 | AI 整理的 `summary.md`，可回查原始逐字稿 |
| 🧪 **確認真的有錄到** | 「核對剛才的測試句和確認代碼」 | 實際音軌與辨識內容核對，避免只看到檔案就誤判成功 |

## 安裝

選你用的 AI 工具，照著做三步。

**需求：** Windows 10/11 · Git · Node.js 22 以上 · Google Chrome · 可操作本機檔案和程序的 Codex 或 Claude Code。Claude Code 整合另需 `claude` CLI。私有儲存庫的使用者須先取得讀取權限。

### OpenAI Codex

**1. 複製這段，貼給本機 Codex**

```text
請幫我安裝 i-want-to-duck-meeting 的 Codex 技能：
1. 從 https://github.com/jaylooloomi/i-want-to-duck-meeting 下載專案，已有 checkout 就沿用。
2. 在專案目錄執行 npm install。
3. 執行 npm run setup -- --target codex。
4. 確認安裝成功，回報技能位置；不要把登入憑證或會議資料放進 Git。
```

**2. 開啟新的本機 Codex 對話**

安裝後讓新對話載入技能；若沒有出現，再重啟 Codex。技能需要能存取安裝它的 Windows 電腦，雲端純聊天不能直接使用這台電腦的錄音設備。

**3. 貼上實際會議連結**

```text
<你的 Google Meet 或 Teams 會議連結>
幫我記錄這場會議，需要我登入或授權時再告訴我。
```

需要明確指定技能時，使用 `$openmeeting` 加上會議連結。

### Claude Code

**1. 複製這段，貼給 Claude Code**

```text
請幫我安裝 i-want-to-duck-meeting 的 Claude Code 外掛：
1. 從 https://github.com/jaylooloomi/i-want-to-duck-meeting 下載專案，已有 checkout 就沿用。
2. 在專案目錄執行 npm install。
3. 執行 npm run setup -- --target claude。
4. 確認 openmeeting@openmeeting-local 已啟用並回報完成。
```

**2. 重新載入外掛**

在 Claude Code 執行 `/reload-plugins`，或重新啟動 Claude Code。

**3. 貼上會議連結並要求記錄**

也可以明確呼叫：

```text
/openmeeting:meet <你的 Google Meet 或 Teams 會議連結>
```

> 專案顯示名稱是 **i-want-to-duck-meeting**。為相容既有安裝，CLI、Codex 技能及 Claude 外掛的識別名稱仍是 `openmeeting`。

<details>
<summary><b>自己安裝、同時安裝兩邊、更新與移除</b></summary>

在 PowerShell 執行：

```powershell
git clone https://github.com/jaylooloomi/i-want-to-duck-meeting.git
cd i-want-to-duck-meeting
npm install
npm run setup -- --target codex
# 只裝 Claude：npm run setup -- --target claude
# 同時安裝（需要 claude CLI）：npm run setup
```

安裝器自動準備 uv、Python 3.12、音訊套件、Paraformer、VAD 與講者模型，首次需要連網下載。uv 安裝在資料根目錄 `tools/`，不改全域 PATH。`npm install` 本身只安裝依賴；`setup` 才會配置 AI 整合。

```powershell
# 先看安裝計畫
npm run setup -- --dry-run
# 只裝整合；Teams 首次記錄時再準備音訊環境
npm run setup -- --target codex --skip-audio
# 更新後／移動專案或 Node 後，重跑原安裝目標
npm run setup -- --target codex
# 移除 Claude 整合
claude plugin uninstall openmeeting@openmeeting-local
claude plugin marketplace remove openmeeting-local
```

Codex 預設安裝至 `$CODEX_HOME/skills/openmeeting`，未設定時為 `~/.codex/skills/openmeeting`。可用 `--skills-dir` 指定技能父目錄；移除時刪除實際安裝位置的技能資料夾。技能會指向這份 checkout，請保留專案目錄。

自訂位置、舊版遷移與 `--force` 的使用範圍見 [完整安裝指南](docs/installation.md)。

</details>

## 日常使用

### Google Meet：讓機器人替你記錄

1. 第一次由 AI 開啟專用 Chrome 登入頁，你手動登入記錄帳號；完成後關閉整個專用登入視窗。
2. 自己用平常的帳號參加會議；把連結貼給 AI，請它加入並記錄。
3. 主持人放行記錄帳號，AI 確認已加入後開始保存字幕與錄音。
4. 結束時說「離開會議並整理摘要」。

機器人保持麥克風與攝影機關閉，接收聲音不需要啟用它的麥克風。已登入時通常顯示 Google 帳號名稱；`--name` 不保證覆蓋該名稱。記錄前告知與會者。

### Teams：原生字幕與電腦雙路收音

1. 把**目前這場的完整加入連結**貼給 AI，保留 `?p=` 等參數。
2. 程式開啟專用 Teams Chrome，自動嘗試加入與設定字幕；必要時才請你登入、授權或請主持人放行。
3. 程式準備環境，使用已確認裝置或 Windows 預設裝置，啟動背景雙路錄音。
4. 首次使用或換設備後，讓雙方各說一句，核對兩路內容；成功設定可保存供下次比對。
5. 結束時說「停止記錄，整理這場會議」。

**專用 Teams 頁面是額外與會端；登入與主持人放行無法保證自動完成。** 原生文字由該頁面接收，錄音仍來自這台電腦的麥克風與播放裝置。若使用 `--no-open`，需要既有電腦端接收會議聲音。

播放端會包含該裝置上其他應用程式的聲音，音樂可能混進錄音。程式不讀取 Teams 私有裝置設定；Windows 預設不一定等於 Teams 自訂值，必要時仍需核對。更多細節見 [自動音訊設定](docs/automatic-audio.md)。

### 現場會議與即時逐字稿面板

執行 `node bin/openmeeting.js join "<會議連結>"` 時，系統會**自動啟動並開啟本機即時逐字稿網頁面板**（預設 `http://127.0.0.1:8791/?id=<會議ID>`）；若要手動啟動或記錄現場討論，也可直接執行：

```powershell
node bin/openmeeting.js live
```

開啟輸出的 `LIVE_URL`（預設 `http://127.0.0.1:8791`），面板提供以下完整功能：
- **左側「本機會議紀錄」清單**：集中顯示這台電腦上開過的所有會議，支援點擊切換場次、**封存／取消封存**（切換「進行與完成」與「已封存」分頁）、**一鍵打包匯出整場資訊（ZIP）**以及**安全刪除（含二次確認）**。
- **右側「會議對話 × 會議記錄整理」雙欄並排工作區**：上方控制列固定不隨滾動消失，支援「並排檢視 / 會議對話 / 會議紀錄整理」三種檢視模式切換。
- **主要語言篩選與即時雙語翻譯**：可選擇原文顯示（全部原文／中文／英文）與翻譯語言（含繁體中文、英文、日文、德文等），對話卡片下方會即時附上雙語對照。
- **會後自動結構化整理（含動態進度條）**：會議結束後自動根據逐字稿整理出四大區塊會議記錄（1. 基本資訊、2. 會議內容討論精髓、3. 行動方案負責人與期限表格、4. 結尾與附錄，無內容項目自動省略不硬寫），亦可隨時點擊「重新整理會議記錄」重新生成。

麥克風與 Teams 即時辨識使用 CPU 執行 Paraformer 中文 int8。語音短停頓容忍約 1.2 秒、連續發言約 15 秒後分段送出，避免把中英混合句切得太碎。結果顯示仍取決於 CPU 和句子長度。

Meet 字幕沿用會議提供的姓名；本機辨識的 A／B 是該場估計代號，不是姓名。Teams 本機麥克風固定為 A，遠端保守分群；不確定時標「講者未確認」。多人共用本機麥克風都算 A，遠端重疊發言仍可能誤判。

操作、分段、分群與音訊重播方式見 [即時逐字稿說明](docs/live-transcription.md)。

## 散會後

<p align="center"><img src="docs/images/meeting-review-zh.png" alt="散會後，使用者與戴耳機的章魚一起查看逐字稿、錄音、摘要與待辦，人工檢查 AI 整理的成果。" width="900"></p>
<p align="center"><sub>成果情境插畫，非實際介面截圖；摘要由 AI 對話依逐字稿整理。</sub></p>

對原本的 AI 對話說：

```text
停止記錄，整理這場會議：
- 重點與決議
- 待辦、負責人與期限
- 還沒確認的問題
請附上逐字稿和錄音位置，不確定的內容不要猜。
```

CLI 負責記錄、停止與輸出檔案；摘要由 Codex／Claude Code 讀取逐字稿後產生，**不是 CLI 自動生成**。宿主沒有背景完成通知時，會後回到原對話要求整理。

每場資料保存於本機 `meetings/<會議ID>/`：

| 檔案 | 用途 |
|---|---|
| `transcript.md`、`transcript.jsonl` | 可閱讀與結構化逐字稿，含時間、講者及來源 |
| `audio.wav` | Meet／現場錄音，或 Teams 對齊混音 |
| `audio-microphone.wav`、`audio-system.wav` | Teams 本機麥克風與會議播放兩路原始錄音 |
| `status.json`、`live.json` | 流程狀態、訊號與即時更新內容 |
| `transcript-whisper.*` | 執行 Whisper 備援轉錄後產生 |
| `summary.md` | AI 依要求整理的摘要、決議與待辦 |

背景錄音不必維持對話或逐字稿網頁開啟；**關閉 Teams 不代表停止錄音**。請明確要求停止，最長預設四小時。

## 確認字幕與錄音成功

有音檔，不等於有錄到你。

```powershell
node bin/openmeeting.js status <會議ID>
node bin/openmeeting.js transcript <會議ID>
node bin/openmeeting.js transcribe <會議ID>
```

- `audioPeak > 0` 只證明有訊號；長度增加、`signal_only` 或 `state=done` 都不能證明特定發言被收錄。
- 用實際錄音轉錄或播放核對完整句子、名稱、數字與來源；Teams 兩路分開檢查。
- `transcribe` 使用 Whisper 整場備援，需要 `setup-stt` 環境；字幕為零時，環境可用才會嘗試自動備援。它不提供 Meet 姓名辨識。

## 實測與適用範圍

| 項目 | 已驗證的內容 | 邊界 |
|---|---|---|
| Google Meet | 真人字幕、發言者及錄音內容核對 | 組織政策與網頁改版仍可能影響加入或擷取 |
| Teams 雙路 | 曾核對電腦端與手機端各自的語音 | 不代表所有裝置、回音與重疊發言都準確 |
| Paraformer 中文與英文混用 | 新手機錄音經修正後的實際即時流程重播，完整句子、Microsoft Teams、1357 通過 | 是保存錄音重播驗證；較早受干擾的錄音仍有錯字 |
| 音樂干擾 | 真人測試時曾以臨時程序監看、暫停特定音樂 | 尚無安裝後通用的自動音樂隔離功能 |
| Codex／Claude Code | Windows 本機技能／外掛，共用同一份 CLI | macOS、Linux、雲端純聊天目前不支援完整收音 |

驗證紀錄：[Meet 真人實測](docs/2026-10-24-live-meet-recording.md) · [Teams 音訊驗證](docs/teams-audio-validation.md) · [即時辨識與重播](docs/live-transcription.md) · [舊版雙人分群驗證](docs/local-microphone-validation.md)。

## 為什麼做這個？

會議最容易漏掉的，常常是那句決議、那個數字，或最後沒人記下來的待辦。

這個工具把會議聲音、文字和會後整理接在同一個 AI 對話裡。保留原始錄音與逐字稿，讓摘要有依據，也讓有疑問的內容能回頭核對。

## 如何運作

```text
Codex 技能／Claude Code 外掛
             ↓
       本機 openmeeting CLI
             ↓
  Google Meet             Teams／現場
  專用 Chrome             Windows 播放端／麥克風
  字幕＋接收端音訊         VAD → Paraformer → 講者代號
             ↓
  本機 meetings/<ID>/：逐字稿＋WAV＋狀態
             ↓
  對話中的 AI：依要求讀取逐字稿 → 摘要與待辦
```

Meet 預設擷取接收端 WebAudio，機器人不發聲。Teams 使用 WASAPI loopback 與麥克風雙路擷取。本機網頁只監聽 `127.0.0.1`，沒有提供遠端共用服務。

<details>
<summary><b>CLI、環境變數與進階設定</b></summary>

```powershell
node bin/openmeeting.js doctor
node bin/openmeeting.js login
node bin/openmeeting.js join "<實際會議連結>"
node bin/openmeeting.js list
node bin/openmeeting.js status <會議ID>
node bin/openmeeting.js leave <會議ID>
```

使用明確 ID 避免 `latest` 指到另一場。Meet 同時只能由機器人記錄一場；本機網頁一次只能啟動一個收音工作。

| 設定 | 用途 |
|---|---|
| `OPENMEETING_HOME` | 資料根目錄，含會議、音訊設定與模型 |
| `CHROME_PATH`、`OPENMEETING_PROFILE` | Chrome 執行檔與記錄帳號專用設定檔 |
| `OPENMEETING_CAPTION_LANG` | Meet 字幕語言，預設 `cmn-Hant-TW` |
| `OPENMEETING_NAME` | 訪客名稱，不保證覆蓋 Google 登入名稱 |
| `OPENMEETING_MUTE=0` | 讓喇叭播放 Meet 接收聲音 |
| `audio-settings.json` | `audio-confirm <ID>` 保存經確認的裝置名稱、聲道及取樣率 |

完整參數、停止方式與錯誤說明見 [CLI 參考](docs/cli.md)。

</details>

## 資料與隱私

錄音、逐字稿與本機辨識結果保存在你的 Windows 電腦。第一次安裝套件和模型需要網路；Paraformer 執行時只載入本機模型。要求 AI 摘要時，逐字稿可能交由你選用的 AI 服務處理，依該服務的設定與政策為準。

請在記錄前告知與會者。不要提交 `meetings/`、`chrome-profile/`、個人音訊設定或登入憑證；這些資料已有 Git 忽略規則。講者特徵留在辨識程序記憶體，沒有持久化聲紋資料庫，但錄音本身仍應妥善保管。

本專案不是 Google 或 Microsoft 官方服務。

## 本機檢視器就緒狀態與 QA

沒有會議時，檢視器會清除舊逐字稿、計數與 Meet 連結。無效會議 ID 會回到 latest 並同步網址；切換或開始會議會保留 source=teams 等其他參數。Teams 裝置載入中或缺少任一路裝置時，開始按鈕會禁用並顯示提示；連接裝置後可按「更新裝置」重試。切換來源後，過期裝置回應不會覆寫目前畫面。首次使用麥克風仍須授予瀏覽器權限。

執行 `node test/qa/run.mjs` 可跑兩輪完整離線回歸。詳見[測試矩陣](TEST_MATRIX.md)、[品質報告](TEST_SUMMARY.md)、[缺陷與驗收限制](BUG_REPORT.md)。這驗證本機行為與合成資料，不代表真人會議辨識正確率。16 個 HTTP／網路故障注入案例因 Chromium 自身資源 console error 與嚴格零 console 規則衝突而保留驗收限制，不計為通過。

## 開發與測試

```powershell
npm test
npm run test:integration
npm run test:all
.venv-stt/Scripts/python.exe -m unittest discover -s stt -p 'test_*.py'
```

需要真人音軌、公開樣本或實體裝置的測試採 opt-in，未提供時會略過；不要把略過當成通過。整合測試操作本機模擬會議頁面，也不等於已加入真人會議。

最新離線 QA 數量、覆蓋率、略過案例與驗收限制統一記錄於 [TEST_SUMMARY.md](TEST_SUMMARY.md)；上方真人／重播紀錄屬不同驗證範圍。

主要實作位於 `src/`，語音工具位於 `stt/`；Codex 技能在 `codex/skills/openmeeting/`，Claude 外掛在 `plugin/`，統一安裝入口是 `scripts/install.js`。

## 致謝與授權

README 編排與章魚插畫風格參考 [i-want-to-sleep](https://github.com/jaylooloomi/i-want-to-sleep)。本專案兩張新插畫以內建 imagegen 生成；[圖片提示詞與來源](docs/readme-assets.md)。Paraformer 模型選用參考 [SpeakSlow](https://github.com/Jeffrey0117/SpeakSlow)。

程式採 [MIT](LICENSE) 授權；第三方套件與模型依各自授權條款使用。

### 會議結束後由原 Codex 對話接手

由 Codex 啟動的會議記錄 CODEX_THREAD_ID，worker 收尾後排入 waiting_agent。/api/summarize 只建立請求，不呼叫後端摘要模型。技能在 join 後建立／沿用此對話的正式背景追蹤，輪詢 notes-pending，由 Agent 親自讀逐字稿、核對來源並寫 summary.md，再以 notes-status ready 同步網頁。沒有宿主追蹤就不能在回合結束後自己喚醒；需要電腦與 Codex 運作，輪詢不是秒級事件通知。只處理本對話明確追蹤的場次，不自動盤點所有私人歷史會議。

notes-follow <id> 可將既有會議納入本對話；notes-pending 只列本對話待接手項目。關閉機器人的會議視窗會經收尾偵測；其他人的個別視窗關閉不代表整場結束。網頁顯示等待 Agent，不用假百分比。GUI worker 會保留本機面板服務，讓散會後 Agent 寫入的紀錄仍可顯示；headless 測試仍保留原生命週期。

### 精簡版記錄面板

- 會議切換統一使用左側清單；「自動跟隨最新會議」開關控制是否跟隨新場次，手動選取會議會關閉跟隨。
- 由 Agent 加入 Google Meet／Teams 後直接顯示本場狀態，無須在網頁再按「開始收音」。
- 「＋ 新增記錄」可建立現場麥克風錄音或「電腦聲音＋麥克風」雙路錄音；裝置選擇與更新收在「裝置設定」。雙路模式包含所選播放裝置上的其他應用程式聲音，建議使用耳機。
- 目前有記錄進行時，新增入口會返回該場，避免重複啟動；收尾／轉錄尚未完成時也不會開啟新增設定。
- 「結束記錄」僅控制目前查看且仍在記錄的場次。查看歷史紀錄時，改用「返回進行中的記錄」；停止後須等待收尾／轉錄完成。
- 瀏覽器麥克風錄音需要保持原錄音分頁開啟。音量指示只代表訊號，不能當作逐字稿辨識成功的證明。
- 「逐字稿顯示」是文字顯示篩選，並非平台字幕的辨識語言設定；「翻譯語言」保留原功能。

「英中」快捷按鈕一次切換英文逐字稿顯示＋繁體中文翻譯；「中英」切換中文逐字稿顯示＋英文翻譯。這是顯示預設，不會更改 Google／Teams 的字幕辨識語言。中文顯示包含中英混合段落；篩選依 CJK 字元判定，並非完整語言分類器。字幕尚未定稿時即提供節流暫譯，段落定稿後再以完整文字校正。自動整理排程只追蹤該次指定場次，全部完成或明確失敗回報後應移除，下次開會再建立。

### Duck Meeting 會議工作台

新版網頁提供依日期分組的會議清單、會議搜尋與重新命名、來源／狀態標示、逐字稿搜尋、英中／中英快捷顯示及日文、德文等翻譯選項。預設保留「全部原文」；中英文快捷是顯示篩選，不是字幕辨識語言設定，多語會議建議保留全部原文。

已完成收尾的 PCM WAV 錄音可顯示實際取樣波形，支援播放、拖曳、切換混合／麥克風／電腦音軌（依檔案實際存在）、速度與音量。點逐字稿時間或核對差異時會切回混合錄音，依估計時間定位；錄音尚未完成時不開放播放。檔案存在不代表已驗證說話者或辨識正確性。

Agent 撰寫的 Markdown 紀錄可切換摘要／決議／待辦、複製及下載；整場 ZIP 與自訂 AI 整理包保留。紀錄沒有決議或待辦段落時明示缺少內容，不會補造，也不呼叫後端摘要模型。文字密度與播放速度偏好保存在目前瀏覽器。

「來源與核對」會在已有平台字幕與 `transcript-whisper.json` 時，以估計的會議相對時間比對，顯示措辭／分段及數字、小數差異，保留雙方原文。缺少或未對齊證據會說明；這是人工複核輔助，不代表任一來源必然正確。若沒有錄音轉錄，請先請 Agent 轉錄該場本機錄音。錄音收尾或 Agent 整理尚未完成時，不允許封存／刪除。

翻譯會將文字送至既有 Google 翻譯服務，需要網路；失敗時顯示重試訊息，字幕尚未定稿時也會送出暫譯，定稿後更新完整翻譯。新增翻譯語言不表示平台字幕或本機模型已通過該語言辨識驗收；日文、德文真人辨識品質尚待個別測試。


### 即時暫譯與設計圖對齊

即時翻譯沿用現有 Google 翻譯 HTTP 服務，不使用後端摘要模型。字幕仍在更新時就會節流翻譯，標示「暫譯 · 持續更新」，不必等會議結束。約每 1.4 秒允許送出一輪請求，另加字幕、輪詢與服務回應時間；定稿後重新校正。失敗會退避重試，切換語言／會議後的舊結果不會蓋回目前畫面，因此不保證逐字零延遲。

新版依 1586×992 設計圖對齊左側品牌、單一頂列、閱讀字級、行內語言控制、展開式搜尋、圓形播放器及負責人／期限標記。「自動跟隨最新會議」、檢視模式、自動捲動與進階整理收進「設定」；問題回報可由「說明 → 回報問題」進入。所有控制以可操作的 HTML／CSS／SVG 實作，保留鍵盤操作。標題、人名、時間與紀錄依真實會議資料顯示，不填入設計圖的示例內容。

### 標記重要話語

錄音進行中可按「★ 標記此刻重點」，保存當下時間，並在有近期字幕時附上快照；每段逐字稿旁也有星號，可標記整段。「查看重點」列出時間、發言者與當時原文，「只看重點」可快速篩選。會後可由標記跳至混合錄音的估計位置。沒有近期字幕時只保存時間，不會把舊發言當成現在的話語。

標記保存在本機 `highlights.jsonl` 事件紀錄與有效清單 `highlights.md`。取消後不再列為重點，事件歷史仍留在本機；不改寫逐字稿或錄音。尚未定稿時保存的快照會明確標示，講者名稱更新後也會盡可能依唯一時間錨點保留對應。匯出的自訂 AI 整理包與已安裝的 Agent 技能會參考有效標記、核對前後文；標記只代表關注，不等於正式決議、待辦指派或外部操作授權。事後新增標記不會自動覆寫既有會議紀錄。


### 先前版面的設計圖比對驗收

先前版面在 1586×992 固定的專案比對規則下達 **90.16%**，所有分區皆超過 80%，通過截圖的 Console／頁面錯誤為零。可查看[實際頁面截圖](docs/design/visual-audit/iteration-21/actual.png)、[計分方法與重現指令](docs/design/visual-audit/README.md)及[功能驗證報告](docs/qa/reports/visual-reference-20261030.md)。這是使用合成資料的受控 UI 驗收，不代表重新驗證了真人會議辨識品質。Inter／Roboto 字型由本機提供並附 SIL OFL 授權，原有 CSP 安全政策不放寬。


### 翡翠極簡會議工作台

已把所選設計實作成真正可操作的 HTML／CSS／SVG：三張來源狀態卡、常駐逐字稿搜尋、雙語控制、逐段星號與操作選單、精簡播放器、Agent 紀錄卡片與來源檔案核對。左側清單只顯示日期，完整日期時間留在提示文字；沒有真實頭像時使用發言者姓名縮寫。

待辦表格可勾選完成，狀態保存在獨立的 `action-items.json`，不改寫原始 Markdown、不補造負責人或期限；紀錄版本改變時會拒絕過期勾選。整場 ZIP 包含這份狀態檔。段落選單可複製原文、回聽與標記／取消重點。來源區可檢視閱讀版逐字稿並下載 TXT，或定位來源錄音。播放器可放大，按 Escape 還原；Ctrl／Cmd＋K 搜尋會議，非輸入欄位中按 Ctrl／Cmd＋F 搜尋逐字稿。

儲存資訊讀取真實會議資料夾用量與磁碟可用空間，隨場次狀態及定期更新；沒有固定容量配額。音檔依實際格式顯示 PCM WAV，不假裝 MP3；人數是已記錄發言者，不是完整出席名單，也不宣稱辨識準確率。會議整理繼續由 Agent 接手。詳見[新版功能與驗證報告](docs/qa/reports/emerald-20261030.md)；先前 90.16% 是上一張參考圖的歷史結果，不套用於這張新設計。


### 白色／暗色切換

工作台左下角的「深色／淺色」按鈕，或「設定 → 外觀風格」，可在翡翠白色與深色專業風格間切換。偏好保存在目前瀏覽器；同一本機網址的其他分頁也會同步。頁面啟動時先讀取已保存的選擇；切換不重新載入頁面、不改變目前會議，也不暫停錄音引擎或播放。瀏覽器禁止儲存時仍可切換，並提示偏好無法保存。詳見[主題驗證報告](docs/qa/reports/themes-20261030.md)。

左側會議小卡依會議連結顯示 Google Meet 或 Microsoft Teams 圖示；本機麥克風與電腦雙路錄音使用獨立圖示，也支援舊版 Meet 紀錄。圖示使用本機向量，支援明暗模式，不需外部圖片請求。

### 介面多語系

左側底部的「**介面語言**」可切換 **繁體中文、English、日本語、한국어**。按鈕、對話框、狀態提示與日期會原地更新，切換不會重新載入頁面或中斷錄音、播放。設定保存在目前瀏覽器，並同步到同一瀏覽器的工作台分頁；若儲存權限受限，本次頁面仍可切換。預設為繁體中文。

介面翻譯使用內建字典，不調用翻譯 API。「介面語言」和「原文顯示／翻譯語言」互相獨立：會議名稱、發言者、逐字稿和 Agent 整理內容保留原文；原始裝置名稱及未識別的後端／Agent 診斷訊息也保留原樣。切換介面不會更換語音辨識引擎，也不代表 Paraformer 新增日韓語辨識。日韓語會議請保留「全部原文」，並使用平台支援的字幕語言或適合的既有辨識引擎；逐字稿翻譯另外設定。

英文／日文／韓文介面採用可容納較長文字的排版：逐字稿搜尋獨立一列、語言選單彈性寬度、側欄語言設定固定分組，來源名稱與檔名分列；手機版會自動堆疊來源狀態卡片。

「原文顯示」新增德文、日文、韓文。這三種檢視依段落的 `language`／`lang` 標籤篩選；未標註語言的舊段落仍保留，畫面會提示，避免漏掉原文。不會把所有拉丁字母判定為德文，也不會藉此切換 Meet／Teams 的口說語言或辨識模型。


### 會議郵件草稿

Agent 完成會議整理後，開啟 **會議紀錄整理 → 郵件**。每次完成已授權的會議整理，Agent 預設一併依實際紀錄撰寫本機郵件主旨、內文（你明確不要時略過），不需再下指令；尚未確認的收件人可留空。頁面提供 **儲存草稿、複製郵件、下載草稿**，沒有建立信箱草稿或寄送按鈕。本機儲存不代表信件已建立或寄出。

你要求 Agent 建立或寄送信件時，Agent 透過 `node bin/openmeeting.js mail-draft <ID> --json` 讀取指定場次的 `draft.to/cc/bcc/subject/body`，再使用已連接的信箱工具處理。缺少收件人必須確認，不從發言者姓名猜測信箱；由 Agent 親自完成。

Agent 寫入時，以 UTF-8 JSON 提供 `to/cc/bcc` 陣列、`subject/body`，以及讀取所得的 `expectedRevision`（目前 revision，初次為 null）、`sourceRevision`，執行 `node bin/openmeeting.js mail-draft <ID> --file <JSON絕對路徑> --json`。有對話擁有者的場次會檢查歸屬。正式資料是 `mail-draft.json`，另存可讀的 `mail-draft.md`。版本衝突會保留編輯，請先複製再重新核對；來源紀錄變動會提示草稿需重新核對。原會議紀錄與逐字稿不會被改寫。本次未對真實信箱建立或寄送信件。

切換「郵件」時，會議紀錄的標題、工具列與頁籤位置保持一致；上方複製／下載會處理目前分頁內容。紀錄隨內容延伸，由工作區統一捲動，郵件內文採固定範圍高度並可獨立捲動，下方操作列保持靠近內文，避免長內容推走按鈕。

中、英、日、韓介面共用繁體中文版面尺寸：同視口下的側欄寬度、雙欄比例、工具列與頁籤位置一致。長標籤在固定元件內處理，不因切換語系改變整體布局。

### 決議／待辦來源與郵件內容

逐筆點「連結來源／查看原文」，可保存完整原文、時間與發言者，並定位逐字稿；有錄音及時間時可回放。來源未知或變更時不猜測。郵件頁「選擇郵件內容」可勾選決議／待辦，先預覽，再明確套用；可復原先前正文，勾選本身不會覆蓋手動文字或寄信。

**已知限制：** 整場 ZIP 匯出目前存在較大音檔的 CRC 問題。請直接保留原始 WAV，不以 ZIP 下載成功當成錄音完整；詳見 BUG_REPORT.md 的 BUG-ZIP-001。

逐字稿星標會同步顯示於錄音波形的對應時間，點擊星標即可跳至該處；取消標記後也會同步移除。需有可播放錄音，且標記時間位於錄音長度內。

會議紀錄面板採固定高度與垂直捲軸，頂部分頁保持可見；郵件勾選區展開後仍能捲到下方欄位與按鈕，內文也可獨立捲動。逐字稿搜尋會高亮顯示文字與發言者中的關鍵字，英文不分大小寫，清空搜尋後移除高亮。
