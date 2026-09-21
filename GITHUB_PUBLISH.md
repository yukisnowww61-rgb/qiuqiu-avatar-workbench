# v0.3.8 发布

本版重点修复收藏头像缩略图在部分 TauriTavern / iOS WebView 中显示为破图的问题。

## 更新文件

- `index.js`
- `style.css`
- `manifest.json`
- `README.md`

## 建议提交信息

`fix: stabilize favorite avatar thumbnails v0.3.8`

## 主要变化

- 收藏 / 历史缩略图从临时 `blob:` URL 改为持久 Data URL。
- 自动迁移旧版 Blob 收藏记录。
- 收藏当前头像优先生成标准 PNG。
- 自动识别 PNG/JPEG/GIF/WebP MIME。
- 破损旧记录改用友好占位，不再显示浏览器破图图标。
