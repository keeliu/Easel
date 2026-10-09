/**
 * 创作者数据视图的测试（画像 / 内容库 / 选题库 / 排期 / 文本）。
 *
 * 这一层的核心风险是**破坏既有数据**：`profiles/`、`outputs/`、`outputs/_ideas.json`、
 * `outputs/_schedule.json` 都已存在真实格式，插件读写必须逐字节对齐既有脚本。
 * 因此测试用真实临时目录与真实文件，断言落盘后的文件内容（而不是只断言返回值）。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PROFILE_DIMENSIONS } from "../lib/host/config.js";
import {
  INLINE_PREVIEW_MAX_BYTES,
  MANIFEST_NAME,
  PROFILE_NAME_PATTERN,
  SCHEDULE_KINDS,
  SCHEDULE_STATUSES,
  TOPIC_STATUSES,
  createDataService,
  deliveryOf,
  ensureProfileName,
  ensureTopic,
  mediaKindOf,
  newId,
  nowSeconds,
} from "../lib/host/data.js";
import { ERROR_CODES, EaselError } from "../lib/host/errors.js";
import { createPathPolicy } from "../lib/host/paths.js";

/** 造一个最小 Easel 仓库：profiles/ + outputs/ + skills/。 */
async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "easel-data-"));
  await mkdir(join(root, "skills", "openclaw"), { recursive: true });
  await writeFile(join(root, "skills", "openclaw", "upstream.md"), "上游内容\n", "utf8");
  await mkdir(join(root, "profiles", "_template"), { recursive: true });
  for (const dimension of PROFILE_DIMENSIONS) {
    await writeFile(join(root, "profiles", "_template", `${dimension}.md`), `# ${dimension} 模板\n`, "utf8");
  }
  await mkdir(join(root, "profiles", ".hidden"), { recursive: true });
  await mkdir(join(root, "outputs", "_scratch"), { recursive: true });
  await mkdir(join(root, "outputs"), { recursive: true });

  const runtime = {
    repoRoot: root,
    easelRoot: root,
    profilesDir: join(root, "profiles"),
    outputsDir: join(root, "outputs"),
    topicsFile: join(root, "outputs", "_ideas.json"),
    scheduleFile: join(root, "outputs", "_schedule.json"),
    skillDirs: [join(root, "skills", "openclaw")],
  };
  const paths = createPathPolicy({ repoRoot: root, readOnlyPrefixes: ["skills"] });
  return { root, runtime, paths, data: createDataService({ paths, runtime }) };
}

/** 造一个既有格式的画像（只有部分维度）。 */
async function writeLegacyProfile(root, name, dimensions) {
  const dir = join(root, "profiles", name);
  await mkdir(dir, { recursive: true });
  for (const [dimension, text] of Object.entries(dimensions)) {
    await writeFile(join(dir, `${dimension}.md`), text, "utf8");
  }
}

/** 造一个既有格式的内容项目。 */
async function writeProject(root, topic, { manifest, files = {} } = {}) {
  const dir = join(root, "outputs", topic);
  await mkdir(join(dir, "assets"), { recursive: true });
  if (manifest !== undefined) {
    await writeFile(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf8");
  }
  return dir;
}

describe("纯函数", () => {
  it("mediaKindOf 按扩展名判定，未知扩展名算普通文件", () => {
    assert.equal(mediaKindOf("a.JPG"), "image");
    assert.equal(mediaKindOf("a.mp4"), "video");
    assert.equal(mediaKindOf("a.md"), "file");
    assert.equal(mediaKindOf("noext"), "file");
  });

  it("deliveryOf：非媒体与超大文件走下载，其余可内联预览", () => {
    assert.deepEqual(deliveryOf("file", 10), { mode: "download", reason: "not-media" });
    assert.deepEqual(deliveryOf("image", INLINE_PREVIEW_MAX_BYTES + 1), { mode: "download", reason: "too-large" });
    assert.deepEqual(deliveryOf("image", Number.NaN), { mode: "download", reason: "too-large" });
    assert.deepEqual(deliveryOf("image", 1024), { mode: "preview", reason: null });
  });

  it("newId 为 12 位十六进制，nowSeconds 为秒", () => {
    const id = newId();
    assert.equal(id.length, 12);
    assert.equal(/^[0-9a-f]{12}$/.test(id), true);
    assert.equal(Math.abs(nowSeconds() - Math.floor(Date.now() / 1000)) <= 1, true);
  });

  it("画像名与项目名校验拒绝越界形状", () => {
    assert.equal(ensureProfileName("户外装备号"), "户外装备号");
    assert.equal(ensureTopic(" 露营装备测评 "), "露营装备测评");
    assert.equal(PROFILE_NAME_PATTERN.test("a".repeat(64)), true);
    assert.equal(PROFILE_NAME_PATTERN.test("a".repeat(65)), false);
    for (const bad of ["", "_template", ".hidden", "../逃逸", "a/b", null, 42]) {
      assert.throws(
        () => ensureProfileName(bad),
        (error) => error instanceof EaselError && error.code === ERROR_CODES.INVALID_INPUT,
        `应拒绝画像名：${String(bad)}`,
      );
    }
    for (const bad of ["", "   ", "_scratch", ".git", "a/b", "a\\b", undefined]) {
      assert.throws(
        () => ensureTopic(bad),
        (error) => error.code === ERROR_CODES.INVALID_INPUT,
        `应拒绝项目名：${String(bad)}`,
      );
    }
  });
});

describe("画像", () => {
  it("列出画像：跳过 _template 与隐藏目录，标注维度齐全度", async () => {
    const { root, data } = await makeRepo();
    await writeLegacyProfile(root, "户外装备号", {
      identity: "# identity\n",
      style: "# style\n",
      audience: "# audience\n",
      platforms: "# platforms\n",
      preferences: "# preferences\n",
      memory: "# memory\n",
    });
    await writeLegacyProfile(root, "半成品号", { identity: "# identity\n" });

    const listed = await data.listProfiles();
    assert.deepEqual(listed.profiles.map((profile) => profile.name), ["半成品号", "户外装备号"]);
    assert.deepEqual(listed.profiles[0].dimensions.map((entry) => entry.dimension), ["identity"]);
    assert.equal(listed.profiles[0].complete, false);
    assert.equal(listed.profiles[1].complete, true);
    assert.equal(listed.profiles[1].dimensions.length, PROFILE_DIMENSIONS.length);
    assert.equal(listed.templateDir, "_template");
    assert.equal(listed.path, join(root, "profiles"));
  });

  it("既有格式（无 frontmatter 的纯 Markdown）直接可读", async () => {
    const { root, data } = await makeRepo();
    await writeLegacyProfile(root, "户外装备号", { identity: "# identity\n只做户外装备。\n" });
    const profile = await data.readProfile("户外装备号");
    assert.deepEqual(Object.keys(profile.dimensions), ["identity"]);
    assert.equal(profile.dimensions.identity.includes("只做户外装备"), true);
  });

  it("读取不存在的画像抛 not-found 并带名字", async () => {
    const { data } = await makeRepo();
    await assert.rejects(
      () => data.readProfile("不存在号"),
      (error) => {
        assert.equal(error.code, ERROR_CODES.NOT_FOUND);
        assert.equal(error.details.profile, "不存在号");
        return true;
      },
    );
  });

  it("新建画像从 _template 复制六个维度，且立即可列出", async () => {
    const { data } = await makeRepo();
    const created = await data.createProfile("新号");
    assert.deepEqual(created.dimensions, [...PROFILE_DIMENSIONS]);
    const listed = await data.listProfiles();
    assert.deepEqual(listed.profiles.map((profile) => profile.name), ["新号"]);
    const profile = await data.readProfile("新号");
    assert.equal(Object.keys(profile.dimensions).length, PROFILE_DIMENSIONS.length);
    assert.equal(profile.dimensions.identity, "# identity 模板\n");
  });

  it("重复新建同名画像被拒", async () => {
    const { data } = await makeRepo();
    await data.createProfile("新号");
    await assert.rejects(
      () => data.createProfile("新号"),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });

  it("写单个维度落盘为纯 Markdown，且拒绝未知维度", async () => {
    const { root, data } = await makeRepo();
    await data.createProfile("新号");
    const result = await data.writeProfileDimension("新号", "preferences", "# preferences\n不看恐怖片。\n");
    assert.equal(result.bytes > 0, true);
    const text = await readFile(join(root, "profiles", "新号", "preferences.md"), "utf8");
    assert.equal(text, "# preferences\n不看恐怖片。\n");
    await assert.rejects(
      () => data.writeProfileDimension("新号", "不存在的维度", "x"),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.deepEqual(error.details.dimensions, [...PROFILE_DIMENSIONS]);
        return true;
      },
    );
    await assert.rejects(
      () => data.writeProfileDimension("新号", "preferences", 42),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });

  it("画像目录名带路径分隔符时写入被拒（不能越出 profiles/）", async () => {
    const { data } = await makeRepo();
    await assert.rejects(
      () => data.writeProfileDimension("../逃逸", "identity", "x"),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });

  it("未定位仓库时抛 not-configured", async () => {
    const paths = createPathPolicy({ repoRoot: "/tmp/easel-not-configured", readOnlyPrefixes: ["skills"] });
    const data = createDataService({ paths, runtime: {} });
    await assert.rejects(
      () => data.listProfiles(),
      (error) => error.code === ERROR_CODES.NOT_CONFIGURED,
    );
    await assert.rejects(
      () => data.listProjects(),
      (error) => error.code === ERROR_CODES.NOT_CONFIGURED,
    );
    await assert.rejects(
      () => data.persistTopics([]),
      (error) => error.code === ERROR_CODES.NOT_CONFIGURED,
    );
  });
});

describe("内容库", () => {
  it("按项目分组、读 manifest、跳过系统目录", async () => {
    const { root, data } = await makeRepo();
    await writeProject(root, "露营装备测评", {
      manifest: {
        title: "三件套测评",
        summary: "轻量露营装备",
        platform: "douyin",
        kind: "video",
        status: "draft",
        profile: "户外装备号",
        created: "2025-01-01T00:00:00Z",
        updated: "2025-06-01T00:00:00Z",
        tags: ["露营", 42],
        deliverables: ["final.mp4"],
        steps: [{ layer: "制作" }, { layer: "发布" }],
      },
      files: { "final.md": "# 脚本\n", "assets/cover.jpg": "binary-ish" },
    });

    const listed = await data.listProjects();
    assert.equal(listed.skippedSystem, 1, "_scratch 计入系统目录");
    assert.deepEqual(listed.projects.map((project) => project.topic), ["露营装备测评"]);
    const project = listed.projects[0];
    assert.equal(project.title, "三件套测评");
    assert.deepEqual(project.tags, ["露营"]);
    assert.equal(project.stepCount, 2);
    assert.deepEqual(project.layers, ["制作", "发布"]);
    assert.equal(project.manifestPresent, true);
    assert.equal(project.fileCount, 2);
    assert.equal(project.hasPreview, true, "有可预览的图片");
  });

  it("没有 manifest 的项目也能列出（不猜元数据）", async () => {
    const { root, data } = await makeRepo();
    await writeProject(root, "随手项目", { files: { "note.txt": "内容" } });
    const project = (await data.listProjects()).projects[0];
    assert.equal(project.manifestPresent, false);
    assert.equal(project.status, "draft");
    assert.equal(project.title, "");
    assert.deepEqual(project.tags, []);
    assert.equal(project.fileCount, 1);
  });

  it("文件清单带相对路径、类型与投递方式；manifest 自身不出现在清单里", async () => {
    const { root, data } = await makeRepo();
    await writeProject(root, "露营装备测评", {
      manifest: { title: "x" },
      files: { "final.md": "a", "assets/cover.jpg": "b" },
    });
    const detail = await data.listProjectFiles("露营装备测评");
    assert.deepEqual(
      detail.files.map((file) => file.path).sort(),
      ["assets/cover.jpg", "final.md"],
    );
    const cover = detail.files.find((file) => file.name === "cover.jpg");
    assert.equal(cover.kind, "image");
    assert.equal(cover.delivery.mode, "preview");
    const markdown = detail.files.find((file) => file.name === "final.md");
    assert.deepEqual(markdown.delivery, { mode: "download", reason: "not-media" });
    assert.equal(detail.limit, 500);
    assert.equal(detail.files.some((file) => file.name === MANIFEST_NAME), false);
  });

  it("读取不存在的项目抛 not-found；非法项目名被拒", async () => {
    const { data } = await makeRepo();
    await assert.rejects(
      () => data.listProjectFiles("不存在"),
      (error) => {
        assert.equal(error.code, ERROR_CODES.NOT_FOUND);
        assert.equal(error.details.topic, "不存在");
        return true;
      },
    );
    await assert.rejects(
      () => data.listProjectFiles("_scratch"),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });

  it("大文件不导致读取失败（只取 stat，不读内容）", async () => {
    const { root, data } = await makeRepo();
    const dir = await writeProject(root, "大文件项目", {});
    await writeFile(join(dir, "big.bin"), Buffer.alloc(INLINE_PREVIEW_MAX_BYTES + 1024));
    const detail = await data.listProjectFiles("大文件项目");
    const big = detail.files.find((file) => file.name === "big.bin");
    assert.equal(big.delivery.mode, "download");
    assert.equal(big.delivery.reason, "not-media");
  });
});

describe("选题库", () => {
  it("文件不存在时返回空库，并给出状态词表", async () => {
    const { data } = await makeRepo();
    const listed = await data.listTopics();
    assert.deepEqual(listed.topics, []);
    assert.equal(listed.skipped, 0);
    assert.deepEqual(listed.statuses, TOPIC_STATUSES);
  });

  it("读取既有格式的顶层数组；坏条目只计数不丢库", async () => {
    const { root, data } = await makeRepo();
    await writeFile(
      join(root, "outputs", "_ideas.json"),
      `${JSON.stringify([
        { id: "abc123abc123", title: "露营选题", note: "备注", source: "hot", status: "doing", created: 1700000000 },
        { title: "缺 id 的条目" },
        null,
        "字符串",
        { id: "x", title: 42 },
        { id: "y", title: "未知状态", status: "乱写" },
      ], null, 2)}\n`,
      "utf8",
    );
    const listed = await data.listTopics();
    assert.equal(listed.skipped, 3, "null / 字符串 / title 非字符串各计一条");
    assert.deepEqual(listed.topics.map((topic) => topic.title), ["露营选题", "缺 id 的条目", "未知状态"]);
    assert.equal(listed.topics[0].status, "doing");
    assert.equal(listed.topics[0].created, 1700000000);
    assert.equal(listed.topics[2].status, "pending", "未知状态回落 pending");
    assert.equal(typeof listed.topics[1].id, "string", "缺 id 时补一个");
  });

  it("非法 JSON 抛 invalid-input 并带路径", async () => {
    const { root, data } = await makeRepo();
    await writeFile(join(root, "outputs", "_ideas.json"), "{不是 JSON", "utf8");
    await assert.rejects(
      () => data.listTopics(),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INVALID_INPUT);
        assert.equal(error.details.path, join(root, "outputs", "_ideas.json"));
        return true;
      },
    );
  });

  it("新增后刷新仍存在，落盘格式与既有 web/app.py 一致", async () => {
    const { root, data } = await makeRepo();
    const created = await data.addTopic({ title: " 露营选题 ", note: "备注", source: "hot" });
    assert.equal(created.title, "露营选题");
    assert.equal(created.status, "pending");
    assert.equal(/^[0-9a-f]{12}$/.test(created.id), true);

    const raw = await readFile(join(root, "outputs", "_ideas.json"), "utf8");
    assert.equal(raw.endsWith("}\n]") || raw.endsWith("\n"), true);
    const parsed = JSON.parse(raw);
    assert.equal(Array.isArray(parsed), true, "顶层必须是数组");
    assert.deepEqual(Object.keys(parsed[0]).sort(), ["created", "id", "note", "source", "status", "title"]);
    // indent=2：第二行以两个空格开头
    assert.equal(raw.split("\n")[1].startsWith("  "), true);
    assert.equal(raw.includes("\\u"), false, "不得把中文转义（ensure_ascii=False 等价）");

    const listed = await data.listTopics();
    assert.deepEqual(listed.topics.map((topic) => topic.title), ["露营选题"]);
  });

  it("新增置顶，状态可流转，删除后消失", async () => {
    const { root, data } = await makeRepo();
    await writeFile(
      join(root, "outputs", "_ideas.json"),
      `${JSON.stringify([{ id: "old", title: "旧选题", status: "pending", created: 1 }], null, 2)}\n`,
      "utf8",
    );
    const created = await data.addTopic({ title: "新选题" });
    let listed = await data.listTopics();
    assert.deepEqual(listed.topics.map((topic) => topic.title), ["新选题", "旧选题"]);

    const updated = await data.updateTopic(created.id, { status: "doing", note: "在做了" });
    assert.equal(updated.status, "doing");
    assert.equal(updated.note, "在做了");
    listed = await data.listTopics();
    assert.equal(listed.topics.find((topic) => topic.id === created.id).status, "doing");

    assert.deepEqual(await data.removeTopic(created.id), { id: created.id, removed: true });
    listed = await data.listTopics();
    assert.deepEqual(listed.topics.map((topic) => topic.title), ["旧选题"]);
  });

  it("非法状态不写入、缺标题被拒、改删不存在的条目抛 not-found", async () => {
    const { data } = await makeRepo();
    await assert.rejects(
      () => data.addTopic({ title: "   " }),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
    const created = await data.addTopic({ title: "选题" });
    const updated = await data.updateTopic(created.id, { status: "不存在的状态" });
    assert.equal(updated.status, "pending");
    await assert.rejects(
      () => data.updateTopic("不存在", { title: "x" }),
      (error) => error.code === ERROR_CODES.NOT_FOUND,
    );
    await assert.rejects(
      () => data.removeTopic("不存在"),
      (error) => error.code === ERROR_CODES.NOT_FOUND,
    );
  });
});

describe("排期（只读）", () => {
  it("读取既有格式：状态与类型词表来自既有脚本，未知值回落", async () => {
    const { root, data } = await makeRepo();
    await writeFile(
      join(root, "outputs", "_schedule.json"),
      `${JSON.stringify([
        { id: "s1", title: "发布预告", date: "2025-07-01", time: "09:00", kind: "content", status: "scheduled" },
        { id: "s2", title: "线下活动", end_date: "2025-07-02", event_type: "线下", kind: "event", status: "published" },
        { id: "s3", title: "未知值回落" },
        { title: 42 },
      ], null, 2)}\n`,
      "utf8",
    );
    const listed = await data.listSchedule();
    assert.equal(listed.skipped, 1);
    assert.deepEqual(listed.statuses, SCHEDULE_STATUSES);
    assert.deepEqual(listed.kinds, SCHEDULE_KINDS);
    assert.equal(listed.items.length, 3);
    assert.equal(listed.items[0].status, "scheduled");
    assert.equal(listed.items[1].kind, "event");
    assert.equal(listed.items[1].endDate, "2025-07-02");
    assert.equal(listed.items[2].kind, "content");
    assert.equal(listed.items[2].status, "idea");
    assert.equal(listed.items[2].source, "manual");
  });

  it("读取排期不修改文件，也不存在写接口（写入交给 DSH 排期）", async () => {
    const { root, data } = await makeRepo();
    const file = join(root, "outputs", "_schedule.json");
    const original = `${JSON.stringify([{ id: "s1", title: "发布预告", status: "idea" }], null, 2)}\n`;
    await writeFile(file, original, "utf8");
    const before = await stat(file);
    await data.listSchedule();
    const after = await stat(file);
    assert.equal(await readFile(file, "utf8"), original);
    assert.deepEqual(after.mtimeMs, before.mtimeMs);

    for (const name of Object.keys(data)) {
      assert.equal(/persistSchedule|writeSchedule|saveSchedule/.test(name), false, `不应存在排期写接口：${name}`);
    }
  });

  it("排期文件不存在时返回空视图；非法 JSON 抛 invalid-input", async () => {
    const { root, data } = await makeRepo();
    assert.deepEqual((await data.listSchedule()).items, []);
    await writeFile(join(root, "outputs", "_schedule.json"), "[]", "utf8");
    assert.deepEqual((await data.listSchedule()).items, []);
    await writeFile(join(root, "outputs", "_schedule.json"), "不是 JSON", "utf8");
    await assert.rejects(
      () => data.listSchedule(),
      (error) => error.code === ERROR_CODES.INVALID_INPUT,
    );
  });
});

describe("文本读写与上游只读保护", () => {
  it("读文本可用，越出仓库被拒，超上限被拒", async () => {
    const { root, data } = await makeRepo();
    const read = await data.readText({ path: join(root, "skills", "openclaw", "upstream.md") });
    assert.equal(read.text, "上游内容\n");
    assert.equal(read.relative, "skills/openclaw/upstream.md");
    await assert.rejects(
      () => data.readText({ path: "/etc/hostname" }),
      (error) => error.code === ERROR_CODES.PATH_OUT_OF_SCOPE,
    );
    await assert.rejects(
      () => data.readText({ path: join(root, "outputs", "big.txt"), maxBytes: 1 }),
      (error) => error.code === ERROR_CODES.NOT_FOUND,
    );
  });

  it("写上游 skills/ 被拒且文件内容未变，并留下审计", async () => {
    const { root, paths, data } = await makeRepo();
    const target = join(root, "skills", "openclaw", "upstream.md");
    await assert.rejects(
      () => data.writeText({ path: target, text: "被改写", operation: "write-upstream" }),
      (error) => error.code === ERROR_CODES.UPSTREAM_READ_ONLY,
    );
    assert.equal(await readFile(target, "utf8"), "上游内容\n");
    const audit = paths.blockedWrites();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].path, "skills/openclaw/upstream.md");
    assert.equal(audit[0].operation, "write-upstream");
    await assert.rejects(
      () => data.removeFile({ path: target }),
      (error) => error.code === ERROR_CODES.UPSTREAM_READ_ONLY,
    );
    assert.equal(await readFile(target, "utf8"), "上游内容\n");
  });

  it("产物目录可写，返回字节数", async () => {
    const { root, data } = await makeRepo();
    const result = await data.writeText({ path: join(root, "outputs", "新建项目", "note.txt"), text: "内容" });
    assert.equal(result.relative, "outputs/新建项目/note.txt");
    assert.equal(result.bytes, Buffer.byteLength("内容", "utf8"));
    assert.equal(await readFile(result.path, "utf8"), "内容");
  });

  it("内部工具可复用（internals）", async () => {
    const { data } = await makeRepo();
    for (const name of ["readTextIfAny", "writeTextAtomic", "readJsonIfAny", "collectProjectFiles"]) {
      assert.equal(typeof data.internals[name], "function", `缺少 internals.${name}`);
    }
  });
});
