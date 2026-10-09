/**
 * `lib/host/selfcheck.js` 的单元测试：环境自检的**可操作性契约**。
 *
 * 这里钉住三件事：
 * 1. 自检只报告、不抛错（缺运行时也照常返回）；
 * 2. 每一项非 `ok` 的条目都必须带一段可执行的 `hint`（告诉用户下一步做什么），
 *    `ok` 的条目则必须没有 `hint`——避免面板里堆无意义的提示；
 * 3. `hint` 里出现的路径是**真实路径**（引导脚本用 `packageRoot` 展开），不是占位符。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { createSelfcheckService } from "../lib/host/selfcheck.js";

const scratch = [];

async function makeScratch() {
  const dir = await mkdtemp(join(tmpdir(), "easel-selfcheck-"));
  scratch.push(dir);
  return dir;
}

after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/** `paths` 的替身：默认「什么都在仓库之外、没有拦过写入」。 */
function fakePaths(overrides = {}) {
  const blocked = [];
  return {
    blocked,
    isInsideRepo: () => false,
    blockedWrites: () => blocked.slice(),
    ...overrides,
  };
}

function runtimeFor(dir, overrides = {}) {
  return {
    easelRoot: dir,
    repoRoot: dir,
    packageRoot: join(dir, "pkg"),
    runtimeDir: join(dir, ".runtime"),
    loginStateDir: join(dir, "login"),
    skillDirs: ["skills/openclaw"],
    catalogDescriptionMaxLength: 500,
    taskDispatchTarget: "current-session",
    ...overrides,
  };
}

/** 探测结果替身：`python`/`ffmpeg` 各自的可执行性由用例指定。 */
function probeOf({ pythonOk = false, ffmpegOk = false } = {}) {
  const entry = (ok, name) => ({
    ok,
    path: ok ? `/opt/bin/${name}` : undefined,
    source: ok ? "path" : "not-found",
    version: ok ? `${name} 1.2.3` : undefined,
    searched: [`/opt/bin/${name}`],
  });
  return async () => ({
    python: entry(pythonOk, "python3"),
    ffmpeg: entry(ffmpegOk, "ffmpeg"),
    ready: pythonOk && ffmpegOk,
    runtimeDir: null,
  });
}

async function runSelfcheck(dir, { probe, runtime, paths } = {}) {
  const service = createSelfcheckService({
    ctx: { get: () => undefined },
    runtime: runtime ?? runtimeFor(dir),
    paths: paths ?? fakePaths(),
    probe: probe ?? probeOf(),
  });
  return service.run();
}

describe("自检条目的可操作性", () => {
  it("缺 Python 与 ffmpeg 时给出可执行 hint，并如实汇总 missing", async () => {
    const dir = await makeScratch();
    const result = await runSelfcheck(dir);

    assert.equal(result.ready, false);
    // 临时区里没有 skills/openclaw，所以技能根也会报 missing；这里只钉住运行时两项。
    assert.ok(result.missing.includes("python"));
    assert.ok(result.missing.includes("ffmpeg"));

    const byId = new Map(result.entries.map((entry) => [entry.id, entry]));
    const python = byId.get("python");
    assert.equal(python.status, "missing");
    assert.match(python.hint, /pythonExecutable/);
    assert.match(python.hint, /bootstrap-runtime\.sh/);
    assert.match(python.hint, /\.local\/bin/);
    // 引导脚本一律用 packageRoot 展开成绝对路径。
    assert.ok(python.hint.includes(join(dir, "pkg", "scripts", "bootstrap-runtime.sh")));

    const ffmpeg = byId.get("ffmpeg");
    assert.equal(ffmpeg.status, "missing");
    assert.match(ffmpeg.hint, /apt-get install -y ffmpeg/);
    assert.match(ffmpeg.hint, /brew install ffmpeg/);
  });

  it("契约：非 ok 必带非空 hint，ok 必不带 hint", async () => {
    const dir = await makeScratch();
    const result = await runSelfcheck(dir, { probe: probeOf({ pythonOk: true, ffmpegOk: true }) });

    for (const entry of result.entries) {
      if (entry.status === "ok") {
        assert.equal(entry.hint, null, `${entry.id} 是 ok，不应带 hint`);
      } else {
        assert.equal(typeof entry.hint, "string", `${entry.id} 是 ${entry.status}，必须带 hint`);
        assert.ok(entry.hint.length > 0, `${entry.id} 的 hint 不能是空串`);
      }
    }
  });

  it("运行时目录不存在时降级，并把引导脚本的绝对路径写进 hint", async () => {
    const dir = await makeScratch();
    await mkdir(join(dir, "skills", "openclaw"), { recursive: true });
    const result = await runSelfcheck(dir, { probe: probeOf({ pythonOk: true, ffmpegOk: true }) });

    const runtimeEntry = result.entries.find((entry) => entry.id === "runtime-dir");
    assert.equal(runtimeEntry.status, "degraded");
    assert.equal(runtimeEntry.hint.includes(join(dir, "pkg", "scripts", "bootstrap-runtime.sh")), true);
    // 假 ctx 没有任何 DSH 服务，所以能力项也会降级；只钉住运行时目录这一项。
    assert.ok(result.degraded.includes("runtime-dir"));
  });

  it("登录态落在仓库内时报 degraded 并提示移出仓库", async () => {
    const dir = await makeScratch();
    await mkdir(join(dir, ".runtime"), { recursive: true });
    await mkdir(join(dir, "skills", "openclaw"), { recursive: true });
    const paths = fakePaths({ isInsideRepo: (candidate) => String(candidate).startsWith(dir) });
    const result = await runSelfcheck(dir, {
      probe: probeOf({ pythonOk: true, ffmpegOk: true }),
      paths,
    });

    const login = result.entries.find((entry) => entry.id === "login-state");
    assert.equal(login.status, "degraded");
    assert.equal(login.outsideRepo, false);
    assert.match(login.hint, /loginStateDir/);
  });

  it("探针抛错时自检本身不抛错，只把两项都报成 missing", async () => {
    const dir = await makeScratch();
    const result = await runSelfcheck(dir, {
      probe: async () => {
        throw new Error("boom");
      },
    });

    assert.ok(result.missing.includes("python"));
    assert.ok(result.missing.includes("ffmpeg"));
    for (const id of ["python", "ffmpeg"]) {
      const entry = result.entries.find((item) => item.id === id);
      assert.equal(entry.status, "missing");
      assert.equal(typeof entry.hint, "string");
    }
  });
});
