# 丘丘头像工作台

一个面向 SillyTavern / TauriTavern 的头像工作台 UI Extension。

## v0.1.8

这一版重点修复 **USER 的“仅本次聊天”头像在重新进入聊天后短暂出现、随后又被 Persona 永久头像覆盖** 的问题。

- 临时头像改为“持续覆盖层”：只要当前聊天 metadata 中仍存在 USER 临时头像，消息头像就应始终显示该临时头像。
- MutationObserver 不再只监听消息节点新增，也监听头像 `src` / `srcset` 的异步变化。SillyTavern 或主题如果在后续渲染阶段重新写回永久头像，插件会立即重新应用临时头像。
- 增加多阶段重应用：聊天切换、Persona 更新、消息发送/接收后会在多个短延迟时点再次确认临时头像，覆盖延迟渲染。
- “仅本次聊天”替换成功后 **不再主动调用 `reloadCurrentChat()`**；直接更新当前聊天 DOM，避免插件自身触发一次把头像写回永久 Persona 的重绘。
- 永久替换仍保留标准聊天重载和即时刷新逻辑。
- 临时头像已应用时会识别当前资源，避免 MutationObserver 与插件自身更新形成重复写入循环。

## 当前功能

- 每条 USER / CHAR 消息姓名后显示丘丘入口。
- 默认入口图标：`https://imgbed.heliar.top/i/hWLZsEjJm7_lklfn_IMG_1048.gif`
- 工作台图标可换 URL / 本地图片。
- 图标到姓名距离可调。
- 浮动工作台可拖动、缩小、放大。
- USER / CHAR 快速切换。
- 上传新头像、拖动构图、双指缩放。
- 水平位置 / 垂直位置 / 缩放滑杆。
- 裁剪固定输出 512×768（2:3），只裁切和等比例缩放，不拉伸人物比例。
- `保存显示范围`：只保存 X / Y / Zoom，不修改头像文件。
- `仅本次聊天`：仅 USER 可用，只在当前聊天覆盖 Persona 头像；CHAR 只保留永久替换。
- `永久替换`：修改 Character / Persona 本体头像。
- 替换后自动刷新当前聊天，无需手动重进。
- 头像历史、一键回滚、单条删除、清空历史。

## Git URL 安装

```text
https://github.com/yukisnowww61-rgb/qiuqiu-avatar-workbench
```

SillyTavern：

```text
扩展 → 安装扩展 → 粘贴仓库 URL → 仅为我安装
```

仓库根目录应直接存在：

```text
manifest.json
index.js
style.css
README.md
LICENSE
```

## 头像历史说明

头像历史存储在当前 WebView / 浏览器的 IndexedDB 中：

- 不会修改角色卡的历史字段；
- 不会把备份头像显示在 Persona 选择列表；
- “仅本次聊天”的历史只在对应聊天中显示；
- “永久替换”的历史跟随对应 Persona / Character；
- 每次一键回滚前，也会先把当前头像再存入历史，因此可以继续回滚回来。

清除 Tauri/WebView 网站数据或浏览器站点数据时，头像历史也可能一起被清除。

## 关于自动刷新

v0.1.8 在头像写入成功后使用 SillyTavern 的当前聊天重载接口重新渲染消息头像，并在渲染完成后再次应用聊天级头像覆盖与头像构图。这样比单纯替换 DOM 中 `<img src>` 更可靠，也能绕过部分主题、缩略图和 WebView 缓存造成的旧头像残留。
