# Duck Meeting 教學動畫

已完成三輪獨立 Agent 審查與修正，最後一輪通過。目前動畫144秒、15幕，含8階段進度列。

## 觀看

- 本機預覽：http://127.0.0.1:8794/ （需要預覽程序持續運作）。
- 離線：用Chrome或Edge開啟 duck-meeting-tutorial.html，可播放、暫停、拖曳、重播與選幕。
- 獨立SVG：duck-meeting-tutorial.svg，會自動循環，畫面隨視窗縮放；旁白與下方說明請使用HTML播放器。
- 全部圖片已內嵌，不需額外素材檔案。HTML播放器含可開關的本機中文旁白；沒有真人錄音。

## 內容

貼連結→必要登入與放行→自動準備錄音字幕→多人原文與英文翻譯→星標→結束並請Agent整理→摘要與待辦→原文來源定位→時間回聽→編輯郵件正文→授權Agent寄信→條件式交付示意。

## 驗收

- 第一輪：5項問題，已修。
- 第二輪：新增1項計數連續性問題，已修。
- 第三輪：61影格及獨立數值/視口檢查，通過，無新增阻擋操作理解問題。
- 主回歸：15幕、自動場景無游標、3幕打字與送出、字幕/翻譯、播放器、郵件刪改、SMIL時間、3視口、零Console/PageError及預覽嵌入一致，共10組通過。

完整結果見 QA_SIGNOFF.md，獨立報告在 qa/review-round-1.md、2.md、3.md。歷次調整保存在 qa/REVISION_HISTORY.md。

## 示範邊界

畫面使用隔離測試站台與虛構會議，並包含向量重建的登入與Agent流程；翻譯為本機提供的示範譯文。這不是實際真人會議、辨識準確度或翻譯延遲實測。音訊回聽為視覺動畫，不播放真人錄音；郵件成功明確標示為示意，未寄送真實郵件。人員主要指已記錄發言者。寄信實際需要使用者授權與可用郵件工具，站台僅保存本機草稿。

離線ZIP包含動畫、播放器、說明與三輪報告；完整逐張審查影格保存在本專案qa目錄，不包含在ZIP。

## 操作說明與中文旁白

影片下方新增隨分鏡更新的操作說明與角色標示。預設開啟中文旁白；瀏覽器允許時直接有聲播放，若阻擋則暫停畫面並提示按「播放」，點一次即可開始。重新按「開啟旁白」會從目前這幕開頭接續播放中文語音；可隨時關閉，旁邊可調音量。旁白會跟隨暫停、重播、選幕與時間拖曳，循環也會同步。

旁白由本機Microsoft Hanhan Desktop製作，已內嵌HTML，離線可用，無需API金鑰。narration/tutorial-narration.wav為144秒完整旁白；tutorial-captions.vtt是分鏡說明，tutorial-narration.vtt是對應實際語音的逐句字幕；script.json為來源文字與時間軸。

新增驗證：15幕文字對應、實際音訊訊號、暫停/繼續/跳幕/拖曳/音量/關閉、3種視口及離線播放。另由獨立Agent複查通過，包括153秒循環銜接，詳見qa/narration-independent-review.md。三輪審查屬於先前版本；本次移除搜尋幕後另跑時間軸與旁白回歸。

重建：在專案根目錄依序執行 node docs/design/tutorial-visual-v2/tools/build-tutorial-voice.mjs、python docs/design/tutorial-visual-v2/tools/compose-narration.py、python docs/design/tutorial-visual-v2/tools/build-narrated-viewer.py。重建需要Windows內建中文System.Speech語音；播放離線HTML不需要安裝語音元件。

## 移除搜尋分鏡

依使用者要求移除原第08幕「搜尋逐字稿」，後續重新編號。現為15幕、144秒；同步重建字幕、中文旁白、選幕與8階段進度列。產品的逐字稿搜尋功能保留。

郵件草稿分鏡已展示決議、待辦、負責人與期限；第13幕重新配音，長6.98秒，在9秒分鏡內完整播畢。
