/**
 * 路径策略与错误包装的测试。
 *
 * 这两处是「上游只读」与「越界拒绝」的确定性来源：spec 要求对内容技艺库 /
 * 共享脚本 / 形态模板的写入必须被拒绝并留痕，所以这里既测拒绝，也测留痕。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES, EaselError, attempt, ensure } from "../lib/host/errors.js";
import { createPathPolicy, isInside, matchesReadOnlyPrefix } from "../lib/host/paths.js";

const ROOT = "/srv/easel";
const policy = createPathPolicy({ repoRoot: ROOT, readOnlyPrefixes: ["skills"] });

describe("isInside", () => {
  it("识别子孙路径与自身", () => {
    assert.equal(isInside(ROOT, `${ROOT}/outputs/x.md`), true);
    assert.equal(isInside(ROOT, ROOT), true);
    assert.equal(isInside(ROOT, "/srv/other/x.md"), false);
    assert.equal(isInside(ROOT, "/srv/easel-other/x.md"), false);
    assert.equal(isInside(undefined, ROOT), false);
  });
});

describe("matchesReadOnlyPrefix", () => {
  it("命中前缀本身与其子孙，不误伤同名前缀的兄弟目录", () => {
    assert.equal(matchesReadOnlyPrefix("skills", ["skills"]), true);
    assert.equal(matchesReadOnlyPrefix("skills/openclaw/a/SKILL.md", ["skills"]), true);
    assert.equal(matchesReadOnlyPrefix("./skills/a.md", ["skills"]), true);
    assert.equal(matchesReadOnlyPrefix("skills-extra/a.md", ["skills"]), false);
    assert.equal(matchesReadOnlyPrefix("outputs/a.md", ["skills"]), false);
  });
});

describe("createPathPolicy", () => {
  it("把仓库相对路径解析成绝对路径", () => {
    assert.equal(policy.resolveInside("outputs/topic/a.md"), `${ROOT}/outputs/topic/a.md`);
    assert.equal(policy.resolveInside(`${ROOT}/profiles/x/identity.md`), `${ROOT}/profiles/x/identity.md`);
  });

  it("拒绝越出仓库的路径", () => {
    assert.throws(
      () => policy.resolveInside("../outside.md"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.PATH_OUT_OF_SCOPE,
    );
    assert.throws(
      () => policy.resolveInside("/etc/passwd"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.PATH_OUT_OF_SCOPE,
    );
  });

  it("拒绝空路径", () => {
    assert.throws(
      () => policy.resolveInside("   "),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
    );
  });

  it("放行产物与画像写入", () => {
    const absolute = policy.resolveInside("outputs/topic/manifest.json");
    assert.equal(policy.assertWritable(absolute, "write-topics"), absolute);
    assert.deepEqual(policy.blockedWrites(), []);
  });

  it("拒绝上游写入并留痕（内容技艺库 / 共享脚本）", () => {
    for (const relative of ["skills/openclaw/x/SKILL.md", "skills/shared/scripts/content_guard.py"]) {
      const absolute = policy.resolveInside(relative);
      assert.throws(
        () => policy.assertWritable(absolute, "skill.write"),
        (error) => error instanceof EaselError && error.code === ERROR_CODES.UPSTREAM_READ_ONLY,
      );
    }
    const blocked = policy.blockedWrites();
    assert.equal(blocked.length, 2);
    assert.equal(blocked[0].path, "skills/openclaw/x/SKILL.md");
    assert.equal(blocked[0].operation, "skill.write");
    assert.equal(typeof blocked[0].at, "string");
  });

  it("审计列表是只读副本，且容量有上限", () => {
    const small = createPathPolicy({ repoRoot: ROOT, readOnlyPrefixes: ["skills"] });
    for (let index = 0; index < 150; index += 1) {
      assert.throws(() => small.assertWritable(`${ROOT}/skills/a${index}.md`, "skill.write"));
    }
    const blocked = small.blockedWrites();
    assert.equal(blocked.length, 100);
    // 只保留最近的一批。
    assert.equal(blocked[blocked.length - 1].path, "skills/a149.md");
    blocked.push({ path: "伪造" });
    assert.equal(small.blockedWrites().length, 100);
    small.clearBlockedWrites();
    assert.deepEqual(small.blockedWrites(), []);
  });

  it("未定位到仓库根时给出可读原因而不是写坏数据", () => {
    const unconfigured = createPathPolicy({ repoRoot: undefined, readOnlyPrefixes: ["skills"] });
    assert.throws(
      () => unconfigured.resolveInside("outputs/a.md"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it("toRelative 在未配置时原样返回，便于诊断输出", () => {
    const unconfigured = createPathPolicy({ repoRoot: undefined, readOnlyPrefixes: [] });
    assert.equal(unconfigured.toRelative("/srv/x.md"), "/srv/x.md");
    assert.equal(policy.toRelative(`${ROOT}/outputs/a.md`), "outputs/a.md");
  });
});

describe("错误码与结果包装", () => {
  it("错误码稳定且唯一", () => {
    const codes = Object.values(ERROR_CODES);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(ERROR_CODES.CONTENT_GUARD_BLOCKED, "content-guard-blocked");
  });

  it("attempt 把 EaselError 转成结构化失败", async () => {
    const result = await attempt(() => {
      throw new EaselError(ERROR_CODES.AUTH_EXPIRED, "登录态已过期", { details: { platform: "zhihu" } });
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "auth-expired");
    assert.equal(result.message, "登录态已过期");
    assert.deepEqual(result.details, { platform: "zhihu" });
  });

  it("attempt 把普通异常归到 invalid-input，不吞掉信息", async () => {
    const result = await attempt(() => {
      throw new TypeError("x is not a function");
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, ERROR_CODES.INVALID_INPUT);
    assert.match(result.message, /x is not a function/);
  });

  it("attempt 支持同步与异步成功路径", async () => {
    assert.deepEqual(await attempt(() => 42), { ok: true, value: 42 });
    assert.deepEqual(await attempt(async () => "ok"), { ok: true, value: "ok" });
  });

  it("ensure 只在条件不成立时抛出", () => {
    assert.equal(ensure(true, ERROR_CODES.NOT_FOUND, "不会抛出"), undefined);
    assert.throws(
      () => ensure(false, ERROR_CODES.NOT_FOUND, "没有这个项目"),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.NOT_FOUND,
    );
  });
});
