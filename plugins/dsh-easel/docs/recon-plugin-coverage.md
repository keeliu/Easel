# dsh-easel 实现覆盖图（已实现 / 半实现 / 空壳）

只读勘察，**未改动任何实现文件**。除特别注明，路径均相对 `dsh-plugins/dsh-easel/`；
上游 Easel 检出相对 `_repo/` 列出。

判定口径（三档）：

- **已实现**：真的执行外部进程、或真的读写磁盘/宿主服务，结果带真实数据或真实错误。
- **半实现**：宿主半边通路存在且真实，但缺客户端入口，或缺一步（如只算命令不执行、只读文件不校验）。
- **空壳**：仅声明/仅展示/无通路；点了没反应，或永远返回同一份静态说明。

规模：宿主 21 个模块 + `lib/index.js` 共 6407 行，客户端 `src/client.js` 1556 行。

## 0 结论速览

| 功能 | 宿主 | 客户端 | 判定 |
|---|---|---|---|
| 运行时探测 / 自检 | `runtime.js`、`selfcheck.js` | Selfcheck 区域 | 已实现 |
| 画像六维度 | `data.js` + 6 条路由 | Profiles 区域 | 已实现（闭环） |
| 内容库读取/下载 | `data.js` + `GET /files` | Library 区域 | 已实现（只读） |
| 选题库 CRUD | `data.js` + 4 条路由 | Topics 只用到 2 条 | 半实现 |
| 账号登录态/校验/取数 | `accounts.js` | Accounts 只用到 verify | 半实现 |
| **扫码登录** | 只有 `loginPlan()` | **无按钮** | **空壳** |
| 发布执行 | `publish.js` + `gate.js` + `POST /publish/execute` | **发布区无表单/无入口** | **半实现（宿主已通）** |
| 热点 | `trends.js` 真联网 | Trends 区域 | 已实现（无缓存） |
| 排期 | `schedule.js` 转 DSH 排期 | Calendar 只读 | 半实现 |
| 派发任务 | `dispatch.js` 真建/恢复 agent | Topics→DispatchForm | 已实现 |
| 会话目录 | `sessions.js` | DispatchForm 下拉 | 已实现（尽力） |
| 数据分析 | 无独立服务 | Analytics 复用 overview+history | 半实现 |
| 发布门禁守卫 | `tools.js` + `lib/index.js:104` | — | 已实现 |

## 1 宿主逐文件：导出 / 行为 / 判定

### lib/index.js（228 行）
- `name/VERSION/inject=[]/Config/apply`；`PACKAGE_ROOT`（:64）。`inject` 故意为空——任一宿主能力缺失时面板仍要能打开（`services.js:1-21` 解释：写进静态 `inject` 会让 fiber 永久 INACTIVE）。
- `resolvePython()`（:111-118）复用 `probeRuntime`，自检与账号验证共用一条候选链。
- 服务装配（:119-128）：`trends=createTrendsService({})` 是唯一传空 deps 的——因此必然走 `globalThis.fetch`，**真联网**。
- 挂载（:130-227）：`ctx.inject(["webServer"])` 注册前缀路由、`ctx.inject(["tools"])` 调 `tools.guard(createPublishGuard())`、`ctx.inject(["agentPresets"])` 注册 `easel` preset（失败仅 warn）、`ctx.provide("easel", service)`。
- 风险：`runtime.easelRoot === undefined` 只 warn（:196 附近），此时画像/选题/产物全空但面板照常打开。

### lib/host/services.js（39 行）
- `serviceOf(ctx,name)`（:19）= `ctx.get(name)`，不要求 `inject`；`lazyService(ctx,name)`（:37）返回延迟解析器。
- 判定：已实现。风险：**服务当能力不当快照**是刻意设计，调用点若自行缓存一次 `ctx.get` 会重现已修复的「子进程服务不可用」误报。

### lib/host/config.js（305 行）
- `PANEL_ID`（:17）、`PROFILE_DIMENSIONS`（:20-27，identity/style/audience/platforms/preferences/memory）、`PROFILE_TEMPLATE_DIR="_template"`（:30）、`REGIONS` 十区域（:33-44）、`UPSTREAM_READ_ONLY_PREFIXES=["skills"]`（:50）、`MEDIA_EXTENSIONS`（:53-57）。
- `isEaselCheckout`（:60）/`isRepoRoot`（:74）/`detectRepoRoot`（:107）/`detectEaselRoot`（:146，优先 `<repoRoot>/_repo`）。
- `Config` schema（:168-209）：**没有任何「跳过安全扫描/放行命中项」开关**（:162-167 明示门禁必须强制）。
- `resolveLoginStateDir`（:220-224）：默认 `$DSH_HOME/dsh-easel/login`，**永远在仓库外**。
- `resolveRuntimeConfig`（:232-280）、`venvPython`（:293）、`runtimeFfmpeg`（:298）。
- 判定：已实现（纯函数）。

### lib/host/paths.js（133 行）
- `createPathPolicy({repoRoot,readOnlyPrefixes})`（:51）：`resolveInside` 断言路径在仓库内（:57-78，越界抛 `path-out-of-scope`）；`assertWritable`（:107-118）命中只读前缀即 `rejectUpstream` 记账并抛 `upstream-read-only`；`blockedWrites()`（:128）供自检展示。
- 判定：已实现。风险：策略绑定 `repoRoot` 而非 `easelRoot`；本机两者不同（见 §5 环境事实）时只读断言以 workspace 根为界。

### lib/host/errors.js（107 行）
- `EaselError`（:13）、`ERROR_CODES` 11 个稳定码（:28-40）、`attempt(run)`（:58）**同步返回结果对象、异步返回 Promise**——文档（:44-53）记录过「同步调用点忘了不 await，`r.ok` 恒 undefined，视图全空」的真实事故。
- 判定：已实现。

### lib/host/exec.js（127 行）
- `runCommand(subprocess,{argv,cwd,...})`（:46）：`service.spawn` + 超时 AbortController + collect 读取；服务缺失抛 `RUNTIME_MISSING`（:62），spawn 失败抛 `RUNTIME_MISSING`（:87），等待中断抛 `PUBLISH_FAILED`（:98）。`renderCommand`（:125）。
- 判定：已实现，**插件里唯一执行外部进程的地方**。

### lib/host/runtime.js（161 行）
- `PYTHON_NAMES`（:18）/版本化名（:25）/`FFMPEG_NAMES`（:33）；`isExecutable`（:39）；`pathCandidates`（:50）；`userBinDirs`→`~/.local/bin`（:64-66，注释记录「PATH 里没有 `~/.local/bin/python3.12` 会误判无 Python」）；`locateExecutable`（:81）；`probeRuntime`（:119-160）候选顺序 `runtime-venv → PATH → user-bin`，返回 `{python,ffmpeg,ready}`，探测版本失败不影响 ok。
- 判定：已实现（只探测，不安装）。

### lib/host/selfcheck.js（265 行）
- `createSelfcheckService({ctx,runtime,paths,probe}).run()`（:60-263）：条目 `python`/`ffmpeg`（:79-105，各带可操作 hint）、`repo`（:109）、`runtime-dir`（:123）、`skill-roots`（:149）、`login-state`（:167）、`capabilities`（:182-210，10 个布尔）、`upstream-read-only`（:212）、`catalog`（:231）、`model-routing`（:240）。
- 判定：已实现（纯读，永不抛错）。

### lib/host/brief.js（103 行）
- `BRIEF_HEADER`（:14）、`BRIEF_FIELDS`（:17）、`FORBIDDEN_REFERENCES` 三类（:24-34：会话标识/临时路径/未命名指代）、`inspectSelfContained`（:43）、`assertSelfContained`（:52）、`buildTaskBrief`（:74-102，含 5 条执行要求）。
- 判定：已实现（纯文本生成），是 dispatch 与 schedule 的共同前置校验。

### lib/host/persona.js（183 行）
- `EASEL_PRESET_ID="easel"`（:22）、`EASEL_SKILL_PROVIDER_NAME="easel-filesystem"`（:44，避免与全局 `filesystem` 提供方冲突）、`validateRules`（:67，四类必含/三类禁含）、`buildPresetDefinition`（:85-110）。
- 服务（:117-183）：`personaPath`/`rulesPath`/`loadPersona`/`loadRules`/`describe`/`preset()`，文本读不到抛 `NOT_FOUND`。人设**只生成 preset 定义、不自己挂载**（:4-8 解释作用域冲突）。
- 判定：已实现。

### lib/host/data.js（534 行）
- 契约（:1-19）：`profiles/<名>/<维度>.md` 纯 Markdown 无 frontmatter；`outputs/<主题>/.easel.json`；`outputs/_ideas.json` 顶层数组；`outputs/_schedule.json` 状态四值 + `kind`（**不是 `type`**）。
- 常量：`MAX_LISTED_FILES=500`、`INLINE_PREVIEW_MAX_BYTES=4MiB`、`MAX_TEXT_BYTES=256KiB`、`PROFILE_NAME_PATTERN`（:36）、`TOPIC_STATUSES`、`SCHEDULE_STATUSES`、`SCHEDULE_KINDS`、`MANIFEST_NAME`。
- `writeTextAtomic`（:146-152）：`assertWritable` → mkdir → 写 `<abs>.easel-tmp-<pid>-<ts>` → rename。`deliveryOf`（>4MiB 或非媒体 → download）。
- 方法：`listProfiles`（跳 `_`/`.` 开头目录，逐维度 stat）、`readProfile`（全缺抛 `NOT_FOUND`）、`createProfile`（已存在抛 `INVALID_INPUT`；从 `profiles/_template` 拷六维度，缺失回落 `# <dimension>\n`）、`writeProfileDimension`（维度白名单 + `resolveInside` + 原子写）、`listProjects`/`listProjectFiles`、`listTopics`/`addTopic`/`updateTopic`/`removeTopic`、`listSchedule`（**只读**，:453-458 注明写入归 DSH 排期）、`readText`/`writeText`/`removeFile`。
- 判定：已实现。风险：`readText`/`writeText`/`removeFile` **没有任何 HTTP 路由**（见 §1 web.js），是可达性为 0 的宿主方法。

### lib/host/accounts.js（496 行）
见 §2。

### lib/host/gate.js（229 行）· lib/host/publish.js（400 行）· lib/host/tools.js（116 行）
见 §4。

### lib/host/trends.js（218 行）
见 §5。

### lib/host/schedule.js（172 行）
- `EASEL_SCHEDULE_PREFIX="Easel｜"`；`buildScheduleRequest` 要求定时字段**恰好一个**（`after_seconds/at/every_seconds/daily/weekly/cron`），prompt 缺省用 `buildTaskBrief` 并过 `assertSelfContained`。
- 服务 `available/list/create/remove/update` 全部代理 `ctx.schedule`（`create` 必须给 `sessionId`；`update` 只改 title/prompt，**定时规则不在插件改**）；能力缺失抛 `NOT_CONFIGURED`。
- 判定：已实现（不自建调度器）。

### lib/host/dispatch.js（308 行）
- `mintSessionId` → `session-easel-<seed36>-<rand6>`；`DISPATCH_TARGETS`。
- 服务：`capabilities()`（6 布尔）、`defaultModel()`（只透传 provider/model，不覆盖推理强度）、`target()`、`dispatch(input)`（:227-304）：`new-session` → `agents.create({sessionId,agentOptions,meta})`；`current-session` → `agents.get` 有则复用、无则 `agents.resume`；随后 `handle.agent.followup(message)`；附件经 `attachments.saveFile`（≤64MiB）。
- 判定：已实现（真实建/恢复 agent）。

### lib/host/sessions.js（124 行）
- `SESSION_STORE_KEYS=["sessionStore","sessions"]`（:19，跨 DSH 版本运行时探测）；`createSessionCatalog().list()`（:66-122）先并入 `agents.roots()`（running:true），再并存储来源，返回 `{sessions,sources,reason}`；无来源时给可读 reason 而非空列表。
- 判定：已实现（尽力而为）。

### lib/host/scripts.js（212 行）
- 七平台描述符（:33-90）+ `buildGuardArgv`（:105）/`buildPersonaArgv`（:113）/`buildStatsArgv`（:121，与 accounts.js 重复实现）/`buildPublishArgv`（:158-211，按 `style` 分派 xhs/web/bili/wechat，末尾 `exec===true` 才追加 `--exec`，**永不追加 `--allow-unsafe`**）。
- 判定：已实现（只拼 argv 不执行）。风险：`buildStatsArgv` 与 `accounts.js:198-207` 是两套并行实现，平台新增时易漂移。

### lib/host/web.js（391 行）
- 路由注册（:222-352）逐条：`GET /config`（:222，回运行时路径 + `presetsAvailable`）；`GET /selfcheck`；`GET /persona`；`GET /overview`（:244，聚合自检 + profiles/projects/topics/schedule/accounts，逐项 `attempt`）；`GET /profiles`、`POST /profiles`（:278）、`GET /profiles/:name`、`PUT /profiles/:name/dimensions/:dimension`（:280）；`GET /projects`、`GET /projects/:topic`；`GET /topics`、`POST /topics`（:289 回 `{topic}`）、`PATCH /topics/:id`、`DELETE /topics/:id`；`GET /trends`（:293，读 `?ids=`）；`GET /accounts`、`GET /accounts/:id`、`GET /accounts/:id/stats`、`POST /accounts/:id/verify`、`POST /accounts/:id/login-plan`（:303）；`GET /publish/platforms`、`GET /publish/history`、`POST /publish/preview`（:311）、`POST /publish/execute`（:312）；`GET /schedule`、`POST /schedule`、`DELETE /schedule/:id`；`GET /sessions`；`POST /dispatch`；`GET /files`（:331）。
- `GET /files`（:331-352）经 `paths.resolveInside` 且 `repoRoot` 之外一律拒绝 → **无法服务登录二维码**（`loginStateDir` 在仓库外）。
- 缺失路由（相对宿主方法）：`DELETE /files`（`data.removeFile` 不可达）、`/text` 读写（`data.readText/writeText` 不可达）、`POST /accounts/:id/login`（登录启动）、`GET /accounts/:id/qr`（二维码）、`GET /accounts/:id/stats` 之外无 analytics 聚合。
- 判定：已实现（接口层）。

## 2 账号登录（`lib/host/accounts.js`）

- 常量：`LOGIN_STATES` 9 态（:22-31）、`ACCOUNT_STATES` 3 态（:34）、`ACCOUNT_STATS_PLATFORMS` 5 平台（:45-51）、`browserProfileRoot()`=`~/.easel-browser-profiles`（:40）。
- `ACCOUNT_PLATFORMS`（:62-150）七平台描述符，含 `login/credentials/stats/verify` 四组。登录命令：xiaohongshu `xhs_publish.py login`（:66）、douyin `douyin_publish.py login`（:78）、kuaishou/weixin-channels/zhihu `web_publisher.py login-qr --platform`（:87/:100/:113）、bilibili `bili_login.py login`（:125）、wechat-oa `weixin_mp_stats.py login`（:139，`timeoutSeconds=240`）。
- `buildLoginArgv`（:175-186）：`[python, script, loginCommand] (+ --platform) + --qr-out <loginStateDir>/<id>.png + --status-file <loginStateDir>/<id>.json + --timeout <180|240>`。
- `buildVerifyArgv`（:189-195）；`buildAccountStatsArgv`（:198-207，三形态 account-stats/bili-login/weixin-mp）；`extractJson`（:215）；`stateToAccountState`（:232，success→authorized、expired/error→unauthorized、进行中→unknown）。
- **`status(id)`/`statusAll()`（:287-337）：纯读文件推断，结果恒 `verified:false`。** 先找 `runtime.loginStateDir/<id>.json`，再找 `<easelRoot>/outputs/_login/<id>.json`（:279-285）；无状态文件则按凭据种类判：cookie-file 读 `cookies.json` 找 SESSDATA、credential-file 存在→unknown（注「有效性需要一次 whoami 校验」）、browser-profile 目录存在→unknown。
- `verify(id)`（:395-432）：**真跑 whoami**（`runCommand`，cwd=easelRoot），解析 JSON 的 `loggedIn/logged_in`；判不出则 `unknown + verified:false` + 「whoami 未给出可判定的登录结论（退出码 N）」。
- `loginPlan(id)`（:435-452）：**返回命令与路径，不执行**。返回 `{platform,label,argv,command,qrPath,statusFile,profileRoot,outsideRepo,note}`，note 明示「扫码授权必须由你本人在浏览器/手机上完成」。
- `stats(id)`（:457-489）：**真跑脚本**，非 0 退出或解析失败抛 `SOURCE_UNAVAILABLE`（details 带 command/stderr/stdout 前 2000 字符）；成功回 `{platform,label,command,fetchedAt,data}`，不缓存、失败不返回 0 值。
- `describeCredentials` 明示凭据位置与 `.gitignore` 证据（如 `.gitignore:60 — cookies.json`）、`insideRepo`、`gitIgnored`。

### 「扫码登录」是否实现了：**没有**

- 现状：`POST /accounts/:id/login-plan`（`web.js:303`）只回一条要用户自己到终端跑的命令；插件**不启动登录进程、不产出二维码、不轮询登录态**。二维码文件要等用户自己跑完脚本才可能出现，而面板也没有任何地方能显示它。
- 缺口具体是四件事，且**四件的上游能力都已存在**：
  1. 启动端点：`accounts.loginPlan()` 已经算出可直接执行的 `argv`（`accounts.js:175-186`），只差一个 `POST /accounts/:id/login` 去 `runCommand` 它（建议异步 spawn + 记录 pid，避免 180s 超时占满请求）。
  2. 状态轮询：脚本本就写 `--status-file`（`xhs_publish.py:1032-1033`、`douyin_publish.py:1467-1468`、`web_publisher.py:1451-1452`、`bili_login.py:312-313`、`weixin_mp_stats.py:769`）；`_repo/skills/shared/scripts/login_state.py:42/60` 已有 `write_status`/`read_status`。`accounts.status()` 已会读这些文件，缺的是「运行中态」的端点与前端轮询。
  3. 二维码图片：`GET /files` 受 `resolveInside(repoRoot)` 限制（`web.js:336`），而二维码写在 `loginStateDir`（仓库外）→ 必须新增一条只允许 `runtime.loginStateDir` 内 `.png` 的受限路由。
  4. 客户端：`src/client.js` 全文**零处** `login`/`qr` 字样；locale 只有 `accounts.verify`（`locale/zh-CN.json:49`）与 `accounts.emptyHint`（:121），没有二维码/等待扫描/重新登录任何词条。
- 可直接复用的参照实现：`_repo/web/app.py:3362-3433`（`POST /api/login/{platform}` 启动 + `GET /api/login/{platform}/status` 轮询 + `_login_status()` 回 `qr`/`qrTs`）+ `_repo/web/app.py:3277-3282` 的同格式登录标记回写。

## 3 画像（`lib/host/data.js` + 客户端）

- 六维度由 `config.js:20-27` 定死；模板目录 `profiles/_template`。
- 宿主闭环：`listProfiles` → `createProfile`（:327 附近，拷模板）→ `readProfile` → `writeProfileDimension`（维度白名单 + `resolveInside` + 原子写）。
- 客户端闭环：`ProfilesRegion`（`src/client.js:617-703`）`POST /profiles` 新建 → 左侧列表点选 → `ProfileDetail`（`src/client.js:504-615`）逐维度「编辑 → textarea → 保存」`PUT /profiles/:name/dimensions/:dimension`（`src/client.js:520-524`），保存成功 `state.reload()` 并显示 `profiles.saved`；失败显示错误行（:543）。**新建/编辑/维度写回三条都是真的，闭环完整。**
- 判定：已实现。缺：删除画像、重命名、维度模板编辑（宿主也没有对应方法，不算空壳）。
- 本机数据：`_repo/profiles/` 仅 `_template` 与 `乌鸦君学AI`。

## 4 发布（`publish.js` + `gate.js` + `tools.js` + `web.js`）

- `gate.scan`（`gate.js:117-144`）：**真跑** `content_guard.py scan`，无 `--text/--file` 抛 `INVALID_INPUT`；`assertSafe`（:151-178）命中即抛 `CONTENT_GUARD_BLOCKED`（退出码 7），非 7 的异常退出抛 `SOURCE_UNAVAILABLE`；`scorePersona`（:185-226）真跑 `persona_gate.py`，**永不阻断**。**无 allowUnsafe 入参。**
- `tools.inspectCommand`（`tools.js:68-99`）：`--allow-unsafe` 先判（:80 附近，「防 `content_guard.py --allow-unsafe` 漏网」）→ 安全脚本放行 → 发布脚本 + `--exec` 判 `direct-publish`；`createPublishGuard`（:107-115）挂在 `bash/pwsh` 上真实拦截。
- `publish.preview`（`publish.js:192-253`）：校验平台 + python，拼 `exec:false` 的 argv（**不追加 `--exec`**），算长度 warning，跑 `gate.scan`，**不执行任何命令**。
- `publish.publish`（`publish.js:261-361`）：`gate.assertSafe` 先拦（命中则命令一次都不执行）→ 纵深防御断言 argv 无 `--allow-unsafe` → `runCommand` **真执行** → 结果 append 到 `outputs/_publish.log`（`assertWritable`；写日志失败只记 `logError`，不吞发布结果）→ 返回 `exitCode/signal/timedOut/ok/reason/stdoutTail/stderrTail/guard/attribution{outcome,note}`。
- `listPlatforms()` 回七平台 id/label/accepts/limits/script；`history(limit)`（:341 附近）读 `_publish.log` 尾部 ≤256KiB 宽容解析（`parsePublishLog:74-111`），`readbackOf`（:114）按 `READBACK_MARKERS` 顺序识别 `login_required/readback_error/unverified/verified`。
- **「真正把内容发到平台」这条路当前是否存在：宿主存在且已接通**（`web.js:312` → `publish.publish` → 仓库既有脚本 + `--exec`；脚本侧 `xhs_publish.py:1022`、`douyin_publish.py:1455`、`web_publisher.py:1458` 都有 `--exec` 真发布开关）。**但客户端没有入口**：`PublishRegion`（`src/client.js:787-830`）只渲染平台表和发布历史，既无表单也无预览/执行按钮；客户端全文没有 `publish/preview`、`publish/execute` 调用。所以用户在面板上**无法发起任何发布**。
- 可用性前置：Python 运行时（本机仅 venv 内）与各平台登录态；无 `--exec` 时脚本默认 dry-run。

## 5 热点（`trends.js` + `web.js`）

- 来源：六源主/备（`trends.js:18-55`）：weibo、douyin、zhihu、bilibili、baidu、toutiao，主源为 `60s.viki.moe/v2/*`，备份为 `v2.xxapi.cn/api/*`（zhihu/toutiao 无备源）。
- 抓取：`createTrendsService({})`（`trends.js:107`）取 `globalThis.fetch`；`AbortController` 12s 超时（`TREND_TIMEOUT_MS`）；`parseTrendPayload`（:69-100）兼容顶层数组/`data/list/result` 四层形状，字段取 `title??name??word??query`、`hot??hotValue??…`、`url??link??…`；解析不出返回 `[]` 不猜。
- `readSource` 主源失败自动降级备源并标 `degraded`；`read({ids})` 回 `{ok,fetchedAt,sources,items,failures,note}`，**全失败时 `ok:false` + failures + note，绝不返回编造条目**。
- `GET /trends`（`web.js:293-296`）读 `?ids=`（逗号分隔）转 `trends.read({ids})`；**客户端从不传 ids**（`src/client.js:1121` 固定 `useEndpoint(api, "/trends")`），故源选择 UI 不存在。
- 判定：已实现（真联网、无缓存、无落盘）。风险：每次进区域即打 6 个第三方域名，失败只体现在 `failures`；无缓存意味着离线环境永远空。

## 6 客户端十个 Region 的依赖与真实度

`src/client.js` 的 `REGIONS`（:46-57）与 `REGION_VIEWS`（:1271-1282）一一对应。统一取数 `createApi`（:202-231，只认 `{ok:true}`；空体 404 判为宿主未挂载）+ `useEndpoint`（:262-278）。

| Region | 宿主接口 | 可改数据 | 判定 |
|---|---|---|---|
| Overview（:413-438） | `GET /overview` | 否 | 纯展示 |
| Accounts（:440-497） | `GET /accounts`、`POST /accounts/:id/verify` | **仅 verify 真执行** | 半实现（无扫码/无 stats 入口） |
| Profiles（:617-703 + :504-615） | `GET/POST /profiles`、`GET /profiles/:name`、`PUT /profiles/:name/dimensions/:dimension` | 是（新建 + 维度写回） | 已实现 |
| Library（:733-771 + :705-731） | `GET /projects`、`GET /projects/:topic`、`GET /files?download=1`（下载用 `<a href>`，:716） | 否（只读 + 下载） | 半实现（无上传/删除入口） |
| Publish（:787-830） | `GET /publish/platforms`、`GET /publish/history?limit=20` | **否** | **空壳展示**（宿主 preview/execute 无入口） |
| Calendar（:832-871） | `GET /schedule`（+ `openSession`） | 否 | 半实现（宿主有 POST/DELETE，无 UI） |
| Topics（:1034-1117 + DispatchForm :881-1032） | `GET/POST /topics`、`GET /sessions`、`POST /dispatch` | 是（新增选题 + **真派发建会话**） | 已实现（编辑/删除无 UI：`PATCH`/`DELETE /topics/:id` 未用） |
| Trends（:1119-1164） | `GET /trends`（不传 ids） | 否 | 已实现（只读） |
| Analytics（:1166-1208） | `GET /overview`、`GET /publish/history?limit=50` | 否 | 半实现（成功率为本地区间统计；账号 stats 未接入） |
| Selfcheck（:1210-1265） | `GET /selfcheck` | 否 | 已实现（只读） |

- 结构件：`Boundary`（:348-388，`SlotAssemblyError` 原样上抛）、`mountSlot`（:1442-1447，等槽位声明）、`selectPanel`（:1480，可选 `layout`）、`openSession`（:1492，可选 `uiWorkspace`）——三者取不到时分别降级为「返回无动作」「打开无动作」，不崩面板。
- `AccountsRegion` 的 `verify`（:447-457）是真动作；账号 `stats` 路由虽在（`web.js:301`），客户端零调用。
- 所有 `data-easel-*` 属性是测试钩子（如 `data-easel-verify`、`data-easel-profile-save`、`data-easel-dispatch-submit`）。

## 7 要让四个功能真正可用，必须补的清单

### A. 扫码登录（当前最接近「空壳」）
1. `POST /accounts/:id/login` → 异步 `runCommand(buildLoginArgv(...))`，返回 `{started,qrPath,statusFile,pid?}`。宿主接口：`accounts.js:175-186` 的 argv **已可执行**，`exec.js:46` 已可用；缺路由与并发/超时处理。
2. `GET /accounts/:id/login-status` → 读 `--status-file`（`login_state.py:60` 同格式），把 9 态推给前端。宿主 `accounts.js:279-285` 已会定位该文件。
3. `GET /accounts/:id/qr` → 仅允许 `runtime.loginStateDir` 内 `.png` 的受限读取。**必须新写**（`GET /files` 的 `resolveInside` 到不了仓库外，`web.js:336`）。
4. 客户端：Accounts 行加「扫码登录/查看二维码/重试」按钮 + 2s 轮询 + 二维码 `<img>`；`locale/zh-CN.json`、`locale/en.json` 补词条。参照 `_repo/web/app.py:3362-3433`。

### B. 发布（宿主已通，只缺 UI）
5. `PublishRegion` 加表单（平台/标题/正文/标签/媒体路径）+「预览」调 `POST /publish/preview` +「发布」调 `POST /publish/execute`，并展示 `guard.findings`、`attribution.outcome`、`stdoutTail`。宿主全通（`web.js:311-312`、`publish.js:192-361`），**无需新宿主接口**。
6. 发布前的本地校验对齐 `publish.js` 的长度 warning 与 `PLATFORMS.limits`（`scripts.js:33-90`），否则用户要先撞一次脚本报错。
7. 明确提示 `ok:false` 的成因（登录态 vs 平台拒绝 vs 超时）——`publish.js` 的 `reason`/`attribution` 已经区分，客户端只需如实渲染。

### C. 画像（已闭环，只差运维性）
8. 删除/重命名画像：需新宿主方法（`data.js` 只有 `createProfile`/`writeProfileDimension`），并复用 `assertWritable` 防误删模板目录。
9. 维度模板编辑：需新增 `_template` 写入口（当前 `_template` 只在 `createProfile` 时被读）。

### D. 热点（够用，差可控性）
10. 客户端把源选择接到 `GET /trends?ids=`（宿主与 `sources()` 已支持，`web.js:293`、`trends.js:107` 之后）。
11. 一键「存为选题」：`POST /topics`（`web.js:289`）已在，只需传 `{title,note,source,status}`（`data.js` `addTopic` 已支持这些字段）。
12. 可选：加 TTL 内存缓存，避免每进区域即打 6 个第三方域名（当前**无任何缓存**）。

### 复用性小结
- **已有宿主接口可直接用**：`/publish/preview`、`/publish/execute`、`/publish/history`、`POST /topics`、`PATCH|DELETE /topics/:id`、`POST|DELETE /schedule`、`GET /accounts/:id/stats`、`GET /trends?ids=`、`GET /sessions`、`POST /dispatch`。
- **已有脚本可复用的**：登录（五个 `--qr-out/--status-file` 脚本 + `login_state.py`）、发布（脚本侧 `--exec` 真开关）、门禁（`content_guard.py` exit 7）、人设（`persona_gate.py`）、账号数据（`account_stats.py fetch`）。
- **必须新写的宿主接口**：`POST /accounts/:id/login`、`GET /accounts/:id/login-status`、`GET /accounts/:id/qr`；以及被 `data.js` 实现却无路由的 `DELETE /files`（`removeFile`）与文本读写路由。

## 8 环境事实（本次勘察实测）

- `python3`/`python` **不在 PATH**；仅存在 `dsh-plugins/dsh-easel/.runtime/venv/bin/python` → `probeRuntime` 走 `runtime-venv` 候选，python 判定为 ok；ffmpeg 未验证。
- 数据根解析结果 `_repo`（`/data/dsh/home/dsh-hub/Easel/_repo`）：`profiles/` 有 `_template`、`乌鸦君学AI`；`outputs/` 只有 `_ideas.json`（无项目目录、无 `_schedule.json`、无 `_publish.log`）。
- `loginStateDir` 默认 `~/.dsh/dsh-easel/login`，**目录尚不存在**（登录从未在本机启动过，与 §2 结论一致）。
- 上游脚本确实存在且 CLI 与描述符匹配：`xhs_publish.py`、`douyin_publish.py`、`web_publisher.py`、`account_stats.py`、`content_guard.py`、`persona_gate.py`、`bili_login.py`、`weixin_mp_stats.py`（位于 `_repo/skills/shared/scripts/`，非 `skill-wechat-publisher/scripts/`）。
