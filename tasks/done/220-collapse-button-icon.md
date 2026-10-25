# 任務 220：收合介面按鈕改用指定圖示

## 需求
將介面「收合」動作的按鈕圖示替換為 `assets/btn/收合.png`，不再以 emoji 作為視覺圖示。

## 範圍
- 檢查 `src/index.html`、`src/sky-world.js`、`src/styles.css` 與 `tests/browser-smoke.mjs`。
- 釐清頂部 HUD 按鈕與快捷圓環中的收合入口，統一使用正確的收合圖片，不更改既有收合行為。

## 驗收條件
- 介面展開時，收合按鈕顯示 `assets/btn/收合.png`。
- 圖片使用明確尺寸與適當的 `alt=""`／`aria-hidden="true"`，按鈕仍保留「收合介面」等可存取名稱。
- 點擊後仍會收合介面；快捷圓環中的收合入口也顯示正確素材。
- 桌面與手機 Playwright 驗收確認圖片載入、來源正確且互動行為不變。

## 執行結果
- 頂部 HUD 收合按鈕及快捷圓環收合入口使用 `assets/btn/收合.png`。
- 保留按鈕可存取名稱及 `aria-expanded` 狀態，並移除會覆寫圖示的 emoji 更新邏輯。
- 後續任務221將頂部按鈕與圓環圖示擴展為依收合狀態顯示「收合／展開」兩種素材。
- 桌面與手機 Playwright 驗收通過：[run 40166239723](https://github.com/HuanaMing/dianGarden/actions/runs/40166239723)。包含頂部按鈕圖示載入、收合／恢復互動、無障礙狀態與圓環六個圖示素材檢查。

## 狀態
已完成，使用者於 2026-10-25 確認任務220驗收完成。
