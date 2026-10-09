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

/**
 * 探测运行时。返回结构直接喂给环境自检区域与工具结果，因此全部是纯数据。
 *
 * @param {{ runtime: Record<string, any>, subprocess?: object }} deps
 */
export async function probeRuntime(deps) {
  const { runtime, subprocess } = deps;
  const cwd = runtime.easelRoot ?? process.cwd();

  const runtimeDir = runtime.runtimeDir;
  const pythonCandidates = [];
  if (typeof runtimeDir === "string") {
    pythonCandidates.push({ path: venvPython(runtimeDir), source: "runtime-venv" });
  }
  for (const path of pathCandidates([...PYTHON_NAMES, ...PYTHON_VERSIONED_NAMES])) {
    pythonCandidates.push({ path, source: "path" });
  }

  const ffmpegCandidates = [];
  if (typeof runtimeDir === "string") {
    ffmpegCandidates.push({ path: runtimeFfmpeg(runtimeDir), source: "runtime-dir" });
  }
  for (const path of pathCandidates(FFMPEG_NAMES)) ffmpegCandidates.push({ path, source: "path" });

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
