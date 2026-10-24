# Google Meet 自主驗證（2026-10-25）

## 結果界線

不是雙端真人驗證。本夜使用 Windows 內建語音合成，沒有使用先前私人錄音，也沒有要求睡眠中的使用者說話。

| 驗證 | 結果 | 證據與限制 |
|---|---|---|
| 已登入 Chrome 建立真實 Meet | 通過 | 專用測試會議成功建立，測試完成後關閉 |
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

下一步驗證需要一個能被會議接受的獨立登入記錄端；不自動註冊帳號、不複製登入憑證、不繞過限制。這不是要求使用者手動設定字幕或音訊裝置。當前可自主完成的平台字幕／本機音訊檢查已完成，完整遠端入會錄音仍列未完成。

官方參考：[加入會議與訪客條件](https://support.google.com/meet/answer/9303069?hl=en)、[即時字幕](https://support.google.com/meet/answer/15077804?hl=en-GB)。官方說明訪客可在符合條件與放行後加入，不代表本機這次 blocked 的確切原因已查明。
