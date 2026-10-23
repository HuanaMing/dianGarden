# 任務 171：清理反覆修改遺留的無用程式碼

## 狀態
**Active（持續執行）**

## 恢復紀錄
使用者於 2026-10-23 要求重啟本任務。暫停原因（任務插隊）已解除。

## 已完成與目前進度
- 第 1 段：移除 `.brand-mark{font-size:31px}`，Playwright 驗收通過。
- 第 2 段：移除 `.wallet-label{font-size:12px;color:#aa9d76}`，Playwright 驗收通過。
- 第 3 段：移除 `.hero-cloud{position:absolute;font-size:35px;opacity:.72}`，已提交。
- 第 3 段驗收：[GitHub Actions run 39791960715](https://github.com/HuanaMing/dianGarden/actions/runs/39791960715) 已確認成功（conclusion: success）。
- 第 3 段提交：`0565b71e52dbab6717243365fb62a52fd0c157e2`
- 第 4 段：確認 `.cloud-a`、`.cloud-b` 僅剩舊版首頁的 CSS 定位宣告，現行 `src/index.html`、`src/game.js` 與圖鑑腳本均無引用；已移除兩個無效定位規則。
- 第 4 段提交：`e7324f2842af5c00591338b9f5eb8123a0a22a75`
- 第 4 段驗收：[GitHub Actions run 39878241016](https://github.com/HuanaMing/dianGarden/actions/runs/39878241016) 已確認成功（conclusion: success）。
- 驗收流程改善：因 Playwright 安裝步驟反覆耗時，已在 `.github/workflows/browser-check.yml` 加入 npm／Playwright 瀏覽器快取，並拆分套件、系統依賴與 Chromium 安裝步驟。
- 驗收流程改善提交：`1e6bfef3d173a8f2787f321e45d338d6fb682a54`
- 新版流程驗證：[GitHub Actions run 39879113329](https://github.com/HuanaMing/dianGarden/actions/runs/39879113329) 執行中；快取與 Playwright 套件安裝已完成，正在安裝 Chromium 系統依賴，尚待後續瀏覽器測試結果。

## 下一步
先等待 run 39879113329 完成並確認瀏覽器驗收成功，再盤點下一段無引用 CSS。不要在新版驗收結果出爐前繼續刪除程式碼。

## 原則
- 不以「看起來沒用」作為刪除依據；先查詢宣告、引用、事件綁定、跨模組介面與動態呼叫。
- 每一段刪除都要獨立提交，並在下一段修改前執行可用的靜態檢查及 Playwright 瀏覽器驗收。
- 若檢查失敗，先還原或修正該段，不得繼續累積未驗證變更。
- 不改變遊戲規則、模型外觀、操作流程、存檔格式或相容性。
- 不刪除僅因目前測試未覆蓋就看似無用的程式碼。
- 記錄每段刪除內容、判定依據、驗證命令與結果。
