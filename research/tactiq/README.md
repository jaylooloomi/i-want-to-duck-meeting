# Tactiq 擴充功能研究

研究日期：2026-10-25。分支：`codex/tactiq-transcript-research`。

結論：本機安裝的 **3.1.7320** 版本，在 Google Meet 與 Teams 都有直接取得平台字幕資料的程式，不只是讀取可見 DOM，也不是此處另跑中文 ASR。應把我們的逐字稿來源改成「平台原生字幕優先、本機 ASR 備援」，錄音則獨立驗證。

這是靜態程式研究，尚未以真人會議驗證這些私有介面在目前帳號、平台版本及權限下是否仍可使用。沒有修改、執行或重新散布 Tactiq 程式，也沒有讀取 Chrome 帳號、Cookie 或會議資料。

## 研究資料

- `official/`：下載的官方 HTML、文字版、相關圖片及來源／SHA-256 清單。涵蓋指定 Meet 指南及直接相關的安裝、Teams、PWA、語言、排錯、Drive、匯出與 MCP 文件；不是整個 Help Center 的全站鏡像。
- `analysis/extension-inventory.json`：本機 JavaScript 檔案大小、雜湊與版本。
- `analysis/evidence-index.json`：技術證據的檔案名稱、搜尋字串、字元偏移。壓縮檔多為單行，字元偏移比行號有用；偏移對應 UTF-8 解碼後的 Python 字串。
- `analysis/report.md`：完整技術分析與導入順序。
- `videos/README.md`：3 個官方操作動畫的下載資訊與抽樣檢視結果。

官方下載資料與完整程式片段輸出由此資料夾的 `.gitignore` 排除；研究腳本、雜湊索引與自行撰寫的報告可以進 Git。下載資料不代表取得重新發布授權。

本機擴充功能來源：

```text
C:\Users\User\AppData\Local\Google\Chrome\User Data\Profile 3\Extensions\fggkaccpbmombhnjkjokndojfgagejfb\3.1.7320_0
```

## 重跑

從專案根目錄執行（需要網路；inspect.py 的擴充功能路徑目前對應本機）：

```powershell
.venv-stt\Scripts\python.exe research/tactiq/inspect.py
.venv-stt\Scripts\python.exe research/tactiq/download.py
.venv-stt\Scripts\python.exe research/tactiq/index-evidence.py
```

這些操作不加入會議、不上傳錄音，也不啟動正式擷取。既有自主會議 PoC 的未提交檔案原樣保留。
