/**
 * 插件内部使用的具名错误与统一的结果包装。
 *
 * 宿主服务方法不抛裸 Error：凡是「可预期的失败」（路径越界、来源不可用、登录态
 * 失效、平台不可达）都返回 `ok: false` 的结构化结果，让工作台面板可以显示可读
 * 原因。只有调用方传参非法这类编程错误才抛出，并由宿主服务边界统一转换成
 * `ok: false`。
 *
 * @module dsh-easel/host/errors
 */

/** 带稳定 `code` 的插件错误；`code` 供测试与面板分支使用，不依赖文案。 */
export class EaselError extends Error {
  /**
   * @param {string} code 稳定的机器可读错误码。
   * @param {string} message 面向用户的可读说明（中文，面板侧翻译）。
   * @param {{ cause?: unknown, details?: Record<string, unknown> }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EaselError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

/** 稳定的错误码常量（测试断言这些常量，而不是断言文案）。 */
export const ERROR_CODES = Object.freeze({
  NOT_CONFIGURED: "not-configured",
  PATH_OUT_OF_SCOPE: "path-out-of-scope",
  UPSTREAM_READ_ONLY: "upstream-read-only",
  NOT_FOUND: "not-found",
  INVALID_INPUT: "invalid-input",
  RUNTIME_MISSING: "runtime-missing",
  SOURCE_UNAVAILABLE: "source-unavailable",
  AUTH_EXPIRED: "auth-expired",
  CONTENT_GUARD_BLOCKED: "content-guard-blocked",
  PUBLISH_FAILED: "publish-failed",
  NO_AGENT: "no-agent",
});

/**
 * 把任意值规整成 `{ ok: true, value }` / `{ ok: false, code, message, details }`。
 *
 * **同步回调直接返回结果对象，异步回调返回一个解析为结果对象的 Promise**，
 * 因此两种写法都对：
 * - `const r = attempt(() => JSON.parse(text)); if (r.ok) …`（同步）
 * - `const r = await attempt(() => service.list()); if (r.ok) …`（异步）
 *
 * 这个双形态是有意为之：`attempt` 最初只支持异步，结果同步调用点全都拿到一个
 * Promise，`r.ok` 恒为 `undefined`，静默走了失败分支（数据视图读不出 manifest、
 * 选题库、会话列表都因此为空）。**同步回调不要 `await`，异步回调必须 `await`**。
 *
 * @template T
 * @param {() => Promise<T> | T} run
 * @returns {{ ok: true, value: T } | { ok: false, code: string, message: string, details: Record<string, unknown> } | Promise<{ ok: true, value: T } | { ok: false, code: string, message: string, details: Record<string, unknown> }>}
 */
export function attempt(run) {
  const failure = (error) => {
    if (error instanceof EaselError) {
      return { ok: false, code: error.code, message: error.message, details: error.details };
    }
    return {
      ok: false,
      code: ERROR_CODES.INVALID_INPUT,
      message: error instanceof Error ? error.message : String(error),
      details: {},
    };
  };
  let value;
  try {
    value = run();
  } catch (error) {
    return failure(error);
  }
  if (value !== null && typeof value === "object" && typeof value.then === "function") {
    return value.then((settled) => ({ ok: true, value: settled }), failure);
  }
  return { ok: true, value };
}

/**
 * 断言一个值满足条件，否则抛出 `EaselError`。
 * 第四个参数既可以传扁平的 `details`，也可以传 `EaselError` 的 options 形态
 * （`{ details }`）。两种写法都会被规整成同一份 `error.details`，这样面板侧
 * 只认 `error.details.<字段>` 一个契约，不会因为调用点写法不同而出现
 * `details.details` 这种嵌套。
 *
 * @param {unknown} condition
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export function ensure(condition, code, message, details) {
  if (!condition) {
    const keys = details !== null && typeof details === "object" ? Object.keys(details) : [];
    const normalized =
      keys.length === 1 && keys[0] === "details" && details.details !== undefined
        ? details.details
        : details;
    throw new EaselError(
      code,
      message,
      normalized === undefined ? undefined : { details: normalized },
    );
  }
}
