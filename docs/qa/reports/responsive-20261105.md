# 窄／矮視窗主內容消失修正

分支：codex/ui-consistency-20261105。

928×688實際重現：舊max-width/max-height規則留下app-shell flex-direction:column，同時側欄仍是整個視窗高度且200px寬；main的y=688，會議實際存在但整區被推到畫面下方。

修正：721px以上明確採水平外框，main從頂端開始；721–1050px保留224px側欄，主內容採單欄卡片且容器可捲動。低高度側欄可捲動。720px以下保留手機上下排版；較寬桌面仍維持雙面板。未改錄音、逐字稿或會議資料。

新增test/qa/responsive-breakpoints.test.js：720/721/800/928/1024/1050/1051/1280px、480/600/688px高度，淺深色共16項。驗證main起點、標題初始可見、內容可捲到、正文寬度、側欄名稱與無水平頁面溢出。另重跑transcript-scroll.test.js的10項捲動／播放器回歸。

證據：test/.tmp/responsive-breakpoints-final.log、test/.tmp/responsive-scroll-regression.log；截圖由共用harness保存在test/.tmp/qa/manual/RESPONSIVE_*。已加入test:ui與test:ui:recent；目前完整184項、近期37項。本輪沒有重跑全部184項，只針對新增斷點與相關捲動驗證。
