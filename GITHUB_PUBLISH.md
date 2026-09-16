# v0.3.5 发布

本版修复 USER 普通头像 LIVE 预览尺寸/位置错误，并新增姓名旁入口图标大小调节。

## 更新内容

- USER LIVE 预览的几何位置改为读取当前真正显示的保护头像层。
- mask / filter / opacity / object-fit 等视觉样式继续读取原始 `.avatar img`，避免破坏复杂主题兼容。
- CHAR 保持原有单一头像几何逻辑。
- 修复 LIVE 空状态提示文字在部分主题下残留的问题。
- “工作台与入口设置”新增入口图标大小拉条（0.60×–2.50×）。
- 图标大小与图标到姓名距离分开保存，并实时更新聊天中的丘丘入口。

建议提交信息：

```text
fix: split user preview geometry and add launcher icon scale v0.3.5
```
