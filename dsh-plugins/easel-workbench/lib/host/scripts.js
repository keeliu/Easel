/**
 * Easel 仓库既有脚本的定位与argv 构造。
 *
 * 这里**只做参数拼装**，不执行任何命令、不判断发布是否成功：spec
 * `platform-publishing` 要求「发布必须通过调用仓库内既有的平台发布脚本完成，
 * MUST NOT 自行实现各平台发布协议或 HTTP 调用」，所以插件的全部发布能力都来自
 * 下面这些固定入口。argv 的形状逐条对齐 `_repo` 里脚本的 argparse 定义。
 *
 * @module easel-workbench/host/scripts
 */

import { join } from "node:path";

/** 共享脚本目录（仓库相对）。 */
export const SHARED_SCRIPTS_DIR = "skills/shared/scripts";

/** 内容安全闸门脚本（仓库相对）。 */
export const CONTENT_GUARD = `${SHARED_SCRIPTS_DIR}/content_guard.py`;

/** 人设一致性评分脚本（仓库相对）。 */
export const PERSONA_GATE = `${SHARED_SCRIPTS_DIR}/persona_gate.py`;

/** 账号数据抓取脚本（仓库相对）。 */
export const ACCOUNT_STATS = `${SHARED_SCRIPTS_DIR}/account_stats.py`;

/** 内容排期既有数据文件的操作脚本（仓库相对），只用于读取既有 `_schedule.json`。 */
export const CALENDAR_OPS = `${SHARED_SCRIPTS_DIR}/calendar_ops.py`;

/** 跨平台派发约束表脚本（仓库相对）。 */
export const PUBLISH_DISPATCH = "skills/openclaw/skill-cross-platform-publish/scripts/publish_dispatch.py";

/** 七个平台的精确标识与发布入口；顺序即 UI 展示顺序。 */
export const PLATFORMS = Object.freeze([
  Object.freeze({
    id: "xiaohongshu",
    label: "小红书",
    style: "xhs",
    script: `${SHARED_SCRIPTS_DIR}/xhs_publish.py`,
    accepts: Object.freeze(["image", "video"]),
    limits: Object.freeze({ title: 20, body: 1000, tags: 10 }),
  }),
  Object.freeze({
    id: "douyin",
    label: "抖音",
    style: "xhs",
    script: `${SHARED_SCRIPTS_DIR}/douyin_publish.py`,
    accepts: Object.freeze(["video", "image"]),
    limits: Object.freeze({ title: 30, body: 1000, tags: 5 }),
  }),
  Object.freeze({
    id: "wechat",
    label: "微信公众号",
    style: "wechat",
    script: "skills/openclaw/skill-wechat-publisher/scripts/publish.py",
    accepts: Object.freeze(["article"]),
    limits: Object.freeze({ title: 64, body: 0, tags: 0 }),
  }),
  Object.freeze({
    id: "bilibili",
    label: "B站",
    style: "bili",
    script: "skills/openclaw/skill-bilibili-upload/scripts/bili_upload.py",
    accepts: Object.freeze(["video"]),
    limits: Object.freeze({ title: 80, body: 2000, tags: 10 }),
  }),
  Object.freeze({
    id: "kuaishou",
    label: "快手",
    style: "web",
    script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`,
    accepts: Object.freeze(["video", "image"]),
    limits: Object.freeze({ title: 500, body: 500, tags: 5 }),
  }),
  Object.freeze({
    id: "weixin-channels",
    label: "微信视频号",
    style: "web",
    script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`,
    accepts: Object.freeze(["video"]),
    limits: Object.freeze({ title: 22, body: 1000, tags: 5 }),
  }),
  Object.freeze({
    id: "zhihu",
    label: "知乎",
    style: "web",
    script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`,
    accepts: Object.freeze(["article", "answer"]),
    limits: Object.freeze({ title: 100, body: 0, tags: 5 }),
  }),
]);

const PLATFORM_BY_ID = new Map(PLATFORMS.map((entry) => [entry.id, entry]));

/** 取一个平台的描述符；未知平台返回 `undefined`。 */
export function platformOf(id) {
  return PLATFORM_BY_ID.get(id);
}

/** 把仓库相对脚本路径解析成绝对路径。 */
export function scriptPath(repoRoot, relative) {
  return join(repoRoot, relative);
}

/** 内容安全扫描的 argv（`scan` 命中 BLOCK 时退出码为 7）。 */
export function buildGuardArgv(input) {
  const argv = [input.python, scriptPath(input.repoRoot, CONTENT_GUARD), "scan"];
  if (typeof input.text === "string" && input.text !== "") argv.push("--text", input.text);
  else if (typeof input.file === "string" && input.file !== "") argv.push("--file", input.file);
  return argv;
}

/** 人设一致性评分的 argv（该脚本永远退出 0，只看 stdout 的 JSON）。 */
export function buildPersonaArgv(input) {
  const argv = [input.python, scriptPath(input.repoRoot, PERSONA_GATE), "check", "--score", String(input.score)];
  if (Number.isFinite(input.threshold)) argv.push("--threshold", String(input.threshold));
  if (Number.isFinite(input.warn)) argv.push("--warn", String(input.warn));
  return argv;
}

/** 账号数据抓取的 argv。 */
export function buildStatsArgv(input) {
  return [
    input.python,
    scriptPath(input.repoRoot, ACCOUNT_STATS),
    "fetch",
    "--platform",
    input.platform,
  ];
}

/** 把标签数组拼成脚本要求的逗号分隔串。 */
export function joinTags(tags) {
  if (!Array.isArray(tags)) return undefined;
  const cleaned = tags.map((tag) => String(tag).trim()).filter((tag) => tag !== "");
  return cleaned.length === 0 ? undefined : cleaned.join(",");
}

/** 把媒体路径数组拼成脚本要求的逗号分隔串。 */
export function joinPaths(paths) {
  if (!Array.isArray(paths)) return undefined;
  const cleaned = paths.map((path) => String(path).trim()).filter((path) => path !== "");
  return cleaned.length === 0 ? undefined : cleaned.join(",");
}

/**
 * 构造一次发布的 argv。
 *
 * `exec` 为假时脚本进入 dry-run（只预演），为真时追加 `--exec`。
 * **永远不追加 `--allow-unsafe`**：那是唯一的闸门放行开关，spec 禁止插件暴露它。
 *
 * @param {{
 *   platform: string, python: string, repoRoot: string,
 *   media?: string[], title?: string, body?: string, tags?: string[],
 *   cover?: string, article?: string, tid?: number, exec?: boolean,
 * }} input
 * @returns {{ argv: string[], mode: 'image' | 'video' | 'article', kind: string }}
 */
export function buildPublishArgv(input) {
  const platform = platformOf(input.platform);
  if (platform === undefined) {
    throw new Error(`未知平台：${String(input.platform)}`);
  }
  const script = scriptPath(input.repoRoot, platform.script);
  const media = Array.isArray(input.media) ? input.media.filter(Boolean) : [];
  const tags = joinTags(input.tags);
  const argv = [input.python, script];
  let mode = "article";

  if (platform.style === "xhs") {
    const video = media.find((path) => /\.(mp4|mov|webm|mkv|avi)$/i.test(path));
    if (video !== undefined) {
      mode = "video";
      argv.push("publish-video", "--video", video);
    } else {
      mode = "image";
      argv.push("publish");
      const images = joinPaths(media);
      if (images !== undefined) argv.push("--images", images);
    }
    if (input.title !== undefined) argv.push("--title", input.title);
    if (input.body !== undefined) argv.push("--content", input.body);
    if (tags !== undefined) argv.push("--tags", tags);
  } else if (platform.style === "web") {
    const video = media.find((path) => /\.(mp4|mov|webm|mkv|avi)$/i.test(path));
    mode = video === undefined ? "image" : "video";
    argv.push("publish", "--platform", platform.id);
    if (media.length > 0) argv.push("--media", media[0]);
    if (input.title !== undefined) argv.push("--title", input.title);
    if (input.body !== undefined) argv.push("--desc", input.body);
    if (tags !== undefined) argv.push("--tags", tags);
    if (input.cover !== undefined) argv.push("--cover", input.cover);
  } else if (platform.style === "bili") {
    mode = "video";
    argv.push("upload", "--video", media[0] ?? "");
    if (input.title !== undefined) argv.push("--title", input.title);
    if (input.body !== undefined) argv.push("--desc", input.body);
    if (tags !== undefined) argv.push("--tag", tags);
    if (input.cover !== undefined) argv.push("--cover", input.cover);
    if (Number.isFinite(input.tid)) argv.push("--tid", String(input.tid));
    argv.push("--copyright", "1");
  } else {
    mode = "article";
    const source = input.article ?? input.body;
    if (typeof source === "string" && source.endsWith(".html")) argv.push("--html", source);
    else if (typeof source === "string") argv.push("--input", source);
    if (input.title !== undefined) argv.push("--title", input.title);
    if (input.cover !== undefined) argv.push("--cover", input.cover);
  }

  if (input.exec === true) argv.push("--exec");
  return { argv, mode, kind: mode === "article" ? "article" : mode === "video" ? "video" : "image" };
}
