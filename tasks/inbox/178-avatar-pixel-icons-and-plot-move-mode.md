# 任務 178：花卉頭像點陣圖與地塊移動操作調整

## 狀態
**Inbox（待開始）**

## 需求
1. 設定中「手動選擇花卉頭像」的選花介面改用 `assets/flowers/*.png` 點陣圖圖示，不再只用花卉 emoji。
2. 長按觸控環形進度條半徑增加至目前的 3 倍，線條粗細維持不變。
3. 地塊處於移動模式時，不需長按即可直接拖動地塊。
4. 移除長按地塊後才出現的那一組十字箭頭；改為在移動模式下直接顯示原本表示移動模式的十字箭頭，避免同時出現兩組移動提示。上下箭頭仍應只用於高度模式。

## 初步檢查與建議實作
- 頭像設定目前使用原生 `select#avatar-flower`，其選項由 `src/game.js` 的 `initializeAvatarSettings()` 動態產生。原生 select option 無法可靠地呈現圖片，因此建議改成原生 HTML/CSS 的自訂花卉選擇清單／格狀按鈕，使用每朵花在 `src/flower-catalog.js` 的 `image` 路徑及 `image-rendering: pixelated`；保留自動／手動模式、目前選取狀態與既有存檔欄位 `avatarMode`、`avatarCrop` 的相容性。
- 長按環形由 `src/sky-world.js` 的 `makeHoldRing()` 產生，SVG 目前為 40×40、圓半徑 16、線寬由 CSS `stroke-width: 3` 控制。半徑與容器視覺尺寸應放大 3 倍，並調整 SVG viewBox／座標以避免裁切；stroke-width 維持 3。若只放大半徑卻不放大 SVG 容器，會被裁切。
- 地塊移動狀態目前透過 `heightEdit.kind === 'plot' && heightEdit.mode === 'move'` 表示；目前 pointerdown 仍設 500ms `plotPressTimer` 才將 `dragPlotIndex` 設定為可拖曳。應在已選取地塊且已處於 move mode 時，pointerdown 即開始拖曳預覽；一般模式下仍保留既有長按進入移動模式流程，避免意外拖動。
- 場景目前在 `uploadWorld()` 以 `dragPreview` 繪製拖曳預覽的世界座標十字箭頭，且另有 `heightEdit` 模式提示幾何。修改時先確認兩組箭頭各自的繪製條件，讓移動模式的十字箭頭成為唯一移動提示；高度模式保留上下箭頭。
- 不改變地塊碰撞、網格吸附、無人機停靠平台操作、存檔格式或一般相機手勢。

## 驗收條件
1. 設定頁的 11 種花卉頭像選擇皆顯示正確 PNG 點陣圖，圖片成功載入並保持像素風格。
2. 自動／手動頭像切換、手動選花、頭像顯示及重整後存檔行為通過回歸測試。
3. 長按環形的半徑為原本 3 倍，CSS 線寬仍為 3，500ms 進度動畫、多指觸控及回饋點行為不退化。
4. 地塊已在移動模式時，按下後直接拖動可更新預覽並正常提交移動，不必再長按；一般模式長按進入移動模式的既有流程仍正常。
5. 移動模式只顯示一組十字方向提示；高度模式仍顯示上下箭頭，且沒有重複的十字箭頭。
6. 完整 GitHub Actions Playwright browser-smoke 通過，browserErrors 為空；截圖產物成功保存。
7. 更新任務執行紀錄、專案狀態與工作歷史。

## 相關檔案
- `src/index.html`：頭像設定 UI。
- `src/game.js`：頭像選擇初始化、切換、存檔與顯示。
- `src/sky-world.js`：長按環、地塊 pointer 操作與方向提示幾何。
- `src/styles.css`：頭像點陣圖選擇清單及長按環樣式。
- `tests/browser-smoke.mjs`：頭像選擇、環形尺寸、移動模式拖曳與箭頭顯示測試。
- `docs/architecture.md`：若操作規則實際變更，更新觸控及地塊移動模式說明。

## 執行紀錄
- 2026-10-23：檢查 `AGENTS.md`、`README.md`、專案狀態、頭像設定程式、場景 pointer handlers、長按環 SVG/CSS 與 Playwright 測試。已完成範圍分析；尚未修改功能程式，等待任務開始。
