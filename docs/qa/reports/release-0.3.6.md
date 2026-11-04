# v0.3.6 發布驗證

- Unit/Integration 初次完整執行630項：623通過，2失敗，5環境條件跳過。耗時880秒。
- 兩項失敗皆為測試落後：來源選擇器已改可搜尋清單、郵件新增分類與預設全勾；Settings無可讀回值時產品正確回報unknown，不應斷言已驗證。更新測試後兩項個別重跑通過。Session測試改獨立暫存目錄以避免重跑競爭。
- Browser初次40項：36通過，4失敗。手機側欄高度已修正；音軌切換保留播放狀態及時間膠囊新名稱已對齊測試。重跑：音量2通過；語言偏好／教學11通過；影片6通過。未將第一次失敗紀錄冒稱整輪全綠。
- 原生Inno Setup安裝／修復／升級／解除安裝測試通過，既有資料保留、Codex技能橋接、本機HTTP與含配音教學資產通過。為保護正式安裝註冊，使用相同payload、隔離AppId測試編譯版；正式包亦已編譯並產生SHA-256。
- 錄影仍為需真人Meet／Teams驗收的新功能；不以合成媒體測試冒稱真人雙方聲音成功。
- 無私人錄音、會議檔或使用者站台截圖加入Git／安裝包。

本機原始紀錄：test/.tmp/release036-full.log、release036-browser.log、release036-audio-recheck.log、release036-footer-recheck.log、release036-contract-recheck.log、release036-notes-recheck.log、release036-settings-recheck.log、release036-smoke.log。前兩輪失敗與後續重驗分開保留。
