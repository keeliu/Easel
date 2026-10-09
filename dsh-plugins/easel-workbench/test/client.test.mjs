/**
 * 客户端半边测试。
 *
 * 走的是浏览器的真实加载路径：`window.__ModuleLoader__.load({ id, factory })` →
 * `factory(require)` → `apply(ctx)` → 把注册到的面板组件真的渲染进 jsdom。
 * 只有这样，`REGIONS` 覆盖、单区域渲染、错误边界隔离这些要求才是被验证的行为，
 * 而不是对源码文本做的猜测。
 *
 * 为什么用 `React.act` 而不是 `react-dom/test-utils` 的 `act`：后者在 18.3.1 上会打印
 * 「ReactDOMTestUtils.act is deprecated in favor of React.act」的弃用告警，污染
 * `node --test` 的输出；`React.act` 在 18.3.1 里已导出，取不到时才回退到 test-utils。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PANEL_ID, REGIONS as HOST_REGIONS } from "../lib/host/config.js";
import { API_PREFIX as HOST_API_PREFIX } from "../lib/host/web.js";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

const React = require("react");
const ReactDOMClient = require("react-dom/client");
const { JSDOM } = require("jsdom");

const act = typeof React.act === "function" ? React.act : require("react-dom/test-utils").act;

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUNDLE_PATH = fileURLToPath(new URL("../lib/client.js", import.meta.url));

/** 客户端产物在浏览器里只被允许 require 这 9 个 specifier。 */
const ALLOWED_SPECIFIERS = new Set([
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit",
]);

const originalFetch = globalThis.fetch;
let bundleSource = "";

before(async () => {
  bundleSource = await readFile(BUNDLE_PATH, "utf8");
});

after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

// ----------------------------------------------------------------- jsdom 沙箱

function createDom() {
  return new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/easel/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
}

/** 每份 bundle 都跑在一个全新的 document 里，避免上一个用例的 <style> 残留。 */
function installGlobals(dom) {
  const win = dom.window;
  globalThis.window = win;
  globalThis.document = win.document;
  Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true, writable: true });
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;
  globalThis.Event = win.Event;
  globalThis.MouseEvent = win.MouseEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

function defaultFetch() {
  return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
}

/**
 * 加载产物：`factory` 在 Node 作用域里执行，所以 `fetch` / `document` 取的是全局对象
 * （上面 installGlobals 挂的就是 jsdom 的 document）——与浏览器里唯一共享的就是 DOM。
 */
async function loadBundle(fetchImpl = defaultFetch) {
  const dom = createDom();
  installGlobals(dom);
  globalThis.fetch = fetchImpl;
  dom.window.fetch = fetchImpl;

  let registration = null;
  dom.window.__ModuleLoader__ = {
    load(entry) {
      registration = entry;
      return entry;
    },
  };
  dom.window.eval(bundleSource);
  assert.ok(registration !== null, "产物必须通过 window.__ModuleLoader__.load 注册 factory");

  return { dom, win: dom.window, registration, exports: registration.factory(require) };
}

// ------------------------------------------------------------------- 假 ctx

/**
 * 假 ctx 只实现客户端半边真正用到的那几件事；`effect` 会立刻执行并把返回的 disposer
 * 收起来，以便断言「注册返回的 disposer 真的交给了 effect」。
 */
function createContext() {
  const state = {
    effects: [],
    dismiss: [],
    dictionaries: new Map(),
    localeId: "zh",
    localeRegistrations: [],
    localeListeners: [],
    failKeys: new Set(),
    slotRegistrations: [],
    slotInjections: [],
    registerDisposers: [],
    layoutSelections: [],
    sessionOpens: [],
  };

  function bind(namespace) {
    const dicts = state.dictionaries.get(namespace) ?? {};
    return function t(key, params) {
      if (state.failKeys.has(key)) throw new Error("injected label failure: " + key);
      const table = dicts[state.localeId] ?? {};
      let text = typeof table[key] === "string" ? table[key] : key;
      if (params !== undefined && params !== null) {
        for (const name of Object.keys(params)) text = text.split("{" + name + "}").join(String(params[name]));
      }
      return text;
    };
  }

  const ctx = {
    effect(execute) {
      const disposer = execute();
      state.effects.push({ disposer });
      if (typeof disposer === "function") state.dismiss.push(disposer);
      else if (disposer !== null && disposer !== undefined && typeof disposer[Symbol.iterator] === "function") {
        for (const item of disposer) state.dismiss.push(item);
      }
      return () => {};
    },
    get(name) {
      if (name === "layout") return { selectPanel: (id) => state.layoutSelections.push(id) };
      if (name === "uiWorkspace") return { openSession: (target) => state.sessionOpens.push(target) };
      return undefined;
    },
    slots: {
      register(options, component) {
        state.slotRegistrations.push({ options, component });
        const disposer = () => state.registerDisposers.push(options.name);
        return disposer;
      },
      inject(slotKey, callback) {
        state.slotInjections.push(slotKey);
        return callback();
      },
    },
    locale: {
      register(namespace, dicts) {
        state.localeRegistrations.push({ namespace, dicts });
        state.dictionaries.set(namespace, dicts);
        return () => state.dictionaries.delete(namespace);
      },
      bind,
      subscribe(listener) {
        state.localeListeners.push(listener);
        return () => {
          state.localeListeners = state.localeListeners.filter((item) => item !== listener);
        };
      },
    },
  };

  state.teardown = () => {
    for (const disposer of state.dismiss.slice().reverse()) disposer();
  };

  return { ctx, state };
}

function panelOf(state) {
  const entry = state.slotRegistrations.find((item) => item.options.name === "main");
  assert.ok(entry !== undefined, "必须向 main 槽位注册面板组件");
  return entry.component;
}

// ---------------------------------------------------------------- 渲染小工具

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    root,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function click(node) {
  assert.ok(node !== null && node !== undefined, "要点击的节点必须存在");
  await act(async () => {
    node.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ------------------------------------------------------------------ 用例

test("产物通过 __ModuleLoader__ 注册，导出 name / inject / apply", async () => {
  const bundle = await loadBundle();

  assert.equal(bundle.registration.id, "easel-workbench", "load() 的 id 必须是包名");
  assert.equal(typeof bundle.registration.factory, "function");
  assert.equal(bundle.exports.name, "easel-workbench");
  assert.equal(typeof bundle.exports.apply, "function");
  assert.deepEqual([...bundle.exports.inject], ["slots", "locale"], "静态 inject 必须恰好是两个客户端服务名");
  assert.equal(bundle.exports.API_PREFIX, HOST_API_PREFIX, "请求前缀必须与宿主路由前缀一致");
  assert.equal(bundle.exports.PANEL_ID, PANEL_ID);
});

test("注册两种语言、两个槽位，且 disposer 交给 ctx.effect", async () => {
  const bundle = await loadBundle();
  const { ctx, state } = createContext();

  bundle.exports.apply(ctx);

  // locale：同一个 namespace 下 zh / en 必须一次注册齐（内置 locale id 只有这两个）。
  assert.deepEqual(state.localeRegistrations.map((item) => item.namespace), ["easel-workbench"]);
  const dicts = state.localeRegistrations[0].dicts;
  assert.deepEqual(Object.keys(dicts).sort(), ["en", "zh"]);
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort(), "两种语言的键必须对齐");
  assert.ok(Object.keys(dicts.zh).length >= 48);
  assert.equal(dicts.zh["panel.title"], "自媒体工作台");
  assert.equal(dicts.en["panel.title"], "Creator Workbench");

  // 槽位：main 的 key 与侧边栏条目的 id 必须同值，否则选中条目找不到面板。
  assert.deepEqual(state.slotInjections.sort(), ["main", "sidebar.panellist"]);
  const main = state.slotRegistrations.find((item) => item.options.name === "main");
  const sidebar = state.slotRegistrations.find((item) => item.options.name === "sidebar.panellist");
  assert.ok(main !== undefined && sidebar !== undefined);
  assert.deepEqual(Object.keys(main.options).sort(), ["key", "name"]);
  assert.equal(main.options.key, PANEL_ID);
  assert.equal(sidebar.options.id, PANEL_ID);
  assert.equal(sidebar.options.id, main.options.key);
  assert.equal(typeof sidebar.options.order, "number", "侧边栏条目必须有确定的位置");
  assert.equal(typeof sidebar.options.label, "function", "label 用 thunk，语言切换时才重新取词");
  assert.equal(sidebar.options.label(), "自媒体工作台");
  state.localeId = "en";
  assert.equal(sidebar.options.label(), "Creator Workbench");

  // disposer 必须由 effect 持有：teardown 后注册冒烟标记应全部触发。
  const handed = state.effects.map((item) => item.disposer);
  for (const disposer of state.registerDisposers) {
    assert.ok(handed.includes(disposer), "注册返回的 disposer 必须交给 ctx.effect");
  }
  assert.equal(state.registerDisposers.length, 0);

  // 样式标签挂在 document 上，卸载时摘掉。
  assert.equal(document.querySelectorAll('style[data-plugin="easel-workbench"]').length, 1);
  state.teardown();
  // teardown 逆序执行，所以记录到的顺序与注册顺序相反；这里只关心两个都真的被释放。
  assert.deepEqual(state.registerDisposers.slice().sort(), ["main", "sidebar.panellist"]);
  assert.equal(document.querySelectorAll('style[data-plugin="easel-workbench"]').length, 0);
});

test("slots.inject 不可用时退回直接注册", async () => {
  const bundle = await loadBundle();
  const { ctx, state } = createContext();
  delete ctx.slots.inject;

  bundle.exports.apply(ctx);

  assert.deepEqual(state.slotInjections, []);
  assert.deepEqual(state.slotRegistrations.map((item) => item.options.name), ["main", "sidebar.panellist"]);
  assert.equal(state.registerDisposers.length, 0);
  state.teardown();
  // 同上：teardown 逆序，顺序不作为约束。
  assert.deepEqual(state.registerDisposers.slice().sort(), ["main", "sidebar.panellist"]);
});

test("子导航覆盖宿主 REGIONS 的全部十个区域，且同一时刻只渲染一个", async () => {
  const bundle = await loadBundle();
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  // Array.from 不是多余的：factory 由 window.eval 创建，其产物是 jsdom realm 的数组，
  // 而 deepStrictEqual 会比较原型，跨 realm 数组哪怕内容一致也不相等。
  assert.deepEqual(
    Array.from(bundle.exports.REGIONS, (region) => region.id),
    HOST_REGIONS.map((region) => region.id),
    "客户端区域 id 必须与宿主 REGIONS 同序同值",
  );
  assert.deepEqual(
    Array.from(bundle.exports.REGIONS, (region) => region.labelKey),
    HOST_REGIONS.map((region) => region.labelKey),
  );

  const view = await mount(React.createElement(panelOf(state)));

  const items = [...view.container.querySelectorAll("[data-easel-nav]")];
  assert.deepEqual(
    items.map((node) => node.getAttribute("data-easel-nav")),
    HOST_REGIONS.map((region) => region.id),
  );

  function rendered() {
    return [...view.container.querySelectorAll("[data-easel-region]")];
  }

  assert.deepEqual(rendered().map((node) => node.getAttribute("data-easel-region")), ["overview"]);

  // 逐个切换，任一时刻仍然只有一个区域。
  for (const region of HOST_REGIONS) {
    const button = view.container.querySelector('[data-easel-nav="' + region.id + '"]');
    await click(button);
    assert.deepEqual(rendered().map((node) => node.getAttribute("data-easel-region")), [region.id]);
    assert.equal(view.container.querySelectorAll("[data-easel-nav]").length, HOST_REGIONS.length);
  }

  await view.unmount();
});

test("区域抛错只显示该区域的错误态，子导航与「返回对话」仍可用", async () => {
  const bundle = await loadBundle();
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const previous = bundle.exports.__setRegionOverride("overview", function BrokenRegion() {
    throw new Error("injected region failure");
  });
  assert.equal(typeof previous, "function", "注入点应返回被替换掉的区域组件");

  // React 与我们的 componentDidCatch 都会往 console.error 写，这里刻意静音，避免污染输出。
  const realError = console.error;
  console.error = () => {};
  let view = null;
  try {
    view = await mount(React.createElement(panelOf(state)));

    assert.equal(view.container.querySelectorAll('[data-easel-boundary="region"]').length, 1, "区域层边界应兜住");
    assert.equal(view.container.querySelectorAll('[data-easel-boundary="panel"]').length, 0, "面板层不该被牵连");
    assert.match(view.container.textContent, /injected region failure/);

    // 子导航与返回入口仍然可操作。
    const navs = [...view.container.querySelectorAll("[data-easel-nav]")];
    assert.equal(navs.length, HOST_REGIONS.length);
    const back = view.container.querySelector("[data-easel-back]");
    assert.ok(back !== null, "返回对话入口必须仍在");
    await click(back);
    assert.deepEqual(state.layoutSelections, [null], "返回对话 = layout.selectPanel(null)");

    // 换到别的区域：错误态不粘着，且仍然只有一个区域在渲染。
    await click(view.container.querySelector('[data-easel-nav="accounts"]'));
    assert.deepEqual(
      [...view.container.querySelectorAll("[data-easel-region]")].map((node) => node.getAttribute("data-easel-region")),
      ["accounts"],
    );
    assert.equal(view.container.querySelectorAll('[data-easel-boundary="region"]').length, 0);
  } finally {
    console.error = realError;
    if (typeof previous === "function") bundle.exports.__setRegionOverride("overview", previous);
    if (view !== null) await view.unmount();
  }
});

test("面板根部有一层兜底的错误边界，并且兜底后仍能返回对话", async () => {
  const bundle = await loadBundle();
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const element = () => React.createElement(panelOf(state));
  const view = await mount(element());
  assert.equal(view.container.querySelectorAll('[data-easel-boundary="panel"]').length, 0);

  const realError = console.error;
  console.error = () => {};
  try {
    // 让标题取词失败：这不在任何区域组件里，只有面板根部那层边界兜得住。
    state.failKeys.add("panel.title");
    await act(async () => {
      // 必须是新的元素对象：同一个元素引用会被 React 判定无需更新，压根不会重渲染。
      view.root.render(element());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(view.container.querySelectorAll('[data-easel-boundary="panel"]').length, 1);
    assert.match(view.container.textContent, /injected label failure/);

    // 兜底态自己也要给出口，否则用户被困在一个没有任何按钮的错误页上。
    const back = view.container.querySelector("[data-easel-back]");
    assert.ok(back !== null, "根部兜底态必须保留返回对话入口");
    await click(back);
    assert.deepEqual(state.layoutSelections, [null]);
  } finally {
    console.error = realError;
  }

  await view.unmount();
});

test("排期条目能给「打开会话」入口，并走 uiWorkspace.openSession", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/schedule")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          items: [
            { id: "s1", title: "示例排期", status: "pending", kind: "once", scheduledAt: "2026-01-01T00:00:00Z", sessionId: "sess-1" },
            { id: "s2", title: "没有会话的排期", status: "pending", kind: "once", scheduledAt: "2026-01-02T00:00:00Z" },
          ],
        }),
      };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="calendar"]'));
  await flush();

  const buttons = [...view.container.querySelectorAll("[data-easel-open-session]")];
  assert.deepEqual(buttons.map((node) => node.getAttribute("data-easel-open-session")), ["sess-1"], "只有真的带 sessionId 的条目才有入口");

  await click(buttons[0]);
  assert.deepEqual(state.sessionOpens, ["sess-1"], "打开会话 = uiWorkspace.openSession(sessionId)");

  await view.unmount();
});

test("宿主半边未挂载（404 + 空响应体）时给可操作的提示，而不是裸的状态码", async () => {
  // 插件自己的 404 一定带 {ok:false,code:"not-found",message}；解析不出 JSON 的 404
  // 只可能是 DSH 自己的默认 404 —— 也就是宿主半边没挂载（design D14/D13）。
  const fetchImpl = async () => ({
    status: 404,
    json: async () => {
      throw new Error("Unexpected end of JSON input");
    },
  });

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  await flush();

  const text = view.container.textContent;
  assert.match(text, /宿主服务未挂载/, "404 且解析不出 JSON 时应当给可操作提示：" + text);
  assert.doesNotMatch(text, /HTTP 404/, "不该把裸状态码摊给用户：" + text);

  const failed = view.container.querySelectorAll('[data-easel-state="error"]');
  assert.ok(failed.length > 0, "区域应当进入错误状态");
  for (const node of failed) {
    assert.ok(node.querySelector("[data-easel-retry]") !== null, "错误状态必须留下重试入口");
  }

  await view.unmount();
});

test("产物静态约束：无 iframe、无 DSH 客户端包依赖、无硬编码色值", async () => {
  assert.equal(/iframe/i.test(bundleSource), false, "不得使用 iframe");
  assert.doesNotMatch(bundleSource, /require\(\s*["']@deepseek-ai\//, "不得 require DSH 客户端包");

  const specifiers = [...bundleSource.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
  assert.ok(specifiers.length > 0, "产物应当 require 了 react");
  for (const specifier of specifiers) {
    assert.ok(ALLOWED_SPECIFIERS.has(specifier), "非法的 require specifier：" + specifier);
  }

  assert.doesNotMatch(bundleSource, /#[0-9a-fA-F]{3,8}\b/, "不得出现硬编码色值");
  assert.doesNotMatch(bundleSource, /\b(?:rgba?|hsla?)\s*\(/, "不得出现硬编码色值");

  // 样式只引用 DSH 主题令牌。
  const customProps = bundleSource.match(/var\(\s*(--[a-zA-Z0-9-]+)/g) ?? [];
  assert.ok(customProps.length > 0, "产物应当带上样式");
  for (const declaration of customProps) {
    assert.match(declaration, /^var\(\s*--dsw-/, "只允许引用 --dsw-* 主题令牌：" + declaration);
  }

  // 字典必须内联进产物（浏览器侧取不到包里的 JSON）。
  assert.match(bundleSource, /var DICT_ZH = \{/);
  assert.match(bundleSource, /var DICT_EN = \{/);
  assert.ok(bundleSource.includes("自媒体工作台"));
  assert.ok(bundleSource.includes("Creator Workbench"));
});

test("lib/client.js 与 src/client.js + locale/*.json 保持一致", async () => {
  const { stdout } = await run(process.execPath, ["scripts/build-client.mjs", "--check"], { cwd: PACKAGE_ROOT });
  assert.match(stdout, /--check 通过/);
});
