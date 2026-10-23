# 任務188：長按環上升時縮小並於頂端恢復

## 需求
長按環形進度條上升時逐漸縮小，到達頂端瞬間恢復原本大小。

## 實作
- 沿用任務187的500ms上移動畫及50px位移。
- 上升過程逐漸縮至原尺寸55%；動畫最後一刻恢復100%大小。
- 不改變環形進度、顏色、顯示延遲與拖曳取消行為。

## 驗收結果
- 瀏覽器自動驗收成功：[run 39995530950](https://github.com/HuanaMing/dianGarden/actions/runs/39995530950)
- GitHub Pages 部署成功：[run 39995506272](https://github.com/HuanaMing/dianGarden/actions/runs/39995506272)
