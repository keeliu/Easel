/**
 * Easel 自媒体工作台 —— 宿主半边入口。
 *
 * 这个 bundle 做四件事：
 * 1. 把 Easel 仓库里的既有资产（创作者画像、内容库、选题、排期、七平台账号与发布脚本）
 *    以只读优先的宿主服务暴露出来；
 * 2. 在侧边栏注册一个 `easel-workbench` 入口并承接 `main` 的同名键，渲染工作台面板
 *    （面板本体在客户端半边 `client.js`）；
 * 3. 用 `ctx.tools.guard()` 给「绕过工作台直接调用发布脚本」加一层确定性门禁；
 * 4. 在 DSH 提供 preset 能力时注册 `easel` agent preset（创作者人设 + 操作规则 + 技能提供方）。
 *
 * 插件**不**定义模型路由、**不**存储模型凭据、**不**自建会话、**不**自建调度器、
 * **不**自建技能注册表：这些一律复用 DSH 既有能力。
 *
 * @module easel-workbench
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Config,
  PANEL_ID,
  UPSTREAM_READ_ONLY_PREFIXES,
  resolveRuntimeConfig,
  venvPython,
} from "./host/config.js";
import { createAccountsService } from "./host/accounts.js";
import { createDataService } from "./host/data.js";
import { createDispatchService } from "./host/dispatch.js";
import { createGateService } from "./host/gate.js";
import { createPathPolicy } from "./host/paths.js";
import { createPersonaService } from "./host/persona.js";
import { createPublishService } from "./host/publish.js";
import { createScheduleService } from "./host/schedule.js";
import { createSelfcheckService } from "./host/selfcheck.js";
import { createSessionCatalog } from "./host/sessions.js";
import { createPublishGuard } from "./host/tools.js";
import { createTrendsService } from "./host/trends.js";
import { API_PREFIX, createWebService } from "./host/web.js";
import { locateExecutable, pathCandidates, PYTHON_NAMES, PYTHON_VERSIONED_NAMES } from "./host/runtime.js";

/** 宿主插件标识。 */
export const name = "easel-workbench";

/** 插件版本，随工作台「环境自检」一起呈现。 */
export const VERSION = "0.1.0";

/**
 * 依赖注入：本插件对宿主能力**全部按需注入**，不做硬依赖。
 *
 * 理由：Python/ffmpeg 缺失、甚至 DSH 未挂载排期或 preset 能力时，面板仍必须能打开
 * 并如实说明原因（spec `creator-skill-library`）；硬 `inject` 会让整插件加载失败。
 */
export const inject = [];

export { Config };

/**
 * 包根目录：入口是 `<包>/lib/index.js`，所以要向上一级才是包根
 * （`assets/`、`locale/`、`.runtime/`、`package.json` 都在那一级）。
 * 安装后插件通过符号链接加载，Node 会解析回真实路径。
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 宿主服务键：`ctx.easel`。 */
export const SERVICE_NAME = "easel";

/** 面板 id、侧边栏条目 id 与 `main` 键位共用的标识。 */
export const WORKBENCH_PANEL_ID = PANEL_ID;

/** 工作台 HTTP 接口前缀。 */
export const WORKBENCH_API_PREFIX = API_PREFIX;

/**
 * 组装并挂载工作台。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} rawConfig
 */
export function apply(ctx, rawConfig) {
  const parsed = Config(rawConfig ?? {});
  const runtime = resolveRuntimeConfig(parsed, {
    moduleUrl: import.meta.url,
    packageRoot: PACKAGE_ROOT,
    cwd: process.cwd(),
    assetsDir: join(PACKAGE_ROOT, "assets"),
  });
  const paths = createPathPolicy({
    repoRoot: runtime.easelRoot,
    readOnlyPrefixes: UPSTREAM_READ_ONLY_PREFIXES,
  });

  const warn = (message) => {
    if (typeof ctx?.logger?.warn === "function") ctx.logger.warn(`[easel-workbench] ${message}`);
  };
  const info = (message) => {
    if (typeof ctx?.logger?.info === "function") ctx.logger.info(`[easel-workbench] ${message}`);
  };

  /** 解析 Python 解释器：显式配置 → 受控 venv → PATH。 */
  const resolvePython = async () => {
    const candidates = [];
    if (typeof runtime.runtimeDir === "string") {
      candidates.push({ path: venvPython(runtime.runtimeDir), source: "runtime-venv" });
    }
    for (const path of pathCandidates([...PYTHON_NAMES, ...PYTHON_VERSIONED_NAMES])) {
      candidates.push({ path, source: "path" });
    }
    const located = await locateExecutable({
      configured: runtime.pythonExecutable,
      candidates,
    });
    return located.path;
  };

  const subprocess = ctx?.subprocess;
  const data = createDataService({ paths, runtime });
  const gate = createGateService({ runtime, subprocess, resolvePython });
  const persona = createPersonaService({ runtime });
  const trends = createTrendsService({});
  const publish = createPublishService({ runtime, subprocess, paths, gate, resolvePython });
  const accounts = createAccountsService({ runtime, subprocess, paths, resolvePython });
  const schedule = createScheduleService({ ctx });
  const dispatch = createDispatchService({ ctx, runtime, paths });
  const sessionCatalog = createSessionCatalog({ ctx });
  const selfcheck = createSelfcheckService({ ctx, runtime, paths });

  const web = createWebService({
    ctx,
    runtime,
    paths,
    data,
    accounts,
    publish,
    trends,
    schedule,
    dispatch,
    selfcheck,
    persona,
    sessions: sessionCatalog,
  });

  // 1) HTTP 接口面：客户端半边只用浏览器 fetch，不引入任何 DSH 客户端包。
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: "prefix",
          path: API_PREFIX,
          handler: (req, res) => web.handle(req, res),
        }),
      "easel-workbench: 工作台 HTTP 接口",
    );
  });

  // 2) 发布门禁守卫：模型绕过工作台直接调用发布脚本时同样被拦下。
  ctx.inject(["tools"], (toolsCtx) => {
    toolsCtx.effect(
      () => toolsCtx.tools.guard(createPublishGuard()),
      "easel-workbench: 发布门禁守卫",
    );
  });

  // 3) `easel` agent preset：人设只在该 preset 的 agent 作用域内挂载。
  //    preset 能力由 dsh-agent-preset-registry 提供；未挂载时如实降级。
  ctx.inject(["agentPresets"], (presetCtx) => {
    presetCtx.effect(() => {
      let released;
      let disposed = false;
      persona
        .preset()
        .then(({ definition, rulesValidation }) => {
          if (rulesValidation.ok === false) {
            warn(
              `操作规则段校验未通过：缺少 ${rulesValidation.missing.map((entry) => entry.label).join("、") || "无"}；` +
                `越界 ${rulesValidation.forbidden.map((entry) => entry.label).join("、") || "无"}`,
            );
          }
          return presetCtx.agentPresets.register(definition);
        })
        .then((dispose) => {
          if (disposed) {
            Promise.resolve(dispose()).catch(() => {});
            return;
          }
          released = dispose;
          info("已注册 agent preset「easel」。");
        })
        .catch((error) => {
          warn(`注册 agent preset「easel」失败：${error?.message ?? error}`);
        });
      return () => {
        disposed = true;
        return released === undefined ? undefined : released();
      };
    }, "easel-workbench: easel agent preset");
  });

  const service = {
    version: VERSION,
    panelId: PANEL_ID,
    apiPrefix: API_PREFIX,
    config: runtime,
    paths,
    data,
    accounts,
    publish,
    trends,
    schedule,
    dispatch,
    selfcheck,
    persona,
    sessions: sessionCatalog,
  };
  ctx.provide(SERVICE_NAME, service);

  if (runtime.easelRoot === undefined) {
    warn(
      "未定位到 Easel 数据根（skills/ 与 pyproject.toml 所在目录）；工作台会打开但所有数据区域会给出可读提示。",
    );
  } else {
    info(
      `工作台已挂载：数据根 ${runtime.easelRoot}，工作区 ${runtime.repoRoot ?? "(未定位)"}，接口 ${API_PREFIX}。`,
    );
  }
}
