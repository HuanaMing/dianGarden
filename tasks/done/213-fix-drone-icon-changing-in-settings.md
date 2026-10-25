# 任務213：修復設定介面造成無人機圖示異常

## 來源
使用者回報：只要開啟設定介面，上方資訊欄中的無人機 icon 就會異常變成「🚁」。

## 工作範圍
- 追查設定面板開啟時，對頂部資訊欄、無人機按鈕或圖示 DOM/CSS 的影響。
- 確認圖示原本應使用的資產或既有呈現方式，找出被替換成「🚁」的直接原因。
- 以最小修改修復，不改動無關圖示與設定面板行為。

## 預計檢查檔案
- `src/index.html`
- `src/styles.css`
- `src/management-panels.css`
- 與設定面板及無人機圖示相關的 JavaScript
- `tests/browser-smoke.mjs`

## 驗收條件
- 初始狀態與開啟設定面板後，上方資訊欄的無人機圖示均維持預期圖像，不會被替換成「🚁」。
- 開啟、關閉設定面板多次後仍正常。
- 桌面及手機瀏覽器回歸測試通過，或清楚記錄無法驗證的部分。

## 執行結果
- 已修正 `src/game.js`：移除 `setDronePanelOpen()` 對無人機按鈕的 `textContent` 覆寫，開關面板時保留既有圖片。
- 已更新 `tests/browser-smoke.mjs`：確認開啟／關閉無人機面板後，按鈕圖片路徑仍為 `assets/btn/無人機管理.png`；更新素材數量檢查，反映修正後圖片不再被移除。
- GitHub Actions 瀏覽器驗收 run [#501](https://github.com/HuanaMing/dianGarden/actions/runs/40159070750) 通過（commit `b78d4eaa058bd575864fca929f2c42b1a7fd5d1b`）。

## 執行狀態
已完成。