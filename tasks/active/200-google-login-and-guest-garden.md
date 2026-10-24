# 任務200：Google 登入提示與獨立訪客花園

## 需求
1. 進入遊戲時先嘗試 Google 自動登入；若登入成功，依既有雲端存檔流程載入自己的花園。
2. 若在短暫等待後仍未登入，不初始化遊戲場景，顯示入口對話框，提供「回到自己的花園（Google 登入）」及「去新花園逛逛」兩個選擇。
3. 選擇 Google 登入後，成功完成登入與雲端檢查才放行遊戲啟動；登入失敗或雲端 API 不可用時，入口仍可供玩家選擇訪客模式，不可永久卡住。
4. 選擇訪客模式時建立／載入獨立的訪客花園，使用獨立的存檔、花卉變種及自動選花儲存鍵；不得覆寫、讀取或上傳原有帳號／本機花園。
5. 訪客模式跨重新整理仍維持訪客花園，並在設定內提供「回到自己的花園」入口；返回時清除訪客模式標記並重新載入正常登入流程。
6. Google 登入尚未完成時不得因固定 timeout 而自行啟動遊戲；等待登入或玩家明確選擇訪客模式。
7. 保持既有存檔格式相容，不加入第三方套件；補充必要樣式、測試及專案文件。

## 實作方向
- 以持久化訪客模式旗標選擇獨立的 localStorage key namespace。
- 雲端存檔模組偵測訪客模式後不啟動 Google 自動登入及雲端同步。
- 新增入口 dialog，並在 Google Identity 可用時顯示登入按鈕；無法載入登入服務時仍可進入訪客花園。
- 訪客選擇寫入模式旗標後重新載入頁面，讓所有模組一致使用訪客存檔鍵。
- 在設定介面顯示訪客模式提示與返回自己的花園按鈕。

## 驗收條件
- 沒有自動登入時，遊戲初始化會等待入口選擇，不因 3.5／5 秒 timeout 自動開始。
- Google 登入成功時，依既有雲端存檔規則載入自己的花園；雲端存檔不同時可安全重新載入。
- 訪客花園的主存檔、花卉變種及自動選花使用獨立 key；切換訪客模式前的本機資料保持原樣。
- 訪客模式不自動登入、不讀寫雲端、不將訪客進度上傳。
- 訪客重新整理後仍載入同一訪客花園；使用「回到自己的花園」後恢復正常登入／本機花園。
- Google script 或 API 設定不可用時，玩家仍可選擇訪客模式。
- 相關 JavaScript 語法、入口 UI／存檔隔離測試通過；未實際執行的瀏覽器／部署驗收如實記錄。

## 實作結果（2026-10-25）
- 已新增登入入口對話框；Google 自動登入失敗後不再由固定 timeout 放行遊戲，而是等待登入／雲端檢查成功或玩家明確選擇訪客花園。
- 已新增持久化訪客模式旗標及三組獨立儲存鍵：主存檔、花卉變種、自動選花。訪客模式下雲端模組不初始化 Google 登入或自動同步。
- 已在設定介面加入訪客花園提示與「回到自己的花園」按鈕；返回時清除訪客旗標並重新載入。
- 已新增 Playwright 驗收，確認入口閘門、訪客模式切換及原有本機存檔保留。
- 驗收：GitHub Actions 瀏覽器驗收通過（[run 40119558579](https://github.com/HuanaMing/dianGarden/actions/runs/40119558579)）；同一工作流程中的 Cloudflare Worker smoke test 通過。
- GitHub Pages 部署：含本任務前端程式的來源提交部署工作流程成功（[run 40119056401](https://github.com/HuanaMing/dianGarden/actions/runs/40119056401)）。
- 測試環境修正：更新 Cloudflare Worker smoke test 的 Node.js 原生 crypto 初始化、session timestamp 欄位與 DB mock，讓測試符合現行 Worker session ownership 契約。
- 修改檔案：`src/index.html`、`src/styles.css`、`src/cloud-save.js`、`src/game.js`、`tests/browser-smoke.mjs`、`tests/cloudflare-worker-smoke.mjs`、`README.md`、`docs/architecture.md`、`docs/desicions.md`、`state/project.json`、`state/current-task.json`。
- 狀態：程式與自動化驗收已完成，**等待使用者實際遊玩驗收**；目前不移入 `tasks/done/`。
