// 插件自身的「卫生」约束（tasks 8.2 / 9.2 / 9.5 里可自动化的部分）。
//
// 这些断言不测功能，而是钉住几条**架构约束**：插件不碰模型路由、不定义自己的
// 会话事件类型、不提供自建上传接口、包内容完整覆盖运行时要读的资源，以及技能
// 目录描述截断带来的成本对比（复刻 DSH 的截断实现）。
//
// 复刻依据：`@deepseek-ai/dsh-tool-skill/lib/index.js:359-362`
//   function catalogDescription(value, maxLength) {
//     const normalized = value.replaceAll(/\s+/g, " ").trim();
//     return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
//   }
// 以及 `:42-47` 的 catalogSourceEntries（只截描述，name 原样保留）。

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const EASEL_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OPENCLAW_SKILLS = join(EASEL_ROOT, "_repo", "skills", "openclaw");

const SHIPPED_DIRS = ["lib", "src", "locale", "scripts", "assets"];
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".json", ".yml", ".yaml", ".md", ".svg"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function shippedTextFiles() {
  const files = [];
  for (const dir of SHIPPED_DIRS) files.push(...walk(join(PACKAGE_ROOT, dir)));
  files.push(join(PACKAGE_ROOT, "package.json"), join(PACKAGE_ROOT, "cordis.patch.yml"));
  return files.filter((path) => TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf("."))));
}

function rel(path) {
  return relative(PACKAGE_ROOT, path);
}

test("9.2 插件代码内不存在 provider / 模型标识字面量", async (t) => {
  const forbidden = /\b(openai|anthropic|gemini|moonshot|qwen|claude|grok|xai|gpt-[0-9a-z]|o[13]-mini)\b/i;
  const credentials = /api[_-]?key|bearer\s|base[_-]?url|authorization:/i;
  for (const path of shippedTextFiles()) {
    const text = readFileSync(path, "utf8");
    assert.ok(!forbidden.test(text), `${rel(path)} 出现 provider/模型标识字面量`);
    // gate.js 是内容守卫本身，它必须写出要拦的那些模式（api-key / env-value …）。
    if (path.endsWith(join("host", "gate.js"))) {
      assert.ok(text.includes("api-key"), "内容守卫应保留 api-key 类别");
      continue;
    }
    assert.ok(!credentials.test(text), `${rel(path)} 出现凭据/端点配置痕迹`);
  }
  // `deepseek` 在**代码**里只允许作为 @deepseek-ai/* 包名出现（DSH 官方包）；
  // package.json/README 里的 “DeepSeek Harness” 是产品名，不参与路由判定。
  for (const path of shippedTextFiles()) {
    if (!path.includes(`${"/"}lib${"/"}`) && !path.includes(`${"/"}src${"/"}`)) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/deepseek/gi)) {
      const context = text.slice(Math.max(0, match.index - 1), match.index + 12);
      assert.match(context, /@deepseek-ai/, `${rel(path)} 出现非包名的 deepseek：${context}`);
    }
  }
});

test("9.2 插件只透传 DSH 的模型选择，不自建路由表", async (t) => {
  const dispatch = readFileSync(join(PACKAGE_ROOT, "lib", "host", "dispatch.js"), "utf8");
  assert.ok(dispatch.includes("currentSelection"), "dispatch.js 应通过 agentDefaultModel.currentSelection() 取模型");
  assert.match(dispatch, /agentDefaultModel/, "dispatch.js 应只依赖 DSH 的默认模型服务");
  assert.ok(!/PROVIDER|MODEL_ALIASES|routes\s*[:=]/.test(dispatch), "dispatch.js 不应出现自建路由表");
});

test("9.2 插件不定义自己的会话事件类型", async (t) => {
  const forbidden = /\.emit\(|defineEvent|ctx\.bus|session\.append|appendEvent|type:\s*["'`]easel\//;
  for (const path of shippedTextFiles()) {
    if (!path.includes(`${"/"}lib${"/"}`) && !path.includes(`${"/"}src${"/"}`)) continue;
    assert.ok(!forbidden.test(readFileSync(path, "utf8")), `${rel(path)} 出现自建事件写入痕迹`);
  }
});

test("8.2 不提供自建上传接口（素材走 DSH 附件能力）", async (t) => {
  for (const path of shippedTextFiles()) {
    if (path.endsWith("scripts.js") || path.endsWith("tools.js")) continue; // B 站自己的 upload 子命令
    const text = readFileSync(path, "utf8");
    assert.ok(!/busboy|formidable|multer|multipart/i.test(text), `${rel(path)} 依赖了 multipart 解析库`);
    assert.ok(!/["'`]\/upload/.test(text), `${rel(path)} 出现自建上传路由`);
  }
  const web = readFileSync(join(PACKAGE_ROOT, "lib", "host", "web.js"), "utf8");
  for (const match of web.matchAll(/router\.(get|post|patch|put|delete)\("([^"]+)"/g)) {
    assert.ok(!/upload|multipart/i.test(match[2]), `web.js 出现上传相关路由：${match[2]}`);
  }
});

test("package.json 的 files 覆盖运行时要读的全部资源", async (t) => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  const files = manifest.files ?? [];
  for (const required of ["lib", "src", "locale", "assets", "scripts", "icon.svg", "cordis.patch.yml"]) {
    assert.ok(files.includes(required), `files 缺少 ${required}（打包后会读不到）`);
    assert.ok(existsSync(join(PACKAGE_ROOT, required)), `files 里列了不存在的 ${required}`);
  }
  // 运行时确实会读 assets（人设与规则段），缺了它打包后必然报 not-found。
  assert.ok(existsSync(join(PACKAGE_ROOT, "assets", "persona.md")));
  assert.ok(existsSync(join(PACKAGE_ROOT, "assets", "rules.md")));
});

test("10.2 打包契约：宿主包只许出现在 peerDependencies，客户端 inject 只列客户端包", async (t) => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));

  // 宿主运行时包必须靠 peerDependencies 才走 DSH 的 profile 解析拦截
  // （`@deepseek-ai/dsh-app-boot` 的 readPeerNames 只读这个字段）；写进 dependencies 时
  // 以源码树 link: 安装会因为 pnpm 不为其装依赖而 import 失败（design D11/D12）。
  const runtimeHostPackages = ["@deepseek-ai/dsh-llm", "@deepseek-ai/schemastery"];
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    assert.ok(!name.startsWith("@deepseek-ai/"), `dependencies 不得含宿主包：${name}（应改为 peerDependencies）`);
  }
  for (const name of runtimeHostPackages) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(manifest.peerDependencies ?? {}, name),
      `peerDependencies 缺少宿主包 ${name}`,
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(manifest.devDependencies ?? {}, name),
      `devDependencies 缺少 ${name}（本地开发与测试要能直接解析）`,
    );
  }

  // 客户端注入的是**客户端侧包**（渲染槽位与字典都来自浏览器半边）。
  const inject = manifest.dsh?.client?.inject ?? [];
  assert.ok(inject.length > 0, "dsh.client.inject 不应为空");
  for (const name of inject) {
    assert.match(name, /^@deepseek-ai\/dsh-client-/, `dsh.client.inject 只应列客户端包：${name}`);
    assert.ok(!runtimeHostPackages.includes(name), `dsh.client.inject 混入了宿主包：${name}`);
  }

  // 打包后必须带上运行时要读的东西：产物、补丁层、引导脚本。
  const files = manifest.files ?? [];
  for (const required of ["lib", "scripts"]) assert.ok(files.includes(required), `files 缺少 ${required}`);
  for (const artifact of ["lib/client.js", "lib/index.js", "scripts/bootstrap-runtime.sh", "cordis.patch.yml"]) {
    assert.ok(existsSync(join(PACKAGE_ROOT, artifact)), `打包清单声明的资源不存在：${artifact}`);
    assert.ok(statSync(join(PACKAGE_ROOT, artifact)).size > 0, `资源为空：${artifact}`);
  }
  assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml", "dsh.bundle.patch 必须指向补丁层");
  assert.equal(manifest.private, true, "未发布到 registry，安装必须用绝对路径/物化包");
});

// ---------------------------------------------------------------------------
// 9.5 技能目录成本：catalogDescriptionMaxLength 默认值 vs 调低值
// ---------------------------------------------------------------------------

/** 只解析 SKILL.md 的 frontmatter（name / description），够本用例使用。 */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let index = 0; index < lines.length; index += 1) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
    if (!entry) continue;
    const key = entry[1];
    const raw = entry[2].trim();
    if (/^[>|][-+]?$/.test(raw)) {
      const folded = raw.startsWith(">");
      const collected = [];
      let cursor = index + 1;
      for (; cursor < lines.length; cursor += 1) {
        if (lines[cursor].trim() === "") {
          collected.push("");
          continue;
        }
        if (!/^\s/.test(lines[cursor])) break;
        collected.push(lines[cursor].trim());
      }
      index = cursor - 1;
      data[key] = collected.join(folded ? " " : "\n");
      continue;
    }
    if (/^".*"$/.test(raw)) data[key] = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    else if (/^'.*'$/.test(raw)) data[key] = raw.slice(1, -1).replace(/''/g, "'");
    else data[key] = raw;
  }
  return data;
}

/** 复刻 DSH 的目录条目构造（见文件头注释里的源码位置）。 */
function catalogEntries(skills, maxLength) {
  return skills.map((skill) => {
    const normalized = String(skill.description ?? "").replace(/\s+/g, " ").trim();
    return {
      name: skill.name,
      description: normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`,
    };
  });
}

function catalogCost(entries) {
  return entries.reduce((total, entry) => total + entry.name.length + entry.description.length, 0);
}

function readRealSkills() {
  return walk(OPENCLAW_SKILLS)
    .filter((path) => path.endsWith("SKILL.md"))
    .map((path) => {
      const data = frontmatter(readFileSync(path, "utf8"));
      return { path: rel(path), name: data.name ?? "", description: data.description ?? "" };
    });
}

test("9.5 技能目录成本：默认 500 与调低到 120 的字符数对比", async (t) => {
  if (!existsSync(OPENCLAW_SKILLS)) {
    t.skip("本机没有 _repo/skills/openclaw（上游检出），跳过目录成本实测");
    return;
  }
  const skills = readRealSkills();
  assert.equal(skills.length, 114, "上游技能条数应为 114");
  for (const skill of skills) {
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${skill.path} 的 name 不是 kebab-case：${skill.name}`);
    assert.ok(skill.description.length > 0, `${skill.path} 的 description 为空`);
  }
  assert.equal(new Set(skills.map((skill) => skill.name)).size, skills.length, "技能名必须唯一");

  const wide = catalogEntries(skills, 500);
  const narrow = catalogEntries(skills, 120);
  const wideCost = catalogCost(wide);
  const narrowCost = catalogCost(narrow);
  const truncated = narrow.filter((entry) => entry.description.endsWith("..."));
  const longest = Math.max(...skills.map((skill) => skill.description.replace(/\s+/g, " ").trim().length));

  // 默认 500 高于最长描述 → 一条都不截断；调低到 120 才会截断。
  assert.ok(longest <= 500, `最长描述 ${longest} 超过默认上限 500`);
  assert.equal(catalogCost(wide), catalogCost(catalogEntries(skills, 500)), "同一上限下成本必须可重复");
  assert.equal(wide.filter((entry) => entry.description.endsWith("...")).length, 0, "500 上限下不应有截断");
  assert.ok(truncated.length > 0, "120 上限下应出现截断");
  assert.ok(narrowCost < wideCost, "调低上限应降低目录成本");

  // 名称完整保留（截断只作用于描述），截断后长度精确等于上限。
  assert.deepEqual(narrow.map((entry) => entry.name), wide.map((entry) => entry.name));
  for (const entry of narrow) {
    assert.ok(entry.description.length <= 120, `${entry.name} 的描述超上限`);
    if (entry.description.endsWith("...")) assert.equal(entry.description.length, 120);
  }

  console.log(
    `[9.5] 114 个技能：默认 500 → 目录 ${wideCost} 字符（0 条截断）；调低到 120 → ${narrowCost} 字符` +
      `（${truncated.length} 条截断，节省 ${wideCost - narrowCost} 字符）；最长描述 ${longest} 字符`,
  );
});
