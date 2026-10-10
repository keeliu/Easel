/**
 * 配置与根目录推断的测试。
 *
 * 重点覆盖「工作区形态」与「直接克隆形态」两种部署下的数据根解析，
 * 以及「配置里不存在任何绕过开关」这条安全约束。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  Config,
  DISPATCH_TARGETS,
  PANEL_ID,
  PROFILE_DIMENSIONS,
  REGIONS,
  UPSTREAM_READ_ONLY_PREFIXES,
  detectEaselRoot,
  detectRepoRoot,
  isEaselCheckout,
  isRepoRoot,
  resolveRuntimeConfig,
  venvPython,
} from "../lib/host/config.js";

import { fileURLToPath } from "node:url";
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots = [];

/** 造一个「Easel 检出」目录（`skills/` + `pyproject.toml`）。 */
function makeCheckout(parent, name) {
  const root = join(parent, name);
  mkdirSync(join(root, "skills", "openclaw"), { recursive: true });
  mkdirSync(join(root, "profiles", "_template"), { recursive: true });
  mkdirSync(join(root, "outputs"), { recursive: true });
  writeFileSync(join(root, "pyproject.toml"), "[project]\nname = \"easel\"\n");
  return root;
}

function makeTempDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `easel-${label}-`));
  temporaryRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of temporaryRoots) rmSync(dir, { recursive: true, force: true });
});

describe("isEaselCheckout / isRepoRoot", () => {
  it("把含 skills/ 与 pyproject.toml 的目录认作检出", () => {
    const parent = makeTempDir("checkout");
    const checkout = makeCheckout(parent, "Easel");
    assert.equal(isEaselCheckout(checkout), true);
    // 直接克隆形态：检出目录本身即可作为 bundle 工作区。
    assert.equal(isRepoRoot(checkout), true);
  });

  it("缺少 pyproject.toml 或 skills/ 时不认作检出", () => {
    const parent = makeTempDir("partial");
    const bare = join(parent, "bare");
    mkdirSync(join(bare, "skills"), { recursive: true });
    assert.equal(isEaselCheckout(bare), false);

    const noSkills = join(parent, "no-skills");
    mkdirSync(noSkills, { recursive: true });
    writeFileSync(join(noSkills, "pyproject.toml"), "[project]\n");
    assert.equal(isEaselCheckout(noSkills), false);
  });

  it("工作区形态（_repo/ 与 dsh-plugins/ 并列）被认作工作区根", () => {
    const workspace = makeTempDir("workspace");
    mkdirSync(join(workspace, "dsh-plugins"), { recursive: true });
    makeCheckout(join(workspace, "_repo"), ".");
    assert.equal(isRepoRoot(workspace), true);
  });
});

describe("detectEaselRoot", () => {
  it("工作区形态优先取 <工作区>/_repo 作为数据根", () => {
    const workspace = makeTempDir("workspace-detect");
    mkdirSync(join(workspace, "dsh-plugins"), { recursive: true });
    const checkout = makeCheckout(join(workspace, "_repo"), ".");
    assert.equal(detectEaselRoot({ repoRoot: workspace }), checkout);
  });

  it("直接克隆形态回落到工作区目录自身", () => {
    const parent = makeTempDir("flat-detect");
    const checkout = makeCheckout(parent, "Easel");
    assert.equal(detectEaselRoot({ repoRoot: checkout }), checkout);
  });

  it("显式配置优先，且指向非检出目录时返回 undefined（不猜）", () => {
    const parent = makeTempDir("explicit");
    const checkout = makeCheckout(parent, "Easel");
    assert.equal(detectEaselRoot({ configured: checkout, repoRoot: parent }), checkout);
    assert.equal(detectEaselRoot({ configured: parent, repoRoot: checkout }), undefined);
  });

  it("目录里没有检出时返回 undefined 而不抛错", () => {
    const empty = makeTempDir("empty");
    assert.equal(detectEaselRoot({ repoRoot: empty }), undefined);
    assert.equal(detectEaselRoot({}), undefined);
  });
});

describe("detectRepoRoot", () => {
  it("从深层目录逐级向上找到工作区根", () => {
    const workspace = makeTempDir("ancestor");
    mkdirSync(join(workspace, "dsh-plugins"), { recursive: true });
    makeCheckout(join(workspace, "_repo"), ".");
    const deep = join(workspace, "dsh-plugins", "easel-workbench", "lib");
    mkdirSync(deep, { recursive: true });
    const found = detectRepoRoot({ configured: deep, cwd: deep });
    assert.equal(found, workspace);
  });
});

describe("resolveRuntimeConfig", () => {
  const workspace = makeTempDir("runtime");
  mkdirSync(join(workspace, "dsh-plugins"), { recursive: true });
  const easelRoot = makeCheckout(join(workspace, "_repo"), ".");
  const packageRoot = join(workspace, "dsh-plugins", "easel-workbench");
  mkdirSync(packageRoot, { recursive: true });

  const runtime = resolveRuntimeConfig(Config({ repoRoot: workspace }), {
    moduleUrl: `file://${join(packageRoot, "index.js")}`,
    packageRoot,
    cwd: workspace,
    assetsDir: join(packageRoot, "assets"),
  });

  it("分别解析出工作区根与数据根", () => {
    assert.equal(runtime.repoRoot, workspace);
    assert.equal(runtime.easelRoot, easelRoot);
    assert.equal(runtime.packageRoot, packageRoot);
    assert.equal(runtime.configured, true);
  });

  it("画像、产物、选题与技能根都以数据根为基准", () => {
    assert.equal(runtime.profilesDir, join(easelRoot, "profiles"));
    assert.equal(runtime.outputsDir, join(easelRoot, "outputs"));
    assert.equal(runtime.topicsFile, join(easelRoot, "outputs", "_ideas.json"));
    assert.deepEqual(runtime.skillDirs, [join(easelRoot, "skills", "openclaw")]);
  });

  it("受控运行时目录以插件包根为基准，不落在 Easel 检出里", () => {
    assert.equal(runtime.runtimeDir, join(packageRoot, ".runtime"));
    assert.equal(venvPython(runtime.runtimeDir), join(packageRoot, ".runtime", "venv", "bin", "python"));
  });

  it("登录态目录默认在用户态、位于数据根之外", () => {
    assert.equal(runtime.loginStateDir.startsWith(easelRoot), false);
    assert.equal(runtime.loginStateDir.startsWith(workspace), false);
  });

  it("绝对路径配置按原样生效", () => {
    const custom = resolveRuntimeConfig(
      Config({ repoRoot: workspace, profilesDir: "/srv/easel-profiles", skillDirs: ["/srv/skills"] }),
      { moduleUrl: `file://${join(packageRoot, "index.js")}`, packageRoot, cwd: workspace },
    );
    assert.equal(custom.profilesDir, "/srv/easel-profiles");
    assert.deepEqual(custom.skillDirs, ["/srv/skills"]);
  });

  it("缺少检出时返回 undefined 而不抛错（面板仍须能打开）", () => {
    // 三个推断来源都必须落在检出之外，否则会从插件包路径反过来找到本仓库。
    const empty = makeTempDir("no-checkout");
    const orphanPackage = join(makeTempDir("orphan-plugin"), "easel-workbench");
    mkdirSync(orphanPackage, { recursive: true });
    const orphan = resolveRuntimeConfig(Config({ repoRoot: empty }), {
      moduleUrl: `file://${join(orphanPackage, "index.js")}`,
      packageRoot: orphanPackage,
      cwd: empty,
    });
    assert.equal(orphan.easelRoot, undefined);
    assert.equal(orphan.repoRoot, undefined);
    assert.equal(orphan.configured, false);
  });

  it("只给插件包路径（模块 URL）也能找到工作区与数据根", () => {
    const found = resolveRuntimeConfig(Config({}), {
      moduleUrl: `file://${join(packageRoot, "index.js")}`,
      packageRoot,
      cwd: packageRoot,
    });
    assert.equal(found.repoRoot, workspace);
    assert.equal(found.easelRoot, easelRoot);
  });
});

describe("Config schema 契约", () => {
  const schema = Config({});
  const keys = Object.keys(schema);

  it("默认值符合 spec 要求的可配置项", () => {
    assert.equal(schema.catalogDescriptionMaxLength, 500);
    assert.equal(schema.taskDispatchTarget, "current-session");
    assert.equal(DISPATCH_TARGETS.includes(schema.taskDispatchTarget), true);
  });

  it("不存在任何跳过扫描 / 放行发布的开关", () => {
    const forbidden = /(skip|bypass|force|unsafe|allow|ignore|disable|override)/i;
    for (const key of keys) {
      assert.equal(forbidden.test(key), false, `配置项 ${key} 疑似绕过开关`);
    }
  });

  it("面板 id 与区域清单固定", () => {
    assert.equal(PANEL_ID, "easel-workbench");
    assert.equal(REGIONS.length >= 10, true);
    assert.equal(new Set(REGIONS.map((region) => region.id)).size, REGIONS.length);
    assert.equal(PROFILE_DIMENSIONS.length, 6);
    assert.deepEqual([...UPSTREAM_READ_ONLY_PREFIXES], ["skills"]);
  });
});

describe("人设/规则来源的路径解析", () => {
  it("未传字段（不经 schema）不抛错，未配置即 undefined", () => {
    const runtime = resolveRuntimeConfig({}, { packageRoot: PACKAGE_ROOT, cwd: PACKAGE_ROOT });
    assert.equal(runtime.personaSource, undefined);
    assert.equal(runtime.rulesSource, undefined);
    assert.equal(typeof runtime.loginStateDir, "string");
    assert.match(runtime.loginStateDir, /easel-workbench\/login$/);
  });

  it("相对路径以插件包根为基准，绝对路径原样（不依赖进程工作目录）", () => {
    const runtime = resolveRuntimeConfig(
      { personaSource: "custom/persona.md", rulesSource: "/srv/rules.md" },
      { packageRoot: PACKAGE_ROOT, cwd: "/" },
    );
    assert.equal(runtime.personaSource, join(PACKAGE_ROOT, "custom", "persona.md"));
    assert.equal(runtime.rulesSource, "/srv/rules.md");
  });

  it("空白与非法值视作未配置", () => {
    const runtime = resolveRuntimeConfig(
      { personaSource: "   ", rulesSource: undefined },
      { packageRoot: PACKAGE_ROOT, cwd: PACKAGE_ROOT },
    );
    assert.equal(runtime.personaSource, undefined);
    assert.equal(runtime.rulesSource, undefined);
  });
});
