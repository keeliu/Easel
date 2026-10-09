/**
 * 任务派发服务测试（对应 tasks.md 5.2 / 5.3 / 5.4 与 spec `workbench-task-dispatch`）。
 *
 * 全部用注入的假依赖：不启动 agent、不联网、不跑 python。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath, isAbsolute } from "node:path";

import {
  DISPATCH_TARGETS,
  MAX_ATTACHMENT_BYTES,
  SESSION_ID_PATTERN,
  createDispatchService,
  ensureSessionId,
  mintSessionId,
} from "../lib/host/dispatch.js";
import { EASEL_PRESET_ID } from "../lib/host/persona.js";

const CLEAN_PROMPT = "请围绕「秋季穿搭」产出三篇图文，产物放到本期项目目录里。";

function makePaths(root) {
  return {
    resolveInside(relative) {
      const absolute = isAbsolute(relative) ? relative : resolvePath(root, relative);
      return absolute;
    },
    toRelative(absolute) {
      return absolute.startsWith(root) ? absolute.slice(root.length + 1) : absolute;
    },
  };
}

function makeRuntime(overrides = {}) {
  return {
    easelRoot: "/srv/easel",
    repoRoot: "/srv/easel",
    taskDispatchTarget: "current-session",
    ...overrides,
  };
}

/** 假 agent handle：记录 followup/steer 收到的消息。 */
function makeAgent() {
  const agent = { messages: [], followups: 0 };
  agent.followup = (message) => {
    agent.followups += 1;
    agent.messages.push(message);
  };
  return agent;
}

/**
 * 假插件上下文。
 *
 * 真实 cordis 上下文**只允许**读取静态 `inject` 里声明过的服务属性，其余服务一律经
 * `ctx.get(name)` 读取（未提供时返回 undefined）；测试替身照此实现（服务同时挂在
 * 属性上，便于断言调用记录），否则测出来的行为与宿主运行时不符。
 */
function makeCtx(services = {}) {
  return { ...services, get: (name) => services[name] };
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "easel-dispatch-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mintSessionId 生成带前缀且满足会话标识规范的新标识", () => {
  const id = mintSessionId(12345, () => 0.5);
  assert.match(id, SESSION_ID_PATTERN);
  assert.ok(id.startsWith("session-easel-"));
  assert.equal(id, mintSessionId(12345, () => 0.5));
  assert.notEqual(id, mintSessionId(12346, () => 0.5));
  // 随机源返回接近 0 时也要有足够长度（右补齐）
  assert.match(mintSessionId(1, () => 0), SESSION_ID_PATTERN);
});

test("ensureSessionId 只接受合法字符串，其余明确拒绝", () => {
  assert.equal(ensureSessionId(undefined), undefined);
  assert.equal(ensureSessionId(null), undefined);
  assert.equal(ensureSessionId(""), undefined);
  assert.equal(ensureSessionId("session-42abc"), "session-42abc");
  assert.equal(ensureSessionId("session-easel-m3k9-7f2a1b"), "session-easel-m3k9-7f2a1b");

  for (const bad of ["有 空格", "../etc/passwd", "-leading-dash", "a".repeat(129), 42, {}]) {
    assert.throws(
      () => ensureSessionId(bad),
      (error) => {
        assert.equal(error.code, "invalid-input");
        assert.deepEqual(error.details, { value: String(bad) });
        return true;
      },
      `应拒绝：${String(bad)}`,
    );
  }
});

test("派发目标常量与附件上限固定", () => {
  assert.deepEqual([...DISPATCH_TARGETS], ["current-session", "new-session"]);
  assert.ok(Object.isFrozen(DISPATCH_TARGETS));
  assert.equal(MAX_ATTACHMENT_BYTES, 64 * 1024 * 1024);
});

test("capabilities 如实反映 DSH 环境提供与缺失的能力", () => {
  const empty = createDispatchService({ ctx: {}, runtime: makeRuntime(), paths: makePaths("/srv/easel") });
  assert.deepEqual(empty.capabilities(), {
    agents: false,
    resume: false,
    attachments: false,
    agentPresets: false,
    defaultModel: false,
    schedule: false,
  });

  const full = createDispatchService({
    ctx: makeCtx({
      agents: { create() {}, get() {}, resume() {} },
      attachments: { saveFile() {} },
      agentPresets: { list: () => [{ id: EASEL_PRESET_ID }] },
      agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
      schedule: { create() {} },
    }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });
  assert.deepEqual(full.capabilities(), {
    agents: true,
    resume: true,
    attachments: true,
    agentPresets: true,
    defaultModel: true,
    schedule: true,
  });
});

test("defaultModel 只透传 provider/model，读不到就返回 null", () => {
  const read = (selection) => {
    const service = createDispatchService({
      ctx: makeCtx({ agentDefaultModel: { currentSelection: () => selection } }),
      runtime: makeRuntime(),
      paths: makePaths("/srv/easel"),
    });
    return service.defaultModel();
  };

  assert.deepEqual(read({ provider: "p", model: "m", reasoningEffort: "high" }), { provider: "p", model: "m" });
  assert.equal(read(undefined), null);
  assert.equal(read(null), null);
  assert.equal(read({ provider: "p" }), null);
  assert.equal(read({ provider: 1, model: 2 }), null);

  const throwing = createDispatchService({
    ctx: makeCtx({
      agentDefaultModel: {
        currentSelection() {
          throw new Error("boom");
        },
      },
    }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });
  assert.equal(throwing.defaultModel(), null);
});

test("target() 回显配置里的派发目标", () => {
  const service = createDispatchService({
    ctx: {},
    runtime: makeRuntime({ taskDispatchTarget: "new-session" }),
    paths: makePaths("/srv/easel"),
  });
  assert.equal(service.target(), "new-session");
});

test("缺少 Agent 服务时派发明确报错，而不是静默失败", async () => {
  const service = createDispatchService({ ctx: {}, runtime: makeRuntime(), paths: makePaths("/srv/easel") });
  await assert.rejects(
    () => service.dispatch({ prompt: CLEAN_PROMPT, target: "new-session" }),
    (error) => error.code === "not-configured",
  );
});

test("未知派发目标被拒绝，且不创建任何会话", async () => {
  let created = 0;
  const service = createDispatchService({
    ctx: makeCtx({ agents: { create: () => (created += 1), get: () => undefined } }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });
  await assert.rejects(
    () => service.dispatch({ prompt: CLEAN_PROMPT, target: "somewhere-else" }),
    (error) => {
      assert.equal(error.code, "invalid-input");
      assert.match(error.message, /current-session \/ new-session/);
      return true;
    },
  );
  assert.equal(created, 0);
});

test("5.2 绑定既有会话：复用正在跑的 agent，会话标识不变、不产生平行会话", async () => {
  const agent = makeAgent();
  const resumed = [];
  const service = createDispatchService({
    ctx: makeCtx({
      agents: {
        get: (sessionId) => (sessionId === "session-42" ? agent : undefined),
        resume: async (request) => {
          resumed.push(request);
          return { agent };
        },
        create: () => assert.fail("绑定既有会话时不应创建新会话"),
      },
      agentDefaultModel: { currentSelection: () => ({ provider: "deepseek", model: "chat" }) },
    }),
    runtime: makeRuntime({ taskDispatchTarget: "current-session" }),
    paths: makePaths("/srv/easel"),
  });

  const result = await service.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-42" });

  assert.equal(result.sessionId, "session-42");
  assert.equal(result.created, false);
  assert.equal(result.target, "current-session");
  assert.equal(result.agentPreset, null);
  assert.deepEqual(result.model, { provider: "deepseek", model: "chat" });
  assert.equal(result.attachmentCount, 0);
  assert.equal(resumed.length, 0, "在跑的 agent 应被直接复用");
  assert.equal(agent.followups, 1);

  const [message] = agent.messages;
  assert.equal(message.role, "user");
  assert.equal(message.source.kind, "user");
  assert.deepEqual(message.content, [{ type: "text", text: CLEAN_PROMPT }]);
});

test("5.2 绑定既有会话：没有在跑的 agent 时先 resume 再投递", async () => {
  const agent = makeAgent();
  const resumed = [];
  const service = createDispatchService({
    ctx: makeCtx({
      agents: {
        get: () => undefined,
        create: () => assert.fail("绑定既有会话时不应创建新会话"),
        resume: async (request) => {
          resumed.push(request);
          return { agent };
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });

  const result = await service.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-7" });

  assert.equal(result.created, true);
  assert.equal(result.sessionId, "session-7");
  assert.deepEqual(resumed, [{ resumeSessionId: "session-7", agentOptions: { provider: "p", model: "m" } }]);
  assert.equal(agent.followups, 1);
});

test("5.2 绑定既有会话：没有 resume 能力时明确报错；缺少会话标识时被拒绝", async () => {
  const noResume = createDispatchService({
    ctx: makeCtx({ agents: { get: () => undefined, create() {} } }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });
  await assert.rejects(
    () => noResume.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-7" }),
    (error) => error.code === "not-configured",
  );

  const service = createDispatchService({
    ctx: makeCtx({ agents: { get: () => makeAgent(), create() {} } }),
    runtime: makeRuntime({ taskDispatchTarget: "current-session" }),
    paths: makePaths("/srv/easel"),
  });
  await assert.rejects(
    () => service.dispatch({ prompt: CLEAN_PROMPT }),
    (error) => {
      assert.equal(error.code, "invalid-input");
      assert.match(error.message, /必须给出会话标识/);
      return true;
    },
  );
});

test("5.3 新开会话：默认落在 Easel 数据根，并按需登记为 DSH Workspace", async () => {
  const agent = makeAgent();
  const created = [];
  const registered = [];
  const service = createDispatchService({
    ctx: makeCtx({
      agents: {
        get: () => undefined,
        create: async (request) => {
          created.push(request);
          return { agent };
        },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: "deepseek", model: "chat", reasoningEffort: "high" }) },
      workspaceController: {
        create: async (request) => {
          registered.push(request);
          return { workspace: { path: request.path }, created: true };
        },
      },
    }),
    runtime: makeRuntime({ easelRoot: "/srv/easel" }),
    paths: makePaths("/srv/easel"),
  });

  const result = await service.dispatch({ prompt: CLEAN_PROMPT, target: "new-session" });

  assert.equal(result.created, true);
  assert.equal(result.target, "new-session");
  assert.equal(result.workspace, "/srv/easel");
  assert.equal(result.cwd, "/srv/easel");
  assert.match(result.sessionId, SESSION_ID_PATTERN);
  assert.ok(result.sessionId.startsWith("session-easel-"), `应是本插件铸造的标识：${result.sessionId}`);
  assert.deepEqual(registered, [{ path: "/srv/easel" }]);
  assert.equal(created.length, 1);
  assert.equal(created[0].sessionId, result.sessionId);
  assert.deepEqual(created[0].meta, { cwd: "/srv/easel" });
  assert.deepEqual(created[0].agentOptions, { provider: "deepseek", model: "chat" });
  assert.equal(agent.followups, 1);
});

test("5.3 显式指定的工作区优先于 Easel 数据根，且必须是绝对路径", async () => {
  const agent = makeAgent();
  const created = [];
  const service = createDispatchService({
    ctx: makeCtx({
      agents: {
        get: () => undefined,
        create: async (request) => {
          created.push(request);
          return { agent };
        },
      },
    }),
    runtime: makeRuntime({ easelRoot: "/srv/easel" }),
    paths: makePaths("/srv/easel"),
  });

  const result = await service.dispatch({
    prompt: CLEAN_PROMPT,
    target: "new-session",
    workspace: "/srv/other-workspace",
  });
  assert.equal(result.workspace, "/srv/other-workspace");
  assert.deepEqual(created[0].meta, { cwd: "/srv/other-workspace" });

  await assert.rejects(
    () => service.dispatch({ prompt: CLEAN_PROMPT, target: "new-session", workspace: "relative/path" }),
    (error) => {
      assert.equal(error.code, "invalid-input");
      assert.deepEqual(error.details, { workspace: "relative/path" });
      return true;
    },
  );
  assert.equal(created.length, 1, "非法工作区不应创建会话");
});

test("5.3 两级工作区都缺失时不写 meta.cwd，交给 DSH 自己的回落", async () => {
  const created = [];
  const service = createDispatchService({
    ctx: makeCtx({
      agents: {
        get: () => undefined,
        create: async (request) => {
          created.push(request);
          return { agent: makeAgent() };
        },
      },
    }),
    runtime: makeRuntime({ easelRoot: undefined, repoRoot: undefined }),
    paths: makePaths("/srv/easel"),
  });

  const result = await service.dispatch({ prompt: CLEAN_PROMPT, target: "new-session" });
  assert.equal("cwd" in created[0].meta, false);
  assert.equal(result.cwd, null);
  assert.equal(result.workspace, null);
});

test("5.3 已存在的会话标识不能当作新会话创建；工作区登记失败不影响派发", async () => {
  const service = createDispatchService({
    ctx: makeCtx({
      agents: {
        get: (sessionId) => (sessionId === "session-easel-1-abcdef" ? makeAgent() : undefined),
        create: () => assert.fail("已存在的会话不应再次创建"),
      },
      workspaceController: {
        create: async () => {
          throw new Error("登记失败");
        },
      },
    }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });

  await assert.rejects(
    () => service.dispatch({ prompt: CLEAN_PROMPT, target: "new-session", sessionId: "session-easel-1-abcdef" }),
    (error) => {
      assert.equal(error.code, "invalid-input");
      assert.deepEqual(error.details, { sessionId: "session-easel-1-abcdef" });
      return true;
    },
  );
});

test("5.4 taskDispatchTarget 缺省派发到当前会话；配成新会话时不写当前会话", async () => {
  const agent = makeAgent();
  const created = [];
  const agents = {
    get: (sessionId) => (sessionId === "session-9" ? agent : undefined),
    create: async (request) => {
      created.push(request);
      return { agent: makeAgent() };
    },
  };
  const paths = makePaths("/srv/easel");

  const toCurrent = createDispatchService({ ctx: makeCtx({ agents }), runtime: makeRuntime(), paths });
  const first = await toCurrent.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-9" });
  assert.equal(first.target, "current-session");
  assert.equal(agent.followups, 1);
  assert.equal(created.length, 0);

  const toNew = createDispatchService({
    ctx: makeCtx({ agents }),
    runtime: makeRuntime({ taskDispatchTarget: "new-session" }),
    paths,
  });
  const second = await toNew.dispatch({ prompt: CLEAN_PROMPT });
  assert.equal(second.target, "new-session");
  assert.notEqual(second.sessionId, "session-9");
  assert.equal(agent.followups, 1, "当前会话不应被写入该任务");
  assert.equal(created.length, 1);
});

test("5.6 preset 只在已注册时写入 meta，缺注册表时不写", async () => {
  const created = [];
  const makeService = (agentPresets) =>
    createDispatchService({
      ctx: makeCtx({
        agents: {
          get: () => undefined,
          create: async (request) => {
            created.push(request);
            return { agent: makeAgent() };
          },
        },
        ...(agentPresets === undefined ? {} : { agentPresets }),
      }),
      runtime: makeRuntime(),
      paths: makePaths("/srv/easel"),
    });

  const withPreset = await makeService({ list: () => [{ id: "other" }, { id: EASEL_PRESET_ID }] }).dispatch({
    prompt: CLEAN_PROMPT,
    target: "new-session",
  });
  assert.equal(withPreset.agentPreset, EASEL_PRESET_ID);
  assert.equal(created.at(-1).meta.agentPreset, EASEL_PRESET_ID);

  const withoutPreset = await makeService({ list: () => [{ id: "other" }] }).dispatch({
    prompt: CLEAN_PROMPT,
    target: "new-session",
  });
  assert.equal(withoutPreset.agentPreset, null);
  assert.equal("agentPreset" in created.at(-1).meta, false);

  const noRegistry = await makeService(undefined).dispatch({ prompt: CLEAN_PROMPT, target: "new-session" });
  assert.equal(noRegistry.agentPreset, null);
  assert.equal("agentPreset" in created.at(-1).meta, false);
});

test("5.4 任务说明自包含：含会话标识的说明被拒绝，缺省时用任务简报生成", async () => {
  const agent = makeAgent();
  const service = createDispatchService({
    ctx: makeCtx({ agents: { get: () => agent, create: () => assert.fail("不该创建会话") } }),
    runtime: makeRuntime(),
    paths: makePaths("/srv/easel"),
  });

  await assert.rejects(
    () => service.dispatch({ prompt: "接着 session-42 的进度继续。", sessionId: "session-42" }),
    (error) => {
      assert.equal(error.code, "invalid-input");
      assert.ok(Array.isArray(error.details.violations));
      assert.deepEqual(
        error.details.violations.map((entry) => entry.id),
        ["session-id"],
      );
      return true;
    },
  );
  assert.equal(agent.followups, 0);

  const generated = await service.dispatch({
    sessionId: "session-42",
    task: {
      goal: "为秋季穿搭主题产出一篇图文",
      deliverable: "一篇图文（标题、正文、封面建议）",
      persona: "生活方式号",
      platforms: ["xiaohongshu"],
    },
  });
  assert.match(generated.prompt, /秋季穿搭/);
  assert.equal(agent.followups, 1);
  assert.match(agent.messages.at(-1).content[0].text, /秋季穿搭/);
});

test("附件走 DSH 附件能力：字节、名称与 file 块正确，越界与超限被拒绝", async () => {
  await withTempDir(async (root) => {
    const paths = makePaths(root);
    const saved = [];
    const agent = makeAgent();
    const service = createDispatchService({
      ctx: makeCtx({
        agents: { get: () => agent, create: () => assert.fail("不该创建会话") },
        attachments: {
          saveFile: async ({ data, name }) => {
            saved.push({ data, name });
            return { id: `att-${saved.length}` };
          },
        },
      }),
      runtime: makeRuntime(),
      paths,
    });

    const filePath = join(root, "brief.txt");
    await writeFile(filePath, "素材内容", "utf8");

    const result = await service.dispatch({
      prompt: CLEAN_PROMPT,
      sessionId: "session-42",
      attachments: [filePath, { path: filePath, name: "自定义名称.txt" }],
    });

    assert.equal(result.attachmentCount, 2);
    assert.equal(saved.length, 2);
    assert.ok(saved[0].data instanceof Uint8Array);
    assert.equal(Buffer.from(saved[0].data).toString("utf8"), "素材内容");
    assert.equal(saved[0].name, "brief.txt");
    assert.equal(saved[1].name, "自定义名称.txt");
    assert.deepEqual(agent.messages.at(-1).content.slice(1), [
      { type: "file", attachment: { id: "att-1" } },
      { type: "file", attachment: { id: "att-2" } },
    ]);

    // 不存在的附件
    await assert.rejects(
      () => service.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-42", attachments: [join(root, "nope.txt")] }),
      (error) => {
        assert.equal(error.code, "not-found");
        assert.equal(error.details.path, "nope.txt");
        return true;
      },
    );

    // 空路径
    await assert.rejects(
      () => service.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-42", attachments: [{}] }),
      (error) => error.code === "invalid-input",
    );

    // 超过上限（稀疏文件，不占磁盘）
    const bigPath = join(root, "big.bin");
    await writeFile(bigPath, "");
    await truncate(bigPath, MAX_ATTACHMENT_BYTES + 1);
    await assert.rejects(
      () => service.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-42", attachments: [bigPath] }),
      (error) => {
        assert.equal(error.code, "invalid-input");
        assert.equal(error.details.bytes, MAX_ATTACHMENT_BYTES + 1);
        assert.match(error.message, /64MB/);
        return true;
      },
    );

    // 环境没有附件能力时明确报错
    const noAttachments = createDispatchService({
      ctx: makeCtx({ agents: { get: () => agent, create() {} } }),
      runtime: makeRuntime(),
      paths,
    });
    await assert.rejects(
      () => noAttachments.dispatch({ prompt: CLEAN_PROMPT, sessionId: "session-42", attachments: [filePath] }),
      (error) => error.code === "not-configured",
    );
    assert.equal(saved.length, 2, "被拒绝的附件不应写进附件服务");
  });
});
