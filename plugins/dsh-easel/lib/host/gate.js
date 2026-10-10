/**
 * 内容安全门禁：对外发布前的**确定性**扫描。
 *
 * 规则来自 `_repo/skills/shared/scripts/content_guard.py`：命中任一 BLOCK 类别即以
 * 退出码 7 结束。本模块的职责是把「退出码 7 = 命中」翻译成结构化的命中项，并保证
 * **没有任何放行通道**——spec `platform-publishing` 明确要求插件不得提供绕过该门禁
 * 的开关、配置或参数，因此这里不存在 `allowUnsafe` 之类的入参，argv 也永不包含
 * `--allow-unsafe`。
 *
 * @module dsh-easel/host/gate
 */

import { ERROR_CODES, EaselError } from "./errors.js";
import { buildGuardArgv, buildPersonaArgv } from "./scripts.js";
import { renderCommand, runCommand } from "./exec.js";

/** content_guard.py 的「检出泄露」退出码。 */
export const GUARD_EXIT_LEAK = 7;

/** 会阻断发布的类别（其余类别只产生告警）。 */
export const GUARD_BLOCK_CATEGORIES = Object.freeze([
  "api-key",
  "env-value",
  "internal-host",
  "proxy-ip",
  "internal-path",
  "env-name",
]);

/** 与 content_guard.py 同级、只提醒不拦截的类别。 */
export const GUARD_WARN_CATEGORIES = Object.freeze(["ai-disclosure", "model-name"]);

/** 门禁与评分脚本自身的超时（毫秒）。 */
export const GATE_TIMEOUT_MS = 120_000;

/**
 * 从 content_guard 的 stderr 里抽出逐项命中列表。
 *
 * stderr 的形状是「❌ 标题行（N 处）：」+ 若干明细行 + 「→ 结尾行」。这里按这个
 * 骨架切分，抽不出来时返回空数组，由调用方回落到原文。
 *
 * @param {string} stderr
 * @returns {string[]}
 */
export function parseFindings(stderr) {
  const lines = String(stderr ?? "").split("\n");
  const items = [];
  let collecting = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!collecting) {
      if (line.includes("已阻止本次发布")) collecting = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("→")) break;
    items.push(trimmed);
  }
  return items;
}

/**
 * 从 content_guard 的 stderr 里抽出告警列表（`⚠️` 之后的明细行）。
 *
 * @param {string} stderr
 * @returns {string[]}
 */
export function parseWarnings(stderr) {
  const lines = String(stderr ?? "").split("\n");
  const items = [];
  let collecting = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!collecting) {
      if (line.includes("仅提醒，不拦截")) collecting = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") continue;
    items.push(trimmed);
  }
  return items;
}

/** 退出码 7 即命中阻断类别。 */
export function isBlocked(result) {
  return result?.exitCode === GUARD_EXIT_LEAK;
}

/**
 * 建立门禁服务。
 *
 * @param {{ runtime: Record<string, any>, subprocess?: object | (() => object | undefined), resolvePython: () => Promise<string> }} deps
 */
export function createGateService(deps) {
  const { runtime, subprocess } = deps;

  async function requirePython() {
    const python = await deps.resolvePython();
    if (python === undefined) {
      throw new EaselError(
        ERROR_CODES.RUNTIME_MISSING,
        "未找到 Python 解释器，无法运行内容安全扫描与人设评分。请先完成运行时准备。",
      );
    }
    return python;
  }

  /**
   * 扫描一段文本或一个文件。
   *
   * @param {{ text?: string, file?: string, label?: string }} input
   * @returns {Promise<{ blocked: boolean, exitCode: number|null, command: string,
   *   findings: string[], warnings: string[], stderr: string, stdout: string }>}
   */
  async function scan(input) {
    const python = await requirePython();
    const argv = buildGuardArgv({
      python,
      repoRoot: runtime.easelRoot,
      text: input.text,
      file: input.file,
    });
    if (argv.length <= 3) {
      throw new EaselError(ERROR_CODES.INVALID_INPUT, "内容安全扫描需要 --text 或 --file 之一。");
    }
    const result = await runCommand(subprocess, {
      argv,
      cwd: runtime.easelRoot,
      timeoutMs: GATE_TIMEOUT_MS,
    });
    const findings = parseFindings(result.stderr);
    const warnings = parseWarnings(result.stderr);
    return {
      blocked: isBlocked(result),
      exitCode: result.exitCode,
      command: renderCommand(result.argv),
      findings,
      warnings,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  /**
   * 断言内容可以对外发布；命中阻断类别时抛出 `content-guard-blocked`。
   *
   * @param {{ text: string, label?: string }} input
   */
  async function assertSafe(input) {
    const label = input.label ?? "发布内容";
    const outcome = await scan({ text: input.text, label });
    if (outcome.blocked) {
      const items = outcome.findings.length > 0 ? outcome.findings : [outcome.stderr.trim()];
      throw new EaselError(
        ERROR_CODES.CONTENT_GUARD_BLOCKED,
        `内容安全扫描命中 ${items.length} 处敏感信息，已阻止发布。`,
        {
          details: {
            label,
            command: outcome.command,
            findings: items,
            warnings: outcome.warnings,
            exitCode: outcome.exitCode,
          },
        },
      );
    }
    if (outcome.exitCode !== 0) {
      throw new EaselError(
        ERROR_CODES.SOURCE_UNAVAILABLE,
        `内容安全扫描未能完成（退出码 ${String(outcome.exitCode)}）。`,
        { details: { command: outcome.command, stderr: outcome.stderr.trim() } },
      );
    }
    return outcome;
  }

  /**
   * 人设一致性评分。**只看评分，永不阻断**：脚本自身恒以 0 退出，低分仅告警。
   *
   * @param {{ text: string, threshold?: number, warn?: number }} input
   */
  async function scorePersona(input) {
    const python = await requirePython();
    const threshold = Number.isFinite(input.threshold) ? input.threshold : runtime.personaScoreThreshold;
    const argv = buildPersonaArgv({
      python,
      repoRoot: runtime.easelRoot,
      score: input.score,
      threshold,
      warn: input.warn,
    });
    if (!Number.isFinite(input.score)) {
      throw new EaselError(ERROR_CODES.INVALID_INPUT, "人设评分需要一个 0–100 的分数。");
    }
    const result = await runCommand(subprocess, {
      argv,
      cwd: runtime.easelRoot,
      timeoutMs: GATE_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new EaselError(
        ERROR_CODES.SOURCE_UNAVAILABLE,
        `人设评分脚本未能完成（退出码 ${String(result.exitCode)}）。`,
        { details: { command: renderCommand(result.argv), stderr: result.stderr.trim() } },
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new EaselError(ERROR_CODES.SOURCE_UNAVAILABLE, "人设评分脚本没有返回可解析的结果。", {
        details: { command: renderCommand(result.argv), stdout: result.stdout.trim() },
      });
    }
    return {
      verdict: parsed.verdict,
      score: parsed.score,
      threshold: parsed.threshold,
      warnings: parsed.warning === true,
      publishAllowed: true,
      command: renderCommand(result.argv),
    };
  }

  return { scan, assertSafe, scorePersona };
}
