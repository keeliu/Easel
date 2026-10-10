/**
 * 账号登录态与归因数据。
 *
 * 三条硬约束（spec `platform-publishing`）驱动这里的设计：
 * 1. **登录只能由用户亲自完成**——本模块从不代填、迁移、导出或备份任何凭据，
 *    它只报告状态并给出可复制的重新授权命令。
 * 2. **登录态必须落在仓库之外的用户态目录**——`--qr-out` / `--status-file` 一律
 *    指向 `loginStateDir`（默认 `$DSH_HOME/dsh-easel/login`），不再写回仓库。
 * 3. **归因数据失败必须报原因**——`stats()` 不缓存、不在失败时返回 0 值。
 *
 * @module dsh-easel/host/accounts
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ERROR_CODES, EaselError } from "./errors.js";
import { browserEnv } from "./browser-deps.js";
import { renderCommand, runCommand, startCommand } from "./exec.js";
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
    login: Object.freeze({
      script: `${SHARED_SCRIPTS_DIR}/xhs_publish.py`,
      command: "login",
      qrName: "xhs-login-qrcode.png",
      noProxy: true,
    }),
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
    login: Object.freeze({
      script: `${SHARED_SCRIPTS_DIR}/douyin_publish.py`,
      command: "login",
      qrName: "douyin.png",
      noProxy: true,
      smsCodeFile: true,
    }),
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
    login: Object.freeze({ script: BILI_LOGIN, command: "login", qrName: "bilibili.png", cookieFile: true }),
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
    login: Object.freeze({
      script: WEIXIN_MP_STATS,
      command: "login",
      qrName: "wechat-oa.png",
      timeoutSeconds: 240,
      noProxy: true,
    }),
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

/** 一次性短信验证码回填文件路径（仓库之外；被脚本读走后即删除）。 */
export function codeFileFor(id, loginStateDir) {
  return join(loginStateDir, `${id}.code`);
}

/**
 * 构造重新授权命令。
 *
 * 这是 spec 要求的「重新授权入口」：插件本身不代填任何凭据；面板内的扫码登录同样
 * 只是启动这个脚本，真正的确认动作由用户本人在手机/浏览器上完成。
 *
 * 附加参数与各脚本 argparse 一一对应，不做猜测：
 * `--no-proxy`（xhs_publish / douyin_publish / weixin_mp_stats 支持）、
 * `--sms-code-file`（douyin_publish 支持）、`--cookie`（bili_login 支持）。
 */
export function buildLoginArgv(platformId, input) {
  const platform = accountPlatformOf(platformId);
  if (platform === undefined) {
    throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
  }
  const argv = [input.python, scriptPath(input.repoRoot, platform.login.script), platform.login.command];
  if (platform.login.needsPlatform === true) argv.push("--platform", platform.id);
  if (platform.login.noProxy === true) argv.push("--no-proxy");
  argv.push("--qr-out", qrFileFor(platform.id, input.loginStateDir));
  argv.push("--status-file", statusFileFor(platform.id, input.loginStateDir));
  argv.push("--timeout", String(platform.login.timeoutSeconds ?? 180));
  if (platform.login.smsCodeFile === true) {
    argv.push("--sms-code-file", codeFileFor(platform.id, input.loginStateDir));
  }
  if (platform.login.cookieFile === true) {
    argv.push("--cookie", join(input.repoRoot, "cookies.json"));
  }
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

  /**
   * 登录流水线：启动既有脚本 → 轮询状态文件 → 二维码 → 短信码 → 取消。
   *
   * 设计约束（spec `platform-publishing`）：插件从不代填、代收任何凭据；它只做
   * 「启动仓库里既有的登录脚本 + 如实转述状态文件」，真正的授权动作发生在用户
   * 自己的手机/浏览器上。
   */
  const loginJobs = new Map();

  async function loginRecordOf(platform) {
    const located = await locateStateFile(platform);
    const record = located === undefined ? undefined : await readJsonIfAny(located.path);
    const state = typeof record?.state === "string" ? record.state : "unknown";
    return {
      rawState: state,
      message: typeof record?.message === "string" ? record.message : "",
      stateFile: located?.path ?? null,
      stateSource: located?.source ?? null,
      ts: typeof record?.ts === "number" ? record.ts : null,
    };
  }

  async function qrInfoOf(platform) {
    const path = qrFileFor(platform.id, runtime.loginStateDir);
    try {
      const info = await stat(path);
      return { path, ready: true, bytes: info.size, ts: Math.floor(info.mtimeMs) };
    } catch {
      return { path, ready: false, bytes: 0, ts: 0 };
    }
  }

  /** 原子写登录状态文件（与 `login_state.write_status` 同格式）。 */
  async function writeStatusFile(path, state, message) {
    const tmp = `${path}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(tmp, JSON.stringify({ state, message, qr: "", ts: Math.floor(Date.now() / 1000) }), "utf8");
      await rename(tmp, path);
    } catch {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  function jobSummary(job) {
    if (job === undefined) return { running: false, startedAt: null, exitCode: null, tail: "" };
    return {
      running: job.finished !== true,
      startedAt: new Date(job.startedAt).toISOString(),
      exitCode: job.exitCode ?? null,
      tail: job.tail ?? "",
    };
  }

  async function loginStatusOf(platform) {
    const record = await loginRecordOf(platform);
    const job = loginJobs.get(platform.id);
    const summary = jobSummary(job);
    let rawState = record.rawState;
    let message = record.message;
    // 任务在跑但脚本还没写出状态时，语义就是「启动中」——不能报成 unknown，
    // 否则界面会在「未授权」和「正在启动」之间自相矛盾。
    if (job !== undefined && job.finished !== true && (rawState === "unknown" || rawState === "starting")) {
      rawState = "starting";
    }
    // 脚本在写出状态前就退出（依赖缺失、崩溃）时必须变成可执行的错误，
    // 而不是让界面永远停在「启动中」。
    if (job !== undefined && job.finished === true && (rawState === "unknown" || rawState === "starting")) {
      rawState = "error";
      message = `登录程序在写出状态前退出（退出码 ${job.exitCode ?? "未知"}）。${
        job.tail === "" ? "" : `输出：${job.tail}`
      }`;
    }
    const qr = await qrInfoOf(platform);
    return {
      platform: platform.id,
      label: platform.label,
      rawState,
      accountState: stateToAccountState(rawState) ?? "unknown",
      message,
      running: summary.running,
      startedAt: summary.startedAt,
      exitCode: summary.exitCode,
      logTail: summary.tail,
      qrReady: qr.ready,
      qrTs: qr.ts,
      qrBytes: qr.bytes,
      smsRequired: rawState === "sms_required",
      stateFile: record.stateFile,
      stateSource: record.stateSource,
      checkedAt: new Date().toISOString(),
      note: "扫码授权只能由你本人在手机或浏览器上确认；工作台不代填、不迁移、不导出任何凭据。",
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
        env: browserEnv(runtime.runtimeDir),
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
     * 启动扫码登录：跑仓库里既有的登录脚本，随后立刻返回，状态靠
     * {@link loginStatus} 轮询（登录是 180–240 秒量级的长流程）。
     *
     * 插件不接触任何凭据；它只是把「用户自己在终端跑那条命令」变成「点一下按钮」，
     * 扫码确认仍然只发生在用户的手机上。
     */
    async startLogin(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const existing = loginJobs.get(platform.id);
      if (existing !== undefined && existing.finished !== true) {
        throw new EaselError(
          ERROR_CODES.INVALID_INPUT,
          `${platform.label} 的登录流程已经在运行；请先取消，或等它结束后再试。`,
        );
      }
      const python = await requirePython();
      await mkdir(runtime.loginStateDir, { recursive: true });
      // 清掉上一轮残留：旧二维码/旧状态会让界面显示过期信息
      for (const path of [
        qrFileFor(platform.id, runtime.loginStateDir),
        statusFileFor(platform.id, runtime.loginStateDir),
        codeFileFor(platform.id, runtime.loginStateDir),
      ]) {
        await rm(path, { force: true }).catch(() => undefined);
      }
      const argv = buildLoginArgv(platform.id, {
        python,
        repoRoot: runtime.easelRoot,
        loginStateDir: runtime.loginStateDir,
      });
      const started = startCommand(subprocess, {
        argv,
        cwd: runtime.easelRoot,
        maxBytes: 128 * 1024,
        env: browserEnv(runtime.runtimeDir),
      });
      const job = { argv, startedAt: Date.now(), finished: false, exitCode: null, tail: "", handle: started };
      loginJobs.set(platform.id, job);

      // 脚本自己有 --timeout；这里再加 30 秒缓冲兜底，避免进程挂着不退。
      const safety = setTimeout(() => {
        started.cancel(new EaselError(ERROR_CODES.RUNTIME_MISSING, "登录等待超时，已自动结束。"));
      }, ((platform.login.timeoutSeconds ?? 180) + 30) * 1000);
      if (typeof safety.unref === "function") safety.unref();

      started.done.then((outcome) => {
        clearTimeout(safety);
        job.finished = true;
        job.exitCode = outcome.exitCode;
        const text = started.collectedText();
        job.tail = `${text.stderr}\n${text.stdout}`.trim().slice(-2000);
      });

      return {
        platform: platform.id,
        label: platform.label,
        started: true,
        rawState: "starting",
        command: renderCommand(argv),
        qrUrl: `${platform.id}/qr`,
        qrPath: qrFileFor(platform.id, runtime.loginStateDir),
        statusFile: statusFileFor(platform.id, runtime.loginStateDir),
        outsideRepo: paths.isInsideRepo(runtime.loginStateDir) === false,
        note: "已启动登录脚本；请用手机扫码。二维码出现后请在 180 秒内完成确认。",
      };
    },

    /** 轮询一次登录进度（读脚本写的状态文件 + 本进程持有的任务句柄）。 */
    async loginStatus(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      return loginStatusOf(platform);
    },

    /** 取消进行中的登录；把未成功的结果落成 `expired`，避免界面停在「进行中」。 */
    async cancelLogin(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const job = loginJobs.get(platform.id);
      if (job === undefined || job.finished === true) {
        return { platform: platform.id, label: platform.label, cancelled: false, message: "当前没有正在运行的登录流程。" };
      }
      job.handle.cancel(new EaselError(ERROR_CODES.RUNTIME_MISSING, "用户已取消登录。"));
      await job.handle.done;
      const record = await loginRecordOf(platform);
      if (record.rawState !== "success") {
        await writeStatusFile(statusFileFor(platform.id, runtime.loginStateDir), "expired", "登录已取消。");
      }
      return { platform: platform.id, label: platform.label, cancelled: true, message: "登录已取消。" };
    },

    /** 回填短信验证码（扫码后平台风控要求短信验证时）。读一次即被脚本消费。 */
    async submitSmsCode(platformId, code) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const digits = String(code ?? "").replace(/\D/g, "");
      if (digits.length < 4 || digits.length > 8) {
        throw new EaselError(ERROR_CODES.INVALID_INPUT, "短信验证码应为 4-8 位数字。");
      }
      await mkdir(runtime.loginStateDir, { recursive: true });
      await writeFile(codeFileFor(platform.id, runtime.loginStateDir), digits, "utf8");
      return { platform: platform.id, label: platform.label, accepted: true, message: "验证码已交给登录脚本。" };
    },

    /**
     * 二维码文件信息。**只允许读 `loginStateDir` 下该平台自己的 png**，
     * 路径不接受任何外部输入，因此不存在越界读取。
     */
    async qrImage(platformId) {
      const platform = accountPlatformOf(platformId);
      if (platform === undefined) throw new EaselError(ERROR_CODES.INVALID_INPUT, `未知平台：${String(platformId)}`);
      const info = await qrInfoOf(platform);
      if (!info.ready) {
        throw new EaselError(
          ERROR_CODES.NOT_FOUND,
          `${platform.label} 的二维码还没生成；登录脚本可能仍在启动，或已经退出。`,
        );
      }
      return info;
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
        env: browserEnv(runtime.runtimeDir),
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
