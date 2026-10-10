/**
 * 创作者数据视图：画像、内容库、选题库与排期。
 *
 * **格式兼容是这一层的硬要求**：Easel 仓库里已经存在真实数据文件，本插件读写的
 * 格式必须与既有脚本完全一致，否则就会破坏用户既有产出。已对齐的既有格式：
 *
 * - `profiles/<名字>/<维度>.md` —— 纯 Markdown，维度固定六个，**没有 frontmatter**。
 * - `outputs/<主题>/.easel.json` —— 项目元数据（见 `_repo/skills/shared/scripts/manifest.py`）。
 * - `outputs/_ideas.json` —— 选题库，**顶层 JSON 数组**，条目
 *   `{id, title, note, source, status, created}`，状态 `pending|doing|done`
 *   （见 `_repo/web/app.py:4336-4376`）。
 * - `outputs/_schedule.json` —— 排期，**顶层 JSON 数组**，状态
 *   `idea|draft|scheduled|published`，类型 `content|event`（见 `calendar_ops.py`）。
 *
 * 所有落盘都经过路径策略（`lib/host/paths.js`），因此上游只读前缀之下的写入会在
 * 这里被拒绝，而不是由调用方自觉。
 *
 * @module easel-workbench/host/data
 */

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { ERROR_CODES, EaselError, attempt, ensure } from "./errors.js";
import { MEDIA_EXTENSIONS, PROFILE_DIMENSIONS, PROFILE_TEMPLATE_DIR } from "./config.js";

/** 单个项目列出的文件数上限，避免超大目录拖垮面板。 */
export const MAX_LISTED_FILES = 500;

/** 可直接内联预览的单文件体积上限（4 MiB）。 */
export const INLINE_PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

/** 单次文本读取的字节上限。 */
export const MAX_TEXT_BYTES = 256 * 1024;

/** 画像目录名的允许形状：首字符为字母或数字，其后允许 `._-`。 */
export const PROFILE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;

/** Easel 既有选题状态（`web/app.py:IDEA_STATUSES`）。 */
export const TOPIC_STATUSES = Object.freeze(["pending", "doing", "done"]);

/** Easel 既有排期状态。 */
export const SCHEDULE_STATUSES = Object.freeze(["idea", "draft", "scheduled", "published"]);

/** Easel 既有排期类型。 */
export const SCHEDULE_KINDS = Object.freeze(["content", "event"]);

/** 项目元数据文件名（与 `manifest.py` 的 `MANIFEST_NAME` 一致）。 */
export const MANIFEST_NAME = ".easel.json";

/** 产物类型判定。 */
export function mediaKindOf(path) {
  const extension = extname(path).toLowerCase();
  for (const [kind, extensions] of Object.entries(MEDIA_EXTENSIONS)) {
    if (extensions.includes(extension)) return kind;
  }
  return "file";
}

/**
 * 决定一个文件在面板里是内联预览还是下载。
 *
 * 非媒体文件与超过 4 MiB 的文件都走下载，避免把面板卡死。
 */
export function deliveryOf(kind, bytes) {
  if (kind === "file") return { mode: "download", reason: "not-media" };
  if (!Number.isFinite(bytes) || bytes > INLINE_PREVIEW_MAX_BYTES) {
    return { mode: "download", reason: "too-large" };
  }
  return { mode: "preview", reason: null };
}

/** 安全地把任意值读成字符串。 */
function asText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/** 生成与 Easel 既有脚本一致的 12 位十六进制 id。 */
export function newId() {
  return Math.floor(Math.random() * 0xffffffffffff)
    .toString(16)
    .padStart(12, "0")
    .slice(-12);
}

/** 当前时间的 Unix 秒（既有 `_ideas.json` 用的就是秒）。 */
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** 校验画像目录名。 */
export function ensureProfileName(name) {
  ensure(
    typeof name === "string" &&
      PROFILE_NAME_PATTERN.test(name) &&
      !name.startsWith("_") &&
      !name.startsWith("."),
    ERROR_CODES.INVALID_INPUT,
    "画像名不合法：不能为空、不能包含路径分隔符、不能以 `.` 或 `_` 开头。",
    { details: { name: typeof name === "string" ? name : null } },
  );
  return name;
}

/** 校验内容项目名（排除系统目录与泛化目录名）。 */
export function ensureTopic(topic) {
  ensure(typeof topic === "string" && topic.trim() !== "", ERROR_CODES.INVALID_INPUT, "项目名不能为空。");
  const value = topic.trim();
  ensure(
    !value.startsWith("_") && !value.startsWith(".") && !value.includes("/") && !value.includes("\\"),
    ERROR_CODES.INVALID_INPUT,
    "项目名不合法：不能以 `.`/`_` 开头，也不能包含路径分隔符。",
    { details: { topic: value } },
  );
  return value;
}

/**
 * 建立数据服务。
 *
 * @param {{ paths: ReturnType<import('./paths.js').createPathPolicy>, runtime: Record<string, any> }} deps
 */
export function createDataService(deps) {
  const { paths, runtime } = deps;

  /** 读取一个路径下的文本；不存在返回 `undefined`。 */
  async function readTextIfAny(absolute, maxBytes = MAX_TEXT_BYTES) {
    const details = { path: absolute, maxBytes };
    try {
      const info = await stat(absolute);
      ensure(info.isFile(), ERROR_CODES.INVALID_INPUT, "目标不是文件。", details);
      ensure(
        info.size <= maxBytes,
        ERROR_CODES.INVALID_INPUT,
        `文件超过可读取上限（${String(maxBytes)} 字节）。`,
        { ...details, bytes: info.size },
      );
      return await readFile(absolute, "utf8");
    } catch (error) {
      if (error instanceof EaselError) throw error;
      if (error?.code === "ENOENT") return undefined;
      throw new EaselError(ERROR_CODES.NOT_FOUND, `无法读取文件：${absolute}`, { cause: error, details });
    }
  }

  /** 原子写文本（临时文件 + rename），并做只读前缀校验。 */
  async function writeTextAtomic(absolute, text, operation = "write") {
    paths.assertWritable(absolute, operation);
    await mkdir(dirname(absolute), { recursive: true });
    const temp = `${absolute}.easel-tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, text, "utf8");
    await rename(temp, absolute);
  }

  async function readJsonIfAny(absolute) {
    const text = await readTextIfAny(absolute);
    if (text === undefined) return undefined;
    const parsed = attempt(() => JSON.parse(text));
    return parsed.ok ? parsed.value : undefined;
  }

  /** 把 `.easel.json` 的原始内容整形成一个安全视图。 */
  function projectView(topic, manifest, files) {
    const raw = manifest ?? {};
    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    return {
      topic,
      title: asText(raw.title),
      summary: asText(raw.summary),
      platform: asText(raw.platform),
      kind: asText(raw.kind),
      status: asText(raw.status, "draft"),
      profile: asText(raw.profile),
      created: asText(raw.created),
      updated: asText(raw.updated),
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === "string") : [],
      cover: asText(raw.cover),
      deliverables: Array.isArray(raw.deliverables)
        ? raw.deliverables.filter((entry) => typeof entry === "string")
        : [],
      stepCount: steps.length,
      layers: [...new Set(steps.map((step) => asText(step?.layer)).filter(Boolean))],
      manifestPresent: manifest !== undefined,
      fileCount: files.length,
      hasPreview: files.some((file) => file.delivery.mode === "preview"),
    };
  }

  /** 递归列出一个项目目录下的文件（限 `MAX_LISTED_FILES`）。 */
  async function collectProjectFiles(root, current = root, out = []) {
    if (out.length >= MAX_LISTED_FILES) return out;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= MAX_LISTED_FILES) break;
      if (entry.name.startsWith(".easel-tmp-")) continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        await collectProjectFiles(root, absolute, out);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === MANIFEST_NAME) continue;
      const info = await stat(absolute).catch(() => undefined);
      if (info === undefined) continue;
      const kind = mediaKindOf(entry.name);
      out.push({
        path: relative(root, absolute).split(sep).join("/"),
        name: entry.name,
        kind,
        bytes: info.size,
        updatedAt: info.mtime.toISOString(),
        delivery: deliveryOf(kind, info.size),
      });
    }
    return out;
  }

  const service = {
    // ---------------------------------------------------------------- 画像

    /** 列举创作者画像；目录名即画像标识，永远跳过 `_template` 与 `_`/`.` 开头的目录。 */
    async listProfiles() {
      const dir = runtime.profilesDir;
      if (dir === undefined) {
        throw new EaselError(ERROR_CODES.NOT_CONFIGURED, "尚未定位到 Easel 仓库，无法读取画像目录。");
      }
      const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
        throw new EaselError(ERROR_CODES.NOT_FOUND, `无法读取画像目录：${dir}`, { cause: error });
      });
      const profiles = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
        const profileDir = join(dir, entry.name);
        const files = [];
        let updatedAt;
        for (const dimension of PROFILE_DIMENSIONS) {
          const filePath = join(profileDir, `${dimension}.md`);
          const info = await stat(filePath).catch(() => undefined);
          if (info === undefined) continue;
          files.push({ dimension, bytes: info.size, updatedAt: info.mtime.toISOString() });
          if (updatedAt === undefined || info.mtime.toISOString() > updatedAt) {
            updatedAt = info.mtime.toISOString();
          }
        }
        profiles.push({
          name: entry.name,
          dimensions: files,
          complete: files.length === PROFILE_DIMENSIONS.length,
          updatedAt: updatedAt ?? null,
        });
      }
      profiles.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      return {
        profiles,
        dimensions: PROFILE_DIMENSIONS,
        templateDir: PROFILE_TEMPLATE_DIR,
        path: dir,
      };
    },

    /** 读取一个画像的全部维度文本。 */
    async readProfile(name) {
      const safe = ensureProfileName(name);
      const profileDir = paths.resolveInside(join(runtime.profilesDir, safe));
      const dimensions = {};
      for (const dimension of PROFILE_DIMENSIONS) {
        const text = await readTextIfAny(join(profileDir, `${dimension}.md`));
        if (text !== undefined) dimensions[dimension] = text;
      }
      ensure(
        Object.keys(dimensions).length > 0,
        ERROR_CODES.NOT_FOUND,
        `画像「${safe}」不存在或没有任何维度文档。`,
        { details: { profile: safe } },
      );
      return { name: safe, dimensions, path: profileDir };
    },

    /** 新建画像：从 `_template` 复制六个维度文档。 */
    async createProfile(name) {
      const safe = ensureProfileName(name);
      const profileDir = paths.resolveInside(join(runtime.profilesDir, safe));
      const existing = await stat(profileDir).catch(() => undefined);
      ensure(existing === undefined, ERROR_CODES.INVALID_INPUT, `画像「${safe}」已经存在。`, {
        details: { profile: safe },
      });
      const templateDir = join(runtime.profilesDir, PROFILE_TEMPLATE_DIR);
      const created = [];
      for (const dimension of PROFILE_DIMENSIONS) {
        const template = await readTextIfAny(join(templateDir, `${dimension}.md`));
        await writeTextAtomic(join(profileDir, `${dimension}.md`), template ?? `# ${dimension}\n`, "create-profile");
        created.push(dimension);
      }
      return { name: safe, dimensions: created, path: profileDir };
    },

    /** 覆盖写一个画像维度（纯文本 Markdown）。 */
    async writeProfileDimension(name, dimension, text) {
      const safe = ensureProfileName(name);
      ensure(
        PROFILE_DIMENSIONS.includes(dimension),
        ERROR_CODES.INVALID_INPUT,
        `未知的画像维度：${String(dimension)}`,
        { details: { dimensions: PROFILE_DIMENSIONS } },
      );
      ensure(typeof text === "string", ERROR_CODES.INVALID_INPUT, "维度内容必须是文本。");
      const absolute = paths.resolveInside(join(runtime.profilesDir, safe, `${dimension}.md`));
      await writeTextAtomic(absolute, text, `write-profile:${dimension}`);
      return { name: safe, dimension, bytes: Buffer.byteLength(text, "utf8"), path: absolute };
    },

    // -------------------------------------------------------------- 内容库

    /** 列出 `outputs/` 下的所有内容项目。 */
    async listProjects() {
      const dir = runtime.outputsDir;
      if (dir === undefined) {
        throw new EaselError(ERROR_CODES.NOT_CONFIGURED, "尚未定位到 Easel 仓库，无法读取内容库。");
      }
      const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
        throw new EaselError(ERROR_CODES.NOT_FOUND, `无法读取产物目录：${dir}`, { cause: error });
      });
      const projects = [];
      let skippedSystem = 0;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) {
          skippedSystem += 1;
          continue;
        }
        const projectDir = join(dir, entry.name);
        const manifest = await readJsonIfAny(join(projectDir, MANIFEST_NAME));
        const files = await collectProjectFiles(projectDir);
        projects.push(projectView(entry.name, manifest, files));
      }
      projects.sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")));
      return { projects, path: dir, skippedSystem };
    },

    /** 列出单个项目的文件清单。 */
    async listProjectFiles(topic) {
      const safe = ensureTopic(topic);
      const projectDir = paths.resolveInside(join(runtime.outputsDir, safe));
      const info = await stat(projectDir).catch(() => undefined);
      ensure(info?.isDirectory() === true, ERROR_CODES.NOT_FOUND, `项目「${safe}」不存在。`, {
        details: { topic: safe },
      });
      const files = await collectProjectFiles(projectDir);
      const manifest = await readJsonIfAny(join(projectDir, MANIFEST_NAME));
      return {
        ...projectView(safe, manifest, files),
        files,
        path: projectDir,
        limit: MAX_LISTED_FILES,
      };
    },

    // -------------------------------------------------------------- 选题库

    /** 读取选题库；坏条目按 `skipped` 计数，绝不因此丢整个文件。 */
    async listTopics() {
      const absolute = runtime.topicsFile;
      const text = absolute === undefined ? undefined : await readTextIfAny(absolute);
      if (text === undefined) {
        return { topics: [], skipped: 0, path: absolute ?? null, statuses: TOPIC_STATUSES };
      }
      const parsed = attempt(() => JSON.parse(text));
      if (!parsed.ok) {
        throw new EaselError(ERROR_CODES.INVALID_INPUT, `选题库不是合法 JSON：${String(absolute)}`, {
          details: { path: absolute },
        });
      }
      const raw = Array.isArray(parsed.value) ? parsed.value : [];
      const topics = [];
      let skipped = 0;
      for (const entry of raw) {
        if (entry === null || typeof entry !== "object" || typeof entry.title !== "string") {
          skipped += 1;
          continue;
        }
        topics.push({
          id: asText(entry.id) || newId(),
          title: entry.title,
          note: asText(entry.note),
          source: asText(entry.source, "manual"),
          status: TOPIC_STATUSES.includes(entry.status) ? entry.status : "pending",
          created: Number.isFinite(entry.created) ? entry.created : nowSeconds(),
        });
      }
      return { topics, skipped, path: absolute ?? null, statuses: TOPIC_STATUSES };
    },

    /** 新增一条选题。 */
    async addTopic(input) {
      ensure(
        typeof input?.title === "string" && input.title.trim() !== "",
        ERROR_CODES.INVALID_INPUT,
        "选题必须有标题。",
      );
      const current = await service.listTopics();
      const entry = {
        id: newId(),
        title: input.title.trim(),
        note: asText(input.note),
        source: asText(input.source, "easy"),
        status: TOPIC_STATUSES.includes(input.status) ? input.status : "pending",
        created: nowSeconds(),
      };
      await service.persistTopics([entry, ...current.topics], current.path);
      return entry;
    },

    /** 更新一条选题（标题 / 备注 / 状态）。 */
    async updateTopic(id, patch) {
      const current = await service.listTopics();
      const index = current.topics.findIndex((topic) => topic.id === id);
      ensure(index >= 0, ERROR_CODES.NOT_FOUND, `未找到选题：${String(id)}`, { details: { id } });
      const before = current.topics[index];
      const after = {
        ...before,
        title:
          typeof patch?.title === "string" && patch.title.trim() !== "" ? patch.title.trim() : before.title,
        note: typeof patch?.note === "string" ? patch.note : before.note,
        status: TOPIC_STATUSES.includes(patch?.status) ? patch.status : before.status,
      };
      const topics = [...current.topics];
      topics[index] = after;
      await service.persistTopics(topics, current.path);
      return after;
    },

    /** 删除一条选题。 */
    async removeTopic(id) {
      const current = await service.listTopics();
      const topics = current.topics.filter((topic) => topic.id !== id);
      ensure(topics.length !== current.topics.length, ERROR_CODES.NOT_FOUND, `未找到选题：${String(id)}`, {
        details: { id },
      });
      await service.persistTopics(topics, current.path);
      return { id, removed: true };
    },

    /** 写回选题库：与既有 `web/app.py` 一致，顶层数组 + `indent=2` + `ensure_ascii=False`。 */
    async persistTopics(topics, path) {
      const absolute = path ?? runtime.topicsFile;
      ensure(absolute !== undefined, ERROR_CODES.NOT_CONFIGURED, "尚未定位到 Easel 仓库，无法写入选题库。");
      await writeTextAtomic(absolute, `${JSON.stringify(topics, null, 2)}\n`, "write-topics");
      return { path: absolute, count: topics.length };
    },

    // ---------------------------------------------------------------- 排期

    /**
     * 只读地读取既有排期数据。
     *
     * 排期的**写入**一律交给 DSH 排期能力（见 `lib/host/schedule.js`）：spec
     * 禁止插件自建调度器，因此这里只提供视图，不提供写接口。
     */
    async listSchedule() {
      const absolute = runtime.scheduleFile;
      const text = absolute === undefined ? undefined : await readTextIfAny(absolute);
      if (text === undefined) {
        return {
          items: [],
          skipped: 0,
          path: absolute ?? null,
          statuses: SCHEDULE_STATUSES,
          kinds: SCHEDULE_KINDS,
        };
      }
      const parsed = attempt(() => JSON.parse(text));
      if (!parsed.ok) {
        throw new EaselError(ERROR_CODES.INVALID_INPUT, `排期文件不是合法 JSON：${String(absolute)}`, {
          details: { path: absolute },
        });
      }
      const raw = Array.isArray(parsed.value) ? parsed.value : [];
      const items = [];
      let skipped = 0;
      for (const entry of raw) {
        if (entry === null || typeof entry !== "object" || typeof entry.title !== "string") {
          skipped += 1;
          continue;
        }
        items.push({
          id: asText(entry.id) || newId(),
          title: entry.title,
          date: asText(entry.date),
          time: asText(entry.time),
          endDate: asText(entry.end_date),
          platform: asText(entry.platform),
          note: asText(entry.note),
          url: asText(entry.url),
          eventType: asText(entry.event_type),
          // 既有 `calendar_ops.py` 用的键是 `kind`（content | event），不是 `type`。
          kind: SCHEDULE_KINDS.includes(entry.kind) ? entry.kind : "content",
          status: SCHEDULE_STATUSES.includes(entry.status) ? entry.status : "idea",
          source: asText(entry.source, "manual"),
        });
      }
      return { items, skipped, path: absolute ?? null, statuses: SCHEDULE_STATUSES, kinds: SCHEDULE_KINDS };
    },

    // ---------------------------------------------------------------- 文本

    /** 读取仓库内任意文本文件（只读，带上限）。 */
    async readText(input) {
      const absolute = paths.resolveInside(input?.path);
      const text = await readTextIfAny(absolute, input?.maxBytes ?? MAX_TEXT_BYTES);
      ensure(text !== undefined, ERROR_CODES.NOT_FOUND, `文件不存在：${absolute}`, { details: { path: absolute } });
      return { path: absolute, relative: paths.toRelative(absolute), text };
    },

    /** 写仓库内文本文件（走只读前缀校验）。 */
    async writeText(input) {
      ensure(typeof input?.text === "string", ERROR_CODES.INVALID_INPUT, "写入内容必须是文本。");
      const absolute = paths.resolveInside(input?.path);
      await writeTextAtomic(absolute, input.text, input?.operation ?? "write-text");
      return { path: absolute, relative: paths.toRelative(absolute), bytes: Buffer.byteLength(input.text, "utf8") };
    },

    /** 删除仓库内文件（走只读前缀校验）。 */
    async removeFile(input) {
      const absolute = paths.resolveInside(input?.path);
      paths.assertWritable(absolute, input?.operation ?? "remove");
      await unlink(absolute);
      return { path: absolute, removed: true };
    },

    internals: { readTextIfAny, writeTextAtomic, readJsonIfAny, collectProjectFiles },
  };

  return service;
}
