# 任務199：快捷輪盤圖示尺寸、定位與辨識度

## 需求

1. 移除快捷輪盤六個選項的可見文字標籤；保留必要的圖示及輔助技術名稱。
2. 四種 PNG 圖示依重作要求縮小為本次修改前尺寸的約 70%：桌面版 35×35px、手機版 32×32px。
3. 四種 PNG 圖示沿各自按鈕的徑向向輪盤外側定位，桌面版中心徑向距離約 104px，手機版約 100px。
4. 解決圖示被扇形按鈕的 `clip-path` 裁切問題：圖示放在輪盤容器內、按鈕裁切區外的獨立覆蓋層，且不攔截指標事件。
5. 圖示保持正向，不隨扇形旋轉；新增白色外框與輕微深色陰影，提高圖示和花草環的對比。
6. 保留六個按鈕的 `role`、`aria-label`、`data-wheel-action` 及既有操作；頂部資訊列、花草環素材、輪盤位置與尺寸不受影響。
7. 透過 Playwright 驗證桌面／手機版尺寸、定位、素材載入、互動與回歸行為，並保存輪盤截圖。

## 驗收條件與結果

- **通過**：六個輪盤操作完整、順序正確且不顯示文字標籤；無障礙名稱仍存在。
- **通過**：四張 PNG 圖示成功載入；桌面為 35×35px、手機為 32×32px。
- **通過**：圖示位於不受按鈕扇形 `clip-path` 影響的覆蓋層；桌面中心徑向距離約 104px、手機約 100px。
- **通過**：圖示保持正向，白色外框濾鏡生效；覆蓋層不攔截指標事件。
- **通過**：輪盤選取、旋轉、收合及其他既有操作；完整桌面／手機瀏覽器 smoke test 通過，`browserErrors` 為空。
- **通過**：桌面與手機輪盤截圖已產生並人工檢視，四個圖示完整可見，白色外框能將圖示與花草環區分。

## 實作與文件

- `src/index.html`：四張 PNG 圖示放在獨立的 `.wheel-icon-overlay` 元素，保留四個原操作按鈕與無障礙屬性。
- `src/sky-world.js`：以 `data-wheel-icon` 對應操作順序，依每 60 度設定覆蓋層角度。
- `src/styles.css`：桌面 35px、手機 32px；桌面徑向中心距離約 104px、手機約 100px；加入四方向白色 drop-shadow 外框與輕微深色陰影。
- `tests/browser-smoke.mjs`：新增輪盤操作名稱、文字標籤、素材載入、尺寸、裁切層、白框濾鏡及手機徑向位置檢查；修正既有測試對素材數量、隱藏狀態選取縮放及觸控長按時序的錯誤假設。
- `.github/workflows/browser-check.yml`：補上 `assets/btn/` 素材複製步驟，確保自動驗收環境能載入輪盤與頂部按鈕圖示。
- `README.md`、`docs/architecture.md`、`docs/desicions.md`：更新測試檔案用途、圖示定位架構與視覺決策。

## 驗收紀錄

- GitHub Actions Playwright 全套瀏覽器驗收成功：[run 40083713166](https://github.com/HuanaMing/dianGarden/actions/runs/40083713166)。
- 驗收 artifact 含桌面輪盤、手機輪盤、桌面／手機場景及 11 種花卉圖鑑截圖：[瀏覽截圖 artifact](https://github.com/HuanaMing/dianGarden/actions/runs/40083713166/artifacts/12555733188)。
- `browserErrors` 為空；輪盤專屬尺寸、外框、裁切與手機徑向定位檢查均通過。
- GitHub Pages 來源程式部署已成功：[部署 run 40080813362](https://github.com/HuanaMing/dianGarden/actions/runs/40080813362)。
- 本任務完成，已具備自動化瀏覽器驗收與視覺截圖紀錄。
