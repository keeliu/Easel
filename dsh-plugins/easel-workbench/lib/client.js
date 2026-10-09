/* 本文件由 scripts/build-client.mjs 从 src/client.js 与 locale/*.json 生成 —— 不要手改。
 * 重新生成：node scripts/build-client.mjs
 */
/**
 * 自媒体工作台 —— 客户端半边（浏览器侧 UI）。
 *
 * 设计取舍（都是「为什么」，不是「做了什么」）：
 *
 * - 手写、无构建期依赖。运行时的 `require()` 只有一张 9 项的静态表，任何 DSH 客户端
 *   包、任何打包器（esbuild / rollup / vite）都会让这份产物在加载期直接失败；因此这里
 *   也**不用 JSX**——用 JSX 就得引 `react/jsx-runtime` 之外的转译环节。只用 `react`。
 * - 浏览器取不到 `lib/host/**`（那是 Host 进程的 ESM），所以 `PANEL_ID`、`API_PREFIX`、
 *   `REGIONS` 在这份源码里各留一份；一致性交给 `test/client.test.mjs` 对着宿主模块断言，
 *   而不是让构建脚本去 `import` 宿主（那会把 schemastery 拉进构建链，且构建产物会随
 *   宿主内部实现漂移）。
 * - 文案一律走 locale：字典由 `scripts/build-client.mjs` 从 `locale/*.json` 内联到下面
 *   那行标记处，`locale/*.json` 仍是唯一事实源；`ctx.locale.bind()` 的取词函数在调用时
 *   读取当前语言，所以语言切换无需重建组件。
 * - 静态 `inject` 只声明 `["slots", "locale"]`：cordis 的 fiber 只要有一个静态依赖在
 *   当前 profile 里不存在就会永久停在 INACTIVE，插件再也不会激活。`layout` 是可选的，
 *   所以用 `ctx.get("layout")` 现取，取不到就退化成「返回对话」按钮无动作而不是崩掉。
 */

window.__ModuleLoader__.load({
  id: "easel-workbench",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    // 构建脚本把本行替换为从 locale/zh-CN.json、locale/en.json 生成的内联字典。
    // 浏览器侧只有 zh / en 两个内置 locale id，`zh-CN` 不是其中之一。
    var DICT_ZH = {
      "accounts.emptyHint": "这里列出七个平台的登录态：未授权的条目点「验证」看授权指引，点「扫码登录」可以直接在面板里扫二维码。",
      "accounts.verify": "验证",
      "analytics.emptyHint": "还没有发布记录：用「发布」把产物发到平台后，这里会汇总成功与失败。",
      "analytics.records": "发布记录",
      "analytics.succeeded": "成功发布",
      "analytics.successRate": "成功率",
      "boundary.detail": "错误信息：{message}",
      "boundary.title": "这个区域暂时不可用",
      "common.cancel": "取消",
      "common.clauseSeparator": "；",
      "common.close": "关闭",
      "common.confirm": "确认",
      "common.create": "新建",
      "common.delete": "删除",
      "common.empty": "暂无内容",
      "common.listSeparator": "、",
      "common.loading": "正在加载…",
      "common.notConfigured": "尚未配置",
      "common.open": "打开",
      "common.refresh": "刷新",
      "common.retry": "重试",
      "common.save": "保存",
      "common.unknown": "未知",
      "dispatch.close": "收起",
      "dispatch.deliverable": "期望产物（必填）",
      "dispatch.deliverablePlaceholder": "例如：一篇 800 字小红书图文，含 3 张配图",
      "dispatch.deliverableRequired": "请先写清期望产物：任务说明里这是必填项。",
      "dispatch.done": "已派发到会话 {session}。",
      "dispatch.idle": "已休眠",
      "dispatch.newSession": "新会话",
      "dispatch.notes": "补充说明（可选）",
      "dispatch.openSession": "打开会话",
      "dispatch.platform": "目标平台（可选）",
      "dispatch.profile": "目标画像（可选）",
      "dispatch.running": "运行中",
      "dispatch.sending": "派发中…",
      "dispatch.sessionsUnavailable": "暂时列不出既有会话，只能派发到新会话。",
      "dispatch.submit": "派发",
      "dispatch.target": "投递到",
      "error.hostNotMounted": "宿主服务未挂载：请重载或重启 DSH 后重试。",
      "library.download": "下载",
      "library.emptyFiles": "这个主题下还没有产物：在「选题」里派发任务，或让会话把结果写进 outputs/<主题>/。",
      "library.emptyHint": "内容库列出 outputs/<主题>/ 下的产物；把一条选题派发到会话并产出后，就会出现在这里。",
      "library.pickProject": "在左侧选一个主题，查看它下面的文件。",
      "login.cancel": "取消登录",
      "login.note": "二维码由仓库里既有的登录脚本产出、由你自己扫；插件不读取也不保存任何凭据。",
      "login.open": "扫码登录",
      "login.qrAlt": "登录二维码",
      "login.refresh": "刷新状态",
      "login.running": "登录中…",
      "login.smsPlaceholder": "短信验证码",
      "login.smsSent": "验证码已提交，等待脚本确认。",
      "login.smsSubmit": "提交验证码",
      "login.start": "开始扫码登录",
      "nav.accounts": "账号",
      "nav.analytics": "数据",
      "nav.calendar": "日历",
      "nav.library": "内容库",
      "nav.overview": "总览",
      "nav.profiles": "画像",
      "nav.publish": "发布",
      "nav.selfcheck": "环境自检",
      "nav.topics": "选题",
      "nav.trends": "热点",
      "overview.accounts": "已登录账号",
      "overview.artifacts": "内容产物",
      "overview.profiles": "画像",
      "overview.runtime": "运行时",
      "overview.scheduled": "已排期",
      "overview.topics": "选题",
      "panel.back": "返回对话",
      "panel.ready": "面板已就绪",
      "panel.region.current": "当前区域",
      "panel.regions": "工作台区域",
      "panel.subtitle": "账号、画像、内容与发布集中在一个面板里",
      "panel.title": "自媒体工作台",
      "profiles.cancel": "取消",
      "profiles.create": "新建画像",
      "profiles.createPlaceholder": "画像名称，例如 my-brand",
      "profiles.edit": "编辑",
      "profiles.emptyHint": "画像存在数据根的 profiles/<名称>/ 下；在上面填个名字点「新建画像」就会从 _template 复制六个维度。",
      "profiles.pickProfile": "在左侧选一个画像，就能逐维度查看和编辑。",
      "profiles.save": "保存",
      "profiles.saved": "已保存 {dimension}（{bytes} 字节）。",
      "publish.articleFile": "正文文件",
      "publish.body": "正文",
      "publish.compose": "发布一件作品",
      "publish.confirm": "我已核对预览，确认要真实发布",
      "publish.confirmFirst": "发布前请先勾选确认。",
      "publish.execute": "立即发布",
      "publish.exitCode": "退出码 {code}",
      "publish.failure": "失败",
      "publish.guardBlocked": "内容门禁拦下了这段文本，命令一次都没有执行。",
      "publish.guardClear": "内容门禁通过。",
      "publish.history": "发布记录",
      "publish.mediaFile": "素材文件",
      "publish.pickFileOption": "选择文件（可选）",
      "publish.pickPlatform": "请先选择平台。",
      "publish.pickPlatformOption": "选择平台",
      "publish.pickTopicOption": "选择主题（可选）",
      "publish.platform": "平台",
      "publish.platforms": "发布平台",
      "publish.preview": "预览",
      "publish.success": "成功",
      "publish.tags": "标签",
      "publish.tagsPlaceholder": "逗号分隔，例如 AI,笔记",
      "publish.title": "标题",
      "publish.titleRequired": "发布必须有标题。",
      "publish.topic": "内容主题",
      "schedule.emptyHint": "日历读取 DSH 的排期与工作台登记的日程；派发任务或登记排期后会出现在这里。",
      "schedule.openSession": "打开会话",
      "selfcheck.blockedWrites": "被拒绝的越界写入：{count}",
      "selfcheck.ffmpeg": "ffmpeg",
      "selfcheck.missing": "缺失",
      "selfcheck.ok": "正常",
      "selfcheck.python": "Python 运行时",
      "selfcheck.repoRoot": "Easel 仓库",
      "selfcheck.skillDirs": "技能目录",
      "selfcheck.summaryDegraded": "降级：{items}",
      "selfcheck.summaryMissing": "缺失：{items}",
      "selfcheck.summaryOk": "全部就绪",
      "selfcheck.title": "环境自检",
      "selfcheck.upstreamReadOnly": "上游只读",
      "topics.add": "新增选题",
      "topics.dispatch": "派发",
      "topics.emptyHint": "选题是派发的起点：在上面写一句话就能加一条，然后点右侧「派发」把它变成一个会话里的任务。",
      "topics.title": "选题标题",
      "trends.emptyHint": "热点来自上游技能的联网抓取：来源不可达或未配置时就是空的，可以点「重试」。",
      "trends.fetchedAt": "抓取时间",
      "trends.save": "存为选题",
      "trends.saved": "已存进选题库",
      "trends.source.baidu": "百度",
      "trends.source.bilibili": "B站",
      "trends.source.douyin": "抖音",
      "trends.source.toutiao": "今日头条",
      "trends.source.weibo": "微博",
      "trends.source.zhihu": "知乎",
      "value.audio": "音频",
      "value.authorized": "已授权",
      "value.content": "内容",
      "value.degraded": "降级",
      "value.doing": "进行中",
      "value.done": "已完成",
      "value.draft": "草稿",
      "value.error": "出错",
      "value.event": "事件",
      "value.expired": "已过期",
      "value.idea": "选题",
      "value.image": "图文",
      "value.invalid": "失效",
      "value.live": "直播",
      "value.missing": "缺失",
      "value.ok": "正常",
      "value.pending": "待处理",
      "value.published": "已发布",
      "value.qr_ready": "待扫码",
      "value.scanned": "已扫码",
      "value.scheduled": "已排期",
      "value.sms_required": "待短信码",
      "value.starting": "启动中",
      "value.success": "已成功",
      "value.text": "文字",
      "value.unauthorized": "未授权",
      "value.unknown": "未知",
      "value.valid": "有效",
      "value.verifying": "确认中",
      "value.video": "视频",
    };
    var DICT_EN = {
      "accounts.emptyHint": "These are the seven platform sessions: use Verify for the authorization hint, or QR sign-in to scan a code right in this panel.",
      "accounts.verify": "Verify",
      "analytics.emptyHint": "No publish records yet: once artifacts are published to a platform, this sums up successes and failures.",
      "analytics.records": "Records",
      "analytics.succeeded": "Succeeded",
      "analytics.successRate": "Success rate",
      "boundary.detail": "Error: {message}",
      "boundary.title": "This section is unavailable",
      "common.cancel": "Cancel",
      "common.clauseSeparator": "; ",
      "common.close": "Close",
      "common.confirm": "Confirm",
      "common.create": "New",
      "common.delete": "Delete",
      "common.empty": "Nothing here yet",
      "common.listSeparator": ", ",
      "common.loading": "Loading…",
      "common.notConfigured": "Not configured",
      "common.open": "Open",
      "common.refresh": "Refresh",
      "common.retry": "Retry",
      "common.save": "Save",
      "common.unknown": "Unknown",
      "dispatch.close": "Collapse",
      "dispatch.deliverable": "Expected deliverable (required)",
      "dispatch.deliverablePlaceholder": "e.g. an 800-word Xiaohongshu post with 3 images",
      "dispatch.deliverableRequired": "Describe the expected deliverable first — the task brief requires it.",
      "dispatch.done": "Dispatched to session {session}.",
      "dispatch.idle": "idle",
      "dispatch.newSession": "New session",
      "dispatch.notes": "Notes (optional)",
      "dispatch.openSession": "Open session",
      "dispatch.platform": "Target platform (optional)",
      "dispatch.profile": "Target persona (optional)",
      "dispatch.running": "running",
      "dispatch.sending": "Dispatching…",
      "dispatch.sessionsUnavailable": "Existing sessions cannot be listed right now, so only a new session can be used.",
      "dispatch.submit": "Dispatch",
      "dispatch.target": "Deliver to",
      "error.hostNotMounted": "Host service is not mounted: reload or restart DSH, then retry.",
      "library.download": "Download",
      "library.emptyFiles": "No artifacts under this topic yet: dispatch a task from Topics, or have a session write results into outputs/<topic>/.",
      "library.emptyHint": "The library lists artifacts under outputs/<topic>/; dispatch a topic to a session and they will show up here.",
      "library.pickProject": "Pick a topic on the left to see its files.",
      "login.cancel": "Cancel sign-in",
      "login.note": "The QR code comes from the existing scripts in the repo and only you scan it; the plugin never reads or stores your credentials.",
      "login.open": "QR sign-in",
      "login.qrAlt": "Sign-in QR code",
      "login.refresh": "Refresh status",
      "login.running": "Signing in…",
      "login.smsPlaceholder": "SMS code",
      "login.smsSent": "Code submitted, waiting for the script to confirm.",
      "login.smsSubmit": "Submit code",
      "login.start": "Start sign-in",
      "nav.accounts": "Accounts",
      "nav.analytics": "Analytics",
      "nav.calendar": "Calendar",
      "nav.library": "Library",
      "nav.overview": "Overview",
      "nav.profiles": "Personas",
      "nav.publish": "Publishing",
      "nav.selfcheck": "Environment",
      "nav.topics": "Topics",
      "nav.trends": "Trends",
      "overview.accounts": "Signed-in accounts",
      "overview.artifacts": "Content artifacts",
      "overview.profiles": "Personas",
      "overview.runtime": "Runtime",
      "overview.scheduled": "Scheduled",
      "overview.topics": "Topics",
      "panel.back": "Back to conversation",
      "panel.ready": "Panel ready",
      "panel.region.current": "Current section",
      "panel.regions": "Workbench sections",
      "panel.subtitle": "Accounts, personas, content and publishing in one panel",
      "panel.title": "Creator Workbench",
      "profiles.cancel": "Cancel",
      "profiles.create": "New persona",
      "profiles.createPlaceholder": "Persona name, e.g. my-brand",
      "profiles.edit": "Edit",
      "profiles.emptyHint": "Personas live under profiles/<name>/ in the data root; enter a name above and create one to copy the six dimensions from _template.",
      "profiles.pickProfile": "Pick a persona on the left to view and edit its dimensions.",
      "profiles.save": "Save",
      "profiles.saved": "Saved {dimension} ({bytes} bytes).",
      "publish.articleFile": "Body file",
      "publish.body": "Text",
      "publish.compose": "Publish a work",
      "publish.confirm": "I checked the preview and want to publish for real",
      "publish.confirmFirst": "Tick the confirmation box before publishing.",
      "publish.execute": "Publish now",
      "publish.exitCode": "Exit code {code}",
      "publish.failure": "Failed",
      "publish.guardBlocked": "The content guard blocked this text; the command never ran.",
      "publish.guardClear": "Content guard passed.",
      "publish.history": "Publish history",
      "publish.mediaFile": "Asset file",
      "publish.pickFileOption": "Choose a file (optional)",
      "publish.pickPlatform": "Choose a platform first.",
      "publish.pickPlatformOption": "Choose a platform",
      "publish.pickTopicOption": "Choose a project (optional)",
      "publish.platform": "Platform",
      "publish.platforms": "Publish platforms",
      "publish.preview": "Preview",
      "publish.success": "Success",
      "publish.tags": "Tags",
      "publish.tagsPlaceholder": "Comma separated, e.g. AI,notes",
      "publish.title": "Title",
      "publish.titleRequired": "A title is required.",
      "publish.topic": "Content project",
      "schedule.emptyHint": "The calendar reads DSH schedules and workbench entries; dispatch a task or add a schedule and it will appear here.",
      "schedule.openSession": "Open session",
      "selfcheck.blockedWrites": "Rejected out-of-scope writes: {count}",
      "selfcheck.ffmpeg": "ffmpeg",
      "selfcheck.missing": "Missing",
      "selfcheck.ok": "OK",
      "selfcheck.python": "Python runtime",
      "selfcheck.repoRoot": "Easel repository",
      "selfcheck.skillDirs": "Skill directories",
      "selfcheck.summaryDegraded": "Degraded: {items}",
      "selfcheck.summaryMissing": "Missing: {items}",
      "selfcheck.summaryOk": "All checks passed",
      "selfcheck.title": "Environment check",
      "selfcheck.upstreamReadOnly": "Upstream read-only",
      "topics.add": "Add topic",
      "topics.dispatch": "Dispatch",
      "topics.emptyHint": "A topic is the starting point: type one above, then use “Dispatch” to turn it into a task in a session.",
      "topics.title": "Topic title",
      "trends.emptyHint": "Trends come from upstream skills fetching the web: they stay empty when sources are unreachable or unconfigured — try Retry.",
      "trends.fetchedAt": "Fetched at",
      "trends.save": "Save as topic",
      "trends.saved": "Saved to topics",
      "trends.source.baidu": "Baidu",
      "trends.source.bilibili": "Bilibili",
      "trends.source.douyin": "Douyin",
      "trends.source.toutiao": "Toutiao",
      "trends.source.weibo": "Weibo",
      "trends.source.zhihu": "Zhihu",
      "value.audio": "Audio",
      "value.authorized": "Authorized",
      "value.content": "Content",
      "value.degraded": "Degraded",
      "value.doing": "In progress",
      "value.done": "Done",
      "value.draft": "Draft",
      "value.error": "Failed",
      "value.event": "Event",
      "value.expired": "Expired",
      "value.idea": "Idea",
      "value.image": "Images",
      "value.invalid": "Invalid",
      "value.live": "Live",
      "value.missing": "Missing",
      "value.ok": "OK",
      "value.pending": "Pending",
      "value.published": "Published",
      "value.qr_ready": "Awaiting scan",
      "value.scanned": "Scanned",
      "value.scheduled": "Scheduled",
      "value.sms_required": "SMS code needed",
      "value.starting": "Starting",
      "value.success": "Succeeded",
      "value.text": "Text",
      "value.unauthorized": "Not authorized",
      "value.unknown": "Unknown",
      "value.valid": "Valid",
      "value.verifying": "Verifying",
      "value.video": "Video",
    };

    var NS = "easel-workbench";
    var PANEL_ID = "easel-workbench";
    var API_PREFIX = "/easel-workbench/api";

    /**
     * 侧边栏面板条目的排序值。列表按 order 升序渲染，「新会话」按钮在列表上方，
     * 所以越小越靠上；取 5 是为了插在既有条目（插件 0 / 排期 10）之间靠前的位置，
     * 又不与它们同值（同值要靠插入顺序决胜，那不稳定）。
     */
    var PANEL_ROW_ORDER = 5;

    /** 与 `lib/host/config.js` 的 `REGIONS` 同序同 id；`labelKey` 指向本插件的字典。 */
    var REGIONS = [
      { id: "overview", labelKey: "nav.overview" },
      { id: "accounts", labelKey: "nav.accounts" },
      { id: "profiles", labelKey: "nav.profiles" },
      { id: "library", labelKey: "nav.library" },
      { id: "publish", labelKey: "nav.publish" },
      { id: "calendar", labelKey: "nav.calendar" },
      { id: "topics", labelKey: "nav.topics" },
      { id: "trends", labelKey: "nav.trends" },
      { id: "analytics", labelKey: "nav.analytics" },
      { id: "selfcheck", labelKey: "nav.selfcheck" },
    ];

    /** 侧边栏字形：与包根 `icon.svg` 同一组 path，颜色靠 `currentColor` 跟随宿主。 */
    var GLYPH_PATHS = ["M12 3.5 5.5 20.5", "M12 3.5 18.5 20.5", "M8.4 12.5h7.2", "M7.2 16.5h9.6", "M4.6 20.5h14.8"];

    /**
     * 全部样式只用 DSH 主题令牌（`var(--dsw-alias-*)`），暗色由宿主在 body 上挂
     * `data-ds-dark-theme` 切换，插件侧不需要（也不允许）写死任何色值。
     */
    var CSS = [
      "[data-easel-panel]{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
      ".easel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".easel-title{margin:0;font-size:16px;font-weight:600}",
      ".easel-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".easel-nav{display:flex;flex-wrap:wrap;gap:6px;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".easel-nav-item{cursor:pointer;border:1px solid transparent;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;padding:4px 10px}",
      ".easel-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".easel-nav-item-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}",
      ".easel-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 24px}",
      ".easel-region{display:flex;flex-direction:column;gap:14px}",
      ".easel-split{display:flex;gap:16px;align-items:flex-start}",
      ".easel-list-side{width:230px;flex:none}",
      ".easel-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}",
      ".easel-row{display:flex;align-items:center;gap:10px;justify-content:space-between;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}",
      ".easel-row-main{display:flex;flex-direction:column;gap:2px;min-width:0}",
      ".easel-row-title{overflow-wrap:anywhere}",
      ".easel-muted{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".easel-path{overflow-wrap:anywhere}",
      ".easel-hint{padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}",
      ".easel-kv{margin:0;display:flex;flex-direction:column;gap:4px}",
      ".easel-kv-row{display:flex;gap:10px}",
      ".easel-kv-key{margin:0;min-width:120px;color:var(--dsw-alias-label-secondary)}",
      ".easel-kv-value{margin:0;overflow-wrap:anywhere}",
      ".easel-section-title{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
      ".easel-button{cursor:pointer;font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);padding:4px 12px;text-decoration:none;display:inline-flex;align-items:center}",
      ".easel-button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".easel-button:disabled{opacity:.6;cursor:default}",
      ".easel-input{font:inherit;min-width:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:4px 10px}",
      ".easel-form{display:flex;gap:8px;align-items:center;margin-bottom:12px}",
      ".easel-tag{display:inline-flex;align-items:center;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);padding:0 6px;font-size:12px}",
      ".easel-tags{flex-direction:row;flex-wrap:wrap}",
      ".easel-state-ok,.easel-state-valid,.easel-state-active{color:var(--dsw-alias-state-success-primary)}",
      ".easel-state-missing,.easel-state-invalid,.easel-state-expired,.easel-state-failed{color:var(--dsw-alias-state-error-primary)}",
      ".easel-state-degraded,.easel-state-unknown,.easel-state-pending{color:var(--dsw-alias-state-warn-primary)}",
      ".easel-boundary{border:1px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md);padding:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
      ".easel-boundary-title{margin:0;font-weight:600}",
      ".easel-boundary-detail{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
      ".easel-error-text{margin:0;color:var(--dsw-alias-state-error-primary)}",
      ".easel-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:13px}",
      ".easel-empty{display:flex;flex-direction:column;gap:4px}",
      ".easel-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".easel-row-block{flex-wrap:wrap;align-items:flex-start}",
      ".easel-form-column{flex-direction:column;align-items:stretch;gap:8px;margin-bottom:0}",
      ".easel-field{display:flex;flex-direction:column;gap:4px}",
      ".easel-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".easel-dispatch{display:flex;flex-direction:column;gap:8px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px;background:var(--dsw-alias-bg-base)}",
      ".easel-textarea{font:inherit;min-height:140px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:8px 10px}",
      ".easel-login{display:flex;flex-direction:column;gap:8px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px;background:var(--dsw-alias-bg-base)}",
      ".easel-qr{width:200px;height:200px;image-rendering:pixelated;align-self:flex-start;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}",
      ".easel-check{display:flex;flex-direction:row;align-items:center;gap:6px}",
      ".easel-preview{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}",
    ].join("");

    // ------------------------------------------------------------------ 工具

    /**
     * 宿主用 `SlotAssemblyError` 表示「Slot 装配失败」这类接线错误，它必须冒泡到宿主
     * 自己的边界（宿主边界对它是 rethrow 的）。我们按名字识别而不是 `instanceof`：
     * 该错误类没有出现在客户端 `require()` 的静态表里，import 不到。
     */
    function isAssemblyError(error) {
      if (error === null || error === undefined) return false;
      if (error.name === "SlotAssemblyError") return true;
      var ctor = error.constructor;
      return ctor !== undefined && ctor !== null && ctor.name === "SlotAssemblyError";
    }

    /** 判断一个字段是否有可渲染的文本（自检条目的 `path`/`detail`/`hint` 都可为空）。 */
    function hasText(value) {
      return value !== null && value !== undefined && String(value) !== "";
    }

    function formatBytes(value) {
      var bytes = Number(value);
      if (!isFinite(bytes) || bytes < 0) return "";
      if (bytes < 1024) return String(bytes) + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    /** 分隔符属于排版而非文案，但仍不写中文标点，避免看起来像硬编码文案。 */
    function joinMeta(parts) {
      return parts
        .filter(function (part) {
          return part !== undefined && part !== null && part !== "";
        })
        .map(function (part) {
          return String(part);
        })
        .join(" · ");
    }

    /**
     * 宿主返回的是稳定的英文枚举（`missing` / `unauthorized` / `scheduled`…），界面上
     * 必须翻成当前语言。字典里没有对应词条时**原样返回**——宿主新增枚举值时，界面
     * 宁可显示原词，也不能显示 `value.xxx` 这样的内部键名或空白。
     */
    function valueLabel(t, value) {
      if (value === undefined || value === null || value === "") return "";
      var key = "value." + String(value);
      var text = t(key);
      return text === key ? String(value) : text;
    }

    /** 语言切换时让 React 重画；取词函数自己会读到新语言，缺的只是一个通知。 */
    function createNotifier() {
      var version = 0;
      var listeners = new Set();
      return {
        subscribe: function (listener) {
          listeners.add(listener);
          return function () {
            listeners.delete(listener);
          };
        },
        getSnapshot: function () {
          return version;
        },
        bump: function () {
          version += 1;
          listeners.forEach(function (listener) {
            listener();
          });
        },
      };
    }

    // ------------------------------------------------------------------ 取数

    /**
     * 统一请求：只认 `{ok:true,...}` 与 `{ok:false,code,message}` 两种形状，并把整个
     * payload 交给调用方——各接口的集合字段名由宿主路由决定（`profiles` / `projects` /
     * `items` / `records`…），在这里再抄一遍字段名必然漂移。
     *
     * 唯一的例外是**空响应体的 404**：插件自己的 404 一定带
     * `{ok:false,code:"not-found",message}`（`lib/host/web.js`），所以「404 且解析不出 JSON」
     * 只可能是宿主半边没挂载时 DSH 自己回的默认 404。这种情况给一句可操作的提示，
     * 而不是把裸的 `HTTP 404` 摊给用户（design D14）。
     */
    function createApi(prefix, translate) {
      var tr = typeof translate === "function" ? translate : function (key) {
        return key;
      };
      return function request(path, options) {
        return fetch(prefix + path, options).then(function (response) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (payload) {
              if (payload !== null && payload.ok === true) return payload;
              var hostNotMounted = payload === null && response.status === 404;
              var message = hostNotMounted
                ? tr("error.hostNotMounted")
                : payload !== null && typeof payload.message === "string" && payload.message !== ""
                  ? payload.message
                  : "HTTP " + String(response.status);
              var error = new Error(message);
              error.code = hostNotMounted
                ? "host-not-mounted"
                : payload !== null && typeof payload.code === "string"
                  ? payload.code
                  : "http-" + String(response.status);
              throw error;
            });
        });
      };
    }

    /**
     * 一次性取数：`loader` 变了就重取，组件卸载后落地的结果直接丢弃（否则快速切区域
     * 会让上一个区域的响应覆盖当前区域的界面）。
     *
     * 重取时**保留上一份数据**（`status` 变 `loading`、`data` 不变）：否则一次
     * 「保存后刷新」会把整棵子树卸载再重建——界面会闪、展开的登录面板会掉线，
     * 而且重建出来的组件会再触发一次刷新，形成自激循环（design D18）。
     * 换对象（点另一个画像/主题）由调用方加 `key` 让它整体重挂，避免显示旧数据。
     */
    function useResource(loader, deps) {
      var tuple = React.useState({ status: "loading", data: null, error: null });
      var state = tuple[0];
      var setState = tuple[1];
      React.useEffect(function () {
        var alive = true;
        setState(function (previous) {
          return { status: "loading", data: previous.data, error: null };
        });
        Promise.resolve()
          .then(loader)
          .then(
            function (data) {
              if (alive) setState({ status: "ready", data: data, error: null });
            },
            function (error) {
              if (alive) setState({ status: "error", data: null, error: error });
            },
          );
        return function () {
          alive = false;
        };
      }, deps);
      return { status: state.status, data: state.data, error: state.error };
    }

    /** 在 `useResource` 之上加一个 `reload()`，供「重试」按钮使用。 */
    function useEndpoint(api, path, deps) {
      var tuple = React.useState(0);
      var nonce = tuple[0];
      var setNonce = tuple[1];
      var state = useResource(
        function () {
          return api(path);
        },
        [path, nonce].concat(deps === undefined ? [] : deps),
      );
      state.reload = function () {
        setNonce(function (value) {
          return value + 1;
        });
      };
      return state;
    }

    // -------------------------------------------------------------- 展示小件

    function Loading(props) {
      return h("p", { className: "easel-muted", "data-easel-state": "loading" }, props.t("common.loading"));
    }

    function ErrorState(props) {
      var message = props.error instanceof Error ? props.error.message : String(props.error);
      return h(
        "div",
        { className: "easel-boundary", "data-easel-state": "error" },
        h("p", { className: "easel-boundary-detail" }, props.t("boundary.detail", { message: message })),
        typeof props.onRetry === "function"
          ? h("button", { type: "button", className: "easel-button", "data-easel-retry": "", onClick: props.onRetry }, props.t("common.retry"))
          : null,
      );
    }

    /**
     * 空态：默认只说「没有数据」，但一张空白页对用户是死路——所以每个区域都可以用
     * `hintKey` 补一句「怎么才会有数据」（design D17）。
     */
    function EmptyState(props) {
      var messageKey = typeof props.messageKey === "string" ? props.messageKey : "common.empty";
      return h(
        "div",
        { className: "easel-empty", "data-easel-state": "empty" },
        h("p", { className: "easel-muted" }, props.t(messageKey)),
        typeof props.hintKey === "string" ? h("p", { className: "easel-hint", "data-easel-hint": "" }, props.t(props.hintKey)) : null,
      );
    }

    function Section(props) {
      return h("section", { className: "easel-section" }, h("h2", { className: "easel-section-title" }, props.title), props.children);
    }

    function KeyValue(props) {
      return h(
        "dl",
        { className: "easel-kv" },
        props.rows.map(function (row, index) {
          var value = row[1];
          var text =
            value === undefined || value === null || value === "" ? props.t("common.unknown") : typeof value === "boolean" ? String(value) : String(value);
          return h(
            "div",
            { className: "easel-kv-row", key: String(index) },
            h("dt", { className: "easel-kv-key" }, row[0]),
            h("dd", { className: "easel-kv-value" }, text),
          );
        }),
      );
    }

    function Resource(props) {
      var state = props.state;
      var stale = state.data !== null && state.data !== undefined;
      // 首次取数才显示「加载中」；刷新时手上有上一份数据就直接渲染，避免闪屏与重建。
      if (state.status === "loading" && stale !== true) return h(Loading, { t: props.t });
      if (state.status === "error") return h(ErrorState, { t: props.t, error: state.error, onRetry: state.reload });
      return props.children(state.data);
    }

    /**
     * 一层错误边界。`scope` 只用来在错误节点上打标记（面板根部 `panel` / 每个区域
     * `region`），测试与排查都靠它区分是哪一层兜住的。
     *
     * `SlotAssemblyError` 必须原样上抛：宿主自己的边界对它是 rethrow 的，吞掉它会把
     * 「接线错了」伪装成「恰好这次渲染崩了」。
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
        this.reset = this.reset.bind(this);
      }

      static getDerivedStateFromError(error) {
        return { error: error };
      }

      componentDidCatch(error, info) {
        console.error("[easel-workbench] " + String(this.props.scope) + " boundary caught a render error", error, info);
      }

      reset() {
        this.setState({ error: null });
      }

      render() {
        var error = this.state.error;
        if (error === null || error === undefined) return this.props.children;
        if (isAssemblyError(error)) throw error;
        var t = this.props.t;
        return h(
          "div",
          { className: "easel-boundary", "data-easel-boundary": this.props.scope },
          h("p", { className: "easel-boundary-title" }, t("boundary.title")),
          h("p", { className: "easel-boundary-detail" }, t("boundary.detail", { message: error instanceof Error ? error.message : String(error) })),
          h(
            "div",
            { className: "easel-form" },
            h("button", { type: "button", className: "easel-button", "data-easel-boundary-retry": "", onClick: this.reset }, t("common.retry")),
            // 面板根部兜底时连标题栏都换了，出口要由边界自己给，否则用户会被困在错误态里。
            typeof this.props.onBack === "function"
              ? h("button", { type: "button", className: "easel-button", "data-easel-back": "", onClick: this.props.onBack }, t("panel.back"))
              : null,
          ),
        );
      }
    }

    // ------------------------------------------------------------------ 区域

    function AccountsRows(props) {
      var t = props.t;
      return h(
        "ul",
        { className: "easel-list" },
        props.accounts.map(function (account) {
          return h(
            "li",
            { className: "easel-row", key: String(account.platform) },
            h(
              "div",
              { className: "easel-row-main" },
              h("span", { className: "easel-row-title" }, String(account.label || account.platform)),
              h("span", { className: "easel-muted" }, valueLabel(t, account.state)),
            ),
            h("span", { className: "easel-tag easel-state-" + String(account.state) }, valueLabel(t, account.state)),
          );
        }),
      );
    }

    function OverviewRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/overview");
      return h(Resource, { state: state, t: t }, function (data) {
        var accounts = Array.isArray(data.accounts) ? data.accounts : [];
        return h(
          "div",
          null,
          h(
            Section,
            { title: t("panel.ready") },
            h(KeyValue, {
              t: t,
              rows: [
                [t("overview.profiles"), data.profileCount],
                [t("overview.artifacts"), data.projectCount],
                [t("overview.topics"), data.topicCount],
                [t("overview.scheduled"), data.scheduledCount],
                [t("overview.runtime"), data.dispatchTarget],
              ],
            }),
          ),
          h(Section, { title: t("nav.accounts") }, accounts.length === 0 ? h(EmptyState, { t: t, hintKey: "accounts.emptyHint" }) : h(AccountsRows, { t: t, accounts: accounts })),
        );
      });
    }

    /**
     * 扫码登录面板：启动仓库里既有的登录脚本 → 轮询状态文件 → 显示二维码 →
     * （平台风控要求时）回填短信验证码 → 取消 / 完成。
     *
     * 插件从不代填、代收任何凭据：二维码由脚本产出、由用户自己扫，这里只把
     * 状态文件与二维码文件如实呈现（design D18）。
     */
    function LoginPanel(props) {
      var t = props.t;
      var api = props.api;
      var platform = props.platform;
      var base = props.apiBase;
      var tuple = React.useState({ phase: "probing", state: null, error: "", nonce: 0 });
      var view = tuple[0];
      var setView = tuple[1];
      var smsTuple = React.useState({ code: "", status: "idle", message: "" });
      var sms = smsTuple[0];
      var setSms = smsTuple[1];

      function messageOf(error) {
        return error instanceof Error ? error.message : String(error);
      }

      /** 落地一次状态。返回「还要不要继续轮询」。 */
      function apply(payload) {
        var keepPolling = payload.running === true && payload.rawState !== "success";
        setView({ phase: keepPolling ? "running" : "settled", state: payload, error: "", nonce: 0 });
        if (payload.rawState === "success" && typeof props.onSettled === "function") props.onSettled();
        return keepPolling;
      }

      function statusPath() {
        return "/accounts/" + encodeURIComponent(platform) + "/login/status";
      }

      function refresh() {
        return api(statusPath()).then(apply, function (error) {
          setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
        });
      }

      // 首次挂载先探一次：用户可能在别处已经启动过登录，不能默认「没在跑」。
      React.useEffect(
        function () {
          var alive = true;
          api(statusPath()).then(
            function (payload) {
              if (alive) apply(payload);
            },
            function () {
              if (alive) setView({ phase: "settled", state: null, error: "", nonce: 0 });
            },
          );
          return function () {
            alive = false;
          };
        },
        [platform],
      );

      // 登录是 180 秒量级的长流程，前端按 1.5 秒轮询；一旦脚本不再运行就停下，
      // 不会留下一个永远转圈的界面。
      React.useEffect(
        function () {
          if (view.phase !== "running") return undefined;
          var alive = true;
          var timer = null;
          function step() {
            api(statusPath()).then(
              function (payload) {
                if (alive !== true) return;
                if (apply(payload) === true) timer = setTimeout(step, 1500);
              },
              function (error) {
                if (alive !== true) return;
                setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
              },
            );
          }
          timer = setTimeout(step, 500);
          return function () {
            alive = false;
            if (timer !== null) clearTimeout(timer);
          };
        },
        [view.phase, view.nonce],
      );

      function start() {
        setView({ phase: "running", state: null, error: "", nonce: 0 });
        setSms({ code: "", status: "idle", message: "" });
        api("/accounts/" + encodeURIComponent(platform) + "/login", { method: "POST" }).catch(function (error) {
          setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
        });
      }

      function cancel() {
        api("/accounts/" + encodeURIComponent(platform) + "/login", { method: "DELETE" }).then(refresh, function (error) {
          setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
        });
      }

      function submitSms(event) {
        if (event !== undefined && typeof event.preventDefault === "function") event.preventDefault();
        setSms({ code: sms.code, status: "running", message: "" });
        api("/accounts/" + encodeURIComponent(platform) + "/login/sms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: sms.code }),
        }).then(
          function () {
            setSms({ code: "", status: "done", message: t("login.smsSent") });
          },
          function (error) {
            setSms({ code: sms.code, status: "failed", message: messageOf(error) });
          },
        );
      }

      var state = view.state;
      var rawState = state === null || state === undefined ? "" : String(state.rawState || "");
      var running = view.phase === "running";
      return h(
        "div",
        { className: "easel-login", "data-easel-login": String(platform) },
        h(
          "p",
          { className: "easel-muted" },
          h("span", { "data-easel-login-state": rawState === "" ? "unknown" : rawState }, valueLabel(t, rawState === "" ? "unknown" : rawState)),
          state !== null && state !== undefined && state.message
            ? h("span", null, " · " + String(state.message))
            : null,
        ),
        view.error !== ""
          ? h("p", { className: "easel-error-text", "data-easel-login-error": "" }, view.error)
          : null,
        state !== null && state !== undefined && state.qrReady === true
          ? h("img", {
              className: "easel-qr",
              "data-easel-qr": String(platform),
              alt: t("login.qrAlt"),
              src: base + "/accounts/" + encodeURIComponent(platform) + "/qr?ts=" + String(state.qrTs || 0),
            })
          : null,
        state !== null && state !== undefined && state.smsRequired === true
          ? h(
              "form",
              { className: "easel-form", onSubmit: submitSms },
              h("input", {
                className: "easel-input",
                "data-easel-login-sms-input": String(platform),
                value: sms.code,
                inputMode: "numeric",
                placeholder: t("login.smsPlaceholder"),
                onChange: function (event) {
                  setSms({ code: event.target.value, status: "idle", message: "" });
                },
              }),
              h(
                "button",
                {
                  type: "submit",
                  className: "easel-button",
                  "data-easel-login-sms": String(platform),
                  disabled: sms.status === "running",
                },
                sms.status === "running" ? t("common.loading") : t("login.smsSubmit"),
              ),
            )
          : null,
        sms.message !== ""
          ? h(
              "p",
              { className: sms.status === "failed" ? "easel-error-text" : "easel-muted", "data-easel-login-sms-state": sms.status },
              sms.message,
            )
          : null,
        h(
          "div",
          { className: "easel-actions" },
          h(
            "button",
            {
              type: "button",
              className: "easel-button",
              "data-easel-login-start": String(platform),
              disabled: running,
              onClick: start,
            },
            running ? t("login.running") : t("login.start"),
          ),
          h("button", { type: "button", className: "easel-button", "data-easel-login-refresh": String(platform), onClick: refresh }, t("login.refresh")),
          running
            ? h("button", { type: "button", className: "easel-button", "data-easel-login-cancel": String(platform), onClick: cancel }, t("login.cancel"))
            : null,
        ),
        h("p", { className: "easel-hint" }, t("login.note")),
      );
    }

    function AccountsRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/accounts");
      var actionTuple = React.useState({ platform: null, status: "idle", message: "" });
      var action = actionTuple[0];
      var setAction = actionTuple[1];
      var loginTuple = React.useState(null);
      var openLogin = loginTuple[0];
      var setOpenLogin = loginTuple[1];

      function verify(platform) {
        setAction({ platform: platform, status: "running", message: "" });
        props
          .api("/accounts/" + encodeURIComponent(platform) + "/verify", { method: "POST" })
          .then(function (payload) {
            setAction({ platform: platform, status: "done", message: typeof payload.message === "string" ? payload.message : "" });
          })
          .catch(function (error) {
            setAction({ platform: platform, status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(Resource, { state: state, t: t }, function (data) {
        var accounts = Array.isArray(data.accounts) ? data.accounts : [];
        if (accounts.length === 0) return h(EmptyState, { t: t, hintKey: "accounts.emptyHint" });
        return h(
          "ul",
          { className: "easel-list" },
          accounts.map(function (account) {
            var busy = action.platform === account.platform && action.status === "running";
            var open = openLogin === account.platform;
            return h(
              "li",
              { className: open ? "easel-row easel-row-block" : "easel-row", key: String(account.platform) },
              h(
                "div",
                { className: "easel-row-main" },
                h("span", { className: "easel-row-title" }, String(account.label || account.platform)),
                h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, account.state), account.message])),
                action.platform === account.platform && action.status !== "idle" && action.status !== "running"
                  ? h("span", { className: "easel-muted", "data-easel-action": action.status }, action.message)
                  : null,
              ),
              h("span", { className: "easel-tag easel-state-" + String(account.state) }, valueLabel(t, account.state)),
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  disabled: busy,
                  "data-easel-verify": String(account.platform),
                  onClick: function () {
                    verify(account.platform);
                  },
                },
                busy ? t("common.loading") : t("accounts.verify"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  "data-easel-login-toggle": String(account.platform),
                  onClick: function () {
                    setOpenLogin(open ? null : account.platform);
                  },
                },
                open ? t("dispatch.close") : t("login.open"),
              ),
              open
                ? h(LoginPanel, {
                    key: "login-" + String(account.platform),
                    t: t,
                    api: props.api,
                    apiBase: props.apiBase,
                    platform: account.platform,
                    onSettled: function () {
                      state.reload();
                    },
                  })
                : null,
            );
          }),
        );
      });
    }

    /**
     * 画像详情：六个维度各是一份 Markdown。读是默认态，点「编辑」进入文本框，
     * 保存走 `PUT /profiles/:name/dimensions/:dimension`（`{text}`）——宿主会
     * `resolveInside` 校验并原子落盘，插件不在客户端拼路径。
     */
    function ProfileDetail(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/profiles/" + encodeURIComponent(props.name));
      var editingTuple = React.useState(null);
      var editing = editingTuple[0];
      var setEditing = editingTuple[1];
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "" });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];

      function save(dimension) {
        setStatus({ status: "running", message: "" });
        props
          .api("/profiles/" + encodeURIComponent(props.name) + "/dimensions/" + encodeURIComponent(dimension), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: draft }),
          })
          .then(function (payload) {
            var bytes = payload !== null && payload !== undefined && payload.bytes !== undefined ? String(payload.bytes) : "";
            setStatus({ status: "saved", message: t("profiles.saved", { dimension: dimension, bytes: bytes }) });
            setEditing(null);
            state.reload();
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(Resource, { state: state, t: t }, function (data) {
        var dimensions = data.dimensions !== null && typeof data.dimensions === "object" ? data.dimensions : {};
        var keys = Object.keys(dimensions);
        if (keys.length === 0) return h(EmptyState, { t: t, hintKey: "profiles.emptyHint" });
        return h(
          "div",
          { className: "easel-region" },
          status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-profile-error": "" }, status.message) : null,
          status.status === "saved" ? h("p", { className: "easel-hint", "data-easel-profile-saved": "" }, status.message) : null,
          keys.map(function (dimension) {
            var open = editing === dimension;
            return h(
              Section,
              { key: dimension, title: dimension },
              open
                ? h(
                    "div",
                    { className: "easel-form easel-form-column" },
                    h("textarea", {
                      className: "easel-textarea",
                      "data-easel-profile-editor": dimension,
                      value: draft,
                      onChange: function (event) {
                        setDraft(event.target.value);
                      },
                    }),
                    h(
                      "div",
                      { className: "easel-actions" },
                      h(
                        "button",
                        {
                          type: "button",
                          className: "easel-button",
                          "data-easel-profile-save": dimension,
                          disabled: status.status === "running",
                          onClick: function () {
                            save(dimension);
                          },
                        },
                        t("profiles.save"),
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          className: "easel-button",
                          "data-easel-profile-cancel": dimension,
                          onClick: function () {
                            setEditing(null);
                          },
                        },
                        t("profiles.cancel"),
                      ),
                    ),
                  )
                : h(
                    "div",
                    null,
                    h("pre", { className: "easel-text" }, String(dimensions[dimension])),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "easel-button",
                        "data-easel-profile-edit": dimension,
                        onClick: function () {
                          setDraft(String(dimensions[dimension]));
                          setStatus({ status: "idle", message: "" });
                          setEditing(dimension);
                        },
                      },
                      t("profiles.edit"),
                    ),
                  ),
            );
          }),
        );
      });
    }

    function ProfilesRegion(props) {
      var t = props.t;
      var tuple = React.useState(null);
      var selected = tuple[0];
      var setSelected = tuple[1];
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "" });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];
      var state = useEndpoint(props.api, "/profiles");

      // 新建画像 = 从 `profiles/_template` 复制六个维度文档（宿主 createProfile）。
      function create(event) {
        event.preventDefault();
        var name = draft.trim();
        if (name === "") return;
        setStatus({ status: "running", message: "" });
        props
          .api("/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name }) })
          .then(function (payload) {
            var created = payload !== null && payload !== undefined && typeof payload.name === "string" ? payload.name : name;
            setDraft("");
            setStatus({ status: "idle", message: "" });
            setSelected(created);
            state.reload();
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(
        "div",
        null,
        h(
          "form",
          { className: "easel-form", onSubmit: create },
          h("input", {
            className: "easel-input",
            "data-easel-profile-input": "",
            value: draft,
            placeholder: t("profiles.createPlaceholder"),
            onChange: function (event) {
              setDraft(event.target.value);
            },
          }),
          h("button", { type: "submit", className: "easel-button", "data-easel-profile-create": "", disabled: status.status === "running" }, t("profiles.create")),
        ),
        status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-profile-error": "" }, status.message) : null,
        h(Resource, { state: state, t: t }, function (data) {
          var profiles = Array.isArray(data.profiles) ? data.profiles : [];
          var dimensions = Array.isArray(data.dimensions) ? data.dimensions : [];
          if (profiles.length === 0) return h(EmptyState, { t: t, hintKey: "profiles.emptyHint" });
          return h(
            "div",
            { className: "easel-split" },
            h(
              "ul",
              { className: "easel-list easel-list-side" },
              profiles.map(function (profile) {
                var present = Array.isArray(profile.dimensions) ? profile.dimensions.length : 0;
                return h(
                  "li",
                  { key: String(profile.name) },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "easel-nav-item" + (selected === profile.name ? " easel-nav-item-active" : ""),
                      "data-easel-profile": String(profile.name),
                      onClick: function () {
                        setSelected(profile.name);
                      },
                    },
                    h("span", { className: "easel-row-title" }, String(profile.name)),
                    h("span", { className: "easel-muted" }, String(present) + " / " + String(dimensions.length)),
                  ),
                );
              }),
            ),
            selected === null ? h(EmptyState, { t: t, hintKey: "profiles.pickProfile" }) : h(ProfileDetail, { key: selected, t: t, api: props.api, name: selected }),
          );
        }),
      );
    }

    function ProjectDetail(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/projects/" + encodeURIComponent(props.topic));
      return h(Resource, { state: state, t: t }, function (data) {
        var files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) return h(EmptyState, { t: t, hintKey: "library.emptyFiles" });
        return h(
          "ul",
          { className: "easel-list" },
          files.map(function (file) {
            // 下载走同一条只读路由，`?download=1` 才切到 attachment；路径是仓库内相对路径。
            var href = API_PREFIX + "/files?path=" + encodeURIComponent(String(file.path)) + "&download=1";
            return h(
              "li",
              { className: "easel-row", key: String(file.path) },
              h(
                "div",
                { className: "easel-row-main" },
                h("span", { className: "easel-row-title" }, String(file.path)),
                h("span", { className: "easel-muted" }, joinMeta([file.kind, formatBytes(file.bytes)])),
              ),
              h("a", { className: "easel-button", href: href, download: "" }, t("library.download")),
            );
          }),
        );
      });
    }

    function LibraryRegion(props) {
      var t = props.t;
      var tuple = React.useState(null);
      var selected = tuple[0];
      var setSelected = tuple[1];
      var state = useEndpoint(props.api, "/projects");
      return h(Resource, { state: state, t: t }, function (data) {
        var projects = Array.isArray(data.projects) ? data.projects : [];
        if (projects.length === 0) return h(EmptyState, { t: t, hintKey: "library.emptyHint" });
        return h(
          "div",
          { className: "easel-split" },
          h(
            "ul",
            { className: "easel-list easel-list-side" },
            projects.map(function (project) {
              return h(
                "li",
                { key: String(project.topic) },
                h(
                  "button",
                  {
                    type: "button",
                    className: "easel-nav-item" + (selected === project.topic ? " easel-nav-item-active" : ""),
                    "data-easel-project": String(project.topic),
                    onClick: function () {
                      setSelected(project.topic);
                    },
                  },
                  h("span", { className: "easel-row-title" }, String(project.title || project.topic)),
                  h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, project.status), project.updated])),
                ),
              );
            }),
          ),
          selected === null ? h(EmptyState, { t: t, hintKey: "library.pickProject" }) : h(ProjectDetail, { key: selected, t: t, api: props.api, topic: selected }),
        );
      });
    }

    function describeAccepts(value, t) {
      if (!Array.isArray(value)) return "";
      return value
        .map(function (entry) {
          if (typeof entry === "string") return valueLabel(t, entry);
          if (entry !== null && typeof entry === "object") return String(entry.label || entry.id || "");
          return "";
        })
        .filter(function (entry) {
          return entry !== "";
        })
        .join(" / ");
    }

    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }

    /**
     * 发布表单：预览 → 勾选确认 → 执行。
     *
     * 参数形状严格照仓库脚本的 argparse 拼装（见宿主 `lib/host/scripts.js` 的
     * `buildPublishArgv`）：素材型平台把所选产物当素材（小红书/抖音/快手/视频号/
     * 知乎/B站），公众号型平台把所选 `.md`/`.html` 当正文文件。预览只跑内容门禁、
     * **不执行任何命令**；执行前必须显式勾选确认，插件永不代发。
     */
    function PublishForm(props) {
      var t = props.t;
      var api = props.api;
      var formTuple = React.useState({ platform: "", topic: "", file: "", title: "", body: "", tags: "" });
      var form = formTuple[0];
      var setForm = formTuple[1];
      var runTuple = React.useState({ phase: "idle", preview: null, result: null, error: "" });
      var run = runTuple[0];
      var setRun = runTuple[1];
      var confirmTuple = React.useState(false);
      var confirmed = confirmTuple[0];
      var setConfirmed = confirmTuple[1];

      var platforms = useEndpoint(api, "/publish/platforms");
      var projects = useEndpoint(api, "/projects");
      var files = useEndpoint(api, form.topic === "" ? "/projects" : "/projects/" + encodeURIComponent(form.topic));

      function setField(name, value) {
        var next = {
          platform: form.platform,
          topic: form.topic,
          file: form.file,
          title: form.title,
          body: form.body,
          tags: form.tags,
        };
        next[name] = value;
        if (name === "topic") next.file = "";
        setForm(next);
        setRun({ phase: "idle", preview: null, result: null, error: "" });
      }

      function platformList() {
        var data = platforms.data;
        return data !== null && data !== undefined && Array.isArray(data.platforms) ? data.platforms : [];
      }

      function selectedPlatform() {
        var list = platformList();
        for (var index = 0; index < list.length; index += 1) {
          if (list[index].id === form.platform) return list[index];
        }
        return undefined;
      }

      /** 拼本次发布的输入；缺必需项时回 `{error}`，绝不发半个请求。 */
      function payloadOf() {
        var platform = selectedPlatform();
        if (platform === undefined) return { error: t("publish.pickPlatform") };
        if (form.title.trim() === "") return { error: t("publish.titleRequired") };
        var accepts = Array.isArray(platform.accepts) ? platform.accepts : [];
        var article = platform.style === "wechat" || accepts.indexOf("article") >= 0;
        var input = { platform: platform.id, title: form.title };
        // 空正文不往下传：脚本收到 `--content ""` 只会把空串写进正文。
        if (form.body.trim() !== "") input.body = form.body;
        var tags = form.tags
          .split(",")
          .map(function (tag) {
            return tag.trim();
          })
          .filter(function (tag) {
            return tag !== "";
          });
        if (tags.length > 0) input.tags = tags;
        if (form.file !== "") {
          var relative = "outputs/" + form.topic + "/" + form.file;
          if (article === true) input.article = relative;
          else input.media = [relative];
        }
        return { input: input, article: article };
      }

      function post(path, input) {
        return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      }

      function preview() {
        var built = payloadOf();
        if (built.error !== undefined) {
          setRun({ phase: "idle", preview: null, result: null, error: built.error });
          return;
        }
        setRun({ phase: "previewing", preview: null, result: null, error: "" });
        post("/publish/preview", built.input).then(
          function (payload) {
            setRun({ phase: "previewed", preview: payload, result: null, error: "" });
          },
          function (error) {
            setRun({ phase: "idle", preview: null, result: null, error: errorMessage(error) });
          },
        );
      }

      function execute() {
        if (confirmed !== true) {
          setRun({ phase: "idle", preview: null, result: null, error: t("publish.confirmFirst") });
          return;
        }
        var built = payloadOf();
        if (built.error !== undefined) {
          setRun({ phase: "idle", preview: null, result: null, error: built.error });
          return;
        }
        setRun({ phase: "running", preview: run.preview, result: null, error: "" });
        post("/publish/execute", built.input).then(
          function (payload) {
            setRun({ phase: "done", preview: run.preview, result: payload, error: "" });
            if (typeof props.onPublished === "function") props.onPublished();
          },
          function (error) {
            setRun({ phase: "done", preview: run.preview, result: null, error: errorMessage(error) });
          },
        );
      }

      var list = platformList();
      var platformInfo = selectedPlatform();
      var projectList = projects.data !== null && projects.data !== undefined && Array.isArray(projects.data.projects) ? projects.data.projects : [];
      var fileList = files.data !== null && files.data !== undefined && Array.isArray(files.data.files) ? files.data.files : [];
      var isArticle = platformInfo !== undefined && (platformInfo.style === "wechat" || (Array.isArray(platformInfo.accepts) && platformInfo.accepts.indexOf("article") >= 0));
      var busy = run.phase === "previewing" || run.phase === "running";

      return h(
        "div",
        { className: "easel-form easel-form-column easel-publish", "data-easel-publish-form": "" },
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.platform")),
          h(
            "select",
            { className: "easel-input", "data-easel-publish-platform": "", value: form.platform, onChange: function (event) { setField("platform", event.target.value); } },
            h("option", { value: "" }, t("publish.pickPlatformOption")),
            list.map(function (platform) {
              return h("option", { key: String(platform.id), value: String(platform.id) }, String(platform.label) + "（" + describeAccepts(platform.accepts, t) + "）");
            }),
          ),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.topic")),
          h(
            "select",
            { className: "easel-input", "data-easel-publish-topic": "", value: form.topic, onChange: function (event) { setField("topic", event.target.value); } },
            h("option", { value: "" }, t("publish.pickTopicOption")),
            projectList.map(function (project) {
              return h("option", { key: String(project.topic), value: String(project.topic) }, String(project.topic));
            }),
          ),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, isArticle === true ? t("publish.articleFile") : t("publish.mediaFile")),
          h(
            "select",
            { className: "easel-input", "data-easel-publish-file": "", value: form.file, onChange: function (event) { setField("file", event.target.value); } },
            h("option", { value: "" }, t("publish.pickFileOption")),
            fileList.map(function (file) {
              return h("option", { key: String(file.path), value: String(file.path) }, String(file.path) + "（" + String(file.kind) + "）");
            }),
          ),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.title")),
          h("input", { className: "easel-input", "data-easel-publish-title": "", value: form.title, onChange: function (event) { setField("title", event.target.value); } }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.body")),
          h("textarea", { className: "easel-textarea", "data-easel-publish-body": "", value: form.body, onChange: function (event) { setField("body", event.target.value); } }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.tags")),
          h("input", { className: "easel-input", "data-easel-publish-tags": "", value: form.tags, placeholder: t("publish.tagsPlaceholder"), onChange: function (event) { setField("tags", event.target.value); } }),
        ),
        h(
          "label",
          { className: "easel-check" },
          h("input", { type: "checkbox", "data-easel-publish-confirm": "", checked: confirmed, onChange: function (event) { setConfirmed(event.target.checked); } }),
          h("span", null, t("publish.confirm")),
        ),
        h(
          "div",
          { className: "easel-actions" },
          h("button", { type: "button", className: "easel-button", "data-easel-publish-preview": "", disabled: busy, onClick: preview }, run.phase === "previewing" ? t("common.loading") : t("publish.preview")),
          h("button", { type: "button", className: "easel-button", "data-easel-publish-execute": "", disabled: busy, onClick: execute }, run.phase === "running" ? t("common.loading") : t("publish.execute")),
        ),
        run.error !== "" ? h("p", { className: "easel-error-text", "data-easel-publish-error": "" }, run.error) : null,
        run.preview !== null && run.preview !== undefined
          ? h(
              "div",
              { className: "easel-preview", "data-easel-publish-preview-result": "" },
              h("p", { className: "easel-muted" }, String(run.preview.command)),
              run.preview.guard !== null && run.preview.guard !== undefined && run.preview.guard.blocked === true
                ? h("p", { className: "easel-error-text" }, t("publish.guardBlocked"))
                : h("p", { className: "easel-hint" }, t("publish.guardClear")),
              (Array.isArray(run.preview.warnings) ? run.preview.warnings : []).map(function (warning, index) {
                return h("p", { className: "easel-hint", key: "warn-" + String(index) }, String(warning));
              }),
            )
          : null,
        run.phase === "done"
          ? h(
              "div",
              { className: "easel-preview", "data-easel-publish-result": run.result !== null && run.result !== undefined && run.result.ok === true ? "ok" : "failed" },
              run.result !== null && run.result !== undefined
                ? h(
                    "p",
                    { className: "easel-muted" },
                    joinMeta([
                      t("publish.exitCode", { code: String(run.result.exitCode) }),
                      run.result.readback === undefined || run.result.readback === null ? undefined : valueLabel(t, run.result.readback),
                      run.result.reason,
                    ]),
                  )
                : h("p", { className: "easel-error-text" }, run.error),
            )
          : null,
      );
    }

    function PublishRegion(props) {
      var t = props.t;
      var platforms = useEndpoint(props.api, "/publish/platforms");
      var history = useEndpoint(props.api, "/publish/history?limit=20");
      return h(
        "div",
        null,
        h(
          Section,
          { title: t("publish.compose") },
          h(PublishForm, {
            t: t,
            api: props.api,
            onPublished: function () {
              history.reload();
            },
          }),
        ),
        h(
          Section,
          { title: t("publish.platforms") },
          h(Resource, { state: platforms, t: t }, function (data) {
            var rows = (Array.isArray(data.platforms) ? data.platforms : []).map(function (platform) {
              return [String(platform.label || platform.id), describeAccepts(platform.accepts, t)];
            });
            return rows.length === 0 ? h(EmptyState, { t: t, hintKey: "analytics.emptyHint" }) : h(KeyValue, { t: t, rows: rows });
          }),
        ),
        h(
          Section,
          { title: t("publish.history") },
          h(Resource, { state: history, t: t }, function (data) {
            var records = Array.isArray(data.records) ? data.records : [];
            if (records.length === 0) return h(EmptyState, { t: t, hintKey: "analytics.emptyHint" });
            return h(
              "ul",
              { className: "easel-list" },
              records.map(function (record, index) {
                return h(
                  "li",
                  { className: "easel-row", key: String(index) },
                  h(
                    "div",
                    { className: "easel-row-main" },
                    h("span", { className: "easel-row-title" }, String(record.platform)),
                    h("span", { className: "easel-muted" }, String(record.at)),
                  ),
                  h("span", { className: "easel-tag" }, record.ok === true ? t("publish.success") : t("publish.failure")),
                );
              }),
            );
          }),
        ),
      );
    }

    function CalendarRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/schedule");
      return h(Resource, { state: state, t: t }, function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) return h(EmptyState, { t: t, hintKey: "schedule.emptyHint" });
        return h(
          "ul",
          { className: "easel-list" },
          items.map(function (item, index) {
            return h(
              "li",
              { className: "easel-row", key: String(item.id === undefined ? index : item.id) },
              h(
                "div",
                { className: "easel-row-main" },
                h("span", { className: "easel-row-title" }, String(item.topic || item.title || item.id || "")),
                h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, item.status), valueLabel(t, item.kind), item.scheduledAt])),
              ),
              h("span", { className: "easel-tag easel-state-" + String(item.status) }, valueLabel(t, item.status)),
              // 只有真的记下了 sessionId 的条目才给入口：点了没目标的按钮比没有按钮更糟。
              typeof item.sessionId === "string" && item.sessionId !== ""
                ? h(
                    "button",
                    {
                      type: "button",
                      className: "easel-button",
                      "data-easel-open-session": item.sessionId,
                      onClick: function () {
                        props.openSession(item.sessionId);
                      },
                    },
                    t("schedule.openSession"),
                  )
                : null,
            );
          }),
        );
      });
    }

    /**
     * 派发到会话：选题只是待办，真正产出内容的一步是「把它变成某个会话里的任务说明」。
     * 宿主 `POST /dispatch` 早就有（`lib/host/dispatch.js`），缺的一直是入口——所以这里
     * 把只能由人决定的两件事收齐：**期望产物**（任务说明的必填项）与**投递目标**
     * （新会话，或从 `/sessions` 里挑一个既有会话）。
     *
     * `target` 的取值与宿主一致：`new-session` / `current-session`（后者必须带 `sessionId`）。
     */
    function DispatchForm(props) {
      var t = props.t;
      var topic = props.topic;
      var fieldsTuple = React.useState({ deliverable: "", profile: "", platform: "", notes: "" });
      var fields = fieldsTuple[0];
      var setFields = fieldsTuple[1];
      var targetTuple = React.useState("new-session");
      var target = targetTuple[0];
      var setTarget = targetTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "", sessionId: null });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];
      var sessions = useEndpoint(props.api, "/sessions");

      function change(name) {
        return function (event) {
          var value = event.target.value;
          setFields(function (previous) {
            var next = {};
            Object.keys(previous).forEach(function (key) {
              next[key] = previous[key];
            });
            next[name] = value;
            return next;
          });
        };
      }

      function submit(event) {
        event.preventDefault();
        var deliverable = String(fields.deliverable).trim();
        if (deliverable === "") {
          setStatus({ status: "failed", message: t("dispatch.deliverableRequired"), sessionId: null });
          return;
        }
        var body = {
          target: target === "new-session" ? "new-session" : "current-session",
          task: {
            goal: String(topic.title),
            deliverable: deliverable,
            profile: String(fields.profile).trim(),
            platform: String(fields.platform).trim(),
            notes: String(fields.notes).trim(),
          },
        };
        if (target !== "new-session") body.sessionId = target;
        setStatus({ status: "running", message: "", sessionId: null });
        props
          .api("/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
          .then(function (payload) {
            var sessionId = payload !== null && payload !== undefined && typeof payload.sessionId === "string" ? payload.sessionId : "";
            setStatus({ status: "done", message: "", sessionId: sessionId });
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: error instanceof Error ? error.message : String(error), sessionId: null });
          });
      }

      var options = [{ id: "new-session", label: t("dispatch.newSession") }];
      if (sessions.status === "ready" && sessions.data !== null && Array.isArray(sessions.data.sessions)) {
        sessions.data.sessions.forEach(function (session) {
          if (session === null || session === undefined || typeof session.id !== "string") return;
          options.push({ id: session.id, label: (session.title === undefined || session.title === null ? session.id : String(session.title)) + "（" + t(session.running === true ? "dispatch.running" : "dispatch.idle") + "）" });
        });
      }

      return h(
        "form",
        { className: "easel-dispatch", "data-easel-dispatch-form": String(topic.id), onSubmit: submit },
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.deliverable")),
          h("input", {
            className: "easel-input",
            "data-easel-dispatch-deliverable": "",
            value: fields.deliverable,
            placeholder: t("dispatch.deliverablePlaceholder"),
            onChange: change("deliverable"),
          }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.profile")),
          h("input", { className: "easel-input", "data-easel-dispatch-profile": "", value: fields.profile, onChange: change("profile") }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.platform")),
          h("input", { className: "easel-input", "data-easel-dispatch-platform": "", value: fields.platform, onChange: change("platform") }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.notes")),
          h("input", { className: "easel-input", "data-easel-dispatch-notes": "", value: fields.notes, onChange: change("notes") }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.target")),
          h(
            "select",
            {
              className: "easel-input",
              "data-easel-dispatch-target": "",
              value: target,
              onChange: function (event) {
                setTarget(event.target.value);
              },
            },
            options.map(function (option) {
              return h("option", { key: option.id, value: option.id }, option.label);
            }),
          ),
        ),
        sessions.status === "error" ? h("p", { className: "easel-hint", "data-easel-dispatch-sessions": "" }, t("dispatch.sessionsUnavailable")) : null,
        h(
          "div",
          { className: "easel-actions" },
          h(
            "button",
            { type: "submit", className: "easel-button", "data-easel-dispatch-submit": "", disabled: status.status === "running" },
            status.status === "running" ? t("dispatch.sending") : t("dispatch.submit"),
          ),
        ),
        status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-dispatch-error": "" }, status.message) : null,
        status.status === "done"
          ? h(
              "p",
              { className: "easel-hint", "data-easel-dispatch-done": "" },
              t("dispatch.done", { session: String(status.sessionId) }),
              status.sessionId === "" || typeof props.openSession !== "function"
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      className: "easel-button",
                      "data-easel-dispatch-open": status.sessionId,
                      onClick: function () {
                        props.openSession(status.sessionId);
                      },
                    },
                    t("dispatch.openSession"),
                  ),
            )
          : null,
      );
    }

    function TopicsRegion(props) {
      var t = props.t;
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var submitTuple = React.useState({ status: "idle", message: "" });
      var submit = submitTuple[0];
      var setSubmit = submitTuple[1];
      var openTuple = React.useState(null);
      var open = openTuple[0];
      var setOpen = openTuple[1];
      var state = useEndpoint(props.api, "/topics");

      function create(event) {
        event.preventDefault();
        var title = draft.trim();
        if (title === "") return;
        setSubmit({ status: "running", message: "" });
        props
          .api("/topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title }) })
          .then(function () {
            setDraft("");
            setSubmit({ status: "idle", message: "" });
            state.reload();
          })
          .catch(function (error) {
            setSubmit({ status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(
        "div",
        null,
        h(
          "form",
          { className: "easel-form", onSubmit: create },
          h("input", {
            className: "easel-input",
            "data-easel-topic-input": "",
            value: draft,
            placeholder: t("topics.title"),
            onChange: function (event) {
              setDraft(event.target.value);
            },
          }),
          h("button", { type: "submit", className: "easel-button", "data-easel-topic-add": "", disabled: submit.status === "running" }, t("topics.add")),
        ),
        submit.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-topic-error": "" }, submit.message) : null,
        h(Resource, { state: state, t: t }, function (data) {
          var topics = Array.isArray(data.topics) ? data.topics : [];
          if (topics.length === 0) return h(EmptyState, { t: t, hintKey: "topics.emptyHint" });
          return h(
            "ul",
            { className: "easel-list" },
            topics.map(function (topic) {
              var expanded = open === topic.id;
              return h(
                "li",
                { className: "easel-row easel-row-block", key: String(topic.id) },
                h(
                  "div",
                  { className: "easel-row-main" },
                  h("span", { className: "easel-row-title" }, String(topic.title)),
                  h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, topic.status), topic.source, topic.note])),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "easel-button",
                    "data-easel-dispatch-toggle": String(topic.id),
                    onClick: function () {
                      setOpen(expanded ? null : topic.id);
                    },
                  },
                  expanded ? t("dispatch.close") : t("topics.dispatch"),
                ),
                expanded ? h(DispatchForm, { t: t, api: props.api, topic: topic, openSession: props.openSession }) : null,
              );
            }),
          );
        }),
      );
    }

    /**
     * 可选的热点来源。宿主 `lib/host/trends.js` 的 `TREND_SOURCES` 是权威清单，
     * 这里只用于「选哪几个源」的勾选框（顺序与宿主一致）；勾选结果用 `?ids=` 传给
     * 宿主，宿主不认识的 id 会被忽略。
     */
    var TREND_SOURCE_IDS = ["weibo", "douyin", "zhihu", "bilibili", "baidu", "toutiao"];

    /** 抓取时间：取数还没落地时显示「未知」，不显示 `undefined`。 */
    function fetchedAtOf(state, t) {
      var value = state.data === null || state.data === undefined ? undefined : state.data.fetchedAt;
      return value === undefined || value === null ? t("common.unknown") : value;
    }

    function TrendsRegion(props) {
      var t = props.t;
      var selectedTuple = React.useState({});
      var selected = selectedTuple[0];
      var setSelected = selectedTuple[1];
      var saveTuple = React.useState({ title: "", status: "idle", message: "" });
      var save = saveTuple[0];
      var setSave = saveTuple[1];

      var picked = TREND_SOURCE_IDS.filter(function (id) {
        return selected[id] === true;
      });
      // 全选与不选等价（都由宿主取全部源）：这样默认状态不会因为少传 ids 而变。
      var query = picked.length === 0 || picked.length === TREND_SOURCE_IDS.length ? "" : "?ids=" + picked.join(",");
      var state = useEndpoint(props.api, "/trends" + query, [query]);

      function toggle(id) {
        setSelected(function (prev) {
          var next = {};
          Object.keys(prev).forEach(function (key) {
            next[key] = prev[key];
          });
          next[id] = prev[id] !== true;
          return next;
        });
      }

      /** 把一条热点线索存进选题库（带原文链接作为备注，来源标为 trend）。 */
      function saveAsTopic(item) {
        setSave({ title: String(item.title || ""), status: "running", message: "" });
        props
          .api("/topics", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: String(item.title || ""),
              note: item.url === undefined || item.url === null ? "" : String(item.url),
              source: "trend",
            }),
          })
          .then(function () {
            setSave({ title: String(item.title || ""), status: "done", message: "" });
          })
          .catch(function (error) {
            setSave({ title: String(item.title || ""), status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(
        "div",
        null,
        h(
          "div",
          { className: "easel-actions", "data-easel-trend-sources": "" },
          TREND_SOURCE_IDS.map(function (id) {
            return h(
              "label",
              { key: id, className: "easel-check" },
              h("input", {
                type: "checkbox",
                "data-easel-trend-source": id,
                checked: selected[id] === true,
                onChange: function () {
                  toggle(id);
                },
              }),
              h("span", null, t("trends.source." + id)),
            );
          }),
        ),
        h(
          "p",
          { className: "easel-muted" },
          h("span", null, t("trends.fetchedAt") + " "),
          h("span", { "data-easel-fetched-at": "" }, String(fetchedAtOf(state, t))),
        ),
        h(Resource, { state: state, t: t }, function (data) {
          var items = Array.isArray(data.items) ? data.items : [];
          var sources = Array.isArray(data.sources) ? data.sources : [];
          return h(
            "div",
            null,
            sources.length === 0
              ? null
              : h(
                  "ul",
                  { className: "easel-list easel-tags" },
                  sources.map(function (source) {
                    return h(
                      "li",
                      { key: String(source.source), className: "easel-tag" + (source.ok === true ? "" : " easel-state-degraded") },
                      String(source.label || source.source),
                    );
                  }),
                ),
            items.length === 0
              ? h(EmptyState, { t: t, hintKey: "trends.emptyHint" })
              : h(
                  "ul",
                  { className: "easel-list" },
                  items.map(function (item, index) {
                    var saved = save.status !== "idle" && save.title === String(item.title || "");
                    return h(
                      "li",
                      { className: "easel-row easel-row-block", key: String(index) },
                      h(
                        "div",
                        { className: "easel-row-main" },
                        h("span", { className: "easel-row-title" }, String(item.title || "")),
                        h("span", { className: "easel-muted" }, joinMeta([item.label || item.source, item.hot])),
                        saved
                          ? h(
                              "span",
                              {
                                className: save.status === "failed" ? "easel-error-text" : "easel-muted",
                                "data-easel-trend-save-state": save.status,
                              },
                              save.status === "failed" ? save.message : save.status === "done" ? t("trends.saved") : t("common.loading"),
                            )
                          : null,
                      ),
                      h(
                        "div",
                        { className: "easel-actions" },
                        item.url
                          ? h(
                              "a",
                              { className: "easel-button", href: String(item.url), target: "_blank", rel: "noreferrer noopener" },
                              t("common.open"),
                            )
                          : null,
                        h(
                          "button",
                          {
                            type: "button",
                            className: "easel-button",
                            "data-easel-trend-save": String(index),
                            disabled: save.status === "running",
                            onClick: function () {
                              saveAsTopic(item);
                            },
                          },
                          t("trends.save"),
                        ),
                      ),
                    );
                  }),
                ),
          );
        }),
      );
    }

    function AnalyticsRegion(props) {
      var t = props.t;
      var overview = useEndpoint(props.api, "/overview");
      var history = useEndpoint(props.api, "/publish/history?limit=50");
      return h(
        "div",
        null,
        h(
          Section,
          { title: t("nav.overview") },
          h(Resource, { state: overview, t: t }, function (data) {
            return h(KeyValue, {
              t: t,
              rows: [
                [t("overview.profiles"), data.profileCount],
                [t("overview.artifacts"), data.projectCount],
                [t("overview.topics"), data.topicCount],
                [t("overview.scheduled"), data.scheduledCount],
              ],
            });
          }),
        ),
        h(
          Section,
          { title: t("publish.history") },
          h(Resource, { state: history, t: t }, function (data) {
            var records = Array.isArray(data.records) ? data.records : [];
            var succeeded = records.filter(function (record) {
              return record.ok === true;
            }).length;
            var rate = records.length === 0 ? "0" : String(Math.round((succeeded / records.length) * 100));
            return h(KeyValue, {
              t: t,
              rows: [
                [t("analytics.records"), records.length],
                [t("analytics.succeeded"), succeeded],
                [t("analytics.successRate"), rate + "%"],
              ],
            });
          }),
        ),
      );
    }

    function SelfcheckRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/selfcheck");
      return h(Resource, { state: state, t: t }, function (data) {
        var entries = Array.isArray(data.entries) ? data.entries : [];
        // 摘要行必须点名「缺什么」：只写「缺失」两个字会被读成区块标题，而列表里
        // 明明还有一串正常条目，用户会以为整页都坏了（实际反馈过这一点）。
        var labelOf = function (entry) {
          return String(entry.label || entry.id || "");
        };
        var byStatus = function (status) {
          return entries
            .filter(function (entry) {
              return entry.status === status;
            })
            .map(labelOf);
        };
        var missingNames = byStatus("missing");
        var degradedNames = byStatus("degraded");
        var summaryParts = [];
        if (missingNames.length > 0) {
          summaryParts.push(t("selfcheck.summaryMissing", { items: missingNames.join(t("common.listSeparator")) }));
        }
        if (degradedNames.length > 0) {
          summaryParts.push(t("selfcheck.summaryDegraded", { items: degradedNames.join(t("common.listSeparator")) }));
        }
        return h(
          "div",
          null,
          h(
            "p",
            { className: "easel-muted", "data-easel-selfcheck-ready": data.ready === true ? "true" : "false" },
            summaryParts.length > 0 ? summaryParts.join(t("common.clauseSeparator")) : t("selfcheck.summaryOk"),
          ),
          h(
            "ul",
            { className: "easel-list" },
            entries.map(function (entry, index) {
              return h(
                "li",
                { className: "easel-row", key: String(entry.id === undefined ? index : entry.id) },
                h(
                  "div",
                  { className: "easel-row-main" },
                  h("span", { className: "easel-row-title" }, String(entry.label || entry.id || "")),
                  hasText(entry.path) ? h("span", { className: "easel-path easel-muted" }, String(entry.path)) : null,
                  hasText(entry.detail) ? h("span", { className: "easel-muted" }, String(entry.detail)) : null,
                  hasText(entry.hint) ? h("span", { className: "easel-hint" }, String(entry.hint)) : null,
                ),
                h("span", { className: "easel-tag easel-state-" + String(entry.status) }, valueLabel(t, entry.status)),
              );
            }),
          ),
        );
      });
    }

    /**
     * 区域组件表。做成一等公民的模块级字典是为了留一个**可测试的注入点**：
     * 测试把某个区域替换成必然抛错的组件，用来验证「区域崩了不影响子导航与返回对话」。
     */
    var REGION_VIEWS = {
      overview: OverviewRegion,
      accounts: AccountsRegion,
      profiles: ProfilesRegion,
      library: LibraryRegion,
      publish: PublishRegion,
      calendar: CalendarRegion,
      topics: TopicsRegion,
      trends: TrendsRegion,
      analytics: AnalyticsRegion,
      selfcheck: SelfcheckRegion,
    };

    /** 测试注入点：覆盖/清空一个区域的组件，返回被替换掉的那个。 */
    function __setRegionOverride(regionId, component) {
      var previous = REGION_VIEWS[regionId];
      if (component === null || component === undefined) delete REGION_VIEWS[regionId];
      else REGION_VIEWS[regionId] = component;
      return previous;
    }

    function RegionView(props) {
      var Component = REGION_VIEWS[props.id];
      return h(
        "div",
        { className: "easel-region", "data-easel-region": String(props.id) },
        Component === undefined
          ? h(EmptyState, { t: props.t })
          : h(Component, { t: props.t, api: props.api, apiBase: props.apiBase, openSession: props.openSession }),
      );
    }

    // -------------------------------------------------------------- 面板本体

    function createPanel(deps) {
      var t = deps.t;
      var api = deps.api;
      var selectPanel = deps.selectPanel;
      var openSession = deps.openSession;
      var localeStore = deps.localeStore;

      // 边界必须包在「面板自己的渲染体」外面：标题取词失败这类错误发生在面板组件自身，
      // 边界若渲染在它的输出里就兜不住（React 的边界只兜子树，兜不住自己）。
      function Panel() {
        return h(
          Boundary,
          {
            t: t,
            scope: "panel",
            onBack: function () {
              selectPanel(null);
            },
          },
          h(PanelBody, null),
        );
      }

      function PanelBody() {
        var regionTuple = React.useState(REGIONS[0].id);
        var region = regionTuple[0];
        var setRegion = regionTuple[1];
        // 字典可在运行时切换，闭包里的 t 会读到新语言，但 React 不知道要重画。
        React.useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getSnapshot);

        return h(
          "div",
          { className: "easel-panel", "data-easel-panel": PANEL_ID },
          h(
            "header",
            { className: "easel-header" },
            h(
              "div",
              null,
              h("h1", { className: "easel-title" }, t("panel.title")),
              h("p", { className: "easel-subtitle" }, t("panel.subtitle")),
            ),
            h(
              "button",
              {
                type: "button",
                className: "easel-button easel-back",
                "data-easel-back": "",
                onClick: function () {
                  selectPanel(null);
                },
              },
              t("panel.back"),
            ),
          ),
          h(
            "nav",
            { className: "easel-nav", "aria-label": t("panel.regions") },
            REGIONS.map(function (entry) {
              return h(
                "button",
                {
                  key: entry.id,
                  type: "button",
                  className: "easel-nav-item" + (entry.id === region ? " easel-nav-item-active" : ""),
                  "data-easel-nav": entry.id,
                  "aria-current": entry.id === region ? "page" : undefined,
                  onClick: function () {
                    setRegion(entry.id);
                  },
                },
                t(entry.labelKey),
              );
            }),
          ),
          h(
            "div",
            { className: "easel-body" },
            // key 用区域 id：换区域时重挂边界，否则某个区域崩过一次之后错误态会一直粘着。
            h(Boundary, { key: region, t: t, scope: "region" }, h(RegionView, { id: region, t: t, api: api, apiBase: API_PREFIX, openSession: openSession })),
          ),
        );
      }

      return Panel;
    }

    function createGlyph() {
      function EaselGlyph(props) {
        var size = typeof props.size === "number" ? props.size : 18;
        return h(
          "svg",
          {
            width: size,
            height: size,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            role: "img",
            "aria-hidden": "true",
            focusable: "false",
          },
          GLYPH_PATHS.map(function (d) {
            return h("path", { key: d, d: d });
          }),
        );
      }

      return EaselGlyph;
    }

    /**
     * 样式标签在 `ctx.effect` 里挂、在 dispose 时摘：插件卸载后页面里不该留下它的 CSS。
     * factory 执行时只注册 factory，真正的挂载要等 apply，所以这里再判一次 document。
     */
    function injectStyle(ctx) {
      ctx.effect(function () {
        if (typeof document === "undefined" || document === null || document.head === null || document.head === undefined) return undefined;
        var tag = document.createElement("style");
        tag.dataset.plugin = PANEL_ID;
        tag.dataset.pluginCss = PANEL_ID + "/panel";
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      }, PANEL_ID + ": styles");
    }

    /**
     * 槽位声明握在别的插件手里（`main` 归 layout，`sidebar.panellist` 归 sidebar），
     * 而且可能晚于本插件 apply；声明缺失时 `register()` 直接抛错。所以先等声明
     * （`slots.inject`），拿到注册的 disposer 就交给 `ctx.effect`，卸载时自动摘除。
     */
    function mountSlot(ctx, slotKey, install, label) {
      ctx.effect(function () {
        if (typeof ctx.slots.inject === "function") return ctx.slots.inject(slotKey, install);
        return install();
      }, label);
    }

    // ------------------------------------------------------------------ 入口

    function apply(ctx) {
      var locale = ctx.locale;

      // 客户端内置 locale id 只有 zh / en（`zh-CN` 只用于包内文档，不是运行时 id），
      // 两个语言必须一次注册齐，否则切到 en 会整片回落成 key。
      ctx.effect(
        function () {
          return locale.register(NS, { zh: DICT_ZH, en: DICT_EN });
        },
        NS + ": dictionaries",
      );

      var t = locale.bind(NS);
      var localeStore = createNotifier();
      if (typeof locale.subscribe === "function") {
        ctx.effect(
          function () {
            return locale.subscribe(localeStore.bump);
          },
          NS + ": locale re-render",
        );
      }

      injectStyle(ctx);

      var api = createApi(API_PREFIX, t);

      // 返回对话：`ILayout.selectPanel(null)` 即回到 Conversation。layout 是可选服务，
      // 取不到时只降级为「点了没反应」，不能让整个面板崩掉。
      var selectPanel = function (panelId) {
        try {
          var controller = typeof ctx.get === "function" ? ctx.get("layout") : undefined;
          if (controller === undefined || controller === null) controller = ctx.layout;
          if (controller !== undefined && controller !== null && typeof controller.selectPanel === "function") controller.selectPanel(panelId);
        } catch (error) {
          console.warn("[easel-workbench] cannot switch the main panel", error);
        }
      };

      // 打开某个会话：`uiWorkspace.openSession`。同样按可选服务处理——排期面板没它也能看，
      // 只是「打开会话」按钮点了没反应，绝不能因此让面板崩掉。
      var openSession = function (target) {
        try {
          var workspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
          if (workspace === undefined || workspace === null) workspace = ctx.uiWorkspace;
          if (workspace !== undefined && workspace !== null && typeof workspace.openSession === "function") {
            workspace.openSession(target);
            return true;
          }
        } catch (error) {
          console.warn("[easel-workbench] cannot open the session", error);
        }
        return false;
      };

      var Panel = createPanel({ t: t, api: api, selectPanel: selectPanel, openSession: openSession, localeStore: localeStore });
      var Glyph = createGlyph();

      // main 的 key 与 side bar 条目的 id 必须同值：宿主选中侧边栏条目时就是按这个值去找面板。
      mountSlot(
        ctx,
        "main",
        function () {
          return ctx.slots.register({ name: "main", key: PANEL_ID }, Panel);
        },
        NS + ": main panel",
      );

      mountSlot(
        ctx,
        "sidebar.panellist",
        function () {
          return ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: PANEL_ROW_ORDER,
              // label 用 thunk：语言切换时宿主会重新取词（sidebar 订阅了 locale）。
              label: function () {
                return t("panel.title");
              },
            },
            Glyph,
          );
        },
        NS + ": sidebar entry",
      );
    }

    exports.name = NS;
    // 静态依赖只放真正必需的客户端服务：多声明一个当前 profile 不存在的服务，
    // fiber 会永久停在 INACTIVE，插件再也不会激活。
    exports.inject = ["slots", "locale"];
    exports.apply = apply;

    // 便于测试与排查的只读面（宿主只读 name / inject / apply，多余字段会被忽略）。
    exports.__setRegionOverride = __setRegionOverride;
    exports.REGIONS = REGIONS;
    exports.PANEL_ID = PANEL_ID;
    exports.API_PREFIX = API_PREFIX;
    exports.NS = NS;

    module.exports = exports;
    return module.exports;
  },
});

