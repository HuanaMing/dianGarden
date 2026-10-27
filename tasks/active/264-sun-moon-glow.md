# 任務 264：太陽與月亮的柔和光暈

## 目標
為空島天空中的太陽與月亮增加柔和、夢幻的光暈。保留既有天體幾何、日夜循環、太陽軌道、月相與雨勢邏輯，不新增第三方依賴。

## 已確認設計
- 使用獨立 WebGL program，不改動既有場景主 shader。
- 頂點屬性使用 `aPosition`、`aUV`、`aOpacity`；uniform 使用投影／視圖矩陣、光暈貼圖與色調。
- 以 canvas 產生徑向漸層貼圖，初始參數為 128×128，stops：`[[0,1],[0.12,0.55],[0.35,0.14],[1,0]]`。
- 使用 billboard 四邊形，使光暈面向相機並固定在天體的天空方向。
- 使用 `gl.blendFunc(gl.SRC_ALPHA, gl.ONE)` 加法混合與 `gl.depthMask(false)`；繪製後妥善恢復 WebGL 狀態。
- 光暈風格：柔和夢幻。
- 太陽光暈尺寸較大、暖金黃色；月亮光暈尺寸較小、冷白／淡藍色。
- 太陽光暈強度沿用既有 `sunVisibility`；月亮光暈沿用 `moonOpacity` 並乘上月相亮面因子，眉月較弱、滿月較明顯。
- 天氣沿用既有雨勢係數，不另加一套降雨衰減。
- 不改變存檔格式、遊戲規則或正式部署狀態。

## 實作檢查重點
1. 先檢查 `src/sky-world.js` 中太陽／月亮幾何產生、天空緩衝區上傳與 draw pass 的位置及資料流。
2. 取得太陽、月亮的中心座標與目前月相資訊，避免重複計算或建立不一致的時間判定。
3. 獨立建立 shader、texture、buffer 與 attribute/uniform locations，並在需要時處理 WebGL 資源建立失敗。
4. 光暈 billboard 使用天空相機矩陣（視圖矩陣移除平移分量），但保持天體在同一世界方向。
5. 依既有可見度與月相亮面因子設定 alpha；確保 alpha 不超出有效範圍，避免月亮消失時仍殘留光暈。
6. 光暈繪製時控制 blend、depth test、depth mask 及相關 buffer/attribute 狀態；繪製後恢復其他 draw pass 依賴的狀態。
7. 避免每幀重新建立貼圖或 buffer；貼圖應只在初始化時產生。
8. 保留既有日夜、雨勢、天空雲層、星星、天體位置及場景物件的行為。

## 驗收條件
- [ ] 任務需求及設計已記錄於專案任務文件。
- [x] Playwright 載入與執行整體場景流程成功，瀏覽器錯誤清單為空（GitHub Actions run 40456468867）。
- [x] 原生 JavaScript 在 Chromium 中成功執行，代表本次載入路徑未出現語法錯誤。
- [ ] 確認 shader 程式、WebGL resource、buffer/attribute/uniform 綁定完整。
- [ ] 確認太陽與月亮的光暈分別使用正確的中心、色調、尺寸及透明度。
- [ ] 確認月相因子呈現眉月較弱、滿月較明顯。
- [ ] 確認雨勢仍沿用既有係數，且日出／日落及天體消失時光暈同步淡出。
- [ ] 確認混合、深度與 buffer 狀態不污染後續繪製。
- [x] 既有 Playwright browser smoke test 通過，27 張桌面／手機與圖鑑截圖已保存為 workflow artifact。
- [ ] 太陽／月亮專用近景視覺驗收：目前預設花園截圖沒有將任一天體置於畫面內，因此尚不能宣稱已完成光暈外觀的專項視覺驗收。
- [ ] 不手動觸發 GitHub Pages 或 Cloudflare 生產部署。

## 執行紀錄
- 狀態：active（開始前）。
- 目前尚未修改程式；實作與驗證結果將在工作過程中追加。


## 執行紀錄（2026-10-27）
- 已新增獨立光暈 shader program、徑向漸層 texture、UV／位置／透明度 buffers，以及朝向相機的 billboard 繪製函式。
- 光暈沿用天空視圖矩陣（移除相機平移）；太陽採暖金色與較大尺寸，月亮採冷色與較小尺寸。月相因子依 `(1 + cos(phaseAngle)) / 2` 估算可見亮面比例，並保留最低微弱光暈。
- 加法混合與深度狀態在光暈繪製後恢復；若 glow shader／貼圖初始化失敗，會停用光暈而不阻斷主場景啟動。
- 首輪 CI 發現既有 smoke test 對每三次 bufferData 才取樣的方式會因新增貼圖 bufferData 而失去取樣時機；已將取樣改為直接記錄指定無人機位置 buffer，並加上初始化失敗診斷。最新 browser smoke run 40456468867 通過，browserErrors 為空。
- Pages 工作流程在推送 `src/sky-world.js` 至 main 後自動觸發並成功完成（run 40456103358）；本次沒有手動觸發部署。由於專用天體近景尚未在截圖中確認，任務維持 active，待補視覺驗收。

- 尺寸調整（2026-10-27）：依使用者指定，太陽與月亮光暈的 `size` 參數皆設為 `3.8`，已提交至 `src/sky-world.js`。此修改尚未進行天體近景視覺驗收。
- Shader 精度測試（2026-10-27）：將光暈專用 fragment shader 的 `precision mediump float` 改為 `precision highp float`，用來排查太陽／月亮光暈內部的彩色斑點。程式已提交；尚待確認瀏覽器支援、CI 結果與實際天體近景是否改善。


- 預乘 Alpha／加法混色測試（2026-10-27）：光暈 fragment shader 改為輸出已乘上 `texel.a * vOpacity` 的 RGB，混色改為 `gl.blendFunc(gl.ONE, gl.ONE)`，避免硬體混色階段再次乘 Alpha。理論上在未預乘來源 RGB 的情況下，與原本 `SRC_ALPHA, ONE` 的 RGB 貢獻等價；此提交是測試路徑，尚未取得新 CI 結果，也尚未用手機實際比較黑點是否消失。

- 紋理生成方式測試（2026-10-27）：使用者回報預乘 Alpha／加法混色後，太陽與月亮中央斑點仍未改善。下一步將 Canvas 2D 的徑向漸層改為逐像素建立 RGBA：RGB 固定為白色，只按半徑計算 Alpha，再上傳 WebGL，藉此排除 CanvasGradient 插值及 canvas-to-texture alpha 轉換因素。已提交至 `src/sky-world.js`（commit `b0375c9`）；手機視覺結果與新 CI 尚待確認。