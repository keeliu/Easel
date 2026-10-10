/**
 * 受控运行时探测：Python 解释器与 ffmpeg。
 *
 * 按 design D8，插件**不自动安装**运行时：它只按配置与约定位置探测，并把结果如实
 * 呈现给环境自检区域。任一缺失都不影响工作台其余区域打开（spec
 * `creator-skill-library` 的「运行时可探测性」）。
 *
 * @module easel-workbench/host/runtime
 */

import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { runtimeFfmpeg, venvPython } from "./config.js";
import { runCommand } from "./exec.js";

/** 在 PATH 上查找 Python 时依次尝试的命令名。 */
export const PYTHON_NAMES = Object.freeze(["python3", "python"]);

/**
 * 只有带版本号的解释器时（例如某些发行版与自建运行时只提供 `python3.12`）仍要能探测到。
 *
 * 从新到旧排列：先命中的优先，且都晚于 `python3`/`python` 这类稳定别名。
 */
export const PYTHON_VERSIONED_NAMES = Object.freeze([
  "python3.13",
  "python3.12",
  "python3.11",
  "python3.10",
]);

/** 在 PATH 上查找 ffmpeg 时尝试的命令名。 */
export const FFMPEG_NAMES = Object.freeze(["ffmpeg"]);

/** 探测版本号时的超时（毫秒）；探测失败不影响「可执行」结论。 */
export const VERSION_PROBE_TIMEOUT_MS = 10_000;

/** 探测 Python 包是否可导入时的超时（毫秒）；冷启动的解释器可能较慢。 */
export const PACKAGE_PROBE_TIMEOUT_MS = 20_000;

/** 判断一个绝对路径是否是可执行文件。 */
export async function isExecutable(path) {
  if (typeof path !== "string" || path === "") return false;
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 把 PATH 拆成候选绝对路径。 */
export function pathCandidates(names, pathValue = process.env.PATH ?? "") {
  const dirs = pathValue.split(delimiter).filter((entry) => entry !== "");
  const out = [];
  for (const name of names) for (const dir of dirs) out.push(join(dir, name));
  return out;
}

/**
 * 用户态可执行目录。
 *
 * `pip install --user`、pipx、以及「把自建解释器软链到 ~/.local/bin」这类安装方式
 * 都会把解释器放在这里，而该目录**默认不在 PATH 上**：只扫 PATH 会得出「没有 Python」
 * 的错误结论（实测：本机 `~/.local/bin/python3.12` 可用，但 PATH 里没有它）。
 */
export function userBinDirs(home = homedir()) {
  return [join(home, ".local", "bin")];
}

/** 只在用户态目录里展开候选；`source` 用 `user-bin` 与 PATH 命中区分，便于排查。 */
export function userBinCandidates(names, home = homedir()) {
  const out = [];
  for (const name of names) for (const dir of userBinDirs(home)) out.push(join(dir, name));
  return out;
}

/**
 * 按「显式配置 → 插件约定位置 → PATH」的顺序定位一个可执行文件。
 *
 * @param {{ configured?: string, candidates: Array<{ path: string, source: string }> }} input
 * @returns {Promise<{ path: string | undefined, source: string, searched: string[] }>}
 */
export async function locateExecutable(input) {
  const searched = [];
  const configured = input.configured;
  if (typeof configured === "string" && configured !== "") {
    searched.push(configured);
    if (await isExecutable(configured)) return { path: configured, source: "configured", searched };
    return { path: undefined, source: "configured-missing", searched };
  }
  for (const candidate of input.candidates) {
    searched.push(candidate.path);
    if (await isExecutable(candidate.path)) return { path: candidate.path, source: candidate.source, searched };
  }
  return { path: undefined, source: "not-found", searched };
}

/** 运行 `<executable> --version` 一类的探测；失败返回 `undefined` 而不是抛错。 */
async function probeVersion(subprocess, argv, cwd) {
  if (subprocess === undefined || subprocess === null) return undefined;
  try {
    const result = await runCommand(subprocess, {
      argv,
      cwd,
      timeoutMs: VERSION_PROBE_TIMEOUT_MS,
      maxBytes: 64 * 1024,
    });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    const first = text.split("\n").map((line) => line.trim()).filter(Boolean)[0];
    return first === undefined ? undefined : first;
  } catch {
    return undefined;
  }
}

/** 发布与登录脚本真正用到的 Python 包，即引导脚本的 `--groups publish`。 */
export const PUBLISH_PACKAGE_NAMES = Object.freeze(["playwright", "biliup", "requests", "bs4"]);

/**
 * 探测一组 Python 包是否可导入。
 *
 * 用 `importlib.util.find_spec` 而不是真正 `import`：`biliup` 会拉起一串子模块，
 * 自检只想知道「装没装」，不该付导入开销、也不该承担导入副作用。
 *
 * @param {{
 *   subprocess?: object,
 *   pythonPath?: string,
 *   cwd?: string,
 *   names?: readonly string[],
 * }} deps
 * @returns {Promise<{ ok: boolean, missing: string[], error?: string }>}
 */
export async function probePythonPackages(deps) {
  const { subprocess, pythonPath, cwd, names = PUBLISH_PACKAGE_NAMES } = deps;
  if (subprocess === undefined || subprocess === null || typeof pythonPath !== "string") {
    return { ok: false, missing: [...names], error: "no-subprocess" };
  }
  const source = [
    "import importlib.util as u, json",
    `names = ${JSON.stringify([...names])}`,
    "print(json.dumps({n: u.find_spec(n) is not None for n in names}))",
  ].join("\n");
  try {
    const result = await runCommand(subprocess, {
      argv: [pythonPath, "-c", source],
      cwd,
      timeoutMs: PACKAGE_PROBE_TIMEOUT_MS,
      maxBytes: 64 * 1024,
    });
    const line = String(result.stdout ?? "")
      .split("\n")
      .map((text) => text.trim())
      .filter(Boolean)
      .pop();
    const found = JSON.parse(line);
    const missing = names.filter((name) => found?.[name] !== true);
    return { ok: missing.length === 0, missing };
  } catch (error) {
    return { ok: false, missing: [...names], error: String(error?.message ?? error) };
  }
}

/**
 * 探测运行时。返回结构直接喂给环境自检区域与工具结果，因此全部是纯数据。
 *
 * @param {{ runtime: Record<string, any>, subprocess?: object }} deps
 */
export async function probeRuntime(deps) {
  const { runtime, subprocess, home = homedir() } = deps;
  const cwd = runtime.easelRoot ?? process.cwd();

  const runtimeDir = runtime.runtimeDir;
  const pythonNames = [...PYTHON_NAMES, ...PYTHON_VERSIONED_NAMES];
  const pythonCandidates = [];
  if (typeof runtimeDir === "string") {
    pythonCandidates.push({ path: venvPython(runtimeDir), source: "runtime-venv" });
  }
  for (const path of pathCandidates(pythonNames)) pythonCandidates.push({ path, source: "path" });
  for (const path of userBinCandidates(pythonNames, home)) pythonCandidates.push({ path, source: "user-bin" });

  const ffmpegCandidates = [];
  if (typeof runtimeDir === "string") {
    ffmpegCandidates.push({ path: runtimeFfmpeg(runtimeDir), source: "runtime-dir" });
  }
  for (const path of pathCandidates(FFMPEG_NAMES)) ffmpegCandidates.push({ path, source: "path" });
  for (const path of userBinCandidates(FFMPEG_NAMES, home)) {
    ffmpegCandidates.push({ path, source: "user-bin" });
  }

  const python = await locateExecutable({
    configured: runtime.pythonExecutable,
    candidates: pythonCandidates,
  });
  const ffmpeg = await locateExecutable({
    configured: runtime.ffmpegExecutable,
    candidates: ffmpegCandidates,
  });

  const [pythonVersion, ffmpegVersion] = await Promise.all([
    python.path === undefined ? undefined : probeVersion(subprocess, [python.path, "--version"], cwd),
    ffmpeg.path === undefined ? undefined : probeVersion(subprocess, [ffmpeg.path, "-version"], cwd),
  ]);

  return {
    python: { ...python, version: pythonVersion, ok: python.path !== undefined },
    ffmpeg: { ...ffmpeg, version: ffmpegVersion, ok: ffmpeg.path !== undefined },
    ready: python.path !== undefined && ffmpeg.path !== undefined,
    runtimeDir: runtimeDir ?? null,
  };
}
