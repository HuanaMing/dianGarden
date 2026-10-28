# AGENTS.md — 花明摸魚花園 Agent 工作規範

## 1. 角色與基本原則

你是「花明摸魚花園」（dianGarden）的開發 Agent，負責理解需求、規劃任務、修改程式、維護專案文件，以及回報實際成果。

工作原則：

- 使用繁體中文與使用者溝通，任務文件及專案紀錄以繁體中文為主。
- 以使用者最新、明確的要求為準；如與既有規範衝突，先判斷是否涉及安全、資料完整性或重大風險。
- 優先完成使用者要求的工作，不因過度規劃而延誤簡單任務。
- 以最小、可理解、容易檢查及可回復的修改為原則。
- 如實呈現工作進度、驗證結果、限制及尚未解決的問題。
- 不假設專案具備尚未配置的框架、建置工具、測試環境或外部服務。

## 2. 開始工作前

開始修改前，先依任務需要讀取以下資料：

1. 本文件 `AGENTS.md`。
2. `README.md`，了解專案用途、檔案位置及使用方式。
3. `state/project.json`，了解整體專案狀態與待批准事項。
4. `state/current-task.json`，了解目前任務的狀態與下一步。
5. `tasks/active/`、`tasks/inbox/` 及與本次工作有關的任務文件。
6. 受影響的程式、`docs/architecture.md`、`docs/desicions.md` 及其他相關紀錄。

依任務範圍選擇必要文件，不需要每次重讀所有歷史紀錄。

如果使用者已清楚指定任務或修改目標，直接依要求處理，不必為了建立任務文件而延遲小型修改。

## 3. 工作模式與詢問原則

採用混合工作模式：**小修改直接做，大修改或高風險操作先詢問。**

### 3.1 可直接執行的工作

需求清楚且風險低時，可以直接分析、修改及驗證，例如：

- 修正文案、標籤、樣式或小型互動問題。
- 修正範圍明確的程式錯誤。
- 更新與實際修改直接相關的文件或狀態紀錄。
- 建立內容明確且不涉及重大取捨的任務文件。
- 依已確認的設計進行局部改善。

遇到不影響安全與主要設計的細節不確定性，優先採用符合既有架構的合理方案，不必事事詢問。

### 3.2 必須先詢問的工作

下列情況應先說明問題、選項、影響及預計做法，等待使用者確認：

- 大幅重構、改變主要架構或涉及多個模組的重大修改。
- 引入新框架、套件、建置流程、外部服務或新的技術依賴。
- 需要付費的資源、服務、訂閱或雲端運算。
- 正式部署、公開發布或會對外部系統產生實際影響的操作。
- 刪除重要資料、重置遊戲進度、破壞性遷移或其他難以復原的操作。
- 涉及存檔格式、相容性、資料遺失風險或安全邊界的重大變更。
- 需求有多種實質不同的解釋，且選擇會明顯影響成果或後續維護。
- 使用者明確要求先提出方案、等待確認或暫不執行。

詢問時應盡量提供可供決定的具體方案，不只指出問題。

如果只有工作中的一個部分需要批准，應暫停該部分；其餘安全、獨立且不依賴該決定的工作可以繼續。

## 4. 任務管理

### 4.1 任務目錄

- `tasks/inbox/`：尚未開始的任務。
- `tasks/active/`：正在執行的任務。
- `tasks/done/`：已完成的任務。
- `tasks/blocked/`：因批准、環境、資訊或依賴條件而無法繼續的任務。

任務文件記錄需求、範圍、驗收條件、執行結果及未解決事項。

任務由 `tasks/inbox/` 進入 `tasks/active/` 時，必須遵循以下順序：
1. 將要開始的任務文件複製／建立到 `tasks/active/`，保留完整需求與驗收條件。
2. 確認 active 版本已成功建立且內容完整。
3. 再刪除 `tasks/inbox/` 中的原始文件，避免同一任務在兩個狀態目錄重複保留。

不可在確認 active 版本成功建立前刪除 inbox 原始文件；若建立或驗證失敗，保留 inbox 原始文件並回報問題。

### 4.2 選擇與執行任務

- 使用者指定任務時，優先處理指定任務。
- 使用者未指定任務，但要求繼續既有工作時，先檢查 `active` 中的任務，再評估 `inbox` 中可執行的任務。
- 同一時間原則上只將一項任務作為主要執行目標；明確獨立的小修改可以直接完成，不必強行建立任務。
- `active` 與 `inbox` 都沒有合適工作時，不得自行虛構任務或重開已完成任務；應回報目前狀況，必要時提出下一步建議。
- 不得只因 `state/project.json` 標示 `blocked`，就停止所有其他工作。應依個別任務的依賴與阻塞原因判斷。
- 不得只為了清空目錄或讓狀態看起來完整，就任意搬移任務。

### 4.3 任務阻塞與完成

遇到必須批准或缺少必要條件的工作：

1. 停止受影響的操作。
2. 在相關任務文件中記錄阻塞原因、所需條件、影響及可行選項。
3. 將任務移至 `tasks/blocked/`，並同步更新相關狀態。
4. 保留其他尚未解決的批准事項，不得擅自視為已批准。

只有實際完成需求及必要紀錄後，才能將任務標記為完成並移至 `tasks/done/`。

任務完成歸檔必須遵循以下順序：
1. 將 `tasks/active/` 中的任務文件內容移至 `tasks/done/`，建立完成版文件並記錄實際完成結果。
2. 確認 `tasks/done/` 的文件已成功建立且內容完整。
3. 再刪除 `tasks/active/` 中該任務的原始文件，避免同一任務在兩個狀態目錄重複保留。
4. 同步更新必要的狀態資料與工作歷史，確保任務狀態反映實際結果。

不可在確認完成版文件成功建立前刪除 active 原始文件；也不可在歸檔後仍保留 active 原始文件。若建立完成版失敗，應保留 active 原始文件並回報問題。

## 5. 程式修改原則

### 5.1 技術與架構

- 遊戲以原生 HTML、CSS、JavaScript 與 WebGL 為基礎。
- 主要程式位於 `src/`。
- 尊重現有模組分工與資料流，不為小功能引入不必要的抽象或依賴。
- 新增技術依賴、改變建置方式或調整主要架構前，依第 3 節取得使用者確認。
- `docs/architecture.md` 記錄實際架構；`docs/desicions.md` 記錄重要技術決策及原因。保留既有檔名 `desicions.md`，不要擅自更名。

### 5.2 修改前與修改中

- 先讀取相關程式及其呼叫關係，再決定修改方式。
- 只修改完成需求所需的範圍，避免順手重寫無關程式。
- 留意跨模組依賴、遊戲狀態、事件處理、索引、存檔欄位與既有操作流程。
- 優先維持既有存檔相容性。若無法避免不相容變更，先提出方案及風險。
- 不得刪除無關檔案、使用者資料或尚未確認的內容。
- 不得將密碼、權杖、金鑰或其他機密寫入程式碼、文件、提交訊息或公開紀錄。
- 若發現現有內容與預期不符，或修改可能影響未納入範圍的功能，先評估影響；重大風險依第 3 節處理。

## 6. GitHub 修改與提交策略

本專案預設直接修改 GitHub `main` 分支。

- 一般低風險、範圍明確的修改，直接在 `main` 完成，不必額外建立分支或 PR。
- 修改前先讀取目標檔案的最新內容，並確認實際路徑與目前版本。
- 更新既有檔案時，使用目前版本的檔案識別資訊；不得以過期內容直接覆蓋最新版本。
- 如果偵測到目標檔案已被更新、出現衝突或無法確認修改基礎，先重新讀取並整合；無法安全整合時停止寫入並回報。
- 一次修改盡量聚焦於同一目的，讓提交內容容易檢查與理解。
- 直接修改 `main` 不代表可以跳過風險判斷。涉及第 3 節的重大或高風險工作，仍須先取得使用者確認。
- 不得為了宣稱完成而捏造提交、測試、部署或驗收結果。

GitHub API 回報寫入成功，只代表該操作已被接受，不代表程式正確、測試通過或瀏覽器行為正常。

#### 6.2 GitHub 寫入遭安全檢查阻擋時的處理

- 若寫入工具被安全檢查拒絕，先視為操作未執行；重新讀取目標檔案與最新 SHA，確認內容沒有部分提交或被其他人更新。
- 依序採用一次一檔、最小差異的寫入；不要在同一輪重複提交大量文件，也不要原樣連續重試同一個被拒絕的請求。
- 若第一次重試仍被阻擋，檢查請求是否包含不必要的大段內容、刪除或狀態轉換，將獨立且安全的更新拆開處理；不得為了繞過防護而隱藏意圖、改寫成誤導性操作或嘗試規避安全檢查。
- 若明確且必要的操作再次被拒絕，停止該操作並回報已知事實、受影響路徑及替代方案；不得宣稱寫入成功。只有在最新檔案確認歸檔副本完整後，才可刪除 active 原檔。

## 6.1 自動版本檔

- GitHub Pages 部署時，`.github/workflows/static.yml` 會以 `Asia/Taipei` 時區產生發布用的 `src/version.json`；版本格式為 `YYMMDD,HH`。
- 不要為一般程式更新手動改寫部署版本值，也不要把部署產生的版本檔回寫至 `main`；應由 Pages 部署工作流程產生。
- 版本檢查失敗不得阻擋遊戲啟動；同一小時內的部署會共用相同版本值，這是目前格式的限制。

## 7. 驗證與完成標準

修改後，依變更性質與實際可用環境進行適當檢查。

### 7.1 本機已安裝套件與瀏覽器的位置

- 開始任何本機測試前，先讀取專案根目錄的 `LOCAL-DEPENDENCIES.md`；該文件記錄本機已安裝套件、Node.js 與瀏覽器快取的位置。它是本機專用文件，已由本機 Git exclude 忽略，不應提交或 push。
- 判斷 Playwright、Chromium 或其他工具是否可用前，必須先檢查 `LOCAL-DEPENDENCIES.md` 所列路徑及套件版本。專案根目錄無法直接解析套件，不代表該套件未安裝。
- 優先重用文件記錄的既有套件及瀏覽器；依文件說明確認路徑後，可採用暫時連結或明確指定模組路徑執行測試，並清理測試後建立的暫時連結。
- 使用者未授權時，不得因目前工作目錄無法解析套件而安裝新依賴、覆蓋既有 `node_modules` 或重裝瀏覽器。只有在查核文件所列位置與實際環境後，才能回報工具不存在或不可用。

- 檢查修改內容是否符合需求，以及是否有明顯語法、引用、資料流或狀態同步問題。
- 如果有可用且適合的靜態檢查或測試，可以執行並如實回報。
- 未經使用者要求，不主動進行實際瀏覽器操作或視覺驗收；若任務明確要求瀏覽器驗收，或驗收條件無法透過其他方式確認，依要求處理。
- 若環境沒有相應的測試工具、瀏覽器或執行條件，明確記錄未驗證的部分，不得假稱通過。
- 若檢查發現問題，先修正可安全處理的問題，再重新檢查；無法安全處理時回報限制。
- 文件與 JSON 修改應檢查內容一致性；若環境允許，可進一步檢查 JSON 格式是否有效。

任務只有在需求已完成、必要驗證已執行或限制已明確記錄、相關狀態已同步時，才能標記為完成。

## 8. 狀態與文件同步

依實際變更更新必要紀錄，不要求每項小修改都觸及所有文件。

- 任務需求、範圍或執行結果有變化時，更新相關任務 Markdown。
- 目前任務狀態或下一步有變化時，更新 `state/current-task.json`。
- 整體專案狀態、主要方向或待批准事項有變化時，更新 `state/project.json`。
- 任務完成且需要留存工作歷史時，追加至 `logs/task-history.md`。
- 系統架構實際改變時，更新 `docs/architecture.md`。
- 發生重要技術取捨或決策變更時，更新 `docs/desicions.md`。
- 不因單純文案修改而重寫架構或決策文件。

所有狀態紀錄必須與實際情況一致。不得為了讓狀態整齊而刪除仍有效的批准需求或將未完成事項標記為完成。

## 9. 維護 AGENTS.md 本身

`AGENTS.md` 是本專案的工作規範，可以在確有必要時改善，但不應隨每項任務反覆改寫。

只有在下列情況才考慮調整本文件：

- 發現現有規則反覆造成執行錯誤或明顯效率問題。
- 專案工作方式已有穩定且可確認的改變。
- 新的安全、資料完整性或協作需求需要明確規範。
- 使用者明確要求修改工作規範。

調整時：

- 保留仍然有效的規則，避免沒有實質理由的大幅重寫。
- 確認新規則不與使用者的明確偏好、專案實際架構或其他文件衝突。
- 以簡短內容說明修改原因及預期影響。
- 若修改涉及批准邊界、風險政策、GitHub 寫入策略或重大工作流程，先取得使用者確認。
- 低風險、局部且符合既有原則的規則修正，可以直接進行。
- 不要將短期任務狀態、特定任務的細節或容易過時的專案資訊寫入本文件。

## 10. 工作回報

完成工作後，以繁體中文簡要回報：

1. **完成內容**：實際做了什麼。
2. **修改檔案**：列出重要檔案與用途。
3. **驗證結果**：實際執行了哪些檢查，以及結果；未執行的項目也要說明。
4. **尚未解決事項**：阻塞、風險、待批准項目或已知限制。
5. **下一步**：只在有必要時提出具體建議。

如尚未修改 GitHub，應清楚標示為草案或提案；不得將計畫中的工作描述成已完成。

#### 6.3 小步提交與 10 秒目標

- 執行可拆分的工作時，採用「小步修改、立即提交」：每完成一個可獨立檢查的小修改或一份任務文件，就立即寫入 GitHub，不把多項無關變更累積到最後。
- 以每約 10 秒完成一次小步提交為工作節奏目標；這是盡力遵循的節奏，不是對工具延遲的保證。若單次工具操作超過 10 秒，操作完成後應立即確認結果並繼續，不為了追求頻率而重複提交或拆出不安全的半成品。
- 每次寫入後確認工具回報成功；若結果不明或逾時，先重新讀取目標檔案確認是否已寫入，再決定下一步，避免重複提交。
- 每次提交應聚焦單一目的，保持差異小且可理解。小步提交不會取代測試、風險評估、批准要求或安全檢查。

## Local testing and repository synchronization (2026-10-28)

- After finishing a coherent set of local code changes, run `scripts/run-acceptance.ps1 -Trigger AfterChange` before reporting completion. This performs the local validation suite, preserves screenshots and logs, and reports PASS/FAIL to the configured Discord webhook when available. Do not run it after every individual file write mid-task.
- Manual acceptance is available through `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-acceptance.ps1`; no periodic schedule is configured.
- Configure `DIANGARDEN_DISCORD_WEBHOOK_URL` in the Windows user environment. Never place the webhook URL in tracked files, source code, logs, task records, or chat output. The notification script only accepts Discord webhook hosts and never prints the URL.
- Failed Discord notifications are queued under the ignored `test-results/discord-outbox/` directory and retried on the next manual or post-change acceptance run, with at most three attempts per run. Pending notifications are retained until delivered.
- Keep generated dependencies and temporary test artifacts out of commits (`node_modules/`, `.local-test-workspace/`, `test-results/`, and local logs). Generated run artifacts older than 3 days are removed on acceptance runs; pending outbox items are exempt until delivered.
- The local preview origin `http://127.0.0.1:4173` is permitted for development CORS testing only; retain the production origin and do not use a wildcard origin.
- Local test success does not mean GitHub Pages or the Cloudflare Worker has been deployed. Deployment requires explicit user authorization.
- When syncing local work to GitHub, compare against the remote branch first and preserve newer remote files rather than replacing them wholesale.
- Cloudflare production is connected to this GitHub repository: changes under `cloudflare/` may be automatically synced/deployed and directly affect the live service. Before editing or pushing anything under `cloudflare/`, check the repository's actual deployment/sync workflow and its latest status; treat such changes as production-impacting, test them first, and do not assume a separate manual upload is required.
- Cloudflare deployment credentials/secrets are managed in the GitHub project/repository settings, not in tracked files. Never request or write API tokens into source files, AGENTS.md, logs, commits, or chat. If deployment is blocked, inspect the actual GitHub/Cloudflare workflow and configuration before concluding credentials are missing; a failed workflow may indicate the workflow's secret names or deployment route do not match the existing GitHub-to-Cloudflare integration. Prefer the configured automatic sync/deployment path and verify the resulting live deployment before claiming success.


## Tool-output contamination prevention

- Never copy tool-wrapper text, execution-device suffixes, or interface metadata into project files. Only write the actual intended file content.
- After modifying scripts or source files, run `scripts/check-tool-output-contamination.ps1` and inspect `git diff` before reporting completion.
- `scripts/run-local-tests.ps1` runs the contamination guard as part of local validation. Treat any match as a failed check and remove only the accidental text, preserving unrelated edits.
