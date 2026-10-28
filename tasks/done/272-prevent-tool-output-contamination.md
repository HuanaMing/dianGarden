# 任務272：清除工具輸出污染並防止復發

## 結果：完成
- 已讀取 GitHub main 的 scripts/run-local-tests.ps1，正文沒有污染片段；本機對應檔案正文也沒有。
- 本機程式／設定檔污染掃描沒有找到命中。工具回傳畫面尾端的裝置附註是工具包裝文字，不是 GitHub 或本機檔案內容。
- 新增 scripts/check-tool-output-contamination.ps1；掃描程式與設定檔，發現污染即回傳失敗。
- 將污染檢查接入 scripts/run-local-tests.ps1，並在 AGENTS.md 加入防護規則。
- 污染檢查器正向／反向自我測試通過。
- 本機驗收通過：Worker API smoke test、25 個 JS/MJS 語法檢查、Playwright browser smoke test；browserErrors 為空。
- Discord 驗收通知流程回報 PASS 通知已送達；同時也成功補送佇列中的既有通知。
- GitHub 版本原本沒有實際污染，因此沒有產生無意義的遠端修改；未 commit、未 push、未部署。

## 修改檔案
- scripts/check-tool-output-contamination.ps1
- scripts/run-local-tests.ps1
- AGENTS.md

## 驗收
- 本機檢查器正向／反向測試：PASS。
- 專案污染掃描：PASS。
- run-local-tests.ps1 -SkipBrowser：PASS。
- run-acceptance.ps1 -Trigger AfterChange：PASS。
- git diff --check：PASS（僅有既有換行格式警告，沒有 whitespace error）。

## 狀態
已完成；本機變更保留，未 commit／push。