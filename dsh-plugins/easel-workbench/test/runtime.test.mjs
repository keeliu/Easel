/**
 * `lib/host/runtime.js` 的单元测试：受控运行时探测。
 *
 * 这里钉住的是 design D8 的契约——插件**只探测、不安装**，缺任一运行时都不得抛错，
 * 只如实降级；以及「显式配置优先且不回退」这一容易写错的分支顺序。
 */

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FFMPEG_NAMES,
  PYTHON_NAMES,
  PYTHON_VERSIONED_NAMES,
  VERSION_PROBE_TIMEOUT_MS,
  isExecutable,
  locateExecutable,
  pathCandidates,
  probeRuntime,
} from "../lib/host/runtime.js";
import { runtimeFfmpeg, venvPython } from "../lib/host/config.js";

const RUNTIME_MODULE = new URL("../lib/host/runtime.js", import.meta.url);

/** 造一个可执行文件（POSIX 权限位）。 */
async function makeExecutable(path) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(path, 0o755);
  return path;
}

/** 造一个存在但不可执行的文件。 */
async function makePlainFile(path) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "not executable\n", "utf8");
  return path;
}

/** `ctx.subprocess` 的测试替身：按 argv[0] 返回预设输出。 */
function fakeSubprocess(handlers = {}) {
  const calls = [];
  return {
    calls,
    spawn(spec) {
      calls.push(spec);
      const responder = handlers[spec.argv[0]] ?? {};
      const stdout = responder.stdout ?? "";
      const stderr = responder.stderr ?? "";
      const reader = (text) => ({
        readFrom: () => ({ text, nextOffset: text.length, lossy: false }),
      });
      return {
        done: Promise.resolve({ exitCode: responder.exitCode ?? 0, signal: null }),
        collected: { stdout: reader(stdout), stderr: reader(stderr) },
      };
    },
  };
}

/**
 * 临时目录池，测试结束后统一清理。
 *
 * 刻意不用 `os.tmpdir()`：本机 `/tmp` 挂载带 `noexec`，`access(X_OK)` 会失败，
 * 于是所有「可执行文件」夹具都会假失败。工作区所在的覆盖层允许执行。
 */
const SCRATCH_ROOT = fileURLToPath(new URL("../../../.tooling/tmp/", import.meta.url));
const scratch = [];
async function makeScratch(prefix = "easel-runtime-") {
  await mkdir(SCRATCH_ROOT, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH_ROOT, prefix));
  scratch.push(dir);
  return dir;
}

/** 在给定 PATH 下跑一段代码，结束后还原（探测只读 process.env.PATH）。 */
async function withPath(pathValue, run) {
  const original = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
}

after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

describe("常量与契约", () => {
  it("解释器与 ffmpeg 的探测名是冻结的有序清单", () => {
    assert.deepEqual(PYTHON_NAMES, ["python3", "python"]);
    assert.deepEqual(FFMPEG_NAMES, ["ffmpeg"]);
    assert.ok(Object.isFrozen(PYTHON_NAMES) && Object.isFrozen(FFMPEG_NAMES));
    assert.ok(Object.isFrozen(PYTHON_VERSIONED_NAMES));
    assert.equal(VERSION_PROBE_TIMEOUT_MS, 10_000);
  });

  it("带版本号的解释器名按从新到旧排列，且都形如 python3.N", () => {
    assert.ok(PYTHON_VERSIONED_NAMES.length >= 2);
    for (const name of PYTHON_VERSIONED_NAMES) assert.match(name, /^python3\.\d+$/);
    const minors = PYTHON_VERSIONED_NAMES.map((name) => Number(name.slice("python3.".length)));
    assert.deepEqual(minors, [...minors].sort((a, b) => b - a), "应从新到旧");
    // 稳定别名必须排在带版本号的名字之前。
    for (const name of PYTHON_NAMES) assert.ok(!PYTHON_VERSIONED_NAMES.includes(name));
  });

  it("探测模块自己不安装任何东西（D8：只探测、不安装）", async () => {
    const source = await readFile(RUNTIME_MODULE, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    assert.doesNotMatch(code, /\b(pip|npm|pnpm|apt-get|brew|curl|wget)\b/);
    assert.doesNotMatch(code, /\b(writeFile|mkdir|unlink|rm|rename|copyFile)\b/);
    assert.doesNotMatch(code, /child_process/);
  });
});

describe("isExecutable", () => {
  it("可执行文件为真，普通文件、缺失路径与非字符串为假", async () => {
    const dir = await makeScratch();
    const exe = await makeExecutable(join(dir, "bin", "python3"));
    const plain = await makePlainFile(join(dir, "bin", "notes.txt"));
    assert.equal(await isExecutable(exe), true);
    assert.equal(await isExecutable(plain), false);
    assert.equal(await isExecutable(join(dir, "bin", "nope")), false);
    assert.equal(await isExecutable(""), false);
    assert.equal(await isExecutable(undefined), false);
    assert.equal(await isExecutable(42), false);
  });
});

describe("pathCandidates", () => {
  it("按「命令名优先、PATH 目录其次」展开，并跳过空段", () => {
    const pathValue = ["/usr/bin", "", "/usr/local/bin"].join(delimiter);
    assert.deepEqual(pathCandidates(["python3", "python"], pathValue), [
      join("/usr/bin", "python3"),
      join("/usr/local/bin", "python3"),
      join("/usr/bin", "python"),
      join("/usr/local/bin", "python"),
    ]);
  });

  it("PATH 为空时不产生候选", () => {
    assert.deepEqual(pathCandidates(FFMPEG_NAMES, ""), []);
  });
});

describe("locateExecutable", () => {
  it("显式配置存在时优先，且只探测这一条", async () => {
    const dir = await makeScratch();
    const configured = await makeExecutable(join(dir, "configured-python"));
    const other = await makeExecutable(join(dir, "bin", "python3"));
    const located = await locateExecutable({
      configured,
      candidates: [{ path: other, source: "path" }],
    });
    assert.equal(located.path, configured);
    assert.equal(located.source, "configured");
    assert.deepEqual(located.searched, [configured]);
  });

  it("显式配置缺失时不回退到 PATH（配置错了必须看得见）", async () => {
    const dir = await makeScratch();
    const missing = join(dir, "typo-python");
    const good = await makeExecutable(join(dir, "bin", "python3"));
    const located = await locateExecutable({
      configured: missing,
      candidates: [{ path: good, source: "path" }],
    });
    assert.equal(located.path, undefined);
    assert.equal(located.source, "configured-missing");
    assert.deepEqual(located.searched, [missing]);
  });

  it("逐个候选探测，命中即停并留下探测痕迹", async () => {
    const dir = await makeScratch();
    const first = join(dir, "venv", "bin", "python");
    const second = await makeExecutable(join(dir, "usr", "bin", "python3"));
    const third = await makeExecutable(join(dir, "usr", "bin", "python"));
    const located = await locateExecutable({
      candidates: [
        { path: first, source: "runtime-venv" },
        { path: second, source: "path" },
        { path: third, source: "path" },
      ],
    });
    assert.equal(located.path, second);
    assert.equal(located.source, "path");
    assert.deepEqual(located.searched, [first, second]);
  });

  it("全部候选都不存在时返回 not-found 而不是抛错", async () => {
    const dir = await makeScratch();
    const located = await locateExecutable({
      candidates: [{ path: join(dir, "nope"), source: "path" }],
    });
    assert.equal(located.path, undefined);
    assert.equal(located.source, "not-found");
    assert.equal(located.searched.length, 1);
  });

  it("空配置串等同于未配置", async () => {
    const dir = await makeScratch();
    const good = await makeExecutable(join(dir, "bin", "python3"));
    const located = await locateExecutable({
      configured: "",
      candidates: [{ path: good, source: "path" }],
    });
    assert.equal(located.path, good);
    assert.equal(located.source, "path");
  });
});

describe("probeRuntime", () => {
  it("优先用 <runtimeDir>/venv 与 <runtimeDir>/ffmpeg，并回报版本", async () => {
    const dir = await makeScratch();
    const runtimeDir = join(dir, ".runtime");
    const pythonPath = await makeExecutable(venvPython(runtimeDir));
    const ffmpegPath = await makeExecutable(runtimeFfmpeg(runtimeDir));
    const subprocess = fakeSubprocess({
      [pythonPath]: { stdout: "Python 3.12.15\n" },
      [ffmpegPath]: { stdout: "ffmpeg version 6.1.1 Copyright (c) 2000-2024\n" },
    });

    const probed = await withPath(join(dir, "empty-path"), () =>
      probeRuntime({ runtime: { runtimeDir, easelRoot: dir }, subprocess }),
    );

    assert.equal(probed.python.path, pythonPath);
    assert.equal(probed.python.source, "runtime-venv");
    assert.equal(probed.python.version, "Python 3.12.15");
    assert.equal(probed.python.ok, true);
    assert.equal(probed.ffmpeg.path, ffmpegPath);
    assert.equal(probed.ffmpeg.source, "runtime-dir");
    assert.match(probed.ffmpeg.version, /^ffmpeg version 6\.1\.1/);
    assert.equal(probed.ready, true);
    assert.equal(probed.runtimeDir, runtimeDir);
    // 版本探测用受限参数：输出上限 64KiB、只读 stdio、宽限期沿用默认值。
    const spawn = subprocess.calls[0];
    assert.deepEqual(spawn.argv, [pythonPath, "--version"]);
    assert.equal(spawn.stdio.stdout.maxBytes, 64 * 1024);
    assert.equal(spawn.stdio.stderr.maxBytes, 64 * 1024);
    assert.equal(spawn.stdio.stdin, "ignore");
    assert.equal(spawn.cwd, dir);
    assert.equal(typeof spawn.graceMs, "number");
    assert.ok(spawn.signal instanceof AbortSignal);
  });

  it("受控目录里没有运行时的时候回退到 PATH", async () => {
    const dir = await makeScratch();
    const bin = join(dir, "bin");
    const pythonPath = await makeExecutable(join(bin, "python3"));
    const ffmpegPath = await makeExecutable(join(bin, "ffmpeg"));
    const subprocess = fakeSubprocess({});

    const probed = await withPath(bin, () =>
      probeRuntime({ runtime: { runtimeDir: join(dir, "empty-runtime"), easelRoot: dir }, subprocess }),
    );

    assert.equal(probed.python.path, pythonPath);
    assert.equal(probed.python.source, "path");
    assert.equal(probed.ffmpeg.path, ffmpegPath);
    assert.equal(probed.ffmpeg.source, "path");
    assert.equal(probed.ready, true);
  });

  it("PATH 上只有带版本号的解释器时仍能探测到", async () => {
    const dir = await makeScratch();
    const bin = join(dir, "bin");
    const pythonPath = await makeExecutable(join(bin, "python3.12"));
    const subprocess = fakeSubprocess({ [pythonPath]: { stdout: "Python 3.12.15\n" } });

    const probed = await withPath(bin, () =>
      probeRuntime({ runtime: { runtimeDir: join(dir, "empty-runtime"), easelRoot: dir }, subprocess }),
    );

    assert.equal(probed.python.path, pythonPath);
    assert.equal(probed.python.source, "path");
    assert.ok(probed.python.searched.includes(pythonPath));
    // 稳定别名先试、带版本号的名字随后：两者都在探测痕迹里，且命中项来自带版本号的清单。
    const stable = pathCandidates(PYTHON_NAMES, bin);
    for (const path of stable) assert.ok(probed.python.searched.includes(path));
    assert.ok(pathCandidates(PYTHON_VERSIONED_NAMES, bin).includes(pythonPath));
  });

  it("缺运行时只降级不抛错（D8），且 ready 如实为假", async () => {
    const dir = await makeScratch();
    const probed = await withPath(join(dir, "empty-path"), () =>
      probeRuntime({ runtime: { runtimeDir: join(dir, "empty-runtime"), easelRoot: dir } }),
    );
    assert.equal(probed.python.ok, false);
    assert.equal(probed.python.path, undefined);
    assert.equal(probed.ffmpeg.ok, false);
    assert.equal(probed.ready, false);
    assert.equal(probed.python.version, undefined);
  });

  it("没有子进程服务时版本为 undefined，但可执行结论不受影响", async () => {
    const dir = await makeScratch();
    const runtimeDir = join(dir, ".runtime");
    const pythonPath = await makeExecutable(venvPython(runtimeDir));
    const probed = await withPath(join(dir, "empty-path"), () =>
      probeRuntime({ runtime: { runtimeDir, easelRoot: dir }, subprocess: undefined }),
    );
    assert.equal(probed.python.ok, true);
    assert.equal(probed.python.version, undefined);
    assert.equal(probed.ready, false);
    assert.ok(probed.python.path === pythonPath);
  });

  it("显式配置压过受控目录与 PATH，且配置缺失时不回退", async () => {
    const dir = await makeScratch();
    const runtimeDir = join(dir, ".runtime");
    await makeExecutable(venvPython(runtimeDir));
    const explicit = await makeExecutable(join(dir, "custom", "python"));
    const subprocess = fakeSubprocess({ [explicit]: { stdout: "Python 3.11.9\n" } });

    const configured = await withPath(join(dir, "empty-path"), () =>
      probeRuntime({
        runtime: { runtimeDir, easelRoot: dir, pythonExecutable: explicit },
        subprocess,
      }),
    );
    assert.equal(configured.python.path, explicit);
    assert.equal(configured.python.source, "configured");
    assert.equal(configured.python.version, "Python 3.11.9");

    const broken = await withPath(join(dir, "empty-path"), () =>
      probeRuntime({
        runtime: { runtimeDir, easelRoot: dir, pythonExecutable: join(dir, "typo") },
        subprocess,
      }),
    );
    assert.equal(broken.python.path, undefined);
    assert.equal(broken.python.source, "configured-missing");
    assert.equal(broken.python.ok, false);
  });

  it("未配置 runtimeDir 时不产生受控目录候选项", async () => {
    const dir = await makeScratch();
    const runtimeDir = join(dir, ".runtime");
    const venvPath = await makeExecutable(venvPython(runtimeDir));
    const probed = await withPath(join(dir, "empty-path"), () =>
      probeRuntime({ runtime: { easelRoot: dir } }),
    );
    assert.equal(probed.runtimeDir, null);
    assert.ok(!probed.python.searched.includes(venvPath));
  });
});
