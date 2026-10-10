/**
 * HTTP 接口面的测试。
 *
 * 关注两件在别处测不到的事：
 * - **路由接线**：客户端的每个按钮最终打到哪条路由、带上什么参数；
 * - **响应包装**：成功包 `{ok:true,...}`、错误按 `code` 映射状态码、未知路由 404，
 *   以及二维码这种二进制响应不会被 JSON 包装破坏。
 *
 * 用例只替换服务对象，不联网、不真跑 python。
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ERROR_CODES, EaselError } from "../lib/host/errors.js";
import { API_PREFIX, createWebService } from "../lib/host/web.js";

/** 假请求：`handle()` 只用到 `method`/`url` 与 `data`/`end` 事件。 */
function fakeRequest(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  // 写请求一定会被 `readJsonBody` 读取；即使没有 body 也要给出 `end`，
  // 否则 `handle()` 会永远等下去（真实 http 请求不会这样）。
  queueMicrotask(() => {
    if (body !== undefined) req.emit("data", Buffer.from(JSON.stringify(body), "utf8"));
    req.emit("end");
  });
  return req;
}

/** 假响应：记录状态码、响应头与写入的字节。 */
function fakeResponse() {
  const res = {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers;
      res.headersSent = true;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) res.body = Buffer.concat([res.body, Buffer.from(chunk)]);
      res.writableEnded = true;
    },
  };
  return res;
}

/** 建立接口面，`accounts` 全部换成记录调用的替身。 */
function makeWeb(accountOverrides = {}) {
  const calls = [];
  const record =
    (name, result) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof result === "function" ? result(...args) : result;
    };
  const accounts = {
    statusAll: record("statusAll", []),
    status: record("status", (id) => ({ platform: id })),
    stats: record("stats", (id) => ({ platform: id })),
    verify: record("verify", (id) => ({ platform: id })),
    loginPlan: record("loginPlan", (id) => ({ platform: id })),
    startLogin: record("startLogin", (id) => ({ started: true, platform: id })),
    loginStatus: record("loginStatus", (id) => ({ platform: id, rawState: "qr_ready" })),
    cancelLogin: record("cancelLogin", (id) => ({ platform: id, cancelled: true })),
    submitSmsCode: record("submitSmsCode", (id, code) => ({ platform: id, code })),
    qrImage: record("qrImage", () => {
      throw new EaselError(ERROR_CODES.NOT_FOUND, "二维码还没生成。");
    }),
    ...accountOverrides,
  };
  const noop = async () => ({});
  const web = createWebService({
    ctx: {},
    runtime: { easelRoot: "/easel", repoRoot: "/repo", packageRoot: "/pkg" },
    paths: { resolveInside: (p) => `/repo/${p}` },
    data: { projects: noop, project: noop, topics: noop, createTopic: noop, updateTopic: noop, removeTopic: noop },
    accounts,
    publish: { listPlatforms: noop, history: noop, preview: noop, publish: noop },
    trends: { read: noop },
    schedule: { list: noop, create: noop, remove: noop },
    calendar: { month: record("calendar.month", { month: "2026-08", from: "2026-07-27", to: "2026-09-06", count: 0, items: [] }) },
    dispatch: { dispatch: noop },
    selfcheck: { run: noop },
    persona: { read: noop },
    sessions: { list: noop, resolve: noop },
  });
  return { web, calls };
}

/** 走真实 `handle()`，返回状态码、响应头与响应体文本。 */
async function call(web, method, path, body) {
  const res = fakeResponse();
  await web.handle(fakeRequest(method, API_PREFIX + path, body), res);
  const text = res.body.toString("utf8");
  return { status: res.statusCode, headers: res.headers, text, body: res.body };
}

describe("扫码登录路由", () => {
  it("启动、轮询、取消、短信码四条 JSON 路由接到对应服务方法", async () => {
    const { web, calls } = makeWeb();

    const started = await call(web, "POST", "/accounts/douyin/login");
    assert.equal(started.status, 200);
    assert.deepEqual(JSON.parse(started.text), { ok: true, started: true, platform: "douyin" });

    const status = await call(web, "GET", "/accounts/douyin/login/status");
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.text).rawState, "qr_ready");

    const sms = await call(web, "POST", "/accounts/douyin/login/sms", { code: "1234" });
    assert.equal(sms.status, 200);
    assert.equal(JSON.parse(sms.text).code, "1234");

    const cancelled = await call(web, "DELETE", "/accounts/douyin/login");
    assert.equal(cancelled.status, 200);
    assert.equal(JSON.parse(cancelled.text).cancelled, true);

    assert.deepEqual(
      calls.map((entry) => entry.name),
      ["startLogin", "loginStatus", "submitSmsCode", "cancelLogin"],
    );
    assert.deepEqual(calls[2].args, ["douyin", "1234"]);
  });

  it("二维码是 PNG 二进制响应，不被 JSON 包装", async () => {
    const dir = await mkdtemp(join(tmpdir(), "easel-web-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const qrPath = join(dir, "douyin.png");
    await writeFile(qrPath, png);
    const { web } = makeWeb({ qrImage: async () => ({ path: qrPath, ready: true, bytes: png.length }) });

    const { status, headers, body } = await call(web, "GET", "/accounts/douyin/qr");
    assert.equal(status, 200);
    assert.equal(headers["content-type"], "image/png");
    assert.equal(headers["cache-control"], "no-store");
    assert.equal(body.equals(png), true);
  });

  it("二维码未就绪时按 NOT_FOUND 报错，不返回空 200", async () => {
    const { web } = makeWeb();
    const { status, text } = await call(web, "GET", "/accounts/xiaohongshu/qr");
    assert.equal(status, 404);
    const payload = JSON.parse(text);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, ERROR_CODES.NOT_FOUND);
  });

  it("未知路由回 404，服务抛错按 code 映射状态码", async () => {
    const { web } = makeWeb({
      startLogin: async () => {
        throw new EaselError(ERROR_CODES.INVALID_INPUT, "登录流程已经在运行。");
      },
    });
    const unknown = await call(web, "GET", "/accounts/douyin/nope");
    assert.equal(unknown.status, 404);
    assert.equal(JSON.parse(unknown.text).code, "not-found");

    const failed = await call(web, "POST", "/accounts/douyin/login");
    assert.equal(failed.status, 400);
    const payload = JSON.parse(failed.text);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, ERROR_CODES.INVALID_INPUT);
    assert.match(payload.message, /已经在运行/);
  });
});

describe("内容日历路由", () => {
  it("GET /calendar 把 month 原样交给服务；空串与缺省都表示「当月」", async () => {
    const { web, calls } = makeWeb();

    const explicit = await call(web, "GET", "/calendar?month=2026-08");
    assert.equal(explicit.status, 200);
    assert.equal(JSON.parse(explicit.text).ok, true);
    assert.equal(JSON.parse(explicit.text).month, "2026-08");
    assert.deepEqual(
      calls.filter((item) => item.name === "calendar.month").map((item) => item.args[0]),
      ["2026-08"],
    );

    await call(web, "GET", "/calendar");
    await call(web, "GET", "/calendar?month=");
    assert.deepEqual(
      calls.filter((item) => item.name === "calendar.month").map((item) => item.args[0]),
      ["2026-08", undefined, undefined],
      "缺省与空串都必须让宿主自己决定当月，而不是把空字符串塞进去",
    );
  });
});
