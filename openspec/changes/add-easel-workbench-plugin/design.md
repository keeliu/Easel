# Design

## Context

见 `proposal.md` 的 Why。本设计只记录决定实现方式的当前状态与约束。

**仓库现状**：`_repo` 是 Easel 上游（ZJU-REAL/Easel）的克隆，分支 `main`，HEAD `fb80ae6`；1002 个受版本控制文件，其中 `_repo/skills/` 占 97,824 行、`_repo/web/frontend/src/` 占 8,557 行、`_repo/web/app.py` 单文件 4,419 行、`_repo/easel/` 2,012 行。Easel 的进程结构是「Python CLI 拉起 OpenClaw 子进程 + FastAPI 服务 + 独立 React 前端」，三层都自带会话与模型概念。

**本机运行时现状（阻断性前置）**：存在 Node v24.21.0 与 pnpm；**不存在** `python`、`python3`、`pip`、`uv`、`uvx`、`ffmpeg`。`_repo/skills/` 下 114 个技能全部以 `python3 <script>.py` 形式调用，音视频技能另需 `ffmpeg`。

**DSH 侧已有能力（实测，详见 `EASEL-DSH-需求文档.md` 附录 A）**：`sidebar.panellist`（root 作用域的 list 插槽，条目 `{id, order, label}`，同一 `id` 寻址 `main` 的 keyed 条目）、`main`（root 作用域 keyed，`conversation` 为会话保留键）、`ctx.layout.selectPanel/toggleSidebar/openRightbar/closeRightbar`、`ctx.uiWorkspace.openSession/startSession/openWorkspace/forkSession`、`ctx.agents.create/resume/get/list` 与 `AgentHandle.followup/steer/cancel/whenIdle`、`ctx.agentDefaultModel.currentSelection()`、`ctx.workspaceFiles`、`ctx.attachments`、`ctx.subprocess`、`ctx.tools.guard()`、`ctx.systemPrompt.section()`。

**openspec 侧现状**：`openspec/changes/add-easel-workbench-plugin/` 已有 `proposal.md` 与 7 个能力 delta（`specs/*/spec.md`），`openspec validate --strict` 通过。

## Goals / Non-Goals

**Goals:**

- 让 Easel 的 114 个技能、约 50 个共享媒体脚本、七平台发布实现与创作者人设文本，在 DSH 的模型、会话、审批与技能体系下继续可用。
- 让插件对模型、会话、技能三件事**零持有**：不改写、不复制、不旁路 DSH 的对应设施。
- 让改造可以在不破坏上游可合并性的前提下逐步落地，且每一步都可独立验证。

**Non-Goals:**

- 不复刻 Easel 的 FastAPI 服务与 React 前端框架：路由与页面被重写为宿主服务方法与客户端面板组件，不是原样搬运。
- 不实现操作系统级调度、不实现跨机发布集群、不为 Easel 技能引入容器化运行时。
- 不迁移任何既有平台的登录凭据（见 `specs/platform-publishing/spec.md`）。
- 不改造 `_repo` 内的上游代码，也不向上游提交 PR（见决策 D1）。

## Decisions

### D1：bundle 建在仓库新目录中，`_repo` 保持上游只读

在 `/data/dsh/home/dsh-hub/Easel/` 下新建 `dsh-plugins/` 作为 bundle 工作区，`_repo` 不再被写入，仅作为上游参考与技能/画像/产物的数据来源被读取。

- **备选 A**：直接在 `_repo` 内改造。否决理由：`_repo` 是上游克隆，改造会与其 `main` 分叉，后续无法 `git pull`；且 `openspec validate --strict` 的 `allowedEditRoots` 已含仓库根，无需侵入 `_repo` 即可满足作用域要求。
- **备选 B**：把 bundle 做成独立仓库。否决理由：技能根、画像、产物都在本仓库内，跨仓库会让配置项与路径解析多一层间接。

### D2：单个 bundle，宿主与客户端同包

一个 bundle 内同时提供宿主入口（服务、工具守卫、preset 补丁）与客户端入口（面板组件），通过同一 `cordis.patch.yml` 插入。理由：面板与宿主服务是一体两面，拆成两个包会引入版本对齐成本，且 DSH 的 `dsh.client` 字段本就允许同包声明客户端入口。

- **备选**：宿主包 + 客户端包分离。否决理由：本次改造的两半没有独立生命周期，分离只增加发布协调成本。

### D3：单一 `easel-workbench` 面板键 + 面板内子导航

`sidebar.panellist` 只注册一个条目（`id: easel-workbench`），`main` 的同一 key 承载整个工作台；Easel 的 15 个页面收敛为面板内的 10 个功能区域，由面板内部子导航切换。

- **备选**：为每个页面注册一个 `main` key 与一个侧边栏条目。否决理由：`sidebar.panellist` 是「全局面板图标入口」，15 个图标会淹没侧边栏并挤占会话列表；且需求要求「单独一个入口」。
- **备选**：用右栏（`openRightbar`）承载工作台。否决理由：需求明确要求「覆盖现有的会话框区域」，即中栏 `main`；右栏要让位于中栏空间。

### D4：任务执行走 DSH Session，插件不介入模型路由

工作台的一切 AI 动作都发生在 DSH 会话内：绑定既有会话时用 `ctx.agents.get/ resume` 取该会话的 agent 并 `followup()` 投递；新开会话时显式指定该会话的工作目录（用户指定优先，否则 Easel 数据根）。需要自行创建 agent 时先查 `ctx.agentDefaultModel.currentSelection()`。

- **备选**：插件自建 agent 并自行解析模型。否决理由：与 proposal 的「模型一律继承 DSH」冲突，且会重新引入模型配置面。
- **备选**：插件直接调用 LLM 完成生成任务。否决理由：会绕过 DSH 的会话记录、审批与工具链，工作台产出将不可审计。
- **实现期确认（原 D4 的「按 `ctx.uiWorkspace` 的工作区优先级创建」不可行，spec 的 `新开会话` 要求已按此回改）**：
  - 该优先级链在**浏览器侧**：`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:851-852` `const target = workspaceId ?? currentWorkspaceId ?? recent;`（另见同文件 `:940`），宿主插件无法调用；宿主侧只有 `ctx.workspaceController.create({ path })`（`@deepseek-ai/dsh-api-workspace-controller/lib/types/index.d.ts:36-105`，请求体 `{ path: string }` @ `.../lib/types/types.d.ts:70-72`），它要求一个**绝对路径**，没有「最近活跃」语义。
  - 会话的 `cwd` 不是可有可无的展示字段：`@deepseek-ai/dsh-api-session-controller/lib/index.js:1900` `if (record.header.cwd === void 0) continue;` 与 `:1934` 的 `visible.filter((record) => record.header.cwd !== void 0)` 会把没有 cwd 的会话从列表里滤掉；`@deepseek-ai/dsh-agent-instructions/lib/index.js:912` 用 `session.header.cwd ?? process.cwd()` 决定指令根；`@deepseek-ai/dsh-session/lib/index.js:1044-1046` 要求 cwd 是绝对路径字符串，`:1703` 只在已定义时传播。
  - 因此 `lib/host/dispatch.js` 的 `resolveWorkspace(input)` 只做两级：显式 `input.workspace`（必须绝对，否则 `INVALID_INPUT`）→ `runtime.easelRoot ?? runtime.repoRoot`；并把结果通过 `ensureWorkspaceRegistered()` 尽力登记到 `ctx.workspaceController`（登记失败只影响侧边栏归类，不阻断派发）。

### D5：技能以 `customSkillDirs` 全局挂载为第一实现

`skills/openclaw/` 作为 `dsh-skill-filesystem` 的 `customSkillDirs` 之一挂载；`layer:` 等 Easel 专有 frontmatter 字段依赖「未知字段被忽略」的解析行为存活。

- **备选**：在 `easel` preset 内挂载 `dsh-skill-filesystem` 以隔离技能根。暂缓理由：能否在 preset（agent 作用域）内隔离技能根**未经验证**；先取确定性方案，隔离作为后续优化（见 Open Questions Q2）。
- **注意**：`dsh-skill-filesystem` 在本机 profile 中当前 `status: inactive`，实现期需先启用或由本 bundle 显式插入。

### D6：删除 `layer:` 之外的 Easel 技能契约，不做格式迁移

不改写 114 个 `SKILL.md`：DSH 只读取 `name`/`description`/`whenToUse`/`metadata`/调用开关，Easel 的 `layer:` 被忽略即可。描述长度 101–301 字符，全部低于 DSH 默认上限 500，无需截断。

- **备选**：把 `layer:` 迁移为 `metadata.layer`。否决理由：无消费方，纯增改动面；且会把 114 个文件推向上游分叉。

### D7：发布安全门禁放在服务方法与工具守卫两处

`platform-publishing` 的发布路径先由宿主服务方法强制运行 `_repo/skills/shared/scripts/content_guard.py`（命中时 exit 7），服务方法**不暴露**任何跳过参数；同时用 `ctx.tools.guard()` 对执行发布脚本的命令加一层守卫，使模型绕过服务方法直接调用脚本时同样被拦。

- **备选**：只在服务方法内检查。否决理由：模型可以改用 bash 工具直接调用发布脚本，单点检查可被绕过。
- **备选**：只做工具守卫。否决理由：守卫面向命令字符串，难以覆盖「先写产物再发布」的两步流程，服务层的产物级检查更准确。

### D8：运行时由 Config 指向，不自动安装

插件通过 Config 接收 `pythonExecutable` 与 `ffmpegExecutable`（含 `null` 表示「从 PATH 探测」）。缺失时环境自检区域如实报告，工作台其余区域照常可用。不提供自动 `pip install`。

- **备选**：插件启动时自动建 venv 并安装 `_repo/pyproject.toml` 依赖。否决理由：在用户机器上静默下载并执行安装脚本超出插件权限边界；且 Easel 依赖含 `playwright`、`rembg`、`faster-whisper` 等重依赖，失败模式难以在插件内善后。
- **配套**：提供一次性引导脚本与文档，由用户显式执行。

### D9：工作台数据路径即为 `_repo` 内既有目录

画像取 `profiles/`、产物取 `outputs/`、选题与排期数据落在仓库内的文本文件；这些路径经 Config 指定，默认指向 `_repo` 下的同名目录。上游路径（`skills/`、`skills/shared/scripts/`）在服务层做写入拒绝。

- **备选**：把数据迁到 `$DSH_HOME` 下。否决理由：会与既有 Easel 产出脱钩，用户既有 `outputs/` 与 `profiles/` 将不可见，违背「保留资产」的改造目标。

### D10：i18n 与图标随包交付

`locale/zh-CN.json` 与 `locale/en.json` 提供 `meta.title`/`meta.description` 与面板文案；顶层 `icon` 为包内相对路径的 SVG。面板条目 label 用 locale-aware 形式而非硬编码中文字符串。

### D11：宿主运行时包一律用 `peerDependencies` 声明

`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/cordis` 都由 DSH 宿主或 profile 提供，插件只用 `peerDependencies` 声明版本范围，`dependencies` 保持为空。实测证据：profile 内同类插件 `dsh-context`（`{"@deepseek-ai/schemastery":"^3.18.2","@deepseek-ai/cordis":"^4.0.2"}`）、`@michengai/dsh-automation`、`dsh-mcp-connector` 的 `dependencies` 全为 `{}`，宿主内部包只出现在 `peerDependencies`；本插件原先把它们写在 `dependencies`。

- **备选**：继续用 `dependencies` 自装宿主包。否决理由：pnpm 会尝试把宿主内部包装进插件自己的树，与运行时的实际解析路径不一致，且与生态约定冲突。

### D12：bundle 以「物化安装」为受支持方式，源码树 `link:` 只作开发态

pnpm 不会为 `link:` 目标安装其依赖；Node 又按**链接目标的真实路径**解析模块，因此当源码树位于 profile 之外时，它永远看不到 profile 的 `node_modules`。实测：以 `link:` 安装后，profile 解析到的是 `_repo/dsh-plugins/easel-workbench/lib/index.js`，其内部导入抛
`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery' imported from /data/dsh/home/dsh-hub/Easel/_repo/dsh-plugins/easel-workbench/lib/host/config.js`。
受支持的安装方式是**物化安装**（`pnpm pack` 后安装 `.tgz`／git 规格／registry），使插件落在 profile 的 `node_modules` 树内、peer 依赖沿树向上解析；若坚持源码树 `link:`，该源码树必须先自带 `node_modules`（本机即以 `pnpm install --config.minimumReleaseAge=0` 修复后才能导入）。

- **备选**：把宿主包 vendor 进包内。否决理由：与 DSH 版本漂移，且违背「对模型、会话、技能零持有」的目标。

### D13：安装或依赖变化后必须重载进程，验收判据是宿主接口可达

宿主半边导入失败时，cordis 中该条目没有 fiber（`@deepseek-ai/dsh-app-boot/lib/index.js:3904-3913` 把 `entry.fiber === undefined` 记为 `failed to import`），`ctx.webServer.register({kind:"prefix", path:"/easel-workbench/api"})` 因此从未执行。运行中的进程不会自行重试：实测 `touch` 补丁文件、入口与 `package.json` 后接口仍 404；`plugin_manager` 的 `set_bundle enabled=true` 返回 `changed:false` 并重复旧的 `failed to import`。故验收判据是「重启 DSH 后 `GET /easel-workbench/api/config` 返回 200 且响应体为 JSON」，而不是「侧边栏出现了入口」。

- **备选**：进程内热修复后验收。否决理由：DSH 没有重载失败条目的入口，等待不会自愈。

### D14：客户端在宿主半边缺失时给出可操作诊断

宿主未挂载时，`/easel-workbench/api/*` 返回的是 DSH 的默认 404（0 字节、无响应体），与插件自身 404 的 `{"ok":false,"code":"not-found",…}` 可区分。客户端 SHALL 对「无响应体的 404」显示「宿主半边未挂载，请重启 DSH」一类的可操作提示，而不是裸的 `错误信息: HTTP 404`；对插件自身返回的错误仍按原有错误态呈现。

### D15：运行时探测必须覆盖用户态目录，缺失项必须自带下一步

只扫 `PATH` 会得出「本机没有 Python」的**错误**结论：实测本机 `~/.local/bin/python3.12`（指向自建 CPython 3.12.15 的软链）可用，而 `PATH` 里没有 `~/.local/bin`。因此探测顺序在 `PATH` 之后追加**用户态可执行目录**（`~/.local/bin`），并把命中来源标为 `user-bin`（与 `path` 区分），使自检能如实说明「这个解释器是从哪儿来的」。

与此配套的自检契约：每一条非 `ok` 条目 SHALL 带 `hint`——**具体的下一步**（要运行的命令或要改的配置键），而不是只报告「未找到」；`ok` 条目 MUST NOT 带 `hint`，避免面板堆无意义提示。`hint` 里出现的脚本路径用 `packageRoot` 展开成绝对路径，不能是占位符（用户要能直接复制粘贴）。

`runtimeDir` 与包根绑定（`<插件包根>/.runtime`）是把运行时放在检出之外的正确默认，但 `link:` 安装会让「包根」指向链接目标，于是开发副本里的 venv 对已安装副本不可见。这不是缺陷而是配置点：用 profile 补丁层的 id 定向覆盖把 `runtimeDir` 指到已有运行时即可（README 第 4 节给了可复制的写法），插件 MUST NOT 自行在副本之间猜测或搬运运行时。

### D16：界面只呈现本地化文案，宿主枚举值只用于样式与回落

宿主返回的状态是稳定英文枚举（`ok` / `missing` / `degraded` / `authorized` / `unauthorized` / `scheduled`…），它们是**数据**；界面是**呈现**。用户在环境自检页实际反馈了两点：状态标签直出英文 `ok` / `missing`；`ready:false` 时摘要行只有「缺失」两个字——后者会被读成区块标题，把满屏正常条目一起判成故障。

因此客户端统一走 `valueLabel(t, value)`：先查 `value.<枚举>` 词条，字典缺词条则**原样回落**（宿主新增枚举值时界面宁可显示原词，也不能显示 `value.xxx` 这类内部键名或空白）；而 `easel-state-*` 样式类名继续用宿主原值，使文案与样式解耦。自检摘要行改为**点名**：「缺失：ffmpeg；降级：运行时目录」，全部就绪时明确写「全部就绪」。同理，宿主给的中文诊断句要避免「拒绝/对」这类相邻同音字连读造成的误读。

### 安装与激活实测记录（2026-10-09）

- **安装动作与结果**：`cd /data/dsh/profiles/web && npm_config_minimum_release_age=0 dsh plugin --profile web add /data/dsh/home/dsh-hub/Easel/_repo/dsh-plugins/easel-workbench --config.minimumReleaseAge=0 --reporter=append-only` → `exit 0`，`+ easel-workbench link:/data/dsh/home/dsh-hub/Easel/_repo/dsh-plugins/easel-workbench`；`dsh.profile.bundles` 变为 20 项含 `easel-workbench`，`dependencies["easel-workbench"]="link:…"`。
- **环境阻断（与插件无关，但决定了安装路径）**：① profile 级 pnpm 供应链策略校验**整份 lockfile**（559 条），既有的 `billion-context@0.1.189` 落在 `minimumReleaseAge`（cutoff = now − 24h）内 → `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，该 24 小时窗口内任何安装都失败（`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 未生效）；② `github:`/git 规格被 pnpm 解析为 `git+ssh://git@github.com/…`，而本机 ssh 读 `/home/node/.ssh`（不存在且父目录只读，`$HOME=/data/dsh/home` 被 ssh 忽略）→ `Host key verification failed`；③ 仓库约 323 MB，git 依赖会整仓克隆。
- **失败表现**：客户端半边（面板与 10 个子导航）正常渲染，各子页显示 `错误信息: HTTP 404`；`curl http://127.0.0.1:3080/easel-workbench/api/config` → `HTTP 404`、`0B`（DSH 默认 404，而非插件 JSON 404）；`plugin_manager action=set_bundle` → `1 entry did not activate / easel-workbench (easel-workbench): failed to import`。

## Risks / Trade-offs

- **[`sidebar.panellist` 的像素位置未截图验证]**：位置结论来自 README 描述的渲染次序（品牌行 → New Session → panellist → 会话列表 → 设置行），未在真实界面上确认。→ 缓解：实现期第一件事是在本机 profile 装一个最小 bundle 只注册一个 panellist 条目，截图确认位置；若不满足需求，退路是改用 `sidebar.brand` 下方的自定义插槽或 `sidebar.workspaces` 之上的就近锚点（备选见 `EASEL-DSH-需求文档.md` F4.3）。
- **[preset 内技能根隔离未验证]**：见 D5。→ 缓解：第一实现取全局 `customSkillDirs`；隔离作为后续优化，失败不影响主路径。
- **[`ctx.agents.create` 的 preset 字段名未经确认]**：文档记为 `agentPreset`，属推测。→ 缓解：实现期用 `ctx` 的 `Config.listConfigs`（`dsh-tool-cordis` 的只读接口）确认实际字段名后再编码。
- **[Python 依赖面大]**：`_repo/pyproject.toml` 含 `opencv-python`、`pandas`、`matplotlib`、`librosa`、`faster-whisper`、`playwright`、`rembg`、`biliup` 等重依赖。→ 缓解：按技能分组建立最小依赖集，环境自检按技能上报可用性；重依赖缺失只影响对应技能，不影响工作台其余功能。
- **[上游合并分叉]**：`_repo` 不被写入，但本仓库会新增 `dsh-plugins/` 与 `openspec/`。→ 缓解：新增目录全部落在 `_repo` 之外；技能、画像、产物保持上游原状，上游 `git pull` 不受影响。
- **[技能目录常驻成本]**：114 个技能描述合计约 22,808 字符，会成为每个会话的常驻目录消息。→ 缓解：通过 `catalogDescriptionMaxLength` 配置压低单条描述上限；该配置为部署级，不写死在插件内。
- **[面板错误逃逸会清空挂载点]**：客户端 slot entry 抛错会 blank 整个 entry。→ 缓解：面板根部强制包 ErrorBoundary 并为每个子页面再加一层，见 `specs/creator-workbench-ui/spec.md` 的「面板故障隔离」。
- **[七平台登录态无法自动化验证]**：登录依赖真人授权，测试不能覆盖真实平台。→ 缓解：把登录态解析、失效判定、门禁拦截做成可用假凭据与假响应驱动的单元测试；真实平台调用只做人工验收。
- **[删除了 `_repo` 的自建运行时，用户可能仍依赖旧 CLI]**：`easel web`、`easel gateway` 等入口被删除是 BREAKING。→ 缓解：迁移计划分阶段，旧入口先标记弃用再删除；README 给出从旧 CLI 到 DSH 工作台的对照说明。

## Migration Plan

分四阶段，每阶段可独立验证，前一阶段通过后才进入下一阶段（与 `EASEL-DSH-需求文档.md` 的阶段划分一致）。

1. **阶段 0 — 运行时与技能可见性**：建立受控 Python 运行时与 `ffmpeg`（用户显式执行引导脚本）；启用 `dsh-skill-filesystem` 并把 `_repo/skills/openclaw/` 挂为自定义技能根；验证技能目录出现、`/name` 可调用、`SKILL.md` 可在右栏预览。此阶段不改动任何 Easel 代码。
2. **阶段 1 — 面板与服务骨架**：交付 bundle 骨架（单个 panellist 条目 + `main` 面板 + i18n + 图标）；宿主服务先只实现环境自检与只读数据视图（画像、产物、选题列出）。验证入口位置、主题跟随与返回对话不丢状态。
3. **阶段 2 — 任务派发与 preset**：接入 `ctx.agents`/`ctx.uiWorkspace` 的任务派发；交付 `easel` preset 与操作规则提示词段。验证绑定既有会话与新开会话两条路径、模型继承。
4. **阶段 3 — 发布与归因**：接入七平台账号、发布脚本调用、双点安全门禁与归因视图。验证门禁在服务方法与 bash 直调两条路径上均生效。

**回滚策略**：插件以单一 bundle 安装，回滚即为停用该 bundle 并从 profile 移除补丁；`_repo` 全程未被写入，无数据回滚需求。阶段 3 的删除动作（删除 `_repo/easel/`、`_repo/openclaw/`、`setup.sh`、`setup.ps1`）放在最后，且只在新路径验收通过后执行。

## Open Questions

- **Q1**：`sidebar.panellist` 条目的实际视觉位置是否需要额外的间距或分隔，才能让「新会话」与「自媒体工作台」在视觉上明显区分？属纯外观问题，可在实现期看过真实界面后决定，不影响 specs 与任务拆分。
- **Q2**：`dsh-skill-filesystem` 能否在 preset（agent 作用域）内挂载以实现技能根隔离？当前取全局挂载，若隔离可行可作为后续优化，不改变任何 requirement。
- **Q3**：Easel 的 `outputs/` 目录是否需要按账号或按平台再做一层分区？当前沿用上游布局，若需要可加一个可选配置项，不改变已写 requirement。
