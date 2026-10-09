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

async function runSelfcheck(dir, { probe, runtime, paths, probePackages } = {}) {
  const service = createSelfcheckService({
    ctx: { get: () => undefined },
    runtime: runtime ?? runtimeFor(dir),
    paths: paths ?? fakePaths(),
    probe: probe ?? probeOf(),
    ...(probePackages === undefined ? {} : { probePackages }),
  });
  return service.run();
}

/** 发布/登录依赖探测替身：默认「全都在」。 */
function packagesOf({ ok = true, missing = [] } = {}) {
  return async () => ({ ok, missing });
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
    assert.match(ffmpeg.hint, /(sudo )?apt-get install -y ffmpeg/);
    assert.match(ffmpeg.hint, /brew install ffmpeg/);
    // 非 root 环境必须同时给一条不需要包管理器权限的出路（实测本机跑在容器里、非 root）。
    assert.match(ffmpeg.hint, /\.local\/bin\/ffmpeg/);
    assert.match(ffmpeg.hint, /ffmpegExecutable/);
    if (typeof process.getuid === "function" && process.getuid() !== 0) {
      assert.match(ffmpeg.hint, /sudo apt-get install -y ffmpeg/);
    }
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

  it("缺 playwright 时报 missing，点名包并给出补装分组与镜像", async () => {
    const dir = await makeScratch();
    const result = await runSelfcheck(dir, {
      probe: probeOf({ pythonOk: true, ffmpegOk: true }),
      probePackages: packagesOf({ ok: false, missing: ["playwright"] }),
    });

    const entry = result.entries.find((item) => item.id === "publish-deps");
    assert.equal(entry.status, "missing");
    assert.deepEqual(entry.missing, ["playwright"]);
    assert.match(entry.detail, /playwright/);
    assert.match(entry.detail, /ModuleNotFoundError/);
    // hint 必须能照着执行：分组名、镜像、以及「浏览器内核可能已存在」这条实测结论。
    assert.match(entry.hint, /--groups core,publish/);
    assert.match(entry.hint, /PIP_INDEX_URL=https:\/\/pypi\.tuna\.tsinghua\.edu\.cn\/simple/);
    assert.match(entry.hint, /ms-playwright/);
    // 缺登录必需依赖时要计入 missing（自检的 ready 语义就是「能不能干活」）。
    assert.ok(result.missing.includes("publish-deps"));
    assert.ok(!result.degraded.includes("publish-deps"));
  });

  it("只缺 publish 组里的附加包时报 degraded，并说明只影响哪部分", async () => {
    const dir = await makeScratch();
    const result = await runSelfcheck(dir, {
      probe: probeOf({ pythonOk: true, ffmpegOk: true }),
      probePackages: packagesOf({ ok: false, missing: ["biliup", "bs4"] }),
    });

    const entry = result.entries.find((item) => item.id === "publish-deps");
    assert.equal(entry.status, "degraded");
    assert.deepEqual(entry.missing, ["biliup", "bs4"]);
    assert.match(entry.detail, /biliup/);
    assert.match(entry.detail, /bs4/);
    assert.match(entry.detail, /B 站上传/);
    assert.ok(result.degraded.includes("publish-deps"));
    // 附加包缺失不该把「工作台可用」判成不可用。
    assert.ok(!result.missing.includes("publish-deps"));
    // B 站上传走的是 biliup 命令行，hint 里要给出「不装 pip 包也能用」的出路
    //（实测本机装 biliup 会在 sdist 元数据阶段挂住）。
    assert.equal(typeof entry.hint, "string");
    assert.match(entry.hint, /biliup 命令行/);
    assert.match(entry.hint, /\.local\/bin/);
  });

  it("发布/登录依赖齐备时报 ok 且不带 hint", async () => {
    const dir = await makeScratch();
    const result = await runSelfcheck(dir, {
      probe: probeOf({ pythonOk: true, ffmpegOk: true }),
      probePackages: packagesOf({ ok: true, missing: [] }),
    });

    const entry = result.entries.find((item) => item.id === "publish-deps");
    assert.equal(entry.status, "ok");
    assert.equal(entry.hint, null);
    assert.match(entry.detail, /playwright/);
    assert.ok(!result.missing.includes("publish-deps"));
  });

  it("没有 Python 时不谎报某个包缺失，而是指向 Python 那一条", async () => {
    const dir = await makeScratch();
    let probedPackages = false;
    const result = await runSelfcheck(dir, {
      probe: probeOf({ pythonOk: false, ffmpegOk: true }),
      probePackages: async () => {
        probedPackages = true;
        return { ok: true, missing: [] };
      },
    });

    // 没有解释器就不该去跑包探测（那次 spawn 注定失败）。
    assert.equal(probedPackages, false);
    const entry = result.entries.find((item) => item.id === "publish-deps");
    assert.equal(entry.status, "missing");
    assert.match(entry.detail, /未解析到 Python 运行时/);
    assert.match(entry.hint, /Python 运行时/);
  });
});
