/**
 * 发布编排：内容安全门禁 → 既有发布脚本 → 结果记录。
 *
 * 这里体现 spec `platform-publishing` 的四条硬约束：
 * 1. 发布**只经由仓库内既有脚本**（见 `lib/host/scripts.js` 的 argv 构造），
 *    插件自己不发任何平台请求；
 * 2. 每次对外发布前**先跑确定性安全扫描**，命中即阻止；
 * 3. **不存在任何放行参数**——`buildPublishArgv` 永不追加 `--allow-unsafe`，
 *    本模块也不接受 allowUnsafe 之类的入参；
 * 4. 每次发布都留下**可查看的结果记录**：命令全文、退出状态、输出尾部追加到既有
 *    的 `outputs/_publish.log`（格式与 `web/app.py` 完全一致），同时返回结构化记录。
 *
 * @module easel-workbench/host/publish
 */

import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ERROR_CODES, EaselError, ensure } from "./errors.js";
import { renderCommand, runCommand } from "./exec.js";
import { PLATFORMS, buildPublishArgv, platformOf } from "./scripts.js";

/** 既有发布日志（人类可读文本，由 `web/app.py` 与各 publisher 追加）。 */
export const PUBLISH_LOG_NAME = "_publish.log";

/** 写入日志时保留的输出尾部长度（与 `web/app.py` 的 `[-2000:]` 一致）。 */
export const LOG_TAIL_CHARS = 2000;

/** 面板一次展示的历史记录条数上限。 */
export const MAX_HISTORY = 50;

/**
 * 出现在发布输出里的读回结论（`platform_readback` 的 outcome 取值）。
 *
 * **顺序有意为之**：`unverified`（未核实）必须排在 `verified`（已核实）之前，
 * 否则「未核实」会被误判成「已核实」，把没确认的发布记成成功。
 */
export const READBACK_OUTCOMES = Object.freeze([
  "login_required",
  "readback_error",
  "unverified",
  "verified",
]);

/**
 * 判定标记：英文 outcome 用**词边界**匹配（不能用子串——`unverified` 里含 `verified`），
 * 中文标记取自发布脚本真实输出：成功行 `✅ …发布成功（读回核验：作品 …）`，
 * 失败提示取自 `_repo/skills/shared/scripts/web_publisher.py` 的 `_READBACK_FAIL_HINTS`。
 */
const READBACK_MARKERS = Object.freeze([
  ["login_required", [/\blogin_required\b/, "读回时登录态已失效"]],
  ["readback_error", [/\breadback_error\b/, "读回通道失败", "未登记读回核验函数"]],
  ["unverified", [/\bunverified\b/, "读回未核实"]],
  ["verified", [/\bverified\b/, "读回对账通过", "读回核验："]],
]);

/** 把一次发布渲染成既有 `_publish.log` 的条目格式。 */
export function formatPublishLogEntry(input) {
  const at = input.at ?? new Date().toISOString().replace("T", " ").slice(0, 19);
  const rc = input.exitCode === null ? "n/a" : String(input.exitCode);
  const tail = (text) => String(text ?? "").slice(-LOG_TAIL_CHARS);
  return (
    `\n===== ${at} ${input.platform}${input.async === true ? "(async)" : ""} rc=${rc} ok=${input.ok === true} =====\n` +
    `CMD: ${input.command}\n` +
    `STDOUT:\n${tail(input.stdout)}\n` +
    `STDERR:\n${tail(input.stderr)}\n`
  );
}

/**
 * 解析既有 `_publish.log`，取出最近若干条记录。
 *
 * 只做宽容解析：任何不符合格式的段落都被跳过，绝不因为一行坏数据而丢失整个文件。
 */
export function parsePublishLog(text, limit = MAX_HISTORY) {
  const records = [];
  const lines = String(text ?? "").split("\n");
  let current = null;
  let section = null;
  const header = /^=====\s+(.+?)\s+([\w-]+?)(\(async\))?\s+rc=(\S+)\s+ok=(\w+)\s+=====$/;
  for (const line of lines) {
    const matched = header.exec(line.trim());
    if (matched !== null) {
      if (current !== null) records.push(current);
      current = {
        at: matched[1],
        platform: matched[2],
        async: matched[3] !== undefined,
        exitCode: matched[4] === "n/a" ? null : Number(matched[4]),
        ok: matched[5] === "true",
        command: "",
        stdout: "",
        stderr: "",
      };
      section = null;
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("CMD: ")) {
      current.command = line.slice(5);
      section = null;
    } else if (line === "STDOUT:") {
      section = "stdout";
    } else if (line === "STDERR:") {
      section = "stderr";
    } else if (section !== null) {
      current[section] += `${current[section] === "" ? "" : "\n"}${line}`;
    }
  }
  if (current !== null) records.push(current);
  return records.slice(-Math.max(1, limit)).reverse();
}

/** 从发布输出里判定读回结论；没有证据时返回 `undefined`。 */
export function readbackOf(stdout, stderr) {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`;
  for (const [outcome, markers] of READBACK_MARKERS) {
    for (const marker of markers) {
      if (marker instanceof RegExp ? marker.test(text) : text.includes(marker)) return outcome;
    }
  }
  return undefined;
}

/** 取输出尾部若干非空行，作为人能读懂的原因。 */
export function reasonOf(stdout, stderr, lines = 8) {
  const stderrLines = String(stderr ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const source =
    stderrLines.length > 0
      ? stderrLines
      : String(stdout ?? "")
          .split("\n")
          .filter((line) => line.trim() !== "");
  return source.slice(-lines).join("\n");
}

/**
 * 建立发布服务。
 *
 * @param {{
 *   runtime: Record<string, any>,
 *   subprocess?: object | (() => object | undefined),
 *   paths: ReturnType<import('./paths.js').createPathPolicy>,
 *   gate: ReturnType<import('./gate.js').createGateService>,
 *   resolvePython: () => Promise<string | undefined>,
 * }} deps
 */
export function createPublishService(deps) {
  const { runtime, subprocess, paths, gate } = deps;

  /** 只读地读取既有发布日志（限尾部 256 KiB）。 */
  async function readLogText() {
    if (runtime.outputsDir === undefined) return "";
    const logPath = join(runtime.outputsDir, PUBLISH_LOG_NAME);
    const info = await stat(logPath).catch(() => undefined);
    if (info === undefined) return "";
    const text = await readFile(logPath, "utf8").catch(() => "");
    const maxChars = 256 * 1024;
    return text.length <= maxChars ? text : text.slice(-maxChars);
  }

  /** 组装需要过安全扫描的文本。 */
  function scanTextOf(input) {
    const parts = [
      input.title,
      input.body,
      Array.isArray(input.tags) ? input.tags.join(",") : input.tags,
      input.cover,
    ];
    if (Array.isArray(input.media)) parts.push(...input.media);
    if (typeof input.article === "string") parts.push(input.article);
    return parts.filter((part) => typeof part === "string" && part.trim() !== "").join("\n");
  }

  const service = {
    /** 平台清单（含各自的内容约束），供面板与工具展示。 */
    listPlatforms() {
      return PLATFORMS.map((platform) => ({
        id: platform.id,
        label: platform.label,
        accepts: platform.accepts,
        limits: platform.limits,
        script: platform.script,
      }));
    },

    /**
     * 预演：只做门禁扫描并给出将要执行的命令（**不追加 `--exec`**）。
     * 本方法不执行任何命令。
     */
    async preview(input) {
      const platform = platformOf(input?.platform);
      ensure(platform !== undefined, ERROR_CODES.INVALID_INPUT, `未知平台：${String(input?.platform)}`, {
        details: { platforms: PLATFORMS.map((entry) => entry.id) },
      });
      const python = await deps.resolvePython();
      ensure(
        python !== undefined,
        ERROR_CODES.RUNTIME_MISSING,
        "未找到 Python 解释器，无法预演发布命令。请先完成运行时准备。",
      );
      const built = buildPublishArgv({
        platform: platform.id,
        python,
        repoRoot: runtime.easelRoot,
        media: input.media,
        title: input.title,
        body: input.body,
        tags: input.tags,
        cover: input.cover,
        article: input.article,
        tid: input.tid,
        exec: false,
      });
      const warnings = [];
      if (
        typeof input.title === "string" &&
        platform.limits.title > 0 &&
        input.title.length > platform.limits.title
      ) {
        warnings.push(`标题超过 ${platform.label} 的 ${String(platform.limits.title)} 字上限。`);
      }
      if (
        typeof input.body === "string" &&
        platform.limits.body > 0 &&
        input.body.length > platform.limits.body
      ) {
        warnings.push(`正文超过 ${platform.label} 的 ${String(platform.limits.body)} 字上限。`);
      }
      if (
        Array.isArray(input.tags) &&
        platform.limits.tags > 0 &&
        input.tags.length > platform.limits.tags
      ) {
        warnings.push(`标签数超过 ${platform.label} 的 ${String(platform.limits.tags)} 个上限。`);
      }
      const guard = await gate.scan({ text: scanTextOf(input), label: `${platform.label}发布内容` });
      return {
        platform: platform.id,
        label: platform.label,
        mode: built.mode,
        argv: built.argv,
        command: renderCommand(built.argv),
        guard: {
          blocked: guard.blocked,
          exitCode: guard.exitCode,
          findings: guard.findings,
          warnings: guard.warnings,
        },
        warnings,
      };
    },

    /**
     * 执行一次真实发布。
     *
     * 顺序固定：门禁 → 执行 → 记录。门禁命中就直接抛 `content-guard-blocked`，
     * 命令**一次都不会被执行**。
     */
    async publish(input) {
      const platform = platformOf(input?.platform);
      ensure(platform !== undefined, ERROR_CODES.INVALID_INPUT, `未知平台：${String(input?.platform)}`, {
        details: { platforms: PLATFORMS.map((entry) => entry.id) },
      });
      ensure(
        typeof input.title === "string" && input.title.trim() !== "",
        ERROR_CODES.INVALID_INPUT,
        "发布必须有标题。",
      );
      const python = await deps.resolvePython();
      ensure(
        python !== undefined,
        ERROR_CODES.RUNTIME_MISSING,
        "未找到 Python 解释器，无法发布。请先完成运行时准备。",
      );

      const label = input.contentId === undefined ? `${platform.label}发布内容` : String(input.contentId);
      const guard = await gate.assertSafe({ text: scanTextOf(input), label });

      const built = buildPublishArgv({
        platform: platform.id,
        python,
        repoRoot: runtime.easelRoot,
        media: input.media,
        title: input.title,
        body: input.body,
        tags: input.tags,
        cover: input.cover,
        article: input.article,
        tid: input.tid,
        exec: true,
      });
      // 纵深防御：真实发布的 argv 里绝不允许出现放行开关。
      ensure(!built.argv.includes("--allow-unsafe"), ERROR_CODES.PUBLISH_FAILED, "内部错误：发布命令不应包含 --allow-unsafe。", {
        details: { argv: built.argv },
      });

      const result = await runCommand(subprocess, {
        argv: built.argv,
        cwd: runtime.easelRoot,
        timeoutMs: runtime.publishTimeoutMs,
      });
      const ok = result.exitCode === 0;
      const at = new Date().toISOString().replace("T", " ").slice(0, 19);
      const command = renderCommand(result.argv);

      let logPath = null;
      let logError = null;
      try {
        if (runtime.outputsDir !== undefined) {
          const candidate = join(runtime.outputsDir, PUBLISH_LOG_NAME);
          paths.assertWritable(candidate, "publish-log");
          await appendFile(
            candidate,
            formatPublishLogEntry({
              platform: platform.id,
              at,
              exitCode: result.exitCode,
              ok,
              command,
              stdout: result.stdout,
              stderr: result.stderr,
            }),
            "utf8",
          );
          logPath = candidate;
        }
      } catch (error) {
        // 记录失败绝不吞掉发布结果，但必须如实报告。
        logError = error instanceof Error ? error.message : String(error);
      }

      const readback = readbackOf(result.stdout, result.stderr);
      const personaWarning = await service.personaWarning(input.personaScore);

      return {
        platform: platform.id,
        label: platform.label,
        contentId: input.contentId ?? null,
        mode: built.mode,
        at,
        command,
        argv: result.argv,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        ok,
        reason: ok ? null : reasonOf(result.stdout, result.stderr),
        stdoutTail: result.stdout.slice(-LOG_TAIL_CHARS),
        stderrTail: result.stderr.slice(-LOG_TAIL_CHARS),
        guard: { warnings: guard.warnings, exitCode: guard.exitCode },
        attribution:
          readback === undefined
            ? { outcome: "unverified", note: "输出里没有读回结论。" }
            : { outcome: readback, note: null },
        personaWarning,
        logPath,
        logError,
      };
    },

    /**
     * 人设一致性：低分**只告警不阻断**（spec 明确要求）。
     *
     * 没有传入分数时返回 `null`——绝不编造一个分数。
     */
    async personaWarning(score) {
      if (!Number.isFinite(score)) return null;
      const outcome = await gate.scorePersona({ score });
      return {
        score: outcome.score,
        verdict: outcome.verdict,
        threshold: outcome.threshold,
        warnings: outcome.warnings,
        blocking: false,
        message:
          outcome.verdict === "pass"
            ? "人设一致性检查通过。"
            : `人设一致性得分 ${String(outcome.score)} 低于阈值 ${String(outcome.threshold)}，仅作告警，不阻断发布。`,
      };
    },

    /** 独立的门禁扫描入口（面板里可单独调用）。 */
    async scan(input) {
      return gate.scan({ text: input?.text, file: input?.file, label: input?.label });
    },

    /** 发布历史：读取既有 `_publish.log`。 */
    async history(limit = MAX_HISTORY) {
      const text = await readLogText();
      return {
        records: parsePublishLog(text, limit),
        path: runtime.outputsDir === undefined ? null : join(runtime.outputsDir, PUBLISH_LOG_NAME),
      };
    },
  };

  return service;
}
