# 新功能圖片導覽

四張圖片由目前原始碼啟動的隔離本機站台擷取，再加上操作說明。所有會議、發言、人物及日期均為虛構示範；沒有讀取或修改使用者原有會議，也不代表真人語音驗證。

| 圖片 | 功能與用途 |
| --- | --- |
| [01-templates.png](01-templates.png) | 每場會議選擇通用、專案週會、客戶訪談或技術討論模板，保存後供下次 Agent 整理使用，既有摘要不會立即改寫。 |
| [02-open-issues.png](02-open-issues.png) | 待確認頁籤集中呈現未定案問題、風險與資訊缺漏，避免與正式決議混淆。 |
| [03-task-board.png](03-task-board.png) | 跨會議待辦總表可篩選負責人、狀態與事項，保存完成狀態，並回到已連結的原文。 |
| [04-readable-controls.png](04-readable-controls.png) | 實際淺深色介面的停用／可操作按鈕狀態對照。 |

重建指令：`node test/qa/capture-new-feature-guide.mjs`。需要專案已安裝的 playwright-core 與本機 Chrome。腳本自行啟閉隔離站台，監聽並拒絕 Console/Page Error，使用語義化定位與狀態等待。

圖片與對應 HTML 均可獨立開啟。這次圖片導覽本身不會更新 GitHub Release 或替換 Windows 安裝包。
