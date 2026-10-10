/**
 * Chromium 系统共享库：子进程环境注入 + 「浏览器真的能启动」探测。
 *
 * 常见的部署形态是「精简 Debian 容器 + 非 root」：`playwright install chromium`
 * 只装**浏览器内核**，不装内核依赖的系统 `.so`。此时脚本本身跑得动，浏览器却以
 * `exitCode 127` 秒退，登录脚本只能把它简化成「浏览器没能打开」——用户看到的是
 * 一句无法行动的话。这个模块负责把两条事实补齐：
 *
 * 1. **注入**：把免 root 解包出来的库目录接进子进程的 `LD_LIBRARY_PATH`
 *    （`scripts/install-browser-deps.mjs` 负责真正下载与解包）。
 * 2. **探测**：如实回答「这个内核现在能不能启动」，供环境自检显示。
 *
 * 只做这两件事，不做网络下载、不改系统目录、不需要 root。
 *
 * @module easel-workbench/host/browser-deps
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { runCommand } from "./exec.js";

/** 解包目录名，与 `scripts/install-browser-deps.mjs` 的默认 prefix 一致。 */
export const BROWSER_DEPS_DIR = "chromium-deps";
/** 动态链接器认的环境变量（Linux）。 */
export const BROWSER_LIB_ENV = "LD_LIBRARY_PATH";
/** 探测「内核能否启动」的超时（毫秒）。 */
export const BROWSER_PROBE_TIMEOUT_MS = 30_000;
/** 内核候选相对路径，按优先级排列。 */
export const CHROMIUM_RELATIVE_BINARIES = [
  "chrome-headless-shell-linux64/chrome-headless-shell",
  "chrome-linux64/chrome",
  "chrome-linux/chrome",
];
/** 解包目录下的四个库目录（相对 prefix），与安装脚本的 `libDirs` 一致。 */
export const BROWSER_LIB_SUBDIRS = [
  ["root", "usr", "lib", "x86_64-linux-gnu"],
  ["root", "lib", "x86_64-linux-gnu"],
  ["root", "usr", "lib"],
  ["root", "lib"],
];

/**
 * 缺失库的解包前缀。
 *
 * @param {string | undefined} runtimeDir 插件运行目录（`runtime.runtimeDir`）
 * @returns {string | undefined}
 */
export function browserDepsPrefix(runtimeDir) {
  if (typeof runtimeDir !== "string" || runtimeDir === "") return undefined;
  return join(runtimeDir, BROWSER_DEPS_DIR);
}

/**
 * 实际存在的库目录（按优先级）。
 *
 * @param {string | undefined} prefix
 * @returns {string[]}
 */
export function browserLibraryDirs(prefix) {
  if (typeof prefix !== "string" || prefix === "") return [];
  return BROWSER_LIB_SUBDIRS.map((parts) => join(prefix, ...parts)).filter((dir) => existsSync(dir));
}

/**
 * 拼出 `LD_LIBRARY_PATH`：解包目录在前，原有值在后。
 *
 * @param {string | undefined} prefix
 * @param {string} [previous] 父进程原有的 `LD_LIBRARY_PATH`
 * @returns {string}
 */
export function browserLibraryPath(prefix, previous = "") {
  const head = browserLibraryDirs(prefix).join(":");
  if (head === "") return typeof previous === "string" ? previous : "";
  return previous ? `${head}:${previous}` : head;
}

/**
 * 给子进程用的环境覆盖；没有任何解包目录时返回空对象（不污染环境）。
 *
 * `LD_LIBRARY_PATH` 只被 Linux 动态链接器读取，其他平台直接略过。
 *
 * @param {string | undefined} runtimeDir
 * @param {Record<string, string | undefined>} [base] 默认父进程环境
 * @returns {Record<string, string>}
 */
export function browserEnv(runtimeDir, base = process.env) {
  if (process.platform === "win32" || process.platform === "darwin") return {};
  const previous = typeof base?.[BROWSER_LIB_ENV] === "string" ? base[BROWSER_LIB_ENV] : "";
  const prefix = browserDepsPrefix(runtimeDir);
  const value = browserLibraryPath(prefix, previous);
  if (value === "") return {};
  return { [BROWSER_LIB_ENV]: value };
}

/**
 * 解包目录是否已经装过东西（`installed.json` 由安装脚本写入）。
 *
 * @param {string | undefined} prefix
 * @returns {boolean}
 */
export function browserDepsInstalled(prefix) {
  if (typeof prefix !== "string" || prefix === "") return false;
  return browserLibraryDirs(prefix).length > 0;
}

/**
 * 按优先级找出可用的 Chromium 内核。
 *
 * @param {object} [options]
 * @param {string | null} [options.explicit] 显式配置的内核路径
 * @param {string} [options.home]
 * @param {string} [options.cacheDir]
 * @returns {string | null}
 */
export function chromiumCandidates({ explicit, home = homedir(), cacheDir } = {}) {
  if (typeof explicit === "string" && explicit !== "") return existsSync(explicit) ? explicit : null;
  const cache = cacheDir ?? process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  let entries = [];
  try {
    entries = readdirSync(cache);
  } catch {
    return null;
  }
  const roots = entries.filter((name) => name.startsWith("chromium")).sort();
  for (const rel of CHROMIUM_RELATIVE_BINARIES) {
    for (const dir of roots) {
      const candidate = join(cache, dir, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * 真的启动一次内核（`--version`）——这是唯一能证明「共享库齐了」的检查：
 * 缺库时内核会在动态链接阶段就退出（典型 `exitCode 127`），不会走到打印版本。
 *
 * @param {object | (() => object | undefined)} subprocess
 * @param {{ binary?: string | null, runtimeDir?: string, cwd?: string,
 *   home?: string, cacheDir?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   binary: string | null, launched: boolean, exitCode: number | null,
 *   version: string | null, output: string, reason: string, env: Record<string, string>,
 * }>}
 */
export async function probeChromium(subprocess, options = {}) {
  const env = browserEnv(options.runtimeDir);
  const binary =
    options.binary === undefined
      ? chromiumCandidates({ home: options.home, cacheDir: options.cacheDir })
      : options.binary;
  if (binary === null || binary === undefined) {
    return {
      binary: null,
      launched: false,
      exitCode: null,
      version: null,
      output: "",
      reason: "no-binary",
      env,
    };
  }
  let result;
  try {
    result = await runCommand(subprocess, {
      argv: [binary, "--version"],
      cwd: options.cwd ?? homedir(),
      timeoutMs: options.timeoutMs ?? BROWSER_PROBE_TIMEOUT_MS,
      maxBytes: 64 * 1024,
      env,
    });
  } catch (error) {
    return {
      binary,
      launched: false,
      exitCode: null,
      version: null,
      output: error instanceof Error ? error.message : String(error),
      reason: "spawn-failed",
      env,
    };
  }
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const match = /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(output);
  const launched = result.exitCode === 0;
  return {
    binary,
    launched,
    exitCode: result.exitCode,
    version: match?.[1] ?? null,
    output: output.slice(-500),
    reason: launched ? "ok" : "exit-nonzero",
    env,
  };
}
