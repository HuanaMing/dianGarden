# 任務 232：建立可跨日恢復的長期登入工作階段

## 需求
依使用者於 2026-10-25 明確確認的方向，沿用現有 GitHub Pages 前端、Cloudflare Worker 與 D1，讓玩家 Google 登入一次後，在工作階段有效期間內可關閉瀏覽器、隔天再開啟遊戲，不必每次重新登入；持續使用時自動延續登入。不得新增 Supabase 等外部認證服務，也不得手動觸發 GitHub Pages 部署。

## 目前架構
- 前端：`src/cloud-save.js` 使用 Google Identity Services，將短效 Google ID Token 暫存於同分頁 `sessionStorage`。
- API：`cloudflare/worker.js` 目前每次 `/api/save` 請求都要求有效 Google ID Token，並驗證 Google 簽章、issuer、audience、exp。
- 資料庫：`cloudflare/schema.sql` 目前只有 `player_saves`，沒有獨立的登入工作階段或更新憑證資料表。
- 雲端同步具有 revision 與 `opened_at` 所有權保護；需保留其防止舊工作階段覆寫新存檔的行為。
- 訪客模式必須維持獨立，不得自動登入或同步雲端。

## 建議政策
- 存取憑證：約 15 分鐘。
- 長期登入閒置期限：30 天，玩家持續使用時以伺服器核發的更新流程延長；實際期限由伺服器控制。
- 主動登出：撤銷目前工作階段，已撤銷更新憑證不得再次使用。
- 重新開啟遊戲：在有效期限內自動恢復自己的花園，若工作階段已過期／撤銷，回到既有 Google 登入或訪客入口。
- Google ID Token 只用於首次建立工作階段；後續雲端存檔讀寫改用遊戲自己的短效存取憑證。
- 更新憑證採高熵隨機值、伺服器只保存雜湊、每次更新輪替並拒絕重複使用；偵測到已輪替舊憑證再次使用時撤銷相關工作階段。
- 保留既有使用者資料、revision、`stale_session`、訪客資料隔離與本機存檔降級行為。
- 不在網址、日誌或一般文件中記錄任何原始憑證。

## 實作前需釐清的安全取捨
目前 GitHub Pages 前端與 Worker 位於不同網站來源。跨來源 HttpOnly Cookie 可能受到瀏覽器第三方 Cookie 政策阻擋；不能假設它能在所有玩家裝置上穩定運作。若不新增同站自訂網域，替代方案是由前端保存不透明的更新憑證並採嚴格輪替／撤銷，但 JavaScript 可讀取的長期憑證會增加 XSS 竊取風險。
- 優先評估是否能使用同站自訂網域及 HttpOnly、Secure、適當 SameSite Cookie。
- 若目前沒有可配置的同站網域，先向使用者說明風險與替代方案，取得明確選擇後再決定長期憑證儲存位置；不得將此安全取捨默默視為已批准。

## 預計修改範圍
- `cloudflare/worker.js`：建立工作階段、短效存取憑證驗證、更新／輪替、登出撤銷、到期清理與 API 錯誤處理。
- `cloudflare/schema.sql` 與新增 migration：工作階段及更新憑證雜湊資料；不破壞既有 `player_saves`。
- `src/cloud-save.js`：首次 Google 驗證、保存可恢復的登入狀態、啟動時更新憑證、更新失敗時安全降級、登出撤銷、持續同步時自動更新。
- `tests/cloudflare-worker-smoke.mjs`：涵蓋建立工作階段、有效／過期存取憑證、更新輪替、重播舊更新憑證、撤銷、跨使用者隔離、既有存檔 revision 與 session ownership。
- `tests/browser-smoke.mjs`：涵蓋重新載入、瀏覽器重新開啟的可測模擬、背景／前景恢復、訪客模式不受影響、登出、更新失敗與雲端同步回歸。
- `docs/architecture.md`、`docs/desicions.md`、任務狀態與歷史紀錄。

## 驗收條件
1. Google 登入後建立遊戲專用工作階段，後續存檔請求不再依賴原 Google ID Token 一直有效。
2. 有效期間內重新開啟頁面可恢復登入；30 天閒置期限由伺服器強制執行，活動延長規則明確。
3. 存取憑證約 15 分鐘到期，前端可無感更新；更新失敗時不得無限重試或丟失本機進度。
4. 更新憑證輪替、重播偵測與登出撤銷有 Worker 測試覆蓋。
5. 不同 Google 使用者的存檔與工作階段完全隔離。
6. 保留 revision conflict、`stale_session`、訪客模式及既有本機存檔相容性。
7. Browser smoke 與 Worker smoke tests 通過；未執行的部署或線上測試須如實註明。
8. 不手動部署 GitHub Pages；若需變更 Cloudflare 生產資料庫／部署設定，先確認 migration 相容性及所需操作，不假稱已部署。

## 已確認的實作取捨（2026-10-25）
使用者選擇 B：維持 GitHub Pages + Cloudflare Worker + D1，不新增自訂網域或外部認證服務；以簡單、易維護為優先，接受 JavaScript 可讀取瀏覽器長期更新憑證的 XSS 風險。仍保留基本的憑證雜湊、期限、輪替及登出撤銷，不把 API 開放成無需驗證。

實作採用遊戲專用的不透明存取／更新憑證：15 分鐘存取期限、30 天閒置期限；更新憑證存在 localStorage，伺服器只保存 SHA-256 雜湊。更新時輪替更新憑證；舊憑證重播時撤銷工作階段。Google ID Token 僅用於首次登入建立工作階段。正式 Cloudflare D1 migration 與 Worker 部署不在本次自動執行範圍，須先驗證程式與 migration，再由使用者操作／確認生產環境變更。

## 狀態
**blocked：等待使用者批准生產 D1 migration 與 Cloudflare Worker 部署。** 核心程式與測試已提交 GitHub：
- `cloudflare/worker.js` 新增建立／更新／登出工作階段 API，存取憑證 15 分鐘，更新憑證輪替，偵測重播並撤銷工作階段。
- `cloudflare/schema.sql` 與 `cloudflare/migrations/002-player-sessions.sql` 新增工作階段表格。
- `src/cloud-save.js` 首次 Google 驗證後改用遊戲專用憑證；更新憑證存於 localStorage，頁面啟動時自動更新並恢復登入。
- `tests/cloudflare-worker-smoke.mjs` 新增工作階段建立、輪替、重播、撤銷、效期及存檔隔離測試。
- `tests/browser-smoke.mjs` 改為驗證跨頁恢復、憑證輪替及登出。

驗證結果（2026-10-25）：
- GitHub Actions run 40190581981 通過：Cloudflare Worker smoke tests 與 Playwright 桌面／手機瀏覽器回歸測試通過，包含長期登入恢復、更新憑證輪替、登出清除、舊版 Worker 相容降級與既有 stale_session 行為。
- GitHub Pages 由 main push 自動工作流程部署成功；沒有手動觸發部署。
- 尚未執行生產 D1 migration 或 Cloudflare Worker 部署。現行線上 Worker 仍須更新後，長期登入功能才會正式啟用；前端相容降級會在舊 Worker 存在時繼續使用短效 Google ID Token 流程。

阻塞事項：生產 D1 migration 與 Cloudflare Worker 部署屬正式環境變更，尚未獲使用者明確批准。需要先套用 `cloudflare/migrations/002-player-sessions.sql`，再部署新版 `cloudflare/worker.js`，之後才可線上驗收長期登入。
