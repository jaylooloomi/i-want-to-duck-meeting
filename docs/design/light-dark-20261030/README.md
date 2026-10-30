# White / dark appearance

Real browser captures of the same isolated synthetic meeting fixture:

- [White / Emerald](light.png)
- [Dark / Midnight](dark.png)

Use the workspace's bottom-left 深色／淺色 button or 設定 → 外觀風格. Both controls share `duck-meeting:theme` in browser localStorage and synchronize across same-origin tabs. Saved appearance is applied by a same-origin script before the CSS links. Switching changes the palette and controls only; meeting data and media elements are retained. Denied storage still allows switching with a visible persistence warning.

The first dark screenshot exposed a light main background; a later inspection found an inherited low-contrast activity color. Both were fixed and now have browser-computed contrast assertions. Early interrupted test runs are diagnostic, not acceptance results. No screenshot editing, image-based controls, model calls or dependencies were introduced.

[Verification report](../../qa/reports/themes-20261030.md)
