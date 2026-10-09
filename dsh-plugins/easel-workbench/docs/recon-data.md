# Easel 磁盘数据格式勘察报告（read-only recon）

勘察对象：`/data/dsh/home/dsh-hub/Easel/_repo`（upstream 项目 "Easel"，HEAD = `fb80ae6 perf(web): Google Fonts 改为非阻塞加载，首屏不再等字体超时`）。
全文只记录事实与文件路径；路径除注明外均相对仓库根 `_repo/`。

---

## 1. `profiles/` — 账号画像（Profile）存储

### 1.1 目录树（仓库内实际内容，2 层）

`profiles/` 下**只有一个目录** `_template/`，没有任何真实用户画像：

```
_repo/profiles/
└── _template/
    ├── README.md          53 行
    ├── identity.md        13 行
    ├── style.md           21 行
    ├── audience.md        17 行
    ├── platforms.md       26 行
    ├── preferences.md     13 行
    └── memory.md          23 行
```

`git ls-files profiles` 结果（真实版本控制内容）：
`profiles/_template/{README,audience,identity,memory,platforms,preferences,style}.md`

> 推断：真正运行时画像由用户/向导创建，位于同一 `profiles/<画像名>/`。本机 HOME 下也**不存在**任何已实例化画像目录（`.easel-browser-profiles` 同样不存在，见第 4 节）。

### 1.2 六个维度：文件名、顺序、格式

固定顺序定义在 `_repo/easel/persona.py:17-20`：

```python
_FILE_ORDER = [
    "identity.md", "style.md", "audience.md",
    "platforms.md", "preferences.md", "memory.md",
]
```

| 文件 | 中文标题 | 一级章节（`##`） |
|------|----------|------------------|
| `identity.md` | `# 身份定位` | 我是谁 / 差异化 / 内容方向 |
| `style.md` | `# 内容风格` | 语气 / 开头结构 / 视觉风格 / 内容节奏 / 标志性元素 |
| `audience.md` | `# 目标受众` | 核心人群 / 兴趣标签 / 痛点 / 互动特征 |
| `platforms.md` | `# 平台运营` | 抖音 / 小红书 / B 站 / 知乎 / 微信公众号（均为 `##`，无 frontmatter） |
| `preferences.md` | `# 偏好与红线` | 要做的 / 不做的 / 合规底线 |
| `memory.md` | `# 经验沉淀` | 内容洞察 / 踩过的坑 / 受众反馈规律 |

**格式：纯 Markdown，无 YAML frontmatter。** 也没有 JSON、没有 schema 文件、没有索引/manifest。占位内容用 HTML 注释 `<!-- ... -->` 表达。

`_repo/profiles/_template/identity.md` 前 13 行（全文）逐字引用：

```markdown
# 身份定位

## 我是谁

<!-- 一句话描述这个画像的核心定位 -->

## 差异化

<!-- 跟同类型账号比，我的独特之处是什么 -->

## 内容方向

<!-- 主要做什么类型的内容 -->
```

`_repo/profiles/_template/memory.md` 前 15 行逐字引用（展示注释块形态）：

```markdown
# 经验沉淀

<!-- 
此文件记录真正有价值的洞察，不是每次做完任务都写。
更新时机：
  - 用户主动说"记住这个偏好"
  - 发布后用户反馈效果好/差，归因总结
  - 累积一段时间后做一次凝练（去重、提炼规律）

不要在这里堆流水账。每条记录应该是一个可复用的认知。
-->

## 内容洞察
```

### 1.3 画像如何被识别

- **目录名即画像名**，目录内没有任何 id 字段或 id 文件。
- `_repo/easel/persona.py:23-30` `list_personas()`：遍历 `PROFILES_DIR.iterdir()`，取 `d.is_dir() and not d.name.startswith("_")`，排序返回。下划线前缀目录（如 `_template`）被视为内部目录并排除。
- `_repo/easel/persona.py:33-35` `profile_exists(name)`：仅判断 `PROFILES_DIR / name` 是否为目录。
- 并发/隔离依据：`_repo/easel/persona.py:14` `PROFILES_DIR = PROJECT_ROOT / "profiles"`，`PROJECT_ROOT = Path(__file__).resolve().parents[1]`。
- 注入方式不是文件合读，而是**消息内联前缀**（`_repo/easel/persona.py:58-69` `persona_prefix()`）：

```python
f"我当前使用的画像是「{name}」。"
f"本会话的账号长期记忆仅使用 profiles/{name}/memory.md，"
"不要使用工作区全局 MEMORY.md 作为账号记忆。"
```

- 拼接读取顺序（`_repo/easel/persona.py:38-55` `load_profile_text()`）：先按 `_FILE_ORDER` 读存在的非空 `.md`，再把其余 `suffix=='.md'`（`sorted(profile_dir.glob("*.md"))`）追加在后，用 `"\n\n---\n\n"` 连接。
- Web 侧画像名校验规则（`_repo/web/app.py:1085-1087` `_valid_persona_name`）：非空、不含 `/`、不含 `\`、不以 `.` 或 `_` 开头。文件名校验（`_repo/web/app.py:1089-1101` `_persona_file_path`）：必须以 `.md` 结尾，不含路径分隔符，不以 `.` 开头。
- 画像构建状态文件另存：`_repo/web/app.py:205` `PROFILE_BUILD_DIR = OUTPUTS_DIR / "_profile_build"`，单文件 `outputs/_profile_build/<画像名>.json`（`_repo/web/app.py:4040-4042` `_profile_status_file`），内容 `{'state': 'running'|'done'|'failed', 'log': str, 'ts': int}`（`_repo/web/app.py:4045-4052` `_write_profile_status`）。
- 向导生成的基线六维文件由 `_repo/web/app.py` 的 `_write_baseline_profile(name, form)` 写出（与模板同名同层级，含 `[待补充]` / `[待 AI 分析]` 占位）。

### 1.4 索引 / manifest

**没有**。`profiles/` 下无 index、manifest、registry 文件；唯一非维度文件是 `_repo/profiles/_template/README.md`（模板说明，53 行，含文件清单与层级映射表、`cp -r profiles/_template profiles/你的画像名` 用法）。

---

## 2. `outputs/` — 内容/产物库

### 2.1 目录树（仓库内实际内容）

`outputs/` 在仓库里**只有一个占位文件**，全部真实产物被 gitignore：

```
_repo/outputs/
└── .gitkeep
```

`git ls-files outputs` → `outputs/.gitkeep`。`.gitignore:35-36`：

```
outputs/**/*
!outputs/**/.gitkeep
```

### 2.2 目录规约（代码中的权威定义）

规约同时定义在 `_repo/skills/shared/scripts/output_paths.py` 与 `_repo/skills/shared/scripts/manifest.py`，并被 `_repo/docs/SKILL-SPEC.md:113-121` 复述：

```
outputs/<主题>/
├── note.md / final.mp4 / card_1.png   成品（用户要发/读的最终文件，放项目根）
├── assets/                            中间件：frames/ clips/ 构建脚本 原始素材 草稿 重复文件
└── .easel.json                        唯一元数据：展示头 + 层间产物契约（隐藏）
```

- 一个内容项目 = `outputs/<主题>/` 一个目录；**主题名必须人类可读**。
- 成品在项目根；中间件在 `assets/`；`.easel.json` 是项目唯一元数据（隐藏文件）。
- 系统状态一律 `_` 前缀目录。

`_repo/skills/shared/scripts/output_paths.py` 的常量：

```python
GENERIC_PROJECT_NAMES = {
    "output", "outputs", "result", "results", "temp", "tmp", "test", "demo",
    "xhs", "douyin", "video", "audio", "image", "images", "project", "untitled",
    "主题", "主题名", "项目", "测试", "临时",
}
SYSTEM_DIRS = {
    "_analytics", "_debug", "_inbox", "_login", "_probe", "_profile_build",
    "_publish", "_scratch", "_sessions",
}
SYSTEM_FILES = {"_ideas.json", "_publish.log", "_schedule.json"}
```

`validate_output_path(value, *, allow_system=False, create_parent=False)` 规则（`_repo/skills/shared/scripts/output_paths.py:41-80`）：
- 必须位于 `OUTPUTS_DIR` 内；不得把 `outputs/` 根当作目标；顶层不得以 `.` 开头。
- 顶层以 `_` 开头或在 `SYSTEM_FILES` 中 → 必须 `allow_system=True`，且必须已在 `SYSTEM_DIRS`/`SYSTEM_FILES` 注册，否则报 `未注册的系统输出项: {top}`。
- 内容产物路径至少两层（`outputs/<主题>/...`），且主题名不得命中 `GENERIC_PROJECT_NAMES`。

`_repo/skills/shared/scripts/output_paths.py:13-24` `_discover_root()`：优先 `EASEL_ROOT` 环境变量，否则向上找含 `outputs/` 的目录（OpenClaw workspace 里 `outputs` 是指向项目的软链，故取 `outputs.resolve().parent`）。

Web 端内容库只列项目目录（`_repo/web/app.py:998-1016` `get_output_tree()`）：跳过 `.`/`_` 前缀、跳过非目录、跳过 `SYSTEM_TOPLEVEL_DIRS = {"analytics"}`（`_repo/web/app.py:209`），根目录散文件不展示。

### 2.3 产物命名与文件类型

项目根直属文件即「成品」，`_repo/scripts/migrate_outputs.py:45-49`：

```python
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
DOC_EXTS = {".md", ".pdf", ".html", ".htm", ".txt"}
DELIVERABLE_EXTS = VIDEO_EXTS | AUDIO_EXTS | IMAGE_EXTS | {".md", ".pdf", ".html", ".htm"}
```

受保护、永不移动、永不当成品的文件名（`_repo/scripts/migrate_outputs.py:55`）：

```python
PROTECTED_NAMES = {MANIFEST_NAME, "meta.json", "README.md", "readme.md", "brief.md"}
```

历史遗留的项目级 `meta.json`（非规约文件，迁移脚本会读取其字段回填 manifest）：`_repo/scripts/migrate_outputs.py:71-78` `_load_meta_json()`，可能含 `title` / `summary` / `platform` / `tags` / `cover_image`。

自动归整进 `assets/` 的中间件（`_repo/scripts/migrate_outputs.py:52-53`）：

```python
INTERMEDIATE_DIRS = {"frames", "clips", "tmp", "temp", "draft", "drafts", "raw", "reference", "_work"}
INTERMEDIATE_EXTS = {".py", ".js", ".ipynb", ".sh"}   # 构建/导出脚本
```

### 2.4 元数据 manifest：`outputs/<主题>/.easel.json`

**唯一元数据文件名为 `.easel.json`**（隐藏），读写实现 `_repo/skills/shared/scripts/manifest.py`（`MANIFEST_NAME = ".easel.json"`，第 63 行）。

Schema（`_repo/skills/shared/scripts/manifest.py:9-30` 模块 docstring，逐字）：

```
Schema:
  {
    "topic":   "主题名",
    "profile": "画像名 或 ''",
    "created": ISO8601(CST),
    "updated": ISO8601(CST),

    # —— 展示头（供前端「内容库」富展示；均可选，缺省有兜底）——
    "title":        "人类可读标题（缺省=topic）",
    "summary":      "一句话摘要",
    "platform":     "目标平台（小红书/知乎/抖音/…）",
    "kind":         "产物体裁：article|xhs-note|video|cards|poster|audio|other",
    "status":       "生命周期：draft|ready|published",
    "tags":         ["标签1", "标签2"],
    "cover":        "封面文件名（项目根相对；缺省=首张成品媒体）",
    "deliverables": ["最终成品文件名（区别于 assets/ 中间件）"],

    "steps": [
      {"layer": "plan", "skill": "video-script", "at": ISO8601, "status": "done",
       "outputs": ["script.md"], "upstream": [], "summary": "一句话结论"}
    ]
  }
```

取值域常量（`_repo/skills/shared/scripts/manifest.py:65-71`）：

```python
LAYERS = ("discover", "plan", "produce", "publish", "attribute", "general")
STATUSES = ("done", "failed")
KINDS = ("article", "xhs-note", "video", "cards", "poster", "audio", "other")
PROJECT_STATUSES = ("draft", "ready", "published")
META_SCALAR_FIELDS = ("title", "summary", "platform", "kind", "status", "cover")
```

- 时间戳格式 `_now_iso()`：CST（UTC+8）`datetime.now(CST).replace(microsecond=0).isoformat()`（`_repo/skills/shared/scripts/manifest.py:58-59, 77-78`）。
- 落盘格式：`json.dump(data, f, ensure_ascii=False, indent=2)` + 同目录 `tempfile.mkstemp` → `os.replace` 原子写（`_repo/skills/shared/scripts/manifest.py:107-117`）。
- 空文件视为未初始化（`load()` 返回 `{}`，第 98 行）；JSON 非法则 `sys.exit`。
- 子命令：`record` / `meta` / `read` / `latest` / `selftest`（`_repo/skills/shared/scripts/manifest.py:341-384`）。
- CLI 记录一步的字段构造（`_repo/skills/shared/scripts/manifest.py:144-152`）：

```python
step = {
    "layer": args.layer,
    "skill": args.skill,
    "at": now,
    "status": args.status,
    "outputs": _csv(args.outputs),
    "upstream": _csv(args.upstream),
    "summary": args.summary or "",
}
```

**没有仓库内的真实 `.easel.json` 样本**（`outputs/` 空）。可参照的最小写入形态（由 `_repo/scripts/migrate_outputs.py:185-188` 与 `manifest.py` 的初始化分支合成，字段与 schema 一致）：

```json
{
  "topic": "测试主题",
  "profile": "达人",
  "created": "2026-10-09T13:00:00+08:00",
  "updated": "2026-10-09T13:00:00+08:00",
  "title": "标题党",
  "platform": "小红书",
  "kind": "cards",
  "status": "draft",
  "tags": ["标签A", "标签B"],
  "cover": "cover.png",
  "deliverables": ["card_1.png", "card_2.png"],
  "steps": [
    {"layer": "plan", "skill": "video-script", "at": "2026-10-09T13:00:00+08:00",
     "status": "done", "outputs": ["script.md"], "upstream": [], "summary": "3 幕结构"}
  ]
}
```

（该样本由 `manifest.py` selftest 的实际断言值与 `migrate_outputs.py` 的字段名合成，**属推断**，非仓库内既有文件。）

Web 端读取展示头的字段白名单（`_repo/web/app.py:958-993` `_read_project_meta`）：`("title", "summary", "platform", "kind", "status", "tags", "deliverables")`，并额外计算 `cover` 与 `deliverablePaths`（前端成品高亮用）。

### 2.5 `outputs/` 下的系统文件清单（非项目目录）

| 路径 | 定义位置 | 内容 |
|------|----------|------|
| `outputs/_schedule.json` | `_repo/web/app.py:4220`；`_repo/skills/shared/scripts/calendar_ops.py` `DEFAULT_DATA` | 内容日历，JSON 数组（顶层就是 list，不是对象） |
| `outputs/_ideas.json` | `_repo/web/app.py:4332` | 选题库，JSON 数组 |
| `outputs/_publish.log` | `_repo/web/app.py:3966` | 追加式文本日志 |
| `outputs/_analytics/publish-log.json` | `_repo/skills/openclaw/skill-publish-log/scripts/log.py:30` | 发布记录（旧路径 `outputs/publish-log.json`，`LEGACY_DATA` 第 31 行） |
| `outputs/_login/` | `_repo/web/app.py:203` | 登录状态/二维码（见第 4 节） |
| `outputs/_publish/` | `_repo/web/app.py:204` | 异步发布状态/验证码/微信中间 HTML |
| `outputs/_profile_build/` | `_repo/web/app.py:205` | 画像增强状态 |
| `outputs/_debug/` | `_repo/web/app.py:206` | 诊断日志 |
| `outputs/_sessions/` | `_repo/web/app.py:207` | 每会话最近一轮完整结果 |
| `outputs/_inbox/` | `_repo/skills/shared/scripts/output_paths.py:33` | 会话附件投放区 |
| `outputs/_scratch/` | 同上 | 测试/临时产物 |
| `outputs/analytics/`（无下划线） | `_repo/web/app.py:209`；`_repo/scripts/migrate_outputs.py:43` | 历史归因层系统目录，内容库不展示 |

`outputs/` 的受保护删除白名单（`_repo/web/app.py:3144-3145`）：

```python
PROTECTED_OUTPUTS = {"_login", "_analytics", "_schedule.json", "_ideas.json",
                     "_publish", "_publish.log", "_sessions", "_profile_build", "_debug", "_inbox"}
```

---

## 3. 创作者人设（persona）文本：真实位置与格式

### 3.1 规则/人格文档

| 路径 | 行数 | 作用 |
|------|------|------|
| `_repo/openclaw/workspace/SOUL.md` | 30 | 人格/能力/沟通风格（系统提示） |
| `_repo/openclaw/workspace/AGENTS.md` | 110 | Agent 执行规则（系统提示，每轮注入） |

这两个**只有这两个**（`find` 全库仅命中这两处 SOUL/AGENTS）。它们是模板源，由 `_repo/openclaw/sync.sh` 拷到 OpenClaw profile workspace，并在 `AGENTS.md` 末尾追加「运行时项目根」、另写 `CONTEXT.md`。

`_repo/openclaw/workspace/SOUL.md` 标题结构（3 个标题）：

```
1:# Easel — 人格
6:## 你能做的事（心里有数，遇事先想怎么做成）
24:## 沟通风格
```

`_repo/openclaw/workspace/SOUL.md:3-4` 逐字：

```markdown
你是 Easel，创作者的社媒内容搭子——既是懂策略的操盘手，也是能上手干活的制作伙伴。
从一个热点、一句灵感，到成稿、成图、成片、发出去、再回头看数据复盘，你都陪着一起把它做成。
```

`_repo/openclaw/workspace/AGENTS.md` 标题结构（9 个 `##`）：

```
1:# Easel Agent
5:## 核心执行规则
16:## 配置检查
25:## SKILL 与站内信息
43:## 编排与日历
49:## 媒体模型选择
53:## 制作与自检
65:## 对外发布安全
88:## 素材与画像
106:## 行为边界
```

`_repo/openclaw/workspace/AGENTS.md:88-96` 逐字（画像相关契约）：

```markdown
## 素材与画像

- 用户素材在 `assets/`；明确要求使用时读取并传入制作流程。
- 对话附件由后端按会话隔离，并在本轮消息中提供唯一的“系统附件清单”。只能使用清单明确列出的路径，禁止扫描、枚举或猜测 `outputs/_inbox/` 中的其他文件。需要纳入项目时把清单文件复制到 `outputs/<项目>/assets/` 后使用，保留 inbox 原件以支持安全重试；不要向用户复述上传过程、附件清单或内部路径。
- 每个画像是 `easel-profiles/<画像>/` 下的一组 `identity/style/audience/platforms/preferences/memory.md`，代表一个跨平台人设。
```

> 注意措辞差异：AGENTS.md 用 `easel-profiles/<画像>/`（这是 OpenClaw workspace 里指向项目 `profiles/` 的软链名，见 `_repo/openclaw/sync.sh` 的 `PROFILE_LINK="$OPENCLAW_WORKSPACE_DST/easel-profiles"`），代码里一律用项目根下的 `profiles/`。

- 全局 `MEMORY.md` 被显式清空并禁用（`_repo/openclaw/sync.sh`：`: > "$OPENCLAW_WORKSPACE_DST/MEMORY.md"`；`AGENTS.md:94-95` 禁止读写它）。**仓库内不存在 `MEMORY.md`**。
- 历史全局 `USER.md` 已被移除（sync.sh 中 `rm -f "$OPENCLAW_WORKSPACE_DST/USER.md"`，`_repo/easel/persona.py:3-5` 注释说明改为消息内联注入）。

### 3.2 画像文件读写的代码入口

- `_repo/easel/persona.py`：CLI/Web/skill 三入口共用的画像助手（单一真相源）。
- `_repo/easel/cli.py:29-31`：`PROJECT_ROOT` / `PROFILES_DIR` / `PROFILE = "easel"`。
- `_repo/skills/shared/scripts/persona_gate.py`：发布前人设门禁的确定性部分。
- `_repo/skills/openclaw/skill-persona-check/SKILL.md`：LLM 侧评分 SKILL。
- `_repo/skills/openclaw/skill-profile-manager`、`_repo/skills/openclaw/skill-profile-builder`：画像写入/构建 SKILL（`api_profile_build` 调 `/skill-profile-builder`）。

### 3.3 `persona_gate.py` 读哪个文件、评分阈值、字段名

`_repo/skills/shared/scripts/persona_gate.py` 头 18 行逐字（关键契约）：

```python
"""persona_gate.py — 发布前人设提醒（确定性判定 + 落账）.

Easel 编排在执行任一发布层 SKILL 前，先由 `skill-persona-check`（LLM）比对
待发内容与画像，得到一致性评分与偏离点；本脚本只做两件确定性的事：
  1) check  —— 按阈值把评分判成 pass/warn；所有分数都允许继续发布；
  2) record —— 把人设校验结论结构化写进 `outputs/<主题>/.easel.json`（层间 manifest）。
...
退出码约定（供编排判断）：
  0 = 允许继续发布（pass / warn）；人设评分永不使用非零退出码拦截

子命令:
  check    --score N [--threshold 80] [--warn 50]
  record   --topic T --profile P --score N --verdict V [--deviations "..."]
  selftest
"""
```

- **读取/写入的文件**：`outputs/<主题>/.easel.json`（经 `import manifest as mf` 复用其 `manifest_path` / `load` / `_now_iso`；`persona_gate.py:24-27`）。
- **阈值**（`persona_gate.py:29-30`）：

```python
DEFAULT_THRESHOLD = 80   # 达标线：>= pass；低于该线统一 warn
DEFAULT_WARN = 50        # 兼容旧调用保留，不再产生阻断性 fail
```

- 判定函数（`persona_gate.py:33-36`）：`classify(score, threshold, warn)` → `score >= threshold` 返回 `"pass"`，否则 `"warn"`（`warn` 参数不再产生 fail）。
- `check` 输出 JSON 字段名（`persona_gate.py:42-51`）：`verdict` / `score` / `threshold` / `warn` / `pass` / `publish_allowed` / `warning`。
- `record` 写入的 step（`persona_gate.py:68-78`）：`layer="publish"`、`skill="persona-check"`、`at`、`status="done"`，`summary` 形如 `f"人设一致性 {args.verdict}（{args.score} 分）"`，有偏离时追加 `f"；偏离：{args.deviations}"`。
- `persona_gate.py check` 表现：任何分数都 `sys.exit(0)`（第 55 行）。

### 3.4 平台账号定义在哪里

- **平台注册表（代码）**：`_repo/web/app.py:218-227` `LOGIN_RUNNERS`（见第 4 节），是 7 平台的唯一权威清单（id → 中文名 / 后端类型 / 浏览器 profile 名）。
- **统计用平台表**：`_repo/skills/shared/scripts/account_stats.py` 的 `PLATFORMS` dict（含 profile 名、创作中心 URL、指标标签、URL 正则）。
- **日历平台名映射**：`_repo/skills/shared/scripts/calendar_ops.py` 的 `PLATFORM_NAMES`（6 个，不含 `wechat-oa`）：

```python
PLATFORM_NAMES = {
    "xiaohongshu": "小红书", "douyin": "抖音", "kuaishou": "快手",
    "weixin-channels": "微信视频号", "zhihu": "知乎", "bilibili": "B站",
}
```

- **归因可抓平台**：`_repo/web/app.py:3711` `ANALYTICS_PLATFORMS = {"xiaohongshu", "douyin", "kuaishou", "zhihu", "weixin-channels", "bilibili", "wechat-oa"}`。
- **用户账号信息（人写的）**：画像里的 `profiles/<画像>/platforms.md`（章节名即平台中文名：抖音 / 小红书 / B 站 / 知乎 / 微信公众号）。
- **凭证式账号**：`_repo/skills/openclaw/skill-wechat-publisher/wechat-publisher.yaml`（`accounts.<key>` 下 `name`/`app_id`/`app_secret`/`author`/`theme`/…；真实文件被 gitignore，仅 `.example` 入库）。

---

## 4. 七平台：登录态/凭证的磁盘位置与 gitignore

### 4.1 七平台标识（代码原文）

`_repo/web/app.py:218-227` 逐字：

```python
LOGIN_RUNNERS: dict[str, dict] = {
    "xiaohongshu": {"name": "小红书", "backend": "xhs", "profile": "XiaohongshuProfile"},
    "kuaishou": {"name": "快手", "backend": "web", "wp": "kuaishou", "profile": "KuaishouProfile"},
    "weixin-channels": {"name": "微信视频号", "backend": "web", "wp": "weixin-channels", "profile": "ChannelsProfile"},
    "zhihu": {"name": "知乎", "backend": "web", "wp": "zhihu", "profile": "ZhihuProfile"},
    "bilibili": {"name": "B站", "backend": "biliup"},
    "douyin": {"name": "抖音", "backend": "douyin", "profile": "DouyinProfile"},
    # 微信公众号：扫码登录后台会话（发布+数据都走它），backend=='wechat-oa' 在各处单独分支处理。
    "wechat-oa": {"name": "微信公众号", "backend": "wechat-oa"},
}
```

### 4.2 三种登录态存储形态

**(A) Playwright 持久化浏览器 profile 目录（5 个平台）**

根目录常量：`_repo/web/app.py:202` `BROWSER_PROFILES = Path.home() / ".easel-browser-profiles"`，以及各脚本的 `_profile_dir(base)`：

```python
root = Path(base).expanduser() if base else Path.home() / ".easel-browser-profiles"
return root / PROFILE_NAME
```

（`_repo/skills/shared/scripts/xhs_publish.py:127-129`、`web_publisher.py:296-298`、`douyin_publish.py:136-138`、`account_stats.py:337-339`、`xhs_comment.py:130-132`、`weixin_mp_stats.py:57-59`）

| 平台 | 目录（默认） | profile 常量位置 |
|------|--------------|------------------|
| xiaohongshu | `~/.easel-browser-profiles/XiaohongshuProfile` | `_repo/skills/shared/scripts/xhs_publish.py:77` `PROFILE_NAME = "XiaohongshuProfile"`；`xhs_comment.py:25` 同值 |
| douyin | `~/.easel-browser-profiles/DouyinProfile` | `_repo/skills/shared/scripts/douyin_publish.py:74` |
| zhihu | `~/.easel-browser-profiles/ZhihuProfile` | `_repo/skills/shared/scripts/zhihu_answer.py:36`、`zhihu_comments_fetch.py:14`（`PROFILE_DIR = Path.home() / ".easel-browser-profiles" / "ZhihuProfile"`） |
| kuaishou | `~/.easel-browser-profiles/KuaishouProfile` | `_repo/skills/shared/scripts/web_publisher.py`（按 `--platform kuaishou` 经 `_profile_dir` 解析）+ `account_stats.py` `PLATFORMS["kuaishou"]["profile"]` |
| weixin-channels | `~/.easel-browser-profiles/ChannelsProfile` | 同上（`PLATFORMS["weixin-channels"]["profile"]`） |
| wechat-oa（后台会话） | `~/.easel-browser-profiles/WeixinMpProfile` | `_repo/skills/shared/scripts/weixin_mp_stats.py:34` `PROFILE_NAME = "WeixinMpProfile"` |

其它与该目录同级的本机状态：
- `_repo/skills/shared/scripts/xhs_publish.py:150-155` `_ProfileLock` 锁文件：`<profile>/.easel.lock`（同一 profile 不能并发开两个内核）。
- 小红书内核另在 `~/.cloakbrowser/chromium-*/chrome.exe`（`_repo/skills/shared/scripts/xhs_publish.py:138-146`；可用 `EASEL_CLOAK_BROWSER` 覆盖）。

**这些目录完全在 git 仓库之外**（`Path.home()`），仓库里没有它们的副本；`.gitignore` 也没有（也不需要）对应规则。本机实测 `~/.easel-browser-profiles` **当前不存在**（`ls: cannot access '/data/dsh/home/.easel-browser-profiles': No such file or directory`），即此克隆从未登录过任何平台。

**(B) `cookies.json`（bilibili）**

- 路径：**项目根下的 `cookies.json`**（`PROJECT_ROOT / "cookies.json"`）。
  - 默认输出：`_repo/skills/shared/scripts/bili_login.py:36` `DEFAULT_COOKIE = PROJECT_ROOT / "cookies.json"`。
  - 消费方：`_repo/web/app.py:3390`（`bili_login.py login --cookie <root>/cookies.json`）、`:3604`（`whoami`）、`:3732`（`stats`）、`:3909`（`biliup -u <root>/cookies.json upload ...`）。
  - 格式：biliup 兼容的 cookie JSON（TV 端扫码登录产出 token_info/cookie_info，`bili_login.py:1-11`）。
- **该文件在仓库内路径上，但在版本控制外**：`_repo/.gitignore:59-60`：

```
# 登录态 / 凭证（绝不入库——含 SESSDATA 等 token）
cookies.json
```

实测 `git check-ignore -v cookies.json` → `.gitignore:60:cookies.json	cookies.json`。当前仓库内**不存在** `cookies.json` 文件（未登录）。

**(C) 登录状态标记与二维码（`outputs/_login/`）**

`_repo/web/app.py:203` `LOGIN_DIR = OUTPUTS_DIR / "_login"`。协议实现 `_repo/skills/shared/scripts/login_state.py`：

- 状态文件：`outputs/_login/<platform>.json`，原子写，内容（`login_state.py:46`）：

```python
data = {"state": state, "message": message, "qr": qr, "ts": int(time.time())}
```

- 状态机取值（`login_state.py:18-19`）：

```python
STATES = ("starting", "qr_ready", "scanned", "sms_required", "verifying",
          "success", "expired", "error")
```

- 二维码文件：`outputs/_login/<platform>.png`（`_repo/web/app.py:3340` `data['qr'] = f'_login/{platform}.png'`；小红书默认另名 `outputs/_login/xhs-login-qrcode.png`，见 `_repo/skills/shared/scripts/xhs_publish.py:79`）。
- 短信验证码一次性文件：`outputs/_login/<platform>.code`（纯数字，读到即删，`login_state.py:22-39` `read_sms_code`）。
- 日志：`outputs/_login/<platform>.log`（`_repo/web/app.py:3337`）。
- 微信公众号后台专用名：`wechat-oa-mp.json` / `wechat-oa-mp.png` / `wechat-oa-mp.log`（`_repo/web/app.py:3516`、`:3513`；LOGIN_PROCESSES 键 `wechat-oa-mp`）。
- 失败截图：`outputs/_login/xhs-publish-fail.png`（`_repo/skills/shared/scripts/xhs_publish.py:445`）。

`outputs/` 整体被 `.gitignore:35-36` 忽略（`outputs/**/*` + `!outputs/**/.gitkeep`），故 `_login/` 不进版本控制。

- 退出登录会删除什么（`_repo/web/app.py:3651-3700`）：持久化浏览器 profile 目录 + 登录状态/二维码/头像文件；bilibili 额外删 `cookies.json`（`_repo/web/app.py:3692-3695`）。

**(D) 异步发布状态：`outputs/_publish/`**

`_repo/web/app.py:204` `PUBLISH_DIR = OUTPUTS_DIR / "_publish"`。文件：
- `outputs/_publish/<platform>.json` 状态（`_repo/web/app.py:3784`）、`outputs/_publish/<platform>.code` 短信验证码（`:3869`；抖音用 `douyin.json` / `douyin.code`，`:3919-3920`）。
- 微信中间文件：`outputs/_publish/wechat-oa-<12位hex>.md` 与 `.html`（`_repo/web/app.py:3935-3936`）。

### 4.3 是否会误入版本控制

结论：**当前不会**，四条路径规则覆盖全部登录态与凭证来源。实测 `git check-ignore -v` 结果：

| 检查对象 | 结果 |
|----------|------|
| `cookies.json` | `.gitignore:60:cookies.json` |
| `profiles/foo/identity.md` | `.gitignore:63:profiles/*/` |
| `outputs/bar/.easel.json` | `.gitignore:35:outputs/**/*` |
| `outputs/_ideas.json` | `.gitignore:35:outputs/**/*` |
| `.env` | `.gitignore:12:.env` |

`_repo/.gitignore:62-64` 原文：

```
# Local account profiles (publish only the reusable template)
profiles/*/
!profiles/_template/
!profiles/_template/**
```

`_repo/.gitignore:70-71` 原文（公众号凭证）：

```
# 公众号发布器用户凭证配置（含 AppID/AppSecret），只提交 .example 模板
skills/openclaw/skill-wechat-publisher/wechat-publisher.yaml
```

> 风险提示（事实陈述，非建议）：`.gitignore` 的 `cookies.json` 是**无路径锚定的模式**，匹配任意层级同名文件；画像/产物/凭证均已覆盖。仓库内唯一的 `.gitignore` 是根文件，另有 `_repo/web/frontend/.gitignore` 与 `_repo/skills/openclaw/video-production/vendor/video-pipeline-sdk/.gitignore`（均与登录态无关）。

---

## 5. 选题库与热点/趋势数据

### 5.1 选题库（topic library）

**没有独立的 `topics.json`；选题库就是 `outputs/_ideas.json`。**

- 路径常量：`_repo/web/app.py:4332` `IDEAS_FILE = OUTPUTS_DIR / "_ideas.json"`。
- 格式：**顶层 JSON 数组**（`_read_ideas()` 返回 `d if isinstance(d, list) else []`，`_repo/web/app.py:4336-4344`）。
- 写入：`json.dumps(items, ensure_ascii=False, indent=2)` + `tmp.replace()`（`_repo/web/app.py:4346-4350`）。
- 状态取值（`_repo/web/app.py:4333`）：`IDEA_STATUSES = {"pending", "doing", "done"}`。
- 请求模型 `IdeaItem`（`_repo/web/app.py:4353-4357`）：`title: str`、`note: str = ""`、`source: str = ""`、`status: str = "pending"`。
- 单条落盘对象（`_repo/web/app.py:4368-4376`，插入到数组头部）：

```python
item = {
    "id": uuid.uuid4().hex[:12],
    "title": req.title.strip() or "未命名选题",
    "note": req.note,
    "source": req.source,
    "status": st,
    "created": int(time.time()),
}
```

- 该文件在 `PROTECTED_OUTPUTS` 中，内容库删除接口不可删（`_repo/web/app.py:3144`、`:3197`）。
- 相关 SKILL 只做「生成/评估选题」，不落新库：`_repo/skills/openclaw/skill-topic-evaluator`（七维打分，共享口径 `_repo/skills/shared/scoring-dimensions.md`）、`_repo/skills/openclaw/skill-content-matrix`（批量选题池）。

### 5.2 内容日历（排期/活动）

- 文件：`outputs/_schedule.json`，顶层 JSON 数组。
- 定义：`_repo/web/app.py:4220` `SCHEDULE_FILE = OUTPUTS_DIR / "_schedule.json"`；`_repo/skills/shared/scripts/calendar_ops.py` `DEFAULT_DATA = PROJECT_ROOT / "outputs" / "_schedule.json"`（同一文件，读写同源）。
- 请求模型 `ScheduleItem`（`_repo/web/app.py:4242-4252`）：`title`、`date`、`platform`、`time`、`status`、`note`、`kind`、`url`、`source`、`event_type`、`end_date`。
- 取值域（`_repo/web/app.py:4221-4222`）：`SCHEDULE_STATUSES = {"idea", "draft", "scheduled", "published"}`；`SCHEDULE_KINDS = {"content", "event"}`。
- `source` 取值（`_repo/web/app.py:4251` 注释）：`manual | publish-page | chat | scheduler`。
- 单条落盘额外带 `id = uuid.uuid4().hex[:12]`（`_repo/web/app.py:4257-4262`；发布成功回流记录见 `_repo/web/app.py:3976-3984`）。
- `calendar_ops.py` 另有 `SOURCES` 校验集与 `record-publish` / `add-event` / `import-events` / `upcoming` / `context` / `list` 子命令；发布自动记录可用 `EASEL_CALENDAR_AUTORECORD=0` 关闭。

### 5.3 热点/趋势（trend）

**趋势源配置写在代码里，不是配置文件。**

`_repo/web/app.py:4137-4144` 逐字：

```python
TREND_SOURCES: dict[str, tuple[str, str | None]] = {
    "weibo": ("https://60s.viki.moe/v2/weibo", "https://v2.xxapi.cn/api/weibohot"),
    "douyin": ("https://60s.viki.moe/v2/douyin", "https://v2.xxapi.cn/api/douyinhot"),
    "zhihu": ("https://60s.viki.moe/v2/zhihu", None),
    "bilibili": ("https://60s.viki.moe/v2/bili", "https://v2.xxapi.cn/api/bilibilihot"),
    "baidu": ("https://60s.viki.moe/v2/baidu/hot", "https://v2.xxapi.cn/api/baiduhot"),
    "toutiao": ("https://60s.viki.moe/v2/toutiao", None),
}
```

（结构为 `平台 → (主源, 备源)`；Web 接口 `_repo/web/app.py:4183`、`:4198` 按 `platforms` 逗号串过滤，只有命中 `TREND_SOURCES` 的才走该源。）

- 趋势数据**不落盘**（按请求抓取返回）。
- SKILL 侧文档与源清单：
  - `_repo/skills/openclaw/skill-trending-topics/SKILL.md`（实时热搜 → 二创选题；只允许使用其中列出的已验证公益 API，明确禁止 web_fetch weibo/zhihu/douyin/tophub）。
  - `_repo/skills/openclaw/skill-rss-aggregator/SKILL.md` + `scripts/rss_digest.py`（RSS/Newsletter 聚合；`--feeds` 传每行一个 URL 的列表文件，`#` 为注释；纯标准库）。
  - `_repo/skills/openclaw/skill-trend-rider`、`_repo/skills/openclaw/skill-news-intelligence`。
- RSS 订阅源列表**由用户以文本文件提供**（`--feeds <文件>`，每行一个 URL），仓库内没有预置 feeds 文件。
- 事件日历（节日/大促/平台活动）落在同一个 `outputs/_schedule.json`（`kind="event"`，`calendar_ops.py import-events`）。

### 5.4 归因/发布记录

- `outputs/_analytics/publish-log.json`（`_repo/skills/openclaw/skill-publish-log/scripts/log.py:30` `DEFAULT_DATA`），旧路径 `outputs/publish-log.json`（`:31` `LEGACY_DATA`）。
- `outputs/_publish.log`：追加式纯文本，每段以 `===== YYYY-MM-DD HH:MM:SS <platform> rc=... ok=... =====` 起头（`_repo/web/app.py:3966-3975`）。

---

## 6. `pyproject.toml` 与 `pytest.ini`

### 6.1 `_repo/pyproject.toml` 全文逐字（46 行）

```toml
[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.build_meta"

[project]
name = "easel"
version = "0.2.1"
description = "社媒内容工作流整合层 — Easel CLI"
requires-python = ">=3.10"
# 运行依赖统一安装，确保 Web、媒体处理和浏览器发布开箱可用。
dependencies = [
    "fastapi>=0.115,<1",        # Web 后端
    "uvicorn>=0.30,<1",         # ASGI server（easel web）
    "sse-starlette>=2.1,<4",    # 对话流式 SSE
    "httpx>=0.27,<1",           # 对话直连常驻网关（EASEL_CHAT_TRANSPORT=http）的 SSE 客户端
    "pydantic>=2.7,<3",         # 请求模型
    "segno>=1.6,<2",             # B站扫码登录二维码渲染（纯 Python）
    "python-multipart>=0.0.9,<1", # FastAPI 文件上传 / Form
    "Pillow>=10,<13", "opencv-python>=4.8,<5", "numpy>=1.26,<3",
    "pandas>=2,<4", "matplotlib>=3.8,<4", "librosa>=0.10,<1",
    "faster-whisper>=1,<2", "edge-tts>=6,<8", "playwright>=1.45,<2",
    "rembg>=2.0,<3", "biliup>=1,<2", "jieba>=0.42,<1", "snownlp>=0.12,<1",
    "markdown>=3.5,<4",
    # ask_user 问答题桥接（easel/gateway_questions.py）：连本地 gateway WS RPC + Ed25519 设备签名
    # 只用到 load_pem_private_key + Ed25519.sign（长期稳定 API），上界放宽避免与新版冲突
    "websocket-client>=1.7,<2",
    "cryptography>=42",
]

[project.scripts]
easel = "easel.cli:main"

[tool.setuptools.packages.find]
include = ["easel*"]
```

要点：
- **Python 版本要求：`requires-python = ">=3.10"`**。
- 包名 `easel`，版本 `0.2.1`，入口 `easel = "easel.cli:main"`。
- **没有 `[project.optional-dependencies]` 段**（全文无 optional-dependencies）；也没有 `[tool.*]` 配置段（仅 `tool.setuptools.packages.find`）。
- 全部为必需依赖（21 个条目，含注释行；`Pillow/opencv-python/numpy` 与 `pandas/matplotlib/librosa` 各挤在一行）。

### 6.2 `_repo/pytest.ini` 全文逐字（2 行）

```ini
[pytest]
addopts = --import-mode=importlib
```

---

## 7. 七平台：id、登录脚本、发布脚本、统计脚本

命令分派权威位置：登录 `_repo/web/app.py:3363-3399`（通用）、`:3541-3571`（微信后台专用）、`:3441-3499`（短信）；发布 `_repo/web/app.py:3901-3955`；统计 `_repo/web/app.py:3723-3742`。

| # | 平台标识（id） | 中文名 | 登录脚本 | 发布脚本 | 统计/数据脚本 |
|---|----------------|--------|----------|----------|----------------|
| 1 | `xiaohongshu` | 小红书 | `_repo/skills/shared/scripts/xhs_publish.py`（`login` 子命令；QR 默认落 `outputs/_login/xhs-login-qrcode.png`） | `_repo/skills/shared/scripts/xhs_publish.py`（`publish` / `publish-video`） | `_repo/skills/shared/scripts/account_stats.py fetch --platform xiaohongshu` |
| 2 | `douyin` | 抖音 | `_repo/skills/shared/scripts/douyin_publish.py`（`login`） | `_repo/skills/shared/scripts/douyin_publish.py`（`publish` / `publish-video`，支持 `--status-file` / `--sms-code-file` 短信墙） | `_repo/skills/shared/scripts/account_stats.py fetch --platform douyin` |
| 3 | `kuaishou` | 快手 | `_repo/skills/shared/scripts/web_publisher.py`（`login --platform kuaishou`） | `_repo/skills/shared/scripts/web_publisher.py publish --platform kuaishou` | `_repo/skills/shared/scripts/account_stats.py fetch --platform kuaishou` |
| 4 | `weixin-channels` | 微信视频号 | `_repo/skills/shared/scripts/web_publisher.py`（`login --platform weixin-channels`） | `_repo/skills/shared/scripts/web_publisher.py publish --platform weixin-channels` | `_repo/skills/shared/scripts/account_stats.py fetch --platform weixin-channels` |
| 5 | `zhihu` | 知乎 | `_repo/skills/shared/scripts/web_publisher.py`（`login --platform zhihu`） | `_repo/skills/shared/scripts/web_publisher.py publish --platform zhihu`（另有 `_repo/skills/shared/scripts/zhihu_answer.py`） | `_repo/skills/shared/scripts/account_stats.py fetch --platform zhihu`（评论抓取另有 `zhihu_comments_fetch.py`，profile 目录硬编码 `ZhihuProfile`） |
| 6 | `bilibili` | B站 | `_repo/skills/shared/scripts/bili_login.py`（`login` / `check` / `whoami` / `stats`；写 `PROJECT_ROOT/cookies.json`，纯 stdlib + segno，不起浏览器） | `biliup` CLI（`biliup -u <root>/cookies.json upload <video> --title ... --tid 36 --copyright 1 --tag ...`；由 `_repo/web/app.py:3904-3914` 直接拼装，无 Python 包装） | `_repo/skills/shared/scripts/bili_login.py stats --cookie <root>/cookies.json` |
| 7 | `wechat-oa` | 微信公众号 | `_repo/skills/shared/scripts/weixin_mp_stats.py`（`login`，mp 后台扫码；profile `WeixinMpProfile`；Web 内部进程键 `wechat-oa-mp`） | `_repo/skills/shared/scripts/weixin_mp_stats.py publish --html ... --cover ...`（正文先经 `skills/openclaw/skill-wechat-publisher/scripts/html_converter.py` MD→HTML） | `_repo/skills/shared/scripts/weixin_mp_stats.py stats --proxy ... --count 20` |

补充事实：
- 需要媒体的平台集合（`_repo/web/app.py:3748`）：`MEDIA_REQUIRED = {"xiaohongshu", "douyin", "kuaishou", "weixin-channels", "bilibili"}`；仅视频的平台 `VIDEO_ONLY_PUBLISH` 含 bilibili（`_repo/web/app.py:3896` 分支）。
- 通用 web 发布器 `_repo/skills/shared/scripts/web_publisher.py` 顶部有登录态目录提示：`登录态目录：~/.easel-browser-profiles/<平台>Profile`（`:344`）。
- 平台 profile 目录名的另一处权威映射是 `_repo/skills/shared/scripts/account_stats.py` 的 `PLATFORMS[platform]["profile"]`（xiaohongshu/douyin/kuaishou/zhihu/weixin-channels 各一项）。
- `skill-my-account` 明确其覆盖范围：whoami 支持小红书/抖音/知乎/快手/视频号；`account_stats fetch --platform` 支持 `xiaohongshu` / `douyin` / `kuaishou` / `zhihu` / `weixin-channels`（`_repo/skills/openclaw/skill-my-account/SKILL.md`「支持平台」段）。

---

## Uncertainties（未能确定/需注意）

1. **没有真实数据样本**：`outputs/` 仅 `.gitkeep`、`profiles/` 仅 `_template/`、本机不存在 `~/.easel-browser-profiles`、不存在 `cookies.json`。所有序列化示例中的**具体值**（除代码 selftest 断言值外）均为从代码合成，已在第 2.4 节标注为推断。
2. **`outputs/_sessions/` 的单文件命名与内部 schema** 未追到底（只知道 `_repo/web/app.py:207` 的注释「每会话最近一轮的完整结果，供 SSE 连接中断后前端取回」）。
3. **`outputs/analytics/`（无下划线）** 的实际文件布局未展开（仅确认它在 `SYSTEM_TOPLEVEL_DIRS` 中被内容库排除；新归因数据写 `outputs/_analytics/`）。
4. **`meta.json`（项目级旧格式）** 只说得出 `migrate_outputs.py` 会读 `title` / `summary` / `platform` / `tags` / `cover_image` 并回填；其完整字段集与是否仍有存量使用者未确认。
5. **公众号 `wechat-publisher.yaml` 的最终解析路径**：`ImageHandler` 里有 `MANIFEST_FILENAME = ".uploaded_manifest.json"`（`_repo/skills/openclaw/skill-wechat-publisher/scripts/image_handler.py:37`，落在临时目录），但该 YAML 的默认查找根目录与多账号选择逻辑未逐行追证。
6. **`wechat-oa` 不在 `calendar_ops.PLATFORM_NAMES`**（只有 6 项）——日历记录微信公众号发布时用的是 `LOGIN_RUNNERS['wechat-oa']['name']`（中文名直接写入 `platform` 字段），映射不一致的性质未进一步判定。
7. 本报告未覆盖 `assets/`（被 `.gitignore` 全忽略，仅保留 README 展示素材白名单）、`tests/`、`web/frontend/` 前端状态（localStorage 键 `easel_whoami`）与 OpenClaw 运行时目录（`~/.openclaw-easel/`、`~/.openclaw/workspace-easel/`）的详细结构。
