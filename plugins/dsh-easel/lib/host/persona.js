/**
 * 创作者人设与操作规则。
 *
 * 两条硬约束来自 spec `creator-persona` 与 tasks 5.6/5.7/5.8：
 * - 人设**只在该 preset 的 agent 作用域挂载**。`@deepseek-ai/dsh-persona` 的文档明确
 *   警告：未限定作用域的挂载会与提示词注册表自身的 persona 注册冲突并被拒绝。
 *   因此这里只**生成 preset 定义**，由 preset 注册表在 agent 作用域内组装。
 * - 人设文本**可配置**：`personaSource` / `rulesSource` 指向任意路径，默认用随包资源，
 *   因此不修改插件代码就能替换人设。
 *
 * 人设与规则落在两个不同的提示词段（prefix / suffix），既满足「独立系统提示词段」，
 * 又不会因为同名段重复注册而抛错。
 *
 * @module dsh-easel/host/persona
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { ERROR_CODES, EaselError, ensure } from "./errors.js";

/** preset 标识：会话创建入口按它显示「Easel 创作者」身份。 */
export const EASEL_PRESET_ID = "easel";

/** 随包人设资源（相对包根）。 */
export const PERSONA_ASSET = "assets/persona.md";

/** 随包操作规则资源（相对包根）。 */
export const RULES_ASSET = "assets/rules.md";

/** 技能提供方：把 `skillDirs` 作为自定义技能根挂进 preset。 */
export const SKILL_PROVIDER_PACKAGE = "@deepseek-ai/dsh-skill-filesystem";

/** 技能目录与调用的提供方。 */
export const SKILL_TOOL_PACKAGE = "@deepseek-ai/dsh-tool-skill";

/** 人设提示词段提供方。 */
export const PERSONA_PACKAGE = "@deepseek-ai/dsh-persona";

/**
 * preset 内的技能提供方**必须**换一个 provider 名。
 *
 * 全局已经有一个 `filesystem` 提供方；同名再注册会冲突。换名后它只是多一个根。
 */
export const EASEL_SKILL_PROVIDER_NAME = "easel-filesystem";

/** 操作规则段必须覆盖的四类条目（tasks 5.7）。 */
export const RULES_TOPICS = Object.freeze([
  { id: "skill-routing", label: "技能路由", heading: "## 技能路由" },
  { id: "information-first", label: "信息优先", heading: "## 信息优先" },
  { id: "paid-confirmation", label: "付费确认", heading: "## 付费确认" },
  { id: "artifact-convention", label: "产物约定", heading: "## 产物约定" },
]);

/**
 * 操作规则段**不得**包含的条目（tasks 5.7）。
 *
 * 这些内容属于 DSH 自身的职责：模型由会话/全局选择决定，会话存储与工具调用方式是
 * Harness 的实现细节，不属于创作者工作台的规则段。
 */
export const RULES_FORBIDDEN = Object.freeze([
  { id: "model-selection", label: "模型选择", pattern: /模型选择|选择模型|模型名|model_registry/ },
  { id: "session-storage", label: "会话存储", pattern: /会话存储/ },
  { id: "tool-invocation", label: "工具调用方式", pattern: /工具调用方式/ },
]);

/** 校验操作规则段内容；返回缺失项与越界项，不抛错。 */
export function validateRules(text) {
  const source = String(text ?? "");
  const missing = RULES_TOPICS.filter((topic) => !source.includes(topic.heading)).map((topic) => ({
    id: topic.id,
    label: topic.label,
  }));
  const forbidden = RULES_FORBIDDEN.filter((entry) => entry.pattern.test(source)).map((entry) => ({
    id: entry.id,
    label: entry.label,
  }));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

/**
 * 组装 `easel` preset 定义。
 *
 * 结构对应 tasks 5.6：创作者人设 + 操作规则提示词段 + 技能提供方。
 */
export function buildPresetDefinition(input) {
  const skillDirs = Array.isArray(input.skillDirs) ? input.skillDirs.filter((dir) => typeof dir === "string" && dir !== "") : [];
  const plugins = [
    {
      name: PERSONA_PACKAGE,
      config: { prefix: input.persona, suffix: input.rules },
    },
  ];
  if (skillDirs.length > 0) {
    plugins.push({
      name: SKILL_PROVIDER_PACKAGE,
      config: { providerName: EASEL_SKILL_PROVIDER_NAME, customSkillDirs: skillDirs },
    });
  }
  plugins.push({
    name: SKILL_TOOL_PACKAGE,
    config: { catalogDescriptionMaxLength: input.catalogDescriptionMaxLength },
  });
  return {
    id: EASEL_PRESET_ID,
    name: "Easel 创作者",
    description: "自带创作者人设、操作规则与 Easel 技能库的社媒内容会话。",
    order: 10,
    plugins,
  };
}

/**
 * 建立人设服务。
 *
 * @param {{ runtime: Record<string, any> }} deps
 */
export function createPersonaService(deps) {
  const { runtime } = deps;
  const packageRoot = runtime.packageRoot;

  function pathOf(configured, fallbackName) {
    if (typeof configured === "string" && configured.trim() !== "") {
      const trimmed = configured.trim();
      // 相对路径以插件包根为基准，与 `Config` 的解析保持一致，不依赖进程工作目录。
      return isAbsolute(trimmed) ? trimmed : resolve(packageRoot ?? process.cwd(), trimmed);
    }
    ensure(
      typeof packageRoot === "string" && packageRoot !== "",
      ERROR_CODES.NOT_CONFIGURED,
      "无法确定插件包根，因而读不到随包人设资源。",
    );
    return join(packageRoot, fallbackName);
  }

  async function readSource(path, label) {
    const text = await readFile(path, "utf8").catch((error) => {
      throw new EaselError(ERROR_CODES.NOT_FOUND, `读不到${label}：${path}`, {
        details: { path, cause: error instanceof Error ? error.message : String(error) },
      });
    });
    ensure(text.trim() !== "", ERROR_CODES.INVALID_INPUT, `${label}内容为空：${path}`, { details: { path } });
    return text;
  }

  const service = {
    /** 人设文本的解析路径（配置优先，否则随包资源）。 */
    personaPath: () => pathOf(runtime.personaSource, PERSONA_ASSET),
    /** 操作规则文本的解析路径。 */
    rulesPath: () => pathOf(runtime.rulesSource, RULES_ASSET),
    loadPersona: () => readSource(service.personaPath(), "人设文本"),
    loadRules: () => readSource(service.rulesPath(), "操作规则文本"),
    validateRules,
    /** 只读地报告人设来源与校验结果，供环境自检使用。 */
    async describe() {
      const personaPath = service.personaPath();
      const rulesPath = service.rulesPath();
      const persona = await readSource(personaPath, "人设文本");
      const rules = await readSource(rulesPath, "操作规则文本");
      return {
        personaPath,
        rulesPath,
        personaLength: persona.length,
        rulesLength: rules.length,
        rulesValidation: validateRules(rules),
        presetId: EASEL_PRESET_ID,
      };
    },
    /** 生成 preset 定义（不注册）。 */
    async preset() {
      const persona = await service.loadPersona();
      const rules = await service.loadRules();
      const definition = buildPresetDefinition({
        persona,
        rules,
        skillDirs: runtime.skillDirs,
        catalogDescriptionMaxLength: runtime.catalogDescriptionMaxLength,
      });
      return { definition, rulesValidation: validateRules(rules) };
    },
  };

  return service;
}
