# 本夜接續機制診斷

使用者指出代理結束後只剩每15分鐘排程。原始night-shift技能的設計不是每15分鐘：hooks/hooks.json註冊command Stop hook，night-shift-stop.sh在ACTIVE存在、DONE不存在且未到期時exit2；另有prompt evidence hook。

已讀本機0.6.3 .codex-plugin/plugin.json，確實宣告hooks路徑。無法從這一點證明宿主真的觸發。

使用Fork附帶Git Bash，在 test/.tmp/night-hook-check 的隔離旗標測試手動執行，MANUAL_HOOK_EXIT=2，測試turns=1，符合原始邏輯。這不等於Codex自動Stop整合通過。

實際 .agent-pipeline/turns 在前一輪結束後不存在，沒有看見自動hook執行證據。尚未查明是載入、環境變數、宿主hook執行方式還是其他原因；不能斷言Codex完全不支援。

每15分鐘heartbeat是本代理自行加的補救，不是原skill設計；先前把工作結束交給排程是不當的執行選擇。現在維持當前回合工作，heartbeat僅作中斷補救，不宣稱是連續計算或原始工作節奏。

不在openmeeting夜班內擅自修改另一個plugin的安裝快取。
