# Toolkit

一个在浏览器内运行的开发者工具箱。

- JSON 格式化、压缩和语法校验，保留数字原值。
- JSON Diff，按字段路径显示差异，对象忽略键顺序，数组按索引比较。
- 文本比较，按行显示新增、删除和对应行号。
- Unix 时间戳与日期互转，支持秒、毫秒、UTC 和北京时间。

## 本地运行

在浏览器中打开 `index.html`。也可以在项目目录运行 `python -m http.server 4173 --bind 127.0.0.1`，然后访问 `http://127.0.0.1:4173/`。

## 发布到 GitHub Pages

提交这些静态文件后，在仓库的 **Settings → Pages** 选择 **Deploy from a branch**，发布对应分支的 `/(root)`。
