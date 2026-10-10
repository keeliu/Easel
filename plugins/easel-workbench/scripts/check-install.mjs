#!/usr/bin/env node
// 安装自检（tasks 10.3）：确认「装上了」与「真的在跑」是两件事，并分别给出指引。
//
// 用法：
//   node scripts/check-install.mjs [--profile <profile 目录>] [--url <http://127.0.0.1:3080>]
//                                  [--import] [--no-http] [--json]
//
// 检查项（任一失败即 exit 1）：
//   1. profile   —— profile 目录存在，`package.json` 里声明了本插件，且列进 `dsh.profile.bundles`。
//   2. 包落地     —— 从 profile 能解析到插件目录，`lib/index.js`/`lib/client.js` 是真实文件；
//                    若解析结果是 profile 之外的**源码树**（`link:` 开发态），额外提示该目录
//                    需要自带依赖或走宿主解析（design D11/D12）。
//   3. 裸导入     —— `lib/**` 里的裸模块说明符必须能落地：`node:` 内置、`peerDependencies`
//                    （由 DSH 的 profile 解析拦截提供）、或目标目录/profile 里真实可解析。
//                    **这一项就是「源码树缺 node_modules」的判据。**
//   4. import    —— 可选（`--import`）：在 profile 目录里真的 `import("easel-workbench")`；
//                    仅由宿主提供的 peer 包导致失败时只记提示（普通 Node 进程看不到 DSH 的拦截层）。
//   5. HTTP      —— `GET <url>/easel-workbench/api/config` 必须 200 + JSON。这是「宿主半边
//                    是否真的挂载」的验收判据（design D13）；空响应体 404 = 未挂载，需重载进程。

import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_NAME = "easel-workbench";
const API_PREFIX = "/easel-workbench/api";
const DEFAULT_URL = "http://127.0.0.1:3080";

function parseArgs(argv) {
  const options = { profile: undefined, url: DEFAULT_URL, http: true, importProbe: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") options.profile = argv[++index];
    else if (arg === "--url") options.url = argv[++index];
    else if (arg === "--import") options.importProbe = true;
    else if (arg === "--no-http") options.http = false;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else return { error: `未知参数：${arg}` };
  }
  return options;
}

/** profile 目录：显式参数 → DSH_PROFILE_DIR → <DSH_HOME>/profiles/web → ~/.dsh/profiles/web。 */
function resolveProfileDir(explicit) {
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  if (process.env.DSH_PROFILE_DIR) return resolve(process.env.DSH_PROFILE_DIR);
  const home = process.env.DSH_HOME || join(process.env.HOME ?? "", ".dsh");
  return resolve(home, "profiles", "web");
}

/** 找到本机 DSH 安装目录（宿主包的真实来源）。 */
function findDshInstall() {
  const candidates = [
    join(dirname(process.execPath), "..", "lib", "node_modules", "@deepseek-ai", "dsh"),
    "/usr/local/lib/node_modules/@deepseek-ai/dsh",
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "node_modules", "@deepseek-ai"))) return resolve(candidate);
  }
  return undefined;
}

function nodeModulesDirsNear(directory) {
  const dirs = [];
  let current = resolve(directory);
  for (;;) {
    dirs.push(join(current, "node_modules"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function resolvableFrom(directory, specifier) {
  for (const nodeModules of nodeModulesDirsNear(directory)) {
    if (existsSync(join(nodeModules, ...specifier.split("/")))) return join(nodeModules, ...specifier.split("/"));
  }
  return undefined;
}

/** 收集 lib/**（含 lib/host）里所有裸模块说明符。 */
function bareImports(dir, out = new Set()) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) bareImports(path, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      // 必须先剥注释：JSDoc 里的 `import('@deepseek-ai/cordis').Context` 是**类型引用**，
      // 不是运行时依赖，直接扫文本会把它误报成缺包。
      const text = stripComments(readFileSync(path, "utf8"));
      // 三种写法都要覆盖：`import "x"`（副作用导入）、`import … from "x"` / `export … from "x"`、`import("x")`。
      for (const pattern of [
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /\bimport\s*["']([^"']+)["']/g,
        /\bfrom\s*["']([^"']+)["']/g,
      ]) {
        for (const match of text.matchAll(pattern)) {
          const specifier = match[1];
          if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) continue;
          out.add(specifier);
        }
      }
    }
  }
  return out;
}

/** 去掉 `//` 与 `/* *\/` 注释，保留字符串字面量（字符串里的 `//` 不能被当成注释）。 */
function stripComments(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          out += text[index] + (text[index + 1] ?? "");
          index += 2;
          continue;
        }
        out += text[index];
        if (text[index] === char) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(options.error);
    console.error("用法：node scripts/check-install.mjs [--profile <目录>] [--url <地址>] [--import] [--no-http] [--json]");
    return 2;
  }
  if (options.help) {
    console.log("用法：node scripts/check-install.mjs [--profile <目录>] [--url <地址>] [--import] [--no-http] [--json]");
    return 0;
  }

  const results = [];
  const record = (step, ok, detail) => results.push({ step, ok, detail });

  // 1. profile 与清单
  const profileDir = resolveProfileDir(options.profile);
  const manifestPath = join(profileDir, "package.json");
  if (!existsSync(manifestPath)) {
    record("profile", false, `找不到 profile 清单：${manifestPath}（用 --profile 指定 profile 目录）`);
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const declared = manifest.dependencies?.[PACKAGE_NAME] ?? manifest.devDependencies?.[PACKAGE_NAME];
    const bundles = manifest.dsh?.profile?.bundles ?? [];
    if (!declared) {
      record("profile", false, `profile 未声明依赖 ${PACKAGE_NAME}；请用 plugin_manager action=install_bundle 或 dsh plugin --profile … add <绝对路径> 安装`);
    } else if (!bundles.includes(PACKAGE_NAME)) {
      record("profile", false, `profile 的 dsh.profile.bundles 未包含 ${PACKAGE_NAME}（已装但未激活为 bundle 层）`);
    } else {
      record("profile", true, `${relative(process.cwd(), manifestPath) || manifestPath}：dependencies=${declared}，bundles 含 ${PACKAGE_NAME}`);
    }
  }

  // 2. 包落地
  let targetDir;
  const linked = join(profileDir, "node_modules", PACKAGE_NAME);
  if (!existsSync(linked)) {
    record("包落地", false, `profile 里找不到 node_modules/${PACKAGE_NAME}（安装未落地，或 profile 目录不对）`);
  } else {
    targetDir = realpathSync(linked);
    const entry = join(targetDir, "lib", "index.js");
    const client = join(targetDir, "lib", "client.js");
    const missing = [entry, client].filter((path) => !existsSync(path) || statSync(path).size === 0);
    const outsideProfile = !resolve(targetDir).startsWith(resolve(profileDir) + sep);
    if (missing.length > 0) {
      record("包落地", false, `解析到 ${targetDir}，但缺少 ${missing.map((path) => relative(targetDir, path)).join("、")}（客户端产物需先跑 node scripts/build-client.mjs）`);
    } else if (outsideProfile) {
      const own = existsSync(join(targetDir, "node_modules"));
      record("包落地", true, `开发态 link: → ${targetDir}${own ? "（自带 node_modules）" : "（**没有** node_modules，依赖必须由宿主解析）"}`);
    } else {
      record("包落地", true, `${targetDir}（物化安装）`);
    }
  }

  // 3. 裸导入：peer 交给宿主，其余必须真实可解析
  if (targetDir !== undefined) {
    const manifest = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8"));
    const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));
    const dshInstall = findDshInstall();
    const problems = [];
    const hostResolved = [];
    for (const specifier of bareImports(join(targetDir, "lib"))) {
      const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      if (peers.has(packageName)) {
        const fromHost = resolvableFrom(profileDir, packageName);
        const inDsh = dshInstall !== undefined && existsSync(join(dshInstall, "node_modules", ...packageName.split("/")));
        if (fromHost !== undefined || inDsh) hostResolved.push(packageName);
        else problems.push(`${packageName}（声明为 peer，但 profile 与本机 DSH 安装里都没有）`);
        continue;
      }
      if (resolvableFrom(targetDir, packageName) === undefined && resolvableFrom(profileDir, packageName) === undefined) {
        problems.push(`${packageName}（既不是 peerDependency，也不在目标目录/profile 的 node_modules 里）`);
      }
    }
    if (problems.length > 0) {
      record(
        "裸导入",
        false,
        `无法落地：${problems.join("；")}。若这是源码树 link: 安装，请在 ${targetDir} 跑 pnpm install（或改用物化安装）；宿主运行时包应写进 peerDependencies（design D11/D12）`,
      );
    } else {
      record("裸导入", true, `全部可落地（由宿主解析：${[...new Set(hostResolved)].join("、") || "无"}）`);
    }
  }

  // 4. 可选的真实 import（普通 Node 进程看不到 DSH 的 profile 解析拦截层）
  if (options.importProbe && targetDir !== undefined) {
    const code = `const mod = await import(${JSON.stringify(PACKAGE_NAME)}); if (typeof mod.apply !== "function") throw new Error("导出里没有 apply");`;
    try {
      execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: profileDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      record("import", true, `在 ${profileDir} 里 import("${PACKAGE_NAME}") 成功`);
    } catch (error) {
      const text = String(error.stderr ?? error.message ?? "");
      const peerMiss = /Cannot find package '(@deepseek-ai\/[^']+)'/.exec(text);
      if (peerMiss !== null) {
        record("import", true, `普通 Node 进程缺 ${peerMiss[1]}，但它由 DSH 的 profile 解析拦截提供（信息性）；真实判据是第 5 项 HTTP`);
      } else if (text.includes("without inject")) {
        record("import", false, `插件代码里直取了未注入的服务：${text.split("\n").find((line) => line.includes("without inject")) ?? text}`);
      } else {
        record("import", false, `import 失败：${text.split("\n").slice(0, 3).join(" / ")}`);
      }
    }
  }

  // 5. HTTP：宿主半边是否真的挂载（D13 的验收判据）
  const configUrl = `${options.url.replace(/\/$/, "")}${API_PREFIX}/config`;
  if (options.http) {
    // fetch 是异步的：HTTP 探测放进子进程，好在同步流程里拿结果。
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", HTTP_PROBE_SOURCE, configUrl], { encoding: "utf8" });
    const output = String(probe.stdout ?? "").trim();
    if (probe.status !== 0 || output === "") {
      record("HTTP", false, `GET ${configUrl} 失败：${String(probe.stderr ?? "").trim() || "无响应"}；宿主半边未挂载时请重载/重启 DSH（design D13）`);
    } else {
      const payload = JSON.parse(output);
      if (payload.status === 200 && payload.ok === true) {
        record("HTTP", true, `GET ${configUrl} → 200，easelRoot=${payload.easelRoot ?? "(未给)"}`);
      } else if (payload.status === 404 && payload.body === "") {
        record("HTTP", false, `GET ${configUrl} → 404 且响应体为空 = DSH 默认 404，宿主半边未挂载；请重载或重启 DSH（design D13）`);
      } else {
        record("HTTP", false, `GET ${configUrl} → ${payload.status}：${String(payload.body ?? "").slice(0, 160)}`);
      }
    }
  }

  const failed = results.filter((item) => !item.ok);
  if (options.json) {
    console.log(JSON.stringify({ profile: profileDir, results, ok: failed.length === 0 }, null, 2));
  } else {
    console.log(`安装自检：${PACKAGE_ROOT}`);
    console.log(`profile：${profileDir}`);
    for (const item of results) console.log(`  ${item.ok ? "[ok]  " : "[fail]"} ${item.step}：${item.detail}`);
    console.log(failed.length === 0 ? "结论：装上了，而且宿主接口可达。" : `结论：${failed.length} 项失败，按上面的指引处理。`);
  }
  return failed.length === 0 ? 0 : 1;
}

// 用子进程做 HTTP 探测，好在同步流程里拿到结果。
const HTTP_PROBE_SOURCE = `
const url = process.argv[1];
try {
  const response = await fetch(url);
  const body = await response.text();
  let ok = false;
  let easelRoot;
  try { const parsed = JSON.parse(body); ok = parsed.ok === true; easelRoot = parsed.easelRoot; } catch {}
  console.log(JSON.stringify({ status: response.status, ok, easelRoot, body: ok ? "" : body }));
} catch (error) {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
}
`;

process.exitCode = main();
