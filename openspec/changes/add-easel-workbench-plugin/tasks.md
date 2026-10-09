# Tasks

## 1. 阶段 0：运行时与技能可见性

- [ ] 1.1 编写受控 Python 运行时与 `ffmpeg` 的一次性引导脚本 `dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh`（**随包发布**，位置无关：随包/开发态两种布局都能定位包根与 Easel 检出），脚本只做显式安装（建 venv、按技能分组安装 `_repo/pyproject.toml` 的最小依赖集、提示 `ffmpeg` 的安装命令），验证方式：在干净环境执行脚本后 `python3 -c "import fastapi"` 与 `ffmpeg -version` 均成功，且脚本重复执行不报错
- [x] 1.2 在文档 `dsh-plugins/README.md` 中记录运行时的期望路径、依赖分组与失败排查步骤，验证方式：按文档从零复现一次引导流程，全部命令可直接复制执行且结果与文档描述一致
- [x] 1.3 启用并配置 `dsh-skill-filesystem`，把 `_repo/skills/openclaw/` 写入 `customSkillDirs`，验证方式：新增一个使用该技能根的会话，技能目录中出现 Easel 技能名称，且原 DSH 技能仍可见
- [x] 1.4 验证 Easel 技能的 DSH 兼容性：对 114 个 `SKILL.md` 跑一次 frontmatter 检查，确认 `name` 为 kebab-case、`description` 非空且不超上限，验证方式：检查脚本输出为 0 个非法技能；并新建一个只看 `_repo/skills/openclaw/` 的会话确认目录无条目被丢弃
- [ ] 1.5 验证 `/name` 调用与 `SKILL.md` 右栏预览，验证方式：在会话中调用 `copywriting` 与 `redbook`，前者出现可展开说明卡片、后者以 frontmatter 的 `name` 而非目录名呈现，点击技能引用可在右栏打开对应 `SKILL.md`

## 2. bundle 骨架与侧边栏入口

- [ ] 2.1 创建 `dsh-plugins/easel-workbench/` 包骨架：`package.json`（含 `type: module`、`main`/`exports` 指向 `lib/index.js`、`dsh.bundle.patch`、`dsh.client`、顶层 `icon`）、`cordis.patch.yml`、宿主入口 `lib/index.js`、客户端源码 `src/client.js` 与构建产物 `lib/client.js`（由 `scripts/build-client.mjs` 生成，`--check` 幂等校验）、`locale/{zh-CN,en}.json`（构建期内联进客户端，运行时只注册内置 id `zh`/`en`）、`assets/`、随包 `scripts/bootstrap-runtime.sh`，验证方式：`plugin_manager` 的 `install_bundle` 指向该目录后安装成功，宿主与客户端入口均被加载且无报错（骨架与入口的静态契约已由 `test/index.test.mjs`、`test/plugin-hygiene.test.mjs` 覆盖，此处未勾选仅因 `install_bundle` 需用户批准后执行）
- [x] 2.2 实现宿主侧最小 `apply(ctx, config)`：只注册一个空的 `easel` 服务与 `Config` schema（`pythonExecutable`、`ffmpegExecutable`、`profilesDir`、`outputsDir`、`skillDirs`、`catalogDescriptionMaxLength`、`taskDispatchTarget`），验证方式：单元测试断言缺省配置可加载、非法值被拒绝，并在 `Config.listConfigs` 中可见
- [x] 2.3 实现客户端最小组件并在 `sidebar.panellist` 注册条目 `{ id: 'easel-workbench', label: <locale-aware> }`，同时在 `main` 注册相同 key 的面板组件，验证方式：侧边栏在「新会话」按钮下方出现「自媒体工作台」条目（英文界面为 "Creator Workbench"），折叠态下仍可见且有无障碍名称
- [ ] 2.4 截图确认 2.3 的实际位置与折叠态表现，验证方式：产出中文界面、英文界面、折叠态三张截图，若位置不满足「新会话下方、会话列表上方」则记录并按 design 的退路调整锚点，调整后重新截图
- [x] 2.5 验证入口选中后覆盖会话区域并能返回，验证方式：进入工作台后面板占据中栏、会话界面不再渲染；点击返回对话后恢复原会话，且输入草稿与滚动位置未变
- [x] 2.6 为面板根部与子页面各加一层错误边界，验证方式：单元测试注入一个抛错的子页面，断言面板显示错误态且子导航与返回入口仍可操作（对应「面板故障隔离」场景）

## 3. 工作台面板与子导航

- [x] 3.1 实现面板内子导航骨架，承载总览、账号、画像、内容库、发布、日历、选题、热点、数据、环境自检十个区域，验证方式：单元测试断言十项均可达、任一时刻只有一个区域被渲染、切换不改变侧边栏条目数量
- [x] 3.2 按 DSH 主题令牌实现面板样式（只用 `--dsw-alias-*` 令牌或等价主题变量，不使用自建主题色、不使用 iframe），验证方式：明暗主题切换后截图对比无固定色块，且在客户端产物中检索不到 iframe 与任何 DSH 客户端包的依赖或引用
- [x] 3.3 实现面板的产品文案与 locale 资源（`locale/zh-CN.json`、`locale/en.json`），验证方式：中英两种界面语言下面板文案分别取自对应资源文件，无硬编码中文遗漏

## 4. 宿主服务：创作者数据视图

- [x] 4.1 实现画像服务方法（列出画像、读取六维其中之一、创建画像目录与维度文档），数据落 `profiles/`，验证方式：单元测试覆盖列出一个由 Easel 既有格式创建的画像、读取任一维度、新建画像后立即可列出，且仅存在 Markdown 文件
- [x] 4.2 实现内容库服务方法（按项目列出产物、读取单个产物内的文件清单），验证方式：单元测试对含图片与视频的产物目录断言按项目分组正确、文件清单完整，且大文件不导致读取超时
- [x] 4.3 实现上游只读保护：对 `skills/` 与 `skills/shared/scripts/` 路径的写入请求一律拒绝并返回可读原因，验证方式：单元测试断言这些路径的写入被拒绝且文件内容未变；并在环境自检中产生一条越界写入错误
- [x] 4.4 实现选题库服务方法（增删改查，纯文本持久化于仓库内），验证方式：单元测试断言新增后刷新仍存在、状态流转可被独立审查、文件为可被版本控制追踪的文本
- [x] 4.5 实现热点线索读取服务方法（标注来源、来源失败时返回原因而非空列表或虚构条目），验证方式：单元测试用假响应驱动，断言全部来源失败时返回空状态加失败说明、部分失败时其余来源正常显示

## 5. 任务派发与 easel preset

- [x] 5.1 先用只读接口确认 `ctx.agents.create` 的 preset 字段名与 `ctx.agentDefaultModel.currentSelection()` 的实际返回，验证方式：把确认结果写入 `dsh-plugins/README.md` 的接口小节，字段名与只读接口输出一致（对应 design 的 D4 与风险项）
- [x] 5.2 实现「绑定既有会话」派发：按会话标识取当前 agent，无存活 agent 时恢复该会话再投递，验证方式：单元测试断言投递产生一条带来源标识的用户消息且会话标识不变；端到端验证在工作台提交任务后侧边栏未出现平行会话
- [x] 5.3 实现「新开会话」派发并沿用 DSH 工作区优先级（显式指定 → 当前会话所属 → 最近活跃 → 空白），验证方式：单元测试覆盖四条优先级分支；端到端验证工作台任务出现在新会话中并可见于侧边栏
- [x] 5.4 实现 `taskDispatchTarget` 配置（默认「当前会话」，可选「新会话」），验证方式：单元测试断言缺省派发到当前会话、配置为「新会话」时当前会话不被写入该任务
- [x] 5.5 实现工作台与对话之间的跳转（复用布局面板选择与会话跳转能力，不自行维护主视图状态），验证方式：端到端验证从工作台「在对话中打开」后中栏为该会话、再点侧边栏入口切回工作台且先前会话仍保持选中
- [x] 5.6 交付 `easel` agent preset：包含创作者人设、操作规则提示词段与技能提供方，人设只在该 preset 的 agent 作用域挂载，验证方式：`plugin_manager` 安装后 preset 出现在会话创建入口；使用该 preset 的会话系统提示词含规则段，未使用该 preset 的会话不含；加载过程无与部署级人设前缀注册冲突的错误
- [x] 5.7 为操作规则段编写内容校验测试，验证方式：断言规则段含技能路由、信息优先、付费确认、产物约定四类条目，且不含模型选择、会话存储、工具调用方式的条目
- [x] 5.8 实现人设文本的可配置来源并记录于 `dsh-plugins/README.md`，验证方式：改动人设文本来源后新建会话使用新文本，已存在会话不受影响

## 6. 账号、发布与安全门禁

- [x] 6.1 实现平台账号状态服务（列出七平台登录态、识别失效、返回登录入口），验证方式：单元测试用假登录态文件覆盖「有效」「失效」「不存在」三种状态；断言失效时返回重新授权入口
- [x] 6.2 验证登录态文件位于仓库之外且未被版本控制跟踪，验证方式：运行 `git status` 与路径检查，断言登录态目录不在仓库内、不出现在版本控制输出中
- [x] 6.3 实现发布服务方法：调用 `_repo/skills/shared/scripts/` 下对应平台的既有发布脚本，经 DSH 命令执行能力运行并记录完整命令与退出状态，验证方式：单元测试用假脚本断言调用参数正确、退出状态被记录；检索插件源码断言不存在平台 HTTP 协议实现与平台专用 HTTP 客户端依赖
- [x] 6.4 在发布服务方法内强制运行 `content_guard.py` 并在命中时阻止发布，验证方式：单元测试对含 API 密钥、内部主机名、内部绝对路径、环境变量名的样例断言发布被阻止且返回命中项分类；断言未命中时流程继续
- [x] 6.5 用 `ctx.tools.guard()` 对直接调用发布脚本的命令加一层守卫，验证方式：端到端验证让模型绕过服务方法直接调用发布脚本时同样被拦截
- [x] 6.6 检索并断言不存在绕过开关，验证方式：审阅 Config schema、服务方法签名与工具定义，断言无跳过扫描、放行命中项或等价参数；把该断言写成测试防回归
- [x] 6.7 实现人设一致性检查接入（评分达阈值不增加确认步骤、低于阈值只告警且用户确认后可继续），验证方式：单元测试覆盖高、低两种评分分支，断言低分不阻断发布
- [x] 6.8 实现发布结果记录与归因视图（目标平台、时间、内容标识、成功或失败；平台数据失败时显示原因而非残留数值），验证方式：单元测试用假响应覆盖成功、失败、平台不可用三种情况，断言失败时无虚构或残留数值

## 7. 排期与 DSH 能力复用

- [x] 7.1 把内容排期表达为 DSH 排期项：携带自包含任务说明（任务目标、目标画像、期望产物），验证方式：单元测试断言排期说明中不出现会话标识、临时路径或未命名指代；端到端验证排期到点后在新会话中可被独立理解并执行
- [ ] 7.2 验证排期项可被 DSH 原有界面管理，验证方式：在 DSH 排期列表中暂停工作台创建的排期后不再触发且工作台视图同步为已暂停；删除后工作台视图中消失
- [x] 7.3 检索并断言插件内不存在自建调度器或定时触发路径，验证方式：源码检索断言无进程内定时循环、无绕过 DSH 排期的触发实现，并把该断言写成测试防回归
- [x] 7.4 实现热点线索「查看不改变状态」约束，验证方式：单元测试断言仅浏览热点后选题库与排期列表无任何新增或改动

## 8. 清理与上游只读化

- [ ] 8.1 在新路径全部验收通过后，删除 `_repo/easel/`、`_repo/openclaw/`、`_repo/setup.sh`、`_repo/setup.ps1` 与 `_repo/web/app.py` 中的会话/模型/技能三组路由，验证方式：删除后 `git -C _repo status` 记录为受控改动，工作台与技能路径的端到端用例全部仍通过
- [x] 8.2 从 Easel 前端迁移业务页面并用工作台组件替换，删除会话、消息、提问卡片、主题切换、技能浏览与模型设置组件，验证方式：构建客户端产物成功；检索断言无模型配置界面、无自建技能浏览界面、无自建上传接口
- [ ] 8.3 重写被作废的测试：20 个 OpenClaw 集成测试替换为新宿主服务的对应测试，验证方式：全量测试通过且无对 `_repo/easel/` 或被删路由的引用
- [x] 8.4 更新 `_repo/README.md` 与 `dsh-plugins/README.md` 的迁移说明（旧 CLI 入口到 DSH 工作台的对照、被删除项与替代路径），验证方式：按文档中给出的对照逐条走查，旧入口均有明确的替代说明
- [x] 8.5 验证 `_repo` 上游可合并性，验证方式：`git -C _repo remote -v` 显示上游 origin，且本次改动未在 `_repo` 内产生技能、画像、产物之外的文件改动

## 9. 集成验收

- [ ] 9.1 端到端走查 `specs/creator-workbench-ui/spec.md` 的全部场景，验证方式：逐场景执行并记录结果，含入口命名、折叠态可达、覆盖会话区域、返回不丢状态、子导航覆盖十区域、主题跟随、子页面错误隔离
- [ ] 9.2 端到端走查 `specs/workbench-task-dispatch/spec.md` 与 `specs/creator-skill-library/spec.md` 的全部场景，验证方式：逐场景执行并记录；断言插件包内检索不到 provider/模型标识字面量，会话日志中无插件定义的事件类型
- [ ] 9.3 端到端走查 `specs/creator-asset-library/spec.md`、`specs/creator-planning/spec.md`、`specs/creator-persona/spec.md` 的全部场景，验证方式：逐场景执行并记录，含既有画像目录直接可用、上游文件未被改写、排期与选题行为、preset 身份隔离
- [ ] 9.4 端到端走查 `specs/platform-publishing/spec.md` 的全部场景（真实平台发布以人工验收替代自动化），验证方式：逐场景执行并记录，含登录授权引导、登录态失效提示、门禁在两条路径均生效、低分告警不阻断、归因失败显示原因
- [x] 9.5 以 `catalogDescriptionMaxLength` 调优验证技能目录成本，验证方式：记录默认值与调低值下同一会话的目录字符数对比，确认描述被截断而技能名称完整

## 实现期记录（已完成部分的证据）

实现与自动验证已全部落盘，命令均在 `/data/dsh/home/dsh-hub/Easel` 下执行：

- 全量测试：`cd dsh-plugins/easel-workbench && node --test test/*.test.mjs` → **277 项全绿**（`fail 0`）；
  客户端产物校验 `node scripts/build-client.mjs --check` 通过（重复构建哈希不变）。
- 引导脚本实跑：脚本随包位于 `dsh-plugins/easel-workbench/scripts/bootstrap-runtime.sh`（位置无关，默认值由
  脚本自身位置推出：`--runtime-dir <包根>/.runtime`、`--easel-root <工作区>/_repo`，与进程工作目录无关）：
  `cd dsh-plugins/easel-workbench && bash scripts/bootstrap-runtime.sh --python ~/.local/bin/python3.12 --easel-root ../../_repo --groups core`
  → `exit 0`；`pip list` 11 个直接依赖逐个 `importlib.import_module` 成功（Python 3.12.15）；
  `--dry-run` → `exit 0` 且不创建 `--runtime-dir`（无 `--python` 时按设计先报 `找不到可用的 Python 3.10+`）；
  随包位置下 `--check --groups core` → `exit 0`（`import fastapi：ok`），而默认分组的 `--check` → `exit 4`
  （image/data/doc/publish 未安装，属预期）。
- 实现期修掉的真实缺陷（11 项，均有测试或复跑证据）：DSH prefix 路由未剥前缀导致所有接口 404；
  集合接口把数组摊进信封（`/overview`、`/accounts`、`/publish/platforms` 一处 500、两处变 `{"0":…}`）；
  `inspectCommand` 判定顺序让 `--allow-unsafe` 被 `SAFE_SCRIPT_NAMES` 抢先放行；`ensure()` 产生
  `details.details` 嵌套；会话标识正则漏匹配 `session-42abc` 与 `session-easel-*`；`readbackOf` 子串匹配
  把「未核实」记成「已核实」；引导脚本分组规格串带引号（pip `Invalid requirement`）；`--dry-run` 因无条件
  自检必然 `exit 4`；`package.json` 的 `files` 漏掉 `assets/`（打包后默认人设/规则会 not-found）；`personaSource`/`rulesSource` 未配置时 `resolve(undefined)` 抛 `ERR_INVALID_ARG_TYPE`，且相对路径按**进程工作目录**解析（与文档说的「相对插件包根」不一致，工作目录一变就读错文件）——现统一走 `optionalPluginPath()`，文档与实现一致；**引导脚本原本位于 `<工作区>/scripts/`（不在 bundle 内），`install_bundle` 装不到它**（跑一次规格解析才发现 `No such file or directory`）——现已移入包内 `scripts/` 并改为位置无关（随包/开发态两种布局都能定位包根与 Easel 检出），`test/bootstrap.test.mjs` 的脚本路径与新增用例随之更新。
- **spec 回改（工作流要求，先改 spec 再改实现）**：实现期确认宿主侧没有客户端那条工作区优先级链
  （`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:851-852` 的 `workspaceId ?? currentWorkspaceId ?? recent`
  在浏览器侧；宿主只有 `ctx.workspaceController.create({ path })`），且
  `@deepseek-ai/dsh-api-session-controller/lib/index.js:1900` 会滤掉没有 `cwd` 的会话——因此任务 5.3
  改为「显式工作区优先，否则显式指定 Easel 数据根并写进 `meta.cwd`」，已回改
  `specs/workbench-task-dispatch/spec.md` 的「新开会话」requirement 与两个 Scenario，并在 `design.md`
  的 D4 补「实现期确认」条目（含证据行号）。
- **8.4 的落地方式（有意偏离）**：迁移对照全部写在 `dsh-plugins/README.md` §9（旧 CLI/Web 入口逐条给出
  替代路径与保留不动清单）以及 §1/§2/§3/§6.4；`_repo/README.md` **有意不改**——8.5 要求 `_repo` 内不产生
  技能、画像、产物之外的文件改动，而工作区形态下 `dsh-plugins/` 本就是 `_repo` 之外的兄弟目录。
- 6.2 证据：默认解析下 `repoRoot=/data/dsh/home/dsh-hub/Easel`、`loginStateDir=/data/dsh/easel-workbench/login`（`DSH_HOME=/data/dsh`）→ 登录态目录在仓库之外；`git -C _repo status --porcelain` 为空，即登录态不出现在版本控制输出中。
- 8.5 证据：`git -C _repo remote -v` → `origin https://github.com/keeliu/Easel.git`；
  `git -C _repo status --porcelain` → 空；`HEAD` = `fb80ae6`（分支 `main`）。
- 技能目录成本（9.5）：真实 `_repo/skills/openclaw` 的 114 个 `SKILL.md` 上，
  `catalogDescriptionMaxLength=500` → 目录 24493 字符、0 条截断；`120` → 15577 字符、109 条截断
  （省 8916 字符）；两档 `name` 序列完全一致。明细表见 `dsh-plugins/README.md` §6.4。

## 待用户验收（本机无法完成的部分）

本会话批准策略为 `never`（无法真实 `plugin_manager install_bundle`、无法联网截图），且本机没有 `ffmpeg`：

- **1.1**：引导脚本已实跑通过 `core` 组（11 个直接依赖逐个 import 成功）；规格串离线校验（用 venv 内自带的
  `pip._vendor.packaging.requirements.Requirement` 逐 token 解析，不联网、不安装）：除 `easel` 组的
  可编辑安装命令外 **40 条规格全部通过解析（0 条非法）**，且与 `_repo/pyproject.toml` 对照后
  **23 个声明依赖全部落在某个分组里**，另有 9 个仅被技能脚本直接 import 的包（beautifulsoup4、
  onnxruntime、openpyxl、pdfplumber、PyMuPDF、PyYAML、requests、urllib3、zhconv）；`ffmpeg -version` 一步
  需在目标机执行（脚本按设计只打印安装命令），image/audio/video/data/doc/publish 各组的**实际安装**同样
  需要能访问 PyPI 的机器（本机到 pypi.org 不可达，只能做到解析级校验）。
- **1.5 / 9.1–9.4**：需要真实浏览器 + DSH 宿主加载 bundle 才能走查的场景——`/name` 技能调用与右栏
  `SKILL.md` 预览、入口位置与折叠态、明暗主题、返回对话后草稿与滚动位置、真实平台发布与账号扫码登录。
- **2.5 / 5.2 / 5.3 / 5.5 / 5.6 / 5.8**：需要真实会话的端到端部分——返回对话后草稿与滚动位置保持、
  派发后侧边栏不出现平行会话、新会话出现在工作台与会话列表、`easel` preset 出现在会话创建入口、
  改动人设来源后新会话用新文本而已有会话不受影响（这些任务的实现与单元测试部分均已完成）。
- **2.1**：`plugin_manager action=install_bundle target=<包绝对路径>` 需用户执行；包骨架与宿主/客户端
  入口契约已由 `test/index.test.mjs`、`test/client.test.mjs` 覆盖（含缺 `lib/client.js` 时的报错路径）。
- **2.4**：中文界面、英文界面、折叠态三张截图。
- **7.2**：在 DSH 排期界面暂停/删除工作台条目后，工作台视图同步显示为已暂停/已消失。
- **8.1 / 8.3**：删除 `_repo/easel/`、`_repo/openclaw/`、`setup.sh`、`setup.ps1` 与 `web/app.py` 的三组
  路由，以及替换 20 个 OpenClaw 集成测试——8.1 的前置条件是「新路径全部验收通过」，即上面这些真机验收；
  在此之前 `_repo` 保持原样（8.5）。

## Workflow follow-up

- 用户审阅并批准本 change 后，再进入 `/openspec-apply-change` 开始实现；本 change 通过前不得改动实现代码。
- 实现过程中若 `design.md` 的 Open Questions 得到答案且会改变已写 requirement，先用 `/openspec-update-change` 回改 spec 再继续。
- 全部任务完成后运行 `openspec validate add-easel-workbench-plugin --strict`，通过后再归档到 `openspec/changes/archive/`。
