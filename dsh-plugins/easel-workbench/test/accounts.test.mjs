/**
 * 平台账号状态服务的测试。
 *
 * 对应 spec `platform-publishing` 的验收点：
 * - 6.1 列出七平台登录态、识别失效、失效时给出重新授权入口；
 * - 6.2 登录态目录位于仓库之外（`loginPlan().outsideRepo === true`）；
 * - 6.8 归因数据失败时报原因，绝不返回上次残留或虚构数值。
 *
 * 全部用例使用注入的假 `subprocess` 与临时目录，不联网、不真跑 python。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, it } from "node:test";

import {
  ACCOUNT_PLATFORMS,
  ACCOUNT_STATES,
  ACCOUNT_STATS_PLATFORMS,
  LOGIN_STATES,
  accountPlatformOf,
  browserProfileRoot,
  buildAccountStatsArgv,
  buildLoginArgv,
  buildVerifyArgv,
  createAccountsService,
  extractJson,
  hasBiliSession,
  qrFileFor,
  stateToAccountState,
  statusFileFor,
} from "../lib/host/accounts.js";
import { ERROR_CODES, EaselError } from "../lib/host/errors.js";
import { createPathPolicy, isInside } from "../lib/host/paths.js";

/**
 * 假子进程服务：按 `handler(spec, index)` 返回 `{ exitCode, stdout, stderr }`，
 * 形状对齐 `lib/host/exec.js` 真正调用的 `spawn()` + `handle.done` + `handle.collected.*.readFrom`。
 */
function fakeSubprocess(handler) {
  const calls = [];
  return {
    calls,
    spawn(spec) {
      const index = calls.length;
      calls.push(spec);
      const response = handler(spec, index) ?? {};
      const stdout = String(response.stdout ?? "");
      const stderr = String(response.stderr ?? "");
      const reader = (text) => ({
        readFrom(offset) {
          return { text: text.slice(offset), nextOffset: text.length, lossy: false };
        },
      });
      return {
        collected: { stdout: reader(stdout), stderr: reader(stderr) },
        done: Promise.resolve({ exitCode: response.exitCode ?? 0, signal: response.signal ?? null }),
      };
    },
  };
}

async function makeEnv(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "easel-accounts-"));
  const repoRoot = join(root, "repo");
  const loginStateDir = options.loginStateDir ?? join(root, "login-state");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(loginStateDir, { recursive: true });
  const paths = createPathPolicy({ repoRoot, readOnlyPrefixes: ["skills"] });
  return { root, repoRoot, loginStateDir, paths };
}

function serviceFor(env, { python = "python3", subprocess = fakeSubprocess(() => ({})) } = {}) {
  return createAccountsService({
    runtime: {
      easelRoot: env.repoRoot,
      loginStateDir: env.loginStateDir,
      publishTimeoutMs: 5_000,
    },
    subprocess,
    paths: env.paths,
    // `null` 表示「没有解释器」，与默认参数区分开
    resolvePython: async () => (python === null ? undefined : python),
  });
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

describe("平台清单与常量", () => {
  it("七平台登录入口齐全，顺序即 UI 展示顺序", () => {
    assert.deepEqual(
      ACCOUNT_PLATFORMS.map((platform) => platform.id),
      ["xiaohongshu", "douyin", "kuaishou", "weixin-channels", "zhihu", "bilibili", "wechat-oa"],
    );
    for (const platform of ACCOUNT_PLATFORMS) {
      assert.equal(typeof platform.label, "string");
      assert.equal(typeof platform.login.script, "string");
      assert.equal(typeof platform.login.command, "string");
      assert.equal(typeof platform.credentials.kind, "string");
      assert.equal(platform.stats.supported, true);
    }
    assert.equal(accountPlatformOf("douyin").label, "抖音");
    assert.equal(accountPlatformOf("不存在"), undefined);
  });

  it("三态、登录状态机与账号取数平台取值固定", () => {
    assert.deepEqual(ACCOUNT_STATES, ["authorized", "unauthorized", "unknown"]);
    assert.deepEqual(LOGIN_STATES, [
      "starting",
      "qr_ready",
      "scanned",
      "sms_required",
      "verifying",
      "success",
      "expired",
      "error",
    ]);
    assert.deepEqual(ACCOUNT_STATS_PLATFORMS, [
      "xiaohongshu",
      "douyin",
      "kuaishou",
      "zhihu",
      "weixin-channels",
    ]);
  });

  it("stateToAccountState 把登录状态机映射成三态", () => {
    assert.equal(stateToAccountState("success"), "authorized");
    assert.equal(stateToAccountState("expired"), "unauthorized");
    assert.equal(stateToAccountState("error"), "unauthorized");
    for (const state of ["starting", "qr_ready", "scanned", "sms_required", "verifying"]) {
      assert.equal(stateToAccountState(state), "unknown", `${state} 应视为进行中`);
    }
    assert.equal(stateToAccountState("完全未知"), undefined);
    assert.equal(stateToAccountState(undefined), undefined);
  });

  it("extractJson 从夹带日志的输出里抠出第一个 JSON，坏输入返回 undefined", () => {
    assert.deepEqual(extractJson('日志行\n{"fans":123}\n尾行'), { fans: 123 });
    assert.deepEqual(extractJson("[1,2,3]"), [1, 2, 3]);
    assert.equal(extractJson("没有任何 JSON"), undefined);
    assert.equal(extractJson("{不是 JSON"), undefined);
    assert.equal(extractJson(undefined), undefined);
  });

  it("hasBiliSession 只认 SESSDATA 痕迹", () => {
    assert.equal(hasBiliSession('{"SESSDATA": "abc"}'), true);
    assert.equal(hasBiliSession("SESSDATA=abc; bili_jct=x"), true);
    assert.equal(hasBiliSession('{"other": 1}'), false);
  });

  it("argv 构造对齐既有脚本的 argparse", () => {
    const input = { python: "python3", repoRoot: "/repo", loginStateDir: "/state" };
    assert.deepEqual(buildLoginArgv("xiaohongshu", input), [
      "python3",
      "/repo/skills/shared/scripts/xhs_publish.py",
      "login",
      "--qr-out",
      "/state/xiaohongshu.png",
      "--status-file",
      "/state/xiaohongshu.json",
      "--timeout",
      "180",
    ]);
    assert.deepEqual(buildLoginArgv("kuaishou", input), [
      "python3",
      "/repo/skills/shared/scripts/web_publisher.py",
      "login-qr",
      "--platform",
      "kuaishou",
      "--qr-out",
      "/state/kuaishou.png",
      "--status-file",
      "/state/kuaishou.json",
      "--timeout",
      "180",
    ]);
    assert.equal(buildLoginArgv("wechat-oa", input).at(-1), "240");
    assert.deepEqual(buildVerifyArgv("bilibili", { python: "python3", repoRoot: "/repo" }), [
      "python3",
      "/repo/skills/shared/scripts/bili_login.py",
      "check",
    ]);
    assert.deepEqual(
      buildAccountStatsArgv("xiaohongshu", { python: "python3", repoRoot: "/repo" }),
      ["python3", "/repo/skills/shared/scripts/account_stats.py", "fetch", "--platform", "xiaohongshu"],
    );
    assert.deepEqual(buildAccountStatsArgv("bilibili", { python: "python3", repoRoot: "/repo" }), [
      "python3",
      "/repo/skills/shared/scripts/bili_login.py",
      "stats",
      "--cookie",
      "/repo/cookies.json",
    ]);
    assert.deepEqual(buildAccountStatsArgv("wechat-oa", { python: "python3", repoRoot: "/repo" }), [
      "python3",
      "/repo/skills/shared/scripts/weixin_mp_stats.py",
      "stats",
    ]);
  });

  it("未知平台一律抛 invalid-input", () => {
    for (const build of [buildLoginArgv, buildVerifyArgv, buildAccountStatsArgv]) {
      assert.throws(
        () => build("不存在的平台", { python: "python3", repoRoot: "/repo", loginStateDir: "/state" }),
        (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
      );
    }
  });
});

describe("statusAll / status —— 列出七平台登录态（6.1）", () => {
  it("statusAll 返回纯数组，条目字段齐全且刻意没有 id", async () => {
    const env = await makeEnv();
    const service = serviceFor(env);
    const all = await service.statusAll();
    assert.equal(Array.isArray(all), true);
    assert.equal(all.length, ACCOUNT_PLATFORMS.length);
    for (const entry of all) {
      assert.equal("id" in entry, false, "条目不能带 id（web 信封包法依赖纯数组）");
      assert.equal(typeof entry.platform, "string");
      assert.equal(typeof entry.label, "string");
      assert.equal(ACCOUNT_STATES.includes(entry.state), true, `未知三态：${entry.state}`);
      assert.equal(entry.verified, false);
      assert.equal("rawState" in entry, true);
      assert.equal(typeof entry.checkedAt, "string");
      assert.equal(Number.isNaN(Date.parse(entry.checkedAt)), false);
      assert.equal(typeof entry.credentials, "object");
    }
  });

  it("有效的登录态文件 → authorized", async () => {
    const env = await makeEnv();
    await writeJson(join(env.loginStateDir, "xiaohongshu.json"), { state: "success", message: "已登录" });
    const status = await serviceFor(env).status("xiaohongshu");
    assert.equal(status.state, "authorized");
    assert.equal(status.rawState, "success");
    assert.equal(status.verified, false);
    assert.equal(status.message, "已登录");
    assert.equal(status.stateFile, statusFileFor("xiaohongshu", env.loginStateDir));
    assert.equal(status.stateSource, "plugin-login-state");
  });

  it("失效的登录态文件 → unauthorized，并保留原始说明", async () => {
    const env = await makeEnv();
    await writeJson(join(env.loginStateDir, "douyin.json"), { state: "expired", message: "登录已过期，请重新扫码" });
    const status = await serviceFor(env).status("douyin");
    assert.equal(status.state, "unauthorized");
    assert.equal(status.rawState, "expired");
    assert.equal(status.message, "登录已过期，请重新扫码");

    await writeJson(join(env.loginStateDir, "kuaishou.json"), { state: "error" });
    const errored = await serviceFor(env).status("kuaishou");
    assert.equal(errored.state, "unauthorized");
    assert.equal(errored.rawState, "error");
  });

  it("不存在登录态文件 → unauthorized（cookie 与凭证文件两种形态）", async () => {
    const env = await makeEnv();
    const service = serviceFor(env);

    const bili = await service.status("bilibili");
    assert.equal(bili.state, "unauthorized");
    assert.equal(bili.stateFile, null);
    assert.equal(bili.stateSource, null);
    assert.match(bili.message, /cookie/i);
    assert.equal(bili.credentials.kind, "cookie-file");
    assert.equal(bili.credentials.present, null);

    const wechat = await service.status("wechat-oa");
    assert.equal(wechat.state, "unauthorized");
    assert.match(wechat.message, /凭证文件/);
    assert.equal(wechat.credentials.kind, "credential-file");
  });

  it("进行中的登录状态 → unknown", async () => {
    const env = await makeEnv();
    await writeJson(join(env.loginStateDir, "zhihu.json"), { state: "qr_ready" });
    const status = await serviceFor(env).status("zhihu");
    assert.equal(status.state, "unknown");
    assert.equal(status.rawState, "qr_ready");
  });

  it("回退到既有仓库内 outputs/_login 时标明来源", async () => {
    const env = await makeEnv();
    const legacy = join(env.repoRoot, "outputs", "_login", "zhihu.json");
    await writeJson(legacy, { state: "success" });
    const status = await serviceFor(env).status("zhihu");
    assert.equal(status.state, "authorized");
    assert.equal(status.stateSource, "repo-login-state");
    assert.equal(status.stateFile, legacy);
  });

  it("插件自己的登录态目录优先于仓库内遗留文件", async () => {
    const env = await makeEnv();
    await writeJson(join(env.loginStateDir, "douyin.json"), { state: "success" });
    await writeJson(join(env.repoRoot, "outputs", "_login", "douyin.json"), { state: "expired" });
    const status = await serviceFor(env).status("douyin");
    assert.equal(status.state, "authorized");
    assert.equal(status.stateSource, "plugin-login-state");
    assert.equal(status.stateFile, statusFileFor("douyin", env.loginStateDir));
  });

  it("单个平台的未知 id 抛 invalid-input", async () => {
    const env = await makeEnv();
    await assert.rejects(
      () => serviceFor(env).status("不存在的平台"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
    );
  });
});

describe("重新授权入口 —— 失效时返回可复制命令（6.1）", () => {
  it("loginPlan 给出命令、二维码路径与状态文件路径，且与 argv 构造一致", async () => {
    const env = await makeEnv();
    const service = serviceFor(env);
    const plan = await service.loginPlan("douyin");
    assert.equal(plan.platform, "douyin");
    assert.equal(plan.label, "抖音");
    assert.deepEqual(
      plan.argv,
      buildLoginArgv("douyin", { python: "python3", repoRoot: env.repoRoot, loginStateDir: env.loginStateDir }),
    );
    assert.match(plan.command, /douyin_publish\.py login/);
    assert.match(plan.command, /--qr-out/);
    assert.match(plan.command, /--status-file/);
    assert.equal(plan.qrPath, qrFileFor("douyin", env.loginStateDir));
    assert.equal(plan.statusFile, statusFileFor("douyin", env.loginStateDir));
    assert.match(plan.note, /必须由你本人/);
  });

  it("需要平台的登录入口带 --platform，公众号入口带 240 秒超时", async () => {
    const env = await makeEnv();
    const service = serviceFor(env);
    const kuaishou = await service.loginPlan("kuaishou");
    assert.deepEqual(kuaishou.argv.slice(3, 5), ["--platform", "kuaishou"]);
    const wechat = await service.loginPlan("wechat-oa");
    assert.equal(wechat.argv.at(-1), "240");
    const xhs = await service.loginPlan("xiaohongshu");
    assert.equal(xhs.argv.includes("--platform"), false);
  });

  it("未知平台抛 invalid-input，缺 python 抛 runtime-missing", async () => {
    const env = await makeEnv();
    await assert.rejects(
      () => serviceFor(env).loginPlan("不存在的平台"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
    );
    await assert.rejects(
      () => serviceFor(env, { python: null }).loginPlan("douyin"),
      (error) =>
        error instanceof EaselError &&
        error.code === ERROR_CODES.RUNTIME_MISSING &&
        /Python/.test(error.message),
    );
  });
});

describe("登录态目录在仓库之外（6.2）", () => {
  it("loginStateDir 不在仓库根之下，loginPlan.outsideRepo 为 true", async () => {
    const env = await makeEnv();
    assert.equal(isInside(env.repoRoot, env.loginStateDir), false);
    assert.equal(resolve(env.loginStateDir).startsWith(resolve(env.repoRoot) + sep), false);

    const plan = await serviceFor(env).loginPlan("xiaohongshu");
    assert.equal(plan.outsideRepo, true);
    assert.equal(isInside(env.repoRoot, plan.statusFile), false);
    assert.equal(isInside(env.repoRoot, plan.qrPath), false);
  });

  it("登录态目录落在仓库内时 outsideRepo 为 false（不谎报合规）", async () => {
    const env = await makeEnv();
    const inside = join(env.repoRoot, "outputs", "_login");
    await mkdir(inside, { recursive: true });
    const service = serviceFor({ ...env, loginStateDir: inside });
    const plan = await service.loginPlan("xiaohongshu");
    assert.equal(plan.outsideRepo, false);
  });

  it("浏览器登录档描述为仓库之外且位于用户 HOME 下", async () => {
    const env = await makeEnv();
    const service = serviceFor(env);
    const creds = service.describeCredentials(accountPlatformOf("xiaohongshu"));
    assert.equal(creds.kind, "browser-profile");
    assert.equal(creds.insideRepo, false);
    assert.equal(creds.location, join(browserProfileRoot(), "XiaohongshuProfile"));
    assert.equal(creds.location.startsWith(homedir()), true);
    assert.equal(creds.present, null);
  });
});

describe("verify —— 真校验并把 unknown 收敛（6.3 记录命令与退出状态）", () => {
  it("loggedIn=true → authorized，命令与退出码被记录", async () => {
    const env = await makeEnv();
    const subprocess = fakeSubprocess(() => ({
      exitCode: 0,
      stdout: '运行日志...\n{"loggedIn": true, "nickname": "创作者"}\n',
    }));
    const result = await serviceFor(env, { subprocess }).verify("bilibili");
    assert.equal(result.state, "authorized");
    assert.equal(result.verified, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.command, /bili_login\.py check/);
    assert.equal(subprocess.calls[0].cwd, env.repoRoot);
    assert.deepEqual(subprocess.calls[0].argv, buildVerifyArgv("bilibili", { python: "python3", repoRoot: env.repoRoot }));
    assert.deepEqual(result.profile, { loggedIn: true, nickname: "创作者" });
  });

  it("loggedIn=false → unauthorized 并提示重新授权；缺 JSON → unknown", async () => {
    const env = await makeEnv();
    const denied = await serviceFor(env, {
      subprocess: fakeSubprocess(() => ({ exitCode: 0, stdout: '{"logged_in": false}' })),
    }).verify("kuaishou");
    assert.equal(denied.state, "unauthorized");
    assert.equal(denied.verified, true);
    assert.match(denied.message, /重新授权/);

    const undecided = await serviceFor(env, {
      subprocess: fakeSubprocess(() => ({ exitCode: 3, stdout: "没有 JSON", stderr: "boom" })),
    }).verify("kuaishou");
    assert.equal(undecided.state, "unknown");
    assert.equal(undecided.verified, false);
    assert.equal(undecided.exitCode, 3);
    assert.match(undecided.message, /退出码 3/);
  });

  it("缺 python 时 verify 抛 runtime-missing", async () => {
    const env = await makeEnv();
    await assert.rejects(
      () => serviceFor(env, { python: null }).verify("bilibili"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.RUNTIME_MISSING,
    );
  });
});

describe("stats 归因 —— 失败报原因、无残留数值（6.8）", () => {
  it("成功时返回解析后的数据与完整命令", async () => {
    const env = await makeEnv();
    const subprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: '{"fans": 123, "works": 4}' }));
    const result = await serviceFor(env, { subprocess }).stats("xiaohongshu");
    assert.equal(result.platform, "xiaohongshu");
    assert.deepEqual(result.data, { fans: 123, works: 4 });
    assert.match(result.command, /account_stats\.py fetch --platform xiaohongshu/);
    assert.equal(Number.isNaN(Date.parse(result.fetchedAt)), false);
  });

  it("失败抛 source-unavailable 且带 stderr/command，绝不返回上次数据", async () => {
    const env = await makeEnv();
    const responses = [
      { exitCode: 0, stdout: '{"fans": 123}' },
      { exitCode: 1, stdout: "", stderr: "Traceback: 平台拒绝访问" },
    ];
    const subprocess = fakeSubprocess((spec, index) => responses[index]);
    const service = serviceFor(env, { subprocess });

    const ok = await service.stats("xiaohongshu");
    assert.deepEqual(ok.data, { fans: 123 });

    await assert.rejects(
      () => service.stats("xiaohongshu"),
      (error) => {
        assert.equal(error.code, ERROR_CODES.SOURCE_UNAVAILABLE);
        assert.equal(error.details.platform, "xiaohongshu");
        assert.match(error.details.stderr, /平台拒绝访问/);
        assert.match(error.details.command, /account_stats\.py/);
        assert.match(error.message, /退出码 1/);
        return true;
      },
    );
  });

  it("退出码为 0 但没有可解析 JSON 也算失败（不编造数值）", async () => {
    const env = await makeEnv();
    const subprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: "无 JSON 输出" }));
    await assert.rejects(
      () => serviceFor(env, { subprocess }).stats("douyin"),
      (error) => error.code === ERROR_CODES.SOURCE_UNAVAILABLE,
    );
  });

  it("未知平台与缺 python 分别抛 invalid-input / runtime-missing", async () => {
    const env = await makeEnv();
    await assert.rejects(
      () => serviceFor(env).stats("不存在的平台"),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    await assert.rejects(
      () => serviceFor(env, { python: null }).stats("douyin"),
      (error) => error.code === ERROR_CODES.RUNTIME_MISSING,
    );
  });
});
