/**
 * 可投递会话目录。
 *
 * 工作台的「投递到既有会话」需要一个可选目标列表。**真相源只能是 DSH 自己**：
 * 这里先看当前存活的 agent（`ctx.agents.roots()`），再尽力从宿主注册的会话存储
 * 补全那些没有存活 agent 的会话。插件不新建事件类型、不扫描会话事件、不自己
 * 维护一份会话表（spec `workbench-task-dispatch`）。
 *
 * 会话存储的服务键在不同 DSH 版本上可能不同，因此按候选名在运行时探测，
 * 探测不到就退化为「只有存活 agent」的列表，并如实说明原因。
 *
 * @module easel-workbench/host/sessions
 */

import { attempt } from "./errors.js";
import { serviceOf } from "./services.js";

/** 宿主会话存储可能的服务键（按优先级）。 */
export const SESSION_STORE_KEYS = Object.freeze(["sessionStore", "sessions"]);

/** 从会话对象上尽力取一个人类可读标题。 */
function titleOf(session, id) {
  const header = session?.header ?? session?.meta ?? undefined;
  const candidates = [
    session?.title,
    header?.title,
    session?.meta?.title,
    typeof header?.cwd === "string" ? header.cwd.split("/").filter(Boolean).pop() : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return id;
}

/**
 * 建立会话目录服务。
 *
 * @param {{ ctx: Record<string, any> }} deps
 */
export function createSessionCatalog(deps) {
  const { ctx } = deps;

  function store() {
    for (const key of SESSION_STORE_KEYS) {
      const candidate = attempt(() => ctx?.get?.(key));
      if (candidate.ok && candidate.value !== undefined && candidate.value !== null) {
        return { key, service: candidate.value };
      }
    }
    return undefined;
  }

  return {
    /** 当前是否至少有一种会话来源可用。 */
    available() {
      return typeof serviceOf(ctx, "agents")?.roots === "function" || store() !== undefined;
    },

    /**
     * 列出候选投递目标。
     *
     * 返回 `{sessions, sources, reason}`：`sources` 说明本次列表由哪些来源拼成，
     * `reason` 在完全没有来源时给出可读解释（而不是假装没有会话）。
     */
    async list() {
      const byId = new Map();
      const sources = [];

      const roots = attempt(() => {
        const agents = serviceOf(ctx, "agents");
        return typeof agents?.roots === "function" ? agents.roots() : [];
      });
      if (roots.ok) {
        const agents = Array.isArray(roots.value) ? roots.value : [];
        sources.push("agents.roots");
        for (const agent of agents) {
          const id = agent?.session?.id ?? agent?.id ?? agent?.sessionId;
          if (typeof id !== "string" || id === "") continue;
          byId.set(id, {
            id,
            title: titleOf(agent?.session, id),
            cwd: agent?.session?.header?.meta?.cwd ?? agent?.session?.meta?.cwd ?? null,
            preset: agent?.session?.header?.meta?.agentPreset ?? null,
            running: true,
            source: "agent",
          });
        }
      }

      const found = store();
      if (found !== undefined) {
        const listed = await attempt(() => found.service.list());
        if (listed.ok) {
          const sessions = Array.isArray(listed.value) ? listed.value : [];
          sources.push(found.key);
          for (const session of sessions) {
            const id = session?.id;
            if (typeof id !== "string" || id === "") continue;
            const existing = byId.get(id);
            byId.set(id, {
              id,
              title: titleOf(session, id),
              cwd: session?.header?.meta?.cwd ?? session?.meta?.cwd ?? existing?.cwd ?? null,
              preset: session?.header?.meta?.agentPreset ?? existing?.preset ?? null,
              running: existing?.running ?? false,
              source: existing === undefined ? "store" : "agent+store",
            });
          }
        }
      }

      const sessions = [...byId.values()];
      return {
        sessions,
        sources,
        reason:
          sessions.length > 0 || sources.length > 0
            ? null
            : "当前 DSH 未暴露可读取的会话来源，无法列出可投递的会话。可在下方直接填写会话标识。",
      };
    },
  };
}
