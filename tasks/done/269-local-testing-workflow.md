# 任務 269：本機測試與驗收流程

## 目標
建立不依賴 GitHub Actions 的本機測試流程，讓開發者能在本機執行程式檢查、Worker API 測試及瀏覽器冒煙驗收，並清楚區分通過、失敗、受阻與部署狀態。

## 批准限制
安裝 Playwright 與 Chromium已獲使用者明確批准。若後續需安裝 Node.js 其他版本、其他瀏覽器或額外工具，仍須先說明用途與影響並取得使用者批准。

## 範圍
- 新增 scripts/run-local-tests.ps1。
- 新增 docs/local-testing.md，說明執行方式、檢查項目、結果判讀、工具依賴與安全界線。
- 使用專案本地 package.json／package-lock.json 固定測試工具版本。
- 更新狀態、任務與歷史紀錄。
- 不修改遊戲功能，不觸發正式部署。

## 驗收條件
- [x] 可從 Windows PowerShell 執行本機測試入口（已實際執行）。
- [x] 執行 Worker API 冒煙測試與 JS/MJS 語法檢查。
- [x] 有 Playwright 時可啟動隔離的本機靜態伺服器並完整通過瀏覽器冒煙測試（使用已批准的 Node.js 22.23.4 portable runtime，整體結束碼 0）。
- [x] 缺少 Playwright 時明確回報受阻，不自行安裝。
- [x] 測試素材與版本參數只寫入暫存工作區，不污染正式 src/。
- [x] 文件清楚區分本機測試、瀏覽器驗收及正式部署。
- [x] 安裝 Playwright／Chromium 前取得使用者批准。

## 目前調查
- Node.js v24.11.1、npm 11.6.2、Python 3.14.6 可用；目前環境沒有 Git 命令。
- 已新增本機測試專用 package.json／package-lock.json，固定 Playwright 1.64.1，並安裝專案本地 node_modules；Chromium 已下載至使用者 Playwright 快取。
- tests/cloudflare-worker-smoke.mjs 可使用現有 Node.js 執行，通過。
- 現有 .github/workflows/browser-check.yml 使用 Ubuntu、Node.js 22；本機原有 Windows／Node.js 24.11.1，後依使用者批准下載 Node.js 22.23.4 portable 供本機驗收使用。
- 已修正暫存工作區版本設定：version.json 改為從 build-version.js 讀取相同版本，避免原先 261027, 001 與 000000, 001 不一致所造成的自動更新循環。
- 初次診斷時，圖鑑桌面／手機互動、啟動選擇及無人機部分測試已通過，但完整測試在跨機派工競態期間以原生錯誤碼 -1073740791 結束。後續修正測試座標與等待條件，並使用 Node.js 22.23.4 portable 重跑後，完整瀏覽器冒煙測試已通過。
- 已依使用者批准下載 Node.js 22.23.4 portable 至使用者 LocalAppData，沒有修改全域 PATH，也沒有取代 Node.js 24。Node.js 22 下完整本機流程通過；Node.js 24.11.1 先前在瀏覽器測試及獨立 fs.rmSync 遞迴刪除測試均重現原生錯誤碼 -1073740791。因測試修正與 runtime 切換同時存在，不能聲稱已完全證明單一因果，但目前應以 Node.js 22 執行本機驗收。測試入口已設定為：若已批准的 portable Node 22 存在，優先使用它；否則沿用目前 PATH 中的 Node，不會改動全域設定。
- 首次 npm 安裝時專案尚無 package.json，npm 將使用者家目錄 node_modules 中 88 個既有套件標記移除，其中包含 googleapis、google-auth-library 等 Google API 相關套件。已從本機 npm 快取重建 googleapis@166.0.0、glob@10.5.0、rimraf@5.0.10 根套件及其相依套件（90 個套件新增、2 個移除）；因使用者家目錄沒有 package.json／lockfile，無法逐項確認是否完全回到原始版本。
- 後續安裝已改為專案本地依賴，避免再次影響使用者層級目錄。

## 執行結果
- 執行 .\scripts\run-local-tests.ps1 -SkipBrowser：Worker API 冒煙測試 PASS，25 個 JS/MJS 檔案語法檢查 PASS，結束碼 0。
- 簡單 Playwright Chromium 啟動測試 PASS（可開啟頁面並讀取標題與文字）。
- 使用 Node.js 22.23.4 portable 執行完整本機流程：Worker API PASS、25 個 JS/MJS 語法檢查 PASS、完整 Playwright 瀏覽器冒煙測試 PASS，整體結束碼 0（約 295 秒）。
- 已修正 PowerShell 本機伺服器就緒檢查的 Invoke-WebRequest，加入 -UseBasicParsing，避免 Windows PowerShell 舊版 HTML 解析提示造成等待。
- 已新增本機模式 GARDEN_TEST_LOCAL=1 的 Chromium SwiftShader 參數；不影響 GitHub Actions 預設啟動設定。
- 首次安裝意外移除的使用者層級套件已按快取可用版本重建常見根套件；原始版本無 lockfile 可核對。
- 完整本機測試流程已通過；測試涵蓋跨機派工、八台無人機位置連續性、登入／離線提示、11 種花卉模型及桌面／手機版等檢查。測試只修改驗收腳本，沒有修改遊戲功能或觸發部署。

[executed on device: CharMing (07eaf469-ae47-42c9-b1a6-f9ac76863107)]