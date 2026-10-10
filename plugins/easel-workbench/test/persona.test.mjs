/**
 * 创作者人设与操作规则的测试。
 *
 * spec `creator-persona` 的硬约束：人设与规则是两个独立的系统提示词段；
 * 人设只在该 preset 的 agent 作用域挂载（因此这里只**生成** preset 定义、不注册）；
 * 规则段必须覆盖四类条目，且不得写模型选择 / 会话存储 / 工具调用方式。
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ERROR_CODES, EaselError } from "../lib/host/errors.js";
import {
  EASEL_PRESET_ID,
  EASEL_SKILL_PROVIDER_NAME,
  PERSONA_ASSET,
  PERSONA_PACKAGE,
  RULES_ASSET,
  RULES_FORBIDDEN,
  RULES_TOPICS,
  SKILL_PROVIDER_PACKAGE,
  SKILL_TOOL_PACKAGE,
  buildPresetDefinition,
  createPersonaService,
  validateRules,
} from "../lib/host/persona.js";

const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;

/** 一份满足全部要求的规则文本。 */
const GOOD_RULES = [
  "# 规则",
  "## 技能路由",
  "先找精确匹配的 SKILL。",
  "## 信息优先",
  "先查再问，不编数据。",
  "## 付费确认",
  "按量计费操作先给费用预估。",
  "## 产物约定",
  "产物放 outputs/<主题>/。",
].join("\n");

describe("常量", () => {
  it("preset 标识与提供方名固定（面板与会话入口都按它们对齐）", () => {
    assert.equal(EASEL_PRESET_ID, "easel");
    assert.equal(EASEL_SKILL_PROVIDER_NAME, "easel-filesystem");
    assert.equal(PERSONA_ASSET, "assets/persona.md");
    assert.equal(RULES_ASSET, "assets/rules.md");
    assert.equal(PERSONA_PACKAGE, "@deepseek-ai/dsh-persona");
    assert.equal(SKILL_PROVIDER_PACKAGE, "@deepseek-ai/dsh-skill-filesystem");
    assert.equal(SKILL_TOOL_PACKAGE, "@deepseek-ai/dsh-tool-skill");
  });

  it("技能提供方名不能沿用全局的 filesystem（同名注册会冲突）", () => {
    assert.notEqual(EASEL_SKILL_PROVIDER_NAME, "filesystem");
  });

  it("四类规则条目与三类禁区条目齐全", () => {
    assert.deepEqual(RULES_TOPICS.map((topic) => topic.id), [
      "skill-routing",
      "information-first",
      "paid-confirmation",
      "artifact-convention",
    ]);
    assert.deepEqual(RULES_FORBIDDEN.map((entry) => entry.id), [
      "model-selection",
      "session-storage",
      "tool-invocation",
    ]);
  });
});

describe("validateRules", () => {
  it("四段齐全且无越界内容时 ok", () => {
    const result = validateRules(GOOD_RULES);
    assert.deepEqual(result, { ok: true, missing: [], forbidden: [] });
  });

  it("缺哪一段就点名哪一段，不抛错", () => {
    const result = validateRules("## 技能路由\n## 信息优先\n## 付费确认");
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, [{ id: "artifact-convention", label: "产物约定" }]);
  });

  it("越界内容按 id 点名", () => {
    const result = validateRules(`${GOOD_RULES}\n模型选择由会话决定。`);
    assert.equal(result.ok, false);
    assert.deepEqual(result.forbidden, [{ id: "model-selection", label: "模型选择" }]);
  });

  it("空输入视为全部缺失", () => {
    const result = validateRules(undefined);
    assert.equal(result.missing.length, RULES_TOPICS.length);
  });
});

describe("buildPresetDefinition", () => {
  it("结构为「人设段 + 技能提供方 + 技能工具」，标识与排序稳定", () => {
    const definition = buildPresetDefinition({
      persona: "人设文本",
      rules: "规则文本",
      skillDirs: ["/srv/easel/skills/openclaw"],
      catalogDescriptionMaxLength: 500,
    });
    assert.equal(definition.id, "easel");
    assert.equal(definition.name, "Easel 创作者");
    assert.equal(definition.order, 10);
    assert.deepEqual(
      definition.plugins.map((plugin) => plugin.name),
      [PERSONA_PACKAGE, SKILL_PROVIDER_PACKAGE, SKILL_TOOL_PACKAGE],
    );
    // 人设与规则落在同一个提供方的 prefix / suffix 两段，互不覆盖
    assert.deepEqual(definition.plugins[0].config, { prefix: "人设文本", suffix: "规则文本" });
    assert.deepEqual(definition.plugins[1].config, {
      providerName: "easel-filesystem",
      customSkillDirs: ["/srv/easel/skills/openclaw"],
    });
    assert.deepEqual(definition.plugins[2].config, { catalogDescriptionMaxLength: 500 });
  });

  it("没有技能目录时不挂技能提供方（避免空根）", () => {
    for (const skillDirs of [undefined, [], [""], [null]]) {
      const definition = buildPresetDefinition({ persona: "p", rules: "r", skillDirs });
      assert.deepEqual(
        definition.plugins.map((plugin) => plugin.name),
        [PERSONA_PACKAGE, SKILL_TOOL_PACKAGE],
      );
    }
  });

  it("混入的非字符串技能目录被过滤", () => {
    const definition = buildPresetDefinition({
      persona: "p",
      rules: "r",
      skillDirs: ["/a", 42, "", "/b"],
      catalogDescriptionMaxLength: 300,
    });
    assert.deepEqual(definition.plugins[1].config.customSkillDirs, ["/a", "/b"]);
  });
});

describe("createPersonaService", () => {
  it("默认从插件包的 assets 读取人设与规则", async () => {
    const service = createPersonaService({ runtime: { packageRoot: PACKAGE_ROOT } });
    assert.equal(service.personaPath(), join(PACKAGE_ROOT, PERSONA_ASSET));
    assert.equal(service.rulesPath(), join(PACKAGE_ROOT, RULES_ASSET));
    const persona = await service.loadPersona();
    const rules = await service.loadRules();
    assert.equal(persona.startsWith("# Easel — 人格"), true);
    assert.equal(rules.startsWith("# Easel 操作规则"), true);
  });

  it("随包规则文本本身通过校验（防回归：不能发布自相矛盾的资源）", async () => {
    const service = createPersonaService({ runtime: { packageRoot: PACKAGE_ROOT } });
    const result = validateRules(await service.loadRules());
    assert.deepEqual(result, { ok: true, missing: [], forbidden: [] });
  });

  it("配置可替换人设与规则来源（相对路径按插件包根解析，绝对路径原样）", () => {
    const absolute = createPersonaService({
      runtime: { packageRoot: PACKAGE_ROOT, personaSource: "/srv/persona.md", rulesSource: "/srv/rules.md" },
    });
    assert.equal(absolute.personaPath(), "/srv/persona.md");
    assert.equal(absolute.rulesPath(), "/srv/rules.md");

    const relative = createPersonaService({
      runtime: { packageRoot: PACKAGE_ROOT, personaSource: "custom/persona.md" },
    });
    assert.equal(relative.personaPath(), join(PACKAGE_ROOT, "custom", "persona.md"));
    assert.equal(relative.rulesPath(), join(PACKAGE_ROOT, RULES_ASSET), "未配置的一项回落到随包资源");
  });

  it("读不到文件抛 not-found 并带路径", async () => {
    const service = createPersonaService({
      runtime: { packageRoot: PACKAGE_ROOT, personaSource: join(tmpdir(), "不存在的-easel-persona.md") },
    });
    await assert.rejects(
      () => service.loadPersona(),
      (error) => {
        assert.equal(error.code, ERROR_CODES.NOT_FOUND);
        assert.equal(typeof error.details.path, "string");
        return true;
      },
    );
  });

  it("人设内容为空抛 invalid-input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "easel-persona-"));
    const empty = join(dir, "empty.md");
    await writeFile(empty, "   \n", "utf8");
    const service = createPersonaService({ runtime: { packageRoot: PACKAGE_ROOT, personaSource: empty } });
    await assert.rejects(
      () => service.loadPersona(),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });

  it("没有包根又没有配置时抛 not-configured（面板据此提示）", async () => {
    const service = createPersonaService({ runtime: {} });
    // 路径解析是同步的，任何调用方（含面板预检）都会立刻拿到可读错误
    assert.throws(
      () => service.personaPath(),
      (error) => error instanceof EaselError && error.code === ERROR_CODES.NOT_CONFIGURED,
    );
    await assert.rejects(
      async () => {
        await service.loadPersona();
      },
      (error) => error instanceof EaselError && error.code === ERROR_CODES.NOT_CONFIGURED,
    );
  });

  it("describe() 给出路径、长度、校验结果与 preset 标识", async () => {
    const service = createPersonaService({ runtime: { packageRoot: PACKAGE_ROOT } });
    const described = await service.describe();
    assert.equal(described.personaPath, join(PACKAGE_ROOT, PERSONA_ASSET));
    assert.equal(described.rulesPath, join(PACKAGE_ROOT, RULES_ASSET));
    assert.equal(described.personaLength > 0, true);
    assert.equal(described.rulesLength > 0, true);
    assert.equal(described.rulesValidation.ok, true);
    assert.equal(described.presetId, EASEL_PRESET_ID);
  });

  it("preset() 用真实资源生成定义与校验结论", async () => {
    const service = createPersonaService({
      runtime: { packageRoot: PACKAGE_ROOT, skillDirs: ["/srv/skills/openclaw"], catalogDescriptionMaxLength: 500 },
    });
    const { definition, rulesValidation } = await service.preset();
    assert.equal(definition.id, "easel");
    assert.equal(rulesValidation.ok, true);
    assert.equal(definition.plugins[0].config.prefix.startsWith("# Easel — 人格"), true);
    assert.equal(definition.plugins[0].config.suffix.startsWith("# Easel 操作规则"), true);
    assert.deepEqual(definition.plugins[1].config.customSkillDirs, ["/srv/skills/openclaw"]);
  });
});
