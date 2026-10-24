# Night Shift Result（2026-10-25）

進行中。重點：Google Meet 自主驗證，預定 8 小時。完整期限見 DEADLINE。

## 收尾
| 項目 | 狀態 | commit | 備註 |
|---|---|---|---|
| 既有 PoC 與 Tactiq 研究整理 | 完成 | bf78755、9d3ab75 | 不含下載原檔／私人資料 |
| Teams 原生字幕整合保存 | 完成 | 9dc0f21 | 單元490、受控Chrome2已通過，真人未驗證 |
| Google Meet 自主驗證 | 部分通過／字幕仍有錯字 | | 正式已登入CLI入會／中文CC／正常收尾通過；修正真實Join here too圖示誤判後，兩頁同帳號真實Meet遠端擷取34.944秒且ASR含Google Meet與1357。原生字幕英文名有誤，非真人測試。 |
| 驗證缺陷修正與說明 | 持續 | 5c9a11f、ecfff24 | 370b27c修正真實頁面圖示造成CTA誤判；121項單元通過並實測遠端擷取，另補失敗診斷與驗證層級 |

## 加分項（每行一個，可獨立 revert）
| # | 名稱 | Score | 參考來源（競品 / 專案 / 文章） | 做了什麼 | 驗證指令 | 測試狀態 | 否決的替代作法 |
|---|---|---|---|---|---|---|---|
| 01 | blocked 條件式下一步 | scores-01.md：12.0 | Google Meet官方加入說明 | 已完成 src/meet/failure-guidance.js、src/cli.js、test/unit/failure-guidance.test.js | node --test test/unit/failure-guidance.test.js test/unit/cli.test.js | 69項通過；node --check通過 | 不把blocked猜成訪客／不增加自動重試 |
| 02 | 驗證層級與真實檔案報告 | scores-02.md：7.0 | Google Meet字幕官方說明 | 已新增 src/verification.js、scripts/verify-meeting-evidence.js、test/unit/verification.test.js；分開驗證本機注入與遠端來源 | node --test test/unit/verification.test.js；讀本夜實際音檔與字幕 | 6項單元通過（含WAV雜湊綁定與CLI真檔案）；本夜檔案報告 local-content-matched，remote=false | 不用peak當語句證據／不對來源不明資料宣稱遠端成功 |
| 03 | 可重跑合成主持端（第一片） | scores-04.md：3.5 | Google Meet加入說明、Playwright Context API | 已新增 scripts/verify-meet-live-host.js、test/unit/meet-live-host.test.js、docs/live-google-validation.md；--live明確啟用、重用內建TTS、有限時收尾 | node --test test/unit/meet-live-host.test.js；明確啟用真實服務煙霧測試 | 3單元通過；真實服務10秒主持端煙霧測試 completed_host_only | 不接受舊私人錄音／不把host-ready當完整遠端驗證 |

## 判斷不值得做
- 中文介面語言選擇器：Score 0.3；正式路徑使用hl=en，缺真實DOM，不猜測實作。

## 需要你決定的事
- `stash@{0}`：night-shift pre-stash 2026-10-25 已套回新分支，保留備份，沒有遺失修改；收工時不自動刪除。
- Teams 新版真人驗證留待本夜 Google Meet 重點完成後評估，不要求睡眠中的使用者配合。

## 統計
- 進行中；尚未收工、未推送。

## 接續機制
- 使用者已糾正：原skill是Stop hook持續接手，不是15分鐘工作。人工隔離測試hook exit2通過，但宿主自動觸發仍未確認；詳見hook-diagnostics.md。當前直接持續工作，heartbeat只作中斷補救。
- 本對話 heartbeat 已建立，automationId=google-meet，每15分鐘、最多32次；每次依既有DEADLINE判斷，不重設。到期收尾並停用。
- 使用 night-shift 技能執行；另依 OpenAI Docs 的本對話排程機制接續。https://learn.chatgpt.com/docs/automations

## 接續狀態（本輪完成後）
- 不是收工：未到DEADLINE，尚未push，ACTIVE存在，沒有DONE。
- automationId `google-meet` 每15分鐘接續本對話，最多32次，需以原期限收尾。
- 第一輪候選02與01已完成；03為0.3不做。下一輪需重新調研3–8個與Google Meet自主驗證直接相關候選，交scorer；沒有候選才依連續兩輪規則收工，不能任意提早。
- 可調研：自動產生可重跑的Windows合成測試音檔（本輪UTF-8無BOM曾造成測試輸入錯誤）、既有會議驗收輸出是否可直接產生帶音檔SHA的解碼證據、字幕中斷與沉默區分；避免重做已提交功能。
- 本輪工具腳本在 tools/（忽略）；真實服務驗證證據在 test/.tmp/night-meet-live（忽略），驗證文件已整理。沒有需要人工放行的存活測試場次。
- 最新單元：69項CLI/失敗提示、6項證據驗證；上一輪全套490通過、新受控Chrome2通過。不要把不同時間的數字相加冒充一次全套測試。

### bonus-02 續作計畫（scorer第三輪TOP06，8.2）
- 已新增 stt/verify_audio.py、stt/test_verify_audio.py，3項離線單元通過，真實接收音檔實跑成功：既有Paraformer實際解碼與SHA綁定JSON入口；用本夜真實接收音檔驗證，單元測試不下載模型、不碰外部服務。
- 否決替代：自動另下載Whisper模型（不需要新環境）；手工填入解碼JSON（不能重跑實際辨識）。
- scorer指出 scripts/make-tts-wav.ps1 早已支援Unicode／Base64／16kHz PCM，不重造合成工具；本輪先前手寫腳本忽略它是研究遺漏，已修正判斷。

### bonus-03 後續切片計畫（scorer第五輪TOP05後續，5.6）
- 新增 scripts/meet-test-receiver.js、scripts/verify-meet-live.js、test/unit/meet-live-receiver.test.js；在既有主持端自己的區塊加入onHostReady回呼，docs補完整命令。<=5功能檔／300行淨增。
- 實際接收音訊後呼叫既有stt/verify_audio.py與離線驗收器。完整原句與1357核對；原生字幕英文名錯誤時標partial，保留音檔與來源，不強行替換。
- 否決替代：複製帳號Cookie到另一個profile；只讀非零音量就把完整測試標成功。

### bonus-03 後續驗證結果
- 6項主持端／接收端單元通過，包含證據寫入失敗仍關閉頁面；先前完整回歸502項通過（在新增接收端案例之前）。
- 新入口真實Meet實跑：25.216秒遠端WAV，SHA256 `36e275e86b90e7462c7c8288526cc4f165bb7b65af950495b321acae284f1a2f`。Paraformer完整句含Google Meet及1357，recordingMatch=true；Google原生字幕把英文名辨識成更高密，captionsMatch=false，總結partial。沒有把原生字幕強行改字，也沒有宣稱真人通過。
- 證據：test/.tmp/live-meet-host-41a3f01f-c9d2-47b2-8f15-d298cbe0497f/verification.json（忽略的本機資料）。

### bonus-03 階段期限續作計畫（scores-06：10.7）
- 修改主持端自己的計時區塊、相關單元與驗證說明。主持準備90秒；接收／離線解碼有獨立有限預算，完成後即關閉，無額外保留。
- 測試注入計時器確認階段重設及全部清理，既有取消案例仍通過。
- 否決：關掉所有期限（可能永遠占用會議）；單純把seconds調大（混淆收音長度與解碼等待）。

- 階段期限續作驗證：7項主持／接收單元全通過，120秒收音對應420秒處理預算，回呼完成即收尾，兩個owner均關閉。

### bonus-02 差異說明續作計畫（scores-07：9.0）
- 修改src/verification.js自己的純函式與test/unit/verification.test.js；提供各marker字幕／錄音比對、實際兩路文字；不改既有全句標準與來源限制。文件補JSON欄位說明。
- 案例：Google Meet錯字但1357正確時分別列出，數字不誤中較長數字，無marker仍不成功。
- 否決：模糊比對當作通過（掩蓋錯字）；讓LLM憑預期句修正字幕（製造假證據）。
- 最新完整回歸506項通過、0失敗（階段期限新案例另外7項通過）。

- 差異續作7項單元通過。markerResults逐項列字幕與錄音是否包含標記，observedText保留兩邊原文；結果含會議文字，依原規則只存本機忽略目錄。為維持加分隔離，不改bonus03文件。

- README中英同步加入可重跑Google Meet驗證命令與partial結果，清楚限定同帳號合成遠端，不混同歷史真人驗證。
