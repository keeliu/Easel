#!/usr/bin/env node
/**
 * 构建客户端半边：把 `src/client.js` 与 `locale/*.json` 合成 `lib/client.js`。
 *
 * 为什么手写而不用打包器：客户端产物在浏览器里跑，它只允许 require 9 个固定的
 * specifier，任何打包器都只会带来新的构建期依赖与不可控的产物形状；这里做的其实
 * 只有一件编译期的事——把字典内联进去，因为浏览器侧取不到包内的 JSON 文件。
 *
 * 确定性：字典键排序后再输出，输出里没有任何时间戳/随机值，所以同一份输入必然
 * 逐字节产生同一份产物（`--check` 靠的就是这一点）。
 *
 * 用法：
 *   node scripts/build-client.mjs           生成 lib/client.js
 *   node scripts/build-client.mjs --check   只比对，不一致则非零退出（不写盘）
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_PATH = join(ROOT, "src", "client.js");
const OUT_PATH = join(ROOT, "lib", "client.js");

/** src 里这一行会被替换成生成的内联字典；只允许出现一次。 */
const MARKER = "@easel-locale-inline";

/** 客户端内置 locale id 只有 zh / en；`zh-CN` 只是包内文件的命名，不是运行时 id。 */
const LOCALES = [
  ["zh", join(ROOT, "locale", "zh-CN.json")],
  ["en", join(ROOT, "locale", "en.json")],
];

const HEADER = [
  "/* 本文件由 scripts/build-client.mjs 从 src/client.js 与 locale/*.json 生成 —— 不要手改。",
  " * 重新生成：node scripts/build-client.mjs",
  " */",
  "",
].join("\n");

async function readJson(path) {
  const text = await readFile(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${relative(ROOT, path)} 不是合法 JSON：${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${relative(ROOT, path)} 必须是「键 → 文案」的扁平对象`);
  }
  return parsed;
}

/** 键排序后逐行输出，保证同一份字典必然产生同一段源码。 */
function renderDict(name, dict) {
  const lines = Object.keys(dict)
    .sort()
    .map((key) => `      ${JSON.stringify(key)}: ${JSON.stringify(dict[key])},`);
  return [`    var ${name} = {`, ...lines, "    };"].join("\n");
}

function inlineDictionaries(source, dicts) {
  const lines = source.split("\n");
  const hits = lines.reduce((acc, line, index) => (line.includes(MARKER) ? [...acc, index] : acc), []);
  if (hits.length !== 1) {
    throw new Error(`src/client.js 必须恰好包含一行 ${MARKER}（当前 ${hits.length} 行）`);
  }
  const block = dicts.map(([name, dict]) => renderDict(name, dict)).join("\n");
  const next = lines.slice();
  next.splice(hits[0], 1, block);
  return next.join("\n");
}

async function build() {
  const source = await readFile(SRC_PATH, "utf8");
  const dicts = [];
  for (const [id, path] of LOCALES) {
    const dict = await readJson(path);
    if (Object.keys(dict).length === 0) throw new Error(`${relative(ROOT, path)} 是空字典`);
    // 两种语言的键必须一一对齐，否则某一门语言会整片回落成 key。
    if (dicts.length > 0) {
      const expected = Object.keys(dicts[0][1]).sort().join("\n");
      const actual = Object.keys(dict).sort().join("\n");
      if (expected !== actual) throw new Error(`${relative(ROOT, path)} 的键与 ${relative(ROOT, LOCALES[0][1])} 不一致`);
    }
    dicts.push([`DICT_${id.toUpperCase()}`, dict]);
  }
  return HEADER + inlineDictionaries(source, dicts) + "\n";
}

async function main() {
  const check = process.argv.slice(2).includes("--check");
  const expected = await build();

  if (check) {
    let actual = null;
    try {
      actual = await readFile(OUT_PATH, "utf8");
    } catch {
      actual = null;
    }
    if (actual !== expected) {
      console.error(`${relative(ROOT, OUT_PATH)} 与 src/client.js + locale/*.json 不一致，请运行 node scripts/build-client.mjs`);
      process.exitCode = 1;
      return;
    }
    console.log(`${relative(ROOT, OUT_PATH)} 已是最新（--check 通过）`);
    return;
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, expected);
  console.log(`已生成 ${relative(ROOT, OUT_PATH)}（${Buffer.byteLength(expected, "utf8")} 字节）`);
}

await main();
