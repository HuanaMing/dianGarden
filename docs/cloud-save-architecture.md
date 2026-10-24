# 任務 182：Cloudflare 跨裝置存檔架構評估

更新日期：2026-10-24

## 結論

以 Cloudflare Workers + D1 + Google Identity Services 為優先候選，符合本遊戲的輕量靜態網站、低維護與跨裝置需求。D1 可在 Workers Free 與 Paid 方案使用，沒有依資料庫閒置天數自動暫停的規則；官方定價說明採查詢用量與儲存量計費，閒置時不收資料庫運算費。Workers Free 仍有每日請求上限，因此「不會因閒置暫停」不等於沒有服務配額限制。

本文件只記錄設計與研究結果，不代表已建立 Cloudflare 資源、OAuth 用戶端或部署 API。

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

## 實作前仍需確認

- GitHub Pages 實際正式 origin 與當前發布 workflow。
- Cloudflare 帳戶目前的 plan／付款設定；本次研究未連線或變更任何 Cloudflare 設定。
- 使用者需要自行建立或批准建立 Google OAuth Web Client，並確認允許的 origin。
- 使用者需另行明確批准建立 D1、Worker、部署外部 API 等會改變外部系統的操作。免費也要先批准建立資源；任何付費服務需另外批准。
- 完成上述確認後，才開始跨模組整合；此之前可先完善文件、schema 草案及本機測試設計。

## 驗收方向

- 未登入時遊戲完全照常運作。
- Google 登入 token 由 Worker 驗證，玩家只能存取自己存檔。
- 跨裝置可以讀取同一玩家存檔。
- 衝突回傳 409，不無提示覆蓋。
- 網路中斷或配額耗盡時本機遊戲可玩、存檔仍留在 localStorage。
- 沒有把 secrets 放入前端或 GitHub；沒有未經批准建立資源或產生費用。
