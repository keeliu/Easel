/**
 * 工具守卫：堵住「绕过服务方法直接发布」这条路。
 *
 * spec `platform-publishing` 要求发布前的内容安全扫描**不可绕过**。工作台的发布
 * 服务方法自己会先跑 `content_guard.py`，但模型完全可以在会话里用 shell 工具直接
 * 调用同一个发布脚本。这里用 `ctx.tools.guard()` 加一层确定性守卫：
 *
 * - 直接调用平台发布脚本并带 `--exec`（真正发出内容）→ 拒绝；
 * - 任何命令带 `--allow-unsafe`（既有脚本里关闭其自身扫描的开关）→ 拒绝；
 * - 只做 dry-run（不带 `--exec`）与扫描类脚本（`content_guard.py`、`persona_gate.py`、
 *   `account_stats.py`、`calendar_ops.py`）→ 放行。
 *
 * 守卫返回的是拒绝原因字符串，`undefined` 表示放行（`ToolGuard` 契约）。
 *
 * @module easel-workbench/host/tools
 */

/** 能启动外部进程的会话工具名。 */
export const GUARDED_TOOL_NAMES = Object.freeze(["bash", "pwsh"]);

/** 真正会把内容发到平台的脚本文件名。 */
export const PUBLISH_SCRIPT_NAMES = Object.freeze([
  "xhs_publish.py",
  "douyin_publish.py",
  "web_publisher.py",
  "bili_upload.py",
  "publish_dispatch.py",
  "weixin_mp_stats.py",
]);

/** 微信发布脚本的路径片段（文件名 `publish.py` 单独匹配误伤面太大，用目录片段限定）。 */
export const PUBLISH_SCRIPT_PATH_HINTS = Object.freeze(["skill-wechat-publisher", "skill-cross-platform-publish"]);

/** 只做校验、不发出内容的脚本，永远放行。 */
export const SAFE_SCRIPT_NAMES = Object.freeze([
  "content_guard.py",
  "persona_gate.py",
  "account_stats.py",
  "calendar_ops.py",
  "bili_login.py",
]);

/** 关闭既有脚本自身内容扫描的开关；本插件永不传递，也禁止模型传递。 */
export const UNSAFE_FLAG = "--allow-unsafe";

/** 真正执行发布的开关。 */
export const EXEC_FLAG = "--exec";

/** 把命令里出现的脚本名找出来（按路径片段匹配，避免误伤同名的无关文件）。 */
export function referencedPublishScripts(command) {
  const source = String(command ?? "");
  const found = [];
  for (const name of PUBLISH_SCRIPT_NAMES) {
    if (source.includes(name)) found.push(name);
  }
  if (/(^|[\s"'/\\])publish\.py\b/.test(source)) {
    if (PUBLISH_SCRIPT_PATH_HINTS.some((hint) => source.includes(hint))) found.push("publish.py");
  }
  return found;
}

/**
 * 判定一条 shell 命令是否被守卫拒绝。
 *
 * @param {string} command
 * @returns {{ blocked: boolean, code?: string, reason?: string, scripts?: string[] }}
 */
export function inspectCommand(command) {
  const source = String(command ?? "");
  if (source.trim() === "") return { blocked: false };
  const scripts = referencedPublishScripts(source);
  // 顺序要紧：`--allow-unsafe` 的判定必须在「扫描类脚本放行」之前，否则
  // `content_guard.py --allow-unsafe` 这种调用会先被当成安全脚本放行出去。
  if (new RegExp(`(^|\\s)${UNSAFE_FLAG}(\\s|$)`).test(source)) {
    return {
      blocked: true,
      code: "unsafe-flag",
      scripts,
      reason:
        `被 Easel 内容安全门禁拒绝：命令里出现了 ${UNSAFE_FLAG}。该开关会关闭发布脚本自身的内容扫描，` +
        "而对外发布必须先经过确定性内容安全扫描。请改用工作台的发布入口（发布前会自动扫描），或去掉该开关后重试。",
    };
  }
  const isSafeOnly =
    scripts.length === 0 && SAFE_SCRIPT_NAMES.some((name) => source.includes(name));
  if (isSafeOnly) return { blocked: false };
  if (scripts.length > 0 && new RegExp(`(^|\\s)${EXEC_FLAG}(\\s|$)`).test(source)) {
    return {
      blocked: true,
      code: "direct-publish",
      scripts,
      reason:
        `被 Easel 内容安全门禁拒绝：直接调用发布脚本 ${scripts.join("、")} 并带 ${EXEC_FLAG} 会绕过发布前的` +
        "内容安全扫描。请改用工作台的「发布」区域提交这次发布（会先跑 content_guard.py，命中即阻止）；" +
        "只做预览时请去掉 --exec。",
    };
  }
  return { blocked: false, scripts };
}

/**
 * 构造 `ToolGuard`。
 *
 * 守卫只认「能起进程的工具 + 命中发布脚本 + 带执行开关」这一组合，
 * 因此不会影响正常的读写、构建与扫描类命令。
 */
export function createPublishGuard() {
  return (execution) => {
    if (execution === undefined || execution === null) return undefined;
    if (!GUARDED_TOOL_NAMES.includes(execution.name)) return undefined;
    const args = execution.arguments;
    const command = typeof args?.command === "string" ? args.command : "";
    const verdict = inspectCommand(command);
    return verdict.blocked ? verdict.reason : undefined;
  };
}
