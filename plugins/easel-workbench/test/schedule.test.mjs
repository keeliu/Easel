/**
 * 内容排期的测试。
 *
 * spec `creator-planning` 约束：排期必须表达为 **DSH 排期项**，插件只读取其状态，
 * 不另建调度器；任务说明必须自包含。这组测试既测组装与只读视图，也测
 * 「插件内不存在自己的定时循环」这条防回归约束。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { ERROR_CODES, EaselError } from "../lib/host/errors.js";
import {
  EASEL_SCHEDULE_PREFIX,
  TIMING_KEYS,
  buildScheduleRequest,
  createScheduleService,
  isEaselSchedule,
  scheduleTitle,
  scheduleView,
} from "../lib/host/schedule.js";

/** 假 DSH 排期服务，记录每次调用以便断言插件确实只调用 DSH 能力。 */
function fakeSchedule(entries = []) {
  const calls = { created: [], deleted: [], updated: [], catalog: 0 };
  return {
    calls,
    async catalog() {
      calls.catalog += 1;
      return entries;
    },
    async create(sessionId, request) {
      calls.created.push({ sessionId, request });
      return {
        id: "sch-1",
        title: request.title,
        prompt: request.prompt,
        scheduledAt: { kind: "after", afterSeconds: request.after_seconds },
        kind: "after_seconds",
        internal: "不应出现在视图里",
      };
    },
    async delete(input) {
      calls.deleted.push(input);
      return undefined;
    },
    async update(input) {
      calls.updated.push(input);
      return { id: input.id, title: input.title, prompt: input.prompt };
    },
  };
}

const TASK = {
  goal: "把三条露营素材剪成一条 60 秒竖版短视频",
  deliverable: "一条 60 秒、1080×1920 的成片",
  topic: "露营装备测评",
  profile: "户外装备号",
};

/**
 * 假插件上下文。
 *
 * 真实 cordis 上下文**只允许**读取静态 `inject` 里声明过的服务属性，其余服务一律经
 * `ctx.get(name)` 读取（未提供时返回 undefined）；测试替身照此实现，否则测出来的
 * 行为与宿主运行时不符。
 */
function makeCtx(services = {}) {
  return { ...services, get: (name) => services[name] };
}

describe("排期标题", () => {
  it("前缀固定，便于在 DSH 排期列表里识别工作台排期", () => {
    assert.equal(EASEL_SCHEDULE_PREFIX, "Easel｜");
    assert.equal(scheduleTitle("露营装备测评"), "Easel｜露营装备测评");
  });
  it("超长主题截断到 DSH 的 120 字标题上限之内", () => {
    const title = scheduleTitle("主".repeat(200));
    assert.equal([...title].length <= 120, true);
    assert.equal(title.startsWith(EASEL_SCHEDULE_PREFIX), true);
  });

  it("缺少主题时抛 invalid-input", () => {
    for (const value of ["", "   ", undefined, null]) {
      assert.throws(
        () => scheduleTitle(value),
        (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
      );
    }
  });

  it("isEaselSchedule 只认前缀，未创建的排期不算工作台排期", () => {
    assert.equal(isEaselSchedule({ title: "Easel｜露营" }), true);
    assert.equal(isEaselSchedule({ title: "普通提醒" }), false);
    assert.equal(isEaselSchedule({}), false);
    assert.equal(isEaselSchedule(null), false);
  });
});

describe("buildScheduleRequest", () => {
  it("正好一个定时字段时原样透传（合法性交给 DSH 判定）", () => {
    for (const key of TIMING_KEYS) {
      const request = buildScheduleRequest({ topic: "露营", prompt: "剪一条 60 秒竖版视频。", [key]: "值" });
      assert.deepEqual(Object.keys(request).sort(), ["prompt", "title", key].sort());
      assert.equal(request[key], "值");
    }
  });

  it("零个或多个定时字段都抛 invalid-input，并带上实给字段", () => {
    assert.throws(
      () => buildScheduleRequest({ topic: "露营", prompt: "剪视频。" }),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.deepEqual(error.details.given, []);
        return true;
      },
    );
    assert.throws(
      () => buildScheduleRequest({ topic: "露营", prompt: "剪视频。", after_seconds: 60, daily: { time: "09:00:00" } }),
      (error) => {
        assert.deepEqual(error.details.given, ["after_seconds", "daily"]);
        return true;
      },
    );
  });

  it("未给 prompt 时用任务说明自动生成，且标题由主题派生", () => {
    const request = buildScheduleRequest({ topic: "露营装备测评", task: TASK, after_seconds: 60 });
    assert.equal(request.title, "Easel｜露营装备测评");
    assert.equal(request.prompt.startsWith("【Easel 创作任务】"), true);
    assert.equal(request.prompt.includes(TASK.goal), true);
  });

  it("显式 prompt 也必须自包含", () => {
    assert.throws(
      () => buildScheduleRequest({ topic: "露营", prompt: "把上述内容发出去。", after_seconds: 60 }),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.equal(error.details.violations[0].id, "vague-reference");
        return true;
      },
    );
  });

  it("自动生成路径同样受自包含约束（主题里带临时路径会被拒）", () => {
    assert.throws(
      () => buildScheduleRequest({ topic: "露营", task: { ...TASK, topic: "/tmp/easel" }, after_seconds: 60 }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });
});

describe("scheduleView", () => {
  it("只暴露面板需要的字段，不泄漏 record 内部结构", () => {
    const view = scheduleView({
      id: "sch-1",
      title: "Easel｜露营装备测评",
      status: undefined,
      kind: "after_seconds",
      scheduledAt: { kind: "after" },
      sessionId: "session-easel-1",
      prompt: "说明",
      lastDelivery: undefined,
      internal: "不应出现",
    });
    assert.deepEqual(Object.keys(view).sort(), [
      "id",
      "kind",
      "lastDelivery",
      "prompt",
      "scheduledAt",
      "sessionId",
      "status",
      "title",
      "topic",
    ]);
    assert.equal(view.topic, "露营装备测评");
    assert.equal(view.status, "active");
    assert.equal(view.lastDelivery, null);
    assert.equal("internal" in view, false);
  });
});

describe("createScheduleService", () => {
  it("没有 DSH 排期能力时 available() 为 false，并给出可读原因", async () => {
    for (const ctx of [{}, { schedule: {} }, { schedule: { create() {} } }, { schedule: { catalog() {} } }].map(makeCtx)) {
      const service = createScheduleService({ ctx });
      assert.equal(service.available(), false);
      await assert.rejects(
        () => service.list(),
        (error) => error instanceof EaselError && error.code === ERROR_CODES.NOT_CONFIGURED,
      );
    }
  });

  it("能力齐备时 available() 为 true", () => {
    const service = createScheduleService({ ctx: makeCtx({ schedule: fakeSchedule() }) });
    assert.equal(service.available(), true);
  });

  it("list 只返回工作台创建的排期项，并统计生效中的数量", async () => {
    const ctx = makeCtx({
      schedule: fakeSchedule([
        { id: "a", title: "Easel｜露营", status: "active" },
        { id: "b", title: "Easel｜露营", status: "paused" },
        { id: "c", title: "别处的提醒", status: "active" },
      ]),
    });
    const service = createScheduleService({ ctx });
    const result = await service.list();
    assert.deepEqual(result.items.map((item) => item.id), ["a", "b"]);
    assert.equal(result.total, 2);
    assert.equal(result.active, 1);
    assert.equal(ctx.schedule.calls.catalog, 1);
  });

  it("create 必须绑定会话，并把请求原样交给 DSH", async () => {
    const ctx = makeCtx({ schedule: fakeSchedule() });
    const service = createScheduleService({ ctx });

    await assert.rejects(
      () => service.create({ topic: "露营", prompt: "剪视频。", after_seconds: 60 }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    await assert.rejects(
      () => service.create({ sessionId: "", topic: "露营", prompt: "剪视频。", after_seconds: 60 }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );

    const created = await service.create({
      sessionId: "session-easel-1",
      topic: "露营装备测评",
      task: TASK,
      after_seconds: 3600,
    });
    assert.equal(ctx.schedule.calls.created.length, 1);
    const sent = ctx.schedule.calls.created[0];
    assert.equal(sent.sessionId, "session-easel-1");
    assert.equal(sent.request.after_seconds, 3600);
    assert.equal(sent.request.title, "Easel｜露营装备测评");
    assert.equal(sent.request.prompt.startsWith("【Easel 创作任务】"), true);
    // 返回体是视图，不含 DSH record 的内部字段
    assert.deepEqual(Object.keys(created.record).sort(), ["id", "kind", "prompt", "scheduledAt", "title"]);
    assert.equal("internal" in created.record, false);
  });

  it("remove 需要排期标识与绑定会话，并转交 DSH 删除", async () => {
    const ctx = makeCtx({ schedule: fakeSchedule() });
    const service = createScheduleService({ ctx });

    await assert.rejects(
      () => service.remove({ id: "sch-1" }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    const result = await service.remove({ id: "sch-1", sessionId: "session-easel-1" });
    assert.deepEqual(result, { deleted: true, id: "sch-1" });
    assert.deepEqual(ctx.schedule.calls.deleted, [{ sessionId: "session-easel-1", id: "sch-1" }]);
  });

  it("update 需要 expected（乐观锁），且说明仍受自包含约束", async () => {
    const ctx = makeCtx({ schedule: fakeSchedule() });
    const service = createScheduleService({ ctx });

    await assert.rejects(
      () => service.update({ id: "sch-1", sessionId: "session-easel-1" }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    await assert.rejects(
      () =>
        service.update({
          id: "sch-1",
          sessionId: "session-easel-1",
          expected: { id: "sch-1" },
          prompt: "把上述内容重发。",
        }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    assert.equal(ctx.schedule.calls.updated.length, 0, "校验未过时不应调用 DSH");

    await service.update({ id: "sch-1", sessionId: "session-easel-1", expected: { id: "sch-1" }, title: "Easel｜新主题" });
    assert.deepEqual(ctx.schedule.calls.updated, [
      { sessionId: "session-easel-1", id: "sch-1", expected: { id: "sch-1" }, title: "Easel｜新主题", prompt: undefined },
    ]);
  });
});

describe("不存在自建调度器（防回归）", () => {
  it("schedule.js 内没有进程内定时循环或第三方调度器", async () => {
    const source = await readFile(new URL("../lib/host/schedule.js", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const pattern of [/setInterval/, /setTimeout/, /node-cron/, /node-schedule/, /crontab/, /child_process/]) {
      assert.equal(pattern.test(code), false, `schedule.js 不应出现 ${String(pattern)}`);
    }
  });
});
