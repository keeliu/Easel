/**
 * 自包含任务说明的测试。
 *
 * spec `creator-planning` / `workbench-task-dispatch` 要求排期与派发的任务说明
 * 脱离当前对话仍可独立理解：不得出现会话标识、临时路径、「上述/刚才」这类指代。
 * 这组测试既测「能生成合规说明」，也测「违规说明会被拒绝」。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BRIEF_FIELDS,
  BRIEF_HEADER,
  FORBIDDEN_REFERENCES,
  assertSelfContained,
  buildTaskBrief,
  inspectSelfContained,
} from "../lib/host/brief.js";
import { ERROR_CODES, EaselError } from "../lib/host/errors.js";

const SAMPLE = {
  goal: "把上周的拍摄素材剪成一条 60 秒竖版短视频并配好字幕",
  deliverable: "一条 60 秒、1080×1920 的成片与字幕文件",
  topic: "露营装备测评",
  profile: "户外装备号",
  platform: "douyin",
};

describe("buildTaskBrief", () => {
  const text = buildTaskBrief(SAMPLE);

  it("包含抬头与全部必填字段", () => {
    assert.equal(text.startsWith(BRIEF_HEADER), true);
    for (const field of BRIEF_FIELDS) {
      assert.equal(text.includes(field), true, `缺少字段：${field}`);
    }
    assert.equal(text.endsWith("\n"), true);
  });

  it("带上任务目标、画像、平台与期望产物", () => {
    assert.equal(text.includes(SAMPLE.goal), true);
    assert.equal(text.includes("户外装备号"), true);
    assert.equal(text.includes("douyin"), true);
    assert.equal(text.includes(SAMPLE.deliverable), true);
  });

  it("产物约定指向 outputs/<主题>/，与 Easel 既有布局一致", () => {
    assert.equal(text.includes("outputs/露营装备测评/"), true);
    assert.equal(text.includes("assets/"), true);
  });

  it("执行要求覆盖技能路由、自检、付费确认与发布前扫描", () => {
    assert.equal(text.includes("SKILL"), true);
    assert.equal(text.includes("自检"), true);
    assert.equal(text.includes("费用预估"), true);
    assert.equal(text.includes("内容安全扫描"), true);
  });

  it("生成结果本身通过自包含校验", () => {
    assert.deepEqual(inspectSelfContained(text), []);
  });

  it("缺主题时用任务目标截断补齐，缺画像/平台时给出显式默认值", () => {
    const bare = buildTaskBrief({ goal: SAMPLE.goal, deliverable: SAMPLE.deliverable });
    assert.equal(bare.includes("通用模式（未指定画像）"), true);
    assert.equal(bare.includes("目标平台：未指定"), true);
    assert.deepEqual(inspectSelfContained(bare), []);
  });

  it("可选补充说明为空时不留空行", () => {
    const withNotes = buildTaskBrief({ ...SAMPLE, notes: "保留现场收音" });
    assert.equal(withNotes.includes("补充说明：保留现场收音"), true);
    assert.equal(text.includes("补充说明"), false);
  });

  it("缺少任务目标或期望产物时抛 invalid-input", () => {
    for (const input of [
      { deliverable: "成片" },
      { goal: "剪一条视频" },
      { goal: "   ", deliverable: "成片" },
    ]) {
      assert.throws(
        () => buildTaskBrief(input),
        (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
      );
    }
  });
});

describe("自包含校验", () => {
  it("识别会话标识、临时路径与未命名指代", () => {
    const cases = [
      ["接着 session-42abc 的进度继续", "session-id"],
      ["产物先放 /tmp/easel-out 再整理", "temp-path"],
      ["把上述三段合并成一篇", "vague-reference"],
      ["接着刚才说的改", "vague-reference"],
      ["如同上一条那样处理", "vague-reference"],
    ];
    for (const [text, expected] of cases) {
      const hits = inspectSelfContained(text);
      assert.equal(hits.some((hit) => hit.id === expected), true, `未识别：${text}`);
    }
  });

  it("干净文本不报违规", () => {
    assert.deepEqual(inspectSelfContained("把三条素材剪成 60 秒竖版视频，标题 12 字以内。"), []);
    assert.deepEqual(inspectSelfContained(""), []);
    assert.deepEqual(inspectSelfContained(undefined), []);
  });

  it("assertSelfContained 抛出并带上违规明细", () => {
    assert.equal(assertSelfContained("干净说明"), undefined);
    assert.throws(
      () => assertSelfContained("把上述内容发到抖音"),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.deepEqual(error.details.violations, [{ id: "vague-reference", label: "未命名指代" }]);
        return true;
      },
    );
  });

  it("违规清单本身是稳定的（面板侧按 id 分支）", () => {
    assert.deepEqual(FORBIDDEN_REFERENCES.map((entry) => entry.id), [
      "session-id",
      "temp-path",
      "vague-reference",
    ]);
  });
});
