# Duck Meeting Banner 素材

使用內建 image_gen 生成，淺色／深色各 3 張 PNG，無文字與按鈕。完整提示詞見 `prompts.json`；尺寸、檔案大小與 SHA-256 見 `manifest.json`。原始素材維持生成比例，不拉伸改圖；由 CSS 等比例縮放並裁切裝飾區。

| 款式 | 淺色 | 深色 |
| --- | --- | --- |
| 流動音波（建議預設） | wave-light.png | wave-dark.png |
| 環繞聲圈 | orbit-light.png | orbit-dark.png |
| 水面漣漪 | ripple-light.png | ripple-dark.png |

## 接入

素材已放在 `src/live/assets/banners/`，打包腳本會隨 src 帶入。來源版伺服器已明確列入六張 PNG、CSS、manifest 與預覽頁路由；不接受任意檔案路徑。

```html
<link rel="stylesheet" href="/assets/banners/banner.css">
<section class="meeting-banner" data-banner="wave">
  <h1>會議名稱</h1>
  <p>平台、時間與狀態</p>
</section>
```

`data-banner` 可用 wave / orbit / ripple；根元素 `<html data-theme="dark">` 自動選深色配對，light 使用淺色。兩種模式用完全相同尺寸；背景裝飾不佔 DOM 流程，不能承載文字或操作。圖片層不攔截點擊。

桌面建議高度 110px（min-height，長標題可延伸），背景固定 720px 寬、等比縮放、靠右置中；手機維持布局，降低裝飾透明度。不應使用 100% 100% 拉伸圖片，也不應用圖片取代真實標題／按鈕。正式整合標題工具列時，須額外檢查長標題與右上方操作的安全距離。

## 預覽與驗證

可直接用瀏覽器開啟此目錄的 `preview-light.html` / `preview-dark.html`，或啟動更新後來源伺服器查看 `/assets/banners/preview-light.html`。

```powershell
node --test test/qa/banner-assets.test.js test/qa/integrity.test.js
```

2026-11-01：5 項通過。實際 HTTP PNG 回應、六張圖片解碼與 manifest 尺寸、1440px/390px 無水平溢出、明暗切換幾何一致，並監聽 console/pageerror。桌面預覽已人工檢視。已將流動音波套用到會議標題區，並同步本機正式站台；另有 18 項實際標題／捲動相關測試通過。安裝包尚未重建。

## 樣式選擇與方向修正

正式頁面「設定 → 外觀 → Banner 樣式」提供三款切換，使用 `duck-meeting:banner` 保存；無效值回到 wave，storage 事件同步其他頁面。四張 orbit/ripple 素材以內建 image_gen 編輯為朝左，保留右側位置（指令：Change ONLY the duck facing direction to LEFT, preserve its position and composition）。wave 原圖已朝左。桌面圖片層右側保留 190px 操作區，底層漸層仍覆蓋全卡片；窄畫面降低裝飾強度。
