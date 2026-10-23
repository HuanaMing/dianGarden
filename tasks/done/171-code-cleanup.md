# 任務 171：清理反覆修改遺留的無用程式碼

## 狀態
**Completed（已完成）**

## 恢復紀錄
使用者於 2026-10-23 要求重啟本任務。暫停原因（任務插隊）已解除。

## 已完成與目前進度
- 第 1 段：移除 `.brand-mark{font-size:31px}`，Playwright 驗收通過。
- 第 2 段：移除 `.wallet-label{font-size:12px;color:#aa9d76}`，Playwright 驗收通過。
- 第 3 段：移除 `.hero-cloud{position:absolute;font-size:35px;opacity:.72}`，已提交。
- 第 3 段驗收：[GitHub Actions run 39791960715](https://github.com/HuanaMing/dianGarden/actions/runs/39791960715) 已確認成功（conclusion: success）。
- 第 3 段提交：`0565b71e52dbab6717243365fb62a52fd0c157e2`
- 第 4 段：確認 `.cloud-a`、`.cloud-b` 僅剩舊版首頁的 CSS 定位宣告，現行 `src/index.html`、`src/game.js` 與圖鑑腳本均無引用；已移除兩個無效定位規則。
- 第 4 段提交：`e7324f2842af5c00591338b9f5eb8123a0a22a75`
- 第 4 段驗收：[GitHub Actions run 39878241016](https://github.com/HuanaMing/dianGarden/actions/runs/39878241016) 已確認成功（conclusion: success）。
- 驗收流程改善：因 Playwright 安裝步驟反覆耗時，已在 `.github/workflows/browser-check.yml` 加入 npm／Playwright 瀏覽器快取，並拆分套件、系統依賴與 Chromium 安裝步驟。
- 驗收流程改善提交：`1e6bfef3d173a8f2787f321e45d338d6fb682a54`
- 第 5 段：移除手機版 media query 中的 `.cloud-a{left:4%}`；盤點 `src/index.html`、`src/game.js`、`src/sky-world.js`、`src/sky-environment.js`、`src/encyclopedia.html`、`src/flower-catalog.js` 均無 `.cloud-a` 引用，只有 `src/styles.css` 存在該規則。提交：`64cb71774009a97030aed6f910230d40a27d2b4e`。Playwright run `39879376599` 已通過（conclusion: success）。
- 第 6 段：移除舊首頁 `.hero-copy` 的三個 CSS 規則（一般版及兩個手機版斷點）；檢查現行頁面與腳本均無引用。提交：`2a8444a115a195eac66971387fa778935b240e67`。Playwright run `39880800563` 通過。
- 第 7 段：移除兩條無引用的 `.hero-description` 規則；檢查現行頁面與腳本均無引用。提交：`d4ac99da93d50c7c4ac35d5faa0ee7cb836b0a69`。Playwright run `39882579773` 通過。
- 第 8 段：一次清理舊首頁與舊農地卡片的孤立樣式，移除 `.topbar`、`.brand`、`.wallet`、`.hero`、`.hero-stats`、`.hero-art`、`.sun`、`.bird`、`.bird-one`、`.bird-two`、`.hero-island`、`.farm-section`、`.section-heading`、`.primary-button`、`.farm-grid`、`.plot-card`、`.plot-top`、`.plot-number`、`.plot-visual`、`.empty-sprout`、`.plot-actions`、`.plot-timer`、`.growing-card`、`.empty-plot`、`.empty-icon` 等 63 條 CSS 選擇器（約 4.6 KB）。逐一確認上述 class 在現行來源檔（包含 `src/flower-encyclopedia.js`）中無引用，並保留共用 `.action-button` 規則。提交：`6d956fe39f366a8e4a95666de76a5b0a41d5b111`。Playwright run `39883971650` 通過。
- 第 9 段：移除 `.world-heading`、`.world-help`、`.world-badge`、`.seed-option-arrow`、`.manual-plot-switch`、`.crop-flower-meaning`、`.plot-select`、`.rain-status`、`.settings-save-status` 等 30 條未引用的舊 CSS 選擇器（約 2.7 KB）。確認現行 HTML、遊戲／場景／圖鑑程式及瀏覽器測試均無對應 class 引用。提交：`542c3d46ddabb11122dd7f9cb53e5c9755159aec`。Playwright run `39884183837` 已通過，瀏覽器驗收步驟與結果保存皆成功。
- 新版流程驗證：[GitHub Actions run 39879113329](https://github.com/HuanaMing/dianGarden/actions/runs/39879113329) 已完成，整體瀏覽器驗收成功。

## 最終盤點與驗收

任務 171 已完成，共 15 段；所有程式碼批次均有獨立提交，且各自通過 Playwright 瀏覽器驗收。

- 第 11 段：移除空白 CSS media query。提交：`be9391d2b673518316d52a7077fc2d4eb1e1e75a`；run `39886341458` 成功。
- 第 12 段：清理 `src/game.js` 的空字串 `rainStatus` 佔位，以及 `src/sky-world.js` 中未使用的 `DRONE_ROTOR_RADIUS`、`hasDroneAnimations()`、`leafBase`。提交：`c4fd023ffa0c5d5319605d20f9c14898092623db`；run `39886538682` 成功。
- 第 13 段：移除未引用的 `.soil`、`.plot-pixel-icon`。提交：`b3c9fb6c12fbe6bc74f8431f83d967544773cd9a`；run `39886812190` 成功。
- 第 14 段：移除不存在的 `footer`、`footer span` 樣式，並從共用與手機版規則移除未使用的 `textarea` 選擇器。提交：`7cb069c4f8fbcbf19a4cd764be50da6a0b058d6f`；run `39887064077` 成功。
- 第 15 段：移除花園名稱編輯表單中不存在的 button 樣式，以及 5 條不再匹配 DOM 的 `.world-topbar .save-status` 規則。提交：`9710c000841f52f4ccad5eea096dccd6a254a9f4`；run `39887236576` 成功。

## 最終靜態盤點

- 重新掃描現行 HTML、JS、CSS 與瀏覽器測試中的 class/id、動態 class、`classList` 操作及選擇器字串；未再找到可確認未引用的 CSS class/id 或純元素選擇器。
- 掃描主要 JS 模組的常數、變數、函式與類別宣告；未再找到只有宣告、沒有使用的項目。
- 檢查函式參數時，正式遊戲程式未找到可確認未使用的參數。測試中有一個慣例性的 `_` 回呼參數，但不屬於遊戲程式死碼，因此保留。
- 未對仍有用途、只是目前測試覆蓋不足的程式做猜測性刪除。

## 後續

任務 172「縮短 Playwright 瀏覽器驗收流程」已建立於 `tasks/inbox/172-playwright-workflow-performance.md`，目前仍留在 Inbox，等待使用者確認是否開始。
## 原則
- 不以「看起來沒用」作為刪除依據；先查詢宣告、引用、事件綁定、跨模組介面與動態呼叫。
- 每一段刪除都要獨立提交，並在下一段修改前執行可用的靜態檢查及 Playwright 瀏覽器驗收。
- 若檢查失敗，先還原或修正該段，不得繼續累積未驗證變更。
- 不改變遊戲規則、模型外觀、操作流程、存檔格式或相容性。
- 不刪除僅因目前測試未覆蓋就看似無用的程式碼。
- 記錄每段刪除內容、判定依據、驗證命令與結果。
