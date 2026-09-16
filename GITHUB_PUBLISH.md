# v0.3.1 发布

将本目录内的文件上传并覆盖到仓库根目录：

```text
https://github.com/yukisnowww61-rgb/qiuqiu-avatar-workbench
```

至少覆盖：

- `index.js`
- `manifest.json`
- `README.md`

`style.css` 本版没有关键改动，但整包覆盖也没有问题。

建议提交信息：

```text
fix: support masked and decorated avatar themes v0.3.1
```

本版把 USER 头像保护层迁回 `.avatar` 容器，修复复杂主题中头像被气泡/头像装饰层盖住而消失的问题，并同步 transform、mask 与 z-index 等主题视觉属性。
