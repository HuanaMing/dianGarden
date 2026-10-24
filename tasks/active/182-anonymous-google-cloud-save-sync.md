# 任務 182：Cloudflare D1 跨裝置雲端存檔

## 狀態
執行中（active）。使用者已確認採用 Cloudflare Workers + D1 + Google 登入方向，目標是讓玩家換手機或電腦後可找回同一座花園。此確認只代表採用技術方向，不代表批准建立雲端資源、OAuth 用戶端、部署或啟用付費方案。

## 目標
在保留現有本機存檔與離線遊玩能力的前提下，讓玩家可先不登入遊玩，之後以 Google 帳號綁定花園，並在不同裝置間同步進度。優先控制成本與維護複雜度，按小型休閒遊戲需求設計。

## 已確認方向
- 使用 Cloudflare Workers + D1（SQLite 型雲端 SQL 資料庫）+ Google Identity Services，作為跨裝置存檔候選架構。
- 優先使用免費額度；尚未批准建立任何資源、設定 OAuth 或啟用付費服務。
- 本機遊玩與存檔在離線或雲端服務不可用時必須繼續可用。
- GitHub 繼續用於原始碼與靜態網站部署，不直接把 repository 當作可由前端任意寫入的玩家資料庫。
- 不得把 Google client secret、Cloudflare API token 或其他伺服器秘密放入前端或公開 repository。

## 已完成研究
- 查閱 Cloudflare Workers limits、Workers pricing、D1 pricing、D1 limits／FAQ 及 Google 官方 ID token 驗證指引。
- Workers Free 每日 100,000 次請求；每日額度用盡可能回傳 1027 錯誤。
- D1 Free 額度：每日 5,000,000 列讀取、100,000 列寫入；帳戶總計 5 GB；單一資料庫 500 MB；Time Travel 還原保留 7 天。
- D1 沒有依閒置 7 天自動暫停的相同規則，且不按閒置運算時間收費；免費額度用完時查詢會失敗。
- Workers Paid 最低 US$5／月。當前以免費方案為目標，不升級付費。
- Google 身分驗證應由前端取得 ID token，透過 HTTPS 傳給 Worker；Worker 必須驗證簽章、audience、issuer 與 expiry，並只使用驗證後的 `sub` 作為玩家識別碼。
- 伺服器秘密應放在 Cloudflare Worker Secrets，不能放在明文 vars、前端或 GitHub。
- 研究文件已建立：`docs/cloud-save-architecture.md`。

官方來源：
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/reference/faq/
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## 已完成的程式原型
- `cloudflare/worker.js`：建立 `GET /api/save`、`PUT /api/save` API 原型，驗證 Google ID token 簽章、issuer、audience、expiry，以已驗證的 `sub` 隔離玩家存檔；支援 body 大小限制、CORS 與 revision 衝突回應。
- `cloudflare/migrations/0001_create_player_saves.sql` 與 `cloudflare/schema.sql`：D1 存檔 schema。
- `cloudflare/wrangler.toml`：部署設定範本，仍使用未設定的 database ID、Google Client ID 及 origin placeholder，不能直接部署。
- `tests/cloudflare-worker-smoke.mjs`：建立 mock D1 與測試 RSA token 的 API 冒煙測試，涵蓋 CORS、驗證、玩家隔離、讀寫、revision 衝突及輸入大小。
- `.github/workflows/browser-check.yml`：將 Worker 冒煙測試加入 CI，並把 `cloudflare/**` 納入觸發條件。
- `docs/cloud-save-architecture.md`：補上原型檔案與尚未部署的限制。

## 已完成的前端整合原型
- `src/index.html`：設定面板新增跨裝置存檔區，提供 Google 登入容器、同步狀態、上傳本機花園、載入雲端花園、重新檢查及登出操作。
- `src/cloud-save-config.js`：公開設定 placeholder，未填入真實 Client ID 或 API URL，避免尚未配置時誤發請求。
- `src/cloud-save.js`：整合 Google Identity Services，登入後讀取雲端 revision；第一次綁定或本機／雲端版本不同時要求玩家明確選擇，不會自動覆蓋；上傳使用 baseRevision，偵測 409 衝突；雲端下載前再次確認會取代本機存檔；同步失敗時保留本機遊戲。
- `src/game.js`：本機成功存檔後發出 `diangarden:save` 事件，供雲端模組延遲同步；補上同步期間本機有新變更時的後續補傳。
- `src/styles.css`：新增設定區樣式。
- `src/index.html` 已載入設定與雲端存檔模組。

## 下一步
1. 確認 GitHub Actions 的 Worker 冒煙測試與瀏覽器驗收結果；目前無法從已連接的工具直接讀取完整 Actions run 清單，因此不能宣稱已通過。
2. 確認 GitHub Pages 正式 origin，並取得實際 Google Web Client ID 與 Worker API URL。
3. 只有在使用者另行明確批准後，才建立免費 D1／Worker 資源、建立 Google OAuth Web Client 或部署 API；本階段沒有建立外部資源或部署 Worker。

## 建議資料與 API 設計
- D1 先用一張 `player_saves` 表，每位玩家一筆，存放主存檔 JSON、花卉變種 JSON、自動選花偏好 JSON、schema version、revision、updated_at。
- `GET /api/save`：依已驗證的 Google `sub` 讀取存檔。
- `PUT /api/save`：要求 `baseRevision`；版本不一致回傳 409，不得靜默覆蓋。
- API 不接受前端指定 `user_id`，每個請求都要驗證 ID token。
- CORS 只允許正式遊戲 origin 與明確指定的本機開發 origin；CORS 不能取代身分驗證。
- 首次綁定若雲端無存檔才上傳；若雲端已有存檔，先讓玩家選擇本機或雲端版本。
- 本機重置不自動刪除雲端備份；同步失敗不得阻止遊戲遊玩。

## 驗收條件
- 不登入時遊戲完全照常運作。
- Google 登入後可將現有本機花園綁定帳號；另一裝置可找回同一座花園。
- 只可讀寫登入者自己的存檔。
- 衝突時明確提示，不靜默覆蓋。
- 網路中斷或額度用盡時本機遊戲仍可玩且本機進度保留。
- 沒有秘密進入前端或 repository。
- 未經明確批准，不建立外部資源、不部署、不產生付費用量。

## 既有存檔盤點（2026-10-24）
- 專案是原生 HTML／CSS／JavaScript 靜態網站，由 GitHub Pages 發布，沒有既有雲端存檔整合。
- 主存檔鍵：`sky-garden-save-v1`；花卉變種：`sky-garden-flower-variants-v1`；自動選花偏好：`sky-garden-auto-crops-v1`。
- 主存檔包含金幣、地塊及作物狀態、地塊座標與手動／草地標記、花園名稱與頭像設定、無人機位置／部署／電量、自動模式、世界時間及離線結算欄位。花卉變種最多 30 筆，地塊透過 `variantId` 參照變種。
- 存檔在主要狀態變更時寫入，頁面隱藏及 `pagehide` 再寫入；三個 localStorage key 分開寫入，沒有跨鍵原子交易。
- 現有載入器會驗證存檔及變種資料，`cropCatalogVersion` 目前為 4。
- 本機「重置進度」會刪除上述三個 localStorage key。雲端版不可將本機重置默認視為刪除雲端存檔。

## 費用與批准邊界
- 先前 Supabase 報價 US$0／月與 Cloudflare 無關。
- Cloudflare 免費額度與限制已依官方文件初步核對，但尚未查閱使用者 Cloudflare 帳戶實際方案／付款狀態。
- 使用者已批准採用 Cloudflare D1 方向，未批准建立 D1／Worker、建立 Google OAuth Web Client、部署 API 或啟用付費功能。
- 目前沒有建立 Cloudflare 資源，沒有更改外部設定，亦未把 Worker 接入遊戲前端；跨裝置功能尚未可供玩家使用。
- Worker 原型及 CI 測試已提交至 repository；GitHub Actions 的實際執行結果尚待確認。
