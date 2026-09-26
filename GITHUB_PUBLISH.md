# v0.3.9 发布

本版重点修复部分美化主题中 LIVE 头像框预览偏到一侧、被裁切的问题。

## 更新文件

- `index.js`
- `style.css`
- `manifest.json`
- `README.md`

## 建议提交信息

`fix: center rendered avatar in live preview v0.3.9`

## 主要变化

- LIVE 预览不再直接沿用原聊天头像的坐标中心。
- 先在工作台内部完成主题克隆布局，再读取真实渲染后的头像矩形。
- 自动把最终头像本体居中到 LIVE 预览视口。
- 下一帧进行第二次居中校正，兼容 container query / cqi / flex / WebView 延迟布局。
- 普通头像与蒙版头像双入口保持不变。
