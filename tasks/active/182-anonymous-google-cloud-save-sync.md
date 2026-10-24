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

## 下一步
1. 確認正式 GitHub Pages origin 與 workflow，列出正式站及本機測試所需的 Google OAuth JavaScript origin。
2. 與使用者確認是否已具備 Cloudflare 帳戶、是否同意之後建立免費 D1／Worker 資源，以及 Google OAuth Web Client 的設定方式。
3. 在批准建立外部資源之前，可先設計本機可測試的 Worker handler、schema migration 與 API 測試，但不可部署或建立線上資源。
4. 完成上述前置條件後，再整合前端登入與自動同步；保留原本 localStorage 的三個存檔 key。

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
- 目前沒有建立 Cloudflare 資源，沒有更改外部設定，也沒有修改遊戲存檔程式。
