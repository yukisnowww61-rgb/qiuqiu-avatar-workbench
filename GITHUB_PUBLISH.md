# v0.3.2 发布

## 本次更新

- LIVE 头像框预览改为只镜像头像容器，不再显示消息正文、姓名、三元素与操作按钮。
- 保留 mask / transform / filter / `.avatar::after` 等头像框视觉。
- 重做工作台 UI：更清晰的卡片层级、模式切换、按钮、滑杆与历史收藏区域。
- 加强插件面板样式隔离，降低 SillyTavern 美化 CSS 对丘丘工作台 UI 的影响。

建议覆盖仓库根目录：`index.js`、`style.css`、`manifest.json`、`README.md`。

Commit 建议：

```text
feat: simplify live avatar preview and polish studio UI v0.3.2
```
