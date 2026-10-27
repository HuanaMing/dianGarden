# 任務263：追查播種去程無人機瞬移

## 狀態
進行中；程式修正與動態回歸已提交，等待 GitHub Actions 驗證及實際遊玩驗收。

## 重現回報
- 使用者觀察到一台無人機正在前往播種的途中瞬移。
- 使用者明確表示當時沒有其他事件或操作參與。
- 使用者提出可驗證的根因：`updateDroneFrame()` 先批次計算所有無人機的 proposals，再逐台套用；逐台處理期間的同步生命週期回呼可能觸發派工，替後續無人機換上新動畫，卻仍套用依舊動畫計算的 candidate。
- 不可把此情境直接等同於任務262的雨後澆水取消；兩者仍須各自驗證。

## 根因
`updateDroneFrame()` 的 proposals 在第一階段依當時的 `state.animation` 計算。第二階段逐台更新位置時，`onDeparture`、`onWorkStart`、`onComplete` 或 `onReturnComplete` 等回呼可能同步執行 `render() / setDroneDocks() / completeJob() / enqueueJob() / processJobQueue()`。這些呼叫可以替另一台返航中的無人機安裝新動畫，造成該機的 `state.animation` 已是新動畫、`candidate` 卻仍是舊動畫提案。若舊提案的 elapsed 與 workComplete 已到終段，新動畫會被直接跳過或立即完成，造成瞬移。

## 修正
- `src/sky-world.js`：在 `updateDroneFrame()` 建立延後回呼佇列。所有無人機先套用本幀 proposal、更新座標／狀態並完成 WebGL buffer 上傳後，才依序執行回呼，避免本幀處理中途改寫其他無人機的動畫所有權。
- 將 proposal 階段的 `onDeparture`、迴圈內的 `onWorkStart`、工作完成時的 `onDeparture / onComplete`、返航完成時的 `onReturnComplete` 都改為延後執行；維持單一動畫內 `onDeparture` 先於 `onComplete` 的排程順序。
- 移除原本在工作完成回呼後用 `state.animation === null` 才把舊動畫塞回去的補救 hack；工作完成動畫保留位置所有權的行為仍由既有生命週期與延後派工確保。
- 同地塊接續工作時，巡航高度改用目標與停靠位置計算安全高度，不再沿用工作高度 `state.y`，避免貼著花叢橫飛。
- `tests/browser-smoke.mjs`：新增跨機派工競態動態回歸。測試讓 B 機進入返航，由 A 機完成工作時的回呼同步把 B 機派去播種，直接取樣兩台機器的世界座標，檢查 B 機新動畫已接手且單次水平位移沒有異常跳變。

## 驗收條件
- 跨機同步派工情境下，新動畫不得套用舊動畫 proposal。
- 動態取樣沒有超出合理飛行速度的單幀水平跳變。
- 播種→澆水交接、雨後取消返航及多機平台移動回歸維持通過。
- 同地塊接續使用安全巡航高度。
- 清楚記錄自動化結果與尚未完成的實際遊玩驗收；未經使用者確認，不宣稱所有瞬移情境已根除。

## 執行紀錄
- 2026-10-27：依專案規範讀取 `AGENTS.md`、`README.md`、專案／目前任務狀態及任務255、259、262紀錄。
- 2026-10-27：檢查 `startDroneAnimation()`、`findDroneRoute()`、`sampleRoute()`、`updateDroneFrame()` 與 `setDroneDocks()`。
- 2026-10-27：依使用者提供的根因分析，將生命週期回呼延後至整幀所有無人機位置更新與 WebGL buffer 上傳完成後執行；移除同步回呼後的舊動畫回填 hack。
- 2026-10-27：同地塊接續巡航高度改用安全巡航高度函式計算。
- 2026-10-27：新增跨機派工競態的動態 Playwright 回歸，並增加來源契約檢查。相關程式與測試已提交至 main；截至本紀錄更新時，尚未取得此提交的 GitHub Actions 結果，因此不能宣稱自動驗收通過。
- 待辦：確認最新 browser-check 工作流程結果；若通過，再請使用者在遊戲中確認播種去程瞬移是否消失。任務262雨後情境仍需獨立驗收。
