# 任務227：恢復圖鑑預覽長按旋轉

## 需求
圖鑑預覽視窗中的長按旋轉手勢已失效，恢復原本的長按後拖曳旋轉花卉模型功能，不影響點擊選花、一般拖曳或縮放。

## 初步調查
- 圖鑑使用 `src/encyclopedia.html` 的 `#sky-canvas[data-mode="gallery"]`，互動由共用的 `src/sky-world.js` 處理。
- 專案原本已有長按環形提示與相機旋轉事件；實作時需追查 galleryMode 分支、pointer capture 與 `garden-camera-rotate-start/end` 的事件流程。

## 範圍
- `src/sky-world.js`
- `tests/browser-smoke.mjs`

## 驗收條件
- 圖鑑預覽中按住達到既有長按門檻後拖曳，可連續旋轉模型。
- 未達長按門檻就放開，不應誤觸旋轉。
- 滾輪縮放、手機觸控、選花切換與遊戲主頁既有地塊手勢不退化。
- 增加 Playwright 回歸測試，涵蓋桌面指標與至少一種觸控情境。
- 執行完整桌面／手機瀏覽器測試並記錄結果。

## 依賴
無，可獨立執行。
