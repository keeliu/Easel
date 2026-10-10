/**
 * 内容排期：把排期表达为 **DSH 排期项**，不另建调度器。
 *
 * spec `creator-planning` 与 tasks 7.1–7.3 的要求：
 * - 排期项携带自包含任务说明（见 `lib/host/brief.js`）；
 * - 排期由 DSH 原有能力创建、暂停、删除，工作台只**读取**其状态，因此
 *   DSH 界面里暂停/删除后工作台视图会同步（不需要插件自己维护状态）；
 * - 插件内**不存在**进程内定时循环或绕开 DSH 排期的触发路径。
 *
 * 识别「是不是工作台创建的排期」靠标题前缀：`ctx.schedule.catalog()` 返回全部
 * Host 提醒及其原始会话绑定，前缀是唯一稳定且不污染 prompt 的标记。
 *
 * @module easel-workbench/host/schedule
 */

import { ERROR_CODES, ensure } from "./errors.js";
import { assertSelfContained, buildTaskBrief } from "./brief.js";
import { serviceOf } from "./services.js";

/** 工作台排期项的标题前缀（`catalog()` 里据此识别）。 */
export const EASEL_SCHEDULE_PREFIX = "Easel｜";

/** `ScheduleCreateRequest` 里互斥的定时字段；必须恰好给一个。 */
export const TIMING_KEYS = Object.freeze(["after_seconds", "at", "every_seconds", "daily", "weekly", "cron"]);

/** 工作台排期标题：前缀 + 主题，超出 DSH 标题上限时截断。 */
export function scheduleTitle(topic) {
  const value = String(topic ?? "").trim();
  ensure(value !== "", ERROR_CODES.INVALID_INPUT, "排期项缺少主题，无法生成标题。");
  const max = 120 - EASEL_SCHEDULE_PREFIX.length;
  return `${EASEL_SCHEDULE_PREFIX}${value.length <= max ? value : value.slice(0, max)}`;
}

/** 判断某个排期项是否由工作台创建。 */
export function isEaselSchedule(entry) {
  return typeof entry?.title === "string" && entry.title.startsWith(EASEL_SCHEDULE_PREFIX);
}

/**
 * 组装 `ScheduleCreateRequest`。
 *
 * 定时字段原样透传给 DSH——时间与时区的合法性由 DSH 排期服务判定，插件不重复实现。
 */
export function buildScheduleRequest(input) {
  const given = TIMING_KEYS.filter((key) => input?.[key] !== undefined && input?.[key] !== null);
  ensure(
    given.length === 1,
    ERROR_CODES.INVALID_INPUT,
    `排期必须且只能给出一个定时字段（${TIMING_KEYS.join(" / ")}），当前给出 ${String(given.length)} 个。`,
    { details: { given } },
  );
  const prompt = input.prompt ?? buildTaskBrief(input.task ?? {});
  assertSelfContained(prompt);
  const request = { title: input.title ?? scheduleTitle(input.topic), prompt };
  for (const key of given) request[key] = input[key];
  return request;
}

/** 只读视图：面板需要的字段，避免把整个 record 泄漏到客户端。 */
export function scheduleView(entry) {
  return {
    id: entry.id,
    title: entry.title,
    topic: typeof entry.title === "string" ? entry.title.slice(EASEL_SCHEDULE_PREFIX.length) : "",
    status: entry.status ?? "active",
    kind: entry.kind,
    scheduledAt: entry.scheduledAt,
    sessionId: entry.sessionId ?? null,
    prompt: entry.prompt,
    lastDelivery: entry.lastDelivery ?? null,
  };
}

/**
 * 建立排期服务。
 *
 * `ctx.schedule` 在本 profile 可能不存在，因此所有方法先做能力判断并给出可读原因。
 *
 * @param {{ ctx: Record<string, any> }} deps
 */
export function createScheduleService(deps) {
  const { ctx } = deps;

  function requireSchedule() {
    const service = serviceOf(ctx, "schedule");
    ensure(
      service !== undefined && typeof service.create === "function" && typeof service.catalog === "function",
      ERROR_CODES.NOT_CONFIGURED,
      "当前 DSH 运行环境没有排期服务，无法创建工作台排期项。请在 DSH 中启用排期能力后重试。",
    );
    return service;
  }

  const service = {
    /** 是否具备 DSH 排期能力（环境自检与面板都用它决定是否显示排期入口）。 */
    available() {
      const schedule = serviceOf(ctx, "schedule");
      return schedule !== undefined && typeof schedule.create === "function" && typeof schedule.catalog === "function";
    },

    /** 列出工作台创建的排期项（含 DSH 界面里已暂停的）。 */
    async list() {
      const schedule = requireSchedule();
      const catalog = await schedule.catalog();
      const entries = (Array.isArray(catalog) ? catalog : []).filter(isEaselSchedule);
      return {
        items: entries.map(scheduleView),
        total: entries.length,
        active: entries.filter((entry) => (entry.status ?? "active") === "active").length,
      };
    },

    /** 创建一个排期项；返回 DSH 的 `ScheduleRecord` 视图。 */
    async create(input) {
      const schedule = requireSchedule();
      ensure(
        typeof input?.sessionId === "string" && input.sessionId !== "",
        ERROR_CODES.INVALID_INPUT,
        "创建排期项必须绑定一个目标会话（DSH 排期按会话投递）。",
      );
      const request = buildScheduleRequest(input);
      const record = await schedule.create(input.sessionId, request);
      return {
        record: {
          id: record.id,
          title: record.title,
          prompt: record.prompt,
          scheduledAt: record.scheduledAt,
          kind: record.kind,
        },
        sessionId: input.sessionId,
      };
    },

    /** 删除排期项（DSH 界面里删除后此处会找不到，属正常）。 */
    async remove(input) {
      const schedule = requireSchedule();
      ensure(
        typeof input?.id === "string" && typeof input?.sessionId === "string" && input.sessionId !== "",
        ERROR_CODES.INVALID_INPUT,
        "删除排期项必须同时给出排期标识与其绑定的会话标识。",
      );
      await schedule.delete({ sessionId: input.sessionId, id: input.id });
      return { deleted: true, id: input.id };
    },

    /**
     * 修改排期项的标题或说明。
     *
     * **定时规则不在这里改**：时间与时区的调整由 DSH 排期界面负责，工作台只读其状态。
     */
    async update(input) {
      const schedule = requireSchedule();
      ensure(
        typeof input?.id === "string" && typeof input?.sessionId === "string" && input.sessionId !== "" && input.expected !== undefined,
        ERROR_CODES.INVALID_INPUT,
        "修改排期项必须给出排期标识、绑定会话与当前记录（expected）。",
      );
      if (typeof input.prompt === "string") assertSelfContained(input.prompt);
      const record = await schedule.update({
        sessionId: input.sessionId,
        id: input.id,
        expected: input.expected,
        title: input.title,
        prompt: input.prompt,
      });
      return { record };
    },
  };

  return service;
}
