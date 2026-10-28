# 任務 274：重置進度時同步清除本機與雲端存檔

## Bug 回報
使用者回報「重置進度」按鈕沒有把進度消除。

## 根因
- `src/game.js` 原本只移除本機遊戲存檔、作物選擇及花卉變種資料，沒有清除目前登入帳號的雲端存檔。
- `src/cloud-save.js` 的啟動流程會在發現雲端存檔後把雲端資料覆蓋回本機；即使本機清除成功，重新載入後仍可能恢復舊進度。
- 重置前若尚有待執行自動同步，舊存檔也可能再次上傳。

## 實作
- `src/game.js`：確認重置後先等待雲端重置成功，再清除目前模式的本機存檔、作物選擇、花卉變種與同步中繼資料，最後重新載入。若雲端刪除失敗，保留本機進度並提示重試。
- `src/cloud-save.js`：新增 `window.diangardenResetCloudSave()`，清除待執行同步計時器、暫停同步，並呼叫經驗證的雲端 DELETE API；成功後才清除同步中繼資料。訪客及未登入情境只清除本機花園，不呼叫雲端刪除。
- `cloudflare/worker.js`：新增需登入驗證的 DELETE 存檔 API。刪除條件同時核對登入使用者、存檔 revision 與目前 session 的 `opened_at`；版本衝突或舊 session 不得刪除資料。
- `tests/cloudflare-worker-smoke.mjs`：覆蓋存檔刪除、版本衝突及刪除後 GET 回傳 not_found。
- `tests/browser-smoke.mjs`：新增重置流程檢查，驗證按鈕會清除訪客本機存檔、作物選擇、花卉變種及同步中繼資料；更新 DELETE 的 CORS 測試標頭。

## 驗收
- 通過：工具輸出污染檢查。
- 通過：Cloudflare Worker smoke test（登入、工作階段、使用者隔離、存檔版本／擁有權、DELETE、版本衝突及刪除後查無存檔）。
- 通過：25 個 JavaScript/MJS 檔案語法檢查。
- 通過：Playwright browser smoke test，`browserErrors` 為空。
- 通過：`git diff --check`。
- 完整本機驗收於 2026-10-28 通過，執行紀錄位於 `test-results/runs/20261028-145451`。
- 尚未 commit、push 或部署。正式登入帳號的雲端重置需等 Cloudflare Worker 部署後才會生效。
