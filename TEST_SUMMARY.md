# 全端 QA 修復與驗收報告

七項產品問題已完成修復，對應 11 個參數案例取消 skip。針對性 QA 62 例：46 通過、16 個驗收限制 skip、0 失敗。兩輪完整回歸均為 677 例：654 通過、23 略過、0 失敗；本次七項修復的離線驗收通過，仍保留以下獨立驗收限制。

## 範圍與架構

Node.js ES modules 單體，同一 localhost server 提供原生 HTML/CSS/JS。沒有 React/Vue、前端 Router、登入／管理員頁或 SQL DB。UI 唯一頁面 `/`，query 包含 id 與 source=teams。盤點見 [架構逆向](docs/qa/RECONNAISSANCE.md)。

初始 QA 唯讀稽核與失敗證據保留在 docs/qa/reports、docs/qa/evidence；本次依使用者明確授權修復產品，不再沿用「原始碼完全未變」的舊簽核。只修改三份產品 JS，沒有變更依賴或加入 data-testid。

## 一鍵與分層命令

Windows、Node >=22、已安裝的 Chrome 與 npm 依賴；Python 使用既有 .venv-stt。本套件不安裝套件、下載模型或要求登入。

```powershell
# 兩輪完整離線回歸，自動啟閉 server 與 headless Chrome
node test/qa/run.mjs
# 單輪
node test/qa/run.mjs --once
# 各層
node --test test/qa/backend.test.js
node --test --test-concurrency=1 test/qa/frontend.test.js test/qa/e2e.test.js
node --test test/qa/integrity.test.js
.venv-stt/Scripts/python.exe test/qa/python-coverage.py --out test/.tmp/qa/python-coverage.json
# 啟用 BUG-004 驗收限制重現，預期因嚴格 console 檢查失敗
$env:QA_REPRODUCE_BUGS='1'
node --test --test-concurrency=1 test/qa/backend.test.js test/qa/frontend.test.js test/qa/e2e.test.js
Remove-Item Env:QA_REPRODUCE_BUGS
```

run.mjs 保存每個子程序退出碼；任一非預期失敗即退出 1。結果索引 test/.tmp/qa/latest.json，獨立輸出目錄有 results.json、各組 log、覆蓋率、失敗 trace／DOM／截圖／console。

## 修復與啟用案例

| 問題 | 修復行為 | 啟用案例 |
|---|---|---|
| BUG-001 P1 | 空會議清除舊逐字稿、計數與 Meet 連結，重設渲染簽章 | FE-03、E2E-03 |
| BUG-009 P2 | start 僅接受 JSON 物件，拒絕陣列／純量且不啟動收音 | BE-07 四型別 |
| BUG-002 P2 | 不存在 id 回退 latest 並同步 URL | E2E-05 |
| BUG-003 P2 | 更新 id 保留 source=teams 等其他 query | E2E-17 |
| BUG-005 P2 | 缺裝置／格式錯誤顯示提示並禁用開始 | FE-06、E2E-14 |
| BUG-006 P2 | generation 與來源模式檢查忽略過期裝置回應 | FE-08 |
| BUG-008 P3 | 裝置載入中、啟動／錄製／停止中禁止開始 | E2E-15 |

空裝置測試現在檢查提示與 disabled，不再點擊無效配置。過期回應測試等待 HTTP 完成及正確麥克風提示，不要求過期資料修改隱藏控制項。這些調整配合正確的使用者契約，而非容許原始缺陷。

## 嚴格前端紀律

每個新增 UI 案例都監聽 pageerror 及 console.error，兩者任一發生就失敗；guard 有自測。只使用語義 role/label/text；沒有 CSS class／XPath 或固定 sleep。fixture 管理真 server、Chrome，僅失敗保留 trace 與截圖。沒有前端框架，因此 component 測試隔離執行原生 app.js 或 microphone.js。

舊測試仍含 CSS、固定等待或僅 pageerror 的歷史案例；其回歸價值與新嚴格 QA 分開標示，不宣稱全部歷史測試符合新增紀律。favicon 探測由測試環境回 204，API 故障未設 console 白名單。

## 驗收限制（未計為通過）

BUG-004 的 16 個 HTTP／網路故障案例仍保留 skip。Chromium 對 400/401/403/500 或中斷請求輸出 `Failed to load resource` console.error，即使產品已 catch、顯示錯誤且恢復，也會觸發字面零 console 規則。原始失敗截圖／console 證據保留，不能將它當成已修或 JS runtime 崩潰。未忽略 console、未把失敗 API 偽裝為 HTTP 200、未放寬 guard。

其他 7 個 skip 是選用實體音訊／外部樣本；另 1 個可能下載 Whisper 的 TTS+runTranscribe 整合案例由明確 skip-pattern 排除，沒有計入分母。錄音、Windows 裝置與模型在新增 UI 測試使用合成隔離 adapter；HTTP／Chrome／AudioWorklet 為真執行。未使用私人音檔或登入外部會議。

因此本次可簽核「七項產品修復的離線回歸」，不可簽核「全部故障注入零 console」或「真人雙端錄音與辨識正確率」。新版 Teams 真人、跨帳號／組織 Meet、WASAPI、長時間錄音與完整 WCAG 尚不在本次證據範圍。

## 完整兩輪回歸

由同一 `node test/qa/run.mjs` 連續執行兩輪，無中途變更產品或測試，主命令退出 0。兩輪結果相同：

| 群組 | 每輪總數 | 通過 | Skip | 失敗 |
|---|---:|---:|---:|---:|
| Node unit（含部分 Chrome） | 509 | 509 | 0 | 0 |
| 離線 integration | 81 | 76 | 5 | 0 |
| 嚴格 QA | 62 | 46 | 16 | 0 |
| Python | 25 | 23 | 2 | 0 |
| **每輪合計** | **677** | **654** | **23** | **0** |

新增 QA 分層：Backend 15 全通過；原生 FE component 13 中 8 通過、5 驗收 skip；E2E 31 中 20 通過、11 驗收 skip；完整性／guard 3 全通過。兩輪各 28 個實際執行的嚴格 UI 案例均零 console/pageerror。

[兩輪結果與退出碼](docs/qa/reports/repaired-two-rounds.json)及各組 repaired-*.txt 原始 log 已持久保存。修復前 accepted-round-*.json 是歷史稽核結果，不與本次兩輪混用。

## 覆蓋率與路由

唯一 UI 頁面 `/`：1/1、100% Route Coverage；id、source=teams、reload、back/forward 與 404 負面契約均實測，API 入口 7/7。不是所有分支 100%。

Node V8 按各群組分開報告，不能平均拼成全端百分比。Browser 精確範圍換算為非空行「任一字元命中」，不是 statement/branch coverage；Worklet 在其他執行緒，不納入頁面 JS 分母。Python stdlib trace 以全部 stt 非測試 .py 的可執行行為分母，沒有 branch 指標。[本次 Node 覆蓋率](docs/qa/reports/repaired-node-coverage.json)如下（Line / Branch / Function %）：

| 群組 | 第一輪 | 第二輪 |
|---|---|---|
| Node unit | 66.37 / 85.08 / 76.84 | 66.37 / 85.08 / 76.84 |
| integration | 66.82 / 66.49 / 65.12 | 66.79 / 66.41 / 65.35 |
| 嚴格 QA Node | 47.26 / 78.89 / 26.15 | 47.26 / 78.89 / 26.15 |

[Browser 範圍覆蓋](docs/qa/reports/repaired-browser-coverage.json)：app.js 73/77 非空行（94.81%），microphone.js 134/136（98.53%）。新 QA 的 live-server.js Line 100%、Branch 92.77%；MicrophoneService Line 40%。[Python](docs/qa/reports/repaired-round-2-python-coverage.json) 247/907 可執行行（27.23%）；windows_audio.py 仍 0/142，實體依賴尚未驗收。舊覆蓋率報告保留為歷史。

## 完整性與品質界線

原始 68 檔 SHA-256 基準保留於 production-baseline.json，三份授權修復另列 authorized-fixes.json；完整性測試仍驗證其他 65 檔不變及新三檔雜湊。環境 Node 24.13.0、Chrome 155.0.8059.85、Playwright-core 1.63.0、Python 3.12.13、Windows 10，見 environment.json。

矩陣 41 個群組：37 通過、4 個驗收限制，沒有尚待處理案例。兩輪無非預期失敗只代表這次執行沒有觀察到 flaky，不保證其他環境或外部服務永遠穩定。

## 修復後故障注入複核

另外啟用 16 個 BUG-004 案例實跑，16 個均在功能斷言完成後由嚴格 console guard 判定失敗（退出 1）；所有錯誤都是 Chromium `Failed to load resource`，沒有 pageerror 或其他錯誤種類。這是預期限制重現，不與兩輪正常回歸的成功混算。[當次分類與完整診斷](docs/qa/reports/repaired-fault-confirmation.json)、[原始 log](docs/qa/reports/repaired-fault-confirmation.txt)。
