# 任務209：將自動儲存狀態移至跨裝置存檔區（已完成）

## 來源
由原任務205總規劃拆分；需待任務208完成後依序執行。

## 工作內容
- 將「進度會自動儲存」提示移至「設定 → 同步 → 跨裝置存檔」區域。
- 移除原位置的重複顯示。
- 本機存檔失敗或儲存空間不可用時，仍須在新位置顯示清楚警告。
- 不更動自動儲存觸發時機、存檔策略或存檔格式。

## 驗收條件
- 一般狀態下自動儲存提示只在跨裝置存檔區出現。
- 儲存警告仍可見並保留醒目的錯誤狀態。
- 自動存檔與重新載入回歸測試通過。

## 預計檔案
- `src/index.html`
- `src/styles.css`
- `src/game.js`
- `tests/browser-smoke.mjs`

## 執行紀錄
- 2026-10-25：任務208已驗收通過，開始執行任務209。將把 `#save-status` 移入跨裝置存檔區，保留既有 `updateSaveStatus()` 與自動儲存策略，只調整狀態提示的位置與版面。


## 實作與驗收結果
- `src/index.html`：將 `#save-status` 移入「跨裝置存檔」區，移除原本位於同步分頁底部的獨立提示。
- 保留 `src/game.js` 的 `updateSaveStatus()`、儲存警告文字及既有自動儲存觸發機制，未更動存檔策略。
- `tests/browser-smoke.mjs`：新增 DOM 位置與重複顯示檢查，確認一般狀態顯示「進度會自動儲存」。
- Playwright 瀏覽器驗收通過：[run 40148593272](https://github.com/HuanaMing/dianGarden/actions/runs/40148593272)。
- Pages 部署成功：[run 40148574104](https://github.com/HuanaMing/dianGarden/actions/runs/40148574104)。
