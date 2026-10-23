# 任務 186：調整指標回饋與無人機坪台拖曳

## 需求
1. 點擊位置藍點：中心可見度 20%，邊緣漸層至 0%；放開後中心可見度由 20% 淡出至 0%。
2. 長按計時環：移除白色底環；進度色改為 `#5D81C7`，中心可見度 50%、內緣與外緣透明；內徑等於點擊位置藍點半徑（38px）。
3. 無人機坪台拖曳流程與地塊一致：長按進入移動模式，進入模式後按下可直接拖動；拖動預覽、放開確認與取消清理保持一致。

## 實作範圍
- `src/sky-world.js`：環形進度 SVG 與坪台拖曳狀態／座標平面。
- `src/styles.css`：點擊回饋徑向漸層與淡出、計時環色彩和內外緣遮罩。
- `tests/browser-smoke.mjs`：回饋視覺與長按環驗收。
- `docs/architecture.md`、`logs/task-history.md`、`state/`：同步記錄。

## 驗收條件
- 點擊回饋點為 76×76px，中心 alpha 20%，邊緣 alpha 0%，放開後 500ms 淡出。
- 長按環不建立白色 track，進度色為 #5D81C7、stroke opacity 0.5，圓弧半徑 22、線寬 6，內徑 38px，內外緣以徑向遮罩淡至透明。
- 坪台在 move mode 按下即可開始預覽拖曳，放開後沿用既有移動驗證與回呼。
- Playwright 瀏覽器 smoke test 與 Pages 部署均成功。

## 執行結果
- 實作提交：`d5fde269d9f4c3a0fd53da63f94b4d5765c6cb94`（場景拖曳）、`972ce25bd572f18a13a3eb9972684899bf628691`（最終回饋視覺）。
- 瀏覽器驗收：[Playwright run 39983008337](https://github.com/HuanaMing/dianGarden/actions/runs/39983008337) 成功。
- 部署：[GitHub Pages run 39983008203](https://github.com/HuanaMing/dianGarden/actions/runs/39983008203) 成功。
- 實際裝置上的視覺手感仍由使用者確認。
