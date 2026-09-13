# 丘丘头像工作台：Git URL 安装发布说明

仓库根目录必须直接看到：
- manifest.json
- index.js
- style.css
- README.md
- LICENSE

不要把这些文件再套一层 `qiuqiu-avatar-workbench/` 文件夹上传到仓库。

## GitHub 网页发布
1. 新建一个 Public repository，例如 `qiuqiu-avatar-workbench`。
2. 进入仓库，选择 Add file → Upload files。
3. 将本目录中的所有文件上传到仓库根目录并 Commit changes。
4. 复制仓库地址，例如：`https://github.com/你的用户名/qiuqiu-avatar-workbench`
5. SillyTavern → 扩展 → 安装扩展 → 粘贴该 Git URL。
6. 分支留空即可使用仓库默认分支；通常选择“仅为我安装”即可。

以后更新扩展时，只需在 GitHub 仓库替换代码，并修改 `manifest.json` 中的 version，例如从 `0.1.0` 改为 `0.1.1`。
