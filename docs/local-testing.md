# 本機測試與驗收流程

## 用途

在 Windows 本機直接驗證 dianGarden，不依賴 GitHub Actions，也不會觸發 GitHub Pages 或 Cloudflare 部署。此流程把語法檢查、Worker API 測試與瀏覽器冒煙測試分開回報。

## 執行方式

在 PowerShell 執行：

    .\scripts\run-local-tests.ps1

只執行不需要瀏覽器套件的檢查：

    .\scripts\run-local-tests.ps1 -SkipBrowser

## 檢查內容

1. **Worker API 冒煙測試**：執行 tests/cloudflare-worker-smoke.mjs，以測試替身驗證登入工作階段、token、CORS、使用者隔離與存檔 revision 等 API 規則；這不是對正式 Cloudflare Worker 的線上測試。
2. **JavaScript 語法檢查**：使用現有 Node.js 的 node --check 檢查 src/、tests/、cloudflare/ 內的 JS/MJS。
3. **瀏覽器冒煙測試**：若 Playwright 已安裝，將必要檔案複製到隔離的暫存工作區，準備測試用圖片與版本檔，啟動本機靜態伺服器，再執行 tests/browser-smoke.mjs。測試伺服器只綁定本機回環位址 127.0.0.1，不會部署到外部服務。

## 工具與批准

- Python 使用目前環境已有的安裝。若已存在經使用者批准的 Node.js 22 portable（`%LOCALAPPDATA%\Programs\nodejs-22-portable\node-v22.23.4-win-x64`），測試入口會優先使用它；否則沿用目前 PATH 中的 Node.js。此選擇只影響測試程序，不會更動全域 PATH 或替換其他 Node.js。
- Playwright 以專案本地 `package.json`／`package-lock.json` 固定為 1.64.1；Chromium 由 `npx playwright install chromium` 安裝至使用者的 Playwright 瀏覽器快取。
- 瀏覽器測試需要 Playwright 套件及 Playwright Chromium 瀏覽器。若缺少其中任何一項，先停止並請使用者批准；腳本不會自行安裝工具。
- 不需要 GitHub CLI、Git 或 GitHub Actions 才能執行本機測試。
- 腳本會在專案根目錄建立暫存工作區，結束時清除；不會把測試用資源或版本參數寫回正式的 src/ 檔案。
- 本機 Windows 執行瀏覽器測試時會設定 `GARDEN_TEST_LOCAL=1`，使用 Chromium SwiftShader 軟體 WebGL；GitHub Actions 不設定此變數，仍使用原本瀏覽器啟動參數。
- 若瀏覽器測試發生錯誤，腳本會嘗試將測試輸出保存至 `logs/local-browser-test.log`。

## 結果判讀

- **PASS**：該項檢查已執行且通過。
- **FAIL**：檢查已執行但失敗，依錯誤訊息修正後重跑。
- **BLOCKED**：缺少尚未批准安裝的工具，因此瀏覽器驗收沒有執行。
- Worker 測試與語法檢查通過，不等於瀏覽器視覺驗收通過。
- 本機全部測試通過，不代表 GitHub Pages 或 Cloudflare 已部署；部署仍需獨立批准及確認。

## 已知限制

專案已新增本機測試專用 package.json／package-lock.json，固定 Playwright 1.64.1；Chromium 已下載。暫存工作區的 version.json 會從 build-version.js 讀取同一版本，避免自動更新循環。完整本機流程已使用 Node.js v22.23.4 portable 通過：Worker API、25 個 JS/MJS 語法檢查及 Playwright 瀏覽器冒煙測試皆 PASS，整體結束碼 0。測試涵蓋跨機派工競態、無人機位置連續性、桌面／手機版、11 種花卉模型與登入／離線提示。Node.js v24.11.1 先前在 Windows 原生錯誤碼 -1073740791 下失敗，且獨立 fs.rmSync 遞迴刪除測試亦可重現同碼；因同時修正了測試條件，仍不把 runtime 視為已完全證實的唯一原因。目前測試入口會在已批准的 Node 22 portable 存在時優先選用，且不修改全域 PATH。GitHub Actions 仍使用 Ubuntu／Node.js 22。

[executed on device: CharMing (07eaf469-ae47-42c9-b1a6-f9ac76863107)]