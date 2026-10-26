# 執行覆蓋率審計

- src/live/microphone.js: 134/136 非空行，98.53%（Chrome precise JS, nonblank lines with any executed character）
- src/live/app.js: 75/77 非空行，97.4%（Chrome precise JS, nonblank lines with any executed character）

瀏覽器資料包含真正執行的原生前端腳本；不把HTML/CSS或AudioWorklet獨立執行緒納入這個JS分母。行內任一字元命中不表示該行所有分支都覆蓋。Node後端line/branch/function依各回歸log的原生V8表；Python依python-coverage.json，分母包含未測腳本。
