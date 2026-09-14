# 发布 v0.2.0

将本目录中的文件上传并覆盖到：

`https://github.com/yukisnowww61-rgb/qiuqiu-avatar-workbench`

至少覆盖：

- `index.js`
- `manifest.json`
- `README.md`

`style.css` 本版没有核心逻辑变化，但直接整包覆盖也可以。

建议提交信息：

```text
fix: v0.2.0 use force_avatar for chat-scoped persona avatars
```

更新后在 TauriTavern / SillyTavern 的“管理扩展”中更新丘丘头像工作台，然后刷新页面。

> 注意：v0.2.0 会一次性清理 v0.1.4–v0.1.8 保存的旧 USER 临时头像覆盖状态。升级后如果仍需聊天临时头像，请重新设置一次。
