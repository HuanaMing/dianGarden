# 任務 182：匿名遊玩與 Google 綁定的雲端存檔、自動同步

## 狀態
執行中（active）。前置任務 181 已完成並通過 GitHub Actions 驗收；本任務先進行存檔與同步方案盤點，任何付費資源或破壞性存檔變更均須先取得使用者批准。

## 目標
在保留目前本機存檔與離線遊玩能力的前提下，讓玩家先匿名遊玩，之後可綁定 Google 帳號，並在不同裝置間自動同步遊戲進度。

## 使用者已確認的方向
- 身分流程：匿名遊玩 → 綁定 Google 帳號。
- 同步方式：自動雙向同步。
- 離線行為：保留離線遊玩；重新連線後再同步。
- 開發順序：先完成並確認 `version.json` 版本檢查，再開始雲端存檔工作。

## 開始前必做盤點
- 檢查目前存檔 schema、寫入時機、重置流程、花卉變種資料與相容性。
- 提出匿名使用者、Google 綁定、帳號合併、衝突解決及離線佇列策略。
- 評估 Supabase Auth／資料表／Row Level Security 等方案；不得把 service-role 金鑰放在前端。
- 未經使用者明確批准，不建立付費服務、不啟用收費資源、不破壞現有本機存檔。
- 在實作前說明首次登入、跨裝置同步、帳號綁定失敗、兩裝置同時修改及匿名帳號遺失的處理方式。

## 驗收條件
- 玩家可直接匿名開始遊玩，不需先登入。
- 玩家可把匿名進度綁定 Google 帳號，且不遺失既有本機／匿名進度。
- 同帳號在支援裝置間自動同步；離線期間可繼續遊玩，恢復連線後按明確衝突規則同步。
- 未登入或網路不可用時，原本遊戲與本機存檔仍可用。
- 帳號只能讀寫自己的雲端存檔，經過存取政策驗證。
- 補足測試、文件、狀態與工作紀錄；在驗收前不得標記完成。

## 風險與注意事項
- 同步可能遇到同時編輯、過期雲端資料、匿名帳號轉綁與重複存檔等情況，必須先定義衝突策略。
- 不可將任何使用者存檔資料公開給其他玩家。
- 不可把前端可讀的公開設定金鑰誤當成權限保護；資料安全依賴身分驗證與資料庫政策。


## 盤點結果（2026-10-24）

### 現況與相容性
- 專案是原生 HTML／CSS／JavaScript 靜態網站，由 GitHub Pages 發布；沒有 npm 專案依賴或既有雲端存檔整合。
- 主要存檔鍵為 `sky-garden-save-v1`；花卉變種獨立保存於 `sky-garden-flower-variants-v1`；自動選花偏好保存於 `sky-garden-auto-crops-v1`。
- 主存檔包含金幣、地塊及作物狀態、地塊座標與手動／草地標記、花園名稱與頭像設定、無人機位置／部署／電量、自動模式、世界時間及離線結算所需欄位。花卉變種最多 30 筆，地塊透過 `variantId` 參照變種。
- 存檔在主要遊戲狀態變更時立即寫入，並在頁面隱藏及 `pagehide` 再寫入；三個 localStorage 鍵分開寫入，沒有跨鍵原子交易。
- 現有載入器會驗證存檔及變種資料；無效資料會保留原值並降級為當前工作階段，不會直接覆蓋。舊版缺少的欄位會以預設值補齊，`cropCatalogVersion` 目前為 4。
- 現有「重置進度」會刪除上述三個 localStorage 鍵並重新載入。雲端版不可默默把本機重置等同刪除雲端備份；雲端刪除應另設明確且可確認的流程。
- 已連線的 Supabase 帳戶目前只有一個名為 `daily-quest-rpg` 的非活躍專案，並非本遊戲專案；不會擅自挪用或修改它。

### 建議同步設計（外部服務批准後才實作）
1. 保留三個既有 localStorage 鍵作為離線工作副本，增加獨立的同步中繼資料，不直接改寫舊存檔格式；雲端載入資料必須通過既有驗證器後才可套用。
2. 採 Supabase Auth 匿名登入，讓初次遊玩不需填資料；使用者在同一匿名 session 內透過 Google OAuth 身分連結轉為正式帳號。匿名帳號若已登出、清除瀏覽器資料或換裝置，無法憑匿名身分找回，介面需清楚提示。
3. 雲端資料以 Auth 使用者 ID 作為唯一所有者，保存主存檔 JSON、花卉變種 JSON、自動選花偏好、schema 版本、單調遞增 revision、伺服器更新時間及最後寫入的 client ID。資料表必須啟用 RLS，並以 `auth.uid() = user_id` 限制讀寫；不得在前端放 service-role／secret key。
4. 只在有有效 session 且網路可用時同步；本機先寫入成功後，再排入雲端同步。網路中斷時保留本機進度與待同步標記，重新連線時重試；雲端錯誤不得阻止遊戲繼續。
5. 不使用單純「最後寫入者勝出」直接覆蓋衝突。每次上傳附帶讀取時的 base revision，僅在雲端 revision 未改變時更新；若另一裝置已先更新，先下載並比較。因金幣、作物、土地及無人機狀態彼此相依，不能安全地逐欄合併時，保留兩份候選存檔並要求玩家選擇「使用此裝置」或「使用雲端版本」，確認前不覆蓋任一份。
6. 首次雲端綁定時，若雲端沒有存檔則上傳目前匿名進度；若已存在雲端存檔，不自動覆蓋，先提供本機／雲端版本選擇。若 Google 身分已屬於另一個 Supabase 使用者，連結會失敗；需引導使用者登入既有帳號後，再以明確確認流程決定是否合併，不能直接搬移或覆寫帳號資料。
7. 以 IndexedDB 或現有 localStorage 保留待同步旗標均可；第一階段先使用 localStorage 中的版本化 outbox metadata，避免為此額外引入大型依賴。所有更新需防止同一頁多次上傳互相覆蓋，並以 revision 做樂觀鎖定。

### 批准與阻塞
- 目前尚未找到本遊戲專用 Supabase 專案、URL／publishable key 設定或 Google OAuth provider 設定。
- 導入 Supabase Auth／雲端資料表屬新增外部服務與架構變更；依專案規範，需使用者確認採用 Supabase，並確認是否可建立本遊戲專用專案（建立前先查明實際費用；不會在未確認費用前建立或啟用資源）。
- 本次只完成程式與資料流盤點、同步方案及風險設計；尚未更動遊戲存檔程式或雲端資料庫。


## Supabase 專案與 OAuth 條件初查（2026-10-24）

### 費用初查（官方公開資料）
- Supabase Free 標示為 US$0/月，包含匿名登入與社交 OAuth；資料庫每專案 500 MB、50,000 MAU、每月 5 GB egress，並可能在一週不活躍後暫停。官方標示 Free 專案上限為兩個（跨使用者擁有／管理的組織計算）。
- Pro 官方標價自 US$25/月起，額外專案費用另計；不可假設現有組織目前採用 Free，也不可把「Free 有方案」等同「本帳戶建立專案必定零成本」。
- 已連線帳戶目前只列出一個組織與一個非活躍專案 `daily-quest-rpg`。尚未建立本遊戲專案。需使用者確認允許針對該組織查詢專案報價；取得工具回傳的實際費用後，再由使用者明確批准任何非零費用。
- 不得啟用付費方案、加購、計費資源或建立會產生非零費用的專案，除非使用者在看到實際報價後明確批准。

### Google OAuth 與匿名登入設定條件
- Supabase 官方文件支援匿名登入；匿名使用者後續轉正式帳號需啟用 manual identity linking，並在同一匿名 session 內呼叫 Google identity linking。匿名 session 遺失（登出、清除瀏覽器資料、換裝置）後，匿名身分本身不能復原。
- 需在 Google Cloud 建立／選用 Google Cloud 專案、設定 OAuth consent screen（audience、scopes、branding），並建立 Web application OAuth Client ID。
- Google Authorized JavaScript origins 應包含遊戲正式站點的 origin；本地測試另加 localhost origin。Google Authorized redirect URI 使用 Supabase 專案 Google provider 設定頁提供的 callback URL。
- Supabase Auth Site URL／Redirect URLs 必須允許 GitHub Pages 正式網址與實際本地測試網址。精確網址尚待確認正式發布網址與新專案 callback，不能猜填。
- Google Client Secret 僅存於 Supabase Auth provider 設定或安全的伺服器端環境，不得放進 GitHub repo、前端 JavaScript 或公開建置產物。前端只使用 Supabase Project URL 與 publishable key；資料安全必須由 RLS 和 owner predicate 保護。
- 2026-10-30 起，Supabase 新專案的 public schema 資料表不再預設自動暴露於 Data API；新存檔表需明確檢查 Data API 暴露設定與必要 grants，並啟用 RLS，避免誤以為建表後 REST API 自動可用。
- 近期 breaking-change 初查發現：Supabase HTTP API 將於 2026-11-10 起停用部分舊 TLS 1.2 CBC cipher suites。遊戲使用現代瀏覽器的 HTTPS fetch，通常不需要專案端特殊設定；仍需在驗收中確認部署瀏覽器能連線。其餘當前 Auth／資料 API 變更需在實作前再核對官方文件。

### 本階段決策
目前僅完成公開費率與官方設定條件初查。尚未建立專案、修改 Auth 設定、建立資料表、寫入 OAuth secrets 或修改遊戲程式。接下來需先確認費用報價所用的 Supabase 組織，再依實際報價由使用者決定是否繼續建立。
