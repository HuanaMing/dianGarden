# 任務231：修正圖鑑收合圖示方向與返回花園重複登入

## 狀態
- 狀態：已完成（done）
- 類型：Bug 修正
- 優先度：一般；登入體驗問題優先檢查

## 問題回報
1. 圖鑑的「選擇花種」面板位於畫面下方，但展開／收合按鈕目前使用的圖片方向相反。
2. 從主畫面進入圖鑑，再點選「返回花園」後，主畫面似乎會要求重新登入，造成操作不便。

## 目標與驗收條件
### A. 圖鑑展開／收合圖示
- 面板收合／展開狀態與圖示方向一致，依面板位於畫面下方的實際互動方向顯示正確圖示。
- 保留既有桌面版與手機版版面行為，不影響拖曳展開／收合。

### B. 返回主畫面時保留登入狀態
- 進入圖鑑再返回主畫面，不應僅因頁面導覽就要求使用者重新操作 Google 登入。
- 檢查 `src/cloud-save.js` 的登入流程：目前 Google ID token（`idToken`）與使用者識別值（`currentSub`）只保存在頁面記憶體；跨頁導覽會重新建立文件，因此這些值會消失。
- 優先採用符合現有安全邊界的修正方案；不得把長效憑證或不必要的敏感資料寫入持久化儲存。若評估以 sessionStorage 暫存短效 ID token，須檢查有效期限、伺服器驗證、登出清除及過期處理，並確認不會造成雲端存檔同步權限或 session ownership 錯亂。
- 不得因恢復登入而覆蓋本機存檔、訪客花園存檔，或自動改變既有雲端衝突處理流程。

## 初步調查
- `src/encyclopedia.html` 的「選擇花種」按鈕目前預設載入 `assets/btn/收合.png`。
- `src/flower-encyclopedia.js` 的 `syncPickerIndicator(expanded)` 目前使用：展開時顯示「收合.png」、收合時顯示「展開.png」；需依面板位於下方的實際操作方向校正映射。
- `src/cloud-save.js` 的 `idToken` 與 `currentSub` 為頁面內變數；`handleCredential()` 設定它們，`loadGoogleIdentity()` 在每次主頁載入時重新初始化 Google Identity Services。圖鑑與主畫面為不同 HTML 文件，返回時會重新載入主頁。

## 預計修改範圍
- `src/encyclopedia.html`
- `src/flower-encyclopedia.js`
- `src/cloud-save.js`
- 視需要更新相關瀏覽器回歸測試及本任務紀錄。

## 驗證計畫
- 檢查圖示初始狀態、展開、收合、拖曳操作及手機版行為。
- 驗證主畫面 → 圖鑑 → 返回主畫面流程，不應無故要求重新登入。
- 驗證真正登出、ID token 過期／伺服器拒絕、訪客模式及雲端同步錯誤處理仍正常。
- 執行可用的 Playwright 桌面／手機回歸測試；如無法執行，明確記錄限制，不宣稱已通過。

## 執行結果
- 已修正 `src/encyclopedia.html` 初始圖示及 `src/flower-encyclopedia.js` 狀態映射：收合時顯示「展開.png」，展開時顯示「收合.png」，保留手機拖曳與點擊操作。
- 已更新 `src/cloud-save.js`：Google ID token、`sub`、`exp` 與 `sessionOpenedAt` 以版本化紀錄暫存於同分頁 `sessionStorage`；不寫入 `localStorage`。
- 恢復前檢查紀錄格式、token 的 `iss`、`aud`、`sub`、`exp`，並要求至少剩餘 60 秒有效期；恢復原 `sessionOpenedAt` 後仍呼叫雲端 API，不跳過伺服器驗證。
- 登入成功後保存工作階段；登出、前端發現憑證過期／損壞、伺服器回傳無效憑證或 `stale_session` 時清除暫存並停止同步。恢復既有工作階段時只預備 Google 登入按鈕，不自動 prompt 或重新認領雲端所有權；若伺服器拒絕憑證，會顯示重新登入入口。
- 未改動遊戲存檔格式、訪客存檔命名空間或本機／雲端衝突處理；未將 token 寫入 URL、`localStorage` 或專案文件。
- 已新增 `tests/browser-smoke.mjs` 覆蓋登入成功保存、頁面重載沿用相同 `sessionOpenedAt`、登出清除、過期憑證清除、伺服器拒絕憑證後清除，以及圖鑑手機版圖示互動。
- 已新增 `tests/cloudflare-worker-smoke.mjs` 驗證過期 ID token 被拒絕，並驗證新工作階段取得所有權後舊工作階段的上傳會被拒絕為 `stale_session`。
- 已在 `docs/desicions.md` 記錄此安全取捨。
- **回歸驗收通過**：GitHub Actions run 613（commit `0a9858c4db4dc5013a2aac9c67e3b150433451c7`）及最終完整驗收 run 616（commit `5f8e632d6ee920dae7c6dd81680885491182a364`）；Worker smoke tests 通過，Playwright 全套桌面／手機測試通過，`browserErrors: []`。最終驗收紀錄：`https://github.com/HuanaMing/dianGarden/actions/runs/40185985390`。
- 未手動觸發 GitHub Pages 部署；既有任務109付費雲端 Mac及任務212手動部署批准要求仍有效。
