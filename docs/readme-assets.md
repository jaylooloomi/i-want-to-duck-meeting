# README 圖片與生成紀錄

兩張圖均為新生成的功能情境插畫，不是實際產品介面截圖，也不是錄音成功或辨識正確率的證據。

- 生成方式：內建 `image_gen`，未使用 CLI 或額外 API 金鑰。
- 風格參考：[i-want-to-sleep 繁體中文 README](https://github.com/jaylooloomi/i-want-to-sleep/blob/main/README.zh-TW.md)。
- 參考圖：[hero-zh.png](https://github.com/jaylooloomi/i-want-to-sleep/blob/main/docs/hero-zh.png)、[morning-zh-v1.png](https://github.com/jaylooloomi/i-want-to-sleep/blob/main/docs/morning-zh-v1.png)。
- 延續橘色章魚、暖色日光、深藍與綠色面板的視覺語言；新場景改為會議記錄與人工檢查成果。
- 圖片保存在專案內，README 不依賴作者電腦的生成暫存路徑。

## 主視覺

檔案：`images/meeting-hero-zh.png`。左右對照開會記筆記與交由助手保存音訊、逐字稿的情境。

生成提示詞：

```text
Use case: illustration-story. Asset type: wide 16:9 GitHub README hero for i-want-to-meeting. Reference image at provided path is STYLE REFERENCE only, not an edit target. Create a new original illustration in the same charming polished 3D animated editorial cartoon aesthetic, rounded forms, orange octopus mascot, saturated warm orange versus midnight navy, luminous mint green technology panels, rich cozy cinematic light. A two-scene composition with subtle diagonal split: left a flustered meeting participant wearing headphones at a laptop, trying to listen while taking too many handwritten notes; daylight workspace. Right a cheerful capable orange octopus wearing a modern communication headset (NOT construction helmet), operating a laptop and a smartphone conference, holding a microphone, audio waveform card, transcript pages and a checklist, while the human calmly participates in the meeting. Show two distinct audio waveform lanes and a transcript panel with abstract lines, plus document/checklist icons, not performance statistics. Exact short Traditional Chinese labels only: left '專心開會'; right '記錄交給 AI'. Beautiful bold readable Traditional Chinese typography in rounded bottom pill labels. No other text, no logos, no watermarks, no test-pass badges, no claims of perfect recognition. Wide balanced composition suitable for 900px GitHub display. Full opaque background.
```

## 散會成果

檔案：`images/meeting-review-zh.png`。參與者與助手檢查逐字稿、錄音、摘要及待辦，強調人工複核。

生成提示詞：

```text
Use case: illustration-story. Asset type: wide 16:9 supporting GitHub README illustration for i-want-to-meeting. Reference image 1 is the character and palette reference (orange octopus with communication headset); reference image 2 is the warm celebratory composition/style reference only. Generate an original new after-meeting scene: a friendly human at a cozy daylight home-office desk reviewing a meeting summary on a laptop, alongside the same helpful orange octopus wearing a dark communication headset and holding transcript pages, a waveform recording card, and a task checklist. The human is relaxed and checking the results, not sleeping. Large wall/display behind them has FOUR elegant legible document panels with exact Traditional Chinese headings '逐字稿', '錄音', '摘要', '待辦'; underneath headings use abstract gray lines, waveform shapes, and unchecked/checklist icons only, no body text. Large celebratory title at top, exact text '散會，重點留下。'. Rich polished 3D animated cartoon illustration, rounded orange mascot, expressive eyes, warm gold sunlight mixed with navy and teal-green UI light, matching references. No construction helmet, no financial charts, no brand logos, no perfect accuracy claims, no fake metrics, no extra text, no watermark. Convey that the human reviews the AI output. Keep composition clean and readable at 900px width. Full opaque background.
```
