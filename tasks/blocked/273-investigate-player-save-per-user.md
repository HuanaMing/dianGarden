# 任務273：追查 Google 登入玩家存檔未分列問題

## 狀態：阻塞（程式碼調查完成，待唯讀查詢線上 D1）

## 問題描述
朋友已登入 Google，player_sessions 有其 user_id，但 player_saves 目前只看到使用者自己的存檔。

## 已確認的程式行為
- 專案實際雲端存檔後端是 Cloudflare Workers + D1（cloudflare/worker.js、cloudflare/schema.sql、cloudflare/wrangler.toml），不是目前 Supabase 連線所列的 inactive daily-quest-rpg 專案。
- player_sessions 用於保存登入工作階段；建立 session 時只 INSERT player_sessions，不會自動建立 player_saves 列。
- player_saves.user_id 是主鍵，每位 Google 使用者的存檔應各有一列。
- GET /api/save 查不到該 user_id 時會回傳 not_found，不會自動建立空存檔。
- src/cloud-save.js 的 checkCloud() 在雲端尚無存檔時會把 syncEnabled 設為 false，提示使用者手動上傳目前花園；只有 uploadLocal() 的 PUT 成功後才會開啟自動同步。之後遊戲存檔事件才會觸發延遲上傳。
- 因此，如果朋友只完成 Google 登入、沒有按「上傳目前花園」／初次建立雲端存檔，player_sessions 有記錄但 player_saves 沒有他的列，是目前設計下的正常情況。朋友的進度仍應留在他當時瀏覽器、該網站 origin 的 localStorage（sky-garden-save-v1、sky-garden-flower-variants-v1、sky-garden-auto-crops-v1），不是自動存在雲端資料庫。
- Worker API smoke test 已通過登入工作階段、玩家隔離、存檔 revision 與所有權相關測試。

## 尚未確認
- 尚未查詢線上 D1 的實際列數／使用者關聯，因此不能確認朋友是否按過初次上傳，也不能斷言朋友的雲端列不存在。
- 本機沒有可用的 wrangler CLI，且目前執行環境沒有找到 Cloudflare API token/account ID 環境變數；Supabase MCP 列出的專案與本遊戲的 Cloudflare D1 無關，且資料庫連線回報暫時不可用。
- 如果朋友已明確按過上傳，仍需要在 D1 做唯讀聚合查詢（不輸出 user_id 或存檔內容），並檢查 Worker 回應是否為 saved、storage_unavailable、revision_conflict 或其他錯誤。

## 下一步
1. 取得可用的 Cloudflare D1 唯讀查詢途徑後，查詢 player_saves 總列數、player_sessions 對應存檔的缺漏數；不輸出個別 user_id、token 或存檔內容。
2. 若朋友未上傳，指引他在原本遊玩的同一瀏覽器／網站按初次上傳；上傳成功後確認自己的 user_id 對應一列，並驗證後續自動同步。
3. 若朋友已上傳但 D1 仍無列，再追查線上 Worker 版本、API 回應、CORS／資料庫錯誤與部署版本；未取得批准前不部署、不修改正式資料。

## 安全界線
- 不刪除或重設任何玩家存檔。
- 不輸出朋友的 user_id、Google token、session token 或存檔內容。
- 不執行 DDL、migration、正式部署或任何寫入式資料修復。