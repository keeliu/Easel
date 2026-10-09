/**
 * 热点线索读取。
 *
 * 数据源不是插件臆造的，而是 Easel 仓库里既有的公开热榜接口清单
 * （`_repo/skills/shared/hotlist-apis.md`）：60s API 为主源、xxapi 为备源。
 * 这里**只做读取与降级**，不缓存、不落盘，因此「看热点」不会改变任何状态
 * （spec `creator-planning` 的「查看不改变状态」）。
 *
 * 三条硬约束：
 * - **永不虚构**：解析不出条目就记为失败，返回原因，绝不返回编造的条目；
 * - **逐源报告**：单源失败不影响其它源，失败原因按源列出；
 * - **全部失败时返回失败说明**而不是空列表。
 *
 * @module easel-workbench/host/trends
 */

/** 与 `_repo/web/app.py` 的 `TREND_SOURCES` 保持一致的主源 / 备源映射。 */
export const TREND_SOURCES = Object.freeze([
  {
    id: "weibo",
    label: "微博",
    primary: "https://60s.viki.moe/v2/weibo",
    backup: "https://v2.xxapi.cn/api/weibohot",
  },
  {
    id: "douyin",
    label: "抖音",
    primary: "https://60s.viki.moe/v2/douyin",
    backup: "https://v2.xxapi.cn/api/douyinhot",
  },
  {
    id: "zhihu",
    label: "知乎",
    primary: "https://60s.viki.moe/v2/zhihu",
    backup: null,
  },
  {
    id: "bilibili",
    label: "B站",
    primary: "https://60s.viki.moe/v2/bili",
    backup: "https://v2.xxapi.cn/api/bilibilihot",
  },
  {
    id: "baidu",
    label: "百度",
    primary: "https://60s.viki.moe/v2/baidu/hot",
    backup: "https://v2.xxapi.cn/api/baiduhot",
  },
  {
    id: "toutiao",
    label: "今日头条",
    primary: "https://60s.viki.moe/v2/toutiao",
    backup: null,
  },
]);

/** 默认请求超时；清单建议每个来源 ≤1 次/分钟，插件不做轮询。 */
export const TREND_TIMEOUT_MS = 12000;

/** 单个来源最多取用的条目数。 */
export const TREND_ITEM_LIMIT = 50;

/**
 * 宽容解析热榜响应。
 *
 * 已见于文档的三种形状都要接受：顶层数组、`{data: [...]}`、`{data: {data: [...]}}`。
 * 解析不出条目时返回空数组，由调用方记为失败——**不猜、不补**。
 */
export function parseTrendPayload(payload) {
  const candidates = [];
  const push = (value) => {
    if (Array.isArray(value)) candidates.push(value);
  };
  if (Array.isArray(payload)) push(payload);
  if (payload !== null && typeof payload === "object") {
    push(payload.data);
    push(payload.list);
    push(payload.result);
    if (payload.data !== null && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      push(payload.data.data);
      push(payload.data.list);
    }
  }
  const rows = candidates.find((value) => value.length > 0) ?? [];
  const items = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const title = row.title ?? row.name ?? row.word ?? row.query;
    if (typeof title !== "string" || title.trim() === "") continue;
    const hot = row.hot ?? row.hotValue ?? row.hot_value ?? row.heat ?? row.score;
    const url = row.url ?? row.link ?? row.mobilUrl ?? row.mobileUrl;
    items.push({
      title: title.trim(),
      hot: typeof hot === "number" ? hot : Number.isFinite(Number(hot)) && hot !== undefined && hot !== null ? Number(hot) : null,
      url: typeof url === "string" && url.trim() !== "" ? url.trim() : null,
    });
    if (items.length >= TREND_ITEM_LIMIT) break;
  }
  return items;
}

/**
 * 建立热点服务。
 *
 * `fetchImpl` 可注入，便于用假响应做单元测试；默认用宿主全局 fetch。
 */
export function createTrendsService(deps = {}) {
  // 显式传入 `fetchImpl: undefined` 表示「本环境没有 HTTP 读取能力」——受限宿主与
  // 单元测试都需要这种「确定地不联网」的入口；只有完全不提这个键时才用全局 fetch。
  const fetchImpl = Object.hasOwn(deps, "fetchImpl") ? deps.fetchImpl : globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? TREND_TIMEOUT_MS;

  async function fetchJson(url) {
    if (typeof fetchImpl !== "function") {
      return { ok: false, reason: "当前运行环境没有可用的 HTTP 读取能力。" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (response === undefined || response === null) return { ok: false, reason: "读取没有返回响应。" };
      if (response.ok === false) return { ok: false, reason: `HTTP ${String(response.status ?? "错误")}` };
      const text = typeof response.text === "function" ? await response.text() : "";
      if (typeof text === "string" && text.trim() === "") return { ok: false, reason: "响应为空。" };
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return { ok: false, reason: "响应不是可解析的 JSON。" };
      }
      return { ok: true, payload };
    } catch (error) {
      const aborted = error !== null && typeof error === "object" && error.name === "AbortError";
      return { ok: false, reason: aborted ? "读取超时。" : `读取失败：${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async function readSource(source) {
    const attempts = [source.primary, source.backup].filter((url) => typeof url === "string" && url !== "");
    const failures = [];
    for (const url of attempts) {
      const result = await fetchJson(url);
      if (result.ok === false) {
        failures.push({ url, reason: result.reason });
        continue;
      }
      const items = parseTrendPayload(result.payload);
      if (items.length === 0) {
        failures.push({ url, reason: "返回内容里没有可识别的热榜条目。" });
        continue;
      }
      return {
        source: source.id,
        label: source.label,
        ok: true,
        origin: url,
        degraded: url !== source.primary,
        items,
        attempts: failures,
        reason: null,
      };
    }
    return {
      source: source.id,
      label: source.label,
      ok: false,
      origin: null,
      degraded: false,
      items: [],
      attempts: failures,
      reason: failures.length === 0 ? "没有可用的数据源。" : failures.map((entry) => `${entry.url}：${entry.reason}`).join("；"),
    };
  }

  return {
    /** 数据源清单（含主源与备源），供面板展示来源标注。 */
    sources() {
      return TREND_SOURCES.map((source) => ({ id: source.id, label: source.label, primary: source.primary, backup: source.backup }));
    },

    /**
     * 读取热点线索。
     *
     * @param {{ ids?: string[] }} [input] 只读取哪些来源；缺省读全部。
     * @returns 逐源结果；全部失败时 `ok === false` 且带 `failures`（**不是空列表**）。
     */
    async read(input = {}) {
      const wanted =
        Array.isArray(input.ids) && input.ids.length > 0
          ? TREND_SOURCES.filter((source) => input.ids.includes(source.id))
          : TREND_SOURCES;
      const results = [];
      for (const source of wanted) {
        results.push(await readSource(source));
      }
      const ok = results.some((result) => result.ok);
      const failures = results
        .filter((result) => !result.ok)
        .map((result) => ({ source: result.source, label: result.label, reason: result.reason, attempts: result.attempts }));
      return {
        ok,
        fetchedAt: new Date().toISOString(),
        sources: results,
        items: results.flatMap((result) =>
          result.items.map((item) => ({ ...item, source: result.source, label: result.label, origin: result.origin })),
        ),
        failures,
        note: ok
          ? failures.length > 0
            ? `部分来源不可用（${String(failures.length)} 个），其余来源正常。`
            : null
          : `全部来源都不可用：${failures.map((entry) => `${entry.label}（${entry.reason}）`).join("；")}`,
      };
    },
  };
}
