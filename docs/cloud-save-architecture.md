# 任務 182：Cloudflare 跨裝置存檔架構評估

更新日期：2026-10-24

## 結論

以 Cloudflare Workers + D1 + Google Identity Services 為優先候選，符合本遊戲的輕量靜態網站、低維護與跨裝置需求。D1 可在 Workers Free 與 Paid 方案使用，沒有依資料庫閒置天數自動暫停的規則；官方定價說明採查詢用量與儲存量計費，閒置時不收資料庫運算費。Workers Free 仍有每日請求上限，因此「不會因閒置暫停」不等於沒有服務配額限制。

已在 repository 加入尚未部署的 Worker API 原型、D1 migration、Wrangler 設定範本、冒煙測試，以及遊戲前端的登入／同步 UI。這些檔案不代表已建立 Cloudflare 資源、OAuth 用戶端或部署 API。

## 官方費用與限制（查閱日期：2026-10-24）

- Workers Free：每日 100,000 次請求；每次請求 CPU 時間 10 ms。超過每日請求上限時會回傳 Cloudflare 1027 錯誤。
- D1 Free：每日 5,000,000 列讀取、100,000 列寫入；帳戶總儲存 5 GB；每個資料庫 500 MB；Time Travel 時間點還原保留 7 天。
- D1 不按閒置時數收費，亦沒有 Supabase Free「閒置一段時間自動暫停專案」的相同規則。
- Workers Paid 最低 US$5／月；目前不需要先升級。若日後需要 Paid 或任何有費用服務，必須先取得使用者明確批准。
- Free 配額超出時，Workers API 或 D1 查詢可能失敗；不得把雲端可用性當成遊戲啟動的必要條件。須保留本機存檔並清楚提示同步失敗。
- 官方文件：
  - Workers limits：https://developers.cloudflare.com/workers/platform/limits/
  - Workers pricing：https://developers.cloudflare.com/workers/platform/pricing/
  - D1 pricing：https://developers.cloudflare.com/d1/platform/pricing/
  - D1 limits：https://developers.cloudflare.com/d1/platform/limits/
  - D1 FAQ：https://developers.cloudflare.com/d1/reference/faq/

## Google 身分驗證方案

建議前端使用 Google Identity Services 取得 ID token，透過 HTTPS POST 傳給 Worker。Worker 必須在伺服器端驗證 token 簽章、audience（指定的 Google Web Client ID）、issuer、expiry，並只使用已驗證 token 的 `sub` 作為穩定玩家識別碼；不可相信前端自行傳來的 email 或 playerId。

- Google 官方驗證指引：https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Google Client ID 是前端可使用的公開識別設定，不等同秘密；Google client secret（若後續流程需要）及 Cloudflare API token 不可放在前端或 repository。
- Worker 的伺服器秘密必須放在 Cloudflare Worker Secrets；不可放在明文 vars 或 GitHub 原始碼。
- 必須在 Google Cloud Console 設定 OAuth consent screen／Web client，加入遊戲實際 origin；目前需先確認正式 GitHub Pages 網址及本機測試 origin。
- 確認 Google OAuth 與 Worker 部署條件之前，不部署，也不建立外部資源。

## API 與資料設計草案

### D1 schema

先採一列一玩家、整份存檔 JSON 的簡單設計，避免將花園地塊、作物與無人機過度正規化。實際 schema migration 應於建立資源前再審閱。

```sql
CREATE TABLE IF NOT EXISTS player_saves (
  user_id TEXT PRIMARY KEY,
  save_data TEXT NOT NULL,
  variants_data TEXT NOT NULL,
  auto_crops_data TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
```

### Worker API 草案

- `GET /api/save`：驗證登入 token，回傳該使用者存檔與 revision；沒有存檔時回傳明確的 `not_found`。
- `PUT /api/save`：驗證登入 token、限制 body 大小、驗證三個資料元件格式及 schema version，並要求用戶端提供 `baseRevision`。
- 若 `baseRevision` 與伺服器目前 revision 不一致，回傳 `409 Conflict` 及目前 revision；不可直接覆寫。
- 所有查詢均以伺服器驗證後的 Google `sub` 為 key。API 不接受前端指定的 `user_id`。
- 僅允許正式遊戲 origin 與明確允許的本機開發 origin；設定 CORS 並驗證請求來源。CORS 本身不作為身分驗證。
- 對請求 body 設合理大小上限，防止異常大存檔消耗額度。

### 同步流程

1. 玩家第一次遊玩時，仍只用現有 localStorage，不要求登入。
2. 玩家登入後，如果雲端沒有存檔，提供「將目前花園上傳到雲端」的明確動作。
3. 如果雲端已有存檔，先比較更新時間／revision，讓玩家選擇保留本機或雲端；不得靜默覆蓋。
4. 本機保留三個既有 key：`sky-garden-save-v1`、`sky-garden-flower-variants-v1`、`sky-garden-auto-crops-v1`。雲端失敗時仍能遊玩。
5. 成功同步後記錄最後已同步 revision；若另一裝置已有較新 revision，要求重新載入或手動選擇，避免丟失進度。
6. 本機重置只清除本機進度，不自動刪除雲端存檔。

## 已建立的原型（尚未部署）

- `cloudflare/worker.js`：`GET /api/save` 與 `PUT /api/save`，使用 Google ID token 的簽章、issuer、audience、expiry 驗證，並以已驗證的 `sub` 隔離玩家資料；使用 revision 條件更新避免靜默覆蓋；限制 body 大小及 origin。
- `src/cloud-save-config.js`：公開設定範本，只包含 Google Web Client ID 與 Worker API URL 的空值；未設定時雲端登入維持停用。
- `src/cloud-save.js`：設定面板中的 Google 登入、讀取雲端存檔、由使用者選擇本機或雲端版本、上傳與 revision 衝突處理；本機存檔更新事件會觸發延遲同步。
- `src/index.html`、`src/styles.css`：加入雲端存檔設定區及樣式；`src/game.js` 在本機成功存檔後發出同步事件。
- `cloudflare/migrations/0001_create_player_saves.sql`：D1 初始資料表 migration。
- `cloudflare/schema.sql`：同一資料表 schema 參考。
- `cloudflare/wrangler.toml`：部署設定範本，資料庫 ID、Google Client ID、允許來源都是未配置的 placeholder，不能直接部署。
- `tests/cloudflare-worker-smoke.mjs`：用本機 mock D1 與測試 RSA key 驗證 CORS、登入驗證、玩家隔離、存檔讀寫、版本衝突及輸入大小限制。
- `.github/workflows/browser-check.yml`：已加入此冒煙測試步驟，並在 `cloudflare/**` 變更時觸發測試 workflow。

前端模組已接入遊戲設定面板，但正式登入／同步尚未啟用：`src/cloud-save-config.js` 的 Client ID 與 API URL 仍為空值。尚未在 Cloudflare 建立 D1／Worker，因此跨裝置功能目前尚不能供玩家實際使用。

## 實作前仍需確認

- GitHub Pages 實際正式 origin 與當前發布 workflow。
- Cloudflare 帳戶目前的 plan／付款設定；本次研究未連線或變更任何 Cloudflare 設定。
- 使用者需要自行建立或批准建立 Google OAuth Web Client，並確認允許的 origin。
- 使用者需另行明確批准建立 D1、Worker、部署外部 API 等會改變外部系統的操作。免費也要先批准建立資源；任何付費服務需另外批准。
- 完成上述確認後，才填入公開 Client ID／API URL 並進行真實服務整合測試；本機前端整合原型已建立，但尚未連接線上服務。

## 驗收方向

- 未登入時遊戲完全照常運作。
- Google 登入 token 由 Worker 驗證，玩家只能存取自己存檔。
- 跨裝置可以讀取同一玩家存檔。
- 衝突回傳 409，不無提示覆蓋。
- 網路中斷或配額耗盡時本機遊戲可玩、存檔仍留在 localStorage。
- 沒有把 secrets 放入前端或 GitHub；沒有未經批准建立資源或產生費用。
