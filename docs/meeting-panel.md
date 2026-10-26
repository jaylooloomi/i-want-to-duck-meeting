# 專用瀏覽器 meeting AI 面板

## 操作

直接 join Meet／Teams 連結。面板在會議 origin 自動建立 Shadow DOM，Google 原生選帳號／登入頁不注入，不需要擴充功能或日常 Chrome 設定。畫面可收合、鍵盤操作，桌面 1920×1080 與 390×844 皆測試。

開始／暫停只控制本場記錄，不控制與會者麥克風。Meet 預設自動起錄；只有 OPENMEETING_MANUAL_START=1 時延後保存。暫停不保存新字幕、PCM 寫靜音，保存 recordingControl.intervals 供解讀時間軸。字幕的修訂／晚到可能跨越控制邊界，不能宣稱精準語音切割。Teams 音訊生命週期沿用自動雙路模式，無手動開始／暫停；按鈕會隱藏／停用，不提供假操作。

面板約 1 秒從 page→Node binding 取得本場狀態，錄音 stats 最長約 5 秒更新。字幕同時顯示 finalized 與 live.json pending，最多顯示最近 120 段；完整內容在本機檔案。沒有文字或峰值為零就明示，不當作成功。

## 結束與整理

按「結束並整理」寫本場 STOP、離會並關閉會議視窗，結果視窗使用 meetings/.results-profile 獨立專用設定檔，不占用登入的會議 profile。結果頁只讀本機生成 HTML，轉錄處理中約兩秒自動重載，完成後停止重載，無遠端資源。關結果視窗即可結束檢視。

有已安裝模型及非零音訊時執行本機 Whisper（HF_HUB_OFFLINE=1，不自動下載），沿用既有轉錄時不重跑。接著建立 transcript-crosscheck、meeting-report.draft、meeting-report.auto 與 meeting-results.html。來源缺少顯示 partial，失敗顯示 failed，原始錄音／字幕不改動。自動摘錄僅選原文片段並附來源，不能視為 LLM 總結或已確認決議；沒有私下呼叫 Claude/Codex 子程序，也不會在宿主回合結束後自動喚醒 AI。

正式會議紀錄依 [雙來源審閱流程](transcript-review.md) 由 AI 審閱，另輸出 meeting-report.md。

## 邊界與隔離

只允許指定會議頁、主 frame、同一 page 的 binding；隨機 binding 名，動作僅 state/start/pause/stop，沒有任意檔案或命令 API。內嵌 iframe 不注入；登入 origin 不處理。樣式採 constructed stylesheet 與 Shadow DOM，不修改平台 CSP。逐字稿以 textContent 顯示，結果 HTML 完整 escape，不執行會議文字。

不在 Meet／Teams 網站內發起 localhost fetch，也無新 HTTP 遠端控制端點。不公開錄音／逐字稿，不傳外部 LLM。瀏覽器連線失敗顯示錯誤，操作在等待期間 disabled；重新整理後重建單一面板。

## 驗證

- test/qa/meeting-panel.test.js：真 Chrome、桌面／手機、即時文字、收合、重新整理、錯誤／重複提交防護、零 console/pageerror。
- test/integration/panel-session.test.js：真 runSession + 本機 mock Meet，手動開始、暫停丟棄、恢復、即時字幕、頁內停止與結果草稿。
- test/unit/panel-finish.test.js：離線轉錄參數、partial／failed、原始檔不變及結果 XSS 隔離。

此處為受控瀏覽器／合成輸入測試，不冒稱新版面板已由兩位真人在外部 Google／Teams 驗收。之前真人錄音僅用於離線段落核對，未用於外部測試。
