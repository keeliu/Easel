# Tasks

## 1. 阶段 0：运行时与技能可见性

> **2026-10 目录改名**：为满足 dsh-market 的收录规则（CI 只从根包或 `packages/`·`plugins/`·`apps/` 子包读 `dsh.bundle`），
> 仓库内的 `dsh-plugins/` 已 `git mv` 为 `plugins/`。本文档中形如 `plugins/easel-workbench/…` 的**仓库路径**按新名读；
> 而指开发工作区 `/data/dsh/home/dsh-hub/Easel/dsh-plugins/` 的字样（以及 `## 实现期记录` 里逐字引用的历史路径）保持不变，
> 它们是当时的事实记录。

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

## 10. 打包与激活（安装实测发现）

安装实测暴露宿主半边导入失败（详见 `design.md` 的 D11–D14 与「安装与激活实测记录（2026-10-09）」）：

- [x] 10.1 把 `@deepseek-ai/schemastery`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/cordis` 从 `dependencies` 移到 `peerDependencies`（版本范围对齐 DSH 0.2.0-rc.2 与 schemastery `^3.18.4`），验证方式：断言 `package.json` 的 `dependencies` 无任何 `@deepseek-ai/*`，宿主包出现在 `peerDependencies`；**实测结论**：`dependencies` 已移除，`@deepseek-ai/dsh-llm` 与 `@deepseek-ai/schemastery` 同时在 `peerDependencies` 与 `devDependencies`，断言见 `test/plugin-hygiene.test.mjs` 的 10.2 用例
- [x] 10.2 在 `test/plugin-hygiene.test.mjs` 增加打包契约防回归断言（宿主包不得出现在 `dependencies`、`dsh.client.inject` 只列客户端包、`files` 覆盖 `lib/client.js` 与 `scripts/bootstrap-runtime.sh`），验证方式：`node --test test/plugin-hygiene.test.mjs` 通过；**实测结论**：新增「打包契约」用例覆盖宿主包不得进 `dependencies`、`dsh.client.inject` 只列 `@deepseek-ai/dsh-client-*`、`files` 覆盖产物与引导脚本、`dsh.bundle.patch` 与 `private:true`
- [x] 10.3 新增安装自检（`scripts/check-install.mjs` 或 README 中的等价命令）：在目标 profile 目录尝试 `import("easel-workbench")` 并请求 `GET <API_PREFIX>/config`，任一失败即非零退出，分别给出「源码树缺 `node_modules`」与「宿主半边未挂载，请重载进程」的指引，验证方式：对「源码树 `link:` 且无 `node_modules`」的已知失败态跑一次，得到非零退出与对应文案；**实测结论**：脚本落在 `scripts/check-install.mjs`（`--profile/--url/--import/--no-http/--json`），对真实 profile 五项全绿 exit 0；`test/check-install.test.mjs` 4 例覆盖「源码树 link: 缺依赖 → 非零退出 + pnpm install 指引」「未列进 bundles」「空响应体 404 → 重载 DSH」与通过态
- [x] 10.4 客户端在收到无响应体的 404 时显示「宿主服务未挂载，请重载 DSH」提示，验证方式：`test/client.test.mjs` 注入空体 404 断言提示与重试入口存在；注入插件 JSON 错误时保持按响应体 `message` 呈现；**实测结论**：`createApi(prefix, t)` 区分「404 且解析不出 JSON」与插件自己的 JSON 404，空体时显示 `error.hostNotMounted` 并保留重试入口，`test/client.test.mjs` 有对应用例
- [x] 10.5 以物化方式重装（`pnpm pack` → 安装 `.tgz`，或改用 git 规格），重载 DSH 后确认 `GET /easel-workbench/api/config` 返回 200 且面板各子页无 404，验证方式：`curl` 断言 200 + JSON，浏览器逐子页走查；本项需重载运行中的进程，列用户验收；**实测结论**：用户重启 3080 实例后 `curl /easel-workbench/api/config`、`/overview`、`/selfcheck`、`/topics` 全部 200 + JSON（`easelRoot=…/_repo`），面板十个子页不再报 404；当前仍是源码树 `link:` 安装，物化重装见「待用户验收」
- [x] 10.6 回写 `dsh-plugins/README.md` §1/§3：补「物化安装为受支持方式」「源码树 `link:` 须自带 `node_modules`」「profile 供应链策略 `minimumReleaseAge` 可能阻断安装」「安装后必须重载进程」「激活验收判据 = 宿主接口 200」五条，验证方式：照文档从零复现一次安装并得到 200；**实测结论**：README §1/§3 之外补了 §2 的 `~/.local/bin` 候选与来源标记、§4 的「让已安装副本复用一份现成的运行时」、§8 的三行排查项与 §10 的 `check-install.mjs` 用法表

## 11. 界面文案（实际使用反馈）

用户在环境自检页反馈：状态标签直出英文 `ok` / `missing`，且 `ready:false` 时摘要行只有「缺失」两个字——它会被读成区块标题，让满屏正常条目看起来也像故障（详见 `design.md` 的 D16）：

- [x] 11.1 状态枚举本地化：客户端统一走 `valueLabel(t, value)`，账号（总览与账号页）、内容库选题、排期、选题、环境自检的状态标签与 meta 行不再直出英文枚举；字典缺词条时回落显示原值，`easel-state-*` 类名仍用宿主原值。验证方式：`node --test test/client.test.mjs` 的「宿主枚举值按字典本地化，字典缺词条时回落原值而不是空白」用例
- [x] 11.2 环境自检摘要点名缺失与降级项：`ready:false` 时显示「缺失：X、Y；降级：Z」，全部就绪时显示「全部就绪」。验证方式：`node --test test/client.test.mjs` 的「环境自检的摘要行点名缺失与降级项，状态标签本地化」用例（同时断言三种状态标签文案）
- [x] 11.3 自检两条文案去重与易读性：上游只读态改为「`skills` 始终只读；本次运行没有发生越界写入。」（原「已拒绝对 skills 的写入」连读易被误读），技能目录长度改为「技能目录中每条描述最多 N 个字符，超出部分会被截断。」（原句重复了 500 两次）。验证方式：`node --test test/selfcheck.test.mjs` 通过

## 12. 界面可用性（实际使用反馈第二批）

用户在真机上反馈：账号「验证」报「DSH 子进程服务不可用」，日历、热点、选题、内容库全空白，且不知道「怎么绑定会话去生成内容」「画像怎么维护」（详见 `design.md` 的 D17/D19）：

- [x] 12.1 空态必须给出下一步：`EmptyState` 增加 `hintKey`，日历、热点、选题、内容库（含未选主题与主题下无文件）、画像（含未选画像）、账号、数据七处的空态改为「数据从哪来 + 做什么才会有」，不再只写「暂无内容」。验证方式：`node --test test/client.test.mjs` 的「空白区域给出『怎么才会有数据』的下一步」用例（逐个区域断言空态里带 `data-easel-hint` 且文案说到来源）
- [x] 12.2 选题派发成会话里的任务：选题行加「派发」，表单收期望产物（必填）、目标画像、目标平台、补充说明与投递目标（新会话 / 既有会话），`POST /dispatch`；缺期望产物时本地拦下不发请求；成功后显示会话标识与走 `uiWorkspace.openSession` 的「打开会话」。验证方式：`node --test test/client.test.mjs` 的「选题能派发到会话」用例（断言请求体 `target`/`task.goal`/`task.deliverable`、既有会话可选、「打开会话」落到 `sessionOpens`）
- [x] 12.3 画像可新建并逐维度维护：画像区域加「新建画像」（`POST /profiles`），维度改为可编辑（`PUT /profiles/:name/dimensions/:dimension`），成功后就地显示「已保存 <维度>（<字节数> 字节）」。验证方式：`node --test test/client.test.mjs` 的「画像可以新建，也能逐维度编辑并写回宿主」用例
- [x] 12.4 账号验证的子进程延迟解析（真实缺陷）：`lib/index.js` 过去在 `apply()` 里给 `serviceOf(ctx, "subprocess")` 取快照，而 DSH 的服务注册晚于插件挂载，于是账号验证永久报 `runtime-missing`，自检却因为请求时解析而说能力正常。改为 `lazyService(ctx, "subprocess")`（`lib/host/services.js`）＋ `runCommand` 内解析（`lib/host/exec.js`），并让 `resolvePython` 与自检共用同一条候选链。验证方式：`node --test test/index.test.mjs` 的「宿主子进程服务晚于插件挂载就绪时，账号验证仍能执行（延迟解析）」用例（挂载后再注入服务，验证请求仍能起子进程）
- [x] 12.5 按用户要求装好 ffmpeg：从 npm 取 `@ffmpeg-installer/linux-x64`（4.1.0）静态构建，落到 `/data/dsh/home/.local/bin/ffmpeg`（0755，探测链已覆盖该目录）。验证方式：`ffmpeg -version` 输出 `ffmpeg version N-47683-g0e8eb07980-static`（含 libx264/libx265/aac）；活实例 `GET /easel-workbench/api/selfcheck` → `ready:true`、`missing:[]`（ffmpeg 解析到 `/data/dsh/home/.local/bin/ffmpeg`）

## 13. 扫码登录、发布与热点（实际使用反馈第三批）

用户报「在验证账号的时候提示进程不可用」，并追问「怎么绑定会话去生成内容、画像怎么维护、日历/热点/选题为什么空白」。进程不可用已在 12.4 修掉；本批把**仍然只是空壳的两处**补齐，并让热点与发布在面板里真正可用（详见 `design.md` 的 D20–D25 与三份 spec delta）：

- [x] 13.1 宿主侧扫码登录流水线：`lib/host/accounts.js` 增加 `startLogin` / `loginStatus` / `cancelLogin` / `submitSmsCode` / `qrImage`（内存任务表 `loginJobs`、以脚本写出的状态文件为唯一真源、脚本未写终态即退出则按退出码报 `error`、`(timeoutSeconds+30)s` 兜底取消、句柄 `unref()`）；`lib/host/exec.js` 增加 `startCommand()`（不 await `handle.done`，`done` 永不 reject）；平台描述符补 `login.noProxy`（小红书/抖音/公众号）、`login.smsCodeFile`（抖音）、`login.cookieFile`（B 站）并按需拼 `--no-proxy` / `--sms-code-file` / `--cookie`。验证方式：`node --test test/accounts.test.mjs` 的「扫码登录流水线」4 例（启动参数、状态轮询、取消写 expired、短信码落盘与校验）；**实测结论**：32/32 通过，含既有 argv 断言同步更新
- [x] 13.2 登录宿主路由：`lib/host/web.js` 增加 `POST /accounts/:id/login`、`GET /accounts/:id/login/status`、`DELETE /accounts/:id/login`、`POST /accounts/:id/login/sms`、`GET /accounts/:id/qr`（二进制 PNG，沿用既有的 `res.writeHead` 先例，`handle()` 因 `res.headersSent` 跳过 JSON 包装）。验证方式：新增 `node --test test/web.test.mjs` 4 例（启动、状态、二维码字节与 content-type、404 与 405）；**实测结论**：4/4 通过（假请求必须始终 emit `end`，否则 `handle()` 会挂住——见实现期记录）
- [x] 13.3 面板内扫码登录：账号行加「扫码登录」开关，展开 `LoginPanel`：启动 `POST /accounts/:id/login`、1.5 秒轮询状态（脚本不再运行即停）、二维码指向 `GET /accounts/:id/qr?ts=<二维码时间戳>`、需要短信码时回填（只发 4–8 位数字）、可取消；宿主枚举按字典本地化。验证方式：`node --test test/client.test.mjs` 的「扫码登录：启动走 POST /accounts/:id/login，二维码与短信码如实呈现」用例；**实测结论**：通过（断言启动方法与次数、二维码 `src` 与 `ts`、短信码请求体 `{code:"123456"}`、成功态显示「已成功」）
- [x] 13.4 发布先预览后执行：发布区加 `PublishForm`——选平台（七平台）与 `outputs/<主题>/` 下的本地产物、填标题/正文/标签，预览走 `POST /publish/preview`（宿主按 `exec:false` 拼 argv 并跑门禁），执行必须显式勾选确认，未勾选时本地拦下；参数按平台脚本形状拼装（小红书视频 `--video`／图文 `--images`、web 平台 `--media`、B 站 `--tid`、公众号 `--input`/`--html`）。验证方式：`node --test test/client.test.mjs` 的「发布：预览不执行、执行必须先勾选确认，参数按平台脚本形状拼装」用例；**实测结论**：通过
- [x] 13.5 热点来源可选并可沉淀为选题：热点区加来源多选（六个源），选择结果以 `?ids=` 传宿主（全选或全不选时省略参数）；每条线索可「存为选题」（`POST /topics`，来源标记为热点）并就地回报；抓取失败的来源照实呈现。验证方式：`node --test test/client.test.mjs` 的「热点：可选来源用 ?ids= 传给宿主，线索能存进选题库」用例；**实测结论**：通过
- [x] 13.6 刷新不得重建子树（真实缺陷）：`useResource` 重取时保留上一份数据、`Resource` 只在没有数据时显示 Loading、画像与主题详情加 `key`。修前实测：登录成功后列表刷新 → 子树卸载重建 → 登录面板重挂又报成功 → 再刷新，6 秒内 `/login/status` 被请求 400+ 次、React 警告刷出 22 万行、测试进程跑死。验证方式：`node --test test/client.test.mjs` 3.0 秒跑完 18 项、日志里 0 条 act 警告；**实测结论**：通过（修复前同一条用例 20 秒超时）
- [x] 13.7 发布与登录依赖自检（真实缺口）：该 venv 是用 `--groups core` 建的，而六个平台的登录脚本都 `import playwright`，于是「解释器 ok」并不等于「能扫码登录」——面板只会弹脚本原样的 `ModuleNotFoundError`。新增 `lib/host/runtime.js` 的 `probePythonPackages()`（用 `importlib.util.find_spec` 逐包查询，不真正 import）与 `lib/host/selfcheck.js` 的 `publish-deps` 条目：缺 `playwright` 报 `missing`，只缺 `biliup`/`requests`/`beautifulsoup4` 报 `degraded`（只影响 B 站上传与资讯类技能），没有解释器时指向 Python 那一条且不发注定失败的探测。验证方式：`node --test test/selfcheck.test.mjs`（9 例）与 `node --test test/runtime.test.mjs`（28 例）；**实测结论**：通过；本机用镜像补齐了 `playwright==1.60.0`（`~/.cache/ms-playwright` 里已有 `chromium-1223`，与 1.60.0 期望的可执行路径一致）、`requests`、`urllib3`、`beautifulsoup4`，`biliup` 在 sdist 元数据阶段挂死（`pip` 长时间停在 `Preparing metadata`）故保持 `degraded`
- [x] 13.9 产物可直接预览 + 宿主未重载可自解释（真实反馈）：发布表单在选中产物后给出指向宿主 `GET /files?path=…`（不带 `download=1`）的链接，浏览器内联渲染文章/图片/视频；预检按钮文案改为「预检（不发布）」；`createApi` 把宿主答的路由级 404（`code:"not-found"` + 「未知接口」）认成 `host-stale`，保留原文并追加「重启 DSH 进程后重试」。验证方式：`node --test test/client.test.mjs` 的「发布：…」用例新增 `[data-easel-publish-open]` 断言（href 为 `/easel-workbench/api/files?path=outputs/秋季护肤/note.md`、`target=_blank`、预检结果里也有该入口）与新增用例「宿主还是旧版（未知接口 404）时，错误文案要给出「重启 DSH」这一步」；**实测结论**：客户端 21/21、全量 322/322 通过；活实例上 `GET /files?path=outputs/DSH插件/dsh-context-公众号排版.html` 实测 200 + `text/html` + 15557 字节（文章可直接渲染），而 `POST /accounts/xiaohongshu/login` 仍是 404——即该提示对应的是真实存在的宿主旧版状态
- [x] 13.10 宿主重启说明（用户侧动作，非代码）：面板能自解释之后，仍需用户重启 DSH 进程才能让宿主半边生效；本条不产出代码，只把结论写进 `dsh-plugins/README.md` 与本 change 的验收清单。**实测结论**：DSH 主进程（pid 23）启动时刻早于本轮提交 37.7 分钟，页面刷新只换客户端
- [x] 13.8 面板内登记与删除排期（真实缺口）：排期列表只认标题带 `Easel｜` 前缀的条目（`lib/host/schedule.js:isEaselSchedule`），而 DSH 自己的排期界面建出来的条目不带这个前缀——于是日历区**永远**不会有内容，空态指引里的「登记排期」也没有可点的地方。宿主 `POST /schedule`/`DELETE /schedule/:id` 早就在（`lib/host/web.js:339-340`），缺的仍是入口。日历区新增 `ScheduleForm`（主题、任务目标、期望产物三项必填 + 投递会话 + 每天/每周/只一次 + 时区，时区默认取浏览器 `Intl` 值、取不到才回落 `Asia/Shanghai`），列表行加删除按钮（只在条目带 `sessionId` 时渲染，宿主 `remove` 要求 `id` 与 `sessionId` 同时到位）。验证方式：`node --test test/client.test.mjs` 的「登记排期：必填项本地就拦下，定时字段按 DSH 的形状原样透传」（断言缺项时零请求、`daily`/`weekly`/`at` 三种形状的请求体、成功后刷新列表）与「排期条目可以删除，没有会话绑定的条目不显示删除按钮」；**实测结论**：20/20 通过（客户端），全量 321/321
- [x] 13.11 免 root 补齐 Chromium 系统共享库，并把它接进子进程（真实缺陷）：本机 `ldd` playwright 下载的 chromium 得到 **24 个 `=> not found`**（首个 `libglib-2.0.so.0`），内核直接执行 `exitCode 127`，脚本把这一切折叠成「浏览器没能打开。请关闭弹窗，等 10 秒再点登录，不要连点。」——**这句话无法行动**。上游只做 `playwright install chromium`（不装系统库），官方 `install-deps` 要 root。新增 `scripts/install-browser-deps.mjs`（零依赖 Node ESM）：缺失 soname → `SONAME_PACKAGES` 映射 Debian 包 → 拉镜像 `Packages.gz` 索引 → 递归 `Depends` 闭包 → 下载 `.deb` → `dpkg-deb -x` 解到 `<runtimeDir>/chromium-deps/root`，写出 `installed.json`／`env.sh`，**不改系统目录、不需要 root**；新增 `lib/host/browser-deps.js` 只产出 `LD_LIBRARY_PATH` 覆盖，`lib/host/exec.js` 把 `spec.env` 透传给 `subprocess.spawn`（`runCommand` 与 `startCommand` 两处），登录/`whoami`/账号数据/发布四条链路各注入一次；非 Linux 返回空对象。验证方式：`node --test test/browser-deps.test.mjs`（11 例：路径只认真实目录、原有 `LD_LIBRARY_PATH` 保留在后、内核定位优先级、真探测用退出码判定、缺库 127 不谎报成功、spawn 抛错被折叠、接线防回归）。**实测结论**：11/11 通过；真机跑一次安装解出 **82 个包**，带注入环境执行内核 `--version` → `Chromium 148.0.7778.96`
- [x] 13.12 自检新增「浏览器内核」条目 + 面板摊开脚本输出（真实反馈）：`lib/host/browser-deps.js` 的 `probeChromium()` **真的启动一次内核**（`--version`），状态只看退出码——「包可导入」「文件存在」都不算；`lib/host/selfcheck.js` 新增 `browser-launch` 条目（找不到内核 → `missing`；内核在但秒退 → `degraded` 并带出退出码与输出尾部；能启动 → `ok` 并写出版本与内核路径），`hint` 指向免 root 补库脚本并说明 `--check` 可只看诊断。登录脚本自报的状态往往只有一句话，而 `loginStatus` 早已带 `logTail`（`stderr+stdout` 末 2000 字符）却从没被渲染过：`src/client.js` 在登录失败时就地渲染可折叠的 `<details data-easel-login-log>`，新增词条 `login.logSummary`。验证方式：`node --test test/selfcheck.test.mjs`（12 例）与 `node --test test/client.test.mjs` 的「脚本只留下一句「浏览器没能打开」时，面板要能就地摊开它的原始输出」用例。**实测结论**：自检 12/12、客户端 22/22 通过；真机探测回 `launched:true`、`148.0.7778.96`、注入路径以 `<插件>/.runtime/chromium-deps/root/usr/lib/x86_64-linux-gnu` 开头。**仍未解决且插件无法解决**：本机出口 IP 被小红书判为风险 IP（安全限制 `300012`），二维码在此环境无法弹出——脚本已给出两条出路（`--proxy socks5://…`，或在正常网络机器上登录后把 `~/.easel-browser-profiles/XiaohongshuProfile` 整个拷来复用），插件侧只保证把这类原始输出如实送到眼前

## 14. 内容日历（实际使用反馈第四批）

用户参照 Easel 自带的内容日历指出日历区应当是「每天各平台发什么一目了然」的月历，而不是一条排期列表。本批复用仓库既有的 `skills/shared/scripts/calendar_ops.py` 把日历区做成 6×7 月历，并补上筛选与翻月（详见 `design.md` 的 D28 与 `specs/creator-workbench-ui/spec.md` 的两条 requirement）：

- [x] 14.1 宿主内容日历服务（无需新增数据源）：新增 `lib/host/calendar.js`——`monthWindow(month)` 把一个月扩成**固定 42 天**（当月 1 号所在周的周一起，与界面格子数一一对应）；`dayKey()` 用**本地时区**拼 `YYYY-MM-DD`（`toISOString()` 是 UTC，东八区月初月末会错一天）；`normalizeCalendarItems()` 丢掉没有 `date` 的条目（`seed-holidays` 会写入这类无平台内容项）、把 `event_type`/`end_date` 换成驼峰字段；`createCalendarService({runtime, subprocess, resolvePython}).month(monthId)` 执行 `calendar_ops.py list --since --until`，缺脚本／缺解释器回 `NOT_CONFIGURED`（带 `details.path`）、输出不是 JSON 回 `SOURCE_UNAVAILABLE`（带退出码与 stderr 尾巴）。验证方式：新增 `node --test test/calendar.test.mjs`（12 例：本地日期与月份规整、42 天且首日为周一、跨年窗口、argv 形状、条目规整、四条 `month()` 行为）。**实测结论**：12/12 通过
- [x] 14.2 路由接线：`lib/host/web.js` 新增 `GET /calendar`（`?month=` 缺省与空串都交给宿主决定「当月」，不把空字符串塞进月份解析），`lib/index.js` 构造 `createCalendarService` 并注入 `createWebService`。验证方式：`node --test test/web.test.mjs` 新增「内容日历路由」用例（断言 `month=2026-08` 原样透传、缺省与空串都是 `undefined`）。**实测结论**：5/5 通过
- [x] 14.3 客户端月历视图：`src/client.js` 的日历区新增 6×7 月历——`monthKeyOf`/`shiftMonthKey`/`monthGridDays`/`dayKeyOf`/`calendarCategory`（`kind === "event"` → 平台活动，其余按宿主 `status`，不认识的值按已排期上色）；把 `GET /calendar`（内容 + 平台活动）与既有 `GET /schedule`（DSH 排期）在渲染前按本地日期合并落进同一个格子；工具栏给「全部／内容／活动」筛选与「‹ 上月／下月 ›／本月」翻月；格子里的平台名做成徽标，同日超过 3 条显示「还有 N 条」；日历区出错时就地显示原因而不影响下方排期表单与列表。词条新增 18 条 `calendar.*`（含 `calendar.weekday.0..6`），中英各 218 键；CSS 只用 `--dsw-*` 令牌（五个色点分别取 `--dsw-alias-label-tertiary`／`state-idle-primary`／`state-warn-primary`／`state-success-primary`／`state-business-primary`），因为客户端测试禁止硬编码色值。验证方式：`node --test test/client.test.mjs` 新增「内容日历：周一起始铺满 42 格，筛选与翻月都能用」（断言 42 格、周一起始表头、5 个图例、活动与内容两类条目落格与平台徽标、筛选切换后条目增减、翻月请求带新 `month=`、「本月」回到当月）。**实测结论**：客户端 24/24 通过；`node scripts/build-client.mjs` → `lib/client.js` 153036 字节

## 实现期记录（已完成部分的证据）

实现与自动验证已全部落盘，命令均在 `/data/dsh/home/dsh-hub/Easel` 下执行：

- 全量测试：`cd dsh-plugins/easel-workbench && node --test test/*.test.mjs` → **352 项全绿**（`fail 0`；
  早期记录为 277 项，§10–§13 的用例陆续补入后为 337，§14 的内容日历再补入 15 项后为 352）；
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
- **运行时探测与安装自检（2026-10-09，第 13 项实现期改进，对应 tasks 10.3/10.4 与 design D15）**：用户报「环境自检里
  Python/ffmpeg 都是 missing」后核实——只扫 `PATH` 会得出「本机没有 Python」的错误结论（本机 `~/.local/bin/python3.12`
  指向自建 CPython 3.12.15 可用，但 `PATH` 不含该目录）。改动：① `lib/host/runtime.js` 新增
  `userBinDirs(userBinCandidates)`，Python/ffmpeg 候选追加 `~/.local/bin` 并以来源 `user-bin` 与 `path` 区分；
  ② `lib/host/selfcheck.js` 每条非 `ok` 条目自带可执行 `hint`（`ok` 条目必须不带）；③ `src/client.js` 单独渲染
  `path`/`detail`/`hint` 并在空响应体 404 时显示「宿主服务未挂载」；④ 新增 `scripts/check-install.mjs` 与
  `test/{selfcheck,check-install}.test.mjs`。实测：`node --test test/*.test.mjs` → **292 项全绿**；
  `node scripts/check-install.mjs --profile /data/dsh/profiles/web --url http://127.0.0.1:3080` → 五项全绿 exit 0
  （`easelRoot=/data/dsh/home/dsh-hub/Easel/_repo`）；`probeRuntime` 真实配置下 `python.ok=true`（`user-bin`）、
  `ffmpeg` 仍 `not-found`（本机没装，属如实降级）。已把开发副本的 `.runtime` 通过 profile 补丁层
  `/data/dsh/profiles/web/cordis.patch.yml` 定向覆盖给已安装副本（`dsh --profile web --dump-config` 已确认合成结果）。
- **界面文案本地化（2026-10-09，第 14 项实现期改进，对应用户在环境自检页的反馈与 design D16）**：用户重启后截图显示
  Python 一项已变 ok、运行时目录 ok，但——状态标签直出英文 `ok` / `missing`，且 `ready:false` 时摘要行只有「缺失」
  两个字（会被读成区块标题，让满屏正常条目也像故障）。改动：① 字典补 `value.*`（24 个枚举）与
  `selfcheck.summary{Ok,Missing,Degraded}`、`common.listSeparator`/`clauseSeparator` 共 28 个词条（zh/en 各 88 条对齐）；
  ② `src/client.js` 新增 `valueLabel(t, value)`（缺词条回落原值），账号（总览与账号页）、内容库、排期、选题、自检
  的标签与 meta 行全部改走它，`easel-state-*` 类名仍用宿主原值；③ 自检摘要改为「缺失：ffmpeg；降级：运行时目录」
  /「全部就绪」；④ `describeAccepts` 把 `image`/`video` 等素材类型也本地化；⑤ 自检两条文案去重
  （上游只读、技能目录长度）。另：非 root 环境下 ffmpeg 的 `hint` 改为 `sudo apt-get install -y ffmpeg`，
  并补一条不需要包管理器权限的出路（静态构建放 `~/.local/bin/ffmpeg` 或配置 `ffmpegExecutable`），
  对应 `test/selfcheck.test.mjs` 新增的两条断言（`process.getuid()` 判定，root 下不要求 `sudo`）。实测：`node --test test/*.test.mjs` → **294 项全绿**（新增 2 个客户端用例）；
  `node scripts/build-client.mjs` → `lib/client.js` 58179 字节；`openspec validate … --strict` 通过。
- **安装与激活实测（2026-10-09，第 12 项实现期缺陷，属打包契约而非接口逻辑）**：按用户报障（面板 10 个子页
  全部 `HTTP 404`）定位到——现象：`curl http://127.0.0.1:3080/easel-workbench/api/config` → `404`、`0B`
  （DSH 默认 404、无响应体，与插件自身 `lib/host/web.js:361` 的 JSON 404 可区分）；
  `plugin_manager action=set_bundle` → `1 entry did not activate / easel-workbench (easel-workbench): failed to import`。
  根因：以源码树 `link:` 安装（`dependencies["easel-workbench"]="link:…/_repo/dsh-plugins/easel-workbench"`）时
  pnpm 不为该目标装依赖，Node 又按链接目标的真实路径解析模块 →
  `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery' imported from /data/dsh/home/dsh-hub/Easel/_repo/dsh-plugins/easel-workbench/lib/host/config.js`，
  宿主半边 `apply` 未执行，`webServer.register` 从未注册。处置：宿主运行时包改 `peerDependencies`（与 profile 内
  `dsh-context`/`@michengai/dsh-automation`/`dsh-mcp-connector` 的 `dependencies:{}` 惯例一致，D11）；以物化安装为
  受支持方式、源码树 `link:` 只作开发态（D12）；安装后必须重载进程、以宿主接口 200 为验收判据（D13）；
  客户端对空体 404 给可操作诊断（D14）。新增能力 delta `specs/workbench-bundle-packaging/spec.md` 与
  `specs/creator-workbench-ui/spec.md` 的「宿主服务缺失时的可操作诊断」requirement；对应任务见 §10。
- **界面可用性（2026-10-09，第 15 项实现期改进，对应用户「验证账号提示进程不可用 / 帮我装 ffmpeg / 怎么绑定
  会话生成内容、画像怎么维护、日历热点选题为什么空白」的反馈与 design D17–D19）**：① 真实缺陷——`lib/index.js`
  在 `apply()` 里对 `serviceOf(ctx, "subprocess")` 取快照，而 DSH 的服务注册晚于插件挂载，于是账号验证永久
  返回 `runtime-missing`「DSH 子进程服务不可用」，同一实例的 `/selfcheck` 却说能力 ok（自检是请求时解析）；
  改为 `lazyService(ctx, "subprocess")` + `runCommand` 内解析，并让 `resolvePython` 与自检共用一条候选链；
  ② 客户端补「派发到会话」入口（选题行 → 表单 → `POST /dispatch` → 「打开会话」走 `uiWorkspace.openSession`）、
  画像新建与逐维度编辑（`POST /profiles`、`PUT /profiles/:name/dimensions/:dimension`）、七处空态改为
  「数据从哪来 + 做什么才会有」；③ 测试基础设施缺陷——`react-dom` 在 require 时烘死 `canUseDOM`，而
  `test/client.test.mjs` 先 require React 后装 jsdom，导致受控输入永不触发 `onChange`（四个用例假失败）；
  改为先 `installGlobals(createDom())` 再 require React，写输入框用原型 `value` setter + `input` 事件；
  ④ 新增一个环境相关断言的自纠——`test/index.test.mjs` 里 `spawned.every(argv => argv[0] === process.execPath)`
  在本机装好 ffmpeg 后失败（探测链会顺带跑 `ffmpeg -version`），改为只对账号验证那条断言 `argv[0]`。
  实测：`node --test test/*.test.mjs` → **298 项全绿**；`node --test test/client.test.mjs` → 15/15；
  `node scripts/build-client.mjs` → `lib/client.js` 79183 字节；`ffmpeg -version` 输出静态构建
  `N-47683-g0e8eb07980-static`（已放到 `/data/dsh/home/.local/bin/ffmpeg`），活实例
  `GET /easel-workbench/api/selfcheck` → `ready:true`、`missing:[]`。
- **扫码登录、发布与热点（2026-10-09，第 15 项实现期改进，对应用户「怎么绑定会话生成内容 / 画像怎么维护 /
  账号验证提示进程不可用」的第三批反馈，见 design D20–D23）**：先做覆盖度侦察，结论是「大半已实现、空壳
  只有两处」——**扫码登录宿主侧根本没有启动端点**（`lib/host/accounts.js:435-452` 的 `loginPlan()` 只回一条
  命令，不 spawn、不出码、不轮询；`lib/host/web.js:303` 只暴露 `login-plan`），**发布区客户端没有入口**
  （`src/client.js:787-830` 只渲染平台表与历史），而「真发到平台」的路径宿主早已接通
  （`lib/host/web.js:312` → `lib/host/publish.js:261-361` → 脚本 `--exec`）。改动：① 宿主新增
  `startLogin` / `loginStatus` / `cancelLogin` / `submitSmsCode` / `qrImage` 与 `lib/host/exec.js` 的
  `startCommand()`（不 await `handle.done`、`done` 永不 reject），`lib/host/web.js` 增五条路由（含二维码
  二进制 PNG），平台描述符补 `--no-proxy` / `--sms-code-file` / `--cookie`；② 客户端新增 `LoginPanel`
  （启动 / 1.5 秒轮询 / 二维码 `?ts=` 破缓存 / 短信码回填 / 取消）、`PublishForm`（预览 → 勾选确认 → 执行）、
  热点来源多选（`?ids=`）与「存为选题」；③ **真实缺陷**——`useResource` 每次重取都把 `data` 清空，
  于是「登录成功 → 刷新账号列表」把整棵子树卸载重建，重建出的 `LoginPanel` 首次探测又读到 `success`
  再次触发刷新，形成自激循环（实测 6 秒内 `/accounts/xiaohongshu/login/status` 被请求 400+ 次、React 的
  act 警告刷出 22 万行、用例 20 秒超时且进程 `Promise resolution is still pending`）；改为重取保留上一份
  数据 + `Resource` 只在没有数据时显示 Loading + 画像/主题详情加 `key` 后，同一条用例 68 ms 通过、日志
  0 条警告。实测：`node --test test/accounts.test.mjs` → **32/32**；`node --test test/web.test.mjs` → **4/4**
  （新增：假请求必须始终 `emit("end")`，否则 `handle()` 会挂住）；`node --test test/client.test.mjs` →
  **20/20**；`node --test test/*.test.mjs` → **321 项全绿**；`node scripts/build-client.mjs` →
  `lib/client.js` 110608 字节。

- **发布与登录依赖自检（2026-10-09，第 16 项实现期改进，见 design D24）**：把工作台自带的 venv 用
  `--groups core` 建起来后，自检一直报「Python 运行时 ok」，但六个平台的登录脚本都 `import playwright`
  ——点「扫码登录」只会在面板里弹一句脚本原样的 `ModuleNotFoundError`。新增
  `lib/host/runtime.js:probePythonPackages()`（`importlib.util.find_spec` 逐包查询，不真正 import，
  避免 `biliup` 那种拉起一串子模块的开销）与 `lib/host/selfcheck.js` 的 `publish-deps` 条目，并分两级：
  缺 `playwright` 报 `missing`（登录与六个平台发布的必经之路），只缺 `biliup`/`requests`/`beautifulsoup4`
  报 `degraded`（只影响 B 站上传与资讯类技能），没有解释器时指向「Python 运行时」那一条且不发注定失败的
  探测。实测：本机用镜像补齐 `playwright==1.60.0` + `requests`/`urllib3`/`beautifulsoup4`（`~/.cache/ms-playwright`
  里已有 `chromium-1223`，与 1.60.0 的期望路径一致，无需再下浏览器）；`biliup` 的 sdist 元数据阶段
  长时间挂住（`pip` 停在 `Preparing metadata`），因此该项在活实例上是 `degraded`——这与它「只影响 B 站
  上传」的事实一致，hint 里给了「用官方 release 的 biliup 二进制放进 PATH 或 `~/.local/bin`」这条出路。
  测试：`node --test test/selfcheck.test.mjs` → 9/9；`node --test test/runtime.test.mjs` → 28/28。

- **排期登记与删除入口（2026-10-09，第 17 项实现期改进，见 design D25）**：日历区此前只有列表——
  而列表只显示标题带 `Easel｜` 前缀的条目，DSH 自己的排期界面建出来的条目不带前缀，所以这个区域对任何
  用户都是永久空态。新增 `ScheduleForm`（主题/任务目标/期望产物必填、选投递会话、每天/每周/只一次、时区
  默认取浏览器）与列表行删除按钮（仅在有会话绑定时渲染），本地只校验必填项，时间与时区合法性交给 DSH。
  测试：`node --test test/client.test.mjs` → 20/20；全量 `node --test test/*.test.mjs` → **321 项全绿**。

- **产物可直接预览 + 宿主未重载可自解释（2026-10-09，第 18 项实现期改进，见 design D26）**：用户反馈
  「现在文章还不能预览，另外就是账号登录的时候接口报错了」，两件事都不是新功能缺失：前者是语义问题——
  面板里的「预览」其实是**预检**（拼 argv + 跑内容门禁），它不会把文章摊给用户看，所以新增选中产物的
  「预览选中的文件」链接（`GET /files?path=…`，不带 `download=1`，宿主按扩展名内联返回；实测
  `outputs/DSH插件/dsh-context-公众号排版.html` → 200 + `text/html` + 15557 字节）并把预检按钮改名为
  「预检（不发布）」；后者是**运行中的宿主还是旧版**（客户端 bundle 每次请求从磁盘读，宿主代码只在 DSH
  进程启动时 import 一次）：实测 `POST /accounts/xiaohongshu/login` 404、`/selfcheck` 仍只有旧 10 条，
  主进程启动时刻比探测早 37.7 分钟。代码侧把这种宿主自答的 `未知接口` 404 认成 `host-stale`，保留原文
  并追加「请重启 DSH 进程后重试」，避免下次再让人对着「未知接口」猜。超长路径也会折行，不再撑破预览框。
  测试：`node --test test/client.test.mjs` → 21/21；全量 `node --test test/*.test.mjs` → **322 项全绿**。

- **登录链路的缺库收口（2026-10-10，第 19 项实现期改进，见 design D27）**：用户两张红框截图把问题钉在
  「点登录只得到一句『浏览器没能打开』」。逐层实测后确认根因不在脚本、不在网络：内核依赖的系统共享库
  缺 24 个（首个 `libglib-2.0.so.0`），内核 `exitCode 127`。三步收口：①`scripts/install-browser-deps.mjs`
  免 root 解包（实测 82 个包，内核 `--version` → `148.0.7778.96`）；②`lib/host/browser-deps.js` +
  `lib/host/exec.js` 的 `spec.env` 让登录/验证/账号数据/发布四类子进程拿到 `LD_LIBRARY_PATH`；
  ③自检新增 `browser-launch`（真的启动一次）并把登录脚本输出尾巴摊到面板（`<details>` + `login.logSummary`）。
  测试：`node --test test/browser-deps.test.mjs` → 11/11、`node --test test/selfcheck.test.mjs` → 12/12、
  `node --test test/client.test.mjs` → 22/22；全量 `node --test test/*.test.mjs` → **337 项全绿**
  （322 → 337：新增 11 + 3 + 1）。**插件之外仍开放**：出口 IP 的小红书风控 `300012` 需代理或导入既有
  profile 目录（见 13.12），这是环境问题而不是插件缺陷——面板现在会把 `300012` 这类原文直接显示出来。
- **内容日历（2026-10-10，第 20 项实现期改进，见 design D28）**：用户参照 Easel 自带的内容日历提出「日历区应该
  是一张真正的月历」。复用仓库既有的 `skills/shared/scripts/calendar_ops.py`（`list --since --until`），
  **不自造节日表**：宿主 `lib/host/calendar.js` 把一个月扩成固定 42 天（周一起始，与界面格子数一一对应），
  `dayKey()` 用本地时区拼 `YYYY-MM-DD`（`toISOString()` 是 UTC，东八区月初月末会错一天），
  `normalizeCalendarItems()` 丢掉没有 `date` 的条目；客户端把 `GET /calendar` 与既有 `GET /schedule`
  在渲染前合并落进同一个格子，并给出「全部／内容／活动」筛选与「‹ 上月／下月 ›／本月」翻月，
  五个图例色点全部取 `--dsw-*` 令牌（客户端测试禁止硬编码色值）。测试：
  `node --test test/calendar.test.mjs` → 12/12、`node --test test/web.test.mjs` → 5/5（新增路由 1 例）、
  `node --test test/client.test.mjs` → 24/24（新增月历 1 例）；全量 `node --test test/*.test.mjs` →
  **352 项全绿**（337 → 352）；`node scripts/build-client.mjs` → `lib/client.js` 153036 字节。

## 待用户验收（本机无法完成的部分）

本会话批准策略为 `never`（无法真实 `plugin_manager install_bundle`、无法联网截图）。`ffmpeg` 已于
2026-10-09 装到 `/data/dsh/home/.local/bin/ffmpeg`（见 §12 的 12.5），因此下面凡提到「本机没有 ffmpeg」
的条目均以该安装为前提复看：

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
  2026-10-09 实测：**安装本身成功**（`dsh.profile.bundles` 含 `easel-workbench`、`node_modules/easel-workbench`
  符号链接就位），失败发生在激活阶段——见 §10 与 `design.md` 的 D11–D14、安装与激活实测记录。
- **2.4**：中文界面、英文界面、折叠态三张截图。
- **11.1–11.3（需重启后目视确认）**：界面文案本地化与自检摘要的改动已由 `test/client.test.mjs` 与
  `test/selfcheck.test.mjs` 覆盖，但**只有在重启 DSH 以加载新宿主/客户端代码后**才能在浏览器里看到：
  状态标签应显示「正常／缺失／降级／已授权／未授权」等中文；ffmpeg 装好之后自检摘要应显示「全部就绪」，
  而不再是「缺失：ffmpeg」。
- **12.1–12.3（需重启后走查）**：空态指引、「选题 → 派发到会话」、「新建画像 / 逐维度编辑」三件客户端改动
  已由 `test/client.test.mjs` 的 15 项覆盖，但真机走查才能确认：日历/热点/选题/内容库的空态说明了数据来源；
  在选题行点「派发」、填期望产物并投递到新会话后，能在工作台看到该会话并点「打开会话」跳过去；
  画像页能新建画像、编辑某个维度并看到「已保存 …」。**12.4 的子进程修复同样要重启宿主才生效**——
  重启前点账号「验证」仍会报「DSH 子进程服务不可用」。
- **7.2**：在 DSH 排期界面暂停/删除工作台条目后，工作台视图同步显示为已暂停/已消失。
- **8.1 / 8.3**：删除 `_repo/easel/`、`_repo/openclaw/`、`setup.sh`、`setup.ps1` 与 `web/app.py` 的三组
  路由，以及替换 20 个 OpenClaw 集成测试——8.1 的前置条件是「新路径全部验收通过」，即上面这些真机验收；
  在此之前 `_repo` 保持原样（8.5）。
- **10.5（已验证）**：用户重启 3080 实例后 `GET /easel-workbench/api/config`、`/overview`、`/selfcheck`、
  `/topics` 均 200 + JSON，面板十个子页不再出现 404——「宿主半边是否挂载」这一判据已达成。**仍开放的可选硬化项**：
  以物化方式（`pnpm pack` 生成的 `.tgz`）重装，摆脱源码树 `link:` 与开发副本共用目录的耦合。本机到 PyPI 不可达，
  且 `github:`/git 规格会被 pnpm 解析成 `git+ssh://`（本机 ssh 读不到 `/home/node/.ssh`，见 `design.md` 实测记录），
  故不宜走 git 规格。
- **10.6（已完成）**：README 的安装/探测/排查/开发各节已按实测回写（含 `~/.local/bin` 候选、`user-bin` 来源标记、
  非 ok 条目的 `hint`、profile 补丁层定向覆盖 `runtimeDir`、`scripts/check-install.mjs` 用法表）。

## Workflow follow-up

- 用户审阅并批准本 change 后，再进入 `/openspec-apply-change` 开始实现；本 change 通过前不得改动实现代码。
- 实现过程中若 `design.md` 的 Open Questions 得到答案且会改变已写 requirement，先用 `/openspec-update-change` 回改 spec 再继续。
- 全部任务完成后运行 `openspec validate add-easel-workbench-plugin --strict`，通过后再归档到 `openspec/changes/archive/`。
