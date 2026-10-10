/**
 * `lib/host/browser-deps.js` 的单元测试。
 *
 * 这一层的作用是「把缺库这件事变成用户能行动的两条信息」：子进程要拿到
 * `LD_LIBRARY_PATH`，自检要如实说出「内核现在到底能不能启动」。所以测试盯三件事：
 * 路径拼接只认真实存在的目录、环境覆盖不污染无关场景、探测结果靠真实退出码而不是猜。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import {
  BROWSER_DEPS_DIR,
  BROWSER_LIB_ENV,
  browserDepsInstalled,
  browserDepsPrefix,
  browserEnv,
  browserLibraryDirs,
  browserLibraryPath,
  chromiumCandidates,
  probeChromium,
} from "../lib/host/browser-deps.js";

/** 造一个「已经解包过共享库」的前缀。 */
async function makePrefix(root, subdirs = ["root/usr/lib/x86_64-linux-gnu"]) {
  const prefix = join(root, BROWSER_DEPS_DIR);
  for (const sub of subdirs) await mkdir(join(prefix, sub), { recursive: true });
  return prefix;
}

/** 极简假子进程服务：记录 spec，回放固定结果。 */
function fakeSubprocess(response = {}) {
  const calls = [];
  return {
    calls,
    spawn(spec) {
      calls.push(spec);
      const text = String(response.stdout ?? "");
      const reader = (value) => ({
        readFrom: () => ({ text: value, nextOffset: value.length, lossy: false }),
      });
      return {
        collected: { stdout: reader(text), stderr: reader(String(response.stderr ?? "")) },
        done: Promise.resolve({ exitCode: response.exitCode ?? 0, signal: null }),
      };
    },
  };
}

describe("共享库路径拼接", () => {
  it("没有运行目录就没有前缀；有则落在 chromium-deps 下", () => {
    assert.equal(browserDepsPrefix(undefined), undefined);
    assert.equal(browserDepsPrefix(""), undefined);
    assert.equal(browserDepsPrefix("/srv/runtime"), join("/srv/runtime", BROWSER_DEPS_DIR));
  });

  it("只把真实存在的库目录算进去，顺序稳定", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-deps-"));
    const prefix = await makePrefix(root, ["root/usr/lib/x86_64-linux-gnu", "root/lib"]);
    assert.deepEqual(browserLibraryDirs(prefix), [
      join(prefix, "root", "usr", "lib", "x86_64-linux-gnu"),
      join(prefix, "root", "usr", "lib"),
      join(prefix, "root", "lib"),
    ]);
    assert.equal(browserDepsInstalled(prefix), true);
    assert.equal(browserDepsInstalled(join(root, "nothing")), false);
  });

  it("解包目录前置于原有的 LD_LIBRARY_PATH，两者都不丢", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-path-"));
    const prefix = await makePrefix(root, ["root/lib"]);
    const only = browserLibraryPath(prefix);
    assert.equal(only, join(prefix, "root", "lib"));
    assert.equal(browserLibraryPath(prefix, "/opt/cuda/lib"), `${only}:/opt/cuda/lib`);
    assert.equal(browserLibraryPath(join(root, "empty"), "/opt/cuda/lib"), "/opt/cuda/lib");
  });

  it("没有任何解包目录时不改环境（不制造空 LD_LIBRARY_PATH）", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-env-"));
    assert.deepEqual(browserEnv(root, {}), {});
    const prefix = await makePrefix(root, ["root/lib"]);
    const env = browserEnv(dirname(prefix), {});
    assert.equal(typeof env[BROWSER_LIB_ENV], "string");
    assert.match(env[BROWSER_LIB_ENV], /chromium-deps/);
  });
});

describe("内核定位", () => {
  it("按 chrome-headless-shell → chrome-linux64 → chrome-linux 的优先级找", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-cache-"));
    const cache = join(root, "ms-playwright");
    await mkdir(join(cache, "chromium-1223", "chrome-linux64"), { recursive: true });
    await writeFile(join(cache, "chromium-1223", "chrome-linux64", "chrome"), "", "utf8");
    assert.equal(
      chromiumCandidates({ cacheDir: cache }),
      join(cache, "chromium-1223", "chrome-linux64", "chrome"),
    );
    await mkdir(join(cache, "chromium-1224", "chrome-headless-shell-linux64"), { recursive: true });
    await writeFile(join(cache, "chromium-1224", "chrome-headless-shell-linux64", "chrome-headless-shell"), "", "utf8");
    assert.match(chromiumCandidates({ cacheDir: cache }) ?? "", /chrome-headless-shell$/);
  });

  it("缓存不存在或显式路径失效时返回 null，而不是编一个路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-none-"));
    assert.equal(chromiumCandidates({ cacheDir: join(root, "missing") }), null);
    assert.equal(chromiumCandidates({ explicit: join(root, "nope", "chrome") }), null);
  });
});

describe("真的启动一次内核", () => {
  it("把 argv 与注入的 LD_LIBRARY_PATH 一起交给子进程，并用退出码判定", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-probe-"));
    const prefix = await makePrefix(root, ["root/lib"]);
    const binary = join(root, "chromium", "chrome");
    const subprocess = fakeSubprocess({ exitCode: 0, stdout: "Chromium 148.0.7778.96\n" });
    const result = await probeChromium(subprocess, { binary, runtimeDir: dirname(prefix), cwd: root });
    assert.equal(result.launched, true);
    assert.equal(result.version, "148.0.7778.96");
    assert.equal(result.reason, "ok");
    assert.deepEqual(subprocess.calls[0].argv, [binary, "--version"]);
    assert.equal(subprocess.calls[0].cwd, root);
    assert.match(subprocess.calls[0].env[BROWSER_LIB_ENV], /chromium-deps/);
  });

  it("内核秒退（缺库的典型形态：127）时不谎报成功，并带上输出尾巴", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-fail-"));
    const subprocess = fakeSubprocess({ exitCode: 127, stderr: "error while loading shared libraries: libglib-2.0.so.0" });
    const result = await probeChromium(subprocess, { binary: join(root, "chrome"), runtimeDir: root, cwd: root });
    assert.equal(result.launched, false);
    assert.equal(result.exitCode, 127);
    assert.equal(result.reason, "exit-nonzero");
    assert.match(result.output, /libglib-2\.0\.so\.0/);
  });

  it("找不到内核就报 no-binary，不去执行任何命令", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-browser-nobinary-"));
    const subprocess = fakeSubprocess({});
    const result = await probeChromium(subprocess, { cacheDir: join(root, "missing"), runtimeDir: root });
    assert.equal(result.binary, null);
    assert.equal(result.reason, "no-binary");
    assert.equal(subprocess.calls.length, 0);
  });

  it("子进程服务抛错也折叠成结果（自检本身必须不抛）", async () => {
    const subprocess = {
      spawn() {
        throw new Error("子进程服务不可用");
      },
    };
    const result = await probeChromium(subprocess, { binary: "/usr/bin/chrome", runtimeDir: "/srv/runtime" });
    assert.equal(result.launched, false);
    assert.equal(result.reason, "spawn-failed");
    assert.match(result.output, /子进程服务不可用/);
  });
});

describe("接线（防回归）", () => {
  it("登录、Whoami、账号数据与发布四条子进程链路都注入浏览器库环境", async () => {
    const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
    const [accounts, publish, selfcheck] = await Promise.all([
      read("lib/host/accounts.js"),
      read("lib/host/publish.js"),
      read("lib/host/selfcheck.js"),
    ]);
    const hits = accounts.split("env: browserEnv(runtime.runtimeDir)").length - 1;
    assert.equal(hits, 3, `accounts.js 应注入 3 处（verify/stats/login），实际 ${hits}`);
    assert.equal(publish.split("env: browserEnv(runtime.runtimeDir)").length - 1, 1);
    assert.match(selfcheck, /probeBrowser/);
    assert.match(selfcheck, /browser-launch/);
  });
});
