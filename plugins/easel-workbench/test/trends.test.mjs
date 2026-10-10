/**
 * 热点线索的测试。
 *
 * spec `creator-planning` 的三条硬约束：永不虚构条目、逐源报告失败、全部失败时
 * 返回失败说明而不是空列表。另外「看热点不改变状态」——本模块不缓存、不落盘。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  TREND_ITEM_LIMIT,
  TREND_SOURCES,
  TREND_TIMEOUT_MS,
  createTrendsService,
  parseTrendPayload,
} from "../lib/host/trends.js";

/** 造一个假的 fetch 响应。 */
function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

/** 依次返回预置结果的假 fetch，记录请求过的 URL。 */
function fakeFetch(queue) {
  const seen = [];
  return {
    seen,
    async fetchImpl(url) {
      seen.push(url);
      const next = queue.shift();
      if (next === undefined) throw new Error(`没有预置响应：${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function service(queue, extra = {}) {
  const fake = fakeFetch(queue);
  return { fake, trends: createTrendsService({ fetchImpl: fake.fetchImpl, ...extra }) };
}

describe("数据源清单", () => {
  it("与既有 web 端保持一致：六个平台，各有主源", () => {
    assert.deepEqual(
      TREND_SOURCES.map((source) => source.id),
      ["weibo", "douyin", "zhihu", "bilibili", "baidu", "toutiao"],
    );
    for (const source of TREND_SOURCES) {
      assert.equal(typeof source.primary, "string");
      assert.equal(source.primary.startsWith("https://"), true);
    }
    assert.equal(TREND_SOURCES.find((source) => source.id === "zhihu").backup, null);
    assert.equal(TREND_SOURCES.find((source) => source.id === "toutiao").backup, null);
    assert.equal(TREND_SOURCES.find((source) => source.id === "weibo").backup.startsWith("https://"), true);
  });

  it("sources() 只暴露标注所需字段，超时可注入", async () => {
    const { trends } = service([]);
    const list = trends.sources();
    assert.equal(list.length, TREND_SOURCES.length);
    assert.deepEqual(Object.keys(list[0]).sort(), ["backup", "id", "label", "primary"]);
    assert.equal(TREND_TIMEOUT_MS, 12000);
  });
});

describe("parseTrendPayload", () => {
  it("接受顶层数组、{data:[…]} 与 {data:{data:[…]}} 三种形状", () => {
    const rows = [{ title: "第一条" }, { title: "第二条" }];
    for (const payload of [rows, { data: rows }, { data: { data: rows } }, { list: rows }, { result: rows }]) {
      assert.deepEqual(
        parseTrendPayload(payload).map((item) => item.title),
        ["第一条", "第二条"],
      );
    }
  });

  it("标题字段兼容 title/name/word/query", () => {
    const items = parseTrendPayload([
      { title: "a" },
      { name: "b" },
      { word: "c" },
      { query: "d" },
      { title: "  e  " },
    ]);
    assert.deepEqual(items.map((item) => item.title), ["a", "b", "c", "d", "e"]);
  });

  it("热度只在能转成数字时给出，否则为 null；不伪造 0", () => {
    const items = parseTrendPayload([
      { title: "a", hot: 12345 },
      { title: "b", hot: "6789" },
      { title: "c", hotValue: 42 },
      { title: "d", heat: "很热" },
      { title: "e" },
    ]);
    assert.deepEqual(items.map((item) => item.hot), [12345, 6789, 42, null, null]);
  });

  it("链接字段兼容 url/link/mobilUrl，缺失则为 null", () => {
    const items = parseTrendPayload([
      { title: "a", url: " https://x/1 " },
      { title: "b", link: "https://x/2" },
      { title: "c", mobilUrl: "https://x/3" },
      { title: "d" },
    ]);
    assert.deepEqual(items.map((item) => item.url), ["https://x/1", "https://x/2", "https://x/3", null]);
  });

  it("跳过非对象行与空标题，不猜不补", () => {
    const items = parseTrendPayload([null, 42, "字符串", { title: "   " }, { name: "" }, { title: "有效" }]);
    assert.deepEqual(items.map((item) => item.title), ["有效"]);
  });

  it("解析不出条目时返回空数组（由调用方记为失败）", () => {
    for (const payload of [null, undefined, "字符串", 42, {}, { data: [] }, { data: { other: 1 } }]) {
      assert.deepEqual(parseTrendPayload(payload), []);
    }
  });

  it("条目数受上限约束", () => {
    const rows = Array.from({ length: TREND_ITEM_LIMIT + 20 }, (_, index) => ({ title: `第${String(index)}条` }));
    assert.equal(parseTrendPayload({ data: rows }).length, TREND_ITEM_LIMIT);
  });
});

describe("createTrendsService.read", () => {
  it("主源可用时标注来源与条数", async () => {
    const { fake, trends } = service([response({ data: [{ title: "微博热搜一", hot: 1 }] })]);
    const result = await trends.read({ ids: ["weibo"] });
    assert.equal(result.ok, true);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].degraded, false);
    assert.equal(result.sources[0].origin, TREND_SOURCES[0].primary);
    assert.deepEqual(result.items.map((item) => item.source), ["weibo"]);
    assert.equal(result.items[0].label, "微博");
    assert.deepEqual(result.failures, []);
    assert.equal(result.note, null);
    assert.equal(typeof result.fetchedAt, "string");
    assert.deepEqual(fake.seen, [TREND_SOURCES[0].primary]);
  });

  it("主源失败时降级到备源，并标记 degraded", async () => {
    const { fake, trends } = service([
      response("", { ok: false, status: 503 }),
      response([{ title: "备源条目" }]),
    ]);
    const result = await trends.read({ ids: ["weibo"] });
    assert.equal(result.ok, true);
    assert.equal(result.sources[0].degraded, true);
    assert.equal(result.sources[0].origin, TREND_SOURCES[0].backup);
    assert.deepEqual(result.sources[0].attempts, [{ url: TREND_SOURCES[0].primary, reason: "HTTP 503" }]);
    assert.equal(result.failures.length, 0);
    assert.deepEqual(fake.seen, [TREND_SOURCES[0].primary, TREND_SOURCES[0].backup]);
  });

  it("无备源的平台（知乎）失败即记为失败，不编条目", async () => {
    const { trends } = service([response({ data: [] })]);
    const result = await trends.read({ ids: ["zhihu"] });
    assert.equal(result.ok, false);
    assert.deepEqual(result.items, []);
    assert.equal(result.sources[0].ok, false);
    assert.equal(result.sources[0].reason.includes("没有可识别"), true);
    assert.equal(result.failures.length, 1);
    assert.equal(result.note.includes("知乎"), true);
  });

  it("全部来源失败时 ok=false、带 failures 与可读说明，而不是空列表", async () => {
    const queue = [];
    for (const source of TREND_SOURCES) {
      queue.push(response("{}"));
      if (source.backup !== null) queue.push(response("{}"));
    }
    const { trends } = service(queue);
    const result = await trends.read();
    assert.equal(result.ok, false);
    assert.deepEqual(result.items, []);
    assert.equal(result.failures.length, TREND_SOURCES.length);
    assert.equal(result.note.startsWith("全部来源都不可用："), true);
    for (const source of TREND_SOURCES) {
      assert.equal(result.note.includes(source.label), true, `说明里应点名 ${source.label}`);
    }
  });

  it("逐源报告：单源失败不影响其它源", async () => {
    const { trends } = service([
      response({ data: [{ title: "微博一" }] }),
      response({ data: [{ title: "知乎一" }] }),
      response("not json"),
      response("{}"),
    ]);
    const result = await trends.read({ ids: ["weibo", "zhihu", "baidu"] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.items.map((item) => item.title), ["微博一", "知乎一"]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].source, "baidu");
    // 百度有备源，两次尝试都失败才记为失败，且原因逐条留痕
    assert.equal(result.failures[0].attempts.length, 2);
    assert.equal(result.note, "部分来源不可用（1 个），其余来源正常。");
  });

  it("失败原因分类清楚：超时 / 非 JSON / 空响应 / 网络异常", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const cases = [
      [abort, "读取超时。"],
      [response("not json"), "响应不是可解析的 JSON。"],
      [response("   "), "响应为空。"],
      [new Error("socket hang up"), "读取失败：socket hang up"],
    ];
    for (const [thrown, expected] of cases) {
      const { trends } = service([thrown]);
      const result = await trends.read({ ids: ["zhihu"] });
      assert.equal(result.sources[0].reason.includes(expected), true, `期望包含：${expected}`);
    }
  });

  it("运行环境没有 HTTP 能力时给出可读原因", async () => {
    const trends = createTrendsService({ fetchImpl: undefined });
    const result = await trends.read({ ids: ["zhihu"] });
    assert.equal(result.ok, false);
    assert.equal(result.sources[0].reason.includes("没有可用的 HTTP 读取能力"), true);
  });

  it("超时可注入（测试用短超时不会挂住）", async () => {
    const trends = createTrendsService({
      timeoutMs: 5,
      fetchImpl: (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });
    const result = await trends.read({ ids: ["zhihu"] });
    assert.equal(result.sources[0].reason.includes("读取超时"), true);
  });
});

describe("查看热点不改变状态（防回归）", () => {
  it("trends.js 不落盘、不缓存、不开子进程", async () => {
    const source = await readFile(new URL("../lib/host/trends.js", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of [/writeFile/, /node:fs/, /child_process/, /setInterval/, /globalThis\.__cache/]) {
      assert.equal(pattern.test(code), false, `trends.js 不应出现 ${String(pattern)}`);
    }
  });
});
