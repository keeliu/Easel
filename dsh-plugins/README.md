# Easel DSH bundle

本目录是把 [Easel](https://github.com/ZJU-REAL/Easel)（自媒体内容工作流）接进 DSH 的 bundle。
它**不修改 Easel 的技能、画像与产物**：`_repo/` 是上游检出，本 bundle 只读它、并通过 DSH 原生能力
（会话、技能、排期、附件、模型选择）替代 Easel 原来的 CLI 与 Web 界面。

```
dsh-plugins/
└── easel-workbench/          # 一个包，两半边
    ├── lib/index.js          # 宿主半边（cordis 插件入口，package.json 的 main）
    ├── lib/client.js         # 客户端半边（构建产物，不要手改）
    ├── lib/host/             # 宿主服务：画像/内容库/选题/账号/发布/排期/派发/自检…
    ├── src/client.js         # 客户端源码
    ├── scripts/build-client.mjs
    ├── assets/{persona.md,rules.md}
    ├── locale/{zh-CN.json,en.json}
    └── test/                 # node --test
```

## 1. 安装

```bash
# 1) 装运行时（可选，但发布/守卫类技能需要）
#    脚本随包发布在 <包根>/scripts/，从工作区根执行：
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh
#    也可以先 cd 进包目录再跑：cd dsh-plugins/easel-workbench && bash scripts/bootstrap-runtime.sh

# 2) 把本 bundle 装进 profile（在 DSH 会话里让 agent 执行，或走插件管理器）
#    plugin_manager action=install_bundle target=/绝对路径/dsh-plugins/easel-workbench
```

脚本的位置解析只看**脚本自身在哪里**：随包形态（`<包根>/scripts/`）下默认 venv 落在 `<包根>/.runtime`、
Easel 检出取 `<工作区>/_repo`，与进程工作目录无关；开发态放在 `<工作区>/scripts/` 下也同样有效。

安装后 `package.json` 的两半边分别由宿主与浏览器加载：`lib/index.js`（`main`）注册 `ctx.easel`
服务与 `/easel-workbench/api` 前缀接口；`dsh.client.platform = "web"` 让浏览器加载 `lib/client.js`
（侧边栏「自媒体工作台」入口 + 中栏面板）。**`lib/client.js` 是构建产物**：缺失时宿主会报
`MissingClientBundleError` 并提示先跑构建。

## 2. 运行时：期望路径与探测顺序

插件本身**不安装任何东西**，它只按固定顺序探测：

| 能力 | 探测顺序 |
| --- | --- |
| Python | `pythonExecutable` 配置 → `<runtimeDir>/venv/bin/python` → `PATH` 上的 `python3`、`python`、`python3.13`…`python3.10` → **`~/.local/bin` 下的同名候选** |
| ffmpeg | `ffmpegExecutable` 配置 → `<runtimeDir>/ffmpeg/bin/ffmpeg` → `PATH` 上的 `ffmpeg` → `~/.local/bin/ffmpeg` |

要点：

- **显式配置优先且不回退**。配了 `pythonExecutable` 而该文件不存在，自检直接报 `configured-missing`，
  不会悄悄改用 PATH 上的解释器——避免「以为在用受控运行时、其实在用系统 Python」。
- `runtimeDir` 留空时解析为 **`<插件包根>/.runtime`**，即引导脚本的默认落点，两者天然对齐。
  用 `link:` 方式装进 profile 时，包根是**链接目标**；如果那份副本没有 `.runtime`，可以在 profile
  的 `cordis.patch.yml` 里用 id 定向覆盖把它指到已有运行时（示例见第 4 节）。
- **`~/.local/bin` 单列**：`pip install --user`、pipx、以及「把自建解释器软链到 `~/.local/bin`」
  都不会修改 `PATH`，只扫 PATH 会得出「没有 Python」的错误结论。命中用户态目录时自检的
  `source` 是 `user-bin`，与 PATH 命中的 `path` 区分开。
- 探测结果不缓存于仓库内；登录态与二维码固定落在**仓库之外**（见第 5 节）。
- Python 版本探测超时 10 秒；缺 Python 或 ffmpeg **不会**让插件挂载失败，只会让对应技能不可用，
  并且自检里每一条非 `ok` 的条目都会带一段 `hint`（告诉用户下一步该运行什么命令）。

## 3. 引导脚本 `dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh`

只做显式安装：建 venv、按分组装依赖、自检、打印 ffmpeg 安装命令。**不装系统包、不用 sudo、
不下载浏览器、不写 `_repo` 下受版本控制的文件**（venv 落在插件的 `.runtime/`）。

```bash
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh                      # 默认分组
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh --groups core,easel  # 最小：够工作台与内容守卫跑起来
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh --groups all         # 含 audio/video 重依赖
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh --list-groups         # 只看分组与依赖
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh --check               # 只自检，不安装
bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh --recreate            # 删掉重建 venv
```

| 选项 | 说明 |
| --- | --- |
| `--groups LIST` | 分组，逗号分隔；`all` 表示全部。默认 `core,easel,image,data,doc,publish` |
| `--runtime-dir DIR` | venv 所在目录，默认 `<工作区>/dsh-plugins/easel-workbench/.runtime` |
| `--easel-root DIR` | Easel 检出目录，默认同目录下的 `_repo` |
| `--python CMD` | 建 venv 用的系统解释器（默认按 `python3`、`python`、`python3.13`…`python3.10` 探测：稳定别名优先，其次带版本号的名字） |
| `--index-url URL` | pip 索引（等价 `PIP_INDEX_URL`） |
| `--recreate` / `--no-upgrade-pip` / `--no-easel-package` | 重建 venv / 不升级 pip / 不装 Easel 包 |
| `--check` / `--list-groups` / `--dry-run` | 只自检 / 只列分组 / 只打印将要执行的命令 |

环境变量：`EASEL_WORKBENCH_RUNTIME_DIR`、`EASEL_ROOT`、`EASEL_BOOTSTRAP_PYTHON`、`PIP_INDEX_URL`
（对应上面同名选项，命令行参数优先）。

退出码：`0` 成功｜`2` 用法错误｜`3` 前置条件不满足（缺少 Python 或缺 venv 模块）｜`4` 安装或自检失败。
**脚本可重复执行**：已有 venv 会复用，已装的依赖不会重装。

几个容易踩的点，行为已由测试钉住：

- `--dry-run` **不安装也不自检**（什么都没装时自检必然失败），因此它总是 `exit 0` 且不创建
  `--runtime-dir`；`--check` 则相反，缺依赖就按 `exit 4` 失败，而且它**按 `--groups` 决定检查范围**：
  只装了 `core` 的环境要跑 `--check --groups core`，否则默认分组里的 image/data/doc/publish 会报缺失。
- `--runtime-dir` / `--easel-root` 的默认值由**脚本所在位置**推出（随包形态为 `<包根>/.runtime` 与
  `<工作区>/_repo`），与进程工作目录无关，因此在任何目录下执行结果一致。
- 分组规格串里**不能出现引号**：`PIP_ARGS` 之外的规格是 `$specs` 未加引号展开，shell 只按空格
  分词、不做引号剥离，带引号会被 pip 当成包名的一部分（`Invalid requirement`）。
- pip 带 `--retries 5 --timeout 30`：本环境的 pip 索引出现过瞬时 `from versions: none`，
  重试即可恢复，不是规格写错。
- 缺少 `python3` 别名时用 `--python ~/.local/bin/python3.12` 这类带版本号的路径；解释器只需 ≥3.10。
- **`--groups core` 不够扫码登录**：登录脚本要开浏览器，六个平台都 `import playwright`（只有 B 站登录是
  纯标准库）。工作台的环境自检为此单列「发布与登录依赖」一项：缺 `playwright` 报缺失，只缺 `biliup` 一类
  报降级（只影响 B 站上传与资讯类技能）。补装用
  `bash dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh --groups core,publish`；本机实测
  `files.pythonhosted.org` 上 47.5 MB 的 playwright wheel 会卡死，给 pip 指定镜像即可
  （`PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`）。playwright 还需要浏览器内核，若
  `~/.cache/ms-playwright` 下已有匹配的 `chromium-*` 就无需再下（本机装 `playwright==1.60.0` 时期望
  `chromium-1223`，恰好已存在）；`biliup` 若卡在 `Preparing metadata`（sdist 构建），可改用官方 release
  的单文件二进制放进 `PATH` 或 `~/.local/bin`——B 站上传脚本只用 `which biliup` 找命令行。

### 依赖分组

| 分组 | 覆盖的技能 | 主要依赖 |
| --- | --- | --- |
| `core` | 工作台后端、内容守卫、登录态、排期脚本 | fastapi、uvicorn、sse-starlette、httpx、pydantic、python-multipart、segno、websocket-client、cryptography、PyYAML、markdown |
| `image` | 图像、抠图、插图、封面 | Pillow、opencv-python、numpy、rembg、matplotlib |
| `audio` | 配音、混音、语音转写 | numpy、librosa、edge-tts、faster-whisper、onnxruntime |
| `video` | 视频剪辑与字幕（另需 ffmpeg） | opencv-python、numpy、Pillow |
| `data` | 数据表、词频、情感分析 | pandas、openpyxl、numpy、matplotlib、jieba、snownlp |
| `doc` | 文档 / 网页转换、繁简转换 | pdfplumber、PyMuPDF、beautifulsoup4、zhconv、markdown |
| `publish` | 浏览器登录与跨平台发布 | playwright、biliup、requests、urllib3、beautifulsoup4 |
| `easel` | `pip install -e <easelRoot>`（`easel.openclaw_workspace` 被 video-production 技能引用） | — |

依赖清单与 `_repo/pyproject.toml` 同源，只是按技能拆细，这样「只做图文」的机器不必装
faster-whisper 这类重依赖。逐条对照过：`pyproject.toml` 的 **23 个声明依赖全部落在某个分组里**（无遗漏），
另有 9 个只被技能脚本直接 `import`、项目未声明的包（beautifulsoup4、onnxruntime、openpyxl、pdfplumber、
PyMuPDF、PyYAML、requests、urllib3、zhconv）；除 `easel` 组的可编辑安装命令外，**40 条规格全部通过 pip
的 requirement 解析器**（解析器不联网，只做语法与版本区间校验）。

### 引导脚本**不做**的两件事

1. **ffmpeg**：只打印各系统的安装命令（apt/dnf/pacman/brew/winget），由你确认后执行。
2. **Playwright 浏览器**：只提示 `"<venv>/bin/python" -m playwright install chromium`。
   这两件事都会往系统里放东西，不属于「一次性引导」的范围。

## 4. 配置

所有字段都有默认值，最常用的三个：

```jsonc
{
  "easelRoot": "",            // 留空自动推断：优先 <工作区>/_repo，其次工作区本身
  "pythonExecutable": "",     // 留空用 <runtimeDir>/venv/bin/python，再退到 PATH
  "ffmpegExecutable": "",     // 同上
  "runtimeDir": "",           // 留空 = <插件包根>/.runtime
  "taskDispatchTarget": "current-session",  // 或 "new-session"
  "loginStateDir": "",        // 留空 = $DSH_HOME/easel-workbench/login
  "personaSource": "",        // 留空 = 随包 assets/persona.md
  "rulesSource": "",          // 留空 = 随包 assets/rules.md
  "skillDirs": ["skills/openclaw"],
  "catalogDescriptionMaxLength": 500,
  "personaScoreThreshold": 70,
  "publishTimeoutMs": 600000
}
```

`repoRoot` 默认留空：`resolveRuntimeConfig` 会按 **显式配置 → 插件包真实路径向上 → 进程工作目录向上**
的顺序寻找仓库根，因此插件既能在「工作区 + `_repo`」形态下工作，也能在「Easel 就是顶层目录」的
直接克隆形态下工作。

`personaSource` / `rulesSource` 支持绝对路径（原样使用）与相对路径（相对插件包根解析）；
未配置或读不到时回落到随包的 `assets/`，**已创建的会话不受影响**（人设只在创建 agent 时读取）。
改完配置新建一个会话就能看到新文本。

### 让已安装副本复用一份现成的运行时

用 `link:` 装进 profile 时，包根是链接目标（例如 `<工作区>/_repo/dsh-plugins/easel-workbench`），
而你可能只在开发副本（`<工作区>/dsh-plugins/easel-workbench`）里跑过引导脚本。这时在 profile 的
`cordis.patch.yml` 里按 id 定向覆盖即可（补丁层在每个 bundle 层之后生效）：

```yaml
- id: easel-workbench
  config:
    # 绝对路径；指到已经建好的 venv 所在目录，避免在另一份副本里重下一遍
    runtimeDir: /绝对路径/dsh-plugins/easel-workbench/.runtime
```

改完必须重载/重启 DSH 才会重新读取配置（见第 8 节与 design D13）。

## 5. 登录态与仓库只读

- **登录态必须在仓库之外**：`loginStateDir` 优先级为 显式配置 → `$DSH_HOME/easel-workbench/login` →
  `~/.dsh/easel-workbench/login`，三者都不在检出内，因此 `git status` 永远是干净的。
- **`skills/` 与 `skills/shared/scripts/` 只读**：任何写入请求都会被拒绝（错误码 `upstream-read-only`
  / `path-out-of-scope`），并记入审计（`paths.blockedWrites()` 只保留最近 100 条，含相对路径与操作类型）。
  这样 `_repo` 始终能直接 `git pull` 上游。
- 产物写入只允许落在 `outputs/`（内容库）与 `profiles/`（画像）下。

## 6. 接口小节

### 6.1 宿主侧 DSH 只读接口（任务 5.1 的确认结果）

在写实现前用只读接口核对了两个字段，结论如下（源码位置为 DSH 安装目录）：

| 用途 | 真实签名 | 位置 |
| --- | --- | --- |
| 给新建的会话指定 preset | `CreateAgentOptions.meta.agentPreset?: string` | `@deepseek-ai/dsh-agent/lib/types/index.d.ts:70` |
| 读取当前模型选择 | `AgentDefaultModelConfig.currentSelection(): ModelSelection` | `@deepseek-ai/dsh-agent-default-model/lib/types/index.d.ts:42` |
| 模型选择的结构 | `{ provider: string; model: string; reasoningEffort?: ReasoningEffortId }` | `@deepseek-ai/dsh-agent/lib/types/model-selection.d.ts:16-23` |

因此派发实现是：`meta = { cwd: runtime.easelRoot ?? runtime.repoRoot }`，preset 能力可用时才加
`meta.agentPreset = "easel"`，模型只**透传** `currentSelection()` 的结果——插件不定义路由、
不保存凭据、不写模型设置界面。

其余被用到的能力：`ctx.agents.create({ sessionId, meta })` / `agents.resume`、
`ctx.attachments.saveFile`、`ctx.agentPresets.register`、`ctx.schedule.create/catalog/delete`、
`ctx.webServer.register`、`ctx.tools.register/guard`、`ctx.subprocess.spawn`。
任何一项缺失都**不会**让插件挂载失败，只在环境自检里记一条 `missing`/`degraded`。

### 6.2 工作台 HTTP 接口

前缀 `/easel-workbench/api`，响应统一 `{ok:true, ...}`，错误 `{ok:false, code, message}`。
仅供本 bundle 的客户端半边使用（浏览器 `fetch`），**没有上传接口**（素材走 DSH 附件能力）。

```
GET    /config /selfcheck /persona /overview
GET    /profiles            POST /profiles            GET /profiles/:name
PUT    /profiles/:name/dimensions/:dimension
GET    /projects            GET  /projects/:topic
GET    /topics              POST /topics              PATCH /topics/:id   DELETE /topics/:id
GET    /trends
GET    /accounts            GET  /accounts/:id        GET /accounts/:id/stats
POST   /accounts/:id/verify POST /accounts/:id/login-plan
POST   /accounts/:id/login  GET  /accounts/:id/login/status  DELETE /accounts/:id/login
POST   /accounts/:id/login/sms  GET /accounts/:id/qr
GET    /publish/platforms   GET  /publish/history
POST   /publish/preview     POST /publish/execute
GET    /schedule            POST /schedule            DELETE /schedule/:id
GET    /sessions            POST /dispatch
GET    /files?path=…&download=1
```

错误码到 HTTP 状态的映射：`invalid-input`→400、`not-found`→404、`path-out-of-scope`/`upstream-read-only`→403、
`content-guard-blocked`→422、`auth-expired`→401、`not-configured`/`runtime-missing`→501、
`source-unavailable`→503、`publish-failed`→502、`no-agent`→409。

### 6.3 排期

排期全部落在 DSH 原生排期服务里，标题前缀 `Easel｜`（工作台据此识别自己的条目）。
**插件内没有调度器**：没有 `setInterval`、没有 cron 依赖、没有子进程定时器（有防回归测试扫描源码）。
到点触发时任务说明是自包含的（含任务目标、目标画像、期望产物，且不含会话标识与临时路径），
因此在新会话里也能被独立理解。在 DSH 排期界面暂停/删除后，工作台视图同步反映。

日历区域可以**登记**与**删除**排期（`POST /schedule`、`DELETE /schedule/:id`）：填主题、任务目标与期望产物，
再选一个投递会话和重复方式（每天 / 每周 / 只一次）。两点是刻意的：① 正因为识别靠 `Easel｜` 前缀，
在 DSH 自己的排期界面里建的条目**不会**出现在工作台里，所以面板必须自己提供入口，否则日历永远是空的；
② 删除必须同时给 `id` 与 `sessionId`（`lib/host/schedule.js:remove` 会校验会话绑定），因此没有会话绑定的
条目不渲染删除按钮。时区默认取浏览器所在时区，取不到才回落 `Asia/Shanghai`，没有写死。

### 6.4 技能根与目录成本（任务 1.3 / 9.5）

`skillDirs` 是**追加**给 `@deepseek-ai/dsh-skill-filesystem` 的 `customSkillDirs`，不改宿主的全局技能
配置，也不替换原有技能根：`lib/index.js:36` 默认 `[]`、`:79` `resolve` 后使用、`:166` 追加进扫描根；
`lib/types/index.d.ts:27` 的原文是 “Additional skill roots scanned after project roots and before user
roots”，且 `includeDefaultRoots`（`:33`）默认 `true` → **原 DSH 技能仍可见**，插件只多出一批 Easel 技能。

目录成本实测（真实 `_repo/skills/openclaw` 下 **114** 个 `SKILL.md`，按 `@deepseek-ai/dsh-tool-skill`
`lib/index.js:359-362` 的规则复刻：空白折叠成单空格、超限则 `slice(0, max-3) + "..."`）：

| `catalogDescriptionMaxLength` | 目录总字符 | 被截断条目 | 最长描述 |
| --- | --- | --- | --- |
| `500`（默认） | 24493 | 0 | 298 |
| `120` | 15577（省 8916） | 109 | 120（以 `...` 结尾） |

两档下 114 个 `name` 序列完全一致，说明调低上限只影响描述、不影响技能能否被选中。

**打包要点**：`package.json` 的 `files` 必须包含 `assets/`——`personaSource`/`rulesSource` 未配置时
默认读 `<包根>/assets/{persona.md,rules.md}`，漏掉它装出来的包会 `not-found`。

## 7. 安全门禁

两条路径都拦：

1. **服务方法**（`POST /publish/execute`）内部强制先跑 `content_guard.py`，命中即阻止，返回命中分类
   （`api-key`、`env-value`、`internal-host`、`proxy-ip`、`internal-path`、`env-name`）。
2. **工具守卫**（`ctx.tools.guard`）拦截模型绕过工作台、直接 `bash` 调用发布脚本并带 `--exec` 的情况；
   `--allow-unsafe` 这类关闭扫描的开关一律拒绝。人设一致性低分**只告警、不阻断**。

插件里不存在任何绕过开关（Config 无 `skip*`/`allow*`/`force*` 一类字段，服务方法签名没有旁路入参），
这条约束写成了防回归测试。

## 8. 失败排查

| 现象 | 原因与处理 |
| --- | --- |
| 侧边栏没有「自媒体工作台」入口 | `dsh.client.platform` 有值但 `lib/client.js` 缺失 → 跑 `node scripts/build-client.mjs`，然后重新加载页面 |
| 面板打开但各区域都报接口错误 | 宿主半边没加载：跑 `node scripts/check-install.mjs`（第 10 节）定位；若客户端显示「宿主服务未挂载」即接口 404 且无响应体，重载/重启 DSH 后重试 |
| 装了但不确定是否真的生效 | `node scripts/check-install.mjs --profile /data/dsh/profiles/web`：五项全绿才算「装上了而且宿主接口可达」 |
| 自检里 `python` 为 `configured-missing` | `pythonExecutable` 指向了不存在的文件；显式配置**不会**回退到 PATH，改配置或删掉它 |
| 自检里 `python`/`ffmpeg` 缺失 | 先看条目自带的 `hint`：Python 可用 `pythonExecutable`、引导脚本或 `~/.local/bin` 任一路径解决；ffmpeg 按脚本打印的系统命令自行安装 |
| 自检里 `runtime-dir` 缺失/降级 | 提示会点名引导脚本的绝对路径，按第 3 节执行；也可以把 `runtimeDir` 指到已有运行时（第 4 节） |
| 自检里 `python` 显示 `user-bin` | 命中的是 `~/.local/bin` 下的解释器（不在 `PATH` 上）；只要版本够用就是正常结果 |
| 技能目录里没有 Easel 技能 | 确认 `dsh-skill-filesystem` 已启用且 `skillDirs` 指向 `<easelRoot>/skills/openclaw` |
| 写画像/产物报 `upstream-read-only` | 目标落在 `skills/` 下；这是设计行为，换到 `profiles/` 或 `outputs/` |
| 写文件报 `not-configured` | 没定位到 Easel 数据根：设 `easelRoot` 指向含 `skills/` 与 `pyproject.toml` 的目录 |
| 发布报 `runtime-missing` | 该平台脚本需要 Python 与依赖，先跑引导脚本（`--groups core,publish`） |
| 发布报 `auth-expired` | 登录态失效，在工作台「账号」区域按引导重新授权 |
| 排期入口不可用（501） | 当前 DSH 运行环境没有排期服务；这是如实降级，不是错误 |
| 派发报 `no-agent` | 「绑定既有会话」模式下该会话没有存活 agent，且 `agents.resume` 不可用 |

诊断优先看两处：`GET /easel-workbench/api/selfcheck`（十项检查 + 能力探测）与宿主日志
（挂载时会打印数据根、工作区与接口前缀）。

## 9. 与旧入口的对照（迁移说明）

Easel 原来的 `easel` CLI 与 `web/app.py` 工作台被拆成「DSH 原生能力 + 本插件的十个区域」。
被删除的路由与其替代：

| 旧入口（`_repo/web/app.py`） | 现在由谁承担 |
| --- | --- |
| `/api/chat*`、`/api/chat/question/*`（会话与提问卡片） | DSH 会话与提问卡片；工作台「在对话中打开」跳到对应会话 |
| `/api/settings/models*`、`/api/settings/local-agents*`（模型设置） | DSH 模型选择（插件只透传 `currentSelection()`，不提供模型界面） |
| `/api/skills`、`/api/skill/{name}`（技能浏览） | DSH 技能目录与 `SKILL.md` 右栏预览（`_repo/skills/openclaw` 挂进 `customSkillDirs`） |
| `/api/env*`（环境安装任务） | 包内 `scripts/bootstrap-runtime.sh` + 工作台「环境自检」区域 |
| `/api/personas`、`/api/persona/{name}*` | 工作台「画像」区域（读写 `profiles/`，跳过 `_template`） |
| `/api/outputs`、`/api/output/{path}`、`/api/media/{path}` | 工作台「内容库」区域（`outputs/` 项目与文件清单） |
| `/api/upload*` | DSH 附件能力（**刻意不提供上传接口**） |
| `/api/accounts`、`/api/login/{platform}` | 工作台「账号」区域（登录态三态 + 授权引导，登录态在仓库外） |
| `/onepage`、`/static/*`（前端页面） | `lib/client.js`（DSH slot 内的面板，跟随主题令牌，不用 iframe） |
| `easel chat` / `easel web`（CLI 入口） | DSH 会话本身；工作台只是侧边栏里的一个面板 |

保留不动的：`_repo/skills/**`（技能实现，只读）、`_repo/profiles/`（画像数据）、`_repo/outputs/`
（产物）、以及 `pip install -e .` 提供的 `easel.openclaw_workspace` 包。

**`_repo/README.md` 有意不改**：迁移对照集中在本节，`_repo` 内不产生技能、画像、产物之外的文件改动，
这样 `_repo` 仍能直接 `git pull` 上游（`git -C _repo remote -v` 为上游 `origin`，
`git -C _repo status --porcelain` 为空）。删除 `web/app.py` 的三组路由要等新路径在真机全部验收通过后
再做，在那之前旧入口仍可用。

## 10. 开发

```bash
node scripts/build-client.mjs          # 生成 lib/client.js
node scripts/build-client.mjs --check  # 校验产物是否与源码/locale 同步（CI 用）
node --test test/*.test.mjs            # 全部测试
node scripts/check-install.mjs --profile /data/dsh/profiles/web   # 安装自检（见下）
```

`scripts/check-install.mjs` 把「装上了」与「真的在跑」分开检查，任一项失败即非零退出：

```bash
node scripts/check-install.mjs [--profile <profile 目录>] [--url <http://127.0.0.1:3080>] [--import] [--no-http] [--json]
```

| 检查项 | 判据与失败时的下一步 |
| --- | --- |
| `profile` | profile 清单声明了本插件且列进 `dsh.profile.bundles`；否则按 README §1 重装 |
| `包落地` | 从 profile 能解析到插件目录，`lib/index.js` 与 `lib/client.js` 都是非空文件；`lib/client.js` 缺失时先跑 `build-client.mjs` |
| `裸导入` | `lib/**` 里每个裸模块说明符都能落地：`node:` 内置、`peerDependencies`（由 DSH 的 profile 解析拦截提供），或目标目录/profile 的 `node_modules` 里真实存在。**这一项就是「源码树 `link:` 缺 `node_modules`」的判据** |
| `import`（可选 `--import`） | 在 profile 目录里真的 `import("easel-workbench")`；仅因宿主 peer 包缺失而失败时只作信息提示（普通 Node 进程看不到 DSH 的拦截层） |
| `HTTP` | `GET <url>/easel-workbench/api/config` 必须 200 + JSON；**空响应体的 404 = 宿主半边未挂载，重载/重启 DSH**（design D13） |

宿主半边（`lib/host/**`）是纯函数式服务，测试用假 `ctx` 注入；客户端测试跑在 jsdom 里并校验
产物不含 iframe、不含 DSH 客户端包依赖、不含硬编码色值。需要可执行位的测试夹具建在
`<Easel>/.tooling/tmp/` 而不是 `/tmp`——本机 `/tmp` 挂载是 `noexec`，`access(X_OK)` 在那里必然失败。

验收用 OpenSpec（CLI 不在 PATH 上，随 `.tooling` 装好）：

```bash
./.tooling/node_modules/.bin/openspec validate add-easel-workbench-plugin --strict
```
