// 引导脚本（随包发布在 scripts/bootstrap-runtime.sh）的契约测试。
//
// 这里**不安装任何依赖**（不联网、不改本机环境）：只跑 --help / --list-groups /
// --dry-run 与错误分支，再加几条源码级守卫。之所以要测它，是因为真实跑过一次
// 才发现分组规格串里残留的 shell 引号会被原样交给 pip（见下面「引号卫生」用例）。

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

// 脚本随包发布（`install_bundle` 之后仍在包内），路径相对本测试文件。
const SCRIPT = fileURLToPath(new URL("../scripts/bootstrap-runtime.sh", import.meta.url));
const EASEL_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * 脚本默认的 `--easel-root`。
 *
 * 与 `scripts/bootstrap-runtime.sh` 的 `default_easel_root` 同源：优先 `<包>/../..` 下的
 * `_repo`（工作区形态），否则 `<包>/../..` 自己就是检出（直接克隆形态）。
 * 本测试文件在两处形态下都会被跑到（开发副本与 `_repo` 内副本），所以不能把
 * `<包>/../..` 直接当成工作区根。
 */
function defaultEaselRoot() {
  const workspace = fileURLToPath(new URL("../../..", import.meta.url));
  if (existsSync(join(workspace, "_repo", "pyproject.toml"))) return join(workspace, "_repo");
  if (existsSync(join(workspace, "pyproject.toml")) && existsSync(join(workspace, "skills", "openclaw"))) {
    return workspace;
  }
  return join(workspace, "_repo");
}

const DEFAULT_EASEL_ROOT = defaultEaselRoot();
const SCRIPT_SOURCE = readFileSync(SCRIPT, "utf8");

// /tmp 是 noexec，任何要执行的夹具都得放在 .tooling/tmp 下（本文件只造空目录，仍沿用同一约定）。
const SCRATCH_ROOT = fileURLToPath(new URL("../../../.tooling/tmp/", import.meta.url));

const GROUP_ORDER = ["core", "image", "audio", "video", "data", "doc", "publish", "easel"];
const DEFAULT_GROUPS = "core,easel,image,data,doc,publish";
const FLAGS = [
  "--groups",
  "--runtime-dir",
  "--easel-root",
  "--python",
  "--index-url",
  "--recreate",
  "--no-easel-package",
  "--no-upgrade-pip",
  "--check",
  "--list-groups",
  "--dry-run",
];

function run(args, options = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    cwd: options.cwd ?? EASEL_ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function findInterpreter() {
  for (const candidate of ["python3", "python", join(process.env.HOME ?? "", ".local/bin/python3.12")]) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ["-c", "import venv"], { encoding: "utf8", timeout: 20_000 });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

/** 取出 --list-groups 输出里每个分组的规格行（形如 `           <specs>`）。 */
function specLines(output) {
  return output
    .split("\n")
    .filter((line) => /^\s{6,}\S/.test(line) && !/^\s*默认分组/.test(line))
    .map((line) => line.trim());
}

test("脚本语法与 --help", async (t) => {
  const syntax = run(["-n"], { cwd: EASEL_ROOT });
  // bash -n 需要传入脚本本身，上面的 run() 已把它放在第一个位置之外，所以单独跑一次。
  const syntaxCheck = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
  assert.equal(syntaxCheck.status, 0, `bash -n 失败：${syntaxCheck.stderr}`);
  assert.equal(syntax.status, 2, "-n 被当作未知参数时应以用法错误退出");

  const help = run(["--help"]);
  assert.equal(help.status, 0);
  const text = `${help.stdout}${help.stderr}`;
  for (const flag of FLAGS) assert.ok(text.includes(flag), `--help 未提到 ${flag}`);
  assert.ok(text.includes("退出码"), "--help 应说明退出码");

  // 脚本随包发布：默认值必须由「脚本自身所在位置」推出，与进程工作目录无关。
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  assert.ok(text.includes(join(packageDir, ".runtime")), `--runtime-dir 默认应为 ${packageDir}/.runtime`);
  assert.ok(text.includes(DEFAULT_EASEL_ROOT), `--easel-root 默认应为 ${DEFAULT_EASEL_ROOT}`);
});

test("脚本从任意工作目录运行都能定位到包与检出（随包形态）", async (t) => {
  const fromRoot = run(["--list-groups"], { cwd: "/" });
  assert.equal(fromRoot.status, 0, fromRoot.stderr);
  assert.ok(fromRoot.stdout.includes(`默认分组：${DEFAULT_GROUPS}`));

  const fromTmp = run(["--help"], { cwd: SCRATCH_ROOT });
  assert.equal(fromTmp.status, 0);
  assert.ok(
    `${fromTmp.stdout}${fromTmp.stderr}`.includes(DEFAULT_EASEL_ROOT),
    `从别的工作目录运行时应仍指向默认检出 ${DEFAULT_EASEL_ROOT}`,
  );
});

test("--list-groups 列出八个分组与默认组合", async (t) => {
  const result = run(["--list-groups"]);
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;

  let cursor = -1;
  for (const name of GROUP_ORDER) {
    const index = output.indexOf(`\n  ${name} `);
    assert.ok(index > cursor, `分组 ${name} 缺失或顺序不对`);
    cursor = index;
  }
  assert.ok(output.includes(`默认分组：${DEFAULT_GROUPS}`));
  assert.ok(output.includes("pip install -e "), "easel 分组应显示可编辑安装命令");
  assert.equal(specLines(output).length, GROUP_ORDER.length, "每个分组应恰好一行规格");
});

test("分组规格串不含引号字符（真实跑出来过的缺陷）", async (t) => {
  // 消费侧是 `pip install "${PIP_ARGS[@]}" $specs`：$specs 未加引号 → 只做空格分词，
  // **不做引号剥离**。曾经 core/image/... 里写成 'cryptography>=42'，pip 收到带引号的
  // 包名并报 `Invalid requirement: "'cryptography>=42'"`。
  const output = run(["--list-groups"]).stdout;
  for (const line of specLines(output)) {
    assert.ok(!line.includes("'"), `规格行含单引号：${line}`);
    assert.ok(!line.includes('"'), `规格行含双引号：${line}`);
  }

  // easel 分组不是 pip 规格，而是「可编辑安装」命令，单独排除在规格校验之外。
  const requirements = specLines(output)
    .filter((line) => !line.includes("pip install"))
    .join(" ")
    .split(/\s+/);
  assert.ok(requirements.includes("python-multipart>=0.0.9,<1"));
  for (const requirement of requirements) {
    // 包名 + 一串版本约束（如 fastapi>=0.115,<1）；不允许 shell 元字符与引号。
    assert.match(
      requirement,
      /^[A-Za-z0-9._-]+(>=|<=|==|~=|!=|>|<)[0-9A-Za-z.*]+(,((>=|<=|==|~=|!=|>|<)?[0-9A-Za-z.*]+))*$/,
      `可疑规格：${requirement}`,
    );
  }
});

test("参数错误以退出码 2 结束", async (t) => {
  const bogusGroup = run(["--groups", "bogus"]);
  assert.equal(bogusGroup.status, 2);
  assert.match(bogusGroup.stderr, /未知分组/);

  const unknownFlag = run(["--definitely-not-a-flag"]);
  assert.equal(unknownFlag.status, 2);

  const emptyGroups = run(["--groups", ""]);
  assert.equal(emptyGroups.status, 2);
});

test("--dry-run 不写任何文件", async (t) => {
  const interpreter = findInterpreter();
  if (!interpreter) {
    t.skip("本机没有可用解释器（python3/python/~/.local/bin/python3.12 均不可用）");
    return;
  }
  const scratch = mkdtempSync(join(SCRATCH_ROOT, "bootstrap-"));
  const runtimeDir = join(scratch, "runtime");
  try {
    const result = run([
      "--python",
      interpreter,
      "--runtime-dir",
      runtimeDir,
      "--easel-root",
      DEFAULT_EASEL_ROOT,
      "--groups",
      "core",
      "--dry-run",
    ]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[dry-run\]/);
    assert.ok(!existsSync(runtimeDir), "--dry-run 不应创建运行时目录");
    // dry-run 会把 pip 命令原样打出来：规格里同样不能出现引号。
    const pipLines = result.stdout.split("\n").filter((line) => line.includes("pip install"));
    assert.ok(pipLines.length > 0, "dry-run 应打印 pip 命令");
    for (const line of pipLines) {
      const specs = line.replace(/.*pip install/, "");
      assert.ok(!specs.includes("'"), `dry-run 的 pip 命令含单引号：${line}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("源码级守卫：只在 --recreate 时删目录，且不引入绕过开关", async (t) => {
  const lines = SCRIPT_SOURCE.split("\n");
  lines.forEach((line, index) => {
    if (!/\brm\s+-rf\b/.test(line)) return;
    const context = lines.slice(Math.max(0, index - 4), index).join("\n");
    assert.match(context, /RECREATE/, `第 ${index + 1} 行删目录未被 --recreate 保护：${line}`);
  });

  assert.ok(SCRIPT_SOURCE.includes("--retries"), "pip 参数应包含重试（索引偶发不可用）");
  assert.ok(!/allow-unsafe/.test(SCRIPT_SOURCE), "引导脚本不得出现 allow-unsafe");
  assert.ok(!/\bcurl\b|\bwget\b/.test(SCRIPT_SOURCE), "引导脚本只该用 pip/venv，不自行下载二进制");
  assert.ok(!/ffmpeg[^\n]*pip install/.test(SCRIPT_SOURCE), "ffmpeg 不由 pip 安装");
});

test("自检分支可重复执行（--check 不安装依赖）", async (t) => {
  const interpreter = findInterpreter();
  if (!interpreter) {
    t.skip("本机没有可用解释器");
    return;
  }
  const scratch = mkdtempSync(join(SCRATCH_ROOT, "bootstrap-check-"));
  try {
    const result = run(["--python", interpreter, "--runtime-dir", join(scratch, "nope"), "--check"]);
    // 没有 venv 时 --check 应当给出可读结论，而不是抛栈；退出码非 0 也算通过，
    // 但必须落在脚本声明的错误码集合里。
    assert.ok([0, 2, 3, 4].includes(result.status), `意外退出码 ${result.status}`);
    const output = `${result.stdout}${result.stderr}`;
    assert.ok(!/Traceback \(most recent call last\)/.test(output), "不应抛 Python 栈");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("临时目录基线存在（.tooling/tmp）", async (t) => {
  // 顺带钉住「夹具不放 /tmp」这条约定：noexec 会让 access(X_OK) 直接失败。
  assert.ok(SCRATCH_ROOT.endsWith(".tooling/tmp/"));
  assert.notEqual(tmpdir(), SCRATCH_ROOT);
  execFileSync("mkdir", ["-p", SCRATCH_ROOT]);
  assert.ok(existsSync(SCRATCH_ROOT));
});
