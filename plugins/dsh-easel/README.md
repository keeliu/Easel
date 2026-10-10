# dsh-easel

DeepSeek Harness (DSH) 的**自媒体工作台**面板。它把 [Easel](https://github.com/ZJU-REAL/Easel) 这套自媒体
内容工作流接进 DSH：**复用仓库里既有的技能、Python 脚本与数据目录**（`skills/`、`profiles/`、`outputs/`），
用 DSH 原生的会话、技能、排期与模型选择替代原来的 CLI 与 Web 界面——不搬运、不改写上游的任何内容。

> Creator Workbench panel for DeepSeek Harness. It reuses the Easel repository's own skills, Python scripts and
> data directories and drives them through DSH sessions and slots, instead of shipping a second copy of them.

## 能做什么

面板注册在侧边栏 `sidebar.panellist`，一个入口十个子页：

| 子页 | 说明 |
| --- | --- |
| 总览 | 账号/产物/排期/自检的摘要，异常项点名 |
| 账号 | 七个平台的登录态；扫码登录就地展开（二维码由仓库既有登录脚本产出） |
| 画像 | 新建画像并逐维度维护，写回 `profiles/` |
| 内容库 | 浏览 `outputs/<主题>/` 的产物；HTML/图片/视频可内联查看或下载 |
| 发布 | 选平台与产物 → **预检（不发布）** → 勾选确认后才真实执行；参数按各平台脚本形状拼装 |
| 日历 | 周一起始的 6×7 月历：内容、DSH 排期与平台活动同格呈现，可按类别筛选、翻月 |
| 选题 | 选题库；可派发到既有会话或新会话，并给出「打开会话」入口 |
| 热点 | 多来源热点线索，可一键沉淀为选题 |
| 数据 | 账号维度的统计视图 |
| 环境自检 | Python / ffmpeg / 发布依赖 / **浏览器内核**（真的启动一次）/ 运行时目录，每条带可执行 hint |

## 安装

```bash
# 1) 受控 Python 运行时（可选，但发布、内容守卫与扫码登录需要）
#    脚本随包发布在 <包根>/scripts/，默认装 core 分组；发布与登录再加 publish 组
bash <包根>/scripts/bootstrap-runtime.sh --groups core,publish --easel-root /path/to/Easel

# 2) 装进 DSH profile（在 DSH 会话里执行，或用插件管理器）
#    plugin_manager action=install_bundle target=/绝对路径/plugins/dsh-easel
```

无论插件被链接到哪里，宿主都会从 `import.meta.url` 的真实路径向上寻找 Easel 检出（`skills/` +
`pyproject.toml`）；也可以用配置项显式指定 `repoRoot` / `easelRoot` / `runtimeDir`。

## 免 root 的浏览器依赖

精简 Linux 上 playwright 下载的 Chromium 常常缺系统共享库（`ldd` 报一堆 `=> not found`），
登录脚本只会回一句「浏览器没能打开」。本包自带一个零依赖的补齐脚本，**不改系统目录、不需要 root**：

```bash
node <包根>/scripts/install-browser-deps.mjs --check   # 只看缺什么
node <包根>/scripts/install-browser-deps.mjs           # 解包到 <runtimeDir>/chromium-deps
```

解包出来的库由 `lib/host/browser-deps.js` 转成 `LD_LIBRARY_PATH`，登录、验证、账号数据与发布四类子进程
都会带上；自检里的「浏览器内核」条目**真的启动一次内核**，只看退出码，不靠「文件存在」下结论。

## 开发

```bash
node scripts/build-client.mjs          # 由 src/client.js + locale/*.json 生成 lib/client.js
node scripts/build-client.mjs --check  # 校验产物与源码一致
node --test test/*.test.mjs            # 全量单元测试（宿主 + 客户端，jsdom 渲染真实加载路径）
node scripts/check-install.mjs --profile <profile 目录> --url http://127.0.0.1:3080
```

宿主半边的改动需要重启 DSH 进程，客户端半边的改动刷新页面即可（若宿主仍旧版，面板会直接提示「重启 DSH」）。

## 许可

MIT。
