#!/usr/bin/env node
/**
 * install-browser-deps.mjs — 给 Playwright 的 Chromium 补上系统共享库（不需要 root）。
 *
 * 背景：`playwright install chromium` 只下载浏览器二进制，不装操作系统依赖。精简的
 * 服务器 / 容器镜像里往往连 libglib-2.0.so.0、libnss3.so 都没有，浏览器一启动就
 * `error while loading shared libraries`（退出码 127），登录脚本只会把它记成
 * 「浏览器没能打开」。官方做法 `playwright install-deps` 需要 root，这里改为：
 *   1. 用 ldd 找出当前 Chromium 真正缺的 .so；
 *   2. 把它们映射到 Debian 包名，从镜像的 Packages 索引解析依赖闭包；
 *   3. 只用 curl/自带的 fetch 下载 .deb，用 dpkg-deb -x 解到用户可写目录；
 *   4. 输出 LD_LIBRARY_PATH，宿主子进程带上它，Chromium 即可启动。
 *
 * 用法：
 *   node scripts/install-browser-deps.mjs                # 探测 → 安装到 <插件>/runtime/chromium-deps
 *   node scripts/install-browser-deps.mjs --check        # 只看还缺什么（不下载）
 *   node scripts/install-browser-deps.mjs --json         # 结构化输出
 *   node scripts/install-browser-deps.mjs --prefix DIR   # 指定安装前缀
 *   node scripts/install-browser-deps.mjs --mirror URL   # 换 Debian 镜像
 *   node scripts/install-browser-deps.mjs --browser BIN  # 指定要检查的可执行文件
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, "..");
const DEFAULT_MIRROR = process.env.EASEL_DEBIAN_MIRROR || "https://mirrors.tuna.tsinghua.edu.cn/debian";
const DEFAULT_SUITE = "bookworm";
const COMPONENTS = ["main", "main"];

/** 共享库 soname → Debian 包名。Debian 12 (bookworm) 的 Chromium 运行时依赖。 */
const SONAME_PACKAGES = [
  [["libglib-2.0.so.0", "libgobject-2.0.so.0", "libgio-2.0.so.0"], "libglib2.0-0"],
  [["libnspr4.so"], "libnspr4"],
  [["libnss3.so", "libnssutil3.so", "libsmime3.so", "libssl3.so"], "libnss3"],
  [["libatk-1.0.so.0"], "libatk1.0-0"],
  [["libatk-bridge-2.0.so.0"], "libatk-bridge2.0-0"],
  [["libatspi.so.0"], "libatspi2.0-0"],
  [["libdbus-1.so.3"], "libdbus-1-3"],
  [["libX11.so.6"], "libx11-6"],
  [["libXcomposite.so.1"], "libxcomposite1"],
  [["libXdamage.so.1"], "libxdamage1"],
  [["libXext.so.6"], "libxext6"],
  [["libXfixes.so.3"], "libxfixes3"],
  [["libXrandr.so.2"], "libxrandr2"],
  [["libXcursor.so.1"], "libxcursor1"],
  [["libXi.so.6"], "libxi6"],
  [["libxcb.so.1"], "libxcb1"],
  [["libxkbcommon.so.0"], "libxkbcommon0"],
  [["libgbm.so.1"], "libgbm1"],
  [["libdrm.so.2"], "libdrm2"],
  [["libasound.so.2"], "libasound2"],
  [["libcups.so.2"], "libcups2"],
  [["libcairo.so.2"], "libcairo2"],
  [["libpango-1.0.so.0", "libpangocairo-1.0.so.0"], "libpango-1.0-0"],
  [["libexpat.so.1"], "libexpat1"],
  [["libuuid.so.1"], "libuuid1"],
  [["libfontconfig.so.1"], "libfontconfig1"],
  [["libfreetype.so.6"], "libfreetype6"],
  [["libpng16.so.16"], "libpng16-16"],
  [["libz.so.1"], "zlib1g"],
  [["libudev.so.1"], "libudev1"],
];

function parseArgs(argv) {
  const out = { prefix: null, mirror: DEFAULT_MIRROR, suite: DEFAULT_SUITE, browser: null, check: false, json: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--prefix") out.prefix = argv[++i];
    else if (a === "--mirror") out.mirror = argv[++i];
    else if (a === "--suite") out.suite = argv[++i];
    else if (a === "--browser") out.browser = argv[++i];
    else if (a === "--check") out.check = true;
    else if (a === "--json") out.json = true;
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return out;
}

function usage() {
  return [
    "用法：node scripts/install-browser-deps.mjs [--check] [--prefix DIR] [--mirror URL] [--browser BIN] [--json]",
    "",
    "给 Playwright Chromium 补系统共享库，不需要 root：下载 .deb 并解到 --prefix（默认 <插件>/runtime/chromium-deps）。",
  ].join("\n");
}

function libDirs(prefix) {
  return [
    join(prefix, "root", "usr", "lib", "x86_64-linux-gnu"),
    join(prefix, "root", "lib", "x86_64-linux-gnu"),
    join(prefix, "root", "usr", "lib"),
    join(prefix, "root", "lib"),
  ];
}

export function libraryPathFor(prefix, previous = "") {
  const dirs = libDirs(prefix).filter((d) => existsSync(d));
  const head = dirs.join(":");
  if (head === "") return previous;
  return previous ? `${head}:${previous}` : head;
}

/** 找一个可用的 Chromium 可执行文件：优先问 venv 里的 Playwright，其次扫缓存目录。 */
export function findChromium(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const venvPython = join(PLUGIN_ROOT, ".runtime", "venv", "bin", "python");
  if (existsSync(venvPython)) {
    const probe = spawnSync(
      venvPython,
      ["-c", "from playwright.sync_api import sync_playwright\nwith sync_playwright() as p:\n    print(p.chromium.executable_path)"],
      { encoding: "utf8", timeout: 60000 },
    );
    const line = (probe.stdout || "").trim().split("\n").filter(Boolean).pop();
    if (probe.status === 0 && line && existsSync(line)) return line;
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.HOME || "", ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  const wanted = ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux64/chrome", "chrome-linux/chrome"];
  const roots = spawnSync("ls", ["-1", cache], { encoding: "utf8" }).stdout.split("\n").filter((n) => n.startsWith("chromium"));
  const found = [];
  for (const dir of roots) {
    for (const rel of wanted) {
      const p = join(cache, dir, rel);
      if (existsSync(p)) found.push(p);
    }
  }
  return found[0] || null;
}

/** ldd 里 `=> not found` 的 soname 列表。 */
export function missingLibraries(binary, extraPath = "") {
  const env = { ...process.env };
  if (extraPath) env.LD_LIBRARY_PATH = extraPath ? `${extraPath}:${env.LD_LIBRARY_PATH || ""}` : env.LD_LIBRARY_PATH;
  const r = spawnSync("ldd", [binary], { encoding: "utf8", env, maxBuffer: 8 * 1024 * 1024 });
  if (r.error) throw new Error(`无法运行 ldd：${r.error.message}`);
  const names = [];
  for (const line of `${r.stdout || ""}\n${r.stderr || ""}`.split("\n")) {
    const m = /^\s*(\S+)\s+=>\s+not found\s*$/.exec(line);
    if (m) names.push(m[1]);
    else if (/^\s*(\S+):\s+cannot open shared object file/.test(line)) {
      const n = /^\s*(\S+):/.exec(line)[1];
      if (!names.includes(n)) names.push(n);
    }
  }
  return names;
}

function parsePackages(text) {
  const index = new Map();
  for (const stanza of text.split(/\n\n+/)) {
    const fields = {};
    for (const line of stanza.split("\n")) {
      const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (m) fields[m[1]] = m[2];
    }
    if (!fields.Package || !fields.Filename) continue;
    if (!index.has(fields.Package)) index.set(fields.Package, fields);
  }
  return index;
}

async function fetchPackagesIndex(mirror, suite, component) {
  const url = `${mirror.replace(/\/$/, "")}/dists/${suite}/${component}/binary-amd64/Packages.gz`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`下载索引失败 ${res.status}：${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return parsePackages(gunzipSync(buf).toString("utf8"));
}

function depNames(field) {
  if (!field) return [];
  const names = [];
  for (const part of field.split(",")) {
    const first = part.split("|")[0].trim();
    const m = /^([a-z0-9][a-z0-9+.-]*)/.exec(first);
    if (m) names.push(m[1]);
  }
  return names;
}

/** 只解析 Depends（不跟 Recommends/Pre-Depends），遇到虚拟包就跳过。 */
export function resolveClosure(index, roots) {
  const need = new Map();
  const queue = [...roots];
  const skip = new Set(["libc6", "libc-bin", "libgcc-s1", "libstdc++6", "base-files", "debconf", "dpkg", "perl", "init-system-helpers", "libcrypt1"]);
  while (queue.length) {
    const name = queue.shift();
    if (!name || need.has(name) || skip.has(name)) continue;
    const pkg = index.get(name);
    if (!pkg) continue;
    need.set(name, pkg);
    for (const dep of depNames(pkg.Depends)) queue.push(dep);
  }
  return need;
}

function debCachePath(prefix, pkg) {
  return join(prefix, "debs", pkg.Filename.split("/").pop());
}

async function downloadDeb(mirror, pkg, dest) {
  if (existsSync(dest)) return "cached";
  const url = `${mirror.replace(/\/$/, "")}/${pkg.Filename}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 ${res.status}：${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = join(tmpdir(), `easel-deb-${process.pid}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmp, buf);
  mkdirSync(dirname(dest), { recursive: true });
  const r = spawnSync("mv", [tmp, dest], { encoding: "utf8" });
  if (r.status !== 0) {
    rmSync(tmp, { force: true });
    throw new Error(`写入 ${dest} 失败：${r.stderr}`);
  }
  return "downloaded";
}

function extractDeb(deb, root) {
  mkdirSync(root, { recursive: true });
  const r = spawnSync("dpkg-deb", ["-x", deb, root], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`dpkg-deb -x ${deb} 失败：${r.stderr || r.stdout}`);
}

function packagesForSonames(sonames) {
  const packages = new Set();
  const unmapped = [];
  for (const soname of sonames) {
    const hit = SONAME_PACKAGES.find(([names]) => names.includes(soname));
    if (hit) packages.add(hit[1]);
    else unmapped.push(soname);
  }
  return { packages: [...packages], unmapped };
}

function defaultPrefix() {
  const override = (process.env.EASEL_RUNTIME_DIR || "").trim();
  return join(override ? resolve(override) : join(PLUGIN_ROOT, ".runtime"), "chromium-deps");
}

function platformGuard() {
  if (process.platform !== "linux") return `当前系统是 ${process.platform}，本脚本只处理 Linux 上的 Chromium 依赖。`;
  if (process.arch !== "x64") return `当前架构是 ${process.arch}，本脚本按 amd64 解析 Debian 包。`;
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const report = { ok: false, prefix: null, browser: null, missingBefore: [], installed: [], missingAfter: [], unmapped: [], libraryPath: "", notes: [] };
  const guard = platformGuard();
  if (guard) {
    report.notes.push(guard);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(`跳过：${guard}`);
    return 0;
  }
  if (spawnSync("dpkg-deb", ["--version"], { encoding: "utf8" }).status !== 0) {
    report.notes.push("缺少 dpkg-deb：请安装 dpkg（或改用 root 跑 playwright install-deps）。");
  }
  const prefix = resolve(args.prefix || defaultPrefix());
  report.prefix = prefix;
  const browser = findChromium(args.browser);
  report.browser = browser;
  if (!browser) {
    report.notes.push("找不到 Chromium 可执行文件：先跑 `node scripts/bootstrap-runtime.sh`（或 playwright install chromium），或用 --browser 指定。");
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(`找不到 Chromium：${report.notes[report.notes.length - 1]}`);
    return args.check ? 0 : 2;
  }

  const existingPath = libraryPathFor(prefix);
  report.missingBefore = missingLibraries(browser, existingPath);
  report.libraryPath = existingPath;
  if (report.missingBefore.length === 0) {
    report.ok = true;
    report.notes.push("Chromium 依赖已经齐全，不需要安装。");
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log("✅ Chromium 共享库齐全，无需安装。");
    return 0;
  }
  const { packages, unmapped } = packagesForSonames(report.missingBefore);
  report.unmapped = unmapped;
  if (unmapped.length) report.notes.push(`这些库没有内置映射，可能需要手工处理：${unmapped.join(", ")}`);

  if (args.check) {
    report.notes.push(`待安装包：${packages.join(" ")}`);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`缺 ${report.missingBefore.length} 个共享库：${report.missingBefore.join(", ")}`);
      console.log(`对应 Debian 包：${packages.join(" ")}`);
      console.log("加 --check 之外的参数即会下载并解压它们（无需 root）。");
    }
    return 1;
  }

  const indexes = [];
  for (const component of COMPONENTS) {
    indexes.push(await fetchPackagesIndex(args.mirror, args.suite, component));
  }
  const index = indexes[0];
  const closure = resolveClosure(index, packages);
  for (const name of packages) if (!closure.has(name)) report.notes.push(`镜像索引里没有 ${name}，已跳过。`);

  mkdirSync(join(prefix, "debs"), { recursive: true });
  const root = join(prefix, "root");
  const installed = [];
  for (const [name, pkg] of closure) {
    const dest = debCachePath(prefix, pkg);
    await downloadDeb(args.mirror, pkg, dest);
    extractDeb(dest, root);
    installed.push(`${name}=${pkg.Version}`);
  }
  report.installed = installed;
  const afterPath = libraryPathFor(prefix);
  report.libraryPath = afterPath;
  report.missingAfter = missingLibraries(browser, afterPath);
  report.ok = report.missingAfter.length === 0;
  writeFileSync(join(prefix, "installed.json"), `${JSON.stringify({ mirror: args.mirror, suite: args.suite, browser, installed, libraryPath: afterPath }, null, 2)}\n`);
  writeFileSync(
    join(prefix, "env.sh"),
    `# source 这个文件即可让 Chromium 找到随包解出来的共享库\nexport LD_LIBRARY_PATH="${afterPath}${afterPath ? ":" : ""}$LD_LIBRARY_PATH"\n`,
  );

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`解出 ${installed.length} 个包到 ${root}`);
    if (report.ok) {
      console.log("✅ Chromium 共享库已齐全。");
      console.log("宿主子进程需要带上：");
      console.log(`LD_LIBRARY_PATH=${afterPath}`);
    } else {
      console.error(`❌ 仍然缺少 ${report.missingAfter.length} 个：${report.missingAfter.join(", ")}`);
    }
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`install-browser-deps 失败：${err && err.message ? err.message : err}`);
      process.exit(1);
    },
  );
}
