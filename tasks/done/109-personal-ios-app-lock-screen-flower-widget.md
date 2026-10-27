# 任務 109：個人使用 iOS app 與鎖定畫面花卉小工具

## 目標

將「花明摸魚花園」延伸為僅供本人安裝使用的 iPhone app，並可把任一花種的 3D 模型加入 iOS 鎖定畫面小工具。不以 App Store 上架為目標。

## 建議方案

- 使用 Capacitor 將現有 HTML、CSS、JavaScript 與 WebGL 遊戲包入 iOS app；遊戲資產隨 app 安裝，不要求公開網站或遠端遊戲伺服器，既有存檔先保留在 app 內本機。
- 使用原生 SwiftUI + WidgetKit 建立鎖定畫面小工具。WidgetKit 不能持續執行遊戲 WebGL 場景，因此小工具顯示花朵模型的預先渲染靜態圖片，不提供即時旋轉或互動 3D。
- 以 App Intent 讓玩家設定此小工具要顯示的花種；把十種花的渲染圖片和名稱隨 Widget extension 打包，初版不必在 app 與 extension 間同步遊戲存檔或使用 App Group。
- 優先提供 Lock Screen accessory rectangular widget，顯示花朵圖像與名稱；可再評估 accessory circular 版。iPhone 鎖定畫面會以系統的 vibrant／單色風格呈現，需確保花型輪廓清楚。
- 以免費 Apple Personal Team 將 app 安裝到自用裝置，不使用 App Store。免費簽署的 provisioning profile 七天到期，屆時需重新建置、安裝。

## 依序工作項目

1. **解除建置環境阻塞**：取得一台 Mac 或可互動使用的雲端 Mac，安裝相容版本的 Xcode；確認可連接目標 iPhone、用本人 Apple Account 建置並安裝 Personal Team app。先驗證 WidgetKit extension 可簽署與安裝。
2. **整理可嵌入的 Web app**：在 repo 加入 npm 專案描述與 Capacitor 設定，建立可重現的 web asset 複製／建置腳本，將 `src/index.html` 與必要腳本、樣式、圖鑑頁面包入 app bundle；讓遊戲離線運作且存檔維持本機。
3. **適配 iPhone 操作**：檢視 safe area、直向／橫向版面、觸控拖曳／點擊、對話框與 WebGL 尺寸；修正只依賴鍵盤或滑鼠的流程，確保背景／前景切換不破壞存檔。
4. **產製花卉模型圖片**：從現有 3D 模型為十種花輸出透明背景、清楚置中的 PNG；檢查鎖定畫面單色模式下各花種仍可辨識，並將圖檔納入 Widget extension 資產。
5. **建立可設定的小工具**：加入 WidgetKit extension 與 App Intent 花種選項；渲染所選花種靜態圖與名稱，支援鎖定畫面矩形版，點擊小工具可開啟 app 的圖鑑。切換花種設定時由 WidgetKit 依其更新機制重新渲染。
6. **在 iPhone 驗收與整理安裝流程**：用 Xcode 安裝主 app，從鎖定畫面新增小工具、設定花種、確認圖像／單色呈現、點擊導向圖鑑，以及離線開啟與本機存檔；記錄免費簽署到期後的重裝步驟。

## 驗收條件

- app 可從 iPhone 主畫面啟動，核心遊戲不依賴公開網站或網路連線；遊戲資料保存在裝置。
- 玩家可在鎖定畫面加入小工具並選擇十種花之一，模型圖片與名稱符合選項。
- 小工具使用預先渲染圖，不宣稱支援即時 3D；在 iOS 單色呈現時花型仍清楚。
- 可用本人 Apple Account 安裝自用 build，不需要 App Store 上架；文件說明七天簽署期限及重新安裝方式。

## Windows 開發途徑評估

- **遠端／租用 Mac（可行）**：從 Windows 遠端使用實體 Mac 與 Xcode；無須購買 Mac 硬體。需先選定服務並確認費用、Xcode 版本、Apple ID 登入及 iPhone 實機連線／安裝方式。若用免費 Personal Team，安裝簽署仍需每七天更新。
- **Windows 上 macOS VM（不採用）**：提供的 WPS 文章建議在一般 PC 使用 VMware／VirtualBox 安裝 macOS；Apple 現行 macOS 授權的虛擬化許可限定在已由本人擁有或控制、且執行 Apple 軟體的 Apple 品牌電腦，因此不採用一般 Windows PC VM 路徑。
- **Flutter／React Native／Windows Swift 工具鏈／線上 IDE（不解除阻塞）**：可用於部分跨平台 UI 或編輯程式碼，但此專案必須建置原生 WidgetKit extension，最後仍需要 Xcode／iOS SDK 完成建置簽署。
- **替代需求（不含鎖定畫面 Widget）**：若只要主畫面 app 圖示，可做 PWA；但 Safari 主畫面網頁 app 不能提供本專案所需的原生 WidgetKit 鎖定畫面小工具。

參考：[使用者提供的 WPS 途徑整理](https://zh-hant.wps.com/office-solutions/zh-xcode-for-windows-how-to-run-ios-apps-on-pc-free-tools-and-alternatives/)、[Apple macOS Tahoe 授權條款](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)、[Apple Xcode 系統需求](https://developer.apple.com/xcode/system-requirements/)。

## 阻塞原因

目前工作環境是 Windows，無法直接執行 Xcode。阻塞不是必須購買 Mac，而是尚未取得 Xcode 使用途徑；可提供既有 Mac，或確認可租用雲端 Mac（費用需先確認）。在取得該環境前，無法建置、簽署或實機驗收 WidgetKit。WidgetKit 與簽署參考：[WidgetKit](https://developer.apple.com/documentation/WidgetKit/)、[Personal Team 安裝效期](https://developer.apple.com/help/account/basics/about-your-developer-account)。

## 待恢復時確認

- 可用 Mac／雲端 Mac 的 Xcode 版本與 iPhone iOS 版本。
- 先建置只含一種示例花的 WidgetKit vertical slice，再產製其餘九張花模圖片。



## 2026-10-27 結案紀錄

依使用者明確指示，本阻塞任務行政結案並歸檔。原有環境限制及付費雲端 Mac 需先取得使用者確認的條件仍有效，並未視為已批准或已完成。若日後重新提出，另開新任務並先處理必要批准。
