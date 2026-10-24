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


# 第八輪剩餘缺口評估

## 03：中文介面字幕語言控制相容
因為原始需求是 **無人協助自動開中文CC**，所以頂尖做法會順便做 **本地化控制相容**；目前成果 **只有部分，但hl=en正式策略已實測，沒有失敗DOM可支援新selector**。來源：https://support.google.com/meet/answer/15077804?hl=en-GB 。只允許有實際DOM才做，現階段不可猜。

## 09：獨立帳號／跨組織驗證端
因為原始需求是 **自主會議驗證**，所以頂尖做法會順便做 **獨立身分與不同組織情境驗證**；目前成果 **只有同帳號雙頁**。
- 來源：https://support.google.com/meet/answer/9303069?hl=en ，正式跨帳號加入受登入／主持權限影響。
- 目前缺第二個可用授權帳號，若需複製登入或要求睡眠中的使用者登入，與scope否決衝突。本夜不註冊帳號、不繞過驗證。請依可執行性判斷，不為提高覆蓋去碰第三人會議。

## 10：合成輸入與遠端錄音飽和比例診斷（bonus02續作）
因為原始需求是 **無人驗證確實錄到可辨識聲音**，所以頂尖做法會順便做 **量化PCM滿幅樣本比例，區別單一峰值和持續削波**；目前成果 **只有peak，最新真實錄音peak為32768但未量化是否持續飽和**。
- 來源：https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData ，PCM樣本量測；現有離線WAV驗收器已掃描樣本。
- 切片：既有離線證據掃描增加滿幅樣本數／比例，不擅自降低原音訊、不修改Google字幕、不把閾值當語音內容成功；最多3檔／100行。先量測既有錄音再決定是否需要功能，若實際比率極低可判低分。


# 第九輪（取消路徑稽核發現）

## 11：STOP檔案在接收階段也生效（bonus03續作）
因為原始需求是 **無人錄製可可靠收尾**，所以頂尖做法會順便做 **使用同一停止信號覆蓋所有錄製階段**；目前成果 **只有部分（主持端單獨保留有讀STOP，但回呼接收的shouldStop只讀stopped旗標，STOP檔案沒有傳到接收頁）**。
- 來源：https://nodejs.org/api/fs.html#fsexistssyncpath ，既有host STOP介面與receiver shouldStop迴圈。
- 切片：主持端自己的共享shouldStop函式檢查STOP；回呼完成後即使忽略取消也不回報completed；主持端單元在回呼中建立STOP確認狀態與owner清理；最多3檔／100行。沿用bonus03。

## 03：中文介面語言相容
因為原始需求是 **自動中文字幕**，所以頂尖做法會順便做 **有實際DOM的多語控制**；目前 **正式hl=en已測，尚無可行DOM缺口**。來源：https://support.google.com/meet/answer/15077804?hl=en-GB 。不猜選擇器。

## 10：滿幅樣本比例診斷
因為原始需求是 **可靠遠端音訊驗證**，所以頂尖做法會順便做 **削波量化**；目前 **只有峰值，但2/403456樣本滿幅，未有實際問題**。來源：https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData 。不自動改原音檔。


# 第十輪（完整句驗收數字邊界）

## 12：完整句內的確認碼也拒絕長數字誤中（bonus02續作）
因為原始需求是 **完整測試句與1357正確核對**，所以頂尖做法會順便做 **無論單獨marker或句子內marker，都維持數字邊界**；目前成果 **只有部分（獨立1357已有邊界，但完整句含1357走includes，13579可能當作1357）**。
- 來源：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion ，既有verification數字規則與本夜完整句驗收入口。
- 切片：純函式沿用正規化，每段數字都要求左右不是其他數字；標點仍忽略，不改原文／不做模糊比對。測試完整句13579、91357拒絕與正確1357、NFKC全形保留；最多2檔／80行，沿用bonus02。

## 03：中文UI控制相容（未有失敗DOM）
因為原始需求是 **自動中文字幕**，所以頂尖做法會順便做 **本地化控制**；目前成果 **hl=en正式策略已實測，缺實際失敗DOM**。來源：https://support.google.com/meet/answer/15077804?hl=en-GB 。不猜。

## 10：PCM飽和比例（沒有實際持續削波）
因為原始需求是 **可靠錄音驗證**，所以頂尖做法會順便做 **量化削波**；目前成果 **peak已存，實測僅2/403456滿幅，尚無需功能**。來源：https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData 。不改音訊。


# 第十一輪（剩餘候選）

## 03 中文介面字幕控制
因為原始需求是 **自動中文字幕**，所以頂尖做法會順便做 **非英文控制項相容**；目前成果 **正式hl=en已測而缺失敗DOM**。來源：https://support.google.com/meet/answer/15077804?hl=en-GB 。不猜。

## 10 PCM持續削波量測
因為原始需求是 **驗證錄音可用**，所以頂尖做法會順便做 **削波比例診斷**；目前成果 **峰值已有，實際僅2/403456滿幅，未見問題**。來源：https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData 。

## 12 完整句數字邊界
因為原始需求是 **確認1357而非較長數字**，所以頂尖做法會順便做 **全句數字段邊界**；目前成果 **a92a8bd已完成**。來源：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion 。標明已做，請scorer剔除。


# 第十二輪重新調研（反覆句與評估範圍）

## 13：完整句匹配次數（bonus02續作）
因為原始需求是 **無人驗證完整句與1357**，所以頂尖做法會順便做 **顯示重複場次中完整句至少出現幾次，而不是只true**；目前成果 **只有各marker布林值與原文，120秒重複句有對有錯，文件已明示不是100%準確**。
- 來源：https://huggingface.co/learn/audio-course/en/chapter5/evaluation ，語音系統應用實際輸出與參考比較、不能以單一成功當整體正確率。
- 切片：沿用嚴格normalized marker比對，額外計數，不改通過門檻、不稱WER、不從文字猜預期總次數。最多2檔／80行；也可判斷現有原文及文件已足夠，本夜無需擴充。

## 14：量化每句WER／CER
因為原始需求是 **確認逐字稿品質**，所以頂尖做法會順便做 **用已對齊參考句算錯誤率**；目前成果 **只有連續循環語音與截斷邊界，缺每句時間對齊真值**。
- 來源：https://huggingface.co/learn/audio-course/en/chapter5/evaluation 。要先建立逐段真值及對齊，不能以輸出自行推估句數；目前若直接算百分比會誤導。工作量與依賴不確定，請評估本夜價值，不新增套件。

## 15：跨音色與環境測試矩陣
因為原始需求是 **錄音與中文辨識可靠**，所以頂尖做法會順便做 **多音色、噪音、重疊語音矩陣**；目前成果 **只有單一Windows合成音色，真人歷史驗證另列**。
- 來源：https://huggingface.co/learn/audio-course/en/chapter5/evaluation 。目前沒有其他授權真人新錄音；多合成音色不代表真人，請評估是否會變成無謂重複外部測試。本夜不下載新模型、不使用私人舊錄音。
