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

const { JSDOM } = require("jsdom");

/**
 * react-dom 在 require 的那一刻就把 `canUseDOM` 烘死了：没有 document 时它走「非浏览器」分支，
 * 受控输入的 input 事件永远进不了 onChange（改动输入框的用例会一直拿到空字符串）。
 * 所以先架一个引导用的 DOM，再 require React。
 */
installGlobals(createDom());

const React = require("react");
const ReactDOMClient = require("react-dom/client");

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

test("产物静态约束：界面不用 iframe、无 DSH 客户端包依赖、无硬编码色值", async () => {
  // 面板本身必须是页面内组件；唯一允许的 iframe 是**产物预览**那个无脚本沙箱
  // （`sandbox=""`，见「HTML 产物只在无脚本沙箱里预览」用例），不得用来承载界面。
  const frames = [...bundleSource.matchAll(/h\(\s*["']iframe["']\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g)].map((match) => match[1]);
  assert.equal((bundleSource.match(/["']iframe["']/g) ?? []).length, frames.length, "iframe 只能由受检的那一处创建");
  assert.equal(frames.length, 1, "本就只该有产物预览一个 iframe");
  assert.match(frames[0], /sandbox:\s*""/, "产物预览 iframe 必须无脚本、无同源访问");
  assert.match(frames[0], /data-easel-publish-frame/, "被允许的 iframe 只能是产物预览");
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

test("宿主枚举值按字典本地化，字典缺词条时回落原值而不是空白", async () => {
  // 宿主给的是稳定的英文枚举（authorized / unauthorized…）。界面必须翻译，
  // 但**不能**因为字典里暂时没有某个新枚举就把条目显示成空白。
  const fetchImpl = async (url) => {
    if (String(url).includes("/accounts")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          accounts: [
            { platform: "bilibili", label: "哔哩哔哩", state: "authorized" },
            { platform: "xiaohongshu", label: "小红书", state: "unauthorized" },
            { platform: "brand-new", label: "新平台", state: "brand-new-state" },
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
  await click(view.container.querySelector('[data-easel-nav="accounts"]'));
  await flush();

  const tags = [...view.container.querySelectorAll(".easel-tag")].map((node) => node.textContent);
  assert.ok(tags.includes("已授权"), "authorized 应显示为已授权：" + tags.join(" / "));
  assert.ok(tags.includes("未授权"), "unauthorized 应显示为未授权：" + tags.join(" / "));
  assert.ok(tags.includes("brand-new-state"), "字典没有的枚举值必须原样显示：" + tags.join(" / "));
  assert.doesNotMatch(view.container.textContent, /unauthorized/, "不该把英文枚举直出给用户");
  // 高亮用的 CSS 类仍按宿主原值生成（样式与文案解耦）。
  assert.ok(view.container.querySelector(".easel-state-authorized") !== null, "状态类名必须保留宿主原值");

  await view.unmount();
});

test("环境自检的摘要行点名缺失与降级项，状态标签本地化", async () => {
  const selfcheck = async (entries, ready) => {
    const bundle = await loadBundle(async (url) => {
      if (String(url).includes("/selfcheck")) {
        return { status: 200, json: async () => ({ ok: true, ready, entries }) };
      }
      return { status: 200, json: async () => ({ ok: true }) };
    });
    const { ctx, state } = createContext();
    bundle.exports.apply(ctx);
    const view = await mount(React.createElement(panelOf(state)));
    await click(view.container.querySelector('[data-easel-nav="selfcheck"]'));
    await flush();
    return { bundle, state, view };
  };

  const mixed = await selfcheck(
    [
      { id: "python", label: "Python 运行时", status: "ok", path: "/usr/bin/python3" },
      { id: "ffmpeg", label: "ffmpeg", status: "missing", hint: "apt-get install -y ffmpeg" },
      { id: "runtime-dir", label: "运行时目录", status: "degraded" },
    ],
    false,
  );

  const summary = mixed.view.container.querySelector("[data-easel-selfcheck-ready]");
  assert.ok(summary !== null, "自检必须保留 ready 标记节点");
  assert.equal(summary.getAttribute("data-easel-selfcheck-ready"), "false");
  assert.equal(summary.textContent, "缺失：ffmpeg；降级：运行时目录", "摘要行必须点名缺什么，而不是只写「缺失」");
  assert.deepEqual(
    [...mixed.view.container.querySelectorAll(".easel-tag")].map((node) => node.textContent),
    ["正常", "缺失", "降级"],
    "状态标签必须本地化",
  );
  assert.match(mixed.view.container.textContent, /apt-get install -y ffmpeg/, "hint 必须照常渲染");
  await mixed.view.unmount();

  const allOk = await selfcheck([{ id: "python", label: "Python 运行时", status: "ok" }], true);
  assert.equal(allOk.view.container.querySelector("[data-easel-selfcheck-ready]").textContent, "全部就绪");
  await allOk.view.unmount();
});

test("选题能派发到会话：期望产物必填、既有会话可选，成功后给「打开会话」入口", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    calls.push({ url: target, options: options ?? null });
    if (target.includes("/topics")) {
      return { status: 200, json: async () => ({ ok: true, topics: [{ id: "t1", title: "秋季护肤选题", status: "idea" }] }) };
    }
    if (target.includes("/sessions")) {
      return {
        status: 200,
        json: async () => ({ ok: true, sessions: [{ id: "session-7", title: "上周的内容会话", running: false }] }),
      };
    }
    if (target.includes("/dispatch")) {
      return { status: 200, json: async () => ({ ok: true, sessionId: "session-easel-1", created: true }) };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="topics"]'));
  await flush();

  assert.equal(view.container.querySelector("[data-easel-dispatch-form]"), null, "派发表单默认收起");

  await click(view.container.querySelector('[data-easel-dispatch-toggle="t1"]'));
  await flush();

  const dispatches = () => calls.filter((call) => call.url.includes("/dispatch"));
  assert.equal(dispatches().length, 0, "点开表单本身不该发请求");

  const target = view.container.querySelector("[data-easel-dispatch-target]");
  assert.deepEqual(
    [...target.options].map((option) => option.value),
    ["new-session", "session-7"],
    "投递目标要同时给出新会话与既有会话",
  );
  assert.equal(target.value, "new-session", "默认投递到新会话");
  assert.match(target.options[1].textContent, /已休眠/, "会话状态要本地化");

  await click(view.container.querySelector("[data-easel-dispatch-submit]"));
  await flush();
  assert.equal(dispatches().length, 0, "没有期望产物时必须本地拦住，而不是把 INVALID_INPUT 交给宿主");
  assert.match(
    view.container.querySelector("[data-easel-dispatch-error]").textContent,
    /期望产物/,
    "拦下时要说明缺什么",
  );

  await setValue(view.container.querySelector("[data-easel-dispatch-deliverable]"), "一篇 800 字小红书图文");
  await setValue(view.container.querySelector("[data-easel-dispatch-profile]"), "brand");
  await click(view.container.querySelector("[data-easel-dispatch-submit]"));
  await flush();

  const posted = dispatches();
  assert.equal(posted.length, 1, "必须 POST /dispatch");
  assert.equal(posted[0].options.method, "POST");
  const body = JSON.parse(posted[0].options.body);
  assert.equal(body.target, "new-session");
  assert.equal(body.sessionId, undefined, "投递到新会话时不该带 sessionId");
  assert.equal(body.task.goal, "秋季护肤选题", "任务说明的 goal 应当就是选题标题");
  assert.equal(body.task.deliverable, "一篇 800 字小红书图文");
  assert.equal(body.task.profile, "brand");

  const done = view.container.querySelector("[data-easel-dispatch-done]");
  assert.ok(done !== null, "派发成功后要说明落到哪个会话");
  assert.match(done.textContent, /session-easel-1/);
  await click(done.querySelector("[data-easel-dispatch-open]"));
  assert.deepEqual(state.sessionOpens, ["session-easel-1"], "「打开会话」要走 uiWorkspace.openSession");

  await view.unmount();
});

test("空白区域给出「怎么才会有数据」的下一步，而不是只说暂无内容", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/projects")) return { status: 200, json: async () => ({ ok: true, projects: [] }) };
    if (target.includes("/profiles")) {
      return { status: 200, json: async () => ({ ok: true, profiles: [], dimensions: [] }) };
    }
    return { status: 200, json: async () => ({ ok: true, items: [], topics: [], sessions: [] }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);
  const view = await mount(React.createElement(panelOf(state)));

  const expectations = [
    ["topics", /选题是派发的起点/],
    ["calendar", /登记排期/],
    ["trends", /热点来自上游技能的联网抓取/],
    ["library", /内容库列出 outputs\//],
    ["profiles", /profiles\/<名称>\//],
  ];

  for (const [region, hint] of expectations) {
    await click(view.container.querySelector(`[data-easel-nav="${region}"]`));
    await flush();
    const empty = view.container.querySelector('[data-easel-state="empty"]');
    assert.ok(empty !== null, `${region} 应当是空态`);
    assert.ok(
      empty.querySelector("[data-easel-hint]") !== null,
      `${region} 的空态必须带「下一步」说明`,
    );
    assert.match(empty.textContent, hint, `${region} 的说明要说到点子上：${empty.textContent}`);
  }

  await view.unmount();
});

test("画像可以新建，也能逐维度编辑并写回宿主", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    const method = options?.method ?? "GET";
    calls.push({ url: target, method, options: options ?? null });
    if (target.includes("/profiles/brand") && method === "PUT") {
      return { status: 200, json: async () => ({ ok: true, name: "brand", dimension: "identity", bytes: 21 }) };
    }
    if (target.includes("/profiles/brand")) {
      return {
        status: 200,
        json: async () => ({ ok: true, name: "brand", dimensions: { identity: "# identity\n", style: "# style\n" } }),
      };
    }
    if (target.includes("/profiles")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          profiles: [{ name: "brand", dimensions: ["identity", "style"] }],
          dimensions: ["identity", "style", "audience", "platforms", "preferences", "memory"],
        }),
      };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);
  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="profiles"]'));
  await flush();

  await setValue(view.container.querySelector("[data-easel-profile-input]"), "new-brand");
  await click(view.container.querySelector("[data-easel-profile-create]"));
  await flush();
  const created = calls.find((call) => call.url.includes("/profiles") && call.method === "POST");
  assert.ok(created !== undefined, "「新建画像」必须 POST /profiles");
  assert.deepEqual(JSON.parse(created.options.body), { name: "new-brand" });

  await click(view.container.querySelector('[data-easel-profile="brand"]'));
  await flush();
  await click(view.container.querySelector('[data-easel-profile-edit="identity"]'));
  await flush();

  const editor = view.container.querySelector('[data-easel-profile-editor="identity"]');
  assert.equal(editor.value, "# identity\n", "编辑框要带出当前内容");
  await setValue(editor, "# identity\n面向通勤族\n");
  await click(view.container.querySelector('[data-easel-profile-save="identity"]'));
  await flush();

  const written = calls.find((call) => call.method === "PUT");
  assert.ok(written !== undefined, "保存必须 PUT 维度");
  assert.match(written.url, /\/profiles\/brand\/dimensions\/identity$/);
  assert.deepEqual(JSON.parse(written.options.body), { text: "# identity\n面向通勤族\n" });
  assert.match(
    view.container.querySelector("[data-easel-profile-saved]").textContent,
    /已保存 identity（21 字节）/,
    "保存后要回报写了哪个维度",
  );

  await view.unmount();
});

/** 受控输入必须走原生 value setter 再派发事件，React 才会把变更收进 state。 */
async function setValue(node, value) {
  assert.ok(node !== null && node !== undefined, "要填写的节点必须存在");
  const view = node.ownerDocument.defaultView;
  const prototypes = {
    INPUT: view.HTMLInputElement.prototype,
    TEXTAREA: view.HTMLTextAreaElement.prototype,
    SELECT: view.HTMLSelectElement.prototype,
  };
  const descriptor = Object.getOwnPropertyDescriptor(prototypes[node.tagName], "value");
  await act(async () => {
    descriptor.set.call(node, value);
    node.dispatchEvent(new view.Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("扫码登录：启动走 POST /accounts/:id/login，二维码与短信码如实呈现", async () => {
  const calls = [];
  let statusPayload = {
    ok: true,
    platform: "xiaohongshu",
    rawState: "unauthorized",
    running: false,
    qrReady: false,
    smsRequired: false,
  };
  const fetchImpl = async (url, options) => {
    const target = String(url);
    calls.push({ url: target, options: options ?? null });

    if (target.includes("/login/status")) return { status: 200, json: async () => statusPayload };
    if (target.endsWith("/login")) return { status: 200, json: async () => ({ ok: true, started: true }) };
    if (target.includes("/login/sms")) return { status: 200, json: async () => ({ ok: true, accepted: true }) };
    if (target.includes("/accounts")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          accounts: [{ platform: "xiaohongshu", label: "小红书", state: "unauthorized", message: "未授权" }],
        }),
      };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  // 登录面板会自我续期轮询，断言失败时也必须卸载，否则定时器会让整个测试进程退不出去。
  try {
  await click(view.container.querySelector('[data-easel-nav="accounts"]'));
  await flush();
  assert.equal(view.container.querySelector("[data-easel-login]"), null, "登录面板默认收起");

  await click(view.container.querySelector('[data-easel-login-toggle="xiaohongshu"]'));
  await flush();
  const panel = view.container.querySelector('[data-easel-login="xiaohongshu"]');
  assert.ok(panel !== null, "点「扫码登录」要展开面板");
  assert.equal(
    panel.querySelector('[data-easel-login-state="unauthorized"]').textContent,
    "未授权",
    "登录态要按字典本地化，而不是露出 rawState",
  );
  assert.equal(panel.querySelector("[data-easel-qr]"), null, "脚本没产出二维码之前不能显示图");

  const starts = () => calls.filter((call) => call.url.endsWith("/accounts/xiaohongshu/login"));
  await click(panel.querySelector("[data-easel-login-start]"));
  await flush();
  assert.equal(starts().length, 1, "「开始扫码登录」必须 POST 启动端点");
  assert.equal(starts()[0].options.method, "POST");

  // 脚本把二维码写进状态目录之后，面板指向宿主的二进制端点，并带 ts 破缓存。
  statusPayload = {
    ok: true,
    platform: "xiaohongshu",
    rawState: "qr_ready",
    running: true,
    qrReady: true,
    qrTs: 1712345678000,
    smsRequired: false,
  };
  await click(panel.querySelector("[data-easel-login-refresh]"));
  await flush();
  const qr = panel.querySelector("[data-easel-qr]");
  assert.ok(qr !== null, "qrReady 时必须显示二维码");
  assert.equal(
    qr.getAttribute("src"),
    "/easel-workbench/api/accounts/xiaohongshu/qr?ts=1712345678000",
    "二维码要指向宿主端点并带上二维码时间戳",
  );

  // 平台风控要短信码时给回填入口；提交只把数字码交给宿主。
  statusPayload = {
    ok: true,
    platform: "xiaohongshu",
    rawState: "sms_required",
    running: true,
    qrReady: true,
    qrTs: 1712345678000,
    smsRequired: true,
  };
  await click(panel.querySelector("[data-easel-login-refresh]"));
  await flush();
  assert.ok(panel.querySelector("[data-easel-login-sms-input]") !== null, "smsRequired 时必须给回填短信码的入口");
  await setValue(panel.querySelector("[data-easel-login-sms-input]"), "123456");
  await click(panel.querySelector("[data-easel-login-sms]"));
  await flush();
  const smsCalls = calls.filter((call) => call.url.includes("/login/sms"));
  assert.equal(smsCalls.length, 1, "提交验证码要 POST 短信端点");
  assert.deepEqual(JSON.parse(smsCalls[0].options.body), { code: "123456" });
  assert.match(panel.querySelector("[data-easel-login-sms-state]").textContent, /验证码已提交/);

  // 成功态显示本地化的「已成功」，而不是 success。
  statusPayload = {
    ok: true,
    platform: "xiaohongshu",
    rawState: "success",
    running: false,
    qrReady: true,
    qrTs: 1712345678000,
    smsRequired: false,
  };
  await click(panel.querySelector("[data-easel-login-refresh]"));
  await flush();
  assert.equal(panel.querySelector('[data-easel-login-state="success"]').textContent, "已成功");
  } finally {
    await view.unmount();
  }
});

test("发布：预览不执行、执行必须先勾选确认，参数按平台脚本形状拼装", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    calls.push({ url: target, options: options ?? null });
    if (target.includes("/publish/platforms")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          platforms: [
            {
              id: "xiaohongshu",
              label: "小红书",
              style: "xhs",
              accepts: ["image", "video"],
              limits: { title: 20, body: 1000, tags: 10 },
            },
            { id: "wechat", label: "微信公众号", style: "wechat", accepts: ["article"], limits: { title: 64, body: 0, tags: 0 } },
          ],
        }),
      };
    }
    if (target.includes("/publish/preview")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          platform: "xiaohongshu",
          command: "python3 xhs_publish.py publish --images outputs/秋季护肤/note.md",
          guard: { blocked: false, exitCode: 0, findings: [], warnings: [] },
          warnings: [],
        }),
      };
    }
    if (target.includes("/publish/execute")) {
      return { status: 200, json: async () => ({ ok: true, exitCode: 0, readback: "published", reason: "" }) };
    }
    if (target.includes("/publish/history")) return { status: 200, json: async () => ({ ok: true, records: [] }) };
    if (target.includes("/projects/")) {
      return {
        status: 200,
        json: async () => ({ ok: true, topic: "秋季护肤", files: [{ path: "note.md", name: "note.md", kind: "text", bytes: 12 }] }),
      };
    }
    if (target.includes("/projects")) return { status: 200, json: async () => ({ ok: true, projects: [{ topic: "秋季护肤" }] }) };
    if (target.includes("/files?path=")) return { ok: true, status: 200, text: async () => "# 秋季护肤三步走\n\n第一步：温和清洁。\n" };
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="publish"]'));
  await flush();

  const form = view.container.querySelector("[data-easel-publish-form]");
  assert.ok(form !== null, "发布区必须有表单，而不是只有平台表和历史");
  assert.deepEqual(
    [...form.querySelector("[data-easel-publish-platform]").options].map((option) => option.value),
    ["", "xiaohongshu", "wechat"],
    "平台下拉要来自宿主清单",
  );

  // 没选平台就点预览：本地拦住，一个请求都不发。
  await click(form.querySelector("[data-easel-publish-preview]"));
  await flush();
  assert.equal(calls.filter((call) => call.url.includes("/publish/preview")).length, 0, "缺平台时不能发请求");
  assert.match(form.querySelector("[data-easel-publish-error]").textContent, /请先选择平台/);

  await setValue(form.querySelector("[data-easel-publish-platform]"), "xiaohongshu");
  await setValue(form.querySelector("[data-easel-publish-topic]"), "秋季护肤");
  await flush();
  await setValue(form.querySelector("[data-easel-publish-file]"), "note.md");
  await flush();

  // 选中产物后必须能直接看它：走宿主 /files 内联返回，而不是只给一行命令。
  const openLink = form.querySelector("[data-easel-publish-open]");
  assert.ok(openLink !== null, "选中产物后要有打开产物的入口");
  assert.equal(openLink.getAttribute("href"), "/easel-workbench/api/files?path=" + encodeURIComponent("outputs/秋季护肤/note.md"));
  assert.equal(openLink.getAttribute("target"), "_blank");

  // 就地预览：不离开表单，右列摊开产物内容。
  await click(form.querySelector("[data-easel-publish-view]"));
  await flush();
  await flush();
  assert.match(form.className, /is-split/, "点「在右侧预览」后表单要进入分栏形态");
  const pane = form.querySelector("[data-easel-publish-pane]");
  assert.ok(pane !== null, "分栏里要有产物预览面板");
  assert.match(pane.querySelector("[data-easel-publish-text]").textContent, /秋季护肤三步走/, "文本产物要按纯文本摊开");
  assert.equal(
    pane.querySelector('[data-easel-publish-open="pane"]').getAttribute("href"),
    "/easel-workbench/api/files?path=" + encodeURIComponent("outputs/秋季护肤/note.md"),
    "分栏里仍要保留新标签页退路",
  );
  await click(pane.querySelector("[data-easel-publish-pane-close]"));
  await flush();
  assert.equal(form.querySelector("[data-easel-publish-pane]"), null, "关掉后分栏要收起");
  assert.doesNotMatch(form.className, /is-split/);

  await setValue(form.querySelector("[data-easel-publish-title]"), "秋季护肤三步走");
  await setValue(form.querySelector("[data-easel-publish-tags]"), "护肤, 通勤");
  await click(form.querySelector("[data-easel-publish-preview]"));
  await flush();

  const previews = calls.filter((call) => call.url.includes("/publish/preview"));
  assert.equal(previews.length, 1, "预览要 POST 预演端点");
  assert.deepEqual(JSON.parse(previews[0].options.body), {
    platform: "xiaohongshu",
    title: "秋季护肤三步走",
    tags: ["护肤", "通勤"],
    media: ["outputs/秋季护肤/note.md"],
  });
  const previewed = form.querySelector("[data-easel-publish-preview-result]");
  assert.match(previewed.textContent, /xhs_publish\.py/, "预览要把将要执行的命令摊开给人看");
  assert.match(previewed.textContent, /内容门禁通过/);
  assert.ok(previewed.querySelector("[data-easel-publish-open]") !== null, "预检结果里也要能直接打开产物");

  // 没勾选确认就点发布：本地拦住，绝不真发。
  await click(form.querySelector("[data-easel-publish-execute]"));
  await flush();
  assert.equal(calls.filter((call) => call.url.includes("/publish/execute")).length, 0, "没勾选确认时绝不能真发");
  assert.match(form.querySelector("[data-easel-publish-error]").textContent, /勾选确认/);

  await click(form.querySelector("[data-easel-publish-confirm]"));
  await flush();
  await click(form.querySelector("[data-easel-publish-execute]"));
  await flush();
  const executes = calls.filter((call) => call.url.includes("/publish/execute"));
  assert.equal(executes.length, 1, "勾选确认后必须 POST 执行端点");
  assert.equal(form.querySelector("[data-easel-publish-result]").getAttribute("data-easel-publish-result"), "ok");
  assert.match(form.querySelector("[data-easel-publish-result]").textContent, /已发布/);

  await view.unmount();
});

test("HTML 产物只在无脚本沙箱里预览，绝不注入面板 DOM", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    calls.push({ url: target, options: options ?? null });
    if (target.includes("/publish/platforms")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          platforms: [{ id: "wechat", label: "微信公众号", style: "wechat", accepts: ["article"], limits: { title: 64, body: 0, tags: 0 } }],
        }),
      };
    }
    if (target.includes("/projects/")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          topic: "DSH插件",
          files: [{ path: "dsh-context-公众号排版.html", name: "dsh-context-公众号排版.html", kind: "html", bytes: 15557 }],
        }),
      };
    }
    if (target.includes("/projects")) return { status: 200, json: async () => ({ ok: true, projects: [{ topic: "DSH插件" }] }) };
    if (target.includes("/files?path=")) return { ok: true, status: 200, text: async () => "<h1>不该被注入面板</h1>" };
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);
  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="publish"]'));
  await flush();

  const form = view.container.querySelector("[data-easel-publish-form]");
  await setValue(form.querySelector("[data-easel-publish-platform]"), "wechat");
  await setValue(form.querySelector("[data-easel-publish-topic]"), "DSH插件");
  await flush();
  await setValue(form.querySelector("[data-easel-publish-file]"), "dsh-context-公众号排版.html");
  await flush();
  await click(form.querySelector("[data-easel-publish-view]"));
  await flush();

  const frame = form.querySelector("[data-easel-publish-frame]");
  assert.ok(frame !== null, "HTML 产物要在沙箱 iframe 里预览");
  assert.equal(frame.getAttribute("sandbox"), "", "沙箱必须既禁脚本也不给同源访问");
  assert.equal(
    frame.getAttribute("src"),
    "/easel-workbench/api/files?path=" + encodeURIComponent("outputs/DSH插件/dsh-context-公众号排版.html"),
  );
  assert.equal(form.querySelector("[data-easel-publish-text]"), null, "HTML 不走纯文本分支");
  assert.doesNotMatch(form.innerHTML, /不该被注入面板/, "产物内容绝不能被注入面板 DOM");
  assert.equal(
    calls.filter((call) => call.url.includes("/files?path=")).length,
    0,
    "HTML 交给 iframe 自己加载，不该再额外取一次文本",
  );

  await view.unmount();
});

test("宿主还是旧版（未知接口 404）时，错误文案要给出「重启 DSH」这一步", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith("/accounts/xiaohongshu/login")) {
      return {
        status: 404,
        json: async () => ({
          ok: false,
          code: "not-found",
          message: "未知接口：POST /easel-workbench/api/accounts/xiaohongshu/login",
        }),
      };
    }
    if (target.includes("/login/status")) {
      return { status: 200, json: async () => ({ ok: true, platform: "xiaohongshu", rawState: "unauthorized", running: false }) };
    }
    if (target.includes("/accounts")) {
      return {
        status: 200,
        json: async () => ({ ok: true, accounts: [{ platform: "xiaohongshu", label: "小红书", state: "unauthorized", message: "未授权" }] }),
      };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  try {
    await click(view.container.querySelector(String.raw`[data-easel-nav="accounts"]`));
    await flush();
    await click(view.container.querySelector(String.raw`[data-easel-login-toggle="xiaohongshu"]`));
    await flush();
    const panel = view.container.querySelector(String.raw`[data-easel-login="xiaohongshu"]`);
    await click(panel.querySelector("[data-easel-login-start]"));
    await flush();

    const error = panel.querySelector("[data-easel-login-error]");
    assert.ok(error !== null, "启动失败要如实显示错误");
    assert.match(error.textContent, /未知接口/, "保留宿主原文，别把真相吞掉");
    assert.match(error.textContent, /重启 DSH/, "光说接口不认不够，要给出可执行的下一步");
  } finally {
    await view.unmount();
  }
});

test("脚本只留下一句「浏览器没能打开」时，面板要能就地摊开它的原始输出", async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/login/status")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          platform: "xiaohongshu",
          rawState: "error",
          running: false,
          message: "浏览器没能打开。请关闭弹窗，等 10 秒再点登录，不要连点。",
          logTail: "ERROR: 小红书判定当前网络为风险 IP（安全限制 300012「IP存在风险，请切换可靠网络环境」）",
        }),
      };
    }
    if (target.includes("/accounts")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          accounts: [{ platform: "xiaohongshu", label: "小红书", state: "unauthorized", message: "未授权" }],
        }),
      };
    }
    return { status: 200, json: async () => ({ ok: true }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  try {
    await click(view.container.querySelector(String.raw`[data-easel-nav="accounts"]`));
    await flush();
    await click(view.container.querySelector(String.raw`[data-easel-login-toggle="xiaohongshu"]`));
    await flush();

    const panel = view.container.querySelector(String.raw`[data-easel-login="xiaohongshu"]`);
    const log = panel.querySelector("[data-easel-login-log]");
    assert.ok(log !== null, "脚本自己写的状态太短，必须能就地看到它的原始输出");
    assert.match(log.textContent, /300012/, "原始输出要原样带出来，不能二次概括");
    assert.match(log.textContent, /脚本原始输出/, "要有可展开的标题，默认不占版面");
  } finally {
    await view.unmount();
  }
});

test("热点：可选来源用 ?ids= 传给宿主，线索能存进选题库", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    calls.push({ url: target, options: options ?? null });
    if (target.includes("/trends")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          fetchedAt: "2026-10-09T13:00:00Z",
          sources: [{ source: "weibo", label: "微博", ok: true }],
          items: [{ title: "某地降温", hot: 12345, url: "https://example.com/hot" }],
          failures: [],
        }),
      };
    }
    if (target.includes("/topics")) return { status: 200, json: async () => ({ ok: true, topic: { id: "t9", title: "某地降温" } }) };
    return { status: 200, json: async () => ({ ok: true, topics: [], items: [] }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);

  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="trends"]'));
  await flush();

  const trendCalls = () => calls.filter((call) => call.url.includes("/trends"));
  assert.equal(trendCalls().length, 1, "默认抓一次");
  assert.equal(trendCalls()[0].url.includes("ids="), false, "不选来源时由宿主决定全部来源");
  assert.equal(view.container.querySelector("[data-easel-fetched-at]").textContent, "2026-10-09T13:00:00Z");

  await click(view.container.querySelector('[data-easel-trend-source="weibo"]'));
  await flush();
  assert.equal(trendCalls().length, 2, "勾选来源后要重新抓取");
  assert.match(trendCalls()[1].url, /\?ids=weibo$/);

  await click(view.container.querySelector('[data-easel-trend-save="0"]'));
  await flush();
  const saved = calls.find((call) => call.url.includes("/topics") && call.options !== null && call.options.method === "POST");
  assert.ok(saved !== undefined, "「存为选题」要 POST /topics");
  assert.deepEqual(JSON.parse(saved.options.body), { title: "某地降温", note: "https://example.com/hot", source: "trend" });
  assert.match(view.container.querySelector('[data-easel-trend-save-state="done"]').textContent, /已存进选题库/);

  await view.unmount();
});


test("登记排期：必填项本地就拦下，定时字段按 DSH 的形状原样透传", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    const method = options?.method ?? "GET";
    calls.push({ url: target, method, options: options ?? null });
    if (target.includes("/sessions")) {
      return { status: 200, json: async () => ({ ok: true, sessions: [{ id: "s-1", title: "内容工厂", running: false }] }) };
    }
    if (target.includes("/schedule") && method === "POST") {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          record: { id: "sch-1", title: "Easel｜春季选题", scheduledAt: "2026-10-10T01:00:00.000Z" },
          sessionId: "s-1",
        }),
      };
    }
    return { status: 200, json: async () => ({ ok: true, items: [], total: 0, active: 0 }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);
  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="calendar"]'));
  await flush();

  const posts = () => calls.filter((call) => call.url.includes("/schedule") && call.method === "POST");
  const reads = () => calls.filter((call) => call.url.includes("/schedule") && call.method === "GET");
  assert.equal(reads().length, 1, "挂载时读一次排期列表");

  // 一项没填就提交：本地拦下，一个请求都不发。
  await click(view.container.querySelector("[data-easel-schedule-submit]"));
  await flush();
  assert.equal(posts().length, 0, "缺项时不应该发请求");
  const error = view.container.querySelector("[data-easel-schedule-error]");
  assert.match(error.textContent, /请填写：主题/);
  assert.match(error.textContent, /投递到会话/);

  await setValue(view.container.querySelector("[data-easel-schedule-topic]"), "春季选题");
  await setValue(view.container.querySelector("[data-easel-schedule-goal]"), "产出三条口播脚本");
  await setValue(view.container.querySelector("[data-easel-schedule-deliverable]"), "3 条脚本");
  await setValue(view.container.querySelector("[data-easel-schedule-session]"), "s-1");
  await setValue(view.container.querySelector("[data-easel-schedule-zone]"), "Asia/Shanghai");
  await setValue(view.container.querySelector("[data-easel-schedule-time]"), "08:30");
  await click(view.container.querySelector("[data-easel-schedule-submit]"));
  await flush();

  assert.equal(posts().length, 1);
  assert.deepEqual(JSON.parse(posts()[0].options.body), {
    topic: "春季选题",
    sessionId: "s-1",
    task: { goal: "产出三条口播脚本", deliverable: "3 条脚本" },
    daily: { time: "08:30:00", time_zone: "Asia/Shanghai" },
  });
  assert.match(view.container.querySelector("[data-easel-schedule-done]").textContent, /2026-10-10T01:00:00\.000Z/);
  assert.equal(reads().length, 2, "登记成功后要刷新列表");

  // 每周：多一个星期字段，字段名与 DSH 的 weekly 一致。
  await setValue(view.container.querySelector("[data-easel-schedule-mode]"), "weekly");
  await setValue(view.container.querySelector("[data-easel-schedule-weekday]"), "3");
  await click(view.container.querySelector("[data-easel-schedule-submit]"));
  await flush();
  assert.deepEqual(JSON.parse(posts()[1].options.body).weekly, {
    time: "08:30:00",
    time_zone: "Asia/Shanghai",
    weekdays: [3],
  });

  // 只一次：给出日期，用 DSH 的 at 形态；同一时刻只能有一个定时字段。
  await setValue(view.container.querySelector("[data-easel-schedule-mode]"), "once");
  await setValue(view.container.querySelector("[data-easel-schedule-date]"), "2026-11-01");
  await click(view.container.querySelector("[data-easel-schedule-submit]"));
  await flush();
  const once = JSON.parse(posts()[2].options.body);
  assert.deepEqual(once.at, { date: "2026-11-01", time: "08:30:00", time_zone: "Asia/Shanghai" });
  assert.equal(once.daily, undefined, "不能同时给出两个定时字段");

  await view.unmount();
});

test("排期条目可以删除，没有会话绑定的条目不显示删除按钮", async () => {
  const calls = [];
  let failDelete = false;
  const fetchImpl = async (url, options) => {
    const target = String(url);
    const method = options?.method ?? "GET";
    calls.push({ url: target, method, options: options ?? null });
    if (target.includes("/sessions")) return { status: 200, json: async () => ({ ok: true, sessions: [] }) };
    if (method === "DELETE") {
      if (failDelete) {
        return { status: 409, json: async () => ({ ok: false, code: "schedule-conflict", message: "DSH 拒绝了这次删除。" }) };
      }
      return { status: 200, json: async () => ({ ok: true, removed: "sch-1" }) };
    }
    return {
      status: 200,
      json: async () => ({
        ok: true,
        items: [
          { id: "sch-1", topic: "春季选题", status: "active", kind: "daily", scheduledAt: "2026-10-10T01:00:00.000Z", sessionId: "s-1" },
          { id: "sch-2", topic: "无会话", status: "paused", kind: "daily", scheduledAt: "2026-10-11T01:00:00.000Z", sessionId: null },
        ],
        total: 2,
        active: 1,
      }),
    };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);
  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="calendar"]'));
  await flush();

  assert.equal(
    view.container.querySelector('[data-easel-schedule-delete="sch-2"]'),
    null,
    "没有会话绑定就不该有删除按钮（宿主删除必须带 sessionId）",
  );

  await click(view.container.querySelector('[data-easel-schedule-delete="sch-1"]'));
  await flush();
  const deletes = calls.filter((call) => call.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].url, /\/schedule\/sch-1$/);
  assert.deepEqual(JSON.parse(deletes[0].options.body), { id: "sch-1", sessionId: "s-1" });
  assert.equal(view.container.querySelector("[data-easel-schedule-delete-error]"), null, "成功时不显示错误");

  failDelete = true;
  await click(view.container.querySelector('[data-easel-schedule-delete="sch-1"]'));
  await flush();
  assert.match(
    view.container.querySelector("[data-easel-schedule-delete-error]").textContent,
    /DSH 拒绝了这次删除/,
  );

  await view.unmount();
});

test("内容日历：周一起始铺满 42 格，筛选与翻月都能用", async () => {
  const now = new Date();
  const pad = (value) => (value < 10 ? "0" + String(value) : String(value));
  const month = now.getFullYear() + "-" + pad(now.getMonth() + 1);
  const nextMonth = (() => {
    const shifted = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return shifted.getFullYear() + "-" + pad(shifted.getMonth() + 1);
  })();
  const eventDay = month + "-19";
  const contentDay = month + "-25";
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = String(url);
    const method = options?.method ?? "GET";
    calls.push({ url: target, method, options: options ?? null });
    if (target.includes("/calendar")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          month,
          from: month + "-01",
          to: month + "-30",
          count: 2,
          items: [
            { id: "e1", date: eventDay, title: "七夕节", platform: "", kind: "event", status: "", eventType: "节日" },
            { id: "c1", date: contentDay, title: "秋季护肤三步走", platform: "小红书", kind: "content", status: "scheduled" },
          ],
        }),
      };
    }
    if (target.includes("/schedule")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          items: [
            { id: "sch-1", topic: "草稿里的选题", status: "draft", scheduledAt: contentDay + "T09:00:00.000+08:00", sessionId: "s-1" },
          ],
        }),
      };
    }
    return { status: 200, json: async () => ({ ok: true, items: [], total: 0, active: 0 }) };
  };

  const bundle = await loadBundle(fetchImpl);
  const { ctx, state } = createContext();
  bundle.exports.apply(ctx);
  const view = await mount(React.createElement(panelOf(state)));
  await click(view.container.querySelector('[data-easel-nav="calendar"]'));
  await flush();

  const days = view.container.querySelectorAll("[data-easel-calendar-day]");
  assert.equal(days.length, 42, "月历固定 6 周 × 7 天");
  assert.equal(days[0].getAttribute("data-easel-calendar-day") <= month + "-01", true, "首格是当月 1 号所在周的周一或更早");
  const weekdays = [...view.container.querySelectorAll(".easel-calendar-weekday")].map((node) => node.textContent);
  assert.deepEqual(weekdays, ["一", "二", "三", "四", "五", "六", "日"]);
  assert.equal(view.container.querySelectorAll(".easel-calendar-legend-item").length, 5, "五个图例");
  assert.equal(view.container.querySelectorAll(".easel-calendar-dot.is-event").length >= 1, true);
  assert.match(calls.find((call) => call.url.includes("/calendar")).url, /calendar\?month=/);

  const dayCell = (key) => view.container.querySelector('[data-easel-calendar-day="' + key + '"]');
  assert.match(dayCell(eventDay).textContent, /七夕节/);
  assert.equal(dayCell(eventDay).querySelector('[data-easel-calendar-item="event"]') !== null, true);
  assert.match(dayCell(contentDay).textContent, /秋季护肤三步走/);
  assert.match(dayCell(contentDay).textContent, /小红书/, "平台以徽标出现在格子里");
  assert.equal(dayCell(contentDay).querySelector('[data-easel-calendar-item="scheduled"]') !== null, true);
  assert.equal(dayCell(contentDay).querySelector('[data-easel-calendar-item="draft"]') !== null, true, "DSH 排期也进月历");

  // 只看活动：内容条目全部收起。
  await click(view.container.querySelector('[data-easel-calendar-filter="event"]'));
  await flush();
  assert.equal(view.container.querySelectorAll('[data-easel-calendar-item="event"]').length, 1);
  assert.equal(view.container.querySelectorAll('[data-easel-calendar-item="scheduled"]').length, 0);
  assert.equal(view.container.querySelector('[data-easel-calendar-item="draft"]'), null);

  // 只看内容：平台活动收起。
  await click(view.container.querySelector('[data-easel-calendar-filter="content"]'));
  await flush();
  assert.equal(view.container.querySelectorAll('[data-easel-calendar-item="event"]').length, 0);
  assert.equal(view.container.querySelectorAll('[data-easel-calendar-item="scheduled"]').length, 1);

  // 翻月：宿主拿到的是新的 YYYY-MM。
  await click(view.container.querySelector('[data-easel-calendar-next]'));
  await flush();
  assert.equal(view.container.querySelector("[data-easel-calendar-month]").textContent, nextMonth);
  assert.match(calls.filter((call) => call.url.includes("/calendar")).at(-1).url, new RegExp("month=" + nextMonth));
  await click(view.container.querySelector('[data-easel-calendar-today]'));
  await flush();
  assert.equal(view.container.querySelector("[data-easel-calendar-month]").textContent, month);

  await view.unmount();
});
