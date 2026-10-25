# 任務237：WebGL 動態光照與夜間照明

狀態：已完成。使用者於 2026-10-25 確認實機驗收完成。

## 成果
- `src/sky-world.js` 新增三角形面法線、normal buffers 與 WebGL 動態光照 shader。
- 日照進度、天氣與黎明／黃昏階段控制環境光、方向光與色調；取消 CSS brightness 對場景的整體調暗。
- 依使用者回饋再降低方向光並提高柔和環境補光，讓花朵色彩更自然。
- 保留原有 buffer 順序，修正首輪自動測試發現的無人機位置回歸問題。
- 未修改花卉模型檔案，未新增第三方依賴。

## 驗證
- 使用者實機驗收完成。
- 首輪 Playwright 回歸通過，後續柔和光照微調已由 GitHub Actions 自動驗收流程執行；該微調流程在本次歸檔前的最後已知狀態為執行中，因此不將它另行宣稱為已通過。
- 初次 Pages push 工作流程成功，未手動觸發部署。

## 相關檔案
- `src/sky-world.js`
- `docs/architecture.md`
- `docs/desicions.md`
