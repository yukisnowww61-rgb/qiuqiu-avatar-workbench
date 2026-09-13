# 丘丘头像工作台

一个面向 SillyTavern 的前端 UI Extension，用于快速处理当前聊天中的 USER（Persona）和 CHAR（Character）头像。

## v0.1.2 已实现

- 在每条消息的**姓名后面**自动添加“丘丘头像工作台”图标，图标高度跟随姓名字号。
- 默认图标：`https://imgbed.heliar.top/i/hWLZsEjJm7_lklfn_IMG_1048.gif`
- 点击任意 USER / CHAR 消息姓名后的图标，自动识别对应头像并打开工作台。
- USER / CHAR 一键切换。
- 选择新图片后实时预览。
- 拖动调整构图；滑杆调整水平位置、垂直位置和缩放；触屏支持双指缩放。
- 2:3、1:1、3:4、4:5 裁剪预览；2:3 默认为 512×768。
- **保存显示范围**：非破坏式，不修改头像文件，只保存 X / Y / Zoom。
- **裁剪并替换头像**：按照当前预览生成 PNG，并覆盖当前 Persona / Character 头像。
- Character 的非破坏式构图会优先尝试写入 Character Card 的 `data.extensions.qiuqiu_avatar_workbench`；同时保留本地扩展设置作为后备。
- Persona 的非破坏式构图保存在扩展设置中。
- 工作台内可以：
  - 输入新的图标 URL；
  - 上传本地图标（建议小于 2 MB）；
  - 一键恢复默认 GIF。
- 手机端弹窗布局和拖动操作适配。

## 安装

把整个 `qiuqiu-avatar-workbench` 文件夹放到 SillyTavern 的用户扩展目录，然后重启 / 刷新 SillyTavern。

现代 SillyTavern 通常使用用户数据目录下的扩展位置，例如：

```text
data/<你的用户目录>/extensions/qiuqiu-avatar-workbench/
```

开发环境也可以放在第三方扩展目录中。最终以你当前 SillyTavern 版本的 UI Extensions 文档为准。

## 使用

1. 打开任意聊天。
2. 在 USER 或 CHAR 的姓名后找到丘丘 GIF 图标。
3. 点击图标。
4. 直接拖动头像，或调整 X / Y / Zoom。
5. 两种保存方式：
   - `保存显示范围`：不动原图，只改变显示构图；
   - `裁剪并替换头像`：真正生成并覆盖头像文件。
6. 展开“工作台图标设置”可更换入口图标。

## 注意

- v0.1.2 的“显示范围”主要作用于 SillyTavern 页面中的 `.avatar img` 头像元素。Chromium / WebView2 环境会优先使用 `object-view-box` 调整图像内容，因此不会为了缩放而改变头像元素本身的尺寸；不支持该属性的浏览器会使用兼容回退方案。
- 某些高度定制的主题如果强制覆盖了头像的 `object-fit` / `object-position` / `clip-path` 等属性，可能需要为主题额外增加兼容 CSS。
- “裁剪并替换”会输出静态 PNG；如果原头像是 GIF，裁剪后不会保留动画。
- 群聊中请优先从**要修改的那个角色自己的消息**后点击工作台图标，以便准确识别 Character。
- 本地图标会以 Data URL 保存到扩展设置中，因此不建议上传超大图片；GIF 最推荐使用图床 URL。

## 下一步候选功能

- 头像历史 / 一键回滚。
- 构图预设（头肩、半身、左构图、右构图）。
- 独立设置聊天头像、角色列表头像、Persona 列表头像的显示范围。
- 圆形 / 方形 / 自定义遮罩预览。
- 替换头像前自动备份。
- 更完整的群聊成员识别。

## License

MIT


## v0.1.2 修复

- 修复部分 TauriTavern / 手机美化下，姓名后的工作台图标可见但点击没有反应的问题。
- 点击监听改为 window 捕获阶段，减少消息层脚本拦截。
- 图标增加 pointer-events / z-index / touch-action 兼容。
- 在“扩展设置”中增加一个备用「打开工作台」入口。
- 如果打开仍失败，会直接弹出具体错误提示，方便继续排查。

## v0.1.2：姓名后图标定位修复

针对 TauriTavern / 高度自定义主题中 `.name_text` 使用 `position:absolute`、`transform` 等情况，入口图标不再直接插入姓名所在的文档流，而是读取姓名真实的屏幕位置，将图标悬浮贴在姓名右侧。这样可避免图标掉到消息正文前方。滚动、旋转屏幕和窗口尺寸变化时都会重新定位。

仓库：`https://github.com/yukisnowww61-rgb/qiuqiu-avatar-workbench`
