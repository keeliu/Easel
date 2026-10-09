/**
 * 账号登录态与归因数据。
 *
 * 三条硬约束（spec `platform-publishing`）驱动这里的设计：
 * 1. **登录只能由用户亲自完成**——本模块从不代填、迁移、导出或备份任何凭据，
 *    它只报告状态并给出可复制的重新授权命令。
 * 2. **登录态必须落在仓库之外的用户态目录**——`--qr-out` / `--status-file` 一律
 *    指向 `loginStateDir`（默认 `$DSH_HOME/easel-workbench/login`），不再写回仓库。
 * 3. **归因数据失败必须报原因**——`stats()` 不缓存、不在失败时返回 0 值。
 *
 * @module easel-workbench/host/accounts
 */

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ERROR_CODES, EaselError } from "./errors.js";
import { renderCommand, runCommand } from "./exec.js";
import { ACCOUNT_STATS, SHARED_SCRIPTS_DIR, scriptPath } from "./scripts.js";

/** 登录状态机取值（`_repo/skills/shared/scripts/login_state.py`）。 */
export const LOGIN_STATES = Object.freeze([
  "starting",
  "qr_ready",
  "scanned",
  "sms_required",
  "verifying",
  "success",
  "expired",
  "error",
]);

/** 工作台对外暴露的登录三态。 */
export const ACCOUNT_STATES = Object.freeze(["authorized", "unauthorized", "unknown"]);

/** 仍在进行中的登录状态。 */
const IN_PROGRESS_STATES = Object.freeze(["starting", "qr_ready", "scanned", "sms_required", "verifying"]);

/** 浏览器持久化 profile 的根目录（与既有脚本一致，位于仓库之外）。 */
export function browserProfileRoot() {
  return join(homedir(), ".easel-browser-profiles");
}

/** `account_stats.py fetch` 支持的平台；其余平台走各自的专用脚本。 */
export const ACCOUNT_STATS_PLATFORMS = Object.freeze([
  "xiaohongshu",
  "douyin",
  "kuaishou",
  "zhihu",
  "weixin-channels",
]);

const BILI_LOGIN = `${SHARED_SCRIPTS_DIR}/bili_login.py`;
const WEIXIN_MP_STATS = `${SHARED_SCRIPTS_DIR}/weixin_mp_stats.py`;

/**
 * 七个平台的登录入口、凭据位置与取数入口。
 *
 * `login.command` 与 `login.needsPlatform` 直接对应 `_repo` 里脚本的 argparse；
 * `credentials` 是**只读描述**，仅用于环境自检展示，任何写操作都不在这里发生。
 */
export const ACCOUNT_PLATFORMS = Object.freeze([
  Object.freeze({
    id: "xiaohongshu",
    label: "小红书",
    login: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/xhs_publish.py`, command: "login", qrName: "xhs-login-qrcode.png" }),
    credentials: Object.freeze({
      kind: "browser-profile",
      profile: "XiaohongshuProfile",
      insideRepo: false,
    }),
    stats: Object.freeze({ kind: "account-stats", script: ACCOUNT_STATS, supported: true }),
    verify: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/xhs_publish.py`, command: "whoami", needsPlatform: false }),
  }),
  Object.freeze({
    id: "douyin",
    label: "抖音",
    login: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/douyin_publish.py`, command: "login", qrName: "douyin.png" }),
    credentials: Object.freeze({ kind: "browser-profile", profile: "DouyinProfile", insideRepo: false }),
    stats: Object.freeze({ kind: "account-stats", script: ACCOUNT_STATS, supported: true }),
    verify: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/douyin_publish.py`, command: "whoami", needsPlatform: false }),
  }),
  Object.freeze({
    id: "kuaishou",
    label: "快手",
    login: Object.freeze({
      script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`,
      command: "login-qr",
      needsPlatform: true,
      qrName: "kuaishou.png",
    }),
    credentials: Object.freeze({ kind: "browser-profile", profile: "KuaishouProfile", insideRepo: false }),
    stats: Object.freeze({ kind: "account-stats", script: ACCOUNT_STATS, supported: true }),
    verify: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`, command: "whoami", needsPlatform: true }),
  }),
  Object.freeze({
    id: "weixin-channels",
    label: "微信视频号",
    login: Object.freeze({
      script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`,
      command: "login-qr",
      needsPlatform: true,
      qrName: "weixin-channels.png",
    }),
    credentials: Object.freeze({ kind: "browser-profile", profile: "ChannelsProfile", insideRepo: false }),
    stats: Object.freeze({ kind: "account-stats", script: ACCOUNT_STATS, supported: true }),
    verify: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`, command: "whoami", needsPlatform: true }),
  }),
  Object.freeze({
    id: "zhihu",
    label: "知乎",
    login: Object.freeze({
      script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`,
      command: "login-qr",
      needsPlatform: true,
      qrName: "zhihu.png",
    }),
    credentials: Object.freeze({ kind: "browser-profile", profile: "ZhihuProfile", insideRepo: false }),
    stats: Object.freeze({ kind: "account-stats", script: ACCOUNT_STATS, supported: true }),
    verify: Object.freeze({ script: `${SHARED_SCRIPTS_DIR}/web_publisher.py`, command: "whoami", needsPlatform: true }),
  }),
  Object.freeze({
    id: "bilibili",
    label: "B站",
    login: Object.freeze({ script: BILI_LOGIN, command: "login", qrName: "bilibili.png" }),
    credentials: Object.freeze({
      kind: "cookie-file",
      path: "cookies.json",
      insideRepo: true,
      gitIgnored: true,
      ignoreEvidence: ".gitignore:60 — cookies.json",
    }),
    stats: Object.freeze({ kind: "bili-login", script: BILI_LOGIN, supported: true }),
    verify: Object.freeze({ script: BILI_LOGIN, command: "check", needsPlatform: false }),
  }),
  Object.freeze({
    id: "wechat-oa",
    label: "微信公众号",
    login: Object.freeze({ script: WEIXIN_MP_STATS, command: "login", qrName: "wechat-oa.png", timeoutSeconds: 240 }),
    credentials: Object.freeze({
      kind: "credential-file",
      path: "skills/openclaw/skill-wechat-publisher/wechat-publisher.yaml",
      insideRepo: true,
      gitIgnored: true,
      ignoreEvidence: ".gitignore:83 — skills/openclaw/skill-wechat-publisher/wechat-publisher.yaml",
    }),
    stats: Object.freeze({ kind: "weixin-mp", script: WEIXIN_MP_STATS, supported: true }),
    verify: Object.freeze({ script: WEIXIN_MP_STATS, command: "whoami", needsPlatform: false }),
  }),
]);

const ACCOUNT_BY_ID = new Map(ACCOUNT_PLATFORMS.map((entry) => [entry.id, entry]));

/** 取一个平台的账号描述符。 */
export function accountPlatformOf(id) {
  return ACCOUNT_BY_ID.get(id);
}

/** 登录状态文件路径（仓库之外）。 */
export function statusFileFor(id, loginStateDir) {
  return join(loginStateDir, `${id}.json`);
}

/** 二维码图片路径（仓库之外）。 */
export function qrFileFor(id, loginStateDir) {
  return join(loginStateDir, `${id}.png`);
}

/**
 * 构造重新授权命令。
 *
 * 这是 spec 要求的「重新授权入口」：插件只给出**由用户自己执行**的命令，不代替
 * 用户完成任何授权动作。
 */
export function buildLoginArgv(platformId, input) {
  const platform = accountPlatformOf(platformId);
  if (platform === undefined) {
    throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
  }
  const argv = [input.python, scriptPath(input.repoRoot, platform.login.script), platform.login.command];
  if (platform.login.needsPlatform === true) argv.push("--platform", platform.id);
  argv.push("--qr-out", qrFileFor(platform.id, input.loginStateDir));
  argv.push("--status-file", statusFileFor(platform.id, input.loginStateDir));
  argv.push("--timeout", String(platform.login.timeoutSeconds ?? 180));
  return argv;
}

/** 构造 `whoami`（真校验登录态）命令。 */
export function buildVerifyArgv(platformId, input) {
  const platform = accountPlatformOf(platformId);
  if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
  const argv = [input.python, scriptPath(input.repoRoot, platform.verify.script), platform.verify.command];
  if (platform.verify.needsPlatform === true) argv.push("--platform", platform.id);
  return argv;
}

/** 构造账号数据抓取命令。 */
export function buildAccountStatsArgv(platformId, input) {
  const platform = accountPlatformOf(platformId);
  if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
  const script = scriptPath(input.repoRoot, platform.stats.script);
  if (platform.stats.kind === "account-stats") return [input.python, script, "fetch", "--platform", platform.id];
  if (platform.stats.kind === "bili-login") {
    return [input.python, script, "stats", "--cookie", join(input.repoRoot, "cookies.json")];
  }
  return [input.python, script, "stats"];
}

/** 判断 `cookies.json` 里是否含 B站的会话字段。 */
export function hasBiliSession(text) {
  return /"SESSDATA"\s*:/.test(text) || /SESSDATA=/.test(text);
}

/** 从一个可能夹着日志的输出里抠出第一个 JSON 对象/数组。 */
export function extractJson(text) {
  const source = String(text ?? "");
  const starts = [source.indexOf("{"), source.indexOf("[")].filter((index) => index >= 0);
  if (starts.length === 0) return undefined;
  const start = Math.min(...starts);
  const open = source[start];
  const close = open === "{" ? "}" : "]";
  const end = source.lastIndexOf(close);
  if (end <= start) return undefined;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** 把登录状态文件的一行映射成三态。 */
export function stateToAccountState(state) {
  if (state === "success") return "authorized";
  if (state === "expired" || state === "error") return "unauthorized";
  if (IN_PROGRESS_STATES.includes(state)) return "unknown";
  return undefined;
}

/**
 * 建立账号服务。
 *
 * @param {{ runtime: Record<string, any>, subprocess?: object | (() => object | undefined), paths: object,
 *   resolvePython: () => Promise<string> }} deps
 */
export function createAccountsService(deps) {
  const { runtime, subprocess, paths } = deps;

  async function requirePython() {
    const python = await deps.resolvePython();
    if (python === undefined) {
      throw new EaselError(
        ERROR_CODES.RUNTIME_MISSING,
        "未找到 Python 解释器，无法读取平台账号状态。请先完成运行时准备。",
      );
    }
    return python;
  }

  async function readJsonIfAny(path) {
    try {
      const text = await readFile(path, "utf8");
      const parsed = JSON.parse(text);
      return parsed !== null && typeof parsed === "object" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /** 定位该平台的登录状态文件：优先插件自己的目录，其次既有 `outputs/_login`。 */
  async function locateStateFile(platform) {
    const owned = statusFileFor(platform.id, runtime.loginStateDir);
    if (await exists(owned)) return { path: owned, source: "plugin-login-state" };
    const legacy = join(runtime.easelRoot, "outputs", "_login", `${platform.id}.json`);
    if (await exists(legacy)) return { path: legacy, source: "repo-login-state" };
    return undefined;
  }

  async function statusOf(platform) {
    const located = await locateStateFile(platform);
    if (located !== undefined) {
      const record = await readJsonIfAny(located.path);
      const state = typeof record?.state === "string" ? record.state : undefined;
      const mapped = stateToAccountState(state);
      if (mapped !== undefined) {
        return {
          platform: platform.id,
          label: platform.label,
          state: mapped,
          verified: false,
          rawState: state ?? null,
          message: typeof record?.message === "string" ? record.message : "",
          stateFile: located.path,
          stateSource: located.source,
          credentials: describeCredentials(platform),
          checkedAt: new Date().toISOString(),
        };
      }
    }

    if (platform.credentials.kind === "cookie-file") {
      const cookiePath = join(runtime.easelRoot, platform.credentials.path);
      const text = await readFile(cookiePath, "utf8").catch(() => undefined);
      if (text !== undefined && hasBiliSession(text)) {
        return baseStatus(platform, "unknown", "本地存在 B站 cookie，但有效期需要一次 whoami 校验才能确认。", {
          credentials: describeCredentials(platform, { present: true }),
        });
      }
      return baseStatus(platform, "unauthorized", "未找到可用的 B站 cookie，请先扫码登录。");
    }

    if (platform.credentials.kind === "credential-file") {
      const filePath = join(runtime.easelRoot, platform.credentials.path);
      if (await exists(filePath)) {
        return baseStatus(platform, "unknown", "公众号凭证文件存在，但有效性需要一次 whoami 校验才能确认。", {
          credentials: describeCredentials(platform, { present: true }),
        });
      }
      return baseStatus(platform, "unauthorized", "未找到公众号凭证文件，请先完成授权（插件不会读取或迁移凭据）。");
    }

    const profileDir = join(browserProfileRoot(), platform.credentials.profile);
    if (await exists(profileDir)) {
      return baseStatus(platform, "unknown", "本地存在浏览器登录档，但有效期需要一次 whoami 校验才能确认。", {
        credentials: describeCredentials(platform, { present: true }),
      });
    }
    return baseStatus(platform, "unauthorized", "本地没有该平台的登录档，请先完成扫码登录。");
  }

  function describeCredentials(platform, extra = {}) {
    const creds = platform.credentials;
    if (creds.kind === "browser-profile") {
      return {
        kind: creds.kind,
        location: join(browserProfileRoot(), creds.profile),
        insideRepo: false,
        gitIgnored: null,
        present: extra.present ?? null,
      };
    }
    return {
      kind: creds.kind,
      location: join(runtime.easelRoot, creds.path),
      insideRepo: creds.insideRepo,
      gitIgnored: creds.gitIgnored,
      ignoreEvidence: creds.ignoreEvidence ?? null,
      present: extra.present ?? null,
    };
  }

  function baseStatus(platform, state, message, extra = {}) {
    return {
      platform: platform.id,
      label: platform.label,
      state,
      verified: false,
      rawState: null,
      message,
      stateFile: null,
      stateSource: null,
      credentials: extra.credentials ?? describeCredentials(platform),
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    /** 全部平台的登录三态（不含 `whoami` 真校验）。 */
    async statusAll() {
      const out = [];
      for (const platform of ACCOUNT_PLATFORMS) out.push(await statusOf(platform));
      return out;
    },

    /** 单个平台的登录三态。 */
    async status(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      return statusOf(platform);
    },

    /**
     * 真校验登录态：运行该平台的 `whoami`。
     *
     * 这是唯一能把 `unknown` 收敛成确定状态的途径，且必须由用户在界面上显式触发。
     */
    async verify(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const python = await requirePython();
      const argv = buildVerifyArgv(platform.id, {
        python,
        repoRoot: runtime.easelRoot,
      });
      const result = await runCommand(subprocess, {
        argv,
        cwd: runtime.easelRoot,
        timeoutMs: runtime.publishTimeoutMs,
      });
      const parsed = extractJson(result.stdout);
      const loggedIn = typeof parsed?.loggedIn === "boolean"
        ? parsed.loggedIn
        : typeof parsed?.logged_in === "boolean"
          ? parsed.logged_in
          : undefined;
      const state = loggedIn === true ? "authorized" : loggedIn === false ? "unauthorized" : "unknown";
      return {
        platform: platform.id,
        label: platform.label,
        state,
        verified: loggedIn !== undefined,
        rawState: null,
        message: loggedIn === undefined
          ? `whoami 未给出可判定的登录结论（退出码 ${String(result.exitCode)}）。`
          : loggedIn
            ? "whoami 确认登录态有效。"
            : "whoami 确认登录态已失效，请重新授权。",
        command: renderCommand(argv),
        exitCode: result.exitCode,
        profile: parsed ?? null,
        credentials: describeCredentials(platform),
        checkedAt: new Date().toISOString(),
      };
    },

    /** 重新授权命令（只返回命令，绝不代替用户执行授权）。 */
    async loginPlan(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const python = await requirePython();
      const input = { python, repoRoot: runtime.easelRoot, loginStateDir: runtime.loginStateDir };
      const argv = buildLoginArgv(platform.id, input);
      return {
        platform: platform.id,
        label: platform.label,
        argv,
        command: renderCommand(argv),
        qrPath: qrFileFor(platform.id, runtime.loginStateDir),
        statusFile: statusFileFor(platform.id, runtime.loginStateDir),
        profileRoot: browserProfileRoot(),
        outsideRepo: paths.isInsideRepo(runtime.loginStateDir) === false,
        note: "扫码授权必须由你本人在浏览器/手机上完成；工作台不会代填、迁移或导出任何平台凭据。",
      };
    },

    /**
     * 归因数据。**失败即报错，绝不返回上次残留或虚构数值。**
     */
    async stats(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const python = await requirePython();
      const argv = buildAccountStatsArgv(platform.id, { python, repoRoot: runtime.easelRoot });
      const result = await runCommand(subprocess, {
        argv,
        cwd: runtime.easelRoot,
        timeoutMs: runtime.publishTimeoutMs,
      });
      const parsed = extractJson(result.stdout);
      if (result.exitCode !== 0 || parsed === undefined) {
        throw new EaselError(
          ERROR_CODES.SOURCE_UNAVAILABLE,
          `未能获取 ${platform.label} 的账号数据（退出码 ${String(result.exitCode)}）。`,
          {
            details: {
              platform: platform.id,
              command: renderCommand(argv),
              stderr: result.stderr.trim(),
              stdout: result.stdout.trim().slice(0, 2000),
            },
          },
        );
      }
      return {
        platform: platform.id,
        label: platform.label,
        command: renderCommand(argv),
        fetchedAt: new Date().toISOString(),
        data: parsed,
      };
    },

    /** 内部描述符，供环境自检使用。 */
    descriptors: ACCOUNT_PLATFORMS,
    describeCredentials,
    browserProfileRoot,
  };
}
