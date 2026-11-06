# Windows v0.3.7 安裝版驗證（2026-11-06）

此前GitHub最新v0.3.6、本機正式登記0.3.5；後續UI修改只有工作樹及局部本機檔案，未更新Release，已確認為版本交付落差。

- 全新Inno編譯v0.3.7，內含目前src與自然旁白HTML、README及0.3.7版Agent整合。
- 近期UI回歸37/37通過；單元、來源分類與安裝/更新契約26/26通過。
- 實際執行Windows Setup，從正式0.3.5升級0.3.7，退出碼0。
- 原265個會議檔案逐檔SHA-256一致；不在正式資料上做解除安裝測試。
- 已安裝後端的隔離合成UI驗證390/928/1440各通過，v0.3.7標籤、深色勾選容器、透明標籤及主內容起點正常，無Console/PageError。
- Codex runtime指向正式安裝根目錄；Claude Code已安裝openmeeting@openmeeting-local 0.3.7。
- 安裝包：DuckMeeting-0.3.7-Setup-x64.exe，38305609 bytes，SHA-256 `63ba3784ee435941b8bdd32931d4da3f5fab1aa05ec903151f03a01984f0dac5`。

原始證據位於test/.tmp/release037-*.log（包含安裝器、build、UI、unit、installed-ui），私有會議檔案與雜湊明細僅留本機忽略目錄。

發布目標：GitHub Releases v0.3.7，附Setup與SHA256SUMS.txt。完整歷史回歸資料見UI_REGRESSION及先前報告；本版沒有冒稱再跑完全部184案例或真人會議。
