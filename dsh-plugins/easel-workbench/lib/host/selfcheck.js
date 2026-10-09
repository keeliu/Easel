/**
 * 环境自检：把「工作台能不能干活」的判据一次性摊开给用户。
 *
 * 覆盖 spec `creator-skill-library` 的「技能运行时可用性上报」与
 * `platform-publishing` 的「登录态在仓库之外」两条可观测要求：
 * 外部 `python` / `ffmpeg` 是否可解析、仓库根与运行时目录在哪里、
 * 上游只读保护是否生效（含已拦下的越界写入）、登录态目录是否在仓库之外、
 * 以及 DSH 的各项可选能力当前是否可用。
 *
 * 本模块**只读取**：不扫描技能目录内容、不注册任何东西、不修改磁盘。
 *
 * @module easel-workbench/host/selfcheck
 */

import { stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { UPSTREAM_READ_ONLY_PREFIXES } from "./config.js";
import { probeRuntime } from "./runtime.js";

/** 自检结果的条目状态。 */
export const CHECK_STATUSES = Object.freeze(["ok", "missing", "degraded"]);

/** 依 `status` 汇总。 */
function summarize(entries) {
  const missing = entries.filter((entry) => entry.status === "missing").map((entry) => entry.id);
  const degraded = entries.filter((entry) => entry.status === "degraded").map((entry) => entry.id);
  return { ready: missing.length === 0, missing, degraded };
}

async function directoryInfo(absolute) {
  const info = await stat(absolute).catch(() => undefined);
  return {
    path: absolute,
    exists: info !== undefined,
    isDirectory: info?.isDirectory() ?? false,
  };
}

/**
 * 建立环境自检服务。
 *
 * @param {{
 *   ctx?: Record<string, any>,
 *   runtime: Record<string, any>,
 *   paths: Record<string, any>,
 *   probe?: Function,
 * }} deps
 */
export function createSelfcheckService(deps) {
  const { ctx, runtime, paths, probe = probeRuntime } = deps;

  return {
    /**
     * 运行一次自检。
     *
     * 任何一项失败都不抛错：自检的职责就是把失败如实报出来，
     * 让工作台其余区域继续可用（spec：依赖缺失不影响面板打开）。
     */
    async run() {
      const entries = [];
      const subprocess = ctx?.subprocess;
      const probed = await probe({ runtime, subprocess }).catch((error) => ({
        python: { ok: false, source: "probe-failed", searched: [], path: undefined },
        ffmpeg: { ok: false, source: "probe-failed", searched: [], path: undefined },
        ready: false,
        probeError: String(error?.message ?? error),
      }));

      for (const [id, label, found] of [
        ["python", "Python 运行时", probed.python],
        ["ffmpeg", "ffmpeg", probed.ffmpeg],
      ]) {
        const searched = found?.searched ?? [];
        entries.push({
          id,
          label,
          status: found?.ok === true ? "ok" : "missing",
          path: found?.path ?? null,
          source: found?.source ?? null,
          searched,
          version: found?.version ?? null,
          detail:
            found?.ok === true
              ? `已解析到 ${found.path}${found.version === undefined ? "" : `（${found.version}）`}`
              : `未找到可执行的 ${id === "python" ? "Python 解释器" : "ffmpeg"}；已查找：${
                  searched.length === 0 ? "未配置任何候选路径" : searched.join("、")
                }`,
        });
      }

      const easelRoot = runtime.easelRoot;
      const repoInfo = await directoryInfo(easelRoot);
      entries.push({
        id: "repo",
        label: "Easel 数据根",
        status: repoInfo.isDirectory ? "ok" : "missing",
        path: easelRoot,
        detail: repoInfo.isDirectory
          ? `画像、产物、技能与选题数据所在目录：${easelRoot}`
          : `未找到 Easel 数据根（需要存在 skills/ 与 pyproject.toml；工作区形态下即 <工作区>/_repo）：${easelRoot}`,
      });

      const runtimeInfo = await directoryInfo(runtime.runtimeDir);
      entries.push({
        id: "runtime-dir",
        label: "运行时目录",
        status: runtimeInfo.exists ? "ok" : "degraded",
        path: runtime.runtimeDir,
        detail: runtimeInfo.exists
          ? "受控运行时目录已存在。"
          : `受控运行时目录尚未建立（可运行包内 scripts/bootstrap-runtime.sh）：${runtime.runtimeDir}`,
      });

      const skillRoots = [];
      for (const configured of runtime.skillDirs) {
        const absolute = isAbsolute(configured) ? configured : join(easelRoot, configured);
        const info = await directoryInfo(absolute);
        skillRoots.push({
          configured,
          path: absolute,
          relative: paths.isInsideRepo(absolute) ? relative(easelRoot, absolute) : null,
          exists: info.exists,
          isDirectory: info.isDirectory,
        });
      }
      entries.push({
        id: "skill-roots",
        label: "Easel 技能根",
        status: skillRoots.length === 0 ? "degraded" : skillRoots.every((root) => root.isDirectory) ? "ok" : "missing",
        detail:
          skillRoots.length === 0
            ? "未配置任何技能根，Easel 技能不会出现在 DSH 技能目录中。"
            : skillRoots
                .map((root) => `${root.configured}${root.isDirectory ? "" : "（不存在）"}`)
                .join("、"),
        roots: skillRoots,
      });

      const loginInfo = await directoryInfo(runtime.loginStateDir);
      const loginOutsideRepo = !paths.isInsideRepo(runtime.loginStateDir);
      entries.push({
        id: "login-state",
        label: "登录态目录",
        status: loginOutsideRepo ? "ok" : "degraded",
        path: runtime.loginStateDir,
        exists: loginInfo.exists,
        outsideRepo: loginOutsideRepo,
        detail: loginOutsideRepo
          ? "登录态保存在仓库之外的用户态目录，不会被版本控制跟踪。"
          : "登录态目录位于仓库内，存在被版本控制跟踪的风险。",
      });

      const capabilities = {
        subprocess: typeof subprocess?.spawn === "function",
        agents: typeof ctx?.agents?.create === "function",
        resume: typeof ctx?.agents?.resume === "function",
        attachments: typeof ctx?.attachments?.saveFile === "function",
        agentPresets: typeof ctx?.agentPresets?.register === "function",
        agentDefaultModel: typeof ctx?.agentDefaultModel?.currentSelection === "function",
        schedule: typeof ctx?.schedule?.create === "function",
        webServer: typeof ctx?.webServer?.register === "function",
        tools: typeof ctx?.tools?.register === "function",
        toolGuard: typeof ctx?.tools?.guard === "function",
      };
      const unavailable = Object.entries(capabilities)
        .filter(([, present]) => present !== true)
        .map(([name]) => name);
      entries.push({
        id: "capabilities",
        label: "DSH 能力",
        status: unavailable.length === 0 ? "ok" : "degraded",
        detail:
          unavailable.length === 0
            ? "派发、附件、排期、命令执行等能力均可用。"
            : `以下能力当前不可用：${unavailable.join("、")}；对应区域会给出可读提示。`,
        capabilities,
      });

      const blockedWrites = paths.blockedWrites();
      entries.push({
        id: "upstream-read-only",
        label: "上游只读保护",
        status: blockedWrites.length === 0 ? "ok" : "degraded",
        prefixes: [...UPSTREAM_READ_ONLY_PREFIXES],
        blockedWrites,
        detail:
          blockedWrites.length === 0
            ? `已拒绝对 ${UPSTREAM_READ_ONLY_PREFIXES.join("、")} 的写入，本次运行未发生越界写入。`
            : `本次运行已拦下 ${blockedWrites.length} 次越界写入：${blockedWrites
                .map((entry) => `${entry.path}（${entry.operation}）`)
                .join("、")}`,
      });

      entries.push({
        id: "catalog",
        label: "技能目录长度限制",
        status: "ok",
        maxLength: runtime.catalogDescriptionMaxLength,
        detail: `技能目录中每条描述最多 ${runtime.catalogDescriptionMaxLength} 个字符（DSH 默认 500）。`,
      });

      entries.push({
        id: "model-routing",
        label: "模型路由",
        status: "ok",
        detail: "工作台不定义、不存储模型凭据；模型与推理强度一律沿用 DSH 会话的选择。",
      });

      const summary = summarize(entries);
      return {
        checkedAt: new Date().toISOString(),
        ready: summary.ready,
        missing: summary.missing,
        degraded: summary.degraded,
        entries,
        easelRoot,
        repoRoot: runtime.repoRoot,
        runtimeDir: runtime.runtimeDir,
        loginStateDir: runtime.loginStateDir,
        skillDirs: runtime.skillDirs,
        catalogDescriptionMaxLength: runtime.catalogDescriptionMaxLength,
        taskDispatchTarget: runtime.taskDispatchTarget,
      };
    },
  };
}
