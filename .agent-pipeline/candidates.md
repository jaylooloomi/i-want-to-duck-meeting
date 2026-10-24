# 加分候選：第一輪

## 01：可審核的驗證層級
因為原始需求是 **自主加入 Meet 並可靠交付錄音與逐字稿**，所以頂尖做法會順便做 **明確區分真實遠端接收、平台自身字幕、本機合成注入和模擬測試的機器可讀驗收結果**；目前成果 **只有部分（人寫說明，尚無共用判定函式）**。
- 來源：https://support.google.com/meet/answer/15077804?hl=en-GB 及本夜真實測試限制 docs/2026-10-25-google-meet-autonomous-validation.md。
- 切片：純函式與單元測試，最多3檔／200行；輸入來源、實際字幕／錄音解碼文字及雙端入會狀態，不把峰值當語句證明，不新增依賴。不是自動聲稱ASR語義正確。

## 02：blocked 狀態提供下一步動作
因為原始需求是 **貼連結後自行開會，必要時才求助**，所以頂尖做法會順便做 **按真實失敗狀態提供登入／會議存取檢查線索，不能確認原因時明示未確認**；目前成果 **只有部分（blocked 對使用者為泛用錯誤）**。
- 來源：https://support.google.com/meet/answer/9303069?hl=en；本夜兩次匿名blocked證據。
- 切片：狀態呈現純函式與測試、CLI小範圍接入；不繞過限制、不增加重試、不改共享設定。最多3檔／150行。

## 03：中文介面字幕語言選擇相容性
因為原始需求是 **自動設定並記錄正確中文**，所以頂尖做法會順便做 **在非英文的會議端也能辨識語言控制項**；目前成果 **只有部分（正式CLI會強制hl=en，但本夜直接建立的中文主辦端設定失敗）**。
- 來源：https://support.google.com/meet/answer/15077804?hl=en-GB；本夜首次真實平台測試。
- 切片：增加已觀察本地化語言字串與純測試。正式CLI已有英文策略，實際影響可能較低，缺真實DOM時不能猜選擇器。最多3檔／100行。


# 第二輪新候選（前兩項已提交）

## 04：Windows 內建合成音訊測試檔產生器
因為原始需求是 **不喚醒使用者也能驗證Google Meet**，所以頂尖做法會順便做 **可重跑且避免Windows編碼錯誤的合成語音測試輸入**；目前成果 **只有部分（忽略資料夾內一次性腳本，實際曾因BOM出錯）**。
- 來源：https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavefile 、https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_Character_Encoding
- 切片：內建System.Speech產生PCM16／16kHz WAV，文字用base64參數傳遞避免命令注入與BOM問題，拒絕覆寫已有檔案，附合成來源／音檔雜湊manifest；純函式測試與本機實際產生，不新增套件。3檔／200行。

## 05：可重跑的真實Meet雙頁驗證器
因為原始需求是 **貼連結自行加入並確認遠端錄音**，所以頂尖做法會順便做 **將本夜已成功的同帳號雙頁測試保存成明確啟用、有限時且正常收尾的驗證入口**；目前成果 **只有部分（tools內一次性程式，尚無正式可重跑入口）**。
- 來源：https://support.google.com/meet/answer/9303069?hl=en 、https://playwright.dev/docs/api/class-browsercontext
- 切片：第一片只建立私有測試主持端、使用指定合成WAV、有限時關閉；後續另做接收端。明確--live與合成來源，不接觸第三人，不上傳舊私人錄音。需要先完成04；不改正式CLI不新增套件。3–5檔／300行。

## 06：既有Paraformer產生綁定音檔的驗收JSON
因為原始需求是 **錄音內容要可核對，不能看到檔案就算成功**，所以頂尖做法會順便做 **從現有本機模型與WAV直接生成decodedText、audioSha256、來源資訊**；目前成果 **只有部分（驗證器要求SHA，但產生實際ASR證據仍是tools內腳本）**。
- 來源：https://k2-fsa.github.io/sherpa/onnx/python/index.html 、scripts/verify-meeting-evidence.js 要求audioSha256，以及本夜真實接收音檔核對。
- 切片：只接受本機PCM16 WAV，沿用已安裝Paraformer與OpenCC，不下載、不提供expected prompt、不改錄音，生成可直接餵給驗收器的JSON；以fake recognizer離線單元測試資料處理並用本夜合成錄音實跑。最多3檔／200行。若視為bonus02續作應維持其編號，不能假裝獨立新功能。


## 05 後續切片：接收端與整場驗證入口（沿用bonus03）
主持端第一片已在d044e39完成。尚未保存的第二片：在同一授權context建立額外頁面，使用正式join/captions/audio模組錄製合成遠端聲音，正常收尾，呼叫已完成的離線解碼與驗收入口。預設完整測試句／代碼都要核對；原生字幕英文名有誤時回報partial，不擅自替換。最多5檔／300行淨增，本次沿用bonus03不另開編號。仍需--live，不新增依賴、不把相同帳號兩頁叫兩個真人。


# 第六輪候選（最新可重跑入口已保存 f78e7ac）

## 07：完整驗證入口的分階段期限（bonus03續作）
因為原始需求是 **無人協助Google Meet驗證**，所以頂尖做法會順便做 **區分收音時間與離線解碼期限**；目前成果 **只有部分（主持端seconds+90總期限包含入會、錄製、最多120秒解碼及再保留seconds，長測試可能過早關閉）**。
- 來源：https://playwright.dev/docs/test-timeouts；scripts/verify-meet-live-host.js、scripts/verify-meet-live.js。
- 切片：主持端回呼完成後直接正常收尾或明確額外保留；全流程有覆蓋各階段的總期限；以注入時鐘單元驗證deadline及取消，不拉長無界等待。沿用bonus03，最多3檔／100行。

## 08：字幕與錄音分開列出差異（bonus02續作）
因為原始需求是 **自主驗證並交付可信證據**，所以頂尖做法會順便做 **逐條標記缺失的測試標記與各自辨識文字**；目前成果 **只有部分（只有captionsMatch、recordingMatch布林值，要人工開多個JSON查）**。
- 來源：https://support.google.com/meet/answer/15077804?hl=en-GB；本夜原生字幕錯英文名但錄音ASR正確的實際差異。
- 切片：離線驗收純函式提供marker結果與報告文字，不改平台字幕不改判定標準，不把合成稱真人；最多3檔／100行。沿用bonus02。

## 03：中文介面字幕語言選擇相容性（維持待評，不猜DOM）
因為原始需求是 **自動設定中文**，所以頂尖做法會順便做 **非英文控制項相容**；目前成果 **只有部分，但正式路徑強制英文且缺失敗DOM**。來源：https://support.google.com/meet/answer/15077804?hl=en-GB 。仍不宜猜測修改。
