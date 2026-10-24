# Windows：安裝到 Codex 與 Claude Code

openmeeting 的 CLI 負責加入 Google Meet、記錄字幕與錄音；兩種 AI 介面共用這份本機程式。Codex 使用技能，Claude Code 使用外掛。摘要由對話中的 AI 根據逐字稿產生。

## 需求與下載

- Windows 10/11、Node.js 22 以上、Google Chrome。
- 使用 Codex 時，需要可操作這台電腦的本機 Codex；使用 Claude Code 時，需要 `claude` CLI 已安裝並在 PATH 中。
- 語音轉錄備援另需 uv 與 Python 3.12，可於稍後安裝。
- GitHub 儲存庫目前是私有的，下載者需要該儲存庫的讀取權限。

```powershell
git clone https://github.com/jaylooloomi/open-meeting.git
cd open-meeting
npm install
npm run setup
```

`npm install` 只安裝依賴，不會自行修改 AI 工具設定。`npm run setup` 才會同時安裝兩邊，並啟用 Claude 外掛；安裝前會檢查 `claude` 是否存在。只有 Codex 的使用者請選擇 Codex 目標：

```powershell
npm run setup -- --target codex
npm run setup -- --target claude
npm run setup -- --target both
npm run setup -- --dry-run
```

可保留舊指令：`npm run install-plugin` 只安裝／更新 Claude Code 外掛；`npm run install-codex` 只安裝 Codex 技能。

## 安裝位置及更新

Codex 預設安裝到 `$CODEX_HOME/skills/openmeeting`，未設定 `CODEX_HOME` 時為使用者家目錄的 `.codex/skills/openmeeting`。若你的 Codex 使用其他技能根目錄，可直接指定**技能的父目錄**，例如官方新版使用的 `.agents/skills`：

```powershell
npm run setup -- --target codex --skills-dir "$HOME/.agents/skills"
```

同一份技能選擇一個安裝位置即可，避免在多個根目錄安裝同名技能。Codex 技能保持自動選用啟用；安裝後開新對話，如仍看不到技能再重啟 Codex。

Codex 安裝內容來自專案的 `codex/skills/openmeeting/`，並額外產生 `runtime.json`，記錄本機專案與 Node 的絕對路徑。橋接腳本從任何工作目錄都能呼叫同一份 CLI；設定檔不包含 Google 密碼、Token、Chrome 設定檔或錄音。原始技能沒有作者電腦的固定帳號與路徑。

Claude 仍使用本機 marketplace `openmeeting-local` 及 `openmeeting@openmeeting-local`；安裝後執行 `/reload-plugins` 或重啟 Claude Code。安裝器會處理同版本技能快取未更新的情況。

更新程式後重跑同一個安裝指令即可；搬移專案或 Node 後也要重跑。不要刪除安裝時指向的專案資料夾。

若目的地已有不是本安裝器管理的同名技能，預設拒絕覆寫。先備份並確認是要替換的技能，再使用：

```powershell
npm run setup -- --target codex --force
```

`--force` 只更新這個技能的已知檔案，不刪除額外的自訂檔案；不會繞過對符號連結／junction 的保護。先前手動建立的個人版 openmeeting 可用此方式遷移。若已安裝 Codex 後 Claude 安裝失敗，錯誤會明示兩邊狀態；修正原因後重跑即可。

## 首次使用

```powershell
node bin/openmeeting.js doctor
node bin/openmeeting.js login
```

在專用 Chrome 視窗手動登入機器人帳號，完成後關閉整個專用視窗。平常以自己的帳號在另一個 Chrome 視窗參加會議。

Codex 新對話貼上 Meet 連結並說「幫我加入並記錄」，或明確輸入：

```text
$openmeeting https://meet.google.com/abc-defg-hij
```

Claude Code 使用：

```text
/openmeeting:meet https://meet.google.com/abc-defg-hij
```

主持人放行機器人並告知與會者會議正在被記錄。已登入的機器人顯示 Google 帳號名稱；自己的聲音由自己的帳號開麥克風送進會議，機器人保持麥克風與攝影機關閉。

結束後說「離開會議並整理摘要」。AI 會收尾並讀取逐字稿，輸出摘要與待辦。Codex 的背景完成通知依宿主能力而定；沒有完成通知時，回到原對話說「整理這場會議」。

## 驗證與移除

有字幕或錄音長度不代表有聲音。用 `status` 看 `stats.audioPeak`，並播放 WAV 或執行 `transcribe`，確認錄音包含測試句。詳見 README 的「確認字幕與錄音成功」。

移除 Claude 整合：

```powershell
claude plugin uninstall openmeeting@openmeeting-local
claude plugin marketplace remove openmeeting-local
```

移除 Codex 整合：先確認實際安裝位置，再刪除該根目錄下的 `openmeeting` 技能資料夾。刪除技能不會刪除專案、Google 登入資料或會議記錄。
