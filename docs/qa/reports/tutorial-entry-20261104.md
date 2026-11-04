# 左下操作教學入口

新增固定入口與本機浮層播放器，15幕144秒，預設中文配音。Esc或關閉卸載播放器並停止配音，焦點返回入口。站台安全政策僅對教學HTML允許同源嵌入、hash驗證內嵌腳本/樣式，以及data圖片/音訊。主站政策未放寬。

驗證：node --test --test-concurrency=1 test/qa/tutorial.test.js，light/dark ×390/1280，4通過，零Console/PageError；核對同場in_call與URL不變，關閉移除iframe來源，鍵盤關閉與焦點正常。
