# 任務247重做：修正雨天月亮可見度

## 需求
雨天時，月亮可見度必須使用：
`（100% − 太陽可見度）× 下雨係數`。

下雨係數沿用天空既有的 `rainVisibility = 1 - 0.5 * rainBlend`，晴天係數為 100%，雨勢淡出完成時為 50%。

## 執行紀錄
- 已在 `src/sky-world.js` 將月亮可見度改為 `Math.max(0, 1 - sunVisibility) * rainVisibility`。
- 已更新 `tests/browser-smoke.mjs`，加入雨天月亮可見度公式的回歸檢查。
- 尚未執行 Playwright／GitHub Actions，也未進行實機視覺驗收。
