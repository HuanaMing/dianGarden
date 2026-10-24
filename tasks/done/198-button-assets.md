# 任務198：按鈕素材替換輪盤與頂部介面 emoji

## 需求
1. 將快捷輪盤中無人機、農地管理、設定、圖鑑四個選項的 emoji 換成 assets/btn/ 對應 PNG 素材。
2. 將上方資訊介面中無人機、農地管理、設定、圖鑑四個按鈕的 emoji 換成相同素材。
3. 保留既有按鈕尺寸、互動、無障礙標籤與選項文字；沒有對應素材的收合及旋轉圖示先維持 emoji。
4. GitHub Pages 部署時需複製按鈕素材，並監看 assets/btn/** 變更以觸發重新部署。

## 驗收條件
- 輪盤與頂部介面各有四個素材按鈕，對應正確 PNG 路徑。
- 四種素材各在輪盤與頂部介面出現一次，共八張圖片，瀏覽器中全部成功載入。
- 圖片不影響按鈕點擊、面板互斥及原有無障礙標籤。
- Pages workflow 將 assets/btn/*.png 複製至 src/assets/btn/，且素材變更會觸發 workflow。

## 執行結果
- 已更新 src/index.html：八個對應按鈕改用 PNG 圖片，保留原有 aria-label、title、選項文字與其他按鈕行為。
- 已更新 src/styles.css：新增頂部與輪盤圖片的尺寸及置中樣式。
- 已更新 .github/workflows/static.yml：監看 assets/btn/**，並將素材複製到發布目錄。
- 已更新 tests/browser-smoke.mjs：檢查八張圖片成功載入及四種素材各出現兩次。
- 已更新 docs/architecture.md 記錄素材部署方式。
- 使用者於 2026-10-24 確認任務198驗收完成。依使用者驗收結果，任務198標記完成；此紀錄不額外宣稱本 Agent 已獨立執行瀏覽器測試或查驗部署。
