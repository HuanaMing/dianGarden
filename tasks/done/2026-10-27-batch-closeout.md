# 2026-10-27：未結案任務批次歸檔

## 結案方式
依使用者明確指示，將原本位於 `tasks/active/`、`tasks/inbox/`、`tasks/blocked/` 的所有任務文件統一歸檔至 `tasks/done/`。使用者指定：若先前問題日後再次出現，建立新任務，不重開舊任務。

## 重要說明
- 本次是任務管理上的行政結案，不代表每項需求都已完成、測試通過或經使用者驗收。
- 各任務文件原有的驗證結果、限制、未完成事項均保留，並附上相應結案註記。
- 原本已存在於 `tasks/done/` 的任務236、237、238完成版保留；其 `active/` 殘留副本在確認完成版存在後移除。
- 任務251在 active 與 inbox 各有一份同名文件，兩份均保留於 done；inbox 版本另命名為 `251-farm-management-five-columns-inbox-copy.md`。
- 任務109、212、232原有付費／部署批准要求仍有效，並未視為已批准。
- 本次沒有修改遊戲程式，也沒有觸發 GitHub Pages、Cloudflare Worker 或其他部署。
- 已同步更新 `state/current-task.json`、`state/project.json` 與 `logs/task-history.md`；目前沒有執行中的任務。
