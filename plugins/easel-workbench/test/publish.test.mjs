/**
 * 发布服务的测试。
 *
 * 对应 spec `platform-publishing` 的验收点：
 * - 6.3 发布只经既有脚本、经 DSH 命令执行能力运行、记录完整命令与退出状态；
 * - 6.4 发布前强制运行内容守卫，命中即阻止并返回命中项分类；
 * - 6.7 人设评分高则不加确认步骤，低分只告警、不阻断；
 * - 6.8 发布结果记录与归因：成功 / 失败 / 平台不可用三种情况，失败给原因不留残留值。
 *
 * 所有用例注入假 `subprocess` / 假 `gate` 响应，不联网、不真跑 python。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ERROR_CODES, EaselError } from "../lib/host/errors.js";
import { GUARD_EXIT_LEAK, createGateService } from "../lib/host/gate.js";
import { createPathPolicy } from "../lib/host/paths.js";
import { PLATFORMS } from "../lib/host/scripts.js";
import {
  LOG_TAIL_CHARS,
  MAX_HISTORY,
  PUBLISH_LOG_NAME,
  READBACK_OUTCOMES,
  createPublishService,
  formatPublishLogEntry,
  parsePublishLog,
  readbackOf,
  reasonOf,
} from "../lib/host/publish.js";

/**
 * 假子进程服务，形状对齐 `lib/host/exec.js` 的
 * `spawn(spec)` → `handle.done` + `handle.collected.{stdout,stderr}.readFrom(offset)`。
 */
function fakeSubprocess(handler) {
  const calls = [];
  return {
    calls,
    spawn(spec) {
      const index = calls.length;
      calls.push(spec);
      const response = handler(spec, index) ?? {};
      const stdout = String(response.stdout ?? "");
      const stderr = String(response.stderr ?? "");
      const reader = (text) => ({
        readFrom(offset) {
          return { text: text.slice(offset), nextOffset: text.length, lossy: false };
        },
      });
      return {
        collected: { stdout: reader(stdout), stderr: reader(stderr) },
        done: Promise.resolve({ exitCode: response.exitCode ?? 0, signal: response.signal ?? null }),
      };
    },
  };
}

/** 门禁替身：按脚本名把 `content_guard.py` 与 `persona_gate.py` 分派到不同假响应。 */
function routedGate(guardResponse, personaResponse) {
  return fakeSubprocess((spec) => {
    if (spec.argv.some((arg) => arg.includes("content_guard.py"))) {
      return typeof guardResponse === "function" ? guardResponse(spec) : guardResponse;
    }
    if (spec.argv.some((arg) => arg.includes("persona_gate.py"))) {
      return personaResponse ?? {
        exitCode: 0,
        stdout: JSON.stringify({ verdict: "pass", score: 90, threshold: 70, warning: false }),
      };
    }
    return { exitCode: 0 };
  });
}

const GUARD_CLEAN = { exitCode: 0, stderr: "✅ 未检出敏感信息" };
const PERSONA_PASS = { exitCode: 0, stdout: JSON.stringify({ verdict: "pass", score: 88, threshold: 70, warning: false }) };
const PERSONA_WARN = { exitCode: 0, stdout: JSON.stringify({ verdict: "warn", score: 30, threshold: 70, warning: true }) };

function guardBlocked(lines) {
  return {
    exitCode: GUARD_EXIT_LEAK,
    stderr: ["❌ 检出敏感信息（1 处）：", "已阻止本次发布", ...lines, "→ 请移除后重试"].join("\n"),
  };
}

async function makeEnv() {
  const root = await mkdtemp(join(tmpdir(), "easel-publish-"));
  const repoRoot = join(root, "repo");
  const outputsDir = join(repoRoot, "outputs");
  await mkdir(outputsDir, { recursive: true });
  const paths = createPathPolicy({ repoRoot, readOnlyPrefixes: ["skills"] });
  return { root, repoRoot, outputsDir, paths };
}

function buildService({
  repoRoot,
  outputsDir,
  paths,
  subprocess,
  gateSubprocess,
  python = "python3",
  personaScoreThreshold = 70,
}) {
  const runtime = { easelRoot: repoRoot, outputsDir, publishTimeoutMs: 5_000, personaScoreThreshold };
  // `null` 表示「没有解释器」，与默认参数区分开
  const resolvePython = async () => (python === null ? undefined : python);
  const gate = createGateService({ runtime, subprocess: gateSubprocess, resolvePython });
  const publish = createPublishService({ runtime, subprocess, paths, gate, resolvePython });
  return { runtime, gate, publish };
}

/** 去掉注释与字符串字面量，只留可执行代码（避免把文档里的声明本身当成违规）。 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const MODULE_SOURCE = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("平台清单与预演（6.3 只经既有脚本）", () => {
  it("listPlatforms 覆盖七个平台并带各自约束与脚本", () => {
    const envPromise = makeEnv();
    return envPromise.then((env) => {
      const { publish } = buildService({ ...env, subprocess: fakeSubprocess(() => ({})), gateSubprocess: routedGate(GUARD_CLEAN) });
      const listed = publish.listPlatforms();
      assert.equal(listed.length, PLATFORMS.length);
      assert.deepEqual(
        listed.map((platform) => platform.id),
        PLATFORMS.map((platform) => platform.id),
      );
      for (const platform of listed) {
        assert.equal(typeof platform.label, "string");
        assert.equal(typeof platform.script, "string");
        assert.equal(Array.isArray(platform.accepts), true);
        assert.equal(typeof platform.limits.title, "number");
      }
    });
  });

  it("preview 只预演：不追加 --exec，并附带门禁结论", async () => {
    const env = await makeEnv();
    const gateSubprocess = routedGate(GUARD_CLEAN);
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess,
    });
    const preview = await publish.preview({ platform: "xiaohongshu", title: "标题", body: "正文", tags: ["a"] });
    assert.equal(preview.argv.includes("--exec"), false);
    assert.equal(preview.argv.includes("--allow-unsafe"), false);
    assert.equal(preview.mode, "image");
    assert.equal(preview.guard.blocked, false);
    assert.equal(preview.guard.exitCode, 0);
    assert.match(preview.command, /xhs_publish\.py/);
    assert.deepEqual(preview.warnings, []);
  });

  it("preview 对超限标题/正文/标签给出告警", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const preview = await publish.preview({
      platform: "xiaohongshu",
      title: "标".repeat(21),
      body: "文".repeat(1001),
      tags: Array.from({ length: 11 }, (_, index) => `t${index}`),
    });
    assert.equal(preview.warnings.length, 3);
    assert.match(preview.warnings[0], /标题超过/);
    assert.match(preview.warnings[1], /正文超过/);
    assert.match(preview.warnings[2], /标签数超过/);
  });

  it("未知平台抛 invalid-input 且列出可选平台", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    await assert.rejects(
      () => publish.preview({ platform: "不存在的平台" }),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.deepEqual(error.details.platforms, PLATFORMS.map((platform) => platform.id));
        return true;
      },
    );
  });

  it("缺 python 时 preview / publish 都抛 runtime-missing", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      python: null,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    await assert.rejects(
      () => publish.preview({ platform: "xiaohongshu", title: "标题" }),
      (error) => error.code === ERROR_CODES.RUNTIME_MISSING,
    );
    await assert.rejects(
      () => publish.publish({ platform: "xiaohongshu", title: "标题" }),
      (error) => error.code === ERROR_CODES.RUNTIME_MISSING,
    );
  });
});

describe("发布执行 —— 调用既有脚本并记录命令与退出状态（6.3）", () => {
  it("成功发布：argv 指向仓库脚本、带 --exec、cwd 为仓库根，且完整记录", async () => {
    const env = await makeEnv();
    const publishSubprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: "上传中...\nverified 发布成功\n" }));
    const { publish } = buildService({
      ...env,
      subprocess: publishSubprocess,
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const result = await publish.publish({
      platform: "xiaohongshu",
      title: "标题",
      body: "正文",
      tags: ["a", "b"],
      media: ["/srv/media/cover.jpg"],
      contentId: "post-1",
    });

    const expectedScript = join(env.repoRoot, "skills/shared/scripts/xhs_publish.py");
    assert.equal(publishSubprocess.calls.length, 1);
    assert.deepEqual(publishSubprocess.calls[0].argv, result.argv);
    assert.equal(publishSubprocess.calls[0].cwd, env.repoRoot);
    assert.equal(result.argv[0], "python3");
    assert.equal(result.argv[1], expectedScript);
    assert.equal(result.argv.includes("--exec"), true);
    assert.equal(result.argv.includes("--allow-unsafe"), false);
    assert.match(result.command, /xhs_publish\.py publish --images .* --exec/);
    assert.equal(result.mode, "image");
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.equal(result.contentId, "post-1");
    assert.equal(Number.isNaN(Date.parse(result.at.replace(" ", "T"))), false);

    const logPath = join(env.outputsDir, PUBLISH_LOG_NAME);
    assert.equal(result.logPath, logPath);
    assert.equal(result.logError, null);
    const log = await readFile(logPath, "utf8");
    assert.match(log, /CMD: .*xhs_publish\.py/);
    assert.match(log, /rc=0 ok=true/);
    assert.match(log, /STDOUT:\n上传中/);
  });

  it("任何平台的发布 argv 都不含放行开关 --allow-unsafe", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    for (const platform of PLATFORMS) {
      const preview = await publish.preview({
        platform: platform.id,
        title: "标题",
        body: "正文",
        media: ["/srv/media/a.jpg"],
      });
      assert.equal(preview.argv.includes("--allow-unsafe"), false, `${platform.id} 不应含放行开关`);
    }
  });

  it("没有标题直接拒绝，且门禁与脚本都不会被调用", async () => {
    const env = await makeEnv();
    const gateSubprocess = routedGate(GUARD_CLEAN);
    const publishSubprocess = fakeSubprocess(() => ({}));
    const { publish } = buildService({ ...env, subprocess: publishSubprocess, gateSubprocess });
    await assert.rejects(
      () => publish.publish({ platform: "xiaohongshu", body: "正文" }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    assert.equal(gateSubprocess.calls.length, 0);
    assert.equal(publishSubprocess.calls.length, 0);
  });
});

describe("内容安全门禁 —— 命中即阻止并返回分类（6.4）", () => {
  const samples = [
    { category: "api-key", line: "  • api-key: sk-abc***" },
    { category: "internal-host", line: "  • internal-host: wiki.corp.internal" },
    { category: "internal-path", line: "  • internal-path: /srv/secret/report.md" },
    { category: "env-name", line: "  • env-name: EASEL_TOKEN" },
  ];

  for (const sample of samples) {
    it(`含 ${sample.category} 的样例被阻止，命中项分类被返回且发布命令一次都不执行`, async () => {
      const env = await makeEnv();
      const gateSubprocess = routedGate(guardBlocked([sample.line]));
      const publishSubprocess = fakeSubprocess(() => ({ exitCode: 0 }));
      const { publish } = buildService({ ...env, subprocess: publishSubprocess, gateSubprocess });

      await assert.rejects(
        () => publish.publish({ platform: "xiaohongshu", title: "标题", body: "正文", tags: ["tag"], cover: "/srv/c.jpg" }),
        (error) => {
          assert.equal(error.code, ERROR_CODES.CONTENT_GUARD_BLOCKED);
          assert.equal(error.details.exitCode, GUARD_EXIT_LEAK);
          assert.equal(error.details.findings.some((line) => line.includes(sample.category)), true);
          assert.match(error.message, /已阻止发布/);
          return true;
        },
      );
      assert.equal(publishSubprocess.calls.length, 0, "命中时发布命令绝不能执行");
      assert.equal(gateSubprocess.calls.length, 1, "必须先且只跑一次内容守卫");
    });
  }

  it("未被命中时流程继续，扫描文本覆盖标题/正文/标签/封面/媒体", async () => {
    const env = await makeEnv();
    const gateSubprocess = routedGate(GUARD_CLEAN);
    const publishSubprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: "verified" }));
    const { publish } = buildService({ ...env, subprocess: publishSubprocess, gateSubprocess });

    const result = await publish.publish({
      platform: "xiaohongshu",
      title: "安全标题",
      body: "安全正文",
      tags: ["安全标签"],
      cover: "/srv/safe-cover.jpg",
      media: ["/srv/safe-media.jpg"],
    });
    assert.equal(result.ok, true);
    assert.equal(publishSubprocess.calls.length, 1);

    const scannedArg = gateSubprocess.calls[0].argv[gateSubprocess.calls[0].argv.indexOf("--text") + 1];
    for (const part of ["安全标题", "安全正文", "安全标签", "/srv/safe-cover.jpg", "/srv/safe-media.jpg"]) {
      assert.equal(scannedArg.includes(part), true, `扫描文本应包含 ${part}`);
    }
  });

  it("preview 命中时只报告 blocked，不抛错也不执行", async () => {
    const env = await makeEnv();
    const publishSubprocess = fakeSubprocess(() => ({}));
    const { publish } = buildService({
      ...env,
      subprocess: publishSubprocess,
      gateSubprocess: routedGate(guardBlocked(["  • api-key: sk-abc***"])),
    });
    const preview = await publish.preview({ platform: "xiaohongshu", title: "标题", body: "正文" });
    assert.equal(preview.guard.blocked, true);
    assert.equal(preview.guard.findings.length, 1);
    assert.match(preview.guard.findings[0], /api-key/);
    assert.equal(publishSubprocess.calls.length, 0);
  });

  it("守卫自身失败（非 7 退出）报 source-unavailable 并带原因，不放行", async () => {
    const env = await makeEnv();
    const publishSubprocess = fakeSubprocess(() => ({}));
    const { publish } = buildService({
      ...env,
      subprocess: publishSubprocess,
      gateSubprocess: routedGate({ exitCode: 2, stderr: "python: 门禁脚本崩溃" }),
    });
    await assert.rejects(
      () => publish.publish({ platform: "xiaohongshu", title: "标题", body: "正文" }),
      (error) => {
        assert.equal(error.code, ERROR_CODES.SOURCE_UNAVAILABLE);
        assert.match(error.details.stderr, /崩溃/);
        return true;
      },
    );
    assert.equal(publishSubprocess.calls.length, 0);
  });
});

describe("人设一致性 —— 高分不增加确认、低分只告警（6.7）", () => {
  it("高分：verdict=pass、不告警、不阻断，不增加确认步骤", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN, PERSONA_PASS),
    });
    const warning = await publish.personaWarning(88);
    assert.equal(warning.verdict, "pass");
    assert.equal(warning.score, 88);
    assert.equal(warning.threshold, 70);
    assert.equal(warning.warnings, false);
    assert.equal(warning.blocking, false);
    assert.match(warning.message, /通过/);
  });

  it("低分：blocking 恒为 false，message 明说只告警不阻断", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN, PERSONA_WARN),
    });
    const warning = await publish.personaWarning(30);
    assert.equal(warning.verdict, "warn");
    assert.equal(warning.score, 30);
    assert.equal(warning.warnings, true);
    assert.equal(warning.blocking, false);
    assert.match(warning.message, /低于阈值 70/);
    assert.match(warning.message, /不阻断发布/);
  });

  it("低分不阻断发布：publish 仍然成功执行", async () => {
    const env = await makeEnv();
    const publishSubprocess = fakeSubprocess(() => ({ exitCode: 0, stdout: "verified" }));
    const { publish } = buildService({
      ...env,
      subprocess: publishSubprocess,
      gateSubprocess: routedGate(GUARD_CLEAN, PERSONA_WARN),
    });
    const result = await publish.publish({
      platform: "xiaohongshu",
      title: "标题",
      body: "正文",
      personaScore: 30,
    });
    assert.equal(result.ok, true);
    assert.equal(publishSubprocess.calls.length, 1);
    assert.equal(result.personaWarning.blocking, false);
    assert.match(result.personaWarning.message, /不阻断/);
  });

  it("没有分数时返回 null，绝不编造分数", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN, PERSONA_PASS),
    });
    assert.equal(await publish.personaWarning(undefined), null);
    assert.equal(await publish.personaWarning(Number.NaN), null);
    assert.equal(await publish.personaWarning("80"), null);
  });
});

describe("发布结果记录与归因（6.8）", () => {
  it("成功：ok=true，归因用输出里的读回结论，不留虚构数值", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({ exitCode: 0, stdout: "verified: 已读回作品" })),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const result = await publish.publish({ platform: "xiaohongshu", title: "标题", body: "正文" });
    assert.equal(result.ok, true);
    assert.equal(result.attribution.outcome, "verified");
    assert.equal(result.attribution.note, null);
    assert.equal(result.guard.exitCode, 0);
  });

  it("失败：给 stderr 尾部作为原因，归因为 unverified，不残留成功数值", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({
        exitCode: 1,
        stdout: "",
        stderr: "开始上传\n上传失败：网络超时",
      })),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const result = await publish.publish({ platform: "zhihu", title: "标题", article: "/srv/post.html" });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.reason, /上传失败：网络超时/);
    assert.equal(result.guard.exitCode, 0);
    assert.equal(result.attribution.outcome, "unverified");
    assert.equal(result.attribution.note, "输出里没有读回结论。");
  });

  it("平台不可用：脚本缺失时错误可读且带命令，不是空结果", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: undefined,
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    await assert.rejects(
      () => publish.publish({ platform: "xiaohongshu", title: "标题", body: "正文" }),
      (error) => {
        assert.equal(error.code, ERROR_CODES.RUNTIME_MISSING);
        assert.match(error.message, /子进程服务不可用/);
        assert.equal(Array.isArray(error.details.argv), true);
        return true;
      },
    );
  });

  it("其他读回结论：login_required / readback_error 原样归因", async () => {
    const env = await makeEnv();
    for (const outcome of ["login_required", "readback_error"]) {
      const { publish } = buildService({
        ...env,
        subprocess: fakeSubprocess(() => ({ exitCode: 0, stdout: `${outcome}: 详情` })),
        gateSubprocess: routedGate(GUARD_CLEAN),
      });
      const result = await publish.publish({ platform: "xiaohongshu", title: "标题", body: "正文" });
      assert.equal(result.attribution.outcome, outcome);
    }
  });

  it("写日志被仓库只读策略拒绝时不吞发布结果，只如实报 logError", async () => {
    const env = await makeEnv();
    const readOnlyOutputs = join(env.repoRoot, "skills", "out");
    await mkdir(readOnlyOutputs, { recursive: true });
    const { publish } = buildService({
      ...env,
      outputsDir: readOnlyOutputs,
      subprocess: fakeSubprocess(() => ({ exitCode: 0, stdout: "verified" })),
      gateSubprocess: routedGate(GUARD_CLEAN, PERSONA_PASS),
    });
    const result = await publish.publish({ platform: "xiaohongshu", title: "标题", body: "正文" });
    assert.equal(result.ok, true);
    assert.equal(result.logPath, null);
    assert.match(result.logError, /只读/);
  });
});

describe("发布历史（6.8 读取既有 _publish.log）", () => {
  it("没有日志文件时返回空列表而不是残留值", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const history = await publish.history();
    assert.deepEqual(history.records, []);
    assert.equal(history.path, join(env.outputsDir, PUBLISH_LOG_NAME));
  });

  it("没有 outputsDir 时 path 为 null、records 为空", async () => {
    const env = await makeEnv();
    const { publish } = buildService({
      ...env,
      outputsDir: undefined,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const history = await publish.history();
    assert.deepEqual(history.records, []);
    assert.equal(history.path, null);
  });

  it("解析既有日志：最新在前、字段完整、limit 生效", async () => {
    const env = await makeEnv();
    const logPath = join(env.outputsDir, PUBLISH_LOG_NAME);
    await appendFile(
      logPath,
      formatPublishLogEntry({
        platform: "xiaohongshu",
        at: "2026-10-09 06:00:00",
        exitCode: 0,
        ok: true,
        command: "python3 xhs_publish.py publish --exec",
        stdout: "verified",
        stderr: "",
      }),
      "utf8",
    );
    await appendFile(
      logPath,
      formatPublishLogEntry({
        platform: "douyin",
        at: "2026-10-09 06:05:00",
        exitCode: 1,
        ok: false,
        command: "python3 douyin_publish.py publish --exec",
        stdout: "",
        stderr: "上传失败：网络超时",
      }),
      "utf8",
    );

    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const history = await publish.history();
    assert.equal(history.records.length, 2);
    assert.equal(history.records[0].platform, "douyin");
    assert.equal(history.records[0].ok, false);
    assert.equal(history.records[0].exitCode, 1);
    assert.match(history.records[0].stderr, /网络超时/);
    assert.equal(history.records[1].platform, "xiaohongshu");
    assert.equal(history.records[1].command, "python3 xhs_publish.py publish --exec");

    const limited = await publish.history(1);
    assert.equal(limited.records.length, 1);
    assert.equal(limited.records[0].platform, "douyin");
    assert.equal(MAX_HISTORY, 50);
  });

  it("宽容解析：坏段落被跳过，不因一行坏数据丢掉整个文件", async () => {
    const env = await makeEnv();
    const logPath = join(env.outputsDir, PUBLISH_LOG_NAME);
    await appendFile(
      logPath,
      `随便的一行\n===== 格式不对 =====\n${formatPublishLogEntry({
        platform: "zhihu",
        at: "2026-10-09 07:00:00",
        exitCode: null,
        ok: false,
        command: "python3 publish.py --exec",
        stdout: "",
        stderr: "",
        async: true,
      })}`,
      "utf8",
    );
    const { publish } = buildService({
      ...env,
      subprocess: fakeSubprocess(() => ({})),
      gateSubprocess: routedGate(GUARD_CLEAN),
    });
    const history = await publish.history();
    assert.equal(history.records.length, 1);
    assert.equal(history.records[0].platform, "zhihu");
    assert.equal(history.records[0].async, true);
    assert.equal(history.records[0].exitCode, null);
  });
});

describe("纯函数：日志格式与归因判定", () => {
  it("formatPublishLogEntry 只保留输出尾部 LOG_TAIL_CHARS 字符", () => {
    const entry = formatPublishLogEntry({
      platform: "xiaohongshu",
      at: "2026-10-09 06:00:00",
      exitCode: 0,
      ok: true,
      command: "python3 x.py --exec",
      stdout: `${"A".repeat(100)}${"B".repeat(LOG_TAIL_CHARS)}`,
      stderr: "",
    });
    assert.equal(entry.includes("A".repeat(100)), false);
    assert.equal(entry.includes("B".repeat(LOG_TAIL_CHARS)), true);
    assert.match(entry, /^===== 2026-10-09 06:00:00 xiaohongshu rc=0 ok=true =====$/m);
  });

  it("formatPublishLogEntry：退出码为空写 n/a，异步发布标注 (async)", () => {
    const entry = formatPublishLogEntry({
      platform: "bilibili",
      at: "2026-10-09 06:00:00",
      exitCode: null,
      ok: false,
      command: "python3 b.py",
      stdout: "",
      stderr: "",
      async: true,
    });
    assert.match(entry, /rc=n\/a ok=false/);
    assert.match(entry, /bilibili\(async\)/);
  });

  it("readbackOf 按固定优先级匹配输出里的读回结论", () => {
    // unverified 必须排在 verified 之前，否则「未核实」会被记成「已核实」。
    assert.deepEqual(READBACK_OUTCOMES, ["login_required", "readback_error", "unverified", "verified"]);
    assert.equal(readbackOf("verified", ""), "verified");
    assert.equal(readbackOf("", "login_required"), "login_required");
    assert.equal(readbackOf("readback_error", ""), "readback_error");
    assert.equal(readbackOf("一切正常", ""), undefined);
    // 回归：英文 outcome 用词边界匹配，unverified 不得退化判成 verified。
    assert.equal(readbackOf("unverified", ""), "unverified");
    assert.equal(readbackOf("verified", ""), "verified");
  });

  it("readbackOf 认得发布脚本真实输出的中文读回结论", () => {
    // 成功行来自 web_publisher.py：`✅ {平台}发布成功（读回核验：作品 …）`
    assert.equal(readbackOf("✅ 快手发布成功（读回核验：作品 abc123，published）", ""), "verified");
    assert.equal(readbackOf("", "✅ 读回对账通过：abc123（published）"), "verified");
    // _READBACK_FAIL_HINTS 的三条失败提示
    assert.equal(readbackOf("", "快手：界面判定未通过；读回未核实（多轮读作品列表未见本次作品…）"), "unverified");
    assert.equal(readbackOf("", "读回时登录态已失效——发布结果未知，请重新登录后到创作者中心核对"), "login_required");
    assert.equal(readbackOf("", "读回通道失败——发布结果未确认，请到创作者中心人工核对"), "readback_error");
    assert.equal(readbackOf("", "bilibili 未登记读回核验函数"), "readback_error");
    // 没有读回证据的平台（只做界面判定）不得凭空给出结论。
    assert.equal(readbackOf("✅ 小红书发布成功（界面判定通过）", ""), undefined);
  });

  it("reasonOf 优先用 stderr，取最后若干非空行", () => {
    assert.equal(reasonOf("o1\no2", "e1\ne2", 1), "e2");
    assert.equal(reasonOf("o1\no2", "", 1), "o2");
    assert.equal(reasonOf("o1\no2\no3", "  \n", 8), "o1\no2\no3");
    assert.equal(reasonOf(undefined, undefined), "");
  });

  it("parsePublishLog 跳过坏段落并反转成最新在前", () => {
    const text = `${formatPublishLogEntry({
      platform: "a",
      at: "2026-10-09 01:00:00",
      exitCode: 0,
      ok: true,
      command: "c1",
      stdout: "s1",
      stderr: "",
    })}junk\n${formatPublishLogEntry({
      platform: "b",
      at: "2026-10-09 02:00:00",
      exitCode: 1,
      ok: false,
      command: "c2",
      stdout: "s2",
      stderr: "e2",
    })}`;
    assert.deepEqual(
      parsePublishLog(text).map((record) => record.platform),
      ["b", "a"],
    );
    assert.equal(parsePublishLog(text, 1).length, 1);
    assert.equal(parsePublishLog(text, 1)[0].platform, "b");
  });
});

describe("防回归：不存在平台 HTTP 协议实现或客户端依赖（6.3）", () => {
  const FORBIDDEN = /\b(?:https?\.(?:request|get)|axios|node-fetch|got|undici|XMLHttpRequest|requests\.(?:get|post)|fetch)\b/;

  it("publish.js / scripts.js 的可执行代码里没有 HTTP 调用痕迹", () => {
    for (const relative of ["../lib/host/publish.js", "../lib/host/scripts.js"]) {
      const code = codeOnly(MODULE_SOURCE(relative));
      const hit = code.match(FORBIDDEN);
      assert.equal(hit, null, `${relative} 出现疑似 HTTP 实现：${hit?.[0]}`);
    }
  });

  it("模块依赖里没有平台专用 HTTP 客户端", () => {
    const pkg = JSON.parse(MODULE_SOURCE("../package.json"));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.equal(FORBIDDEN.test(name), false, `依赖 ${name} 疑似 HTTP 客户端`);
    }
  });

  it("发布模块不暴露任何门禁放行开关", () => {
    const code = codeOnly(MODULE_SOURCE("../lib/host/publish.js"));
    assert.equal(/allow-unsafe|allowUnsafe/.test(code), false);
    assert.equal(/(?:skipGuard|bypass|skipScan|forcePublish|noScan|disableGuard|overrideGate)/.test(code), false);
  });
});
