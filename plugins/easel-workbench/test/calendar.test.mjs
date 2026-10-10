/**
 * `lib/host/calendar.js` 的单元测试。
 *
 * 这个模块只做一件事：把仓库里既有的内容日历脚本读成界面能直接渲染的一个月。
 * 因此测试盯三处：月历窗口与界面格子数一致（周一起始、固定 42 天）、
 * 调脚本的 argv 真的是 `list --since --until`、以及脚本没输出 JSON 时
 * 报的是可读原因而不是「undefined is not iterable」。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CALENDAR_GRID_DAYS,
  CALENDAR_SCRIPT_RELATIVE,
  buildCalendarArgv,
  calendarScriptPath,
  createCalendarService,
  dayKey,
  monthDays,
  monthWindow,
  normalizeCalendarItems,
  normalizeMonth,
} from "../lib/host/calendar.js";
import { ERROR_CODES } from "../lib/host/errors.js";

/** 极简假子进程服务：记录 spawn 规格，回放固定 stdout/stderr。 */
function fakeSubprocess(response = {}) {
  const calls = [];
  return {
    calls,
    spawn(spec) {
      calls.push(spec);
      const text = String(response.stdout ?? "");
      const reader = (value) => ({
        readFrom: () => ({ text: value, nextOffset: value.length, lossy: false }),
      });
      return {
        collected: { stdout: reader(text), stderr: reader(String(response.stderr ?? "")) },
        done: Promise.resolve({ exitCode: response.exitCode ?? 0, signal: null }),
      };
    },
  };
}

/** 造一个含内容日历脚本的假仓库。 */
async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "easel-calendar-"));
  const script = join(root, CALENDAR_SCRIPT_RELATIVE);
  await mkdir(join(script, ".."), { recursive: true });
  await writeFile(script, "#!/usr/bin/env python3\n", "utf8");
  return { root, script };
}

describe("本地日期与月份规整", () => {
  it("dayKey 用本地时区，不吃 toISOString 的 UTC 偏移", () => {
    assert.equal(dayKey(new Date(2026, 7, 1)), "2026-08-01");
    assert.equal(dayKey(new Date(2026, 0, 9)), "2026-01-09");
  });

  it("normalizeMonth 只认 YYYY-MM，其余退回当月", () => {
    const now = new Date(2026, 9, 10);
    assert.equal(normalizeMonth("2026-08", now), "2026-08");
    assert.equal(normalizeMonth(" 2026-12 ", now), "2026-12");
    assert.equal(normalizeMonth("2026-13", now), "2026-10");
    assert.equal(normalizeMonth("", now), "2026-10");
    assert.equal(normalizeMonth(undefined, now), "2026-10");
  });
});

describe("月历窗口", () => {
  it("固定 42 天、周一起始，且当月 1 号落在窗口里", () => {
    const { from, to } = monthWindow("2026-08");
    const days = monthDays("2026-08");
    assert.equal(days.length, CALENDAR_GRID_DAYS);
    assert.equal(days[0], from);
    assert.equal(days[days.length - 1], to);
    assert.equal(new Date(`${from}T00:00:00`).getDay(), 1, "窗口首日必须是周一");
    const span = (new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86_400_000;
    assert.equal(span, CALENDAR_GRID_DAYS - 1);
    assert.ok(from <= "2026-08-01" && "2026-08-31" <= to);
  });

  it("跨年也不出错（1 月的窗口会伸到上一年 12 月）", () => {
    const { from } = monthWindow("2026-01");
    assert.equal(new Date(`${from}T00:00:00`).getDay(), 1);
    assert.match(from, /^2025-12-/);
  });
});

describe("调用脚本的 argv 与脚本路径", () => {
  it("argv 就是 calendar_ops.py 的 list --since --until", () => {
    assert.deepEqual(buildCalendarArgv({ python: "/venv/bin/python", scriptPath: "/repo/c.py", from: "2026-07-27", to: "2026-09-06" }), [
      "/venv/bin/python",
      "/repo/c.py",
      "list",
      "--since",
      "2026-07-27",
      "--until",
      "2026-09-06",
    ]);
  });

  it("脚本路径拼在 easelRoot 下", () => {
    assert.equal(calendarScriptPath({ easelRoot: "/easel" }), join("/easel", CALENDAR_SCRIPT_RELATIVE));
    assert.equal(calendarScriptPath({}), CALENDAR_SCRIPT_RELATIVE);
  });
});

describe("条目规整", () => {
  it("保留既有字段、补齐缺省，并丢掉没有日期的条目", () => {
    const items = normalizeCalendarItems({
      count: 3,
      items: [
        {
          id: "a",
          date: "2026-08-19",
          title: "七夕节",
          platform: "小红书",
          kind: "event",
          event_type: "节日",
          end_date: "2026-08-19",
          note: "蹭点",
        },
        { date: "2026-08-20", title: "无 id 的内容" },
        { title: "没有日期，放不进格子" },
      ],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].eventType, "节日");
    assert.equal(items[0].endDate, "2026-08-19");
    assert.equal(items[0].kind, "event");
    assert.equal(items[1].id, "calendar-1");
    assert.equal(items[1].kind, "content");
    assert.equal(items[1].status, "");
  });

  it("非法载荷退化成空列表而不是抛错", () => {
    assert.deepEqual(normalizeCalendarItems(undefined), []);
    assert.deepEqual(normalizeCalendarItems({ items: "nope" }), []);
  });
});

describe("读一个月", () => {
  it("走 list --since --until，回窗口内的条目", async () => {
    const { root, script } = await makeRepo();
    const subprocess = fakeSubprocess({
      stdout: JSON.stringify({ count: 1, items: [{ id: "e1", date: "2026-08-19", title: "七夕节", kind: "event" }] }),
    });
    const calendar = createCalendarService({
      runtime: { easelRoot: root, runtimeDir: join(root, ".runtime") },
      subprocess,
      resolvePython: async () => "/venv/bin/python",
    });

    const result = await calendar.month("2026-08");
    assert.equal(result.month, "2026-08");
    assert.equal(result.count, 1);
    assert.equal(result.items[0].title, "七夕节");
    assert.equal(result.script, script);
    assert.deepEqual(subprocess.calls[0].argv.slice(1, 3), [script, "list"]);
    assert.equal(subprocess.calls[0].cwd, root);
    assert.equal(subprocess.calls[0].argv[4], result.from);
    assert.equal(subprocess.calls[0].argv[6], result.to);
  });

  it("缺 Python 解释器时给 not-configured，且不启动子进程", async () => {
    const { root } = await makeRepo();
    const subprocess = fakeSubprocess({});
    const calendar = createCalendarService({ runtime: { easelRoot: root }, subprocess, resolvePython: async () => undefined });
    await assert.rejects(() => calendar.month("2026-08"), (error) => {
      assert.equal(error.code, ERROR_CODES.NOT_CONFIGURED);
      return true;
    });
    assert.equal(subprocess.calls.length, 0);
  });

  it("仓库里没有脚本时给 not-configured 并带上路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "easel-calendar-empty-"));
    const calendar = createCalendarService({
      runtime: { easelRoot: root },
      subprocess: fakeSubprocess({}),
      resolvePython: async () => "/venv/bin/python",
    });
    await assert.rejects(() => calendar.month("2026-08"), (error) => {
      assert.equal(error.code, ERROR_CODES.NOT_CONFIGURED);
      assert.match(error.message, /calendar_ops\.py/);
      assert.equal(error.details.path, join(root, CALENDAR_SCRIPT_RELATIVE));
      return true;
    });
  });

  it("脚本没输出 JSON 时报 source-unavailable，并带出退出码与 stderr 尾巴", async () => {
    const { root } = await makeRepo();
    const calendar = createCalendarService({
      runtime: { easelRoot: root },
      subprocess: fakeSubprocess({ stdout: "Traceback (most recent call last):", stderr: "boom", exitCode: 1 }),
      resolvePython: async () => "/venv/bin/python",
    });
    await assert.rejects(() => calendar.month("2026-08"), (error) => {
      assert.equal(error.code, ERROR_CODES.SOURCE_UNAVAILABLE);
      assert.equal(error.details.exitCode, 1);
      assert.match(error.message, /boom/);
      return true;
    });
  });
});
