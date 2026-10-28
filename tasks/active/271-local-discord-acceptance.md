# 任務 271：本機自動驗收與 Discord 截圖通知

## 需求

- 提供手動驗收指令，不設定定時排程。
- 完成一組本機程式修改後執行自動驗收。
- PASS／FAIL 都通知 Discord 指定 Webhook；FAIL 附錯誤摘要與代表性截圖。
- 測試逾時時終止程序並標記 FAIL。
- Discord 發送失敗時保留本機待發通知與必要圖片，下次驗收再有限次重試。
- 本機產物保留 3 天；待發通知保留至成功送出。
- 不自動 commit、push 或部署。

## 實作範圍

- `scripts/run-acceptance.ps1`：統一驗收入口、逾時處理、產物保存與通知呼叫。
- `scripts/discord-acceptance.mjs`：Webhook 傳送、附件、待發佇列、有限重試及 3 天產物清理。
- `scripts/run-local-tests.ps1`：在清理隔離測試工作區前保存截圖與測試日誌。
- `AGENTS.md`、`docs/local-testing.md`：記錄觸發規則與使用方式。

## 驗收條件

- JS/MJS 語法檢查通過。
- PowerShell 腳本可解析，正常測試流程可完成。
- PASS／FAIL 通知使用 multipart 附圖；不輸出 Webhook URL。
- 未設定 Webhook 時不丟失通知，而是保存在待發佇列。
- 逾時能終止測試程序並產生 FAIL 紀錄。
- `test-results/` 保持 Git ignore。
- 不執行 commit、push 或部署。

## 目前結果

- 已新增手動／修改後驗收入口、Discord 通知模組、待發佇列與 3 天產物清理。
- 完整本機驗收曾通過：Worker API smoke test、25 個 JS/MJS 語法檢查、Playwright browser smoke test；`browserErrors` 為空。
- 已驗證 JS 語法、PowerShell parser、state JSON 與 `git diff --check`；通知模組佇列 smoke test 確認未設定 Webhook 時會保留 payload 與截圖。
- Discord Webhook 環境變數目前未設定，因此尚未實際送達 Discord；PASS／FAIL 通知已保存在本機待發佇列，待設定後重試。
- 未 commit、未 push、未部署。

## 狀態

程式實作與本機測試完成；待在 Windows 使用者環境設定 `DIANGARDEN_DISCORD_WEBHOOK_URL`，再執行一次驗收驗證 Discord 實際送達。
