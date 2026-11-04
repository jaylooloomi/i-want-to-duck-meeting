# 會議語言預設：方案 1 驗收（2026-11-03）

## 完成範圍

設定頁新增會議辨識語言、原文顯示與翻譯語言，並顯示 Agent 預覽。共用設定採版本比對與原子儲存，拒絕跨來源及不合法欄位。CLI／worker 保存每場語言快照；改預設不修改既有會議。來源 Codex skill 與 Claude Code 範本已更新為讀取共用設定。

Meet／Teams 加入流程依要求設定字幕語言並讀回，無權限或無法觀察時維持未驗證。中文 Paraformer 保留；英德日韓僅使用已快取的多語 Whisper，缺模型提示且不自動下載、不退回中文模型。

## 測試證據

- 全 Unit suite：543 通過、0 失敗、0 跳過（test/.tmp/language-full-final.log）。
- 最終設定／平台／測試完整性回歸：21 通過、0 失敗（language-complete.log）。含手機390、桌面1280、明暗主題、儲存失敗重試、原場次隔離、語言快照初始化、URL 覆蓋、Meet與Teams德日韓設定與讀回。
- 最終設定／config／Teams字幕 Unit：21 通過（language-final-unit-check.log）。
- 多語備援 Python：3 通過（language-final-python-check.log）。第一次從專案根目錄以模組匯入失敗屬測試啟動路徑問題，改用 python stt/test_language_defaults.py 後通過。
- 原有 integration／語系回歸中發現測試 mock 缺觀察讀回、快取URL攔截不完整及舊郵件標籤缺翻譯，已修正；完整 authored markup 語系檢查通過（language-catalog-final.log）。

## 驗收限制

本次沒有加入真人會議，平台測試使用瀏覽器 fixture；不代表Google／Microsoft真實服務權限或德日韓語音準確度已驗收。非中文本機模型需事先備妥。後續已於本機建置並安裝 0.3.5 Windows 安裝包，同步更新 Codex 與 Claude Code 整合；來源仍在 codex/meeting-video，未提交、推送或發布新 Release。

## 重跑

```powershell
node --test --test-concurrency=1 "test/unit/**/*.test.js"
node --test --test-concurrency=1 test/qa/meeting-preferences.test.js test/qa/meeting-language-platforms.test.js test/qa/integrity.test.js
python stt/test_language_defaults.py
```

## 本機落地與最終回歸

- 全 Unit 加設定／平台／完整性瀏覽器回歸：564 通過、0 失敗、0 跳過（test/.tmp/language-acceptance.log）。
- Python 多語模型路由：3 通過。
- Windows 安裝包建置與靜默更新成功（language-installer-build.log、language-install.log）；原安裝資料路徑維持不變。
- 正式站台 http://127.0.0.1:8792/ ：設定 API 與三個語言欄位正常，瀏覽器 console/pageerror 為零。截圖 language-installed-settings.png。
- 更新前後原有 312 個會議檔案 SHA-256 相同。未改動原預設，維持中文辨識、中文原文、英文翻譯。
- Codex runtime 指向正式安裝目錄；Claude Code openmeeting-local 0.3.5 快取技能含 preferences get 指令。Claude Code 既有工作階段需 /reload-plugins 或重啟後載入。
- 未加入真人會議，未宣稱各語言實際辨識準確度通過。
