# Spec Delta

## Purpose

让创作者在 DSH Web GUI 内拥有一个独立的内容工作台页面：从侧边栏入口进入，在中栏覆盖会话区域展开，可随时返回原会话，并遵守 DSH 的呈现与主题约束。

## ADDED Requirements

### Requirement: 侧边栏工作台入口

系统 SHALL 在 DSH 侧边栏的全局面板入口列表中注册一个条目，其标识为 `easel-workbench`，显示名称为「自媒体工作台」（英文为 "Creator Workbench"），位置在「新会话」按钮下方、会话列表上方。该条目 SHALL 提供图标，并在侧边栏折叠态下保持可达。

#### Scenario: 入口出现且命名正确

- **WHEN** 用户在中文界面的任意会话中查看侧边栏
- **THEN** 侧边栏在「新会话」按钮下方显示带图标的「自媒体工作台」条目

#### Scenario: 英文界面显示英文名称

- **WHEN** 用户界面语言为英文
- **THEN** 该条目显示为 "Creator Workbench"

#### Scenario: 折叠态下入口仍可达

- **WHEN** 用户将侧边栏折叠为图标轨道
- **THEN** 「自媒体工作台」入口仍可见且可点击，并显示无障碍名称与折叠提示

### Requirement: 工作台主面板覆盖会话区域

选中侧边栏工作台入口后，系统 SHALL 让中栏渲染工作台面板，替代该位置原本的会话界面；会话界面 SHALL 在该选择生效期间不再渲染于中栏。工作台面板 SHALL 注册在布局的全局面板键位 `easel-workbench` 上，且该注册 SHALL 在选择发生前就已就绪。

#### Scenario: 点击入口后中栏被替换

- **WHEN** 用户点击侧边栏的「自媒体工作台」入口
- **THEN** 中栏显示工作台面板，且同一位置的会话界面不再显示

#### Scenario: 选择未注册的面板键不会破坏布局

- **WHEN** 工作台面板尚未注册完成时用户触发了选中操作
- **THEN** 系统保留当前选中的面板并报告错误，中栏不进入空白状态

### Requirement: 返回对话且不改变当前会话

工作台面板 SHALL 提供返回会话界面的操作；该操作 SHALL 只把中栏切回会话界面，MUST NOT 改变当前会话、清空输入草稿或重置会话滚动位置。

#### Scenario: 返回对话保留会话状态

- **WHEN** 用户在工作台面板中点击返回对话
- **THEN** 中栏恢复为进入工作台前的那个会话，其输入草稿与滚动位置保持不变

### Requirement: 面板内子导航

工作台 SHALL 把其功能区域组织为面板内部的子导航，而不是在侧边栏注册额外入口。子导航 SHALL 至少覆盖总览、账号、画像、内容库、发布、日历、选题、热点、数据与环境自检这些功能区域，并且一次 SHALL 只呈现其中一个子页面。

#### Scenario: 在面板内切换子页面

- **WHEN** 用户在工作台内选择「内容库」子导航项
- **THEN** 面板内容区显示内容库子页面，侧边栏条目数量不变

#### Scenario: 子导航覆盖全部功能区域

- **WHEN** 用户展开工作台子导航
- **THEN** 总览、账号、画像、内容库、发布、日历、选题、热点、数据与环境自检均可达

### Requirement: 呈现与主题约束

工作台 SHALL 以页面内 React 组件形式渲染；MUST NOT 使用 iframe 承载界面；MUST NOT 引入任何 DSH 客户端包；其全部颜色 SHALL 取自 DSH 主题令牌，MUST NOT 使用自建主题色。

#### Scenario: 明暗主题切换时配色跟随

- **WHEN** 用户在 DSH 中切换明暗主题
- **THEN** 工作台面板的配色随主题变化，无固定色块残留

#### Scenario: 无 iframe 与客户端包依赖

- **WHEN** 审阅工作台的客户端产物与源码
- **THEN** 不存在 iframe 元素，且不存在对 DSH 客户端包的依赖声明或运行时引用

### Requirement: 面板故障隔离

工作台子页面渲染失败时，系统 SHALL 把错误限制在工作台面板内部并呈现可读的错误态；MUST NOT 让异常逃逸到面板挂载点，从而清空该挂载点。

#### Scenario: 子页面抛错时面板其余部分可用

- **WHEN** 某个工作台子页面在渲染时抛出异常
- **THEN** 面板显示该子页面的错误态，子导航与返回对话入口仍可操作

### Requirement: 宿主服务缺失时的可操作诊断

当工作台宿主半边未挂载（接口返回无响应体的 404）时，面板 SHALL 呈现可操作的诊断，说明宿主服务未挂载并指引用户重载进程；对插件自身返回的 JSON 错误，SHALL 保持原有错误态呈现。

#### Scenario: 空响应 404 显示宿主未挂载提示

- **WHEN** 工作台请求 `/easel-workbench/api/config` 收到 0 字节且无响应体的 404
- **THEN** 面板显示「宿主服务未挂载，请重载 DSH」一类的提示与重试入口，而不是只显示 `HTTP 404`

#### Scenario: 插件自身错误保持原样

- **WHEN** 工作台请求收到插件返回的 `{"ok":false,"code":"invalid-input","message":…}`
- **THEN** 面板按该响应体的 `message` 呈现错误态，MUST NOT 改写成宿主未挂载提示

### Requirement: 界面不得直出宿主枚举值

工作台界面 SHALL 把宿主返回的状态枚举（`ok` / `missing` / `degraded` / `authorized` / `unauthorized` / `scheduled` 等）按当前语言呈现；字典缺少对应词条时 SHALL 回落显示原始值，MUST NOT 显示空白或 `value.` 前缀的内部键名。状态对应的样式类名 SHALL 保持宿主原值，使文案与样式解耦。

#### Scenario: 状态标签随语言呈现

- **WHEN** 宿主返回 `state: "unauthorized"` 且当前语言为中文
- **THEN** 账号条目的状态标签显示「未授权」，MUST NOT 显示英文枚举原词

#### Scenario: 字典缺少新枚举值

- **WHEN** 宿主返回一个字典中尚未收录的状态值
- **THEN** 界面原样显示该值，MUST NOT 显示空白或 `value.` 前缀的内部键名

### Requirement: 环境自检摘要必须点名缺失与降级项

`/selfcheck` 返回 `ready:false` 时，工作台 SHALL 在摘要行列出缺失与降级条目的名称；全部就绪时 SHALL 明确表示全部正常。MUST NOT 只用「缺失」二字充当摘要。

#### Scenario: 缺少 ffmpeg 且运行时目录降级

- **WHEN** 自检结果包含 `status:"missing"` 的 `ffmpeg` 与 `status:"degraded"` 的「运行时目录」
- **THEN** 摘要行显示「缺失：ffmpeg；降级：运行时目录」一类的点名文案

#### Scenario: 全部就绪

- **WHEN** 自检结果中所有条目均为 `ok`
- **THEN** 摘要行显示「全部就绪」一类的明确结论

### Requirement: 空态必须给出下一步

任一功能区域在无数据时 SHALL 说明「数据从哪来、做什么才会有」，MUST NOT 只显示「暂无内容」一类的死路提示。空态文案 SHALL 来自字典，可随语言切换。

#### Scenario: 日历为空

- **WHEN** `/schedule` 返回空列表
- **THEN** 日历空态说明排期来自 DSH 排期与工作台登记，并指出派发任务或登记排期后才会出现条目

#### Scenario: 内容库为空

- **WHEN** `/projects` 返回空列表或某个主题下没有产物
- **THEN** 内容库空态说明产物位于 `outputs/<主题>/`，并指出把选题派发到会话产出后才会出现在这里

### Requirement: 选题可以派发成会话里的任务

选题区域 SHALL 提供派发入口，收齐「期望产物」（必填）、目标画像、目标平台、补充说明与投递目标（新会话或既有会话），并以 `POST /dispatch` 提交。缺少期望产物时 SHALL 在本地拦下并说明缺什么，MUST NOT 把请求发到宿主。派发成功后 SHALL 说明落到哪个会话，并提供走 `uiWorkspace.openSession` 的「打开会话」入口。

#### Scenario: 缺少期望产物

- **WHEN** 用户没有填写期望产物就提交派发表单
- **THEN** 面板显示「请先写清期望产物」，且不发出 `POST /dispatch`

#### Scenario: 派发到新会话

- **WHEN** 用户填写期望产物并保持投递目标为「新会话」后提交
- **THEN** 请求体为 `{target:"new-session", task:{goal:<选题标题>, deliverable, profile, platform, notes}}`，成功后显示会话标识与「打开会话」

#### Scenario: 投递到既有会话

- **WHEN** 用户选择一个既有会话作为投递目标
- **THEN** 请求体带 `sessionId`，且 `target` 为 `current-session`

### Requirement: 画像可以新建并逐维度维护

画像区域 SHALL 支持新建画像（`POST /profiles`）与逐维度编辑（`PUT /profiles/:name/dimensions/:dimension`）。保存成功后 SHALL 回报写了哪个维度及其字节数；宿主拒绝时 SHALL 呈现可读错误。

#### Scenario: 新建画像

- **WHEN** 用户填写画像名称并提交
- **THEN** 发出 `POST /profiles`，成功后选中该画像

#### Scenario: 编辑单个维度

- **WHEN** 用户对某个维度点「编辑」、改动内容并保存
- **THEN** 发出 `PUT /profiles/<名称>/dimensions/<维度>`，请求体为 `{text}`，成功后就地显示「已保存 <维度>（<字节数> 字节）」
