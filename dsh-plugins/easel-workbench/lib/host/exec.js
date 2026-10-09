/**
 * 通过 DSH 子进程服务（`ctx.subprocess`）执行外部命令的薄封装。
 *
 * 按 spec `platform-publishing` 的要求，所有对外发布都必须「以 DSH 的命令执行能力
 * 执行」，因此本模块是插件里唯一执行外部进程的地方。它只做三件事：把
 * `SubprocessSpawnSpec` 填完整、把非消费式的 collect 读取器读成字符串、
 * 把失败翻译成带稳定 `code` 的 `EaselError`。
 *
 * @module easel-workbench/host/exec
 */

import { ERROR_CODES, EaselError } from "./errors.js";

/** 单次命令的默认 stdout/stderr 读取上限（字节）。 */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/** 命令结束到强制终止之间的宽限期（毫秒）。 */
export const DEFAULT_GRACE_MS = 5_000;

/** 读取一个 collect 读取器的全部已落盘字节；读取器基于 offset 且非消费式。 */
export function readCollected(reader) {
  if (reader === undefined || reader === null) return { text: "", nextOffset: 0, lossy: false };
  const read = reader.readFrom(0);
  return { text: read.text, nextOffset: read.nextOffset, lossy: read.lossy };
}

/**
 * 执行一条命令并等待其结束。
 *
 * @param {object | (() => object | undefined)} subprocess `ctx.subprocess` 服务、测试替身，
 *   或延迟解析器（宿主服务装配晚于插件挂载时用解析器）。
 * @param {{
 *   argv: readonly string[],
 *   cwd: string,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   graceMs?: number,
 *   signal?: AbortSignal,
 * }} spec
 * @returns {Promise<{
 *   argv: string[], cwd: string, exitCode: number | null, signal: string | null,
 *   stdout: string, stderr: string, stdoutLossy: boolean, stderrLossy: boolean,
 *   timedOut: boolean,
 * }>}
 */
export async function runCommand(subprocess, spec) {
  const {
    argv,
    cwd,
    timeoutMs = 600_000,
    maxBytes = DEFAULT_MAX_BYTES,
    graceMs = DEFAULT_GRACE_MS,
    signal,
  } = spec;

  // 允许传入「解析器」而不是服务对象：宿主服务是异步装配的，插件挂载时
  // `ctx.subprocess` 可能还不存在，因此到真正要执行命令的那一刻才解析
  // （`lib/index.js` 传的就是 `lazyService(ctx, "subprocess")`）。
  const service = typeof subprocess === "function" ? subprocess() : subprocess;

  if (service === undefined || service === null) {
    throw new EaselError(ERROR_CODES.RUNTIME_MISSING, "DSH 子进程服务不可用，无法执行外部命令。", {
      details: { argv: [...argv] },
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`命令执行超时（${timeoutMs} ms）`));
  }, timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let handle;
    try {
      handle = service.spawn({
        argv: [...argv],
        cwd,
        stdio: { stdin: "ignore", stdout: { maxBytes }, stderr: { maxBytes } },
        graceMs,
        signal: controller.signal,
      });
    } catch (error) {
      throw new EaselError(
        ERROR_CODES.RUNTIME_MISSING,
        `无法启动命令：${argv[0]}（${error instanceof Error ? error.message : String(error)}）`,
        { cause: error, details: { argv: [...argv], cwd } },
      );
    }

    let outcome;
    try {
      outcome = await handle.done;
    } catch (error) {
      throw new EaselError(
        ERROR_CODES.PUBLISH_FAILED,
        `命令执行中断：${argv[0]}（${error instanceof Error ? error.message : String(error)}）`,
        { cause: error, details: { argv: [...argv], cwd } },
      );
    }

    const stdout = readCollected(handle.collected?.stdout);
    const stderr = readCollected(handle.collected?.stderr);
    return {
      argv: [...argv],
      cwd,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutLossy: stdout.lossy,
      stderrLossy: stderr.lossy,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** 把一条命令渲染成可复制、可审计的字符串（不做 shell 转义，只加引号）。 */
export function renderCommand(argv) {
  return argv.map((part) => (/[\s"'$`\\]/.test(part) ? JSON.stringify(part) : part)).join(" ");
}
