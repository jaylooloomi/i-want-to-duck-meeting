# Google Meet 自主驗證（2026-10-25）

## 後續真實雙頁測試：已收到遠端合成語音

持續驗證後，找到不用新增帳號的路徑：同一個已登入Google帳號，在同一專用Chrome的兩個頁面以「Join here too」同時加入自有測試會議。沒有複製Cookie或登入憑證，也沒有繞過訪客限制。

第一輪接收端停在UNKNOWN。實際DOM顯示Join here too按鈕含aria-hidden圖示 `add_to_queue`，collectSnapshot錯把圖示文字納入完整比對；join.js的點擊器本來就會排除它，兩者不一致。370b27c統一快照的按鈕文字語義，避免點到Switch here而踢掉發送端。121項快照／狀態回歸測試通過。

修正後使用正式 joinMeeting、prepareInCall、音訊輸出鏡像、AudioWorklet擷取、字幕observer／assembler與WavWriter，在真實Meet取得：

- 接收端實際加入，會議顯示兩個端點；接收端麥克風與鏡頭關閉。
- 原生中文字幕自動開啟，語言為 cmn-Hant-TW。
- **遠端接收錄音34.944秒、16kHz、peak31139**；接收端沒有另外注入本機音軌。
- 實際接收音檔離線Paraformer含「這是自動化會議測試我正在使用 google meet 確認代碼是1357」。後續重播段落也有錯字，不宣稱整份毫無錯字。
- 原生字幕中文句與1357有記錄，但Google Meet被誤認為Google Map／Go Go Map；英文專名的原生字幕驗收未通過，不自行替換。
- 離線驗收以「這是自動化會議測試」和「1357」為標記，結果remote-content-matched；humanSpeakerVerified=false。解碼證據以SHA-256綁定同一WAV。

原始證據位於 `test/.tmp/night-meet-dual/`：receiver-result.json、receiver-captions.json、remote-received.wav、audio-verification.json、evidence-manifest.json、evidence-result.json與summary.md，均忽略不提交。測試Chrome已收尾。

這是**同帳號雙頁、合成語音的真實服務遠端路徑驗證**，不是兩個真人、兩個獨立帳號或組織受限會議的驗收。正式CLI的登入入會另有下方獨立證據；本次雙頁腳本直接使用正式模組，尚不是單一CLI指令從建立合成發送端到最後報告的全部流程。

## 首次階段結果界線（後續結果見上方）

不是雙端真人驗證。本夜使用 Windows 內建語音合成，沒有使用先前私人錄音，也沒有要求睡眠中的使用者說話。

| 驗證 | 結果 | 證據與限制 |
|---|---|---|
| 已登入 Chrome 建立真實 Meet | 通過 | 專用測試會議成功建立，測試完成後關閉 |
| 正式已登入記錄端經 CLI／WMI 入會 | 通過入會／設定 | 20261025-012733-qjs-fary-vsa：自動入會、中文CC、最長時間正常收尾；無其他發言者，61.3秒peak0／0段文字，不算有聲錄音成功 |
| 全新未登入記錄端經正式 CLI 入會 | 未通過 | 正式 WMI worker 的 blocked 終態、截圖；不是錄音成功 |
| 調整自有測試會議存取設定後重試 | 未通過 | 當前環境仍拒絕匿名端；不繼續撞限制 |
| 正式 ensureCaptions／setCaptionLanguage | 通過（英文介面） | 真實 Meet 開啟 CC，設定 cmn-Hant-TW 回傳 true |
| 正式 caption observer／assembler | 部分通過 | 真實平台字幕含完整中文句、Google meet、1357；後續重播也有 Google meet → Google秘密 的錯字，不宣稱每次辨識精準 |
| 正式瀏覽器 capture／WAV writer | 通過本機注入路徑 | 自行建立靜音 audio.srcObject 指向合成的假麥克風，24.96秒、16kHz、peak 29882；不是遠端接收路徑 |
| 擷取後音檔離線 Paraformer 核對 | 通過測試標記 | 實際音檔辨識出 google meet 與1357，沒有 expected prompt／結果替換 |
| 獨立遠端與會者聲音接收及真人雙路 | 未驗證 | 匿名端未成功入會，沒有宣稱通過 |

## 合成語音與測試修正

測試句為「這是自動化會議測試。我正在使用 Google Meet。確認代碼是一三五七。」使用 Microsoft Hanhan Desktop。第一份 PowerShell 5.1 腳本因 UTF-8 無 BOM 造成中文內容錯誤，該次文字不算通過；改用 UTF-8 BOM、純 Speak 呼叫，先用既有 Paraformer 驗證輸入音檔，再跑真實平台。

首次主辦端是中文介面，字幕啟用成功但語言設定失敗；第二次依正式 CLI 的 `hl=en` 策略建立測試端，語言設定成功。正式 CLI 本來就使用英文介面，故未根據這一點擅改生產流程。

擷取音檔解碼摘錄（簡體為模型原始文字）：

```text
meet 确认代码是1357这是自动化会议测试我正在使用 google meet 确认代码是1357我确认代码是1357
```

## 本機原始證據

不提交錄音、帳號資料或完整畫面。位於：

- `test/.tmp/night-meet-live/`：host-captions.json、captions-raw.jsonl、synthetic-input-captured.wav、audio-verification.json 及輸入合成音檔。第一份錯誤輸入的原始字幕與第二次輸入混在 raw 診斷日誌中；正式結果以 host-captions.json 與 audio-verification.json 為準。
- `meetings/20261025-011743-ajw-honj-tkh/`：首次匿名 CLI 入會失敗。
- `meetings/20261025-011921-ajw-honj-tkh/`：修改自有測試會議條件後的匿名 CLI 重試失敗。

首次階段當時需要能被接受的登入記錄端；後續已用同帳號Join here too完成合成遠端驗證。不自動註冊帳號、不複製登入憑證、不繞過限制。這不是要求使用者手動設定字幕或音訊裝置。當前可自主完成的平台字幕／本機音訊檢查已完成，首次階段的獨立帳號／真人完整遠端入會錄音仍未完成。

官方參考：[加入會議與訪客條件](https://support.google.com/meet/answer/9303069?hl=en)、[即時字幕](https://support.google.com/meet/answer/15077804?hl=en-GB)。官方說明訪客可在符合條件與放行後加入，不代表本機這次 blocked 的確切原因已查明。

## 離線內容與證據層級檢查

```powershell
node scripts/verify-meeting-evidence.js --manifest test/.tmp/night-meet-live/evidence-manifest.json
```

這個命令只讀本機資料。manifest 指定 captionFile（JSON array）、audioTranscriptFile（含 decodedText、audioSha256）、wavFile、markers，以及 environment／captureRoute／joined／inputType 等來源宣告。程式會讀實際 WAV 計算時長、峰值及SHA-256，比對解碼檔是否綁定同一音檔，再核對文字標記。來源宣告仍須另外查證，雜湊相符本身不能證明 ASR 沒有被改寫。

本夜實際輸出：local-content-matched、captionsMatch=true、recordingMatch=true、remoteContentMatched=false、humanSpeakerVerified=false。這是刻意保留的界線，不會把自身音訊注入誤報成遠端／真人驗證。

本夜測試 Chrome 與錄音 worker 已正常收尾；沒有保留正在錄音的測試程序。

## 用正式離線入口重建辨識證據

```powershell
.venv-stt/Scripts/python.exe stt/verify_audio.py --audio test/.tmp/night-meet-dual/remote-received.wav --model-dir models --out test/.tmp/night-meet-dual/paraformer-evidence-new.json
node scripts/verify-meeting-evidence.js --manifest test/.tmp/night-meet-dual/evidence-manifest.json
```

`--out` 需選新檔名，避免蓋掉既有證據；manifest的audioTranscriptFile需對應實際產出的JSON。既有本夜manifest使用已生成的paraformer-evidence-v2.json。入口沿用既有Paraformer與OpenCC，只讀本機PCM16／16kHz單聲道WAV、不下載、不提供expected prompt。它對實際讀入的同一份bytes計算SHA，因此輸入檔在辨識中被改動也不會錯綁另一份音訊。3項單元測試與本夜實際音檔皆通過。

產生合成輸入原本已有 `scripts/make-tts-wav.ps1`，可用TextBase64安全傳入Unicode，無需新增套件或重造工具；本夜首次臨時腳本沒有沿用它而出現BOM問題，後續重跑應使用既有入口。


## 可重跑入口120秒實測

02:05–02:08執行 `node scripts/verify-meet-live.js --live --seconds 120`。主持端與接收端正常收尾，接收120.064秒PCM16，peak32657。Google原生字幕與離線Paraformer均至少包含一次完整「這是自動化會議測試。我正在使用Google Meet。確認代碼是1357。」；結果completed_synthetic_remote，humanSpeakerVerified=false。

這次比25秒場次多次重複後出現完整匹配；並非修改Google原文或提高模糊比對容許度。原生字幕仍有更高密／Google秘密等錯字，ASR也有部分重複段錯誤。因此只代表至少一次完整內容存在，不是逐句正確率100%。

音檔SHA256：`337b6f28d882e1cbab9485b7b7c5a043fc9ee3e077418f3212eb4312d39ede54`。本機證據：`test/.tmp/live-meet-host-dd61347d-ac3f-49ba-89af-93167663288d/verification.json`。僅同帳號兩頁合成測試；未驗證獨立帳號、真人或跨組織。舊25秒partial證據保留，不覆蓋。
