# 即時逐字稿與本機收音

### 即時逐字稿網頁

執行 `node bin/openmeeting.js live`，開啟輸出的 `LIVE_URL`（預設 `http://127.0.0.1:8791`）。
網頁每 750 毫秒自動同步，顯示發言者、時間、已定稿文字與「字幕更新中」的內容，支援切換歷史會議及自動捲動。
預設自動跟隨最新會議；也可用 `live <會議ID> --port 8791` 指定場次或連接埠。Ctrl+C 停止網頁服務並收尾該服務啟動的本機收音；另行啟動的 Meet 機器人持續記錄。
網頁只在本機提供服務。字幕活動表示最近有字幕文字更新，不是聲紋辨識；共用一個 Meet 帳號／麥克風仍顯示同一個名字。
舊版機器人已啟動的場次只能顯示已定稿內容；更新後新啟動的場次才會提供更新中的字幕。

### 本機麥克風即時轉文字與講者區分

在上述網頁選擇麥克風，按「開始收音」並允許麥克風權限；模型載入後開始記錄。
音量條顯示收音訊號。按「結束記錄」會停止麥克風、送出最後一小段音訊，再等待本機辨識收尾。
關閉／重新整理網頁也會停止；連線中斷超過 15 秒時伺服器會自動收尾。CLI `leave <id>` 同樣可以停止。
請使用 Chrome／Edge 等支援 AudioWorklet 的瀏覽器開啟本機網址，電腦保持喚醒。

處理流程：瀏覽器麥克風 → PCM16 / 16 kHz → 本機 Silero VAD → 3D-Speaker CAM++ 聲音特徵分群 → faster-whisper small（CPU int8）→ 本機逐字稿。
文字辨識使用整段語音，講者依詞級時間戳對應；「未確認 → 已確認」的切換不會切碎語音送去辨識。
在停頓或約 6 秒長度後送出辨識工作；文字不是逐字立即顯示，延遲取決於 CPU 和發言長度。
同一段內以約 2 秒視窗估計講者變化；代號每場重新由「講者 A」開始，不跨場識別身分。
少於 1.5 秒、與多個講者相近、或相似度處於模糊區間時標成「講者未確認」，不因此建立新代號或更新已確認的聲音特徵。
新講者至少需要兩個互不重疊、各至少 1.5 秒且聲音特徵一致的片段；兩次證據間隔超過 10 秒就重新累積。
第一段不確定文字會保留「講者未確認」，確認後的新片段才使用代號，不猜測回填舊片段。
代號依確認順序分配。相似度是模型的估計值，不是正確率；重疊發言尚不支援，仍可能漏字、錯分或把同一人拆成多個講者。
目前沒有自動對應 Meet 姓名；Teams 雙路音訊擷取見下節。

統一安裝已準備環境；需修復或曾略過下載時執行（只有套件和模型下載需要網路）：

```powershell
node bin/openmeeting.js setup-audio
node bin/openmeeting.js live
```

實際辨識強制離線載入模型，不使用瀏覽器雲端語音辨識 API。錄音 `audio.wav`、`transcript.jsonl`、`transcript.md`、即時暫存與診斷檔均保存在該場 `meetings/<id>/`，不外傳。
聲音特徵分群只留在辨識程序記憶體，結束後釋放，沒有持久化的聲紋資料庫。
模型與 API 用法來源：[Sherpa speaker identification](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html)、[官方麥克風與 VAD 範例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/speaker-identification-with-vad.py)、[模型檔案](https://huggingface.co/csukuangfj/speaker-embedding-models/tree/0743f30)。

#### 可重跑的雙人瀏覽器驗證

測試使用公開四人中文樣本中的兩段已知不同人的語音，透過 Chrome 的虛擬麥克風跑實際收音、AudioWorklet、HTTP、VAD、講者分群、Whisper 與網頁更新，沒有替換辨識結果。
包含六輪發言、45% 音量、輕微背景雜音、0.7 秒短句與同一人再次發言。
驗證器以實際錄到的波形對齊參考時間表，檢查每一輪的講者，不只計算代號數量。
這是可控制的錄音輸入測試，不能代表所有實體麥克風、房間混響與重疊發言的效果。

```powershell
# 本機已有公開樣本時（請自行指定路徑；測試本身不下載）
.venv-stt/Scripts/python.exe stt/build_speaker_validation.py --source test/.tmp/microphone-validation/four-speakers.wav --output test/.tmp/microphone-validation/two-person.wav
$env:OPENMEETING_MIC_BROWSER_WAV = 'test/.tmp/microphone-validation/two-person.wav'
node --test test/integration/microphone-browser.test.js
```

結果與逐輪核對保存在 `test/.tmp/microphone-browser/verification.json`，畫面為同資料夾的 `result.png`。

### Teams：會議聲音＋自己的麥克風

在同一個逐字稿頁面把「會議來源」改成「Teams」，選擇與 Teams 相同的播放裝置和自己的麥克風，再按「開始收音」。
不需要邀請機器人或開啟 Teams 字幕，適用從所選 Windows 裝置播放聲音的 Teams 桌面版／網頁版。
使用 Windows WASAPI loopback 擷取播放端，另一條 WASAPI 輸入擷取麥克風；兩路都在本機辨識，不經外部轉錄 API。
網頁顯示兩路獨立音量。實體麥克風與裝置清單標示的「虛擬音訊輸入」都可選；正常使用時應選自己的實體麥克風。

- 本機麥克風固定為講者 A，遠端聲音使用保守分群，由講者 B、C 開始；不確定時保留「講者未確認」。
- 兩路各自做語音偵測與辨識，能保留本機與遠端同時說話的內容。遠端多人彼此重疊仍可能誤判；多人共用本機麥克風都視為 A。
- 播放端擷取的是該裝置的全部應用程式聲音。Teams 必須使用所選播放裝置；其他程式同裝置播放的聲音也會被錄到。
- 使用耳機可避免喇叭聲進入麥克風；本版沒有實體房間的回音消除，擴音會議可能重複收錄遠端聲音。
- `audio-microphone.wav` 與 `audio-system.wav` 分別保存原始兩路；`audio.wav` 是對齊的混音，各路以一半音量相加避免重疊爆音。
- `transcript.jsonl` 的 `source` 分別為 `teams-mic`／`teams-system`，可逐段核對來源。`status.json` 保存選定裝置、每路長度／峰值與當前音量。
- 網頁在背景時原生收音持續進行；關閉／重新整理會送出停止要求。若瀏覽器異常中斷，Teams 模式於 3 分鐘沒有連線心跳後收尾。
- 停止或裝置中斷會保存最後片段並釋放兩個裝置。若裝置不支援所選組合，會顯示啟動失敗，不會假裝正在收音。

套件：`stt/requirements-live.txt` 的 Windows 專用 PyAudioWPatch；不需要安裝虛擬音效驅動程式即可正常擷取實體麥克風與播放裝置。
自動驗證另使用這台電腦既有的虛擬播放端，避免依賴使用者現場發言。

```powershell
# 使用本機已備妥的公開真人語音樣本產生兩路測試，包含刻意重疊發言
.venv-stt/Scripts/python.exe stt/build_teams_validation.py --source test/.tmp/microphone-validation/four-speakers.wav --output-dir test/.tmp/teams-fixture
$env:OPENMEETING_TEAMS_NATIVE_TEST = '1'
# 裝置 index 依電腦而異；這台測試用 25/24 擷取、19/18 播放，不變更 Windows 預設裝置
$env:OPENMEETING_TEAMS_MIC = '25'
$env:OPENMEETING_TEAMS_LOOPBACK = '24'
$env:OPENMEETING_TEAMS_MIC_PLAYBACK = '19'
$env:OPENMEETING_TEAMS_REMOTE_PLAYBACK = '18'
node --test test/integration/teams-browser.test.js
```

錄音、逐字稿與測試畫面保存在 `test/.tmp/teams-validation/`。測試檢查實際 WASAPI 兩路訊號、兩路各自的已知語句、重複發言代號、同時說話與混音時間長度，不使用假的辨識 API。


## 驗證紀錄

- [本機雙人驗證](local-microphone-validation.md)
- [Teams 雙路驗證與真人驗收狀態](teams-audio-validation.md)

## Teams 連結自動模式

直接交給 Codex／Claude 會議連結，或執行 `node bin/openmeeting.js join "<完整Teams連結>"`。已加入會議時加 `--no-open`。程式自動準備環境、採用已確認設定或 Windows 預設，啟動獨立背景收音，不依賴此網頁的心跳。

兩路內容經使用者確認後執行 `node bin/openmeeting.js audio-confirm <ID>`，會以裝置名稱、聲道及取樣率保存於資料根目錄。拔除或重編號會重新比對；無有效裝置才要求處理。`audio-devices` 列出當前 ID，必要時可用 `--input`／`--output` 指定重試。

`status` 的 audioHealth／網頁提醒會標示持續零訊號；非零不能取代內容確認。背景模式的 in_call 只代表開始擷取，並非已登入 Teams 的證明。離開 Teams 不會自動停止錄音；說「停止記錄」或執行 leave，最長預設四小時。

驗證背景生命週期（使用本機實體預設裝置、沒有加入真人會議，不播放樣本）：

```powershell
$env:OPENMEETING_TEAMS_AUTO_TEST = '1'
node --test test/integration/teams-auto.test.js
```
