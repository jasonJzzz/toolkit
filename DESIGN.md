# 工具箱界面与实现记录

## 产品与界面

这是面向日常开发的本地数据处理工具箱。主要流程为粘贴或选择文件、执行处理、查看并复制结果。页面使用原生 HTML、CSS 和 JavaScript，通过 GitHub Pages 发布静态文件，也支持直接打开本地 index.html。

按 Impeccable 的 Operate 模式组织界面，优先处理可读性、输入反馈、键盘操作和手机布局。统一采用深绿侧栏、浅色工作区、绿色主操作、相邻输入与结果面板。色值使用 styles.css 中的 CSS 变量。错误与正常提示使用 role=status，异步操作展示处理状态，复制按钮随有效结果启用。

已合并原先的 V2 界面，移除原版/V2 切换和 styles-v2.css。正式地址使用 #timestamp 等名称，旧的 #timestamp-v2 书签会自动归一为 #timestamp。

所有面板标题栏统一最小高度 56px，为复制按钮和上下内边距预留空间，避免左右正文的起点错位。下拉框保留原生选择与键盘操作，使用统一箭头：距右边框 14px，文字右侧预留 42px；系统强制颜色模式恢复原生箭头。

下班计算器位于工具列表末尾，连续点击左上角图片 5 次可展开或收起。相邻点击间隔超过 2 秒或点击别处会清零计数，刷新恢复隐藏。收起当前计算器时返回 JSON 格式化。动画遵循 prefers-reduced-motion。

## 文件与处理流程

| 文件 | 用途 |
| --- | --- |
| index.html | 工具页面、标签、表单和侧栏 |
| styles.css | 统一样式、移动端布局和隐藏入口动画 |
| toolkit.js | 原有工具事件、Hash 路由、隐藏入口和通用复制 |
| toolkit-core.js | 原有 JSON、文本、时间和工时计算 |
| toolkit-extra.js | 新增工具的事件、UTF-8 编码和 Worker 生命周期 |
| toolkit-extra-core.js | YAML/CSV、JSONPath、正则、Cron 和摘要计算 |
| assets/vendor/toolkit-vendor.js | 供 Worker 使用的本地依赖源码字符串 |
| assets/vendor/toolkit-vendor-entry.js | 第三方打包入口，供维护时重新构建 |
| assets/vendor/LICENSES.txt | 第三方组件版本与许可证全文 |

URL 和 Base64 直接调用浏览器 API。其他新增工具在 Blob Worker 中运行，因此 file:// 和普通静态服务器都能使用，运行时无需访问 CDN。每次修改输入会终止旧任务并清空旧结果。一般任务 4 秒超时，摘要任务 15 秒超时，避免复杂正则或异常查询持续占用计算资源。

## 各工具规则与限制

- URL 默认使用 encodeURIComponent/decodeURIComponent 处理单个参数，完整网址模式使用 encodeURI/decodeURI。完整网址解码保留 URL 结构分隔符的转义，+ 按字面保留。
- Base64 文本使用 UTF-8，支持中文和 Emoji。Base64URL 编码省略末尾 =。解码拒绝非法字符及无法还原为 UTF-8 的二进制内容。
- 正则使用 JavaScript RegExp，分别填写主体和 flags。输出匹配位置、捕获组、命名组与替换结果。index 是 JavaScript UTF-16 下标，展示最多 1000 组匹配。
- JSON 与 YAML 互转使用 JSON_SCHEMA，避免日期被隐式转为 Date。循环引用及超出 JavaScript 安全整数范围的数字会报错。
- JSON 转 CSV 使用非空扁平对象数组，字段为各行键名的并集。CSV 转 JSON 要求非空且不重复的表头，各行列数一致。值统一保留为字符串，避免丢失编号前导零。CSV 本身无法完整保留 JSON 的类型，空值也会成为空字符串。
- JSONPath 使用 JSONPath Plus 的 safe 表达式解释器，支持字段、下标、切片、递归、通配符和过滤条件，返回数组。查询也受 Worker 超时保护。
- Cron 支持 Linux 五字段和 Spring 六字段，以及 *、逗号、范围、步长、名称。? 只支持 Spring 的日期和星期字段。当前版本暂不处理 L、W、#、宏和年字段。Spring 日期与星期都受限制时会拒绝计算，避免与底层 Linux OR 语义混淆。
- Cron 的时区可选 Asia/Shanghai 或 UTC，基准时间按所选时区解析，结果为严格晚于基准时间的 7 次执行。空基准时间取当前时间。
- 摘要支持 MD5、SHA-1、SHA-256、SHA-512，文本按 UTF-8、文件按原始字节计算。文件上限 50 MiB，输出小写十六进制。

## 依赖与维护

本次使用 js-yaml 5.5.0、PapaParse 5.7.1、JSONPath Plus 11.3.0、cron-parser 5.10.6、cRonstrue 3.43.0、@noble/hashes 2.0.1。依赖的 Luxon、jsep 等许可证也保存在 LICENSES.txt。

重新打包时，在独立的构建目录安装上述固定版本及 esbuild 0.27.0，复制 toolkit-vendor-entry.js。用 esbuild 生成 browser 平台、IIFE 格式、globalName 为 toolkitVendor、target 为 es2022 的 bundle。再以 JSON.stringify 将 bundle 保存成声明 toolkitVendorSource 的脚本。新增核心工厂会在 Worker 内加载它。更新依赖时同步版本、许可证和本文记录。

## 验证方式

修改后检查各工具的示例、错误输入、复制、重置和输入变更后的旧结果清理。重点验证中文与 Emoji、CSV 引号和跨行单元格、JSONPath 过滤、Cron 周末和时区，以及文本和文件摘要是否一致。对复杂正则确认超时后页面仍可操作。

桌面检查侧栏能滚动到末尾，手机检查页面无整体横向溢出。文本差异表可以在自己的容器内横向滚动。使用 Impeccable detector 检查实际渲染页面，再结合实际交互与截图判断结果。

2026-11-19 本次验证已通过：原有核心算法回归、新增核心算法和浏览器交互、文本与文件摘要对照、复杂正则超时及恢复、旧版地址跳转、隐藏入口、320／390／820 像素宽度无页面横向溢出。断网下直接打开本地页面，JSONPath 和摘要的 Blob Worker 正常工作，运行时未发现外部请求。对 URL、正则、数据转换、Cron、摘要的实际渲染页面执行 Impeccable detector，结果为 0 条发现，并人工检查了桌面及手机截图。

## Cron 页面与可视化生成器（2026-11-27）

Cron 页保留表达式输入、规则、时区及基准时间，结果改为中文说明和 7 次执行的编号／时间／星期列表。生成器独立位于 #cron-builder，解析器保留 #cron。两页的规则、时区、基准时间、任务状态与结果各自独立，页面逻辑在 toolkit-cron.js，沿用统一配色和原生控件。支持秒（仅 Spring）、分、时、日、月、周的每值、范围、起点/步长和指定值；Spring 的日／周另可选 ?。常用预设覆盖分钟、小时、每日、工作日、每周、每月及元旦。

交互参考 https://cron.ciding.cc/ 的字段选择、常用定时和自动预览；执行结果采用用户截图中的说明及列表形式，不包含登录、广告或 AI 生成。已验证预设、多值选择、步长、月份／星期名称反解析、失败导入不覆盖配置、Spring 日期／星期互斥、Linux 切换、重置及旧结果清理；320／390／820px 无整体横向溢出，file:// 页面可运行本地 Worker。既有核心回归也通过。

生成配置通过 220ms 防抖更新生成器自己的表达式，仍调用现有 Worker 校验和计算。输入变化立即清除过期结果并终止旧任务。手工编辑、提交或重置会取消等待中的自动计算。反向载入先完整校验所有字段，再更新配置；暂不支持混合列表范围、L/W/#、Quartz 和年字段，不会用近似表达式替换原输入。生成器切换 Spring 日或周的限制时自动将另一项设为 ?，避免把 Linux 的 OR 语义带入 Spring。步长按字段内取值计算，不是从当前时刻累计的固定时长。这里只生成和预览，不创建真实定时任务。

侧栏现为「Cron 解析器」和「Cron 生成器」两个独立入口。摘要计算仅移除侧栏入口，保留原有 #hash 地址及实现。
