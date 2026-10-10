// 安装自检脚本的契约（tasks 10.3）。
//
// 这里刻意造出两种真实世界里的「装上了但跑不起来」：源码树 link: 缺依赖、
// 以及宿主半边没挂载（空响应体 404）。自检必须在这些情况下非零退出并给出
// 对应的下一步，而不是只报一句「失败」。

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(PACKAGE_ROOT, "scripts", "check-install.mjs");

function run(args, cwd) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 造一个 profile：`node_modules/dsh-easel` 是指向源码树的软链（link: 安装），
 * 源码树里只有 lib/index.js —— 与没有 node_modules 的真实开发态同形。
 */
function makeProfile({ source, bundles = ["dsh-easel"], declare = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "easel-check-install-"));
  const packageDir = join(root, "src-tree");
  mkdirSync(join(packageDir, "lib"), { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: "dsh-easel",
        version: "0.0.0",
        main: "lib/index.js",
        peerDependencies: { "@deepseek-ai/schemastery": "^3.18.2" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(packageDir, "lib", "index.js"), source);
  writeFileSync(join(packageDir, "lib", "client.js"), "// 客户端产物占位\n");

  const profileDir = join(root, "profile");
  mkdirSync(join(profileDir, "node_modules"), { recursive: true });
  writeFileSync(
    join(profileDir, "package.json"),
    JSON.stringify(
      {
        name: "web",
        private: true,
        ...(declare ? { dependencies: { "dsh-easel": `link:${packageDir}` } } : {}),
        dsh: { profile: { bundles } },
      },
      null,
      2,
    ),
  );
  symlinkSync(packageDir, join(profileDir, "node_modules", "dsh-easel"), "dir");

  return { root, profileDir, packageDir };
}

test("10.3 profile 与包都就位、依赖可落地时通过（不联网）", async (t) => {
  const { root, profileDir } = makeProfile({
    source: 'import { join } from "node:path";\nexport function apply() { return join("a", "b"); }\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = run(["--profile", profileDir, "--no-http"], PACKAGE_ROOT);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /全部可落地/);
  assert.match(result.stdout, /装上了，而且宿主接口可达/);
});

test("10.3 源码树 link: 缺依赖时非零退出，并指向「跑 pnpm install / 改用物化安装」", async (t) => {
  const { root, profileDir, packageDir } = makeProfile({
    source: 'import "jsdom";\nexport function apply() {}\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = run(["--profile", profileDir, "--no-http"], PACKAGE_ROOT);
  assert.equal(result.status, 1, "缺依赖必须非零退出");
  assert.match(result.stdout, /jsdom/, "要点名是哪个包无法落地");
  assert.ok(result.stdout.includes(packageDir), "要指出目标目录（源码树）");
  assert.match(result.stdout, /pnpm install/);
  assert.match(result.stdout, /peerDependencies/);
});

test("10.3 profile 未把插件列进 bundle 层时非零退出", async (t) => {
  const { root, profileDir } = makeProfile({
    source: 'import { join } from "node:path";\nexport function apply() { return join("a", "b"); }\n',
    bundles: [],
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = run(["--profile", profileDir, "--no-http"], PACKAGE_ROOT);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /dsh\.profile\.bundles/);
});

test("10.3 空响应体 404（宿主半边未挂载）被识别为「需要重载 DSH」", async (t) => {
  const { root, profileDir } = makeProfile({
    source: 'import { join } from "node:path";\nexport function apply() { return join("a", "b"); }\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // DSH 自己的 404 没有响应体；插件自己的 404 一定带 {ok:false,code,message}。
  //
  // 这个服务器必须跑在**另一个进程**里：自检脚本用 spawnSync 发请求，若服务器与
  // 测试同进程，父进程的事件循环被 spawnSync 阻塞，双方永远等不到对方。
  const child = spawn(
    process.execPath,
    [
      "-e",
      'const { createServer } = require("node:http");\n' +
        'const server = createServer((req, res) => { res.statusCode = 404; res.end(); });\n' +
        'server.listen(0, "127.0.0.1", () => console.log(String(server.address().port)));\n',
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  t.after(() => child.kill("SIGTERM"));
  const port = await new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /(\d+)/.exec(buffer);
      if (match !== null) resolve(Number(match[1]));
    });
    child.on("error", reject);
  });

  const result = run(["--profile", profileDir, "--url", `http://127.0.0.1:${port}`], PACKAGE_ROOT);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /响应体为空/, "要区分 DSH 默认 404 与插件 JSON 404：" + result.stdout);
  assert.match(result.stdout, /重载或重启 DSH/);
});
