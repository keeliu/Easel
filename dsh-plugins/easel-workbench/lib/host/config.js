/**
 * 插件常量、`Config` schema 与仓库根定位。
 *
 * 这一层刻意不依赖 DSH 的任何宿主服务：它只做纯函数式的配置解析与路径推断，
 * 因此可以在测试里用任意 cwd / moduleUrl 驱动。
 *
 * @module easel-workbench/host/config
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";

/** 侧边栏条目 id、`main` 键位与 locale 命名空间共用的标识。 */
export const PANEL_ID = "easel-workbench";

/** 创作者画像的六个维度；目录名即画像标识，维度文件名即 `${dimension}.md`。 */
export const PROFILE_DIMENSIONS = Object.freeze([
  "identity",
  "style",
  "audience",
  "platforms",
  "preferences",
  "memory",
]);

/** `profiles/` 下的模板目录名，列出画像时永远跳过它。 */
export const PROFILE_TEMPLATE_DIR = "_template";

/** 工作台面板的十个功能区域，顺序即子导航顺序。 */
export const REGIONS = Object.freeze([
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
]);

/**
 * 上游只读子树的仓库相对前缀。这些路径下的任何写入都必须被拒绝：
 * `skills/` 整体由上游维护，`skills/shared/scripts/` 是既有脚本的实现目录。
 */
export const UPSTREAM_READ_ONLY_PREFIXES = Object.freeze(["skills"]);

/** 内容库产物目录里可能出现的媒体扩展名（用于决定「预览」还是「下载」）。 */
export const MEDIA_EXTENSIONS = Object.freeze({
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"],
  video: [".mp4", ".mov", ".webm", ".mkv"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"],
});

/** 判定一个目录是否是 Easel 检出（含 `skills/` 与 `pyproject.toml`）。 */
export function isEaselCheckout(dir) {
  try {
    return (
      statSync(join(dir, "skills")).isDirectory() && statSync(join(dir, "pyproject.toml")).isFile()
    );
  } catch {
    return false;
  }
}

/**
 * 判定一个目录是否是「bundle 工作区」：`_repo/` 里嵌着上游检出，旁边是 `dsh-plugins/`；
 * 或者它自己就是 Easel 检出（把 Easel 直接克隆成顶层目录的部署方式）。
 */
export function isRepoRoot(dir) {
  try {
    if (statSync(join(dir, "_repo")).isDirectory() && statSync(join(dir, "dsh-plugins")).isDirectory()) {
      return true;
    }
  } catch {
    // 落到下面的「本目录就是检出」判定。
  }
  return isEaselCheckout(dir);
}

/** 自 `start` 起逐级向上收集目录（含 `start` 自身），到文件系统根为止。 */
function ancestors(start) {
  const out = [];
  let current = resolve(start);
  for (;;) {
    out.push(current);
    const parent = dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

/**
 * 定位 Easel 仓库根。优先使用显式配置，其次从插件包自身真实路径向上查找，
 * 最后从进程工作目录向上查找。
 *
 * 调用方（`lib/index.js`）把 `import.meta.url` 传进来，这样即使插件通过
 * profile 的 `node_modules` 符号链接加载，也能解析回仓库内的真实位置。
 *
 * @param {{ configured?: string, moduleUrl?: string, cwd?: string }} input
 * @returns {string | undefined} 仓库根绝对路径；找不到时返回 `undefined`（不是抛错）。
 */
export function detectRepoRoot(input = {}) {
  const { configured, moduleUrl, cwd } = input;
  const candidates = [];
  if (typeof configured === "string" && configured.trim() !== "") {
    candidates.push(...ancestors(configured.trim()));
  }
  if (typeof moduleUrl === "string" && moduleUrl.startsWith("file:")) {
    candidates.push(...ancestors(dirname(fileURLToPath(moduleUrl))));
  }
  if (typeof cwd === "string" && cwd !== "") {
    candidates.push(...ancestors(cwd));
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (isRepoRoot(candidate)) return candidate;
  }
  return undefined;
}

/** 相对 `repoRoot` 解析一个配置目录；已经是绝对路径时按原样返回。 */
export function resolveWithinRepo(repoRoot, value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (isAbsolute(trimmed)) return resolve(trimmed);
  return repoRoot === undefined ? resolve(trimmed) : resolve(repoRoot, trimmed);
}

/**
 * 定位 Easel **数据根**：`skills/`、`profiles/`、`outputs/` 所在的那一层。
 *
 * 两种部署都要支持：
 * - 工作区形态（本会话即如此）：`<工作区>/_repo` 是上游检出，`<工作区>/dsh-plugins` 是 bundle；
 * - 直接克隆形态：Easel 就是顶层目录，此时数据根与检出根是同一层。
 *
 * @param {{ configured?: string, repoRoot?: string }} input
 * @returns {string | undefined}
 */
export function detectEaselRoot(input = {}) {
  const configured = typeof input.configured === "string" ? input.configured.trim() : "";
  if (configured !== "") {
    const absolute = resolve(configured);
    return isEaselCheckout(absolute) ? absolute : undefined;
  }
  if (input.repoRoot === undefined) return undefined;
  const nested = join(input.repoRoot, "_repo");
  if (isEaselCheckout(nested)) return nested;
  if (isEaselCheckout(input.repoRoot)) return input.repoRoot;
  return undefined;
}

/** `taskDispatchTarget` 的两个受支持取值。 */
export const DISPATCH_TARGETS = Object.freeze(["current-session", "new-session"]);

/**
 * 宿主侧配置 schema。
 *
 * 这里**不含**任何「跳过安全扫描」「放行命中项」之类的开关：按 spec
 * `platform-publishing` 的要求，内容安全门禁必须是强制且不可绕过的。
 */
export const Config = Schema.object({
  /** bundle 工作区根；留空表示按插件包真实路径与进程工作目录自动推断。 */
  repoRoot: Schema.string().default(""),
  /**
   * Easel 数据根（`skills/`、`profiles/`、`outputs/` 所在层）。
   * 留空表示自动推断：优先 `<工作区>/_repo`，其次工作区目录自身。
   */
  easelRoot: Schema.string().default(""),
  /** 受控 Python 解释器路径；留空表示使用引导脚本创建的 venv。 */
  pythonExecutable: Schema.string().default(""),
  /** ffmpeg 可执行文件路径；留空表示在运行时目录与 PATH 中查找。 */
  ffmpegExecutable: Schema.string().default(""),
  /** 创作者画像目录，相对仓库根。 */
  profilesDir: Schema.string().default("profiles"),
  /** 内容库产物目录，相对仓库根。 */
  outputsDir: Schema.string().default("outputs"),
  /** 选题库文件，相对仓库根；沿用 Easel 既有 `outputs/_ideas.json`。 */
  topicsFile: Schema.string().default("outputs/_ideas.json"),
  /** 内容排期既有数据文件，相对仓库根；沿用 Easel 既有 `outputs/_schedule.json`。 */
  scheduleFile: Schema.string().default("outputs/_schedule.json"),
  /** 需要暴露给 DSH 技能体系的 Easel 技能根，相对仓库根。 */
  skillDirs: Schema.array(Schema.string()).default(["skills/openclaw"]),
  /** 技能目录里单条 description 的最大字符数（DSH 技能目录成本控制）。 */
  catalogDescriptionMaxLength: Schema.number().min(3).default(500),
  /** 工作台提交任务时的默认派发目标。 */
  taskDispatchTarget: Schema.union([...DISPATCH_TARGETS]).default("current-session"),
  /** 创作者人设文本来源；留空表示使用随包交付的 `assets/persona.md`。 */
  personaSource: Schema.string().default(""),
  /** Easel 操作规则段来源；留空表示使用随包交付的 `assets/rules.md`。 */
  rulesSource: Schema.string().default(""),
  /**
   * 登录态与二维码的存放目录。留空表示 `$DSH_HOME/easel-workbench/login`。
   * 该目录**必须位于仓库之外**：spec 要求登录态不得留在被版本控制的仓库里。
   */
  loginStateDir: Schema.string().default(""),
  /** 发布脚本的单次执行超时（毫秒）。 */
  publishTimeoutMs: Schema.number().min(1000).default(600_000),
  /** 人设一致性评分低于该值只告警、不阻断发布。 */
  personaScoreThreshold: Schema.number().default(70),
  /** 受控运行时目录（引导脚本的产物）。留空表示 `<插件包根>/.runtime`。 */
  runtimeDir: Schema.string().default(""),
});

/**
 * 解析登录态目录。
 *
 * 优先级：显式配置 → `$DSH_HOME/easel-workbench/login` → `~/.dsh/easel-workbench/login`。
 * 三个来源都在仓库之外，因此登录态永远不会进入版本控制。
 *
 * @param {string} configured
 * @param {{ dshHome?: string }} [env]
 */
export function resolveLoginStateDir(configured, env = {}) {
  if (typeof configured === "string" && configured.trim() !== "") return resolve(configured.trim());
  const home = env.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "easel-workbench", "login");
}

/**
 * 解析后的运行时视图：把 schema 校验过的配置补上推断出来的绝对路径。
 *
 * @param {Record<string, unknown>} raw schemastery 校验后的配置。
 * @param {{ moduleUrl?: string, cwd?: string, dshHome?: string, assetsDir?: string }} [env]
 */
export function resolveRuntimeConfig(raw, env = {}) {
  const config = raw ?? {};
  const repoRoot = detectRepoRoot({
    configured: config.repoRoot,
    moduleUrl: env.moduleUrl,
    cwd: env.cwd ?? process.cwd(),
  });
  const easelRoot = detectEaselRoot({ configured: config.easelRoot, repoRoot });
  const packageRoot =
    env.packageRoot !== undefined
      ? resolve(env.packageRoot)
      : typeof env.moduleUrl === "string" && env.moduleUrl.startsWith("file:")
        ? dirname(fileURLToPath(env.moduleUrl))
        : undefined;
  /** 数据路径以 Easel 数据根为基准。 */
  const dir = (value) => resolveWithinRepo(easelRoot ?? repoRoot, value);
  /** 插件自身产物（受控运行时）以插件包根为基准。 */
  const pluginDir = (value) => {
    if (typeof value === "string" && value.trim() !== "") {
      return isAbsolute(value.trim()) ? resolve(value.trim()) : resolve(packageRoot ?? process.cwd(), value.trim());
    }
    return packageRoot === undefined ? undefined : join(packageRoot, ".runtime");
  };
  return {
    repoRoot,
    easelRoot,
    packageRoot,
    configured: easelRoot !== undefined,
    pythonExecutable: config.pythonExecutable === "" ? undefined : config.pythonExecutable,
    ffmpegExecutable: config.ffmpegExecutable === "" ? undefined : config.ffmpegExecutable,
    profilesDir: dir(config.profilesDir),
    outputsDir: dir(config.outputsDir),
    topicsFile: dir(config.topicsFile),
    scheduleFile: dir(config.scheduleFile),
    skillDirs: (config.skillDirs ?? []).map((entry) => dir(entry)).filter(Boolean),
    catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
    taskDispatchTarget: config.taskDispatchTarget,
    personaSource: optionalPluginPath(config.personaSource, packageRoot),
    rulesSource: optionalPluginPath(config.rulesSource, packageRoot),
    loginStateDir: resolveLoginStateDir(config.loginStateDir, env),
    assetsDir: env.assetsDir === undefined ? undefined : resolve(env.assetsDir),
    /** 插件包根目录。随包资源（`assets/persona.md`、`assets/rules.md`）以此为基准。 */
    packageRoot,
    publishTimeoutMs: config.publishTimeoutMs,
    personaScoreThreshold: config.personaScoreThreshold,
    runtimeDir: pluginDir(config.runtimeDir),
    schema: config,
  };
}

/**
 * 人设/规则文本来源：空值视作未配置；绝对路径原样使用，**相对路径以插件包根为基准**
 * （不用进程工作目录——工作目录随启动方式变化，会静默读到错误的文件）。
 */
export function optionalPluginPath(value, packageRoot) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(packageRoot ?? process.cwd(), trimmed);
}

/** 引导脚本创建的 venv 解释器的约定位置。 */
export function venvPython(runtimeDir) {
  return join(runtimeDir, "venv", "bin", "python");
}

/** 引导脚本下载的 ffmpeg 的约定位置。 */
export function runtimeFfmpeg(runtimeDir) {
  return join(runtimeDir, "ffmpeg", "bin", "ffmpeg");
}

/** `existsSync` 的一个便于测试的薄包装。 */
export function fileExists(path) {
  return typeof path === "string" && path !== "" && existsSync(path);
}
