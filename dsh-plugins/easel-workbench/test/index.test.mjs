/**
 * 插件入口 `lib/index.js` 的集成测试。
 *
 * 这一层此前没有任何测试，因此「`package.json` 指向 `lib/index.js`、而入口实际躺在包根」
 * 这种断链一直没被发现——宿主解析到的会是一个不存在的文件。这里用假 `ctx` 走一遍
 * `apply()`，再用假的 HTTP 请求/响应验证注册进去的前缀路由确实能取到数据。
 *
 * 断言的都是「接线」而非业务逻辑：业务逻辑由各自的模块测试覆盖。
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { apply, inject, name, SERVICE_NAME, WORKBENCH_API_PREFIX, WORKBENCH_PANEL_ID } from "../lib/index.js";

/** 造一个「工作区形态」的仓库：`_repo/`（数据根）+ `dsh-plugins/`。 */
async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "easel-entry-"));
  const easelRoot = join(root, "_repo");
  await mkdir(join(easelRoot, "skills", "openclaw"), { recursive: true });
  await mkdir(join(easelRoot, "profiles", "_template"), { recursive: true });
  await mkdir(join(easelRoot, "outputs"), { recursive: true });
  await mkdir(join(root, "dsh-plugins"), { recursive: true });
  await writeFile(join(easelRoot, "pyproject.toml"), "[project]\nname = \"easel\"\n", "utf8");
  for (const dimension of ["identity", "style", "audience", "platforms", "preferences", "memory"]) {
    await writeFile(join(easelRoot, "profiles", "_template", `${dimension}.md`), `# ${dimension}\n`, "utf8");
  }
  return { root, easelRoot };
}

/**
 * 假 ctx：只实现入口用到的那几件事。
 *
 * `inject(names, cb)` 按名提供子 ctx；`effect(fn, label)` 立刻执行并收集 disposer，
 * 这样测试既能拿到注册进去的服务，也能验证卸载时会注销。
 */
function makeCtx(services = {}) {
  const registered = {
    prefixes: [],
    unregistered: [],
    guards: [],
    presetDefinitions: [],
    presetDisposed: 0,
    provided: new Map(),
    logs: [],
    scheduled: [],
  };

  const available = {
    webServer: {
      register(options) {
        registered.prefixes.push(options);
        return () => registered.unregistered.push(options.path);
      },
    },
    tools: {
      guard(fn) {
        registered.guards.push(fn);
        return () => {};
      },
    },
    agentPresets: {
      async register(definition) {
        registered.presetDefinitions.push(definition);
        return async () => {
          registered.presetDisposed += 1;
        };
      },
    },
    // DSH 的排期服务：`catalog` 返回当前会话可见的排期项，`create` 新建。
    schedule: {
      async catalog() {
        return registered.scheduled;
      },
      async create(_sessionId, request) {
        registered.scheduled.push({ id: `sched-${registered.scheduled.length + 1}`, ...request });
        return registered.scheduled.at(-1);
      },
      async delete({ id }) {
        registered.scheduled = registered.scheduled.filter((entry) => entry.id !== id);
      },
    },
    ...services,
  };

  const disposers = [];
  const ctx = {
    // 真实 cordis 里服务既可按名 `inject`，也可直接属性访问（`ctx.schedule`）；
    // 两处都提供，才能覆盖到模块里直接读属性的写法。
    ...available,
    logger: {
      warn: (message) => registered.logs.push(["warn", message]),
      info: (message) => registered.logs.push(["info", message]),
    },
    get: (key) => available[key],
    inject(names, callback) {
      const child = { ...ctx, ...Object.fromEntries(names.map((key) => [key, available[key]])) };
      return callback(child);
    },
    effect(fn, label) {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push({ label, dispose });
      return dispose;
    },
    provide(key, value) {
      registered.provided.set(key, value);
    },
  };

  return {
    ctx,
    registered,
    services: available,
    async teardown() {
      for (const entry of disposers.reverse()) await entry.dispose();
    },
  };
}

/** 轮询等待一个条件成立（异步注册用），超时即失败。 */
async function waitFor(predicate, { timeoutMs = 2000, stepMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  assert.fail("等待条件超时");
}

/** 造一对假的 req/res；GET 不需要 body。 */function makeExchange(method, path, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  const req = {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
    on(event, handler) {
      if (event === "data") for (const chunk of chunks) handler(chunk);
      if (event === "end") handler();
      return this;
    },
  };
  const res = {
    status: undefined,
    headers: undefined,
    payload: undefined,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(text) {
      this.payload = text === undefined ? undefined : JSON.parse(text);
      this.writableEnded = true;
    },
  };
  return { req, res };
}

/** 通过注册进去的前缀 handler 发一次请求，返回 `{status, body}`。 */
async function call(handler, method, path, body) {
  const { req, res } = makeExchange(method, path, body);
  await handler(req, res);
  return { status: res.status, body: res.payload };
}

test("入口元数据与 package.json 的声明一致", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(name, manifest.name);
  assert.equal(manifest.main, "lib/index.js", "package.json 的 main 必须指向真实存在的入口");
  assert.equal(manifest.exports["."], "./lib/index.js");
  assert.deepEqual(inject, []);
  assert.equal(WORKBENCH_PANEL_ID, "easel-workbench");
  assert.equal(WORKBENCH_API_PREFIX, "/easel-workbench/api");
});

test("apply 挂载工作台：提供服务、前缀接口、发布守卫与 preset", async (t) => {
  const workspace = await makeWorkspace();
  t.after(() => rm(workspace.root, { recursive: true, force: true }));

  const harness = makeCtx();
  apply(harness.ctx, { repoRoot: workspace.root });

  // 1) 宿主服务
  const service = harness.registered.provided.get(SERVICE_NAME);
  assert.ok(service, "必须通过 ctx.provide 暴露 ctx.easel");
  assert.equal(service.panelId, "easel-workbench");
  assert.equal(service.apiPrefix, "/easel-workbench/api");
  assert.equal(service.config.easelRoot, workspace.easelRoot);
  assert.equal(service.config.repoRoot, workspace.root);
  for (const key of ["data", "accounts", "publish", "trends", "schedule", "dispatch", "selfcheck", "persona", "sessions"]) {
    assert.ok(service[key], `服务面缺少 ${key}`);
  }

  // 2) HTTP 前缀注册
  assert.equal(harness.registered.prefixes.length, 1);
  assert.equal(harness.registered.prefixes[0].kind, "prefix");
  assert.equal(harness.registered.prefixes[0].path, "/easel-workbench/api");
  assert.equal(typeof harness.registered.prefixes[0].handler, "function");

  // 3) 发布门禁守卫
  assert.equal(harness.registered.guards.length, 1);
  const guard = harness.registered.guards[0];
  assert.equal(guard({ name: "bash", arguments: { command: "ls -la" } }), undefined);
  assert.match(
    guard({ name: "bash", arguments: { command: "python3 skills/openclaw/skill-cross-platform-publish/scripts/publish.py --exec" } }),
    /发布/,
  );

  // 4) preset 注册是异步的（要读两个随包资源），等它落地
  await waitFor(() => harness.registered.presetDefinitions.length === 1);
  assert.equal(harness.registered.presetDefinitions.length, 1);
  assert.equal(harness.registered.presetDefinitions[0].id, "easel");

  // 5) 日志说明数据根
  const info = harness.registered.logs.filter(([level]) => level === "info").map(([, message]) => message);
  assert.equal(info.some((message) => message.includes(workspace.easelRoot)), true);

  // 6) 卸载时注销 webServer 与 preset
  await harness.teardown();
  assert.deepEqual(harness.registered.unregistered, ["/easel-workbench/api"]);
  assert.equal(harness.registered.presetDisposed, 1);
});

test("前缀接口的读路由都能取到数据，未知路由返回 404", async (t) => {
  const workspace = await makeWorkspace();
  t.after(() => rm(workspace.root, { recursive: true, force: true }));
  await writeFile(
    join(workspace.easelRoot, "outputs", "_ideas.json"),
    `${JSON.stringify([{ id: "abc123", title: "已有选题", note: "", source: "", status: "pending", created: 1 }], null, 2)}\n`,
    "utf8",
  );

  const harness = makeCtx();
  apply(harness.ctx, { repoRoot: workspace.root });
  const handler = harness.registered.prefixes[0].handler;

  for (const path of [
    "/easel-workbench/api/config",
    "/easel-workbench/api/selfcheck",
    "/easel-workbench/api/overview",
    "/easel-workbench/api/profiles",
    "/easel-workbench/api/projects",
    "/easel-workbench/api/topics",
    "/easel-workbench/api/schedule",
    "/easel-workbench/api/sessions",
    "/easel-workbench/api/accounts",
    "/easel-workbench/api/publish/platforms",
  ]) {
    const { status, body } = await call(handler, "GET", path);
    assert.equal(status, 200, `${path} 应当返回 200，实际 ${status}：${JSON.stringify(body)}`);
    assert.equal(typeof body?.ok, "boolean", `${path} 的响应缺少 ok 字段`);
  }

  // overview 的计数来自真实文件，而不是「静默降级成 0」
  const overview = await call(handler, "GET", "/easel-workbench/api/overview");
  assert.equal(overview.body.topicCount, 1);

  const topics = await call(handler, "GET", "/easel-workbench/api/topics");
  assert.equal(topics.body.topics[0].title, "已有选题");

  // 集合类接口一律回具名字段，客户端不需要猜数组在哪里
  const accounts = await call(handler, "GET", "/easel-workbench/api/accounts");
  assert.equal(Array.isArray(accounts.body.accounts), true);
  const platforms = await call(handler, "GET", "/easel-workbench/api/publish/platforms");
  assert.equal(Array.isArray(platforms.body.platforms), true);
  assert.equal(platforms.body.platforms.length > 0, true);
  // 账号条目要能直接喂给面板（平台 id + 三态），不能只有内部字段
  for (const entry of accounts.body.accounts) {
    assert.equal(typeof entry.platform, "string");
    assert.equal(typeof entry.state, "string");
  }

  const missing = await call(handler, "GET", "/easel-workbench/api/nope");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "not-found");
});

test("写路由：新增选题会落盘，非法请求体返回可读错误码", async (t) => {
  const workspace = await makeWorkspace();
  t.after(() => rm(workspace.root, { recursive: true, force: true }));

  const harness = makeCtx();
  apply(harness.ctx, { repoRoot: workspace.root });
  const handler = harness.registered.prefixes[0].handler;

  const created = await call(handler, "POST", "/easel-workbench/api/topics", {
    title: "新选题",
    note: "备注",
    source: "手动",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.topic.title, "新选题");

  const onDisk = JSON.parse(await readFile(join(workspace.easelRoot, "outputs", "_ideas.json"), "utf8"));
  assert.equal(Array.isArray(onDisk), true, "既有格式是顶层数组");
  assert.equal(onDisk[0].title, "新选题");

  const bad = await call(handler, "POST", "/easel-workbench/api/topics", { title: "" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.code, "invalid-input");
});

test("未定位数据根时仍能挂载，只在日志与控制面里如实降级", async (t) => {
  const harness = makeCtx();
  // 显式配置指向一个「像插件包但不是仓库」的目录，且把推断来源也隔离掉：
  // 这里只能隔离 configured，模块 URL 仍指向本仓库，所以只断言不会抛错。
  apply(harness.ctx, { repoRoot: join(tmpdir(), "easel-definitely-absent") });
  const service = harness.registered.provided.get(SERVICE_NAME);
  assert.ok(service);
  const handler = harness.registered.prefixes[0].handler;
  const { status, body } = await call(handler, "GET", "/easel-workbench/api/selfcheck");
  assert.equal(status, 200);
  assert.equal(typeof body.ready, "boolean");
  await harness.teardown();
});
