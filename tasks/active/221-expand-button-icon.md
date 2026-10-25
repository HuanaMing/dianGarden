# 任務 221：展開介面按鈕改用指定圖示

## 需求
將介面「展開」動作的按鈕圖示替換為 `assets/btn/展開.png`，不再以 emoji 作為視覺圖示。

## 範圍
- 檢查 `src/index.html`、`src/sky-world.js`、`src/game.js`、`src/styles.css` 與 `tests/browser-smoke.mjs`。
- 確認收合後保留的恢復入口及快捷圓環中的展開入口皆使用正確素材。
- 保留任務 220 已完成的收合圖示行為，不修改無關互動。

## 驗收條件
- 介面收合時，恢復介面的按鈕顯示 `assets/btn/展開.png`。
- 圖片使用明確尺寸與適當的 `alt=""`／`aria-hidden="true"`，按鈕仍保留「展開介面」等可存取名稱。
- 點擊後仍會恢復介面；快捷圓環中的展開入口也顯示正確素材。
- 桌面與手機 Playwright 驗收確認收合／展開狀態切換、圖片來源及載入狀態正確。

## 執行紀錄
- 已提交 `src/game.js`：依 `game.hudCollapsed` 切換頂部按鈕的 `assets/btn/收合.png`／`assets/btn/展開.png`。
- 已提交 `src/sky-world.js`：快捷圓環開啟時依 `aria-expanded` 狀態切換對應圖示，並保留「展開介面／收合介面」無障礙名稱。
- `src/index.html` 已有空白 alt 與 `aria-hidden`，不需更動結構。

## 狀態
執行中；尚未完成瀏覽器驗收。`tests/browser-smoke.mjs` 仍有任務220已知的手機圖示數量斷言（預期4個，實際5個），且其中任務220的頂部圖示斷言也需同步調整為狀態式圖示。先前對該測試檔的寫入遭安全檢查連續阻擋，依專案規範不以其他途徑繞過；因此本任務不可標記完成，待測試檔寫入阻擋解除後再更新斷言並驗收。
