/**
 * 工作台的 HTTP 接口面。
 *
 * 设计取舍：宿主半边用 `ctx.webServer.register()` 注册原生 HTTP 路由，客户端半边
 * 只用浏览器自带 `fetch` 取 JSON。这样客户端不需要引入任何 DSH 客户端包，
 * 也不需要 typert/Remote 通道（spec `creator-workbench-ui` / `workbench-task-dispatch`）。
 *
 * 这里**不提供上传接口**：素材进入会话由 DSH 附件能力承担，宿主侧只负责把
 * 已在仓库内的文件读出来（预览/下载/作为附件投递），不接收浏览器上传。
 *
 * @module easel-workbench/host/web
 */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { EaselError, ERROR_CODES, attempt } from "./errors.js";
import { serviceOf } from "./services.js";

/** 路由前缀。 */
export const API_PREFIX = "/easel-workbench/api";

/** JSON 请求体的上限（防止超大 body 拖垮宿主）。 */
export const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;

/** 错误码 → HTTP 状态。 */
const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.INVALID_INPUT]: 400,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.PATH_OUT_OF_SCOPE]: 403,
  [ERROR_CODES.UPSTREAM_READ_ONLY]: 403,
  [ERROR_CODES.CONTENT_GUARD_BLOCKED]: 422,
  [ERROR_CODES.AUTH_EXPIRED]: 401,
  [ERROR_CODES.NOT_CONFIGURED]: 501,
  [ERROR_CODES.RUNTIME_MISSING]: 501,
  [ERROR_CODES.SOURCE_UNAVAILABLE]: 503,
  [ERROR_CODES.PUBLISH_FAILED]: 502,
  [ERROR_CODES.NO_AGENT]: 409,
});

const CONTENT_TYPES = Object.freeze({
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
});

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendError(res, error) {
  if (error instanceof EaselError) {
    sendJson(res, STATUS_BY_CODE[error.code] ?? 500, {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    });
    return;
  }
  sendJson(res, 500, {
    ok: false,
    code: "internal-error",
    message: `工作台内部错误：${error?.message ?? error}`,
    details: null,
  });
}

/** 读取并解析 JSON 请求体。 */
export function readJsonBody(req, limit = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new EaselError(ERROR_CODES.INVALID_INPUT, `请求体超过 ${limit} 字节上限。`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", (error) => reject(error));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new EaselError(ERROR_CODES.INVALID_INPUT, "请求体必须是 JSON 对象。"));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new EaselError(ERROR_CODES.INVALID_INPUT, `请求体不是合法 JSON：${error.message}`));
      }
    });
  });
}

/**
 * 极简路由器：`use(method, pattern, handler)`，`pattern` 用 `:name` 占位。
 * 只支持我们自己的固定几条路由，不引入依赖。
 */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    routes.push({
      method,
      segments: pattern.split("/").filter((part) => part !== ""),
      handler,
    });
  };
  const router = {
    use: add,
    get: (pattern, handler) => add("GET", pattern, handler),
    post: (pattern, handler) => add("POST", pattern, handler),
    patch: (pattern, handler) => add("PATCH", pattern, handler),
    put: (pattern, handler) => add("PUT", pattern, handler),
    delete: (pattern, handler) => add("DELETE", pattern, handler),
    match(method, pathname) {
      const segments = pathname.split("/").filter((part) => part !== "");
      for (const route of routes) {
        if (route.method !== method) continue;
        if (route.segments.length !== segments.length) continue;
        const params = {};
        let ok = true;
        for (let index = 0; index < route.segments.length; index += 1) {
          const expected = route.segments[index];
          const actual = decodeURIComponent(segments[index]);
          if (expected.startsWith(":")) {
            params[expected.slice(1)] = actual;
          } else if (expected !== actual) {
            ok = false;
            break;
          }
        }
        if (ok) return { handler: route.handler, params };
      }
      return undefined;
    },
  };
  return router;
}

/**
 * 把挂载前缀从路径上剥掉，得到路由表内的相对路径。
 *
 * 必须剥：`ctx.webServer.register({kind:"prefix"})` 只做前缀匹配，**不会改写 `req.url`**
 * （`dsh-host-webserver/lib/index.js:232-234` 把原始 req 原样交给 handler），
 * 而本模块的路由表是按相对路径注册的（`/config`、`/topics`…）。
 *
 * @param {string} pathname
 */
function relativeToMount(pathname) {
  if (pathname === API_PREFIX) return "/";
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return pathname;
}

/**
 * 建立 HTTP 接口。
 *
 * @param {{
 *   ctx: Record<string, any>,
 *   runtime: Record<string, any>,
 *   paths: Record<string, any>,
 *   data: Record<string, any>,
 *   accounts: Record<string, any>,
 *   publish: Record<string, any>,
 *   trends: Record<string, any>,
 *   schedule: Record<string, any>,
 *   dispatch: Record<string, any>,
 *   selfcheck: Record<string, any>,
 *   persona: Record<string, any>,
 *   sessions?: { list: Function, resolve: Function },
 * }} deps
 */
export function createWebService(deps) {
  const {
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
    sessions,
  } = deps;

  const router = createRouter();

  router.get("/config", async () => ({
    easelRoot: runtime.easelRoot,
    repoRoot: runtime.repoRoot,
    packageRoot: runtime.packageRoot,
    runtimeDir: runtime.runtimeDir,
    profilesDir: runtime.profilesDir,
    outputsDir: runtime.outputsDir,
    loginStateDir: runtime.loginStateDir,
    topicsFile: runtime.topicsFile,
    scheduleFile: runtime.scheduleFile,
    skillDirs: runtime.skillDirs,
    catalogDescriptionMaxLength: runtime.catalogDescriptionMaxLength,
    taskDispatchTarget: runtime.taskDispatchTarget,
    personaSource: runtime.personaSource,
    rulesSource: runtime.rulesSource,
    presetsAvailable: typeof serviceOf(ctx, "agentPresets")?.register === "function",
  }));

  router.get("/selfcheck", async () => selfcheck.run());

  router.get("/persona", async () => persona.describe());

  router.get("/overview", async () => {
    const checked = await selfcheck.run();
    const [profiles, projects, topics, entries, accountStates] = await Promise.all([
      attempt(() => data.listProfiles()),
      attempt(() => data.listProjects()),
      attempt(() => data.listTopics()),
      attempt(() => schedule.list()),
      attempt(() => accounts.statusAll()),
    ]);
    return {
      ready: checked.ready,
      missing: checked.missing,
      degraded: checked.degraded,
      profileCount: profiles.ok ? profiles.value.profiles.length : 0,
      projectCount: projects.ok ? projects.value.projects.length : 0,
      topicCount: topics.ok ? topics.value.topics.length : 0,
      scheduledCount: entries.ok ? entries.value.items.length : 0,
      accounts: accountStates.ok
        ? accountStates.value.map((entry) => ({ platform: entry.platform, label: entry.label, state: entry.state }))
        : [],
      errors: [
        ["profiles", profiles],
        ["projects", projects],
        ["topics", topics],
        ["schedule", entries],
        ["accounts", accountStates],
      ]
        .filter(([, result]) => result.ok === false)
        .map(([area, result]) => ({ area, code: result.code, message: result.message })),
      dispatchTarget: runtime.taskDispatchTarget,
    };
  });

  router.get("/profiles", async () => data.listProfiles());
  router.post("/profiles", async (request) => data.createProfile(request.body.name));
  router.get("/profiles/:name", async (request) => data.readProfile(request.params.name));
  router.put("/profiles/:name/dimensions/:dimension", async (request) =>
    data.writeProfileDimension(request.params.name, request.params.dimension, request.body.text),
  );

  router.get("/projects", async () => data.listProjects());
  router.get("/projects/:topic", async (request) => data.listProjectFiles(request.params.topic));

  router.get("/topics", async () => data.listTopics());
  // 单条写操作统一回 {topic}，与 GET /topics 的 {topics} 对齐，客户端只认一种取法。
  router.post("/topics", async (request) => ({ topic: await data.addTopic(request.body) }));
  router.patch("/topics/:id", async (request) => ({ topic: await data.updateTopic(request.params.id, request.body) }));
  router.delete("/topics/:id", async (request) => data.removeTopic(request.params.id));

  router.get("/trends", async (request) => {
    const ids = typeof request.query.get === "function" ? request.query.get("ids") : null;
    return trends.read({ ids: ids ? ids.split(",").map((id) => id.trim()).filter(Boolean) : undefined });
  });

  // 包一层具名字段：接口统一回对象，不把数组直接摊进顶层（否则 {ok,...arr} 会变成 {"0":…}）。
  router.get("/accounts", async () => ({ accounts: await accounts.statusAll() }));
  router.get("/accounts/:id", async (request) => accounts.status(request.params.id));
  router.get("/accounts/:id/stats", async (request) => accounts.stats(request.params.id));
  router.post("/accounts/:id/verify", async (request) => accounts.verify(request.params.id));
  router.post("/accounts/:id/login-plan", async (request) => accounts.loginPlan(request.params.id));

  /**
   * 扫码登录闭环：启动 → 轮询状态 → 取二维码 → 回填短信码 → 取消。
   *
   * 二维码是 PNG 二进制响应，走与 `/files` 相同的先例（`handle()` 在
   * `res.headersSent` 之后不再包 JSON）。插件不接触凭据：它只是把用户
   * 本该自己在终端跑的那条登录命令变成一次点击。
   */
  router.post("/accounts/:id/login", async (request) => accounts.startLogin(request.params.id));
  router.get("/accounts/:id/login/status", async (request) => accounts.loginStatus(request.params.id));
  router.delete("/accounts/:id/login", async (request) => accounts.cancelLogin(request.params.id));
  router.post("/accounts/:id/login/sms", async (request) =>
    accounts.submitSmsCode(request.params.id, request.body?.code),
  );
  router.get("/accounts/:id/qr", async (request, res) => {
    const info = await accounts.qrImage(request.params.id);
    const data = await readFile(info.path);
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(data.byteLength),
      "cache-control": "no-store",
    });
    res.end(data);
  });

  router.get("/publish/platforms", async () => ({ platforms: publish.listPlatforms() }));
  router.get("/publish/history", async (request) => {
    const raw = request.query.get?.("limit");
    const limit = raw === null || raw === undefined ? undefined : Number.parseInt(raw, 10);
    return publish.history(Number.isFinite(limit) ? limit : undefined);
  });
  router.post("/publish/preview", async (request) => publish.preview(request.body));
  router.post("/publish/execute", async (request) => publish.publish(request.body));

  router.get("/schedule", async () => schedule.list());
  router.post("/schedule", async (request) => schedule.create(request.body));
  router.delete("/schedule/:id", async (request) => schedule.remove(request.body ?? { id: request.params.id }));

  router.get("/sessions", async () => {
    if (sessions === undefined) {
      throw new EaselError(ERROR_CODES.NOT_CONFIGURED, "当前 DSH 未提供会话注册表，无法列出可投递的会话。");
    }
    return sessions.list();
  });
  router.post("/dispatch", async (request) => dispatch.dispatch(request.body));

  /**
   * 内容库文件读取：预览与下载走同一条路由，靠 `?download=1` 切换处置方式。
   *
   * 只读、限定在仓库内、拒绝只读上游前缀之外的越界路径。
   */
  router.get("/files", async (request, res) => {
    const relativePath = request.query.get?.("path") ?? "";
    if (relativePath === "") {
      throw new EaselError(ERROR_CODES.INVALID_INPUT, "缺少 path 参数。");
    }
    const absolute = paths.resolveInside(relativePath, "读取内容库文件");
    const info = await stat(absolute).catch(() => undefined);
    if (info === undefined || !info.isFile()) {
      throw new EaselError(ERROR_CODES.NOT_FOUND, `文件不存在：${relativePath}`);
    }
    const download = request.query.get?.("download") === "1";
    const headers = {
      "content-type": CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(info.size),
      "cache-control": "no-store",
    };
    if (download) {
      headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(relativePath.split("/").pop() ?? "file")}`;
    }
    res.writeHead(200, headers);
    createReadStream(absolute).pipe(res);
  });

  return {
    router,

    /** 统一的请求处理入口，注册给 `ctx.webServer`。 */
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const matched = router.match(req.method ?? "GET", relativeToMount(url.pathname));
      if (matched === undefined) {
        sendJson(res, 404, { ok: false, code: "not-found", message: `未知接口：${req.method} ${url.pathname}` });
        return;
      }
      const query = url.searchParams;
      const request = { params: matched.params, query, body: {}, method: req.method };
      try {
        if (req.method !== "GET" && req.method !== "HEAD") {
          request.body = await readJsonBody(req);
        }
        const payload = await matched.handler(request, res);
        if (res.writableEnded || res.headersSent) return;
        sendJson(res, 200, { ok: true, ...(payload ?? {}) });
      } catch (error) {
        if (res.writableEnded || res.headersSent) return;
        sendError(res, error);
      }
    },

    /** 注册到 webServer；返回注销函数。 */
    register() {
      const webServer = serviceOf(ctx, "webServer");
      if (typeof webServer?.register !== "function") return undefined;
      return webServer.register({
        kind: "prefix",
        path: API_PREFIX,
        handler: (req, res) => this.handle(req, res),
      });
    },
  };
}
