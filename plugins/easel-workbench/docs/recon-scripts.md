# Easel 可执行接口勘察报告（read-only recon）

勘察对象：`/data/dsh/home/dsh-hub/Easel/_repo`（upstream 项目 "Easel"，HEAD = `fb80ae6`）。
全文只记录事实与文件路径；除注明外，路径均相对仓库根 `_repo/`。
本报告只覆盖**可执行接口**（脚本 CLI、函数契约、HTTP 路由、SKILL.md frontmatter）；磁盘数据格式见同目录 `recon-data.md`。

方法：只读 `read` / `grep` / `glob` / `bash`（ls、find、wc、awk、sed、grep）。**未运行任何脚本**，所有 CLI/退出码结论来自源码静态阅读。
`_repo/` 内**未做任何修改**。

---

## 0. 总览：可执行入口

| 入口 | 位置 | 形态 |
|---|---|---|
| 共享工具脚本 | `skills/shared/scripts/*.py` | 48 个 `.py`，其中 44 个是 argparse CLI，3 个纯库，1 个只带 selftest |
| 各平台发布脚本 | `skills/shared/scripts/{xhs_publish,douyin_publish,web_publisher,zhihu_answer}.py`、`skills/openclaw/skill-bilibili-upload/scripts/bili_upload.py`、`skills/openclaw/skill-wechat-publisher/scripts/publish.py` | CLI |
| 跨平台派发 | `skills/openclaw/skill-cross-platform-publish/scripts/publish_dispatch.py` | CLI（纯离线规划） |
| Web 后端 | `web/app.py` | FastAPI，**65 条路由** + 1 个 HTTP middleware |
| Python 包 CLI | `easel/cli.py` | `easel`（console_scripts 唯一入口） |
| OpenClaw 接入 | `openclaw/sync.sh` | bash |
| SKILL 定义 | `skills/openclaw/<114 个目录>/SKILL.md` | YAML frontmatter |

**环境事实**：本机 shell **没有 `python3`**（`python3: command not found`），我无法执行任何脚本或跑 `--selftest`。所有脚本 docstring 与 SKILL 文档里写的调用形式都是 `python3 <path> ...`（少数写 `python`）。这是**本环境的限制，不是仓库的事实**。

---

## 1. `skills/shared/scripts/` — 全量清单

48 个 `.py` 文件（行数为 `wc -l`）：

| 文件 | 行数 | 一句话用途 |
|---|---|---|
| `account_stats.py` | 943 | 归因层：Playwright 抓已登录账号创作数据 |
| `ai_image.py` | 845 | AI 生图（文生图/图生图/变体，多 provider） |
| `ai_music.py` | 508 | AI 音乐/BGM 生成（多 provider，异步轮询） |
| `ai_video.py` | 867 | AI 视频生成（文/图生视频，多 provider） |
| `asr.py` | 485 | 语音识别 → srt/ass/txt/json（faster-whisper） |
| `audio_mix.py` | 235 | 旁白+BGM+音效混音（含 ducking） |
| `audio_ops.py` | 481 | 通用音频处理（trim/convert/normalize/extract/concat/fade/speed/denoise） |
| `audio_viz.py` | 262 | 音频可视化视频（waves/bars/spectrum/cqt） |
| `batch_process.py` | 182 | 目录级批量套用同一操作 |
| `beatsync.py` | 288 | 音乐卡点视频（librosa 节拍检测） |
| `bili_login.py` | 332 | B站扫码登录（TV QR API → biliup cookie） |
| `calendar_ops.py` | 595 | 统一内容日历底座（确定性读写/读回） |
| `chromakey.py` | 233 | 绿幕抠像/换背景 |
| `content_guard.py` | 437 | **出站内容安全闸门**（扫描/脱敏） |
| `doc_convert.py` | 188 | Markdown → HTML/PDF/PNG |
| `douyin_publish.py` | 1500 | 抖音发布（Playwright） |
| `fix_timing.py` | 155 | 基于 SRT + shots.json lines 修正时序 |
| `highlight_cut.py` | 276 | 长视频高光切片（能量分析） |
| `human_pace.py` | 53 | **纯库**：拟人节奏延时 |
| `image_ops.py` | 665 | 图片操作（resize/crop/pad/convert/compress/watermark/round/collage/thumbnail） |
| `img_enhance.py` | 182 | 图片增强/放大/变清晰 |
| `install_tool.py` | 603 | 外部工具探测与安装 |
| `intro_outro.py` | 427 | 视频片头/片尾卡片生成与拼接 |
| `login_state.py` | 69 | **纯库**：登录状态文件协议（跨 web_publisher/xhs_publish 共享） |
| `manifest.py` | 395 | 层间产物契约（确定性读写） |
| `meme_ops.py` | 262 | 表情包/梗图生成 |
| `mindmap.py` | 168 | Markdown 大纲 → 思维导图 HTML/PNG |
| `model_registry.py` | 274 | 查询已配置的媒体模型 provider（不输出密钥） |
| `multivoice.py` | 1057 | 多角色配音（cast + dub） |
| `output_paths.py` | 97 | 校验 Easel outputs 路径规约 |
| `persona_gate.py` | 186 | 发布前人设提醒（阈值判定 + 落账，**不阻断发布**） |
| `platform_readback.py` | 877 | **纯库**：平台读回核验（抖音/快手/B站） |
| `reframe.py` | 270 | 视频画幅转换（blur/crop/smart） |
| `remove_bg.py` | 212 | 图片去背景（rembg） |
| `render_card.py` | 196 | HTML → 图片确定性渲染（playwright） |
| `slideshow.py` | 340 | 图片相册 → 视频 |
| `social_stats.py` | 333 | 归因层统计纯函数库（stdlib only） |
| `subtitle_ops.py` | 569 | 字幕解析/提取/合并/构建/转换/烧录 |
| `tts.py` | 476 | 文字转语音（closed/edge） |
| `video_ops.py` | 768 | 视频操作（cut/concat/speed/silence-cut/text） |
| `voice_clone.py` | 636 | 声音克隆（enroll + clone） |
| `web_publisher.py` | 1479 | **Web 发布器**：快手 / 视频号 / 知乎 |
| `weixin_mp_stats.py` | 800 | 微信公众号后台数据回收 + 建草稿 |
| `wordcount.py` | 197 | 字数统计与目标校验 |
| `xhs_comment.py` | 1104 | 小红书评论抓取+回复 |
| `xhs_publish.py` | 1064 | 小红书发布 |
| `zhihu_answer.py` | 353 | 知乎问题回答发布（**扁平参数，无子命令**） |
| `zhihu_comments_fetch.py` | 104 | 知乎文章评论抓取 |

**非 CLI（无 `if __name__ == "__main__"`）**：`human_pace.py`、`login_state.py`、`platform_readback.py`。
**只有 selftest 的 `__main__`（0 个 `add_argument`）**：`social_stats.py`。
其余 **44 个** 是 argparse CLI。

**统一约定（44 个 CLI 中的绝大多数）**：
```python
ap = argparse.ArgumentParser(...)
sub = ap.add_subparsers(dest="cmd")            # 少数用 dest="command" / required=True
...
ap.set_defaults(func=cmd_xxx)                  # 每个子命令绑一个 cmd_* 函数
a = ap.parse_args()
return a.func(a)                               # main() -> int
if __name__ == "__main__":
    sys.exit(main())
```
失败一律走 `_die(msg, code)`：`print(f"ERROR: {msg}", file=sys.stderr); sys.exit(code)`（默认 code=1）。`selftest` 子命令成功时 `print("✅ selftest 通过（...）")` 并 return 0。

### 1.1 十个核心脚本的确切接口

#### ① `skills/shared/scripts/content_guard.py`（437 行）
```bash
python3 skills/shared/scripts/content_guard.py scan   [--text T | --file F]
python3 skills/shared/scripts/content_guard.py redact [--text T | --file F] [--out OUT]
python3 skills/shared/scripts/content_guard.py selftest
```
- `scan` 的 `--text/--file` 是互斥组（`add_mutually_exclusive_group`），`help="扫描文本：有敏感(BLOCK)命中退出 7，仅 AI 措辞(WARN)退出 0"`。都不给则读 stdin（`_read_input`）。
- `redact`：脱敏文本写 `--out`，否则 stdout；命中 span 被替换为字面量 `"[已隐藏]"`，从右往左替换。
- stdout/stderr 契约见 §3。
- **退出码**：`scan` → 有 BLOCK 类命中退出 **7**（`EXIT_LEAK`），只有 WARN 或零命中退出 **0**；`redact` → 0；`selftest` → 失败 1、成功 0。
- `if __name__ == "__main__": sys.exit(main())`。

#### ② `skills/shared/scripts/persona_gate.py`（186 行）
```bash
python3 skills/shared/scripts/persona_gate.py check  --score N [--threshold 80] [--warn 50]
python3 skills/shared/scripts/persona_gate.py record --score N --verdict {pass,warn} [--topic T] [--data D] [--profile P] [--deviations "..."]
python3 skills/shared/scripts/persona_gate.py selftest
```
- `DEFAULT_THRESHOLD = 80`，`DEFAULT_WARN = 50`。
- `classify(score, threshold, warn)`：`score >= threshold` → `"pass"`，否则 `"warn"`（**warn 参数保留兼容，永远不会产生阻断性 fail**）。
- `check` stdout = `json.dumps(result, ensure_ascii=False, indent=2)`，键：`verdict, score, threshold, warn, pass(恒 True), publish_allowed(恒 True), warning(bool)`。
- **退出码：`check` 永远 `sys.exit(0)`** —— 人设分从不阻断发布。
- `record` 写入 manifest 的 publish 层，skill 名 `"persona-check"`，status `"done"`，附 `persona_check` 对象 `{score, verdict}`。
- selftest 输出 `persona_gate.py selftest: OK`。

#### ③ `skills/shared/scripts/login_state.py`（69 行，**无 CLI**）
登录状态文件协议，被 `web_publisher.py` / `xhs_publish.py` 共享。Python API：
```python
STATES = ("starting","qr_ready","scanned","sms_required","verifying","success","expired","error")
read_sms_code(path) -> str     # 约定路径 outputs/_login/<platform>.code；读一次即消费；无则 ""
read_status(path)  -> dict     # 缺失/损坏时返回 {"state":"unknown","message":"","qr":"","ts":0}
```
原子写；docstring 状态机：`starting → qr_ready → [scanned] → [sms_required → verifying] → success|expired|error`。

#### ④ `skills/shared/scripts/platform_readback.py`（877 行，**无 CLI**）
纯库。`ReadbackResult.outcome` 四值（源码注释逐字）：`verified | unverified | login_required | readback_error`。
类：`WorkItem`(L41)、`ReadbackResult`(L59)、`LoginRequiredError(RuntimeError)`(L76)。
关键函数（行号）：
- 抖音：`read_douyin_works(page, limit=20, evaluate_retries=3)` L162、`read_douyin_account(page)` L247、`capture_douyin_snapshot(page)` L297、`find_published_work(works, title, ...)` L308、`verify_douyin_publish(page, *, title, since_ms=None, ...)` L334。`DOUYIN_MANAGE_URL = "https://creator.douyin.com/creator-micro/content/manage"`；靠页内 fetch `work_list` 读。
- 快手：`_kuaishou_assert_logged_in(page)` L573、`read_kuaishou_works(page, limit=20, wait_ms=25000)` L597、`read_kuaishou_account` L653、`capture_kuaishou_snapshot` L667、`verify_kuaishou_publish` L677（截获页面自身 XHR）。
- B站（无浏览器，cookie 文件）：`_bilibili_load_cookies` L737、`_bilibili_api` L756、`_bilibili_assert_logged_in` L775、`read_bilibili_works(cookie_file, limit=20)` L803、`read_bilibili_account` L826、`capture_bilibili_snapshot` L832、`verify_bilibili_publish(cookie_file, *, title, since_ms=None, ...)` L841。
- 判定 = 标题前缀 + `since_ms` 时间窗 + 排除快照 id；平台侧无证据时**保持 `unverified`**。
- outcome 语义（docstring 逐字）：`verified 读回对上（标题前缀 + since 时间窗）——附带作品 id 与状态为准`；`unverified 读回通了但多轮未见新作品（索引延迟/审核队列等，保留待查）`；`login_required 读回时登录态已失效——明确报「需重新登录」`；`readback_error 读回通道本身失败（网络/页面结构改版），附原始证据`。
- **Non-goals**：不管登录、不碰凭据、不写状态文件。

#### ⑤ `skills/shared/scripts/output_paths.py`（97 行）
```bash
python3 skills/shared/scripts/output_paths.py <path> [--system]
```
`--system` help：`允许已注册的系统路径`。`main()` 把 `validate_output_path(path, allow_system=...)` 的结果**打印到 stdout 并 return 0**；`if __name__ == "__main__": raise SystemExit(main())`。
违规抛 `OutputPathError`，消息逐字：`不能写入 outputs/ 下的隐藏路径`、`内容产物不能写入系统路径`、`f"未注册的系统输出项: {top}"`、`内容产物必须写入 outputs/<具体主题>/，不能散落在根目录`、`f"项目目录名过于泛化: {top}"`。异常未捕获 → 进程非 0 退出。
另有 `validate_project_dir(value, create=False)`；常量 `SYSTEM_DIRS / SYSTEM_FILES / GENERIC_PROJECT_NAMES`。

#### ⑥ `skills/shared/scripts/manifest.py`（395 行）
```bash
python3 skills/shared/scripts/manifest.py record  --topic T --layer L --skill S [--data D] [--status done] [--profile P] [--outputs O] [--upstream U] [--summary S]
python3 skills/shared/scripts/manifest.py meta    [--topic T] [--data D] [--profile P] [--title T] [--summary S] [--platform P] [--kind K] [--status S] [--tags ...] [--cover C] [--deliverables ...]
python3 skills/shared/scripts/manifest.py read    [--topic T] [--data D]
python3 skills/shared/scripts/manifest.py latest  [--topic T] [--data D] [--layer L]
python3 skills/shared/scripts/manifest.py selftest
```
- `--layer` choices=`LAYERS`；`--status` choices=`STATUSES`，record 默认 `"done"`；`--kind` choices=`KINDS`；meta 的 `--status` choices=`PROJECT_STATUSES`。
- 成功统一 `print(json.dumps(...))` 到 stdout：record → `{"ok": true, "topic": ..., ...}`(L156)；meta → `{"ok": true, "topic": ..., "meta": header}`(L203)；read → `json.dumps(data, indent=2)`(L215)；latest 未命中 → `{"found": false, "layer": L}` 且 **`sys.exit(1)`**，命中 → `{"found": true, ...}`(L225-227)。
- 参数错误用 `sys.exit("错误：...")`（字符串参数 → 退出码 1），如 `--topic` 和 `--data` 都缺、`--kind` 非法、`--status` 非法、manifest 不存在。
- `main(argv=None) -> None`；`selftest` 走 `sys.exit(_selftest())`（L390），成功打印 `manifest.py selftest: OK`。

#### ⑦ `skills/shared/scripts/calendar_ops.py`（595 行）
```bash
python3 skills/shared/scripts/calendar_ops.py record-publish --platform P --title T [--url U] [--type ...] [--tags ...] [--note ...] [--source chat] [--no-log]
python3 skills/shared/scripts/calendar_ops.py add-event --title T --date D [--platform P] [--time H] [--event-type ...] [--end-date ...] [--note ...]
python3 skills/shared/scripts/calendar_ops.py import-events --file F
python3 skills/shared/scripts/calendar_ops.py seed-holidays [--year Y]
python3 skills/shared/scripts/calendar_ops.py upcoming [--days 14] [--kind K]
python3 skills/shared/scripts/calendar_ops.py list [--kind K] [--platform P] [--since S] [--until U]
python3 skills/shared/scripts/calendar_ops.py context [--days 14] [--gap 5]
python3 skills/shared/scripts/calendar_ops.py selftest
```
顶层 `--data`（默认 `str(DEFAULT_DATA)`）。所有子命令输出 JSON 到 stdout：`record-publish` → `{"ok":bool,"skipped":bool,...}`(L187)；`add-event` → `{"ok":true,"id":...,"item":...}`(L209)；`import-events` → `{"ok":true,"added":n,"total":n}`(L248)；`upcoming` → `json.dumps(out, indent=2)`(L357)；`list` → `{"count":n,"items":[...]}`(L394)；`context` → `json.dumps(result, indent=2)`(L458)。JSON 解析失败 `sys.exit(f"错误：无法解析 JSON：{e}")`(L242)。`main(argv=None)` 直接 `args.func(args)`，成功退出码 0。

#### ⑧ `skills/shared/scripts/account_stats.py`（943 行）
```bash
python3 skills/shared/scripts/account_stats.py check
python3 skills/shared/scripts/account_stats.py fetch --platform P [--profile-base D] [--proxy U] [--no-proxy] [--headed]
python3 skills/shared/scripts/account_stats.py selftest
```
`--platform` help：`平台：{', '.join(PLATFORMS)}`（**5 个平台**，见 §4）。
- `fetch` stdout = 单行 `json.dumps(out, ensure_ascii=False)`(L822)，键：`platform, name, nickname, loggedIn, followers, likes, following, posts, metrics, notes, metrics_title("平台近 7 日（创作中心只给这档）"), overview[{key,label,value}×3], growth, fetched_at`；同时在有非 None 指标时落一次历史快照。
- `check` stdout 为人类可读 `✅/❌` 行 + `支持平台：...`；**退出码 0（就绪）或 3（playwright/内核不可用）**（L786）。
- `fetch` 未知平台或缺 playwright → `_die(..., 3)`。
- selftest 成功打印 `✅ selftest 通过（解析 + 概览分方向取数(修获赞bug) + 近7日环比 + 多窗口增长 + 配置/代理 + 接口token提取 + 排除草稿）`(L919)。

#### ⑨ `skills/shared/scripts/social_stats.py`（333 行，**无 CLI 业务**）
纯函数统计库，仅 stdlib，无 I/O。核心约定：`safe_div(numerator, denominator, default=None)` 在除零/None 时返回 `None`；**`None` 表示「数据缺失」**，聚合时排除并在 coverage 里报告。函数含 `clean()`、`group_aggregate(recs, keyfn, valfn?, "mean")`、`cooccurrence(lists, min_count)`、`sample_warning(n, total)`。
`if __name__ == "__main__": _selftest()` → 打印 `social_stats: all selftests passed`。

#### ⑩ `skills/shared/scripts/weixin_mp_stats.py`（800 行）
```bash
python3 skills/shared/scripts/weixin_mp_stats.py login   [--profile-base D] [--proxy U] [--no-proxy] [--headed] --qr-out Q --status-file S [--timeout 240]
python3 skills/shared/scripts/weixin_mp_stats.py stats   [公共参数] [--count 20] [--dump-dir D]
python3 skills/shared/scripts/weixin_mp_stats.py whoami  [公共参数]
python3 skills/shared/scripts/weixin_mp_stats.py publish [公共参数] --html H --cover C --title T [--digest ""] [--author ""] [--source-url ""]
python3 skills/shared/scripts/weixin_mp_stats.py selftest
```
公共参数由内部 `common(x)` 加：`--profile-base / --proxy / --no-proxy / --headed`。
- `stats` / `whoami` / `publish` 输出单行 `json.dumps(result, ensure_ascii=False)`。
- `stats` 未登录/会话失效 → `result["error"]="未登录或会话失效，请重新 login 扫码"`，打印 JSON 后 **return 1**（L607）。`whoami` 同类错误文案 `未登录 mp 后台，请先 login 扫码`（L607 同段）。
- `publish` 各失败分支打印带 `out["error"]` 的 JSON 后 **return 1**：未取到上传 ticket(L610)、封面上传失败(L640/643)、建草稿返回非 JSON(L693)、建草稿失败(L699/705)；成功 → **return 0**(L703)。
- selftest 打印 `weixin_mp_stats selftest ok`(L735)。

### 1.2 其余 34 个 CLI 的参数速查

> 全部为 `python3 skills/shared/scripts/<文件> <子命令> [参数]`；下表的 `-o` 即 `--output`。

| 脚本 | 子命令 → 关键参数 |
|---|---|
| `ai_image.py` | `text2img --prompt [--quality]` · `img2img --prompt --image [--mask]` · `variations --image [--prompt]` · `check`；公共：`-o/--output`(必填)、`--n`(1)、`--size`(1024x1024)、`--mode`(sync/async)、`--resolution`(2k)、`--format`(png/jpeg/webp)、`--poll-interval`(5)、`--timeout`(180)、`--env-file` |
| `ai_music.py` | `check` · `generate --prompt -o [--lyrics] [--duration] [--instrumental] [--model] [--poll-interval 5] [--timeout 300]`；公共 `--provider`(choices=PROVIDERS) `--env-file` |
| `ai_video.py` | `text2video` · `image2video --image` · `check` · `capabilities` · `probe-dialogue --text [--scene] [--language zh-CN] [--mode t2v\|i2v] [--image] [--duration] [--ratio] [--timeout] [--asr-model base] [--threshold 0.9]`；公共 `--env-file --provider --prompt(视需要) --model --duration --ratio --audio(auto/on/off) -o --poll-interval 10 --timeout 900` |
| `asr.py` | `transcribe -i [-o] [--format srt/ass/txt/json] [--model base] [--language auto] [--device cpu] [--compute-type int8] [--res] [--max-line-chars 18] [--beam-size 5]` · `info`；顶层 `--selftest` |
| `audio_mix.py` | `mix --voice --bgm -o [--voice-volume 1.0] [--bgm-volume 0.25] [--bgm-loop-off] [--no-duck] [--sfx] [--sfx-at] [--sfx-volume 0.9] [--duration]` · `selftest` |
| `audio_ops.py` | `info <input> [--raw]` · `trim <input> -o [--start --end --duration]` · `convert <input> -o [--bitrate --sample-rate --channels]` · `normalize <input> -o [--i --tp --lra --bitrate]` · `extract <input> -o [--copy --bitrate]` · `concat <inputs...> -o [--bitrate]` · `fade <input> -o [--fade-in --fade-out]` · `speed <input> -o --factor` · `denoise <input> -o [--tier 1\|2\|3] [--mix 0.8] [--model]`；顶层 `--selftest` |
| `audio_viz.py` | `render -i -o [--mode waves/bars/spectrum/cqt] [--size 1080x1920] [--color] [--wave-color] [--bg-image] [--cover] [--title] [--font]` · `selftest` |
| `batch_process.py` | `run --dir --type --op [--out-dir --ext --recursive] op_args...`（`nargs=REMAINDER`）· `list --dir --type [--recursive]` · `selftest` |
| `beatsync.py` | `build -i... [--images-dir] --music -o [--size --every 2 --effect none/zoom/flash --fallback-interval 0.5 --max-duration]` · `beats --music [--fallback-interval]` · `selftest` |
| `bili_login.py` | `login [--qr-out --status-file --cookie --timeout]` · `check` · 循环生成的按动作子命令（带 `--cookie`）· `selftest` |
| `chromakey.py` | `key -i -o [--bg --bg-color --bg-blur --color 0x00ff00 --similarity 0.30 --blend 0.10 --blur-sigma 20]` · `selftest` |
| `doc_convert.py` | `convert -i -o [--format html/pdf/png --title --width 800 --page-width 760]` · `selftest` |
| `fix_timing.py` | 扁平：`--shots --srt --lines --storyboard -o [--min-shot-dur 2.5 --gap 0.25]` |
| `highlight_cut.py` | `energy -i [--top 5 --clip-len 20.0 --min-gap 10.0] [-o]` · `cut -i --segments -o [--pad 0.3 --reframe --reframe-mode blur/crop/smart]` · `selftest` |
| `image_ops.py` | `resize -i -o [--width --height --percent --keep-ratio]` · `crop -i -o [--box --width --height]` · `pad -i -o --ratio [--background #ffffff]` · `convert -i -o --format` · `compress -i -o [--quality 85 --max-kb]` · `watermark -i -o [--text --image --position bottom-right --opacity 0.5 --size 36 --margin 24 --color #ffffff --font --scale 1.0]` · `round -i -o [--radius 40 --radius-percent]` · `collage -i... -o [--mode horizontal/vertical --grid --gap 10 --background --cell-width --cell-height]` · `thumbnail -i -o [--size 256]`；顶层 `--selftest` |
| `img_enhance.py` | `enhance -i -o [--scale 2.0 --denoise --auto --autocontrast --sharpen --contrast --saturation]` · `selftest` |
| `install_tool.py` | `list` · `check [ids...] [--dir]` · `install ids... [--dir]` · `selftest`；顶层 `--python` `--json` |
| `intro_outro.py` | `card -o [--title --subtitle --cta --logo --logo-width --size --duration 2.5 --gradient --bg-image --color --color2 --title-size --title-color --subtitle-color --cta-color --font --preset intro/outro]` · `attach --main -o [--intro --outro --size --transition --trans-duration 0.5]` · `selftest` |
| `meme_ops.py` | `make -i -o [--layout overlay --top --bottom --caption --stroke --no-upper --bar-color white --text-color black --font]` · `selftest` |
| `mindmap.py` | `make -i -o [--title --bg #ffffff --png]` · `selftest [--png-in-selftest]` |
| `model_registry.py` | `configured --group G [--env-file PATH]`（`--group` choices=`tuple(MODEL_GROUPS)`） |
| `multivoice.py` | `cast init --cast [--title]` / `cast add --cast --name [--role --engine clone/edge --voice --rate --pitch --volume --provider --voice-id --archetype --ref --note]` / `cast list --cast` / `cast check --cast` · `dub --cast --lines -o [--srt --gap --proxy --allow-edge]` · `selftest` |
| `reframe.py` | `reframe -i -o --ratio [--mode blur/crop/smart --size --focus-x 0.5 --focus-y 0.5 --blur-sigma 25]` · `selftest` |
| `remove_bg.py` | `remove -i -o [--model u2net --bg-color --bg-image --alpha-matting]` · `check` · `selftest` |
| `render_card.py` | **扁平**：`[--html --out --out-dir --selector --all --prefix card --full-page --width 1080 --height 1440 --scale 2 --format png/jpeg --quality 90 --wait 1200 --nav-timeout 20000 --proxy --selftest]` |
| `slideshow.py` | `build -i... [--images-dir] -o [--size --per 3.0 --transition fade --trans-duration 0.7 --bgm --bgm-volume 0.8 --captions --captions-file --no-kenburns --fit pad/crop --font]` · `selftest` |
| `subtitle_ops.py` | `parse -i [-o]` · `extract -i -o` · `merge -i --trans -o [--format srt/vtt/ass --order orig-top/trans-top --trans-only --font]` · `build --json -o [同上]` · `convert -i -o [--format --font]` · `burn -i --sub -o [--soft --lang chi --force-style --font-dir]` · `selftest` |
| `tts.py` | `speak (-t T \| -f F) -o [-v VOICE] [--engine auto/closed/edge --rate --volume --pitch --subtitle --format auto/mp3/wav/m4a --proxy]` · `voices [--all] [--proxy]`；顶层 `--selftest` |
| `video_ops.py` | `cut -i -o [--start --end --duration --reencode]` · `concat -i... -o [--mode demuxer/filter --width 1920 --height 1080 --fps 30]` · `speed -i -o --factor` · `<静音切分子命令> -i -o [--noise -30 --min-silence 0.5 --pad 0.05]` · `text -i -o --text [--position bottom --fontsize 48 --color white --font --margin 40 --start --end --box]`，另有 `--crf` `--preset medium`；顶层 `--selftest` |
| `voice_clone.py` | `check` · `enroll [--sample --sample-url --name]` · `clone --text -o [--voice-id --emotion --sample --sample-text --speed 1.0]` · `selftest`；公共 `--provider` `--env-file` `--model` |
| `wordcount.py` | `count -f [--json]` · `check --target N [-f] [--tolerance 0.05 --metric social_count --json]` · `selftest` |
| `xhs_comment.py` | `check` · `notes [--scroll 4 --out]` · `fetch [--max 0 --out]` · `reply --replies-json [--exec --allow-unsafe --replied-file --gap 4.0]` · `delete [--targets-json --nickname --content --exec --gap 4.0]` · `plan [--note-id --replies-json]` · `post [--url --text --batch-json --exec --allow-unsafe --gap 6.0]`；公共 `--profile-base --proxy --no-proxy --headed`，url 组 `--url --note-id --xsec-token --scroll 8` |
| `zhihu_comments_fetch.py` | 扁平：`<article_url> [--limit 100]` |

媒体类最大的 `video_ops.py` 有 72 处 `add_argument`。

### 1.3 无 CLI 的库

- `human_pace.py`（53 行）：`HUMAN_PACE_RANGES: dict[str,tuple[int,int]]` = `"task-switch"(1800,4500)`、`"field-switch"(650,1800)`、`"verification"(1200,3000)`、`"review"(2000,5000)`、`"commit"(1200,3200)`。API：`pace(stage, content_length=0)`、`pause_before_commit(content_length=0)`、`sample_ms(...)`；环境变量 `EASEL_PACE_SKIP=1` 跳过等待。
- `login_state.py`、`platform_readback.py`、`social_stats.py`：见 §1.1 ③④⑨。

---

## 2. 各平台发布脚本：CLI 与成功/失败判定

**统一门禁**：除 `zhihu_comments_fetch.py` 外，所有发布脚本在真正发布前调用 `content_guard.guard_or_die(parts, exec_mode=..., allow_unsafe=...)`。调用者共 8 个（`grep -rln guard_or_die --include=*.py`）：
`scripts/validate_skills.py`、`skills/openclaw/skill-bilibili-upload/scripts/bili_upload.py`、`skills/openclaw/skill-wechat-publisher/scripts/multi_publish.py`、`skills/openclaw/skill-wechat-publisher/scripts/publish.py`、`skills/shared/scripts/content_guard.py`、`douyin_publish.py`、`web_publisher.py`、`xhs_comment.py`、`xhs_publish.py`、`zhihu_answer.py`。

**统一 dry-run 约定**：发布类子命令默认是 preview，只有显式 `--exec` 才写平台；`--allow-unsafe` 是唯一放行内容闸门的开关。

### 2.1 七个平台一览

| 平台标识 | 中文 | 发布脚本 | 调用形式 |
|---|---|---|---|
| `xiaohongshu` | 小红书 | `skills/shared/scripts/xhs_publish.py` | `python3 .../xhs_publish.py {plan\|publish\|publish-video\|whoami\|check\|login\|selftest} [publish opts]` |
| `douyin` | 抖音 | `skills/shared/scripts/douyin_publish.py` | `python3 .../douyin_publish.py {plan\|publish\|publish-video\|whoami\|check\|login\|selftest} [publish opts]` |
| `kuaishou` | 快手 | `skills/shared/scripts/web_publisher.py --platform kuaishou` | `python3 .../web_publisher.py {platforms\|check\|plan\|login\|login-qr\|publish\|whoami\|selftest} --platform kuaishou ...` |
| `weixin-channels` | 视频号 | `skills/shared/scripts/web_publisher.py --platform weixin-channels` | 同上 |
| `zhihu` | 知乎 | `skills/shared/scripts/web_publisher.py --platform zhihu`；另有 `skills/shared/scripts/zhihu_answer.py`（扁平参数） | `web_publisher.py ... --platform zhihu ...` / `python3 zhihu_answer.py --question Q --content-file F [--exec] [--allow-unsafe] [--headed] [--selftest]` |
| `bilibili` | B站 | `skills/openclaw/skill-bilibili-upload/scripts/bili_upload.py`（279 行） | `python3 .../bili_upload.py {check\|tid\|login\|upload\|selftest} ...` |
| `wechat` | 微信公众号 | `skills/openclaw/skill-wechat-publisher/scripts/publish.py`（932 行）、`multi_publish.py`（439 行）；另有 `skills/shared/scripts/weixin_mp_stats.py publish` | `python3 .../publish.py --input article.md --cover c.jpg [--exec]` |

### 2.2 逐平台 CLI 与成功/失败判定

**小红书 — `xhs_publish.py`（1006 行）**
- 公共：`--profile-base --proxy --no-proxy`；publish opts：`--title --content --images --video --tags --exec --allow-unsafe --headed --keep-open`。
- `login --qr-out --status-file --timeout --headed`；`plan`（不发布，输出计划）；`publish` / `publish-video`；`whoami`；`check`。
- 成功判定：`_wait_publish_success(page, timeout_s=40)`（L472）在 `cmd_publish` 里以 40s 超时调用（L544）——**UI 层等待「发布成功」信号，超时即失败**。

**抖音 — `douyin_publish.py`（1500 行）**
- 公共：`--profile-base --proxy --no-proxy --title --content --images --video --tags --exec --allow-unsafe --headed --keep-open --sms-code-file --status-file`。
- `login --qr-out --status-file --sms-code-file --timeout --headed`；`plan` / `publish` / `publish-video` / `whoami` / `check`。
- 成功判定：发布后可选走 `platform_readback.verify_douyin_publish(page, title=..., since_ms=...)` 读回核验（`verified / unverified / login_required / readback_error`）。

**快手 / 视频号 / 知乎 — `web_publisher.py`（1479 行）**
- `platforms`（列出支持平台）、`check`、`plan`、`login`、`login-qr --qr-out --status-file --timeout`、`publish --exec --allow-unsafe --headed --keep-open`、`whoami`、`selftest`；公共 `--platform {kuaishou,weixin-channels,zhihu}` `--media --title --desc --tags --cover --profile-base`。
- **成功判定**：`cfg["publish_success"]` 字典（L724-725「配置了 publish_success 才验；未配的平台沿用『跑完即报』」）：
  - kuaishou L83：`{"url_not_contains": "publish/video"}`
  - weixin-channels L185：`{"url_not_contains": "publish/video", "selector": "text=发布成功"}`
  - zhihu L246：`{"url_contains": "/p/", "url_not_contains": "/edit"}`
- `PLATFORMS` 顶层键**只有 3 个**：`kuaishou`(L48)、`weixin-channels`(L193)、`zhihu`(L228)。每个平台配置含 `name / login_url / publish_url / profile / media_kind / login_check / login_strict / login_probe / logged_out_selector / login_prep / login_qr_selector / qr_loaded / me_name_selector / me_avatar_selector / publish_success / steps`。

**B站 — `bili_upload.py`（279 行）**
```bash
python3 skills/openclaw/skill-bilibili-upload/scripts/bili_upload.py check
python3 .../bili_upload.py tid
python3 .../bili_upload.py login [--cookie cookies.json]
python3 .../bili_upload.py upload --video V [--title] [--partition] [--tid N] [--desc] [--tag a,b] [--cover] [--copyright 1|2] [--source] [--dtime TS] [--cookie] [--proxy] [--exec]
python3 .../bili_upload.py selftest
```
- `--exec` help：`真正投稿（默认 dry-run 预览）`；`--dtime` help：`定时发布 10 位时间戳（距今>4h）`；`--copyright` choices `[1,2]` default 1。
- 成功判定：底层调 `biliup`；成功后打印 `✅ 读回核验：{m.platform_content_id}（{m.status}）；账号：{acct}`（L178，走 `platform_readback.verify_bilibili_publish` / `_bilibili_api`，cookie 文件默认 `cookies.json`）。

**微信公众号 — `publish.py`（932 行）**
```bash
python3 skills/openclaw/skill-wechat-publisher/scripts/publish.py \
  (--input article.md | --html article.html | --brief brief.md) \
  [--type news|newspic] [-t/--title] [-c/--cover] [-a/--author] [-d/--digest] \
  [--source-url] [--style JSON] [--theme NAME] [--image-style NAME] [--temp-dir D] \
  [--account NAME] [--sync p1,p2] [--sync-from-config] \
  [--ai-score-threshold F] [--skip-ai-score] [--allow-missing-images] [--debug] \
  [--exec] [--official-api]
```
- `--exec` help：`确认创建微信草稿；默认仅预览将使用的账号、模式和输入文件`。
- **只创建草稿，不群发**（description：`微信公众号文章一键发布到草稿箱`）。
- 模式校验：`--type newspic` 必须配 `--brief`；`--html` 模式必须同时给 `--title --cover`，且不支持多平台同步（`parser.error(...)` → argparse 退出码 2）；贴图模式也不支持同步。
- 成功判定：`publish_from_brief / publish_from_html / publish_from_markdown / _session_publish_html` 返回 `result`，最后 `print("\n" + json.dumps(result, ensure_ascii=False, indent=2))`；`main()` **无显式 `sys.exit`** → 无异常即 0，异常冒泡非 0。
- 默认走**公众号后台会话发布**（免 app_secret/白名单，需先扫码登录后台）；`--official-api` 才回退官方 API。
- 另有 `multi_publish.py`（439 行，`--input --title --cover` + 多平台参数）做微信→其它平台同步。

**`weixin_mp_stats.py publish`**：`--html --cover --title [--digest --author --source-url]`，输出 JSON，成功 return 0、失败 return 1（见 §1.1 ⑩）。

### 2.3 跨平台派发 — `publish_dispatch.py`（180 行）
```bash
python3 skills/openclaw/skill-cross-platform-publish/scripts/publish_dispatch.py platforms
python3 .../publish_dispatch.py plan --manifest content.json      # 或 --manifest -
python3 .../publish_dispatch.py selftest
```
`PLATFORMS: dict[str, dict]`（L28-50）**恰好 7 个键**，值含 `publisher / types / title / body / tags / aspect / note`：

| 平台 | publisher skill | types | title | body | tags | aspect |
|---|---|---|---|---|---|---|
| `xiaohongshu` | `skill-xhs-publisher` | image, video | 20 | 1000 | 10 | 3:4/9:16 |
| `douyin` | `skill-douyin-upload` | video, image | 30 | 1000 | 5 | 9:16 |
| `wechat` | `skill-wechat-publisher` | article | 64 | 0 | 0 | - |
| `bilibili` | `skill-bilibili-upload` | video | 80 | 2000 | 10 | 16:9 |
| `kuaishou` | `skill-kuaishou-upload` | video, image | 500 | 500 | 5 | 9:16 |
| `weixin-channels` | `skill-channels-upload` | video | 22 | 1000 | 5 | 9:16 |
| `zhihu` | `skill-zhihu-publisher` | article, answer | 100 | 0 | 5 | - |

- `cmd_platforms` 打印 `支持 {len(PLATFORMS)} 个平台：` → **7**。
- `plan` 输出 JSON：`{content_title, target_count, dispatch:[{platform, ok, publisher, recommend_aspect, constraints_note, warnings, action}], hint}`；未知平台 → `{"platform":..., "ok": false, "error": "未知平台（支持：...）"}`；越限只产生 `warnings`，不失败。
- 失败路径 `_die(msg, code=1)` → stderr + 退出 1：manifest 非法 JSON、`manifest.platforms` 为空、manifest 文件不存在。

---

## 3. `content_guard.py` 完整规则分类

路径：`skills/shared/scripts/content_guard.py`（437 行）。
定位（docstring）：**出站内容安全的唯一真相源**，扫描任何要发到公开平台的文本。

### 3.1 两级严重度与退出码

- `EXIT_LEAK = 7`。
- 两级：**BLOCK**（真实敏感信息 → fail-closed 阻断发布，退出 7）与 **WARN**（AI 措辞 / 模型名 → 只提醒，永不阻断）。
- **类别与严重度的关系**由 `BLOCK_CATEGORIES` 决定：
```python
BLOCK_CATEGORIES = {"api-key", "env-value", "internal-host", "proxy-ip", "internal-path", "env-name"}
```
  其余类别（`ai-disclosure`、`model-name`）一律 WARN。
- 注意：`"env-value"` **不在** `SECRET_PATTERNS` 表里，只由运行时 `.env` 字面量匹配产生。

### 3.2 跳过/放行开关（重要）

- `content_guard.py` CLI **本身没有任何 skip / allow / force 开关**（子命令只有 `scan` / `redact` / `selftest`）。
- 唯一放行机制在调用方：发布脚本的 **`--allow-unsafe`** 传给 `guard_or_die(..., allow_unsafe=True)`。
- 两条不阻断路径，**都由调用方决定**：
  1. **dry-run**（没有 `--exec`）：`guard_or_die` 不退出，只打印提醒；
  2. **`--allow-unsafe`**：即使 `--exec` 也不退出。
- 因此判定发布是否会因内容被拦，需要同时看 `exec_mode` 与 `allow_unsafe`。

### 3.3 `SECRET_PATTERNS` 逐字表

`SECRET_PATTERNS: list[tuple[str, str, "re.Pattern[str]", str]]` = `(category, severity, 编译后正则, hint)`。辅助 `_p(pat, flags=0)` 做编译。

| category | severity | regex | hint |
|---|---|---|---|
| api-key | high | `\bsk-[A-Za-z0-9_\-]{16,}\b` | 疑似 API key（sk- 开头） |
| api-key | high | `(?i)\b(?:api[_-]?key\|auth[_-]?token\|access[_-]?key\|secret[_-]?key\|app[_-]?secret\|secret)\b\s*[:=]\s*['"]?[A-Za-z0-9/_\-\.]{8,}` | 键值形式的密钥/令牌 |
| api-key | high | `(?i)\bBearer\s+[A-Za-z0-9/_\-\.]{12,}` | Bearer 令牌 |
| internal-host | med | `\bmaas\.devops\.(?:xiaohongshu\|rednote)\.(?:com\|life)\b` | 内部 MaaS 域名 |
| internal-host | med | `\bwebide-gateway\.devops\.xiaohongshu\.com\b` | 内部 WebIDE 域名 |
| internal-host | med | `\b[a-z0-9\-]+\.devops\.(?:xiaohongshu\|rednote)\.(?:com\|life)\b` | 内部 devops 域名 |
| internal-host | low | `\bcodewiz\b` (re.I) | 内部代理标识 |
| internal-host | med | `\bapi-version=[0-9]` | API 版本查询串（内部接口特征） |
| proxy-ip | med | `\b(?:10\|192\.168\|172\.(?:1[6-9]\|2\d\|3[01]))(?:\.\d{1,3}){2,3}(?::\d+)?\b` | 私网/代理 IP |
| proxy-ip | med | `:3128\b` | 代理端口 3128（独立出现） |
| internal-path | med | `/mnt/tidal-alsh01\S*` | 内部数据盘路径 |
| internal-path | med | `(?:~\|/root)?/\.openclaw\S*` | OpenClaw 内部路径 |
| internal-path | med | `(?:~\|/root)?/\.easel-browser-profiles\S*` | 登录态 profile 路径 |
| internal-path | low | `/root/\.cc-mirror\S*` | 内部镜像路径 |
| env-name | med | `\bANTHROPIC_[A-Z_]+\b` | Anthropic env 变量名 |
| env-name | med | `\b(?:IMG_API_KEY[A-Z_]*\|IMG_BASE_URL\|DASHSCOPE_API_KEY\|XHS_MAAS_API_KEY\|MINERU_API_TOKEN\|ARK_API_KEY\|KLING_ACCESS_KEY\|VIDEO_API_KEY\|MUSIC_API_KEY\|FISH_API_KEY\|MINIMAX_API_KEY\|EASEL_PROXY\|EASEL_ROOT)\b` | Easel env 变量名 |
| model-name | low | `\bclaude-[a-z0-9][a-z0-9.\-\[\]]*\b` (re.I) | Claude 模型 ID |
| model-name | low | `\banthropic/claude\S*` (re.I) | anthropic/claude 模型引用 |
| model-name | low | `\bgpt-image-2\b` (re.I) | 内部生图模型名 |
| model-name | low | `\bhappyhorse\b` (re.I) | 内部生视频模型名 |
| ai-disclosure | low | `由\s*AI\s*(?:生成\|创作\|撰写\|制作\|完成)` | 「由 AI 生成」类措辞 |
| ai-disclosure | low | `\bOpenClaw\b` (re.I) | 内部编排框架名 |
| ai-disclosure | low | `Claude\s*Code` (re.I) | 内部制作引擎名 |
| ai-disclosure | low | `\bAnthropic\b` (re.I) | 模型厂商名 |
| ai-disclosure | low | `降级生成` | 内部降级措辞 |
| ai-disclosure | low | `(?i)(?:append-)?system[\s\-]?prompt` | 系统提示词字样 |
| ai-disclosure | low | `(?:我(?:们)?是\|作为\|身为\|本\|自称)(?:一[个只])?(?:大语言模型\|大模型)\|(?:大语言模型\|大模型)(?:生成\|创作\|撰写\|制作)` | 自曝为大模型（自指语境） |

（上表中的 `|` 是正则择一符，原样呈现。）

### 3.4 `.env` 字面量检测

```python
_SENSITIVE_ENV_NAME = re.compile(r"(?:API_KEY|AUTH_TOKEN|_TOKEN|SECRET|ACCESS_KEY|BASE_URL|AUTH)", re.I)
load_env_literals(root=None)   # → set[str]
```
- root 解析顺序：显式 root → 环境变量 `EASEL_ROOT` → 脚本 `parents[2]`（即仓库根）→ cwd。
- 只收 **key 命中 `_SENSITIVE_ENV_NAME` 且 value 长度 ≥ 6** 的字面值；无 `.env` 时返回空集。
- 命中产生 `Finding("env-value", "high", ".env 里的真实敏感值", ...)`，属 BLOCK。

### 3.5 函数契约

| 函数 | 契约 |
|---|---|
| `scan(text, extra_literals=None) -> list[Finding]` | 两趟：先 `.env` 字面量精确子串匹配，再跑全部 `SECRET_PATTERNS` 正则。结果按 span 起点排序、同起点长的优先，**完全重叠的重复项丢弃**。空文本 → `[]`。 |
| `redact(text, extra_literals=None) -> tuple[str, list[Finding]]` | 每个命中 span 替换为字面量 `"[已隐藏]"`，从右往左替换以保持 span 有效。 |
| `guard_or_die(parts, *, exec_mode, allow_unsafe=False, label="发布内容", extra_literals=None) -> None` | 发布脚本调用的门。`parts` 可为 str 或 list；None/空跳过，用 `"\n"` 连接。无命中 → 静默返回。 |
| `_print_findings(findings, stream=None)` | 写 stderr，格式 `  · [{severity}] {category}｜{hint}：{snippet}`，按 high→med→low 排序。 |
| `_read_input(a)` | `--text` 优先，其次 `--file`，最后 stdin。 |

`@dataclass Finding(category, severity, hint, snippet, span)`；`_mask()` / `_snippet()` 会在报告里把命中本身打码。

`guard_or_die` 行为：
- **阻断分支**（`exec_mode and not allow_unsafe and block`）→ stderr 打印
  `❌ {label}检测到疑似敏感信息泄露（密钥/内部地址等），已阻止本次发布（{n} 处）：`，列出 block 命中（可选列出 warn），再打印
  `→ 请从内容中删除上述敏感信息后重发；确需放行可加 --allow-unsafe（谨慎）。`，然后 `sys.exit(EXIT_LEAK)`（=7）。
- **非阻断分支**（dry-run / allow_unsafe / 只有 WARN）→ 打印
  `⚠️ {label}检测到需留意的内容（{n} 处，{tag}）：`，`tag` ∈ `allow-unsafe 放行` / `dry-run 预演` / `仅提醒项，未拦截`，后接两个小标题：
  【敏感·建议删除】、【AI 措辞/模型名·请判断是否合适（正常科普/论文里可能没问题）】。

### 3.6 退出码与 stdout/stderr 契约（调用方要检查什么）

| 子命令 | stdout | stderr | 退出码 |
|---|---|---|---|
| `scan`（零命中） | `✅ 未检出敏感信息。` | — | 0 |
| `scan`（有 BLOCK） | — | `❌ 检出 {n} 处敏感信息（密钥/内部地址等，发布会被拦截）：` + 明细 | **7** |
| `scan`（仅 WARN） | — | `⚠️ 另有 {n} 处 AI 措辞/模型名（仅提醒，不拦截；论文/科普里可能正常）：` + 明细 | **0** |
| `redact` | 脱敏文本 | `已写脱敏文本 → {out}（脱敏 {n} 处）` | 0 |
| `selftest` | `✅ ...` | 进度行 | 0 成功 / 1 失败 |

**判定「是否命中 BLOCK」= 退出码 == 7**（`cmd_scan` 返回 `EXIT_LEAK if block else 0`）。
人类可读的类别名就是 `SECRET_PATTERNS` 的第一列 6 类：`api-key`、`internal-host`、`proxy-ip`、`internal-path`、`env-name`、`model-name`、`ai-disclosure`，外加运行时的 `env-value`（共 8 个字符串，其中前 6 类含 `env-value` 属 BLOCK）。

`selftest` 覆盖：12 个 BLOCK 正例（`sk-` key、`api_key=`、`Bearer`、maas 域名、webide、代理 IP `10.140.24.177:3128`、`:3128`、`/mnt/tidal-alsh01/...`、`~/.easel-browser-profiles/...`、`XHS_MAAS_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`api-version=`）、7 个 WARN 正例（`claude-4.8-opus`、`happyhorse`、由 AI 生成、`OpenClaw`、`Claude Code`、论文科普文本、自曝大模型）、6 个负例（普通营销文案含 `400-820-8820` / `www.example.com`，以及「Transformer 是所有大模型的共同底座」）。

---

## 4. 七平台标识与「未登录 / 已登录 / 登录态失效」三态

### 4.1 精确平台标识字符串（按出现位置）

- `publish_dispatch.py PLATFORMS`（L28-50）：`"xiaohongshu", "douyin", "wechat", "bilibili", "kuaishou", "weixin-channels", "zhihu"` → **恰好 7 个**。
- `web_publisher.py PLATFORMS`（仅 3 个）：`"kuaishou"`(L48, name 快手) / `"weixin-channels"`(L193) / `"zhihu"`(L228)。
- `account_stats.py PLATFORMS`（5 个）：`"xiaohongshu"`(L32, 小红书) / `"douyin"`(L40, 抖音) / `"kuaishou"`(L51, 快手) / `"zhihu"`(L59) / `"weixin-channels"`(L71)。
- CLI 取值形态不同：`web_publisher --platform` 用 `weixin-channels`；`publish_dispatch` 路由表里公众号叫 `wechat`（微信图文）。
- 注意 **`wechat`（公众号图文）与 `weixin-channels`（视频号）是两个不同平台**，`wechat` 没有 `web_publisher` 条目。

### 4.2 三态如何判定

**(A) 已登录 / 未登录 —— `web_publisher._is_logged_in(page, cfg) -> bool`（L849-890）**，可靠性顺序：
1. URL 命中 `_LOGIN_MARKERS`（登录/验证页，如视频号 `login.html`、知乎 `signin`）→ **未登录**（`False`）。
2. `cfg["logged_out_selector"]` 任一选择器**可见**（`is_visible()`）→ **未登录**（快手停在发布页但弹登录浮层的情况）。
3. `cfg["login_check"]` 任一选择器**可见** → **已登录**（`True`，比 URL 启发式更可靠；必须可见，仅存在性会假阳性）。
   - 配了 `login_check` 却都不命中，且 `cfg["login_strict"]` 为真（快手）→ **未登录**。
4. URL 启发式兜底（非严格平台）：已离开 `cfg["login_url"]` 且无登录标记 → **已登录**。

**(B) 登录态失效 —— `web_publisher._probe_publish_auth(page, cfg) -> "ok" | "expired" | "unknown"`（L900-945）**：
外壳 token 可能比发布 token 活得久，故外壳判定为已登录后，用页内 `fetch(cfg["login_probe"]["url"], credentials:'include')` 再打一次发布子系统接口。
- 返回 `"expired"` 的**明确失效信号**：请求被重定向到 `_LOGIN_MARKERS`；HTTP `401/403`；JSON `result/code ∈ {109, 100110000}`（`_PROBE_LOGOUT_RESULTS`）；或 message 命中 `_PROBE_LOGOUT_HINTS`（`未登录 / 登录态 / 请登录 / 重新登录 / not login / not logged / unauthorized / 登录已过期`）。
- 返回 `"ok"`：`result/code ∈ cfg["login_probe"]["ok_result"]`（快手 = `[1]`）。
- 其它一律 `"unknown"`（fail-safe，**绝不把有效会话翻成未登录**）。
- 调用点 L605：`if cfg.get("login_probe") and _probe_publish_auth(page, cfg) == "expired": ...`。

**(C) 扫码登录流程的状态文件三态 —— `login_state.py`**
`STATES = ("starting","qr_ready","scanned","sms_required","verifying","success","expired","error")`；`expired` 与 `error` 是终止失败态，`success` 是成功态。状态文件由 `read_status(path)` 读回，损坏/缺失 → `{"state":"unknown", ...}`。短信码走 `read_sms_code(path)`，路径约定 `outputs/_login/<platform>.code`，**读一次即消费**。

**(D) 读回核验态 —— `platform_readback`**：`login_required` 明确表示读回时登录态已失效（需重新登录）；由 `LoginRequiredError`（`_bilibili_assert_logged_in` / `_kuaishou_assert_logged_in` 抛出）捕获后置为该 outcome。

**(E) 各脚本的 `whoami` 子命令**：`web_publisher whoami`、`xhs_publish whoami`、`douyin_publish whoami`、`weixin_mp_stats whoami` 用于主动查询登录身份。

---

## 5. `web/app.py` 路由全清单

`web/app.py` = **4419 行**，FastAPI 应用（`uvicorn.run(app, ...)`）。
**HTTP 路由共 65 条**，全部用 `@app.<method>(path)` 直接注册；**没有 `APIRouter`、`include_router`、`app.add_api_route` 或 `app.mount`**。
另有 1 个非路由装饰器：`@app.middleware('http')` → `async def local_write_guard(request, call_next)`（L480，拦截跨站写请求）。

> 计数修正：`grep -c '^@app\.'` = 66，其中 1 条是 middleware，故路由 = **65**（早前口头说的 66 是错的）。

### 5.1 分组清单（方法 + 路径 + 处理函数 + 行号）

**静态/页面（4）**
| 方法 | 路径 | 函数 | 行 |
|---|---|---|---|
| GET | `/` | `index` | L1029→1030 |
| GET | `/onepage` | `onepage` | L1038→1039 |
| GET | `/assets/{path:path}` | `react_assets` | L1043→1044 |
| GET | `/static/{path:path}` | `static_file` | L1054→1055 |

**状态（1）**
| GET | `/api/status` | `api_status` | L1067→1068 |

**人设/画像（7）**
| GET | `/api/personas` | `api_personas` | L1072→1073 |
| GET | `/api/persona/{name}` | `api_persona` | L1077→1078 |
| GET | `/api/persona/{name}/files` | `api_persona_files` | L1102→1103 |
| PUT | `/api/persona/{name}/file` | `api_persona_file_save` | L1121→1122 |
| DELETE | `/api/persona/{name}` | `api_persona_delete` | L1133→1134 |
| POST | `/api/profile/build` | `api_profile_build` | L3995→3996 |
| GET | `/api/profile/build/status/{name}` | `api_profile_build_status` | L4048→4049 |

**技能（3）**
| GET | `/api/skills` | `api_skills` | L1146→1147 |
| GET | `/api/skill/{name}` | `api_skill_detail` | L1151→1152 |
| POST | `/api/skill` | `api_skill` | L3098→3099 |

**环境/工具（4）**
| POST | `/api/env` | `api_env_save` | L1175→1176 |
| GET | `/api/env/tools` | `api_env_tools` | L1199→1200 |
| POST | `/api/env/install` | `api_env_install` | L1246→1247 |
| GET | `/api/env/job/{job_id}` | `api_env_job` | L1300→1301 |

**模型/设置（6）**
| GET | `/api/settings/models` | `api_settings_models` | L1443→1444 |
| POST | `/api/settings/models/save` | `api_settings_models_save` | L1610→1611 |
| GET | `/api/settings/local-agents` | `api_local_agents` | L1773→1774 |
| POST | `/api/settings/local-agents/enable` | `api_local_agent_enable` | L1785→1786 |
| POST | `/api/settings/models/available` | `api_models_available` | L1915→1916 |
| POST | `/api/settings/models/selftest` | `api_models_selftest` | L1984→1985 |

**会话/对话（8）**
| GET | `/api/chat/last/{session_id}` | `api_chat_last` | L2355→2356 |
| GET | `/api/chat/jobs/{turn_id}/stream` | `api_chat_job_stream` | L2370→2371 |
| POST | `/api/chat/stream` | `api_chat_stream` | L2408→2409 |
| POST | `/api/chat/question/answer` | `api_question_answer` | L3003→3004 |
| POST | `/api/chat/question/status` | `api_question_status` | L3023→3024 |
| POST | `/api/chat/stop` | `api_chat_stop` | L3053→3054 |
| POST | `/api/chat` | `api_chat` | L3081→3082 |
| DELETE | `/api/session/{session_key}` | `api_delete_session` | L4121→4122 |

**产物/媒体/上传（7）**
| GET | `/api/outputs` | `api_outputs` | L3111→3112 |
| GET | `/api/output/{path:path}` | `api_output` | L3119→3120 |
| GET | `/api/media/{path:path}` | `api_media` | L3132→3133 |
| DELETE | `/api/output/{path:path}` | `api_output_delete` | L3195→3196 |
| POST | `/api/upload` | `api_upload` | L3212→3213 |
| GET | `/api/upload/limits` | `api_upload_limits` | L3240→3241 |
| POST | `/api/upload/local` | `api_upload_local` | L3246→3247 |

**账号/登录/凭据（10）**
| GET | `/api/accounts` | `api_accounts` | L3351→3352 |
| POST | `/api/login/{platform}` | `api_login_start` | L3362→3363 |
| GET | `/api/login/{platform}/status` | `api_login_status` | L3422→3423 |
| POST | `/api/login/{platform}/sms` | `api_login_sms` | L3440→3441 |
| GET | `/api/accounts/{platform}/credentials` | `api_get_credentials` | L3464→3465 |
| POST | `/api/accounts/{platform}/credentials` | `api_save_credentials` | L3480→3481 |
| POST | `/api/accounts/{platform}/mp-login` | `api_mp_login_start` | L3540→3541 |
| GET | `/api/accounts/{platform}/mp-login/status` | `api_mp_login_status` | L3574→3575 |
| GET | `/api/accounts/{platform}/whoami` | `api_account_whoami` | L3582→3583 |
| POST | `/api/logout/{platform}` | `api_logout` | L3649→3650 |

**分析（2）**
| GET | `/api/analytics/platforms` | `api_analytics_platforms` | L3714→3715 |
| GET | `/api/analytics/{platform}` | `api_analytics` | L3724→3725 |

**发布（3）**
| GET | `/api/publish/{platform}/status` | `api_publish_status` | L3852→3853 |
| POST | `/api/publish/{platform}/sms` | `api_publish_sms` | L3860→3861 |
| POST | `/api/publish/{platform}` | `api_publish` | L3873→3874 |

**趋势/排期/选题（10）**
| GET | `/api/trends` | `api_trends` | L4196→4197 |
| GET | `/api/schedule` | `api_schedule_list` | L4256→4257 |
| POST | `/api/schedule` | `api_schedule_create` | L4261→4262 |
| PUT | `/api/schedule/{sid}` | `api_schedule_update` | L4285→4286 |
| DELETE | `/api/schedule/{sid}` | `api_schedule_delete` | L4308→4309 |
| GET | `/api/schedule/context` | `api_schedule_context` | L4318→4319 |
| GET | `/api/ideas` | `api_ideas_list` | L4360→4361 |
| POST | `/api/ideas` | `api_ideas_create` | L4365→4366 |
| PUT | `/api/ideas/{iid}` | `api_ideas_update` | L4382→4383 |
| DELETE | `/api/ideas/{iid}` | `api_ideas_delete` | L4398→4399 |

合计：页面 4 + 状态 1 + 人设 7 + 技能 3 + 环境 4 + 模型设置 6 + 会话 8 + 产物 7 + 账号 10 + 分析 2 + 发布 3 + 趋势排期选题 10 = **65**。✅

### 5.2 三组重点路由（父任务 (a)(b)(c)）

**(a) 会话/对话存储**
```python
@app.post("/api/chat/stream")                       # L2408  api_chat_stream
@app.get("/api/chat/last/{session_id}")             # L2355  api_chat_last
@app.get("/api/chat/jobs/{turn_id}/stream")         # L2370  api_chat_job_stream
@app.post("/api/chat")                              # L3081  api_chat
@app.post("/api/chat/stop")                         # L3053  api_chat_stop
@app.post("/api/chat/question/answer")              # L3003  api_question_answer
@app.post("/api/chat/question/status")              # L3023  api_question_status
@app.delete("/api/session/{session_key}")           # L4121  api_delete_session
```
磁盘契约（源码常量）：
- `OPENCLAW_SESSIONS_DIR = _oc_state_dir() / "agents" / "main" / "sessions"`（L93）
- `SESSIONS_DIR = OUTPUTS_DIR / "_sessions"`（L207，注释「每会话最近一轮的完整结果，供 SSE 连接中断后前端取回」）
- `_session_flock_path(sk)` L2149 → `SESSIONS_DIR/f"{safe}.lock"`；`_transport_pin_file(sk)` L2154 → `f"{safe}.transport"`；`_turn_file(sk)` L2275 → `f"{safe}.json"`（L2278）；`_job_event_file(turn_id)` L2281 → `SESSIONS_DIR/"jobs"/f"{safe}.jsonl"`；`_save_turn(sk, status, text, extra=None)` L2327 用 tmp + `os.replace` 原子写。`api_chat_last` 用 `_turn_file(f"web:{session_id}")`（L2358）。
- 其它会话辅助：`_session_lock(sk)` L2128、`_openclaw_session_id(sk)` L2144、`_resolve_transport(sk)` L2159、`_pin_transport(sk, kind)` L2206、`_heal_openclaw_session(sk)` L177（读 `OPENCLAW_SESSIONS_DIR/f"{_openclaw_session_id(sk)}.jsonl"` L184）、会话管理器类 L2225（`acquire(timeout=300.0, poll=0.5)` / `release`）。
- `outputs/` 顶层受保护名（L3145）：`"_publish","_publish.log","_sessions","_profile_build","_debug","_inbox"`。

**(b) 模型配置 + `openclaw.json` 同步**
```python
@app.get("/api/settings/models")                    # L1443  api_settings_models
@app.post("/api/settings/models/save")              # L1610  api_settings_models_save   ← openclaw.json 写入路径
@app.post("/api/settings/models/available")         # L1915  api_models_available
@app.post("/api/settings/models/selftest")          # L1984  api_models_selftest
@app.get("/api/settings/local-agents")              # L1773  api_local_agents
@app.post("/api/settings/local-agents/enable")      # L1785  api_local_agent_enable
```
同步函数：
- `_openclaw_provider_creds()` L1484 —— 读 openclaw.json 里各 chat provider 已有 `(baseUrl, apiKey)`。
- `_sync_openclaw_chat(provider_updates, keep_custom, primary_ref) -> str` L1495 —— 同步 chat provider 到 `~/.openclaw-easel/openclaw.json`：更新/新增 + 删除多余自定义 + 设 primary model。
- `_sync_anthropic_provider(base, key) -> str` L1557；`_set_openclaw_primary(primary_ref) -> str` L1839；`_declare_anthropic_provider(base, key) -> str` L1859。
- 邻近辅助：`_mask_key` L1314、`_model_channels` L1321、`_write_env_direct` L1449、`_k(env, label, required=True, secret=True, aliases=None)` L340、`_model_spec` L344、`_short_drama_spec` L353、`_api_spec_status` L845。

**(c) 技能浏览**
```python
@app.get("/api/skills")                             # L1146  api_skills
@app.get("/api/skill/{name}")                       # L1151  api_skill_detail
@app.post("/api/skill")                             # L3098  api_skill   （执行一个 SKILL）
```
辅助：`find_skill(name)` L535、`_parse_skill_md(path) -> (name, desc, ?)` L544、`get_skills()` L592、`list_personas()` L516。

### 5.3 服务器入口与安全

```python
if __name__ == "__main__":
    port = int(os.environ.get("EASEL_PORT", "7860"))
    # 可选 VSCODE_PROXY_URI
    print("  ✦ Easel Web")  # + http://localhost:{port}
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
```
安全中间件：`local_write_guard`（L480）+ `TrustedHostMiddleware`。

---

## 6. `easel/`、`openclaw/`、`tests/`

### 6.1 `easel/` 包（Python CLI）

| 模块 | 行数 | 用途（docstring） |
|---|---|---|
| `easel/__init__.py` | 3 | Easel — 社媒内容工作流整合层 CLI |
| `easel/__main__.py` | 6 | `python -m easel` 入口；`from easel.cli import main; raise SystemExit(main())` |
| `easel/cli.py` | 207 | Easel CLI — 社媒内容工作流整合层。 |
| `easel/gateway_endpoint.py` | 178 | OpenClaw gateway 端点解析（端口 / 主机 / URL 的唯一真相源） |
| `easel/gateway_questions.py` | 391 | Gateway question-answer bridge for the Easel web UI. |
| `easel/local_agents.py` | 207 | 探测本机已装的 AI agent CLI，并把「能直接用」的那些接进 Easel |
| `easel/openclaw_cmd.py` | 120 | Resolve how to invoke the openclaw CLI as an argv prefix. |
| `easel/openclaw_workspace.py` | 160 | 解析 agent 实际读取的 workspace 目录（写入端与读取端的唯一真相） |
| `easel/persona.py` | 99 | Easel 画像（Profile）共享助手 —— CLI / Web / skill 三入口的单一真相源 |
| `easel/timeouts.py` | 13 | 统一超时常量（秒）——CLI / Web / skill 三入口单一真相源 |
| `easel/commands/__init__.py` | 0 | — |
| `easel/commands/doctor.py` | 349 | `easel doctor` — 检查开发环境是否就绪 |
| `easel/commands/gateway.py` | 21 | `easel gateway` — 管理 OpenClaw gateway |
| `easel/commands/ping.py` | 87 | `easel ping` — 连通性测试（直接运行，不依赖 Docker） |
| `easel/commands/skill.py` | 171 | `easel skill` — 运行 SKILL，统一通过 OpenClaw agent 处理 |

**CLI 子命令**（`easel/cli.py`，`prog="easel"`，`subparsers(dest="command", required=True)`）：
| 子命令 | 参数 | handler |
|---|---|---|
| `chat` | — | `cmd_chat` |
| `doctor` | — | `cmd_doctor` |
| `gateway` | 位置参数 `action` choices `["start","stop","restart","status","logs"]`，`nargs="?"`，default `"status"` | `cmd_gateway` |
| `ping` | — | `cmd_ping` |
| `skill` | 位置参数 `name` + `--input/-i`(required) + `--profile/-p` | `cmd_skill` |
| `web` | `--port` int default 7860 | `cmd_web` |

docstring usage：`easel chat` / `easel doctor` / `easel gateway {start|stop|status}` / `easel ping` / `easel skill <name> -i "..." -p <画像>`。
`PROJECT_ROOT = parents[1]`；`PROFILES_DIR = PROJECT_ROOT/"profiles"`；`PROFILE = "easel"`；`TIMEOUT_CHAT` 来自 `easel/timeouts.py`。
`cmd_chat` 构造：`openclaw_base_cmd() + ["--profile","easel","tui","--session",session_key,"--timeout-ms",str(TIMEOUT_CHAT*1000)]`（可再加 `["--message", prefix]`）——**必须用 `tui`，不是 `chat`/`local`**。
`cmd_web` 执行 `[sys.executable, PROJECT_ROOT/"web"/"app.py"]`，注入 `EASEL_PORT=port`，返回其 returncode。

### 6.2 `pyproject.toml`

- `[build-system]` requires `["setuptools>=68.0"]`，build-backend `setuptools.build_meta`。
- `[project]`：name `easel`，version `0.2.1`，description `社媒内容工作流整合层 — Easel CLI`，requires-python `>=3.10`。
- 依赖是**单一扁平列表，没有 optional-dependencies / 依赖分组**：fastapi>=0.115,<1、uvicorn>=0.30,<1、sse-starlette>=2.1,<4、httpx>=0.27,<1、pydantic>=2.7,<3、segno>=1.6,<2、python-multipart>=0.0.9,<1、Pillow>=10,<13、opencv-python>=4.8,<5、numpy>=1.26,<3、pandas>=2,<4、matplotlib>=3.8,<4、librosa>=0.10,<1、faster-whisper>=1,<2、edge-tts>=6,<8、playwright>=1.45,<2、rembg>=2.0,<3、biliup>=1,<2、jieba>=0.42,<1、snownlp>=0.12,<1、markdown>=3.5,<4、websocket-client>=1.7,<2、cryptography>=42。
- `[project.scripts]` **唯一入口**：`easel = "easel.cli:main"`。
- `[tool.setuptools.packages.find]` include `["easel*"]`。
- `pytest.ini`：`[pytest] addopts = --import-mode=importlib`。
- （全文逐字见 `recon-data.md` §6。）

### 6.3 `openclaw/` 目录（配置，不是 skills）

| 路径 | 作用 |
|---|---|
| `openclaw/openclaw.json5` | JSON5 模板。文件头声明**仅供参考，setup.sh 从不套用它**——真实配置由 `openclaw config set` 写到 `~/.openclaw-easel/openclaw.json`。含 `models.providers.anthropic.apiKey = "${ANTHROPIC_API_KEY}"`。 |
| `openclaw/sync.sh` | bash。把 SKILL + workspace 同步进 OpenClaw 隔离 profile `easel`。workspace 目录**不写死**，因为 OpenClaw 布局变过（2026.6.x `~/.openclaw/workspace-easel` → 2026.9.x `~/.openclaw-easel/workspace`），经 `easel/openclaw_workspace.py` 解析；环境变量 `EASEL_OPENCLAW_WORKSPACE` 可覆盖；配置落到 `~/.openclaw-easel/openclaw.json`。用法 `bash openclaw/sync.sh`。 |
| `openclaw/workspace/AGENTS.md` | workspace 内 agent 指令（提到 persona_gate） |
| `openclaw/workspace/SOUL.md` | 人格文件 |

> 顶层 `openclaw/` 与 `skills/openclaw/` 是**两个不同目录**，不要混淆。

### 6.4 `tests/` 清单

**24 个文件**（含 `tests/__init__.py` 0 行）→ **23 个测试模块**。
父任务提到的「20 个 OpenClaw 集成测试」**与事实不符**：`tests/` 下没有专门的 OpenClaw 集成测试目录，共 23 个模块。

| 文件 | 行数 | 覆盖领域 |
|---|---|---|
| `tests/__init__.py` | 0 | — |
| `tests/test_agnes_image.py` | 256 | `ai_image.py` Agnes AI provider 回归（issue #51） |
| `tests/test_ai_video_env.py` | 74 | （无 docstring）AI 视频环境 |
| `tests/test_core.py` | 585 | Easel 整合层核心纯函数单测（也覆盖 `persona_gate`） |
| `tests/test_custom_provider_protocol.py` | 88 | 自定义供应商协议（openai 默认 / anthropic-messages） |
| `tests/test_data_tracker.py` | 73 | Data-tracker 存储与粉丝导出契约 |
| `tests/test_doctor_config_path.py` | 41 | doctor 配置路径同一真相源 |
| `tests/test_gateway_endpoint.py` | 335 | gateway 端口解析回归 |
| `tests/test_local_agents.py` | 298 | 本机 agent CLI 探测与接入 |
| `tests/test_local_write_guard.py` | 148 | `web.app.local_write_guard` 行为 |
| `tests/test_models_fetch.py` | 162 | 拉取模型列表 |
| `tests/test_mp_login.py` | 94 | 公众号重复登录及异常状态回归（不启动真实浏览器） |
| `tests/test_openclaw_cmd_resolution.py` | 129 | `openclaw_base_cmd` 找 npm 自定义全局前缀 |
| `tests/test_openclaw_cmd_shim.py` | 96 | Windows npm `.cmd` shim 绕开 cmd.exe |
| `tests/test_output_delete_protect.py` | 26 | 内容库删除不得清掉 `_sessions` 等系统顶层 |
| `tests/test_output_paths.py` | 47 | （无 docstring）outputs 路径规约 |
| `tests/test_pr1.py` | 190 | PR #1 跨平台健壮性回归 |
| `tests/test_setup_auth.py` | 340 | 认证配置链路回归 |
| `tests/test_setup_issue26.py` | 226 | issue #26 安装链路三处静默失败 |
| `tests/test_setup_mirrors.py` | 194 | `setup.sh` 国内镜像加速回归 |
| `tests/test_web_anthropic_slot.py` | 197 | Web 设置面板 anthropic 通道回归 |
| `tests/test_web_openclaw_path.py` | 87 | #62 回归：web 读写 `openclaw.json` 必须走 `easel.openclaw_workspace` |
| `tests/test_web_security.py` | 402 | 设置类接口安全回归（PR #46/#47 写 `.env` / 装工具入口） |
| `tests/test_workspace_resolution.py` | 225 | workspace 目标解析回归（issue #19） |

**另有** `skills/openclaw/skill-wechat-publisher/tests/`：`__init__.py`、`conftest.py`、`test_ai_score.py`、`test_config.py`、`test_config_integration.py`、`test_html_converter.py`（属于该 SKILL 自带测试，不在 `_repo/tests/`）。

---

## 7. `skills/openclaw/**/SKILL.md` frontmatter 聚合

- `skills/openclaw/` 下**恰好 114 个二级目录**，且**每个目录都有 1 个 `SKILL.md`**（`find -name SKILL.md | wc -l` = 114；`mindepth 2 -maxdepth 2` 同名计数 = 114）。
- `EASEL-META.md` 存在于 **94** 个目录（不是全部）。
- **`EASEL-META.md` 没有任何 YAML frontmatter**：它以 Markdown 表格记录来源溯源，字段为 `SKILL 名称 / 所属层 / 来源类型 / 参考项目 / 借鉴方式 / 内部关系 / 对标 / 许可`（示例见 `skills/openclaw/card-design/EASEL-META.md`）。

### 7.1 SKILL.md frontmatter 键聚合（114 个文件）

| 键 | 出现次数 | 值类型 / 模式 |
|---|---|---|
| `name` | **114 / 114** | 纯标量字符串（不带引号）。**仅 1 处与目录名不一致**：`skills/openclaw/skill-xhs-analyzer/SKILL.md` 的 `name: redbook`（文件头注释说明目录名有意与 name 不一致，勿对齐）。 |
| `description` | **114 / 114** | 标量；四种写法：折叠块 `>-`（46 个）、折叠块 `>`（29 个）、字面块 `|`（5 个）、单行纯标量或双引号标量（34 个）。无列表、无嵌套。 |
| `layer` | **114 / 114** | 纯标量字符串。取值分布：`produce` 52、`publish` 20、`plan` 16、`attribute` 11、`discover` 9、`general` 6（合计 114）。 |
| `metadata` | **1 / 114** | 嵌套 mapping，仅 `skills/openclaw/skill-xhs-analyzer/SKILL.md`（L11-21）：`metadata.openclaw.requires.bins`(list)、`metadata.openclaw.install`(list of mapping：`kind: node` / `package` / `bins`)、`metadata.openclaw.os`(list，`[macos]`)、`metadata.openclaw.homepage`(字符串 URL)。 |

**结论**：frontmatter 键集合恰好 4 个 —— `name`、`description`、`layer`（三者 100% 覆盖），加 1 个孤例 `metadata`。**`layer:` 确实存在且 114 个 SKILL.md 全都有。**

### 7.2 `description` 长度

按「解析后的字符串值」测量（块标量把续行按空格连接、去掉首尾空白、去掉包裹双引号）：

| 指标 | 值 |
|---|---|
| 文件数 | 114 |
| 最小 | **246** 字符（并列：`skills/openclaw/skill-kuaishou-upload/SKILL.md`、`skills/openclaw/skill-zhihu-publisher/SKILL.md`） |
| 最大 | **684** 字符（`skills/openclaw/video-production/SKILL.md`） |
| 总计 | **51563** 字符 |
| 平均 | 452 字符（51563/114 ≈ 452.3） |

长度分位参考：第 3 短 = `doc-convert` 259，第 4 = `card-quote` 265，第 5 = `roi-calculator` 269；第 3 长 = `audio-visualizer` 659、第 2 = `video-highlights` 660、`auto-short-video` 666。
**口径说明**：我的连接方式对 `>-`（折叠）是语义等价的（换行→空格），对 `|`（字面块）原本的换行被替换成空格，因此 5 个 `|` 写法的 description 长度会**略小于**含换行的原始 YAML 文本长度。

### 7.3 两个示例目录的完整布局

**`skills/openclaw/card-design/`（最小典型形态）**
```
card-design/
├── EASEL-META.md
├── SKILL.md
├── references/
│   ├── anti-ai-slop.md
│   ├── card-recipes.md
│   ├── layout-laws.md
│   ├── palettes.md
│   ├── styles.md
│   └── typography.md
└── scripts/
    └── card_audit.py
```

**`skills/openclaw/skill-wechat-publisher/`（最重形态）**
```
skill-wechat-publisher/
├── EASEL-META.md
├── SKILL.md
├── brief.md.example
├── wechat-publisher.yaml.example
├── assets/
│   ├── image-styles/         (26 个 .json + README.md + previews/ 22 个 .webp)
│   ├── theme-previews/       (16 个 .html + README.md + index.html + sample.md + screenshots/ 5 个 .webp)
│   ├── themes/               (15 个 .json)
│   └── typeset-card/template.html
├── references/               (10 个 .md：anti-ai-checklist, api_reference, article-structures,
│                              errors, image-styles-guide, inline-markup, multi-platform-sync,
│                              newspic-mode, themes, typeset-card)
├── scripts/
│   ├── ai_score.py           api.py            baoyu_image_gen.ts
│   ├── baoyu_image_gen_core.ts  config.py      generate_image.py
│   ├── html_converter.py     image_handler.py  multi_publish.py
│   ├── newspic_build.py      publish.py        sync_pages.sh
│   └── wechat_api.py         wechat_token.py
└── tests/
    ├── __init__.py  conftest.py  test_ai_score.py
    └── test_config.py  test_config_integration.py  test_html_converter.py
```

**约定的子目录**：`scripts/`、`references/`、`assets/`、`tests/`；**约定文件**：`SKILL.md`（必需）、`EASEL-META.md`（94/114 有）。`skill-xhs-publisher/` 是唯一还有 `AGENTS.md`、`public/`、`references/`、`todo.md` 的目录。

---

## Uncertainties（未确认 / 推断项）

1. **无法执行任何脚本**：本机无 `python3`。所有「退出码 / stdout / selftest 覆盖」结论均来自源码静态阅读，**未实跑验证**。尤其 `selftest` 的通过与否只反映源码断言内容。
2. **`_die` 的默认退出码**：多数脚本为 `code=1`，但个别脚本可能传别的值（如 `account_stats.cmd_fetch` 传 `3`）。我没有逐个穷举全部 44 个脚本的每个 `_die` 调用点。
3. **`account_stats.py` 的 5 平台 vs `publish_dispatch.py` 的 7 平台**：两者集合不同，且 `publish_dispatch` 用 `wechat` 而 `account_stats`/`web_publisher` 用 `weixin-channels`。我未找到一份「全局唯一平台枚举」常量；**是否存在第七个平台的 `web_publisher` 配置（`wechat` 的 Playwright 路径）尚未确认** —— `web_publisher.PLATFORMS` 只有 3 个键，公众号走的是 `skill-wechat-publisher`（API/会话式），不是 Playwright 发布器。（推断）
4. **`xhs_publish` / `douyin_publish` 的完整选择器配置**：我只确认了 `web_publisher.py` 的 `publish_success` 结构；这两个脚本的发布成功判定细节（`_wait_publish_success` 的具体轮询条件）未逐行核实。
5. **`multi_publish.py` 的同步平台集合**：只看到参数声明（`--input/--title/--cover` + 多平台参数），未核实它支持的平台清单。
6. **frontmatter 长度口径**：`|` 字面块 description 的长度按「换行→空格」计算，比原始 YAML 文本略短；`>-` 折叠块为语义等价。若需严格按原始文本字节数，需重新解析（本机无 python3，只能用 awk，口径如上）。
7. **`description` 的 34 个单行标量**中，我未逐一区分「纯标量」与「双引号标量」的精确数量，只确认两者合计 34。
8. **`web/app.py` 路由计数**：`@app.` 装饰器 66 条，其中 L480 是 `@app.middleware('http')`，因此 HTTP 路由 = 65。此前口头汇报的「66 条路由」是**把 middleware 计入的错误说法**，此处更正。
9. **`publish_dispatch.py` 的 `PLATFORMS` 是否还有第 8 个键**：我完整读取了 L28-50，确认恰好 7 个键闭合于 L50（`}`），无遗漏。（已确认，非推断）
10. **`XHS` / `douyin` 的登录三态**：三态判定逻辑我只在 `web_publisher.py` 与 `login_state.py` 中核实；`xhs_publish.py` / `douyin_publish.py` 内部是否有独立判定分支未逐行核实（它们也 import `login_state`）。
