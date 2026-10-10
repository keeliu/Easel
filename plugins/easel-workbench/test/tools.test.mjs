/**
 * 发布门禁守卫的测试。
 *
 * spec `platform-publishing` 要求「发布前强制内容安全扫描，命中即阻止，
 * 且 MUST NOT 提供任何绕过开关」。这组测试把这个约束钉在守卫的**行为**上，
 * 而不是钉在文案上：合法命令必须放行（否则工作台会寸步难行），
 * 绕过路径必须被拒（否则约束就是纸面的）。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  EXEC_FLAG,
  GUARDED_TOOL_NAMES,
  PUBLISH_SCRIPT_NAMES,
  SAFE_SCRIPT_NAMES,
  UNSAFE_FLAG,
  createPublishGuard,
  inspectCommand,
  referencedPublishScripts,
} from "../lib/host/tools.js";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

/**
 * 去掉注释与字符串字面量，只留下可执行代码。
 *
 * 这很重要：门禁模块的**文档注释**里会正面声明「这里不存在 allowUnsafe 之类的入参」，
 * 直接对全文做关键字扫描会把这种声明本身当成违规。
 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("referencedPublishScripts", () => {
  it("认出真正会发出内容的脚本", () => {
    for (const name of PUBLISH_SCRIPT_NAMES) {
      assert.deepEqual(referencedPublishScripts(`python3 skills/shared/scripts/${name} --exec`), [name]);
    }
  });

  it("publish.py 只在微信/跨平台技能的路径下才算发布脚本", () => {
    assert.deepEqual(referencedPublishScripts("python3 skills/openclaw/skill-wechat-publisher/publish.py"), [
      "publish.py",
    ]);
    assert.deepEqual(referencedPublishScripts("python3 ~/my/publish.py"), []);
  });
});

describe("inspectCommand", () => {
  it("放行空命令与普通命令", () => {
    assert.equal(inspectCommand("").blocked, false);
    assert.equal(inspectCommand("ls -la outputs/").blocked, false);
    assert.equal(inspectCommand("git status").blocked, false);
  });

  it("放行扫描类脚本（它们不发出内容）", () => {
    for (const name of SAFE_SCRIPT_NAMES) {
      const verdict = inspectCommand(`python3 skills/shared/scripts/${name} check --text x`);
      assert.equal(verdict.blocked, false, `${name} 不应被拦下`);
    }
  });

  it("放行发布脚本的 dry-run（不带 --exec）", () => {
    const verdict = inspectCommand("python3 skills/shared/scripts/xhs_publish.py --title 标题 --dry-run");
    assert.equal(verdict.blocked, false);
    assert.deepEqual(verdict.scripts, ["xhs_publish.py"]);
  });

  it("拒绝绕过内容扫描的 --allow-unsafe 开关", () => {
    const verdict = inspectCommand(`python3 skills/shared/scripts/content_guard.py ${UNSAFE_FLAG}`);
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, "unsafe-flag");
    assert.match(verdict.reason, /内容安全/);
  });

  it("拒绝直接调用发布脚本并带 --exec", () => {
    const verdict = inspectCommand(`python3 skills/shared/scripts/xhs_publish.py ${EXEC_FLAG} --title 标题`);
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, "direct-publish");
    assert.deepEqual(verdict.scripts, ["xhs_publish.py"]);
  });

  it("不把脚本名里的子串误判成开关", () => {
    assert.equal(inspectCommand("cat skills/shared/scripts/xhs_publish.py").blocked, false);
    assert.equal(inspectCommand("echo '--execute'").blocked, false);
    assert.equal(inspectCommand("echo not--exec").blocked, false);
  });
});

describe("createPublishGuard", () => {
  const guard = createPublishGuard();

  it("只盯住能起进程的工具", () => {
    for (const name of ["read", "write", "edit", "glob"]) {
      assert.equal(
        guard({ name, arguments: { command: `python3 xhs_publish.py ${EXEC_FLAG}` } }),
        undefined,
        `${name} 不在守卫范围内`,
      );
    }
    assert.deepEqual(GUARDED_TOOL_NAMES, ["bash", "pwsh"]);
  });

  it("对 bash/pwsh 的可疑命令返回拒绝理由（字符串）", () => {
    for (const name of GUARDED_TOOL_NAMES) {
      const reason = guard({ name, arguments: { command: `python3 xhs_publish.py ${EXEC_FLAG}` } });
      assert.equal(typeof reason, "string");
      assert.notEqual(reason, "");
    }
  });

  it("对合法命令返回 undefined（放行信号）", () => {
    assert.equal(guard({ name: "bash", arguments: { command: "ls" } }), undefined);
    assert.equal(guard({ name: "bash", arguments: {} }), undefined);
    assert.equal(guard({ name: "bash" }), undefined);
  });

  it("不因入参异常而抛错（守卫抛错会阻断整个工具链）", () => {
    assert.equal(guard(undefined), undefined);
    assert.equal(guard(null), undefined);
    assert.equal(guard({ name: "bash", arguments: null }), undefined);
    assert.equal(guard({ name: "bash", arguments: { command: 42 } }), undefined);
  });
});

describe("不存在绕过开关（防回归）", () => {
  it("守卫与门禁模块不暴露任何跳过参数", () => {
    const modules = ["../lib/host/tools.js", "../lib/host/gate.js", "../lib/host/publish.js"];
    const forbidden = /\b(skipGuard|bypass|skipScan|allowUnsafe|forcePublish|noScan|disableGuard|overrideGate)\b/;
    for (const path of modules) {
      const code = codeOnly(source(path));
      const hit = code.match(forbidden);
      assert.equal(hit, null, `${path} 出现疑似绕过标识符：${hit?.[0]}`);
    }
  });

  it("门禁服务的公开方法只接受内容入参，没有跳过位", () => {
    const code = codeOnly(source("../lib/host/gate.js"));
    assert.match(code, /return \{ scan, assertSafe, scorePersona \};/);
    assert.equal(/function assertSafe\(([^)]*)\)/.test(code), true);
    const signature = code.match(/function assertSafe\(([^)]*)\)/)?.[1] ?? "";
    assert.equal(signature.trim(), "input");
  });

  it("守卫工厂与命令检查函数都不接受开关参数", () => {
    const code = codeOnly(source("../lib/host/tools.js"));
    assert.equal(/function createPublishGuard\(([^)]*)\)/.test(code), true);
    assert.equal((code.match(/function createPublishGuard\(([^)]*)\)/)?.[1] ?? "x").trim(), "");
    assert.equal((code.match(/function inspectCommand\(([^)]*)\)/)?.[1] ?? "x,y").trim(), "command");
  });
});
