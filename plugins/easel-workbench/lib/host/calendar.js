/**
 * 内容日历：把仓库里既有的 `skills/shared/scripts/calendar_ops.py` 读进工作台。
 *
 * 日历里的「平台活动」不该由插件自己编一张节日表——Easel 仓库里已经有
 * `skills/openclaw/skill-event-calendar`（节日/电商节点数据）与 `skills/shared/scripts/
 * calendar_ops.py`（内容排期与活动条目共用一个 `_schedule.json`）。因此这里只做三件事：
 * 算出月历要覆盖的日期区间、以 `list --since --until` 把区间内的条目读回来、
 * 把脚本条目规整成面板能直接渲染的形状。
 *
 * 日期一律用**本地时区**的 `YYYY-MM-DD`：`toISOString()` 会转成 UTC，
 * 在东八区会把每月 1 号零点算成上个月最后一天。
 *
 * @module easel-workbench/host/calendar
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { runCommand } from "./exec.js";
import { ERROR_CODES, EaselError, ensure } from "./errors.js";

/** 仓库里内容日历脚本的相对位置。 */
export const CALENDAR_SCRIPT_RELATIVE = "skills/shared/scripts/calendar_ops.py";

/** 月历表头顺序：ISO 周，周一起始（与 Easel 内容日历一致）。 */
export const CALENDAR_WEEKDAYS = Object.freeze(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

/** 读日历的超时：脚本要调 `lunar.py` 换算阴历节日，给足 60 秒。 */
export const CALENDAR_TIMEOUT_MS = 60_000;

/** 月历固定 6 行 × 7 列；取数窗口与界面格子数必须一致。 */
export const CALENDAR_GRID_DAYS = 42;

/** 一次读一个月，条目不会多；512 KiB 足够，超了说明脚本输出跑偏。 */
export const CALENDAR_MAX_BYTES = 512 * 1024;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 本地时区的 `YYYY-MM-DD`。
 *
 * @param {Date} date
 * @returns {string}
 */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 把任意输入规整成 `YYYY-MM`；不认识的值退回 `now` 所在月份。
 *
 * @param {unknown} value 客户端传上来的月份，形如 `2026-08`。
 * @param {Date} [now]
 * @returns {string}
 */
export function normalizeMonth(value, now = new Date()) {
  if (typeof value === "string") {
    const matched = MONTH_PATTERN.exec(value.trim());
    if (matched !== null) return `${matched[1]}-${matched[2]}`;
  }
  return `${dayKey(now).slice(0, 7)}`;
}

/**
 * 月历窗口：当月 1 号所在周的周一 → 当月最后一天所在周的周日。
 *
 * 读「整周」而不是「1 号到月末」：月历首尾的补位格子同样要显示条目，
 * 否则每月的头几天在日历上永远是空的。
 *
 * @param {string} month `YYYY-MM`
 * @returns {{ from: string, to: string }}
 */
export function monthWindow(month) {
  const normalized = normalizeMonth(month);
  const first = new Date(`${normalized}-01T00:00:00`);
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - leading);
  const end = new Date(start);
  end.setDate(start.getDate() + CALENDAR_GRID_DAYS - 1);
  return { from: dayKey(start), to: dayKey(end) };
}

/**
 * 月历上要渲染的日期（6 行 × 7 列，含首尾补位）。
 *
 * @param {string} month `YYYY-MM`
 * @returns {string[]}
 */
export function monthDays(month) {
  const { from, to } = monthWindow(month);
  const days = [];
  const cursor = new Date(`${from}T00:00:00`);
  const stop = new Date(`${to}T00:00:00`);
  while (cursor.getTime() <= stop.getTime()) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * `calendar_ops.py list --since --until` 的 argv。
 *
 * @param {{ python: string, scriptPath: string, from: string, to: string }} input
 * @returns {string[]}
 */
export function buildCalendarArgv(input) {
  return [input.python, input.scriptPath, "list", "--since", input.from, "--until", input.to];
}

/**
 * 脚本条目 → 面板条目。
 *
 * 缺字段一律降级成 `""`：前端只按 `date` 分格、按 `kind` 分类，
 * 少一个字段不该让整张日历渲染失败。没有 `date` 的条目直接丢掉（放不进格子）。
 *
 * @param {unknown} payload 脚本 stdout 解析出来的对象。
 * @returns {Array<Record<string, string>>}
 */
export function normalizeCalendarItems(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item, index) => ({
      id: typeof item?.id === "string" && item.id !== "" ? item.id : `calendar-${index}`,
      date: typeof item?.date === "string" ? item.date : "",
      time: typeof item?.time === "string" ? item.time : "",
      title: typeof item?.title === "string" ? item.title : "",
      platform: typeof item?.platform === "string" ? item.platform : "",
      kind: item?.kind === "event" ? "event" : "content",
      status: typeof item?.status === "string" ? item.status : "",
      eventType: typeof item?.event_type === "string" ? item.event_type : "",
      endDate: typeof item?.end_date === "string" ? item.end_date : "",
      note: typeof item?.note === "string" ? item.note : "",
    }))
    .filter((item) => item.date !== "");
}

/**
 * 内容日历脚本的绝对路径。
 *
 * @param {Record<string, any>} runtime
 * @returns {string}
 */
export function calendarScriptPath(runtime) {
  const root = typeof runtime?.easelRoot === "string" ? runtime.easelRoot : "";
  return join(root, CALENDAR_SCRIPT_RELATIVE);
}

/**
 * 建内容日历服务。
 *
 * @param {{
 *   runtime: Record<string, any>,
 *   subprocess: object,
 *   resolvePython?: () => Promise<string | undefined>,
 * }} deps
 */
export function createCalendarService(deps) {
  const { runtime, subprocess, resolvePython } = deps;

  return {
    /**
     * 读一个月的条目（内容排期 + 平台活动）。
     *
     * @param {string} [monthId] `YYYY-MM`，缺省当月。
     * @returns {Promise<{ month: string, from: string, to: string, count: number, items: Array<Record<string, string>>, script: string }>}
     */
    async month(monthId) {
      const month = normalizeMonth(monthId);
      const { from, to } = monthWindow(month);
      const script = calendarScriptPath(runtime);
      const python = typeof resolvePython === "function" ? await resolvePython() : undefined;
      ensure(
        typeof python === "string" && python !== "",
        ERROR_CODES.NOT_CONFIGURED,
        "找不到可用的 Python 解释器，无法读取内容日历。",
        { hint: "在「环境自检」里按提示补齐运行时。" },
      );
      ensure(
        existsSync(script),
        ERROR_CODES.NOT_CONFIGURED,
        `Easel 仓库里找不到内容日历脚本：${script}`,
        { path: script },
      );

      const result = await runCommand(subprocess, {
        argv: buildCalendarArgv({ python, scriptPath: script, from, to }),
        cwd: runtime?.easelRoot,
        timeoutMs: CALENDAR_TIMEOUT_MS,
        maxBytes: CALENDAR_MAX_BYTES,
      });

      let payload;
      try {
        payload = JSON.parse(result.stdout);
      } catch (cause) {
        throw new EaselError(
          ERROR_CODES.SOURCE_UNAVAILABLE,
          `内容日历脚本没有输出可解析的 JSON（退出码 ${String(result.exitCode)}）：${result.stderr.trim().slice(-500)}`,
          { cause, details: { exitCode: result.exitCode, argv: result.argv, script } },
        );
      }

      const items = normalizeCalendarItems(payload);
      return { month, from, to, count: items.length, items, script };
    },
  };
}
