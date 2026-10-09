# Proposal

## Why

Easel 是一个覆盖「发现 → 策划 → 创作 → 发布 → 归因」全链路的社媒内容工作台，但它自带 Agent 运行时、模型配置、会话存储与技能管理——这套自建栈与 DSH 已提供的能力完全重叠，导致用户无法在 Easel 中复用自己已在 DSH 配置好的模型，也使 Easel 的上游维护者不得不持续维护一个 Agent Harness（Easel README 的 Roadmap 第 4 项即为「适配更多 Agent Harness」）。

Easel 真正不可替代的资产是 114 个内容技能、约 50 个共享媒体脚本、七平台发布实现与一套成熟的创作者人设文本。把它们以 DSH bundle 的形式接入，可以让这些资产在 DSH 的模型、会话与技能体系下继续工作，同时整体删掉重复的自建运行时。

## What Changes

- **新增** 一个 DSH bundle（宿主入口 + 客户端入口 + 组合补丁 + locale + 图标），把 Easel 以单一全局面板「自媒体工作台」接入 DSH Web GUI。
- **新增** `easel` agent preset：把 Easel 的创作者人设与操作规则挂载为 preset 内的人设与系统提示词段，并接入技能提供方。
- **新增** 宿主侧业务服务与工具包装，把 Easel 的画像、内容库、排期、选题、热点、账号、发布与归因能力暴露给面板与模型。
- **BREAKING**：删除 Easel 的模型配置层（模型环境变量、模型设置接口、写 `openclaw.json` 的同步逻辑）。改造后插件不持有任何模型配置，一律继承 DSH 会话级选择与部署默认值。
- **BREAKING**：删除 Easel 的 Agent 运行时、网关、会话 jsonl 存储与跨进程会话锁。会话、模型、审批与提问一律改用 DSH 原生能力。
- **BREAKING**：删除 Easel 的自建技能管理界面与服务端技能接口。技能目录、技能调用与 `SKILL.md` 预览改由 DSH 技能体系提供。
- **删除** `easel/` CLI 包、`openclaw/` 配置与 `setup.sh`/`setup.ps1` 的安装编排；保留并以受控运行时方式替代其依赖安装职责。
- **保留** `skills/` 下的技能与 Python 脚本、`profiles/` 下的画像目录、`outputs/` 下的产物结构，以及 `SOUL.md`/`AGENTS.md` 的文本资产。
- **收敛** Easel 前端的 15 个页面级组件为：删除会话、消息、提问卡片、主题切换、技能浏览与模型设置组件；其余业务页面重写为工作台面板内的子导航页面。
- **新增** bundle 的打包与激活契约：宿主运行时包只以 `peerDependencies` 声明、以物化方式安装到 profile、安装后以「宿主接口可达」作为激活验收判据（安装实测发现源码树 `link:` 会让宿主半边导入失败）。

## Capabilities

### New Capabilities

- `creator-workbench-ui`: 工作台在 DSH Web GUI 中的呈现——侧边栏入口「自媒体工作台」、覆盖会话区域的主面板、面板内子导航、返回对话的路径，以及主题、iframe 与 Client 包依赖等呈现约束。
- `workbench-task-dispatch`: 工作台任务如何执行——模型一律继承 DSH（会话级选择优先、回落部署默认值）、绑定既有会话或新开会话、在既有 Workspace 优先级下定位新会话，以及在会话真相源约束下派发任务。
- `creator-skill-library`: Easel 的 114 个内容技能作为 DSH 技能库接入——由 DSH 的文件系统技能提供方发现与提供、遵循 DSH 技能格式、复用 DSH 技能界面，并如实上报技能脚本所需的 Python/ffmpeg 运行时可用性。
- `creator-persona`: `easel` agent preset 的组装契约——在 preset 内挂载创作者人设与操作规则，使只有选择该 preset 的会话获得创作者身份，且不与 DSH 自身的提示词注册冲突。
- `creator-asset-library`: 创作者数据的读写——六维账号画像、内容库产物与素材附件，数据仍落在 Easel 既有的仓库目录结构中，且对上游仓库保持只读。
- `creator-planning`: 创作计划与线索——排期复用 DSH 排期能力，选题库与热点线索作为可查的创作输入。
- `platform-publishing`: 面向七个平台的账号、发布与归因——登录态可见并以用户重新授权方式获取凭据、经既有 Python 脚本执行发布、发布前强制通过确定性安全门禁且不提供绕过开关。
- `workbench-bundle-packaging`: bundle 的打包与安装激活契约——宿主运行时包以 peer 依赖声明、安装必须物化为 profile 可解析的形式（源码树 `link:` 只作开发态且须自带 `node_modules`）、激活以宿主接口 `GET /easel-workbench/api/config` 返回 200 为验收判据。

### Modified Capabilities

（无。本仓库尚无已归档的 `openspec/specs/` 能力，本次改动全部为新增能力。）

## Impact

**受影响的代码与系统**

| 区域 | 处置 |
|---|---|
| `_repo/easel/`（2,012 行） | 删除；职责移交 DSH 与新建的宿主服务 |
| `_repo/web/app.py`（4,419 行，约 70 个路由） | 会话、模型、技能三组路由删除；其余业务路由重写为宿主服务方法 |
| `_repo/web/frontend/src/`（8,557 行） | 约 4 类组件删除；其余业务页面重写为客户端面板组件 |
| `_repo/skills/`（97,824 行） | 保留；`skills/openclaw/` 作为只读技能根接入 |
| `_repo/profiles/`、`_repo/outputs/` | 保留；路径由插件配置项指定 |
| `_repo/openclaw/` | 删除（`SOUL.md`/`AGENTS.md` 文本资产迁出） |
| `_repo/setup.sh`、`setup.ps1`（69 KB） | 删除安装编排；依赖清单作为受控运行时建设参考 |
| `_repo/tests/`（4,313 行） | 20 个 OpenClaw 集成测试作废，按新宿主服务重写 |

**受影响的外部依赖与前置**

- **前置（阻断性）**：本机当前不存在任何 Python 运行时（`python`/`python3`/`pip`/`uv`/`uvx`）与 `ffmpeg`，而 Easel 技能层全部以 `python3 xxx.py` 形式调用。必须先建立受控 Python 运行时与 `ffmpeg`，否则技能脚本不可执行。
- **DSH 插件包**：依赖 `dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`、`dsh-agent-preset`、`dsh-agent-preset-registry`、`dsh-persona`、`dsh-agent-default-model`、`dsh-schedule`。其中 `dsh-skill-filesystem` 在本机 profile 中当前处于 inactive 状态。
- **bundle 打包约束**：本插件自身不持有宿主内部包——`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/cordis` 只用 `peerDependencies` 声明，安装由 profile 的包管理器完成；profile 侧的供应链策略（`minimumReleaseAge`）与安装方式（物化 vs 源码树 `link:`）会影响能否激活，须按 `workbench-bundle-packaging` 的验收判据确认。
- **DSH 能力契约**：`sidebar.panellist`、`main`（keyed）、`ctx.layout`、`ctx.uiWorkspace`、`ctx.agents`、`ctx.agentDefaultModel`、`ctx.workspaceFiles`、`ctx.attachments`、`ctx.subprocess`。

**不受影响**

- DSH 自身的会话存储、事件类型、主题系统与技能/模型界面一律不改动。
- Easel 上游仓库（`_repo`）只读，不被改写。
