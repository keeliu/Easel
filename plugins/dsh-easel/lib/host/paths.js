/**
 * 路径策略：一切仓库内读写都必须经过这里。
 *
 * 两条不可绕过的规则：
 * 1. 任何被访问的路径都必须落在仓库根之内（否则 `path-out-of-scope`）；
 * 2. `UPSTREAM_READ_ONLY_PREFIXES`（当前是 `skills/`）之下的任何写入都被拒绝
 *    （`upstream-read-only`），并且这次被拒绝的尝试要进入审计列表，供「环境自检」
 *    区域展示——这样越界写入不是静默失败。
 *
 * @module dsh-easel/host/paths
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { ERROR_CODES, EaselError, ensure } from "./errors.js";

/** 一次被拒绝的越界写入审计记录。 */
const MAX_AUDIT_ENTRIES = 100;

/**
 * 判断 `child` 是否位于 `parent` 之内（含 `parent` 自身）。
 * @param {string} parent
 * @param {string} child
 */
export function isInside(parent, child) {
  if (parent === undefined || child === undefined) return false;
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * 判断仓库相对路径是否落在任一只读前缀之下。
 * @param {string} relativePath 以 `/` 分隔的仓库相对路径。
 * @param {readonly string[]} prefixes
 */
export function matchesReadOnlyPrefix(relativePath, prefixes) {
  const normalized = relativePath.split(sep).join("/").replace(/^\.\//, "");
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/**
 * 创建一个绑定到具体仓库根与只读前缀的路径策略实例。
 *
 * @param {{
 *   repoRoot: string | undefined,
 *   readOnlyPrefixes: readonly string[],
 * }} options
 */
export function createPathPolicy(options) {
  const { repoRoot, readOnlyPrefixes } = options;
  /** @type {{ path: string, operation: string, at: string }[]} */
  const blockedWrites = [];

  /** 把仓库相对路径解析为绝对路径，并断言它留在仓库内。 */
  function resolveInside(relativePath) {
    ensure(
      repoRoot !== undefined,
      ERROR_CODES.NOT_CONFIGURED,
      "未定位到 Easel 仓库根，请在工作台设置里指定 repoRoot 或通过 repoRoot 配置项注入。",
    );
    ensure(
      typeof relativePath === "string" && relativePath.trim() !== "",
      ERROR_CODES.INVALID_INPUT,
      "路径不能为空。",
    );
    const absolute = isAbsolute(relativePath)
      ? resolve(relativePath)
      : resolve(repoRoot, relativePath);
    ensure(
      isInside(repoRoot, absolute),
      ERROR_CODES.PATH_OUT_OF_SCOPE,
      `路径越出仓库范围：${relativePath}`,
      { repoRoot, path: absolute },
    );
    return absolute;
  }

  /** 把绝对路径换算回以 `/` 分隔的仓库相对路径（越界时返回绝对路径）。 */
  function toRelative(absolute) {
    if (repoRoot === undefined) return absolute;
    return relative(repoRoot, absolute).split(sep).join("/");
  }

  /**
   * 记录一次被拒绝的写入并抛出 `upstream-read-only`。
   * @param {string} absolute
   * @param {string} operation
   */
  function rejectUpstream(absolute, operation) {
    const entry = { path: toRelative(absolute), operation, at: new Date().toISOString() };
    blockedWrites.push(entry);
    if (blockedWrites.length > MAX_AUDIT_ENTRIES) blockedWrites.shift();
    throw new EaselError(
      ERROR_CODES.UPSTREAM_READ_ONLY,
      `上游目录只读，已拒绝写入：${entry.path}`,
      { details: entry },
    );
  }

  /**
   * 断言一次写入被允许；只读前缀之下直接拒绝并记账。
   * @param {string} absolute 已经过 `resolveInside` 的绝对路径。
   * @param {string} operation 供审计使用的操作名，例如 `profile.write`。
   */
  function assertWritable(absolute, operation) {
    ensure(
      isInside(repoRoot, absolute),
      ERROR_CODES.PATH_OUT_OF_SCOPE,
      `路径越出仓库范围：${absolute}`,
      { repoRoot, path: absolute },
    );
    if (matchesReadOnlyPrefix(toRelative(absolute), readOnlyPrefixes)) {
      rejectUpstream(absolute, operation);
    }
    return absolute;
  }

  return {
    repoRoot,
    readOnlyPrefixes,
    resolveInside,
    toRelative,
    assertWritable,
    isInsideRepo: (absolute) => isInside(repoRoot, absolute),
    /** 只读副本，避免调用方改写审计列表。 */
    blockedWrites: () => blockedWrites.map((entry) => ({ ...entry })),
    clearBlockedWrites: () => {
      blockedWrites.length = 0;
    },
  };
}
