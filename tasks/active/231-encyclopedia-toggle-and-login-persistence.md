# 任務231：修正圖鑑收合圖示方向與返回花園重複登入

## 狀態
- 狀態：執行中（active）
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
- 已提交 `src/encyclopedia.html`：圖鑑選花標題初始圖示由「收合.png」改為「展開.png」。
- 已提交 `src/flower-encyclopedia.js`：展開狀態顯示「展開.png」、收合狀態顯示「收合.png」，反轉原有映射。
- 已提交 `tests/browser-smoke.mjs`：更新手機版初始、拖曳及點擊展開／收合的圖示預期。
- 登入持續性尚未修改。初步評估需跨頁保存短效 Google ID token 與 `sessionOpenedAt` 才能維持同一個雲端 session ownership；因這會把 bearer token 從記憶體擴大保存至同分頁 `sessionStorage`，先取得使用者確認再實作。
- 自動瀏覽器驗收預期由 main 分支 push 觸發；尚未確認 workflow 結果。
