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
 * @module dsh-easel/host/selfcheck
 */

import { stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { browserDepsPrefix, browserDepsInstalled, probeChromium } from "./browser-deps.js";
import { UPSTREAM_READ_ONLY_PREFIXES } from "./config.js";
import { PUBLISH_PACKAGE_NAMES, probePythonPackages, probeRuntime } from "./runtime.js";
import { serviceOf } from "./services.js";

/** 自检结果的条目状态。 */
export const CHECK_STATUSES = Object.freeze(["ok", "missing", "degraded"]);

/** 扫码登录与六个平台发布的必经依赖：缺它就无法在面板里完成登录。 */
export const LOGIN_REQUIRED_PACKAGES = Object.freeze(["playwright"]);

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
 *   probePackages?: Function,
 *   probeBrowser?: Function,
 * }} deps
 */
export function createSelfcheckService(deps) {
  const {
    ctx,
    runtime,
    paths,
    probe = probeRuntime,
    probePackages = probePythonPackages,
    probeBrowser = probeChromium,
  } = deps;

  return {
    /**
     * 运行一次自检。
     *
     * 任何一项失败都不抛错：自检的职责就是把失败如实报出来，
     * 让工作台其余区域继续可用（spec：依赖缺失不影响面板打开）。
     */
    async run() {
      const entries = [];
      const subprocess = serviceOf(ctx, "subprocess");
      const probed = await probe({ runtime, subprocess }).catch((error) => ({
        python: { ok: false, source: "probe-failed", searched: [], path: undefined },
        ffmpeg: { ok: false, source: "probe-failed", searched: [], path: undefined },
        ready: false,
        probeError: String(error?.message ?? error),
      }));

      const bootstrap = `bash ${
        runtime.packageRoot === undefined ? "scripts/bootstrap-runtime.sh" : join(runtime.packageRoot, "scripts/bootstrap-runtime.sh")
      }`;

      // 非 root 时 apt-get 一定失败，hint 里直接把 sudo 写进去；同时也得给一条**不需要
      // 包管理器权限**的出路，否则容器里的非特权用户只能读到一条自己做不到的建议。
      const needsSuperUser = typeof process.getuid === "function" && process.getuid() !== 0;
      const installFfmpeg = `${needsSuperUser ? "sudo " : ""}apt-get install -y ffmpeg`;

      for (const [id, label, found] of [
        ["python", "Python 运行时", probed.python],
        ["ffmpeg", "ffmpeg", probed.ffmpeg],
      ]) {
        const searched = found?.searched ?? [];
        const foundOk = found?.ok === true;
        entries.push({
          id,
          label,
          status: foundOk ? "ok" : "missing",
          path: found?.path ?? null,
          source: found?.source ?? null,
          searched,
          version: found?.version ?? null,
          detail: foundOk
            ? `已解析到 ${found.path}${found.version === undefined ? "" : `（${found.version}）`}`
            : `未找到可执行的 ${id === "python" ? "Python 解释器" : "ffmpeg"}；已查找：${
                searched.length === 0 ? "未配置任何候选路径" : searched.join("、")
              }`,
          // 每一项都要给出「下一步做什么」，而不是只报「没有」（spec：缺失项必须可操作）。
          hint: foundOk
            ? null
            : id === "python"
              ? `任选其一：① 在插件配置里指定 pythonExecutable；② 运行 ${bootstrap} --groups core 建立受控运行时；③ 把解释器放进 PATH 或 ~/.local/bin（这两处插件都会自动查找）。`
              : `ffmpeg 只能由系统提供，插件不自动安装：Debian/Ubuntu 用 ${installFfmpeg}，macOS 用 brew install ffmpeg；没有包管理器权限时，可把静态构建放到 ~/.local/bin/ffmpeg（插件会自动查找），或在插件配置里指定 ffmpegExecutable。缺它只影响视频与音频合成，其余区域照常可用。`,
        });
      }

      // 扫码登录与跨平台发布都是「宿主起子进程、脚本自己开浏览器/上传」的形态：解释器
      // 在不在只是第一步，脚本真正 import 的包也得在。分开报一项，是因为缺包时面板里
      // 只会看到脚本原样抛出的 ModuleNotFoundError，用户无从判断该装什么。
      //
      // 分两级：`playwright` 是扫码登录与六个平台发布的必经之路，缺它只能报 missing；
      // 引导脚本 `publish` 组里的其余包只影响 B 站上传与资讯类技能，缺了报 degraded，
      // 避免把「工作台基本可用」误判成不可用。
      const pythonPath = probed.python?.path ?? null;
      const packages =
        pythonPath === null
          ? { ok: false, missing: [...PUBLISH_PACKAGE_NAMES], error: "no-python" }
          : await probePackages({ subprocess, pythonPath, cwd: runtime.easelRoot ?? process.cwd() }).catch((error) => ({
              ok: false,
              missing: [...PUBLISH_PACKAGE_NAMES],
              error: String(error?.message ?? error),
            }));
      const missingPackages = packages.missing ?? [];
      const missingLoginPackages = missingPackages.filter((name) => LOGIN_REQUIRED_PACKAGES.includes(name));
      const status =
        pythonPath === null || missingLoginPackages.length > 0
          ? "missing"
          : missingPackages.length > 0
            ? "degraded"
            : "ok";
      entries.push({
        id: "publish-deps",
        label: "发布与登录依赖",
        status,
        path: pythonPath,
        missing: missingPackages,
        detail:
          pythonPath === null
            ? "未解析到 Python 运行时，无法探测发布与登录依赖；先按上一条把 Python 准备好。"
            : status === "ok"
              ? `扫码登录与发布所需的包都可导入：${PUBLISH_PACKAGE_NAMES.join("、")}。`
              : status === "missing"
                ? `扫码登录必需的包无法导入：${missingLoginPackages.join("、")}；缺它时点「扫码登录」或「发布」会在脚本启动时报 ModuleNotFoundError。`
                : `登录与多数平台发布可用；还缺 ${missingPackages.join("、")}，只影响 B 站上传与资讯类技能。`,
        hint:
          status === "ok"
            ? null
            : pythonPath === null
              ? "先按「Python 运行时」一条把解释器准备好，再回来复检这一项。"
              : status === "missing"
                ? `运行 ${bootstrap} --groups core,publish 补齐（网络慢时给 pip 指定镜像，例如 PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple）；playwright 还需要浏览器内核，若 ~/.cache/ms-playwright 下已有 chromium 就无需再装。`
                : `运行 ${bootstrap} --groups core,publish 可补齐这些包；其中 B 站上传用的是 biliup 命令行，直接下载官方 release 的二进制放进 PATH 或 ~/.local/bin 同样可用（其余平台不受影响）。`,
      });

      // 「playwright 能 import」不等于「浏览器能启动」：精简发行版里内核依赖的系统
      // 共享库是另一件事，缺了它脚本照样起得来、浏览器却秒退。这一项真的启动一次内核。
      const depsPrefix = browserDepsPrefix(runtime.runtimeDir);
      const depsInstalled = browserDepsInstalled(depsPrefix);
      const browser = await probeBrowser(subprocess, {
        runtimeDir: runtime.runtimeDir,
        cwd: runtime.easelRoot ?? process.cwd(),
      }).catch((error) => ({
        binary: null,
        launched: false,
        exitCode: null,
        version: null,
        output: String(error?.message ?? error),
        reason: "probe-failed",
        env: {},
      }));
      const browserScript = join(runtime.packageRoot ?? ".", "scripts", "install-browser-deps.mjs");
      const browserStatus = browser.launched ? "ok" : browser.binary === null ? "missing" : "degraded";
      entries.push({
        id: "browser-launch",
        label: "浏览器内核（扫码登录用）",
        status: browserStatus,
        path: browser.binary,
        version: browser.version,
        exitCode: browser.exitCode,
        libraryPath: browser.env?.LD_LIBRARY_PATH ?? "",
        detail:
          browserStatus === "ok"
            ? `真的启动了一次内核：Chromium ${browser.version ?? "(版本未识别)"} 可执行（${browser.binary}）。${
                depsInstalled ? `共享库来自免 root 解包目录：${depsPrefix}。` : ""
              }`
            : browserStatus === "missing"
              ? "没有找到 Chromium 内核；点「扫码登录」或需要浏览器的发布会直接失败。"
              : `找到内核（${browser.binary}）但它启动失败（退出码 ${String(browser.exitCode)}）：${
                  browser.output === "" ? "没有任何输出。" : browser.output
                } 常见原因是精简发行版缺 Chromium 依赖的系统共享库（免 root 也能补齐）。`,
        hint:
          browserStatus === "ok"
            ? null
            : browserStatus === "missing"
              ? `运行 ${bootstrap} --groups core,publish 装上 playwright 与内核（playwright install chromium）。`
              : `在非 root 环境运行 \`node ${browserScript}\`：它先报告缺哪些系统库，再把这些库下载解包到 ${depsPrefix}，宿主进程会自动把它们接进登录/发布子进程的 LD_LIBRARY_PATH。加 --check 可只看诊断、不下载。`,
      });

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
        hint: repoInfo.isDirectory
          ? null
          : "在插件配置里设置 repoRoot，或把 Easel 检出放在 <工作区>/_repo；未定位数据根时工作台仍能打开，但画像、选题与产物列表都会是空的。",
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
        hint: runtimeInfo.exists
          ? null
          : `运行 ${bootstrap} --groups core 建立受控运行时（含 venv）；也可以把 runtimeDir 配置指向已有的运行时目录，插件不会自动安装任何东西。`,
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
      const skillRootsOk = skillRoots.length > 0 && skillRoots.every((root) => root.isDirectory);
      entries.push({
        id: "skill-roots",
        label: "Easel 技能根",
        status: skillRootsOk ? "ok" : skillRoots.length === 0 ? "degraded" : "missing",
        detail:
          skillRoots.length === 0
            ? "未配置任何技能根，Easel 技能不会出现在 DSH 技能目录中。"
            : skillRoots
                .map((root) => `${root.configured}${root.isDirectory ? "" : "（不存在）"}`)
                .join("、"),
        hint: skillRootsOk
          ? null
          : "在配置 skillDirs 里给出技能根（相对路径以 Easel 数据根为基准）；目录名与 SKILL.md frontmatter 的 name 不一致时，会以 frontmatter 的 name 呈现。",
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
        hint: loginOutsideRepo
          ? null
          : "把 loginStateDir 指到仓库之外的目录（默认已是 ~/dsh-easel/login）；插件不会把登录态写进仓库。",
      });

      const capabilities = {
        subprocess: typeof subprocess?.spawn === "function",
        agents: typeof serviceOf(ctx, "agents")?.create === "function",
        resume: typeof serviceOf(ctx, "agents")?.resume === "function",
        attachments: typeof serviceOf(ctx, "attachments")?.saveFile === "function",
        agentPresets: typeof serviceOf(ctx, "agentPresets")?.register === "function",
        agentDefaultModel: typeof serviceOf(ctx, "agentDefaultModel")?.currentSelection === "function",
        schedule: typeof serviceOf(ctx, "schedule")?.create === "function",
        webServer: typeof serviceOf(ctx, "webServer")?.register === "function",
        tools: typeof serviceOf(ctx, "tools")?.register === "function",
        toolGuard: typeof serviceOf(ctx, "tools")?.guard === "function",
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
        hint:
          unavailable.length === 0
            ? null
            : "这些能力由宿主半边提供：若整个面板都在报「宿主服务未挂载」，说明插件尚未加载，重载或重启 DSH 后重试。",
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
            ? `${UPSTREAM_READ_ONLY_PREFIXES.join("、")} 始终只读；本次运行没有发生越界写入。`
            : `本次运行已拦下 ${blockedWrites.length} 次越界写入：${blockedWrites
                .map((entry) => `${entry.path}（${entry.operation}）`)
                .join("、")}`,
        hint:
          blockedWrites.length === 0
            ? null
            : `这些写入已被拒绝且没有落盘；需要产出的内容请写到 outputs/ 等可写目录，${UPSTREAM_READ_ONLY_PREFIXES.join("、")} 始终只读。`,
      });

      entries.push({
        id: "catalog",
        label: "技能目录长度限制",
        status: "ok",
        maxLength: runtime.catalogDescriptionMaxLength,
        detail: `技能目录中每条描述最多 ${runtime.catalogDescriptionMaxLength} 个字符，超出部分会被截断。`,
        hint: null,
      });

      entries.push({
        id: "model-routing",
        label: "模型路由",
        status: "ok",
        detail: "工作台不定义、不存储模型凭据；模型与推理强度一律沿用 DSH 会话的选择。",
        hint: null,
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
