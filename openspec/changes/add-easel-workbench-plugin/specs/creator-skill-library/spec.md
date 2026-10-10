# Spec Delta

## Purpose

把 Easel 的内容技能作为 DSH 技能库的一部分提供给创作者与模型，使技能的发现、调用、预览与目录成本都由 DSH 统一管理，插件自身不再承担技能管理职责。

## ADDED Requirements

### Requirement: 技能经 DSH 技能体系提供

系统 SHALL 把 Easel 的技能目录作为 DSH 文件系统技能提供方的自定义技能根接入，使这些技能与 DSH 的其他技能一同出现在技能目录中。插件 MUST NOT 自建技能注册表、技能索引或技能扫描逻辑。

#### Scenario: 技能出现在会话目录中

- **WHEN** 用户在 DSH 中开始一个可从 Easel 技能根获得技能的会话
- **THEN** 技能目录列出 Easel 技能根下的技能，包含选题、文案、视频制作与发布分析等技能名称

#### Scenario: 按名称调用技能

- **WHEN** 用户以斜杠手势调用 Easel 技能根下的某个技能
- **THEN** 该技能的指令内容作为用户角色的指令上下文注入当前会话，并在对话中渲染为可展开的说明卡片

#### Scenario: 插件内不存在技能注册逻辑

- **WHEN** 审阅插件的宿主与客户端产物
- **THEN** 不存在技能注册表、技能目录扫描或技能校验的实现

### Requirement: 技能格式遵循 DSH 规范

技能 SHALL 以 DSH 规范的形式被提供：每个技能位于独立目录下的 `SKILL.md`，其 frontmatter 至少包含 `name` 与 `description`，其中 `name` 为 kebab-case。技能 frontmatter 中不属于 DSH 规范的额外字段 SHALL 被容忍，MUST NOT 因此导致技能被丢弃。

#### Scenario: 额外字段被忽略而不影响技能

- **WHEN** 某技能的 frontmatter 含有一个 DSH 规范之外的字段
- **THEN** 该技能仍然出现在技能目录中并可被调用，且不产生丢弃该技能的警告

#### Scenario: 缺少必填字段的技能被明确报告

- **WHEN** 某个技能目录的 `SKILL.md` 缺少 `name` 或 `description`
- **THEN** DSH 报告该技能被跳过及其原因，其余技能不受影响

### Requirement: 技能界面复用 DSH 能力

技能的发现、调用与内容预览 SHALL 由 DSH 既有的技能界面承担。插件 MUST NOT 提供自建的技能浏览、技能搜索或技能校验界面，MUST NOT 在服务端提供读取技能内容的独立接口。

#### Scenario: 通过 DSH 界面预览技能内容

- **WHEN** 用户在对话中点击一个已知技能的引用
- **THEN** 该技能的 `SKILL.md` 由 DSH 在右侧栏打开

#### Scenario: 插件不暴露自建技能接口

- **WHEN** 审阅插件注册的服务方法
- **THEN** 不存在列出技能、读取技能内容或校验技能的接口

### Requirement: 技能目录成本可配置

技能目录是注入会话的常驻内容，系统 SHALL 提供配置项以限制目录中每条技能描述的字符数，该限制 SHALL 在截断描述的同时保留技能名称。配置值 SHALL 允许的取值下界不小于 3。

#### Scenario: 限制生效后目录变短

- **WHEN** 部署把一个较小的目录描述长度上限写入配置并开始新会话
- **THEN** 会话中的技能目录按该上限截断各条描述，技能名称完整保留，目录整体长度较默认值明显下降

#### Scenario: 默认值在未配置时生效

- **WHEN** 部署未设置目录描述长度上限
- **THEN** 目录按 DSH 的默认上限生成，不因本插件而改变

### Requirement: 技能运行时可用性上报

Easel 技能通过外部 Python 解释器与 `ffmpeg` 执行，系统 SHALL 能探测这些程序是否存在，并 SHALL 把探测结果以可读形式呈现给用户。任一程序缺失时，工作台 SHALL 仍可打开并浏览不依赖该程序的区域，MUST NOT 因此崩溃或阻塞。

#### Scenario: 运行时缺失时给出可读提示

- **WHEN** 外部 Python 解释器或 `ffmpeg` 不存在，用户打开工作台的环境自检区域
- **THEN** 该区域逐项显示缺失项及其期望的可执行文件，工作台其余区域仍可正常浏览

#### Scenario: 运行时齐备时报告可用

- **WHEN** 外部 Python 解释器与 `ffmpeg` 均可用，用户打开环境自检区域
- **THEN** 该区域逐项报告其可用状态与解析到的可执行路径

#### Scenario: 依赖缺失不影响面板打开

- **WHEN** 外部 Python 解释器与 `ffmpeg` 均不存在
- **THEN** 侧边栏入口与工作台面板仍可正常打开与关闭，不出现渲染失败

### Requirement: 缺失项必须给出可执行的下一步

运行时探测 SHALL 覆盖**用户态可执行目录**（`~/.local/bin`），而不只扫描 `PATH`：`pip install --user`、pipx 与「把自建解释器软链到用户目录」都不修改 `PATH`。自检结果的每一条非 `ok` 条目 SHALL 携带一段可执行的 `hint`（要运行的具体命令或要改的具体配置键），`ok` 条目 MUST NOT 携带 `hint`。

#### Scenario: 解释器只在用户态目录里

- **WHEN** `PATH` 上没有解释器，但 `~/.local/bin/python3.x` 可执行
- **THEN** 自检把 Python 报为可用，并标明该结论来自用户态目录（与 `PATH` 命中区分）

#### Scenario: 缺失条目自带下一步

- **WHEN** 自检报出 Python 或 `ffmpeg` 缺失
- **THEN** 对应条目带一段 `hint`，指明要运行的具体命令或要改的具体配置键，而不是只说明「未找到」

### Requirement: 发布与登录的 Python 依赖必须可自检

扫码登录与跨平台发布都是「宿主起子进程、脚本自己开浏览器或上传」，解释器存在并不代表脚本能跑：工作台 SHALL 在环境自检中单独上报「发布与登录依赖」，逐包探测 `playwright`（扫码登录与六个平台发布必需）以及 `biliup`、`requests`、`beautifulsoup4`（B 站上传与资讯类技能）。探测 SHALL 只查询包是否可导入（`importlib.util.find_spec`），MUST NOT 真正导入这些包。缺少登录必需包时该条目 SHALL 为 `missing`，只缺附加包时 SHALL 为 `degraded`，并 SHALL 携带可执行的 `hint`。

#### Scenario: 缺 playwright 时点名并阻止「能干活」的假象

- **WHEN** 解释器存在但 `playwright` 无法导入
- **THEN** 该条目为 `missing`，点名缺失的包，并在 `hint` 里给出补齐 `--groups core,publish` 的命令与 pip 镜像写法

#### Scenario: 只缺 B 站上传依赖时降级而不是报缺失

- **WHEN** `playwright` 可导入，但 `biliup` 之类的附加包不可导入
- **THEN** 该条目为 `degraded`，说明只影响 B 站上传与资讯类技能，并提示 `biliup` 命令行用官方二进制放进 `PATH` 或 `~/.local/bin` 同样可用

#### Scenario: 没有解释器时不谎报某个包缺失

- **WHEN** 外部 Python 解释器不存在
- **THEN** 该条目指向「Python 运行时」一条，且不发起注定失败的包探测（不自称某个包缺失）

### Requirement: 浏览器内核必须真的启动过才算可用

`playwright` 能导入不等于浏览器能启动：精简发行版与容器里，内核依赖的系统共享库缺失时，脚本照样起得来、内核却在动态链接阶段以非 0 退出（典型 `exitCode 127`）。工作台 SHALL 在环境自检中单独上报「浏览器内核」，判据只能是**真的执行一次内核**（`--version`）的退出码，MUST NOT 用「包可导入」或「文件存在」代替。能启动时该条目 SHALL 为 `ok` 并写出版本与内核路径；内核存在但启动失败时 SHALL 为 `degraded`，且 `detail` SHALL 带出退出码与内核输出的尾部；找不到内核时 SHALL 为 `missing`。

#### Scenario: 内核秒退时不谎报可用

- **WHEN** 内核可执行文件存在，但带 `--version` 启动时因缺共享库以非 0 退出
- **THEN** 自检的「浏览器内核」条目为 `degraded`，`detail` 带出退出码与内核输出，`hint` 给出免 root 补库脚本的绝对路径（并说明 `--check` 可只看诊断）

#### Scenario: 缓存里没有内核时报缺失

- **WHEN** 运行环境里找不到任何 Chromium 内核
- **THEN** 该条目为 `missing`，`hint` 给出装上内核的具体命令，且不发起任何伪造的启动探测

### Requirement: 缺系统共享库时可用免 root 方式补齐并接进子进程

工作台 SHALL 支持把内核依赖的系统库下载并解包到**插件运行目录之内**：不改系统目录、不需要 root、不依赖包管理器权限。宿主 SHALL 在登录、`whoami` 验证、账号数据与发布这四类子进程启动时，把该解包目录接进子进程的 `LD_LIBRARY_PATH`；解包目录不存在时 MUST NOT 改动子进程环境。登录脚本自报的状态往往只有一句话，因此面板 SHALL 在登录失败时就地摊开脚本输出的尾部（可折叠），MUST NOT 只显示脚本自报的那句状态。

#### Scenario: 免 root 补齐后子进程拿到库目录

- **WHEN** 运行目录下的 `chromium-deps` 已解包出库目录
- **THEN** 登录、`whoami`、账号数据与发布四类子进程的环境里出现指向该目录的 `LD_LIBRARY_PATH`，且原有 `LD_LIBRARY_PATH` 的值被保留在其后

#### Scenario: 登录失败时能看到脚本的原始输出

- **WHEN** 登录状态文件的 `state` 为 `error`，且宿主返回了脚本输出的尾部
- **THEN** 登录面板就地渲染出这段原始输出（可折叠），而不只显示脚本自报的一句状态
