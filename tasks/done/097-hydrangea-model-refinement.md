# 任務 097：精細化繡球花模型

## 目標

改善遊戲中繡球花 3D 模型的辨識度與細節，維持現有低多邊形風格及花卉色彩系統。

## 驗收條件

- 繡球花模型能辨識出球狀花序與成簇小花的層次特徵。
- 模型只影響繡球花，其他花種外觀與共用渲染流程維持正常。
- 若需要自然形態參考，查找並記錄參考來源。

## 執行結果

繡球花由 9 顆八面體調整為 24 朵均勻分布於球面的低多邊形小花；每朵小花以四片花瓣狀萼片及中央小花心構成，萼片沿球面朝向外側，並以輕微明暗變化保留立體層次。既有自訂花色套用於所有萼片，其他花種及共用渲染流程未更動。

形態參考：[Duke Gardens：Bigleaf Hydrangea](https://gardens.duke.edu/garden-talk/bigleaf-hydrangea/) 說明繡球花頭呈圓球狀，單朵小花有四片顯著萼片；[Oregon State University：Hydrangea macrophylla](https://landscapeplants.oregonstate.edu/plants/hydrangea-macrophylla) 記載花序呈半球至近球形，周邊花具有花瓣狀萼片。

未執行測試或瀏覽器操作（依專案指引）。


