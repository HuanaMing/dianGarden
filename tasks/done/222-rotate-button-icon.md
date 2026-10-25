# 任務 222：快捷圓環旋轉圖示改用指定素材

## 需求
將快捷功能圓環中「旋轉」動作的圖示替換為 `assets/btn/旋轉.png`，不再使用旋轉 emoji。

## 範圍
- 檢查 `src/index.html`、`src/sky-world.js`、`src/styles.css` 與 `tests/browser-smoke.mjs`。
- 只更換旋轉入口的視覺圖示；保留長按輪盤、選取旋轉項目、開始旋轉及放開停止的既有操作流程。

## 驗收條件
- 快捷圓環的旋轉入口使用 `assets/btn/旋轉.png`，圖片尺寸依圓環現有圖示比例設定。
- 按鈕仍有可存取名稱「旋轉」，`aria-pressed` 與旋轉狀態同步。
- 圖片載入成功，不遮擋輪盤選取效果或觸控回饋。
- 桌面與手機 Playwright 驗收確認圖片來源、載入狀態及原有旋轉互動不變。

## 執行結果
- `src/index.html`：將旋轉入口的 emoji 移除，新增獨立 `wheel-icon-overlay`，使用 `assets/btn/旋轉.png`；按鈕仍保留 `aria-label="旋轉"` 與 `aria-pressed`。
- `tests/browser-smoke.mjs`：新增旋轉素材來源與載入檢查，更新桌面六個圖示與手機六個圖示的數量、尺寸及位置斷言；同步修正任務220、221的狀態式頂部圖示斷言。
- 既有旋轉操作流程與 `aria-pressed` 切換程式未更動。
- GitHub Actions Playwright 桌面／手機完整驗收通過：[run 40166239723](https://github.com/HuanaMing/dianGarden/actions/runs/40166239723)。日誌確認 `result: PASS`，旋轉素材已載入、桌面與手機圓環圖示尺寸及位置通過，既有旋轉模式開始／放開退出檢查通過。

## 狀態
已完成，2026-10-25。
