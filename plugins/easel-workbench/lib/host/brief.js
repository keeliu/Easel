/**
 * 自包含任务说明。
 *
 * 工作台派发的任务可能在新会话、也可能在若干小时后才被排期触发，因此说明
 * **必须脱离当前对话也能被独立理解**：只写任务目标、目标画像、期望产物这类
 * 自有信息，不写会话标识、不写临时路径、不用「上述/刚才」这种未命名指代。
 *
 * @module easel-workbench/host/brief
 */

import { ERROR_CODES, EaselError, ensure } from "./errors.js";

/** 任务说明的固定抬头，便于在会话里一眼认出是工作台派发的任务。 */
export const BRIEF_HEADER = "【Easel 创作任务】";

/** 抬头之外必须出现的字段（顺序即渲染顺序）。 */
export const BRIEF_FIELDS = Object.freeze(["任务目标", "主题", "目标画像", "目标平台", "期望产物", "执行要求"]);

/**
 * 禁止出现在任务说明里的指代与内部标识。
 *
 * 这些模式对应 tasks 7.1 的三类反例：会话标识、临时路径、未命名指代。
 */
export const FORBIDDEN_REFERENCES = Object.freeze([
  {
    id: "session-id",
    label: "会话标识",
    // 覆盖 DSH 自增 id（`session-12`）、本插件铸造的 id（`session-easel-…`）与十六进制 id；
    // 不匹配 `session-based` 这类普通英文词，避免误伤把整条任务说明拒掉。
    pattern: /\bsession-(?:\d[\w.-]*|easel-[\w.-]+|[0-9a-f]{8,})\b|\bsessionId\b|会话\s*(?:id|ID|[0-9a-f]{8}-)/i,
  },
  { id: "temp-path", label: "临时路径", pattern: /\/tmp\/|\/var\/folders\/|%TEMP%|\\AppData\\Local\\Temp/ },
  { id: "vague-reference", label: "未命名指代", pattern: /上述|刚刚说|刚才(?:说|提到)|前面提到|上文提到|如你(?:所说|所言)|同上/ },
]);

/** 截断到指定长度，避免标题过长。 */
function clip(text, max) {
  const value = String(text ?? "").trim();
  return value.length <= max ? value : value.slice(0, max);
}

/** 检查一段任务说明是否自包含；返回违规项，不抛错。 */
export function inspectSelfContained(text) {
  const source = String(text ?? "");
  return FORBIDDEN_REFERENCES.filter((entry) => entry.pattern.test(source)).map((entry) => ({
    id: entry.id,
    label: entry.label,
  }));
}

/** 断言任务说明自包含；命中则抛 `invalid-input`。 */
export function assertSelfContained(text) {
  const violations = inspectSelfContained(text);
  ensure(
    violations.length === 0,
    ERROR_CODES.INVALID_INPUT,
    `任务说明里出现了不应有的指代或内部标识：${violations.map((entry) => entry.label).join("、")}`,
    { details: { violations } },
  );
}

/**
 * 生成自包含的任务说明。
 *
 * @param {{
 *   goal: string,
 *   deliverable: string,
 *   topic?: string,
 *   profile?: string,
 *   platform?: string,
 *   notes?: string,
 * }} input
 */
export function buildTaskBrief(input) {
  const goal = String(input?.goal ?? "").trim();
  const deliverable = String(input?.deliverable ?? "").trim();
  ensure(goal !== "", ERROR_CODES.INVALID_INPUT, "任务说明缺少「任务目标」。");
  ensure(deliverable !== "", ERROR_CODES.INVALID_INPUT, "任务说明缺少「期望产物」。");
  const topic = clip(input.topic ?? goal, 40);
  const profile = String(input.profile ?? "").trim();
  const platform = String(input.platform ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  const lines = [
    BRIEF_HEADER,
    `任务目标：${goal}`,
    `主题：${topic}`,
    `目标画像：${profile === "" ? "通用模式（未指定画像）" : profile}`,
    `目标平台：${platform === "" ? "未指定" : platform}`,
    `期望产物：${deliverable}`,
  ];
  if (notes !== "") lines.push(`补充说明：${notes}`);
  lines.push(
    "执行要求：",
    "1. 先到 Easel 技能库找与任务匹配的 SKILL，按其流程与边界执行；没有精确匹配时复用最接近的 SKILL。",
    `2. 产出写入 outputs/${topic}/：成品放项目目录根，中间素材放其 assets/。`,
    "3. 真实产物才算完成；交付前按规格自检（文本看内容与字数，媒体看非空、数量、时长、分辨率、画幅）。",
    "4. 生图、生视频、音乐等按量计费操作先给范围与费用预估，等确认后再发请求。",
    "5. 对外发布前做内容安全扫描；命中敏感信息时删除相关内容后重发，不绕过。",
  );
  const text = `${lines.join("\n")}\n`;
  assertSelfContained(text);
  return text;
}
