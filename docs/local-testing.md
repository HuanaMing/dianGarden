# 本機自動驗收與 Discord 通知

## 使用方式

在專案根目錄以 PowerShell 執行手動驗收：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-acceptance.ps1
```

完成一組程式修改後，Agent 依 `AGENTS.md` 執行同一入口。沒有設定每日或定時排程。

## Discord 設定

1. 在 Windows 搜尋「編輯目前使用者的環境變數」。
2. 在「使用者變數」新增 `DIANGARDEN_DISCORD_WEBHOOK_URL`，值填入 Discord 頻道的 Webhook URL。
3. 關閉並重新開啟 PowerShell／終端機，讓新環境變數生效。
4. 執行上述驗收指令。通知會附上 PASS／FAIL、時間、耗時、摘要及代表性截圖。

Webhook URL 是發送憑證；不要將它貼入原始碼、文件、日誌或 Git。若憑證曾貼入聊天或其他可能被保留的地方，建議在 Discord 重新產生並撤銷舊 Webhook，再把新 URL 設定在本機環境變數中。

## 流程與通知

- 驗收入口呼叫現有 `scripts/run-local-tests.ps1`，執行 Worker API smoke test、JS/MJS 語法檢查與 Playwright browser smoke test。
- 預設逾時 480 秒；逾時會終止測試程序樹並回報 FAIL。
- PASS 及 FAIL 都會通知；FAIL 優先附上 `failure-page.png`，並從測試日誌整理短錯誤摘要。
- Discord 傳送每次最多重試 3 次。仍失敗時，通知及必要截圖留在 `test-results/discord-outbox/`，下一次手動或修改後驗收時再重試。
- 本機執行產物保存在 `test-results/runs/`，超過 3 天的已完成產物會在後續驗收時清除。待發通知及其必要截圖不會因逾期而被清除。
- `test-results/` 已由 Git ignore 排除，不會進入一般 Git 變更清單。
- 通知使用 Discord Webhook，不會自動 commit、push 或部署。

## 結束碼

- `0`：測試通過，通知已送出。
- `1`：測試失敗或逾時。
- `2`：測試已執行，但 Discord 通知仍在本機待發佇列，或 Webhook 尚未設定。

## 限制

- Windows 電腦需開機、未睡眠且網路可用，才能執行本機測試及發送通知。
- 若瀏覽器在啟動前即失敗，可能沒有畫面可附；通知會說明截圖不可用。
- 本流程只傳送自動化測試畫面，不是電腦桌面的即時串流。
