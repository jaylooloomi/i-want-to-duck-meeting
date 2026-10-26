# 專用瀏覽器面板與雙來源會議紀錄驗收

2026-10-26：目前完整單輪回歸 **728 例：705 通過、23 略過、0 失敗**，全部子程序退出碼 0。[結果及原始輸出](docs/qa/reports/panel-release-results.json)。本輪涵蓋前面尚未提交的 crosscheck／會議紀錄修改，以及專用瀏覽器面板；沒有新增依賴或改動主分支。

## 本次完成

- 專用 Meet／Teams 會議頁自動注入 Shadow DOM 面板，不安裝日常 Chrome 擴充功能或注入登入頁。
- 預設入會自動記錄；Meet 支援開始／暫停／恢復，OPENMEETING_MANUAL_START=1 可手動起錄。Teams 維持自動雙路模式，沒有假暫停按鈕。
- 面板同時顯示 finalized 與 pending 字幕，顯示真正的音訊訊號及錄音長度。頁面重新整理後恢復單一面板。
- 頁內結束會停止本工具／離會、離線轉錄、對齊核對、固定格式草稿與來源原話摘錄，另開專用結果視窗，不占用會議登入 profile。
- 決議與待辦沒有憑空生成。摘錄不是 LLM 總結；正式紀錄仍由 Codex／Claude 依引文審閱。沒有隱藏雲端代理或自動喚醒 AI。
- 文字順序段落對齊與重要數字／否定詞／日期／術語／責任差異保留；引文契約驗證阻擋缺來源、錯段號及偽造原文。

## 分層結果

| 群組 | 總數 | 通過 | 略過 | 失敗 |
|---|---:|---:|---:|---:|
| Node unit | 532 | 532 | 0 | 0 |
| 受控 integration | 82 | 77 | 5 | 0 |
| 嚴格 QA／瀏覽器 | 89 | 73 | 16 | 0 |
| Python | 25 | 23 | 2 | 0 |
| 合計 | 728 | 705 | 23 | 0 |

六個新增面板瀏覽器案例包含桌面／手機控制、文字 XSS、收合、reload、pending 文字、非同步防重送／錯誤釋放、非指定 origin 及 iframe／未知命令拒絕。每例有全域 console/pageerror guard，未放寬錯誤規則。新增整合案例實際跑 runSession → mock Meet → 開始／暫停丟棄／恢復 → 頁內停止 → 結果草稿，非只 mock callback。[合成畫面驗證](docs/qa/reports/panel-visual-validation.json)。

一次早期整合執行因啟動 PATH 缺 Windows PowerShell、暫存目錄占用而失敗：[原始失敗](docs/qa/reports/panel-initial-environment-failure.txt)。修正執行環境、保留舊測試目錄備份後，原失敗檔案 10 例全通過：[重跑](docs/qa/reports/panel-environment-retry.txt)，再跑上表完整回歸成功。沒有更改產品邏輯或 skip 來掩蓋環境失敗。

## 現有錄音驗證

使用 84.1 秒與 121.7 秒兩場現有本機錄音的既有本機 Whisper 轉錄及 CC；未重新入會或上傳錄音。兩來源均含 1357，能標出缺段與重要差異；最新一場已產生附原文的固定格式審閱稿，另一場只產生草稿。原始 WAV／CC／ASR 保持不變。[去識別結果](docs/qa/reports/crosscheck-local-validation.json)。

這是對齊、核對及報告流程驗證，不是人工校準 CER/WER，也不宣稱新面板已完成外部真人 Meet／Teams 驗收。實際錄音、帳號、會議連結與引文只在本機 ignored meetings 目錄。

## 驗收限制

- 16 項 BUG-004 故障注入：Chrome 對 HTTP 400/401/403/500／網路失敗產生 console 資源錯誤，依原嚴格規則 skip，不算通過；可設 QA_REPRODUCE_BUGS=1 重現。
- 另 7 項為 opt-in 音訊／裝置／模型案例；需下載模型的 TTS 案例由 runner 明確排除，不在分母。
- 此次完整回歸一輪，不宣稱兩輪零偶發失敗。歷史 native-release-*、repaired-*、crosscheck-targeted.txt 不是此次新版的額外獨立通過數。
- 文字配對不是聲學對齊，相似度不是正確率；有資源上限，重疊發言／重複句仍可能誤配。重要差異不因輸出報告自動解除。
- 缺模型／無音訊顯示 partial，辨識失敗顯示 failed；不靜默下載模型。暫停以靜音維持錄音時間軸，CC 修訂邊界不是精確聲學切點。
- 新控制面板是注入區域，不是新 HTTP 路由；原有 UI 路由 `/` 1/1、API 入口 7/7。沒有新增 localhost 跨來源控制 API。

## 覆蓋率

Node V8 分組獨立計算，不平均成全端正確率：[本次 Node 覆蓋率](docs/qa/reports/panel-release-node-coverage.json)。瀏覽器既有 app/microphone 腳本按非空行任一字元命中計算，非 branch；注入面板不能用這兩檔的百分比宣稱其覆蓋率。[瀏覽器資料](docs/qa/reports/panel-release-browser-coverage.json)、[Python 可執行行資料](docs/qa/reports/panel-release-python-coverage.json)。Python 沒有 branch 指標，含未測實體裝置腳本。

## 執行

```powershell
# Windows、Node >=22、已安裝 Chrome、專案依賴及 .venv-stt
# PATH 必須包含 Node、System32 與 WindowsPowerShell/v1.0
node test/qa/run.mjs --once
# 如需兩輪，省略 --once
node test/qa/run.mjs
# 聚焦本功能
node --test --test-concurrency=1 test/unit/alignment.test.js test/unit/crosscheck.test.js test/unit/minutes.test.js test/unit/panel-finish.test.js test/qa/meeting-panel.test.js test/integration/panel-session.test.js
node --test test/qa/integrity.test.js
```

runner 保存程序退出碼、覆蓋率與失敗 trace／DOM／截圖／console，非預期失敗退出 1。新 authored UI 案例採語義定位與條件等待；既有 legacy 的歷史定位／等待寫法不因此宣稱全部符合新標準。

操作文件：[面板](docs/meeting-panel.md)、[雙來源紀錄](docs/transcript-review.md)、[schema](docs/meeting-minutes.schema.json)、[矩陣](TEST_MATRIX.md)、[缺陷及限制](BUG_REPORT.md)。本機 Codex 技能及 Claude 外掛已安裝，實際內容比對一致、Claude enabled=true；doctor=ok。
