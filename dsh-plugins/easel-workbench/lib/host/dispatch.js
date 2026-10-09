/**
 * 任务派发：把工作台里的一次创作交给 **DSH 会话** 执行。
 *
 * 关键约定（spec `workbench-task-dispatch`）：
 * - 任务以「一条用户消息」进入目标会话，内容 = 自包含任务说明（`lib/host/brief.js`）；
 * - **不介入模型路由**：创建会话时只透传 `ctx.agentDefaultModel.currentSelection()`
 *   给出的 provider/model，与 DSH 会话控制器 `dsh-api-session-controller/lib/types/agent.js:503-514`
 *   的做法一致；会话级模型选择由 DSH 自身生效；
 * - 绑定既有会话时优先复用**在跑的** agent，没有在跑的再 `resume`，避免重复拉起。
 *
 * @module easel-workbench/host/dispatch
 */

import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { ERROR_CODES, ensure } from "./errors.js";
import { assertSelfContained, buildTaskBrief } from "./brief.js";
import { EASEL_PRESET_ID } from "./persona.js";

/** 会话标识的合法形状（DSH 侧是品牌化字符串，这里只做输入校验）。 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** 单个附件的上限；超过时明确拒绝而不是静默截断。 */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

/** 派发目标。 */
export const DISPATCH_TARGETS = Object.freeze(["current-session", "new-session"]);

/**
 * 生成一个新的会话标识。
 *
 * 不用 `ctx.sessions.create()` 的隐式计数形式：派发需要**可读且带前缀**的标识，
 * 以便用户在会话列表里认出这是工作台开出来的会话。返回值仍需满足
 * `SESSION_ID_PATTERN`，且不存在时 `agents.create` 才会接受。
 */
export function mintSessionId(seed = Date.now(), random = Math.random) {
  const suffix = random().toString(36).slice(2, 8).padEnd(6, "0");
  return `session-easel-${seed.toString(36)}-${suffix}`;
}

/** 输入里的会话标识要么是合法字符串，要么必须省略。 */
export function ensureSessionId(value, label = "会话标识") {
  if (value === undefined || value === null || value === "") return undefined;
  ensure(
    typeof value === "string" && SESSION_ID_PATTERN.test(value),
    ERROR_CODES.INVALID_INPUT,
    `${label}格式不合法。`,
    { details: { value: String(value) } },
  );
  return value;
}

/**
 * 建立派发服务。
 *
 * @param {{ ctx: Record<string, any>, runtime: Record<string, any>, paths: Record<string, any> }} deps
 */
export function createDispatchService(deps) {
  const { ctx, runtime, paths } = deps;

  function requireAgents() {
    ensure(
      ctx?.agents !== undefined && typeof ctx.agents.create === "function" && typeof ctx.agents.get === "function",
      ERROR_CODES.NOT_CONFIGURED,
      "当前 DSH 运行环境没有 Agent 服务，无法把任务派发到会话。",
    );
    return ctx.agents;
  }

  /** 当前默认模型选择；读不到就返回 undefined（DSH 会在缺省时用自己的回落逻辑）。 */
  function currentSelection() {
    try {
      const selection = ctx?.agentDefaultModel?.currentSelection?.();
      if (selection === undefined || selection === null) return undefined;
      const { provider, model } = selection;
      if (typeof provider !== "string" || typeof model !== "string") return undefined;
      return { provider, model };
    } catch {
      return undefined;
    }
  }

  /** `agentOptions` 只透传 provider/model —— 与 DSH 会话控制器一致，不覆盖推理强度等其它项。 */
  function agentOptions() {
    const selection = currentSelection();
    return selection === undefined ? undefined : { provider: selection.provider, model: selection.model };
  }

  /** `easel` preset 是否已经注册（没有就不写 `meta.agentPreset`，避免创建失败）。 */
  function presetAvailable() {
    try {
      const registry = ctx?.agentPresets;
      if (registry === undefined) return false;
      if (typeof registry.list === "function") {
        const presets = registry.list();
        return Array.isArray(presets) && presets.some((entry) => entry?.id === EASEL_PRESET_ID);
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 新会话所属的工作区。
   *
   * 显式传入的 `workspace` 优先（对应 spec「显式指定的工作区优先」）；否则由本插件**显式指定**
   * Easel 数据根——派发出去的任务必须在 `outputs/`、`profiles/` 所在的工作区里干活，否则产物
   * 会落到别的工作区，内容库与画像都看不到它。两者都不存在时不写 `meta.cwd`，交给 DSH 自己
   * 的回落（`dsh-session` 只校验「给了就必须是绝对路径」）。
   */
  function resolveWorkspace(input) {
    const requested = input?.workspace;
    if (requested === undefined || requested === null || requested === "") {
      return runtime.easelRoot ?? runtime.repoRoot;
    }
    ensure(
      typeof requested === "string" && isAbsolute(requested),
      ERROR_CODES.INVALID_INPUT,
      "工作区必须是绝对路径。",
      { details: { workspace: String(requested) } },
    );
    return requested;
  }

  /**
   * 尽最大努力保证该目录已经登记为一个 DSH Workspace，这样新会话在侧边栏里会落到正确的
   * 工作区分组。能力缺失或登记失败都不影响派发本身——工作区登记是展示层的事。
   */
  async function ensureWorkspaceRegistered(directory) {
    const controller = ctx?.workspaceController;
    if (directory === undefined || controller === undefined) return;
    if (typeof controller.create !== "function") return;
    try {
      await controller.create({ path: directory });
    } catch {
      /* 登记失败不影响派发 */
    }
  }

  /** 把附件路径读成字节并交给 DSH 附件服务，返回可直接放进消息的 file 块。 */
  async function attachmentBlocks(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length === 0) return [];
    ensure(
      ctx?.attachments !== undefined && typeof ctx.attachments.saveFile === "function",
      ERROR_CODES.NOT_CONFIGURED,
      "当前 DSH 运行环境没有附件服务，无法附带文件。",
    );
    const blocks = [];
    for (const entry of list) {
      const requested = typeof entry === "string" ? entry : entry?.path;
      ensure(
        typeof requested === "string" && requested !== "",
        ERROR_CODES.INVALID_INPUT,
        "附件必须给出文件路径。",
      );
      const absolute = paths.resolveInside(requested);
      const info = await stat(absolute).catch(() => undefined);
      ensure(info !== undefined && info.isFile(), ERROR_CODES.NOT_FOUND, `附件不存在或不是文件：${requested}`, {
        details: { path: paths.toRelative(absolute) },
      });
      ensure(
        info.size <= MAX_ATTACHMENT_BYTES,
        ERROR_CODES.INVALID_INPUT,
        `附件超过 ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB 上限：${requested}`,
        { details: { bytes: info.size } },
      );
      const data = await readFile(absolute);
      const name = (typeof entry === "object" && entry?.name) || basename(absolute);
      const ref = await ctx.attachments.saveFile({ data: new Uint8Array(data), name });
      blocks.push({ type: "file", attachment: ref });
    }
    return blocks;
  }

  /** 组装要投递的消息：一个 text 块 + 若干 file 块。 */
  async function buildMessage(input, prompt) {
    assertSelfContained(prompt);
    const content = [{ type: "text", text: prompt }];
    const extras = await attachmentBlocks(input?.attachments);
    content.push(...extras);
    return { content, source: { kind: "user" } };
  }

  const service = {
    /** 环境能力快照，面板与自检都用它决定显示什么。 */
    capabilities() {
      const agents = ctx?.agents;
      return {
        agents: agents !== undefined && typeof agents.create === "function",
        resume: agents !== undefined && typeof agents.resume === "function",
        attachments: ctx?.attachments !== undefined && typeof ctx.attachments.saveFile === "function",
        agentPresets: presetAvailable(),
        defaultModel: currentSelection() !== undefined,
        schedule: ctx?.schedule !== undefined && typeof ctx.schedule.create === "function",
      };
    },

    /** 当前默认模型（只读展示；插件不修改它）。 */
    defaultModel() {
      return currentSelection() ?? null;
    },

    /** 派发目标：来自 Config，缺省为当前会话。 */
    target() {
      return runtime.taskDispatchTarget;
    },

    /**
     * 派发一次任务。
     *
     * @param {{
     *   prompt?: string,
     *   task?: object,
     *   sessionId?: string,
     *   target?: string,
     *   attachments?: Array<string | { path: string, name?: string }>,
     * }} input
     */
    async dispatch(input) {
      const agents = requireAgents();
      const target = input?.target ?? runtime.taskDispatchTarget;
      ensure(
        DISPATCH_TARGETS.includes(target),
        ERROR_CODES.INVALID_INPUT,
        `未知的派发目标：${String(target)}（可用值：${DISPATCH_TARGETS.join(" / ")}）。`,
      );
      const prompt = input?.prompt ?? buildTaskBrief(input?.task ?? {});
      const draft = await buildMessage(input, prompt);
      const message = createUserMessage(draft);
      const options = agentOptions();
      const requested = ensureSessionId(input?.sessionId);

      if (target === "new-session") {
        const sessionId = requested ?? mintSessionId();
        ensure(
          agents.get(sessionId) === undefined,
          ERROR_CODES.INVALID_INPUT,
          `会话 ${sessionId} 已存在，不能作为新会话创建。`,
          { details: { sessionId } },
        );
        const workspace = resolveWorkspace(input);
        await ensureWorkspaceRegistered(workspace);
        const meta = {};
        if (workspace !== undefined) meta.cwd = workspace;
        if (presetAvailable()) meta.agentPreset = EASEL_PRESET_ID;
        const handle = await agents.create({
          sessionId,
          ...(options === undefined ? {} : { agentOptions: options }),
          meta,
        });
        handle.agent.followup(message);
        return {
          sessionId,
          target,
          created: true,
          cwd: workspace ?? null,
          workspace: workspace ?? null,
          agentPreset: meta.agentPreset ?? null,
          model: options ?? null,
          attachmentCount: draft.content.length - 1,
          prompt,
        };
      }

      ensure(
        requested !== undefined,
        ERROR_CODES.INVALID_INPUT,
        "派发到既有会话时必须给出会话标识。",
      );
      let created = false;
      let agent = agents.get(requested);
      if (agent === undefined) {
        ensure(
          typeof agents.resume === "function",
          ERROR_CODES.NOT_CONFIGURED,
          "当前 DSH 运行环境没有 resume 能力，无法在非活跃会话上派发任务。",
        );
        const handle = await agents.resume({
          resumeSessionId: requested,
          ...(options === undefined ? {} : { agentOptions: options }),
        });
        agent = handle.agent;
        created = true;
      }
      agent.followup(message);
      return {
        sessionId: requested,
        target,
        created,
        cwd: runtime.easelRoot ?? runtime.repoRoot ?? null,
        agentPreset: null,
        model: options ?? null,
        attachmentCount: draft.content.length - 1,
        prompt,
      };
    },
  };

  return service;
}
