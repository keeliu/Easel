/**
 * 自媒体工作台 —— 客户端半边（浏览器侧 UI）。
 *
 * 设计取舍（都是「为什么」，不是「做了什么」）：
 *
 * - 手写、无构建期依赖。运行时的 `require()` 只有一张 9 项的静态表，任何 DSH 客户端
 *   包、任何打包器（esbuild / rollup / vite）都会让这份产物在加载期直接失败；因此这里
 *   也**不用 JSX**——用 JSX 就得引 `react/jsx-runtime` 之外的转译环节。只用 `react`。
 * - 浏览器取不到 `lib/host/**`（那是 Host 进程的 ESM），所以 `PANEL_ID`、`API_PREFIX`、
 *   `REGIONS` 在这份源码里各留一份；一致性交给 `test/client.test.mjs` 对着宿主模块断言，
 *   而不是让构建脚本去 `import` 宿主（那会把 schemastery 拉进构建链，且构建产物会随
 *   宿主内部实现漂移）。
 * - 文案一律走 locale：字典由 `scripts/build-client.mjs` 从 `locale/*.json` 内联到下面
 *   那行标记处，`locale/*.json` 仍是唯一事实源；`ctx.locale.bind()` 的取词函数在调用时
 *   读取当前语言，所以语言切换无需重建组件。
 * - 静态 `inject` 只声明 `["slots", "locale"]`：cordis 的 fiber 只要有一个静态依赖在
 *   当前 profile 里不存在就会永久停在 INACTIVE，插件再也不会激活。`layout` 是可选的，
 *   所以用 `ctx.get("layout")` 现取，取不到就退化成「返回对话」按钮无动作而不是崩掉。
 */

window.__ModuleLoader__.load({
  id: "easel-workbench",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    // 构建脚本把本行替换为从 locale/zh-CN.json、locale/en.json 生成的内联字典。
    // 浏览器侧只有 zh / en 两个内置 locale id，`zh-CN` 不是其中之一。
    // @easel-locale-inline

    var NS = "easel-workbench";
    var PANEL_ID = "easel-workbench";
    var API_PREFIX = "/easel-workbench/api";

    /** 右侧内联预览：HTML 走沙箱 iframe，其余按文本读回，超过 20 万字符只显示前一段。 */
    var PANE_TEXT_LIMIT = 200000;
    var PANE_FRAME_EXTENSIONS = ["html", "htm"];

    /**
     * 侧边栏面板条目的排序值。列表按 order 升序渲染，「新会话」按钮在列表上方，
     * 所以越小越靠上；取 5 是为了插在既有条目（插件 0 / 排期 10）之间靠前的位置，
     * 又不与它们同值（同值要靠插入顺序决胜，那不稳定）。
     */
    var PANEL_ROW_ORDER = 5;

    /** 与 `lib/host/config.js` 的 `REGIONS` 同序同 id；`labelKey` 指向本插件的字典。 */
    var REGIONS = [
      { id: "overview", labelKey: "nav.overview" },
      { id: "accounts", labelKey: "nav.accounts" },
      { id: "profiles", labelKey: "nav.profiles" },
      { id: "library", labelKey: "nav.library" },
      { id: "publish", labelKey: "nav.publish" },
      { id: "calendar", labelKey: "nav.calendar" },
      { id: "topics", labelKey: "nav.topics" },
      { id: "trends", labelKey: "nav.trends" },
      { id: "analytics", labelKey: "nav.analytics" },
      { id: "selfcheck", labelKey: "nav.selfcheck" },
    ];

    /** 侧边栏字形：与包根 `icon.svg` 同一组 path，颜色靠 `currentColor` 跟随宿主。 */
    var GLYPH_PATHS = ["M12 3.5 5.5 20.5", "M12 3.5 18.5 20.5", "M8.4 12.5h7.2", "M7.2 16.5h9.6", "M4.6 20.5h14.8"];

    /**
     * 全部样式只用 DSH 主题令牌（`var(--dsw-alias-*)`），暗色由宿主在 body 上挂
     * `data-ds-dark-theme` 切换，插件侧不需要（也不允许）写死任何色值。
     */
    var CSS = [
      "[data-easel-panel]{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}",
      ".easel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".easel-title{margin:0;font-size:16px;font-weight:600}",
      ".easel-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".easel-nav{display:flex;flex-wrap:wrap;gap:6px;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
      ".easel-nav-item{cursor:pointer;border:1px solid transparent;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;padding:4px 10px}",
      ".easel-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".easel-nav-item-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}",
      ".easel-body{flex:1;min-height:0;overflow:auto;padding:14px 20px 24px}",
      ".easel-region{display:flex;flex-direction:column;gap:14px}",
      ".easel-split{display:flex;gap:16px;align-items:flex-start}",
      ".easel-list-side{width:230px;flex:none}",
      ".easel-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}",
      ".easel-row{display:flex;align-items:center;gap:10px;justify-content:space-between;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}",
      ".easel-row-main{display:flex;flex-direction:column;gap:2px;min-width:0}",
      ".easel-row-title{overflow-wrap:anywhere}",
      ".easel-muted{color:var(--dsw-alias-label-secondary);font-size:12px}",
      ".easel-path{overflow-wrap:anywhere}",
      ".easel-hint{padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}",
      ".easel-kv{margin:0;display:flex;flex-direction:column;gap:4px}",
      ".easel-kv-row{display:flex;gap:10px}",
      ".easel-kv-key{margin:0;min-width:120px;color:var(--dsw-alias-label-secondary)}",
      ".easel-kv-value{margin:0;overflow-wrap:anywhere}",
      ".easel-section-title{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
      ".easel-button{cursor:pointer;font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);padding:4px 12px;text-decoration:none;display:inline-flex;align-items:center}",
      ".easel-button:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".easel-button:disabled{opacity:.6;cursor:default}",
      ".easel-input{font:inherit;min-width:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:4px 10px}",
      ".easel-form{display:flex;gap:8px;align-items:center;margin-bottom:12px}",
      ".easel-tag{display:inline-flex;align-items:center;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);padding:0 6px;font-size:12px}",
      ".easel-tags{flex-direction:row;flex-wrap:wrap}",
      ".easel-state-ok,.easel-state-valid,.easel-state-active{color:var(--dsw-alias-state-success-primary)}",
      ".easel-state-missing,.easel-state-invalid,.easel-state-expired,.easel-state-failed{color:var(--dsw-alias-state-error-primary)}",
      ".easel-state-degraded,.easel-state-unknown,.easel-state-pending{color:var(--dsw-alias-state-warn-primary)}",
      ".easel-boundary{border:1px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-md);padding:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}",
      ".easel-boundary-title{margin:0;font-weight:600}",
      ".easel-boundary-detail{margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}",
      ".easel-error-text{margin:0;color:var(--dsw-alias-state-error-primary)}",
      ".easel-log-details{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".easel-log-details>summary{cursor:pointer}",
      ".easel-log{margin:6px 0 0;padding:8px;max-height:200px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-elevated);border-radius:var(--dsw-radius-sm);font-size:12px}",
      ".easel-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:13px}",
      ".easel-empty{display:flex;flex-direction:column;gap:4px}",
      ".easel-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".easel-row-block{flex-wrap:wrap;align-items:flex-start}",
      ".easel-form-column{flex-direction:column;align-items:stretch;gap:8px;margin-bottom:0}",
      ".easel-field{display:flex;flex-direction:column;gap:4px}",
      ".easel-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".easel-dispatch,.easel-schedule{display:flex;flex-direction:column;gap:8px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px;background:var(--dsw-alias-bg-base)}",
      ".easel-inline-fields{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}",
      ".easel-inline-fields .easel-field{flex:1 1 120px;min-width:120px}",
      ".easel-textarea{font:inherit;min-height:140px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:8px 10px}",
      ".easel-login{display:flex;flex-direction:column;gap:8px;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px;background:var(--dsw-alias-bg-base)}",
      ".easel-qr{width:200px;height:200px;image-rendering:pixelated;align-self:flex-start;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}",
      ".easel-check{display:flex;flex-direction:row;align-items:center;gap:6px}",
      ".easel-preview{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}",
      // 超长路径（venv 绝对路径 + 中文产物名）必须能折行，否则命令会把预览框撑破。
      ".easel-preview p{word-break:break-all;white-space:pre-wrap}",
      // 内联预览：表单留在左列，产物挤在右列（窄屏时上下堆叠）。
      ".easel-publish.is-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,42%);column-gap:16px;align-items:start}",
      ".easel-publish.is-split>*{grid-column:1;min-width:0}",
      ".easel-publish.is-split>.easel-publish-pane{grid-column:2;grid-row:1 / span 200;position:sticky;top:12px}",
      "@media (max-width:900px){.easel-publish.is-split{grid-template-columns:minmax(0,1fr)}.easel-publish.is-split>.easel-publish-pane{grid-column:1;grid-row:auto}}",
      ".easel-publish-pane{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}",
      ".easel-publish-pane-head{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px}",
      ".easel-publish-pane-head span{word-break:break-all}",
      ".easel-publish-frame{width:100%;height:60vh;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base)}",
      ".easel-publish-text{margin:0;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-all;font:inherit;color:var(--dsw-alias-label-primary)}",
      // 内容日历：周一起始的 6×7 月历。色点只用 `--dsw-*` 主题令牌，深浅色都跟着主题走。
      ".easel-calendar-hint{margin:0 0 8px}",
      ".easel-calendar-toolbar{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}",
      ".easel-calendar-month{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}",
      ".easel-calendar-legend{display:flex;flex-direction:row;flex-wrap:wrap;gap:12px;list-style:none;margin:0 0 8px;padding:0;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".easel-calendar-legend-item{display:inline-flex;align-items:center;gap:4px}",
      ".easel-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}",
      ".easel-calendar-weekday{font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:2px 0}",
      ".easel-calendar-day{display:flex;flex-direction:column;gap:2px;min-height:72px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:4px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}",
      ".easel-calendar-day.is-outside{opacity:.5}",
      ".easel-calendar-day.is-today{border-color:var(--dsw-alias-brand-primary)}",
      ".easel-calendar-date{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".easel-calendar-item{display:flex;flex-direction:row;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-primary);min-width:0}",
      ".easel-calendar-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".easel-calendar-badge{flex:none;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);padding:0 4px;font-size:11px}",
      ".easel-calendar-more{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".easel-calendar-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}",
      ".easel-calendar-dot.is-idea{background:var(--dsw-alias-label-tertiary)}",
      ".easel-calendar-dot.is-draft{background:var(--dsw-alias-state-idle-primary)}",
      ".easel-calendar-dot.is-scheduled{background:var(--dsw-alias-state-warn-primary)}",
      ".easel-calendar-dot.is-published{background:var(--dsw-alias-state-success-primary)}",
      ".easel-calendar-dot.is-event{background:var(--dsw-alias-state-business-primary)}",
      ".easel-button.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}",
    ].join("");

    // ------------------------------------------------------------------ 工具

    /**
     * 宿主用 `SlotAssemblyError` 表示「Slot 装配失败」这类接线错误，它必须冒泡到宿主
     * 自己的边界（宿主边界对它是 rethrow 的）。我们按名字识别而不是 `instanceof`：
     * 该错误类没有出现在客户端 `require()` 的静态表里，import 不到。
     */
    function isAssemblyError(error) {
      if (error === null || error === undefined) return false;
      if (error.name === "SlotAssemblyError") return true;
      var ctor = error.constructor;
      return ctor !== undefined && ctor !== null && ctor.name === "SlotAssemblyError";
    }

    /** 判断一个字段是否有可渲染的文本（自检条目的 `path`/`detail`/`hint` 都可为空）。 */
    function hasText(value) {
      return value !== null && value !== undefined && String(value) !== "";
    }

    function formatBytes(value) {
      var bytes = Number(value);
      if (!isFinite(bytes) || bytes < 0) return "";
      if (bytes < 1024) return String(bytes) + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    /** 分隔符属于排版而非文案，但仍不写中文标点，避免看起来像硬编码文案。 */
    function joinMeta(parts) {
      return parts
        .filter(function (part) {
          return part !== undefined && part !== null && part !== "";
        })
        .map(function (part) {
          return String(part);
        })
        .join(" · ");
    }

    /**
     * 宿主返回的是稳定的英文枚举（`missing` / `unauthorized` / `scheduled`…），界面上
     * 必须翻成当前语言。字典里没有对应词条时**原样返回**——宿主新增枚举值时，界面
     * 宁可显示原词，也不能显示 `value.xxx` 这样的内部键名或空白。
     */
    function valueLabel(t, value) {
      if (value === undefined || value === null || value === "") return "";
      var key = "value." + String(value);
      var text = t(key);
      return text === key ? String(value) : text;
    }

    /** 语言切换时让 React 重画；取词函数自己会读到新语言，缺的只是一个通知。 */
    function createNotifier() {
      var version = 0;
      var listeners = new Set();
      return {
        subscribe: function (listener) {
          listeners.add(listener);
          return function () {
            listeners.delete(listener);
          };
        },
        getSnapshot: function () {
          return version;
        },
        bump: function () {
          version += 1;
          listeners.forEach(function (listener) {
            listener();
          });
        },
      };
    }

    // ------------------------------------------------------------------ 取数

    /**
     * 统一请求：只认 `{ok:true,...}` 与 `{ok:false,code,message}` 两种形状，并把整个
     * payload 交给调用方——各接口的集合字段名由宿主路由决定（`profiles` / `projects` /
     * `items` / `records`…），在这里再抄一遍字段名必然漂移。
     *
     * 唯一的例外是**空响应体的 404**：插件自己的 404 一定带
     * `{ok:false,code:"not-found",message}`（`lib/host/web.js`），所以「404 且解析不出 JSON」
     * 只可能是宿主半边没挂载时 DSH 自己回的默认 404。这种情况给一句可操作的提示，
     * 而不是把裸的 `HTTP 404` 摊给用户（design D14）。
     */
    function createApi(prefix, translate) {
      var tr = typeof translate === "function" ? translate : function (key) {
        return key;
      };
      return function request(path, options) {
        return fetch(prefix + path, options).then(function (response) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (payload) {
              if (payload !== null && payload.ok === true) return payload;
              var hostNotMounted = payload === null && response.status === 404;
              // 宿主自己答的 404（`未知接口：…`）：跑在 DSH 进程里的宿主半边还是旧版。
              // 页面刷新只换界面，宿主代码要重启 DSH 进程才会重新 import，所以把
              // 「怎么修」直接写进错误文案（design D26）。
              var hostStale =
                payload !== null &&
                payload.code === "not-found" &&
                typeof payload.message === "string" &&
                payload.message.indexOf("未知接口") >= 0;
              var message = hostNotMounted
                ? tr("error.hostNotMounted")
                : hostStale
                  ? payload.message + " " + tr("error.hostStale")
                  : payload !== null && typeof payload.message === "string" && payload.message !== ""
                    ? payload.message
                    : "HTTP " + String(response.status);
              var error = new Error(message);
              error.code = hostNotMounted
                ? "host-not-mounted"
                : hostStale
                  ? "host-stale"
                  : payload !== null && typeof payload.code === "string"
                    ? payload.code
                    : "http-" + String(response.status);
              throw error;
            });
        });
      };
    }

    /**
     * 一次性取数：`loader` 变了就重取，组件卸载后落地的结果直接丢弃（否则快速切区域
     * 会让上一个区域的响应覆盖当前区域的界面）。
     *
     * 重取时**保留上一份数据**（`status` 变 `loading`、`data` 不变）：否则一次
     * 「保存后刷新」会把整棵子树卸载再重建——界面会闪、展开的登录面板会掉线，
     * 而且重建出来的组件会再触发一次刷新，形成自激循环（design D18）。
     * 换对象（点另一个画像/主题）由调用方加 `key` 让它整体重挂，避免显示旧数据。
     */
    function useResource(loader, deps) {
      var tuple = React.useState({ status: "loading", data: null, error: null });
      var state = tuple[0];
      var setState = tuple[1];
      React.useEffect(function () {
        var alive = true;
        setState(function (previous) {
          return { status: "loading", data: previous.data, error: null };
        });
        Promise.resolve()
          .then(loader)
          .then(
            function (data) {
              if (alive) setState({ status: "ready", data: data, error: null });
            },
            function (error) {
              if (alive) setState({ status: "error", data: null, error: error });
            },
          );
        return function () {
          alive = false;
        };
      }, deps);
      return { status: state.status, data: state.data, error: state.error };
    }

    /** 在 `useResource` 之上加一个 `reload()`，供「重试」按钮使用。 */
    function useEndpoint(api, path, deps) {
      var tuple = React.useState(0);
      var nonce = tuple[0];
      var setNonce = tuple[1];
      var state = useResource(
        function () {
          return api(path);
        },
        [path, nonce].concat(deps === undefined ? [] : deps),
      );
      state.reload = function () {
        setNonce(function (value) {
          return value + 1;
        });
      };
      return state;
    }

    // -------------------------------------------------------------- 展示小件

    function Loading(props) {
      return h("p", { className: "easel-muted", "data-easel-state": "loading" }, props.t("common.loading"));
    }

    function ErrorState(props) {
      var message = props.error instanceof Error ? props.error.message : String(props.error);
      return h(
        "div",
        { className: "easel-boundary", "data-easel-state": "error" },
        h("p", { className: "easel-boundary-detail" }, props.t("boundary.detail", { message: message })),
        typeof props.onRetry === "function"
          ? h("button", { type: "button", className: "easel-button", "data-easel-retry": "", onClick: props.onRetry }, props.t("common.retry"))
          : null,
      );
    }

    /**
     * 空态：默认只说「没有数据」，但一张空白页对用户是死路——所以每个区域都可以用
     * `hintKey` 补一句「怎么才会有数据」（design D17）。
     */
    function EmptyState(props) {
      var messageKey = typeof props.messageKey === "string" ? props.messageKey : "common.empty";
      return h(
        "div",
        { className: "easel-empty", "data-easel-state": "empty" },
        h("p", { className: "easel-muted" }, props.t(messageKey)),
        typeof props.hintKey === "string" ? h("p", { className: "easel-hint", "data-easel-hint": "" }, props.t(props.hintKey)) : null,
      );
    }

    function Section(props) {
      return h("section", { className: "easel-section" }, h("h2", { className: "easel-section-title" }, props.title), props.children);
    }

    function KeyValue(props) {
      return h(
        "dl",
        { className: "easel-kv" },
        props.rows.map(function (row, index) {
          var value = row[1];
          var text =
            value === undefined || value === null || value === "" ? props.t("common.unknown") : typeof value === "boolean" ? String(value) : String(value);
          return h(
            "div",
            { className: "easel-kv-row", key: String(index) },
            h("dt", { className: "easel-kv-key" }, row[0]),
            h("dd", { className: "easel-kv-value" }, text),
          );
        }),
      );
    }

    function Resource(props) {
      var state = props.state;
      var stale = state.data !== null && state.data !== undefined;
      // 首次取数才显示「加载中」；刷新时手上有上一份数据就直接渲染，避免闪屏与重建。
      if (state.status === "loading" && stale !== true) return h(Loading, { t: props.t });
      if (state.status === "error") return h(ErrorState, { t: props.t, error: state.error, onRetry: state.reload });
      return props.children(state.data);
    }

    /**
     * 一层错误边界。`scope` 只用来在错误节点上打标记（面板根部 `panel` / 每个区域
     * `region`），测试与排查都靠它区分是哪一层兜住的。
     *
     * `SlotAssemblyError` 必须原样上抛：宿主自己的边界对它是 rethrow 的，吞掉它会把
     * 「接线错了」伪装成「恰好这次渲染崩了」。
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
        this.reset = this.reset.bind(this);
      }

      static getDerivedStateFromError(error) {
        return { error: error };
      }

      componentDidCatch(error, info) {
        console.error("[easel-workbench] " + String(this.props.scope) + " boundary caught a render error", error, info);
      }

      reset() {
        this.setState({ error: null });
      }

      render() {
        var error = this.state.error;
        if (error === null || error === undefined) return this.props.children;
        if (isAssemblyError(error)) throw error;
        var t = this.props.t;
        return h(
          "div",
          { className: "easel-boundary", "data-easel-boundary": this.props.scope },
          h("p", { className: "easel-boundary-title" }, t("boundary.title")),
          h("p", { className: "easel-boundary-detail" }, t("boundary.detail", { message: error instanceof Error ? error.message : String(error) })),
          h(
            "div",
            { className: "easel-form" },
            h("button", { type: "button", className: "easel-button", "data-easel-boundary-retry": "", onClick: this.reset }, t("common.retry")),
            // 面板根部兜底时连标题栏都换了，出口要由边界自己给，否则用户会被困在错误态里。
            typeof this.props.onBack === "function"
              ? h("button", { type: "button", className: "easel-button", "data-easel-back": "", onClick: this.props.onBack }, t("panel.back"))
              : null,
          ),
        );
      }
    }

    // ------------------------------------------------------------------ 区域

    function AccountsRows(props) {
      var t = props.t;
      return h(
        "ul",
        { className: "easel-list" },
        props.accounts.map(function (account) {
          return h(
            "li",
            { className: "easel-row", key: String(account.platform) },
            h(
              "div",
              { className: "easel-row-main" },
              h("span", { className: "easel-row-title" }, String(account.label || account.platform)),
              h("span", { className: "easel-muted" }, valueLabel(t, account.state)),
            ),
            h("span", { className: "easel-tag easel-state-" + String(account.state) }, valueLabel(t, account.state)),
          );
        }),
      );
    }

    function OverviewRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/overview");
      return h(Resource, { state: state, t: t }, function (data) {
        var accounts = Array.isArray(data.accounts) ? data.accounts : [];
        return h(
          "div",
          null,
          h(
            Section,
            { title: t("panel.ready") },
            h(KeyValue, {
              t: t,
              rows: [
                [t("overview.profiles"), data.profileCount],
                [t("overview.artifacts"), data.projectCount],
                [t("overview.topics"), data.topicCount],
                [t("overview.scheduled"), data.scheduledCount],
                [t("overview.runtime"), data.dispatchTarget],
              ],
            }),
          ),
          h(Section, { title: t("nav.accounts") }, accounts.length === 0 ? h(EmptyState, { t: t, hintKey: "accounts.emptyHint" }) : h(AccountsRows, { t: t, accounts: accounts })),
        );
      });
    }

    /**
     * 扫码登录面板：启动仓库里既有的登录脚本 → 轮询状态文件 → 显示二维码 →
     * （平台风控要求时）回填短信验证码 → 取消 / 完成。
     *
     * 插件从不代填、代收任何凭据：二维码由脚本产出、由用户自己扫，这里只把
     * 状态文件与二维码文件如实呈现（design D18）。
     */
    function LoginPanel(props) {
      var t = props.t;
      var api = props.api;
      var platform = props.platform;
      var base = props.apiBase;
      var tuple = React.useState({ phase: "probing", state: null, error: "", nonce: 0 });
      var view = tuple[0];
      var setView = tuple[1];
      var smsTuple = React.useState({ code: "", status: "idle", message: "" });
      var sms = smsTuple[0];
      var setSms = smsTuple[1];

      function messageOf(error) {
        return error instanceof Error ? error.message : String(error);
      }

      /** 落地一次状态。返回「还要不要继续轮询」。 */
      function apply(payload) {
        var keepPolling = payload.running === true && payload.rawState !== "success";
        setView({ phase: keepPolling ? "running" : "settled", state: payload, error: "", nonce: 0 });
        if (payload.rawState === "success" && typeof props.onSettled === "function") props.onSettled();
        return keepPolling;
      }

      function statusPath() {
        return "/accounts/" + encodeURIComponent(platform) + "/login/status";
      }

      function refresh() {
        return api(statusPath()).then(apply, function (error) {
          setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
        });
      }

      // 首次挂载先探一次：用户可能在别处已经启动过登录，不能默认「没在跑」。
      React.useEffect(
        function () {
          var alive = true;
          api(statusPath()).then(
            function (payload) {
              if (alive) apply(payload);
            },
            function () {
              if (alive) setView({ phase: "settled", state: null, error: "", nonce: 0 });
            },
          );
          return function () {
            alive = false;
          };
        },
        [platform],
      );

      // 登录是 180 秒量级的长流程，前端按 1.5 秒轮询；一旦脚本不再运行就停下，
      // 不会留下一个永远转圈的界面。
      React.useEffect(
        function () {
          if (view.phase !== "running") return undefined;
          var alive = true;
          var timer = null;
          function step() {
            api(statusPath()).then(
              function (payload) {
                if (alive !== true) return;
                if (apply(payload) === true) timer = setTimeout(step, 1500);
              },
              function (error) {
                if (alive !== true) return;
                setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
              },
            );
          }
          timer = setTimeout(step, 500);
          return function () {
            alive = false;
            if (timer !== null) clearTimeout(timer);
          };
        },
        [view.phase, view.nonce],
      );

      function start() {
        setView({ phase: "running", state: null, error: "", nonce: 0 });
        setSms({ code: "", status: "idle", message: "" });
        api("/accounts/" + encodeURIComponent(platform) + "/login", { method: "POST" }).catch(function (error) {
          setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
        });
      }

      function cancel() {
        api("/accounts/" + encodeURIComponent(platform) + "/login", { method: "DELETE" }).then(refresh, function (error) {
          setView({ phase: "settled", state: null, error: messageOf(error), nonce: 0 });
        });
      }

      function submitSms(event) {
        if (event !== undefined && typeof event.preventDefault === "function") event.preventDefault();
        setSms({ code: sms.code, status: "running", message: "" });
        api("/accounts/" + encodeURIComponent(platform) + "/login/sms", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: sms.code }),
        }).then(
          function () {
            setSms({ code: "", status: "done", message: t("login.smsSent") });
          },
          function (error) {
            setSms({ code: sms.code, status: "failed", message: messageOf(error) });
          },
        );
      }

      var state = view.state;
      var rawState = state === null || state === undefined ? "" : String(state.rawState || "");
      var running = view.phase === "running";
      // 脚本自己写的状态文案往往只有一句「浏览器没能打开」——真正的原因（缺系统库、
      // 代理不通、风控）只在它的输出里。末尾这段原始输出是用户唯一能自查的线索，
      // 所以失败时就地摊开，而不是让用户去翻 DSH 日志。
      var logTail = state !== null && state !== undefined && typeof state.logTail === "string" ? state.logTail : "";
      var showLog = logTail !== "" && (rawState === "error" || view.error !== "");
      return h(
        "div",
        { className: "easel-login", "data-easel-login": String(platform) },
        h(
          "p",
          { className: "easel-muted" },
          h("span", { "data-easel-login-state": rawState === "" ? "unknown" : rawState }, valueLabel(t, rawState === "" ? "unknown" : rawState)),
          state !== null && state !== undefined && state.message
            ? h("span", null, " · " + String(state.message))
            : null,
        ),
        view.error !== ""
          ? h("p", { className: "easel-error-text", "data-easel-login-error": "" }, view.error)
          : null,
        showLog
          ? h(
              "details",
              { className: "easel-log-details", "data-easel-login-log": String(platform) },
              h("summary", null, t("login.logSummary")),
              h("pre", { className: "easel-log" }, logTail),
            )
          : null,
        state !== null && state !== undefined && state.qrReady === true
          ? h("img", {
              className: "easel-qr",
              "data-easel-qr": String(platform),
              alt: t("login.qrAlt"),
              src: base + "/accounts/" + encodeURIComponent(platform) + "/qr?ts=" + String(state.qrTs || 0),
            })
          : null,
        state !== null && state !== undefined && state.smsRequired === true
          ? h(
              "form",
              { className: "easel-form", onSubmit: submitSms },
              h("input", {
                className: "easel-input",
                "data-easel-login-sms-input": String(platform),
                value: sms.code,
                inputMode: "numeric",
                placeholder: t("login.smsPlaceholder"),
                onChange: function (event) {
                  setSms({ code: event.target.value, status: "idle", message: "" });
                },
              }),
              h(
                "button",
                {
                  type: "submit",
                  className: "easel-button",
                  "data-easel-login-sms": String(platform),
                  disabled: sms.status === "running",
                },
                sms.status === "running" ? t("common.loading") : t("login.smsSubmit"),
              ),
            )
          : null,
        sms.message !== ""
          ? h(
              "p",
              { className: sms.status === "failed" ? "easel-error-text" : "easel-muted", "data-easel-login-sms-state": sms.status },
              sms.message,
            )
          : null,
        h(
          "div",
          { className: "easel-actions" },
          h(
            "button",
            {
              type: "button",
              className: "easel-button",
              "data-easel-login-start": String(platform),
              disabled: running,
              onClick: start,
            },
            running ? t("login.running") : t("login.start"),
          ),
          h("button", { type: "button", className: "easel-button", "data-easel-login-refresh": String(platform), onClick: refresh }, t("login.refresh")),
          running
            ? h("button", { type: "button", className: "easel-button", "data-easel-login-cancel": String(platform), onClick: cancel }, t("login.cancel"))
            : null,
        ),
        h("p", { className: "easel-hint" }, t("login.note")),
      );
    }

    function AccountsRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/accounts");
      var actionTuple = React.useState({ platform: null, status: "idle", message: "" });
      var action = actionTuple[0];
      var setAction = actionTuple[1];
      var loginTuple = React.useState(null);
      var openLogin = loginTuple[0];
      var setOpenLogin = loginTuple[1];

      function verify(platform) {
        setAction({ platform: platform, status: "running", message: "" });
        props
          .api("/accounts/" + encodeURIComponent(platform) + "/verify", { method: "POST" })
          .then(function (payload) {
            setAction({ platform: platform, status: "done", message: typeof payload.message === "string" ? payload.message : "" });
          })
          .catch(function (error) {
            setAction({ platform: platform, status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(Resource, { state: state, t: t }, function (data) {
        var accounts = Array.isArray(data.accounts) ? data.accounts : [];
        if (accounts.length === 0) return h(EmptyState, { t: t, hintKey: "accounts.emptyHint" });
        return h(
          "ul",
          { className: "easel-list" },
          accounts.map(function (account) {
            var busy = action.platform === account.platform && action.status === "running";
            var open = openLogin === account.platform;
            return h(
              "li",
              { className: open ? "easel-row easel-row-block" : "easel-row", key: String(account.platform) },
              h(
                "div",
                { className: "easel-row-main" },
                h("span", { className: "easel-row-title" }, String(account.label || account.platform)),
                h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, account.state), account.message])),
                action.platform === account.platform && action.status !== "idle" && action.status !== "running"
                  ? h("span", { className: "easel-muted", "data-easel-action": action.status }, action.message)
                  : null,
              ),
              h("span", { className: "easel-tag easel-state-" + String(account.state) }, valueLabel(t, account.state)),
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  disabled: busy,
                  "data-easel-verify": String(account.platform),
                  onClick: function () {
                    verify(account.platform);
                  },
                },
                busy ? t("common.loading") : t("accounts.verify"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  "data-easel-login-toggle": String(account.platform),
                  onClick: function () {
                    setOpenLogin(open ? null : account.platform);
                  },
                },
                open ? t("dispatch.close") : t("login.open"),
              ),
              open
                ? h(LoginPanel, {
                    key: "login-" + String(account.platform),
                    t: t,
                    api: props.api,
                    apiBase: props.apiBase,
                    platform: account.platform,
                    onSettled: function () {
                      state.reload();
                    },
                  })
                : null,
            );
          }),
        );
      });
    }

    /**
     * 画像详情：六个维度各是一份 Markdown。读是默认态，点「编辑」进入文本框，
     * 保存走 `PUT /profiles/:name/dimensions/:dimension`（`{text}`）——宿主会
     * `resolveInside` 校验并原子落盘，插件不在客户端拼路径。
     */
    function ProfileDetail(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/profiles/" + encodeURIComponent(props.name));
      var editingTuple = React.useState(null);
      var editing = editingTuple[0];
      var setEditing = editingTuple[1];
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "" });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];

      function save(dimension) {
        setStatus({ status: "running", message: "" });
        props
          .api("/profiles/" + encodeURIComponent(props.name) + "/dimensions/" + encodeURIComponent(dimension), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: draft }),
          })
          .then(function (payload) {
            var bytes = payload !== null && payload !== undefined && payload.bytes !== undefined ? String(payload.bytes) : "";
            setStatus({ status: "saved", message: t("profiles.saved", { dimension: dimension, bytes: bytes }) });
            setEditing(null);
            state.reload();
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(Resource, { state: state, t: t }, function (data) {
        var dimensions = data.dimensions !== null && typeof data.dimensions === "object" ? data.dimensions : {};
        var keys = Object.keys(dimensions);
        if (keys.length === 0) return h(EmptyState, { t: t, hintKey: "profiles.emptyHint" });
        return h(
          "div",
          { className: "easel-region" },
          status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-profile-error": "" }, status.message) : null,
          status.status === "saved" ? h("p", { className: "easel-hint", "data-easel-profile-saved": "" }, status.message) : null,
          keys.map(function (dimension) {
            var open = editing === dimension;
            return h(
              Section,
              { key: dimension, title: dimension },
              open
                ? h(
                    "div",
                    { className: "easel-form easel-form-column" },
                    h("textarea", {
                      className: "easel-textarea",
                      "data-easel-profile-editor": dimension,
                      value: draft,
                      onChange: function (event) {
                        setDraft(event.target.value);
                      },
                    }),
                    h(
                      "div",
                      { className: "easel-actions" },
                      h(
                        "button",
                        {
                          type: "button",
                          className: "easel-button",
                          "data-easel-profile-save": dimension,
                          disabled: status.status === "running",
                          onClick: function () {
                            save(dimension);
                          },
                        },
                        t("profiles.save"),
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          className: "easel-button",
                          "data-easel-profile-cancel": dimension,
                          onClick: function () {
                            setEditing(null);
                          },
                        },
                        t("profiles.cancel"),
                      ),
                    ),
                  )
                : h(
                    "div",
                    null,
                    h("pre", { className: "easel-text" }, String(dimensions[dimension])),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "easel-button",
                        "data-easel-profile-edit": dimension,
                        onClick: function () {
                          setDraft(String(dimensions[dimension]));
                          setStatus({ status: "idle", message: "" });
                          setEditing(dimension);
                        },
                      },
                      t("profiles.edit"),
                    ),
                  ),
            );
          }),
        );
      });
    }

    function ProfilesRegion(props) {
      var t = props.t;
      var tuple = React.useState(null);
      var selected = tuple[0];
      var setSelected = tuple[1];
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "" });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];
      var state = useEndpoint(props.api, "/profiles");

      // 新建画像 = 从 `profiles/_template` 复制六个维度文档（宿主 createProfile）。
      function create(event) {
        event.preventDefault();
        var name = draft.trim();
        if (name === "") return;
        setStatus({ status: "running", message: "" });
        props
          .api("/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name }) })
          .then(function (payload) {
            var created = payload !== null && payload !== undefined && typeof payload.name === "string" ? payload.name : name;
            setDraft("");
            setStatus({ status: "idle", message: "" });
            setSelected(created);
            state.reload();
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(
        "div",
        null,
        h(
          "form",
          { className: "easel-form", onSubmit: create },
          h("input", {
            className: "easel-input",
            "data-easel-profile-input": "",
            value: draft,
            placeholder: t("profiles.createPlaceholder"),
            onChange: function (event) {
              setDraft(event.target.value);
            },
          }),
          h("button", { type: "submit", className: "easel-button", "data-easel-profile-create": "", disabled: status.status === "running" }, t("profiles.create")),
        ),
        status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-profile-error": "" }, status.message) : null,
        h(Resource, { state: state, t: t }, function (data) {
          var profiles = Array.isArray(data.profiles) ? data.profiles : [];
          var dimensions = Array.isArray(data.dimensions) ? data.dimensions : [];
          if (profiles.length === 0) return h(EmptyState, { t: t, hintKey: "profiles.emptyHint" });
          return h(
            "div",
            { className: "easel-split" },
            h(
              "ul",
              { className: "easel-list easel-list-side" },
              profiles.map(function (profile) {
                var present = Array.isArray(profile.dimensions) ? profile.dimensions.length : 0;
                return h(
                  "li",
                  { key: String(profile.name) },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "easel-nav-item" + (selected === profile.name ? " easel-nav-item-active" : ""),
                      "data-easel-profile": String(profile.name),
                      onClick: function () {
                        setSelected(profile.name);
                      },
                    },
                    h("span", { className: "easel-row-title" }, String(profile.name)),
                    h("span", { className: "easel-muted" }, String(present) + " / " + String(dimensions.length)),
                  ),
                );
              }),
            ),
            selected === null ? h(EmptyState, { t: t, hintKey: "profiles.pickProfile" }) : h(ProfileDetail, { key: selected, t: t, api: props.api, name: selected }),
          );
        }),
      );
    }

    function ProjectDetail(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/projects/" + encodeURIComponent(props.topic));
      return h(Resource, { state: state, t: t }, function (data) {
        var files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) return h(EmptyState, { t: t, hintKey: "library.emptyFiles" });
        return h(
          "ul",
          { className: "easel-list" },
          files.map(function (file) {
            // 下载走同一条只读路由，`?download=1` 才切到 attachment；路径是仓库内相对路径。
            var href = API_PREFIX + "/files?path=" + encodeURIComponent(String(file.path)) + "&download=1";
            return h(
              "li",
              { className: "easel-row", key: String(file.path) },
              h(
                "div",
                { className: "easel-row-main" },
                h("span", { className: "easel-row-title" }, String(file.path)),
                h("span", { className: "easel-muted" }, joinMeta([file.kind, formatBytes(file.bytes)])),
              ),
              h("a", { className: "easel-button", href: href, download: "" }, t("library.download")),
            );
          }),
        );
      });
    }

    function LibraryRegion(props) {
      var t = props.t;
      var tuple = React.useState(null);
      var selected = tuple[0];
      var setSelected = tuple[1];
      var state = useEndpoint(props.api, "/projects");
      return h(Resource, { state: state, t: t }, function (data) {
        var projects = Array.isArray(data.projects) ? data.projects : [];
        if (projects.length === 0) return h(EmptyState, { t: t, hintKey: "library.emptyHint" });
        return h(
          "div",
          { className: "easel-split" },
          h(
            "ul",
            { className: "easel-list easel-list-side" },
            projects.map(function (project) {
              return h(
                "li",
                { key: String(project.topic) },
                h(
                  "button",
                  {
                    type: "button",
                    className: "easel-nav-item" + (selected === project.topic ? " easel-nav-item-active" : ""),
                    "data-easel-project": String(project.topic),
                    onClick: function () {
                      setSelected(project.topic);
                    },
                  },
                  h("span", { className: "easel-row-title" }, String(project.title || project.topic)),
                  h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, project.status), project.updated])),
                ),
              );
            }),
          ),
          selected === null ? h(EmptyState, { t: t, hintKey: "library.pickProject" }) : h(ProjectDetail, { key: selected, t: t, api: props.api, topic: selected }),
        );
      });
    }

    function describeAccepts(value, t) {
      if (!Array.isArray(value)) return "";
      return value
        .map(function (entry) {
          if (typeof entry === "string") return valueLabel(t, entry);
          if (entry !== null && typeof entry === "object") return String(entry.label || entry.id || "");
          return "";
        })
        .filter(function (entry) {
          return entry !== "";
        })
        .join(" / ");
    }

    function errorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    }

    /**
     * 发布表单：预览 → 勾选确认 → 执行。
     *
     * 参数形状严格照仓库脚本的 argparse 拼装（见宿主 `lib/host/scripts.js` 的
     * `buildPublishArgv`）：素材型平台把所选产物当素材（小红书/抖音/快手/视频号/
     * 知乎/B站），公众号型平台把所选 `.md`/`.html` 当正文文件。预览只跑内容门禁、
     * **不执行任何命令**；执行前必须显式勾选确认，插件永不代发。
     */
    function PublishForm(props) {
      var t = props.t;
      var api = props.api;
      var formTuple = React.useState({ platform: "", topic: "", file: "", title: "", body: "", tags: "" });
      var form = formTuple[0];
      var setForm = formTuple[1];
      var runTuple = React.useState({ phase: "idle", preview: null, result: null, error: "" });
      var run = runTuple[0];
      var setRun = runTuple[1];
      var confirmTuple = React.useState(false);
      var confirmed = confirmTuple[0];
      var setConfirmed = confirmTuple[1];
      var paneTuple = React.useState({ open: false, path: "", mode: "text", text: "", error: "", loading: false });
      var pane = paneTuple[0];
      var setPane = paneTuple[1];

      var platforms = useEndpoint(api, "/publish/platforms");
      var projects = useEndpoint(api, "/projects");
      var files = useEndpoint(api, form.topic === "" ? "/projects" : "/projects/" + encodeURIComponent(form.topic));

      function setField(name, value) {
        var next = {
          platform: form.platform,
          topic: form.topic,
          file: form.file,
          title: form.title,
          body: form.body,
          tags: form.tags,
        };
        next[name] = value;
        if (name === "topic") next.file = "";
        setForm(next);
        setRun({ phase: "idle", preview: null, result: null, error: "" });
      }

      function platformList() {
        var data = platforms.data;
        return data !== null && data !== undefined && Array.isArray(data.platforms) ? data.platforms : [];
      }

      function selectedPlatform() {
        var list = platformList();
        for (var index = 0; index < list.length; index += 1) {
          if (list[index].id === form.platform) return list[index];
        }
        return undefined;
      }

      /** 拼本次发布的输入；缺必需项时回 `{error}`，绝不发半个请求。 */
      function payloadOf() {
        var platform = selectedPlatform();
        if (platform === undefined) return { error: t("publish.pickPlatform") };
        if (form.title.trim() === "") return { error: t("publish.titleRequired") };
        var accepts = Array.isArray(platform.accepts) ? platform.accepts : [];
        var article = platform.style === "wechat" || accepts.indexOf("article") >= 0;
        var input = { platform: platform.id, title: form.title };
        // 空正文不往下传：脚本收到 `--content ""` 只会把空串写进正文。
        if (form.body.trim() !== "") input.body = form.body;
        var tags = form.tags
          .split(",")
          .map(function (tag) {
            return tag.trim();
          })
          .filter(function (tag) {
            return tag !== "";
          });
        if (tags.length > 0) input.tags = tags;
        if (form.file !== "") {
          var relative = "outputs/" + form.topic + "/" + form.file;
          if (article === true) input.article = relative;
          else input.media = [relative];
        }
        return { input: input, article: article };
      }

      /** 选中产物相对数据根的路径：发布入参与面板内预览共用同一条路径。 */
      function selectedPath() {
        return form.topic === "" || form.file === "" ? "" : "outputs/" + form.topic + "/" + form.file;
      }

      /** 宿主 `/files` 的内联地址（不带 `download=1`，让浏览器按 content-type 渲染）。 */
      function fileUrl(path) {
        if (path === "" || typeof props.apiBase !== "string") return "";
        return props.apiBase + "/files?path=" + encodeURIComponent(path);
      }

      /**
       * 预览选中的产物：走宿主的 `/files`（不带 `download=1`），
       * 宿主按扩展名给 content-type，浏览器直接渲染文章/图片/视频。
       */
      function openFileLink(marker, path) {
        var target = path === undefined ? selectedPath() : path;
        var url = fileUrl(target);
        if (url === "") return null;
        return h(
          "a",
          {
            className: "easel-button",
            "data-easel-publish-open": marker,
            href: url,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          t("publish.openFile"),
        );
      }

      function extensionOf(path) {
        var dot = path.lastIndexOf(".");
        return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
      }

      function truncateText(text) {
        var value = typeof text === "string" ? text : String(text);
        return value.length > PANE_TEXT_LIMIT ? value.slice(0, PANE_TEXT_LIMIT) + "\n……" : value;
      }

      function closePane() {
        setPane({ open: false, path: "", mode: "text", text: "", error: "", loading: false });
      }

      /**
       * 在右侧分栏里就地预览选中产物：HTML 交给**无脚本的沙箱 iframe**
       * （`sandbox=""` 既禁脚本也不给同源访问，文章样式照常生效），其余按纯文本读回来。
       * MUST NOT 把文件内容直接注入面板：面板与宿主同源。
       */
      function openPane() {
        var path = selectedPath();
        var url = fileUrl(path);
        if (url === "") return;
        if (PANE_FRAME_EXTENSIONS.indexOf(extensionOf(path)) >= 0) {
          setPane({ open: true, path: path, mode: "frame", text: "", error: "", loading: false });
          return;
        }
        setPane({ open: true, path: path, mode: "text", text: "", error: "", loading: true });
        if (typeof fetch !== "function") {
          setPane({ open: true, path: path, mode: "text", text: "", error: t("publish.paneNoFetch"), loading: false });
          return;
        }
        fetch(url)
          .then(function (response) {
            if (response.ok !== true) throw new Error("HTTP " + String(response.status));
            return response.text();
          })
          .then(
            function (text) {
              setPane({ open: true, path: path, mode: "text", text: truncateText(text), error: "", loading: false });
            },
            function (error) {
              setPane({ open: true, path: path, mode: "text", text: "", error: errorMessage(error), loading: false });
            },
          );
      }

      function paneView() {
        if (pane.open !== true) return null;
        var url = fileUrl(pane.path);
        return h(
          "div",
          { className: "easel-publish-pane", "data-easel-publish-pane": "" },
          h(
            "div",
            { className: "easel-publish-pane-head" },
            h("span", { className: "easel-muted" }, pane.path),
            h(
              "div",
              { className: "easel-actions" },
              openFileLink("pane", pane.path),
              h("button", { type: "button", className: "easel-button", "data-easel-publish-pane-close": "", onClick: closePane }, t("common.close")),
            ),
          ),
          pane.error !== "" ? h("p", { className: "easel-error-text", "data-easel-publish-pane-error": "" }, pane.error) : null,
          pane.loading === true ? h("p", { className: "easel-hint" }, t("common.loading")) : null,
          pane.mode === "frame" && url !== ""
            ? h("iframe", { className: "easel-publish-frame", "data-easel-publish-frame": "", src: url, sandbox: "", title: pane.path })
            : pane.loading === true
              ? null
              : h("pre", { className: "easel-publish-text", "data-easel-publish-text": "" }, pane.text),
        );
      }

      function post(path, input) {
        return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      }

      function preview() {
        var built = payloadOf();
        if (built.error !== undefined) {
          setRun({ phase: "idle", preview: null, result: null, error: built.error });
          return;
        }
        setRun({ phase: "previewing", preview: null, result: null, error: "" });
        post("/publish/preview", built.input).then(
          function (payload) {
            setRun({ phase: "previewed", preview: payload, result: null, error: "" });
          },
          function (error) {
            setRun({ phase: "idle", preview: null, result: null, error: errorMessage(error) });
          },
        );
      }

      function execute() {
        if (confirmed !== true) {
          setRun({ phase: "idle", preview: null, result: null, error: t("publish.confirmFirst") });
          return;
        }
        var built = payloadOf();
        if (built.error !== undefined) {
          setRun({ phase: "idle", preview: null, result: null, error: built.error });
          return;
        }
        setRun({ phase: "running", preview: run.preview, result: null, error: "" });
        post("/publish/execute", built.input).then(
          function (payload) {
            setRun({ phase: "done", preview: run.preview, result: payload, error: "" });
            if (typeof props.onPublished === "function") props.onPublished();
          },
          function (error) {
            setRun({ phase: "done", preview: run.preview, result: null, error: errorMessage(error) });
          },
        );
      }

      var list = platformList();
      var platformInfo = selectedPlatform();
      var projectList = projects.data !== null && projects.data !== undefined && Array.isArray(projects.data.projects) ? projects.data.projects : [];
      var fileList = files.data !== null && files.data !== undefined && Array.isArray(files.data.files) ? files.data.files : [];
      var isArticle = platformInfo !== undefined && (platformInfo.style === "wechat" || (Array.isArray(platformInfo.accepts) && platformInfo.accepts.indexOf("article") >= 0));
      var busy = run.phase === "previewing" || run.phase === "running";

      return h(
        "div",
        { className: "easel-form easel-form-column easel-publish" + (pane.open === true ? " is-split" : ""), "data-easel-publish-form": "" },
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.platform")),
          h(
            "select",
            { className: "easel-input", "data-easel-publish-platform": "", value: form.platform, onChange: function (event) { setField("platform", event.target.value); } },
            h("option", { value: "" }, t("publish.pickPlatformOption")),
            list.map(function (platform) {
              return h("option", { key: String(platform.id), value: String(platform.id) }, String(platform.label) + "（" + describeAccepts(platform.accepts, t) + "）");
            }),
          ),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.topic")),
          h(
            "select",
            { className: "easel-input", "data-easel-publish-topic": "", value: form.topic, onChange: function (event) { setField("topic", event.target.value); } },
            h("option", { value: "" }, t("publish.pickTopicOption")),
            projectList.map(function (project) {
              return h("option", { key: String(project.topic), value: String(project.topic) }, String(project.topic));
            }),
          ),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, isArticle === true ? t("publish.articleFile") : t("publish.mediaFile")),
          h(
            "select",
            { className: "easel-input", "data-easel-publish-file": "", value: form.file, onChange: function (event) { setField("file", event.target.value); } },
            h("option", { value: "" }, t("publish.pickFileOption")),
            fileList.map(function (file) {
              return h("option", { key: String(file.path), value: String(file.path) }, String(file.path) + "（" + String(file.kind) + "）");
            }),
          ),
        ),
        selectedPath() === "" ? null : h(
          "div",
          { className: "easel-actions" },
          h("button", { type: "button", className: "easel-button", "data-easel-publish-view": "", onClick: openPane }, t("publish.viewInline")),
          openFileLink("selected"),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.title")),
          h("input", { className: "easel-input", "data-easel-publish-title": "", value: form.title, onChange: function (event) { setField("title", event.target.value); } }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.body")),
          h("textarea", { className: "easel-textarea", "data-easel-publish-body": "", value: form.body, onChange: function (event) { setField("body", event.target.value); } }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("publish.tags")),
          h("input", { className: "easel-input", "data-easel-publish-tags": "", value: form.tags, placeholder: t("publish.tagsPlaceholder"), onChange: function (event) { setField("tags", event.target.value); } }),
        ),
        h(
          "label",
          { className: "easel-check" },
          h("input", { type: "checkbox", "data-easel-publish-confirm": "", checked: confirmed, onChange: function (event) { setConfirmed(event.target.checked); } }),
          h("span", null, t("publish.confirm")),
        ),
        h(
          "div",
          { className: "easel-actions" },
          h("button", { type: "button", className: "easel-button", "data-easel-publish-preview": "", disabled: busy, onClick: preview }, run.phase === "previewing" ? t("common.loading") : t("publish.preview")),
          h("button", { type: "button", className: "easel-button", "data-easel-publish-execute": "", disabled: busy, onClick: execute }, run.phase === "running" ? t("common.loading") : t("publish.execute")),
        ),
        run.error !== "" ? h("p", { className: "easel-error-text", "data-easel-publish-error": "" }, run.error) : null,
        run.preview !== null && run.preview !== undefined
          ? h(
              "div",
              { className: "easel-preview", "data-easel-publish-preview-result": "" },
              h("p", { className: "easel-muted" }, String(run.preview.command)),
              run.preview.guard !== null && run.preview.guard !== undefined && run.preview.guard.blocked === true
                ? h("p", { className: "easel-error-text" }, t("publish.guardBlocked"))
                : h("p", { className: "easel-hint" }, t("publish.guardClear")),
              (Array.isArray(run.preview.warnings) ? run.preview.warnings : []).map(function (warning, index) {
                return h("p", { className: "easel-hint", key: "warn-" + String(index) }, String(warning));
              }),
              selectedPath() === "" ? null : h("div", { className: "easel-actions" }, openFileLink("preview")),
            )
          : null,
        run.phase === "done"
          ? h(
              "div",
              { className: "easel-preview", "data-easel-publish-result": run.result !== null && run.result !== undefined && run.result.ok === true ? "ok" : "failed" },
              run.result !== null && run.result !== undefined
                ? h(
                    "p",
                    { className: "easel-muted" },
                    joinMeta([
                      t("publish.exitCode", { code: String(run.result.exitCode) }),
                      run.result.readback === undefined || run.result.readback === null ? undefined : valueLabel(t, run.result.readback),
                      run.result.reason,
                    ]),
                  )
                : h("p", { className: "easel-error-text" }, run.error),
            )
          : null,
        paneView(),
      );
    }

    function PublishRegion(props) {
      var t = props.t;
      var platforms = useEndpoint(props.api, "/publish/platforms");
      var history = useEndpoint(props.api, "/publish/history?limit=20");
      return h(
        "div",
        null,
        h(
          Section,
          { title: t("publish.compose") },
          h(PublishForm, {
            t: t,
            api: props.api,
            apiBase: props.apiBase,
            onPublished: function () {
              history.reload();
            },
          }),
        ),
        h(
          Section,
          { title: t("publish.platforms") },
          h(Resource, { state: platforms, t: t }, function (data) {
            var rows = (Array.isArray(data.platforms) ? data.platforms : []).map(function (platform) {
              return [String(platform.label || platform.id), describeAccepts(platform.accepts, t)];
            });
            return rows.length === 0 ? h(EmptyState, { t: t, hintKey: "analytics.emptyHint" }) : h(KeyValue, { t: t, rows: rows });
          }),
        ),
        h(
          Section,
          { title: t("publish.history") },
          h(Resource, { state: history, t: t }, function (data) {
            var records = Array.isArray(data.records) ? data.records : [];
            if (records.length === 0) return h(EmptyState, { t: t, hintKey: "analytics.emptyHint" });
            return h(
              "ul",
              { className: "easel-list" },
              records.map(function (record, index) {
                return h(
                  "li",
                  { className: "easel-row", key: String(index) },
                  h(
                    "div",
                    { className: "easel-row-main" },
                    h("span", { className: "easel-row-title" }, String(record.platform)),
                    h("span", { className: "easel-muted" }, String(record.at)),
                  ),
                  h("span", { className: "easel-tag" }, record.ok === true ? t("publish.success") : t("publish.failure")),
                );
              }),
            );
          }),
        ),
      );
    }

    /**
     * 登记排期：日历区原来只能「看」。工作台的排期列表只认标题带 `Easel｜` 前缀的条目
     * （宿主 `lib/host/schedule.js:isEaselSchedule`），而 DSH 自己的排期界面建出来的条目
     * 不带这个前缀，于是「日历」从来不会有内容——空态指引指的就是「登记排期」，但入口
     * 一直不存在。宿主 `POST /schedule` 早就能建（`lib/host/schedule.js:create`），这里
     * 把「要重复做什么」收成三项必填（主题、任务目标、期望产物），加上排期唯一不可省的
     * 外部条件——**投递到哪个会话**（DSH 排期按会话投递），以及定时方式。
     *
     * 定时字段原样透传（宿主 `TIMING_KEYS`：`after_seconds`/`at`/`every_seconds`/`daily`/
     * `weekly`/`cron`，必须恰好给一个），时间与时区是否合法由 DSH 排期服务判定，插件不重复实现。
     * 时区默认取浏览器所在时区，取不到才回落到 `Asia/Shanghai`——不写死。
     */
    function ScheduleForm(props) {
      var t = props.t;
      var api = props.api;
      var browserZone =
        typeof Intl !== "undefined" && Intl.DateTimeFormat !== undefined
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "";
      var fieldsTuple = React.useState({
        topic: "",
        goal: "",
        deliverable: "",
        profile: "",
        platform: "",
        mode: "daily",
        time: "09:00",
        weekday: "1",
        date: "",
        timeZone: browserZone === undefined || browserZone === null || browserZone === "" ? "Asia/Shanghai" : browserZone,
      });
      var fields = fieldsTuple[0];
      var setFields = fieldsTuple[1];
      var sessionTuple = React.useState("");
      var session = sessionTuple[0];
      var setSession = sessionTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "", at: "" });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];
      var sessions = useEndpoint(api, "/sessions");

      function setField(name, value) {
        setFields(function (previous) {
          var next = {};
          Object.keys(previous).forEach(function (key) {
            next[key] = previous[key];
          });
          next[name] = value;
          return next;
        });
        setStatus({ status: "idle", message: "", at: "" });
      }

      function change(name) {
        return function (event) {
          setField(name, event.target.value);
        };
      }

      function timingOf() {
        var clock = String(fields.time).trim();
        var at = clock.length === 5 ? clock + ":00" : clock;
        var zone = String(fields.timeZone).trim();
        if (fields.mode === "weekly") {
          var weekday = Number(fields.weekday);
          return { weekly: { time: at, time_zone: zone, weekdays: [weekday >= 1 && weekday <= 7 ? weekday : 1] } };
        }
        if (fields.mode === "once") return { at: { date: String(fields.date).trim(), time: at, time_zone: zone } };
        return { daily: { time: at, time_zone: zone } };
      }

      /**
       * 本地先拦一遍：省一次注定被宿主拒掉的往返，也让「哪个框没填」在提交前就说清楚。
       * 这里只做「空不空」的判断，时间与时区的合法性留给 DSH。
       */
      function submit(event) {
        event.preventDefault();
        var missing = [];
        if (String(fields.topic).trim() === "") missing.push("schedule.topic");
        if (String(fields.goal).trim() === "") missing.push("schedule.goal");
        if (String(fields.deliverable).trim() === "") missing.push("schedule.deliverable");
        if (session === "") missing.push("schedule.session");
        if (String(fields.time).trim() === "") missing.push("schedule.time");
        if (fields.mode === "once" && String(fields.date).trim() === "") missing.push("schedule.date");
        if (missing.length > 0) {
          setStatus({
            status: "failed",
            message: t("schedule.missing", {
              fields: missing
                .map(function (key) {
                  return t(key);
                })
                .join("、"),
            }),
            at: "",
          });
          return;
        }
        var task = {
          goal: String(fields.goal).trim(),
          deliverable: String(fields.deliverable).trim(),
        };
        var profile = String(fields.profile).trim();
        var platform = String(fields.platform).trim();
        if (profile !== "") task.profile = profile;
        if (platform !== "") task.platform = platform;
        var body = { topic: String(fields.topic).trim(), sessionId: session, task: task };
        var timing = timingOf();
        Object.keys(timing).forEach(function (key) {
          body[key] = timing[key];
        });
        setStatus({ status: "running", message: "", at: "" });
        api("/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
          .then(function (payload) {
            var record = payload === null || payload === undefined ? null : payload.record;
            setStatus({
              status: "done",
              message: "",
              at: record !== null && record !== undefined && record.scheduledAt !== undefined && record.scheduledAt !== null ? String(record.scheduledAt) : "",
            });
            if (typeof props.onCreated === "function") props.onCreated();
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: errorMessage(error), at: "" });
          });
      }

      var sessionOptions = [];
      if (sessions.status === "ready" && sessions.data !== null && Array.isArray(sessions.data.sessions)) {
        sessions.data.sessions.forEach(function (item) {
          if (item === null || item === undefined || typeof item.id !== "string") return;
          sessionOptions.push({
            id: item.id,
            label:
              (item.title === undefined || item.title === null ? item.id : String(item.title)) +
              "（" +
              t(item.running === true ? "dispatch.running" : "dispatch.idle") +
              "）",
          });
        });
      }
      var weekdays = t("schedule.weekdays").split(",");

      return h(
        "form",
        { className: "easel-schedule", "data-easel-schedule-form": "", onSubmit: submit },
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("schedule.topic")),
          h("input", {
            className: "easel-input",
            "data-easel-schedule-topic": "",
            value: fields.topic,
            placeholder: t("schedule.topicPlaceholder"),
            onChange: change("topic"),
          }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("schedule.goal")),
          h("input", {
            className: "easel-input",
            "data-easel-schedule-goal": "",
            value: fields.goal,
            placeholder: t("schedule.goalPlaceholder"),
            onChange: change("goal"),
          }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("schedule.deliverable")),
          h("input", {
            className: "easel-input",
            "data-easel-schedule-deliverable": "",
            value: fields.deliverable,
            placeholder: t("schedule.deliverablePlaceholder"),
            onChange: change("deliverable"),
          }),
        ),
        h(
          "div",
          { className: "easel-inline-fields" },
          h(
            "label",
            { className: "easel-field" },
            h("span", { className: "easel-field-label" }, t("dispatch.profile")),
            h("input", { className: "easel-input", "data-easel-schedule-profile": "", value: fields.profile, onChange: change("profile") }),
          ),
          h(
            "label",
            { className: "easel-field" },
            h("span", { className: "easel-field-label" }, t("dispatch.platform")),
            h("input", { className: "easel-input", "data-easel-schedule-platform": "", value: fields.platform, onChange: change("platform") }),
          ),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("schedule.session")),
          h(
            "select",
            {
              className: "easel-input",
              "data-easel-schedule-session": "",
              value: session,
              onChange: function (event) {
                setSession(event.target.value);
                setStatus({ status: "idle", message: "", at: "" });
              },
            },
            [{ id: "", label: t("schedule.sessionPlaceholder") }]
              .concat(sessionOptions)
              .map(function (option) {
                return h("option", { key: option.id, value: option.id }, option.label);
              }),
          ),
        ),
        sessions.status === "error" || sessionOptions.length === 0
          ? h("p", { className: "easel-hint", "data-easel-schedule-sessions": "" }, t("schedule.noSessions"))
          : null,
        h(
          "div",
          { className: "easel-inline-fields" },
          h(
            "label",
            { className: "easel-field" },
            h("span", { className: "easel-field-label" }, t("schedule.mode")),
            h(
              "select",
              {
                className: "easel-input",
                "data-easel-schedule-mode": "",
                value: fields.mode,
                onChange: change("mode"),
              },
              [
                { id: "daily", label: t("schedule.modeDaily") },
                { id: "weekly", label: t("schedule.modeWeekly") },
                { id: "once", label: t("schedule.modeOnce") },
              ].map(function (option) {
                return h("option", { key: option.id, value: option.id }, option.label);
              }),
            ),
          ),
          fields.mode === "weekly"
            ? h(
                "label",
                { className: "easel-field" },
                h("span", { className: "easel-field-label" }, t("schedule.weekday")),
                h(
                  "select",
                  {
                    className: "easel-input",
                    "data-easel-schedule-weekday": "",
                    value: fields.weekday,
                    onChange: change("weekday"),
                  },
                  weekdays.map(function (label, index) {
                    var value = String(index + 1);
                    return h("option", { key: value, value: value }, label);
                  }),
                ),
              )
            : null,
          fields.mode === "once"
            ? h(
                "label",
                { className: "easel-field" },
                h("span", { className: "easel-field-label" }, t("schedule.date")),
                h("input", { type: "date", className: "easel-input", "data-easel-schedule-date": "", value: fields.date, onChange: change("date") }),
              )
            : null,
          h(
            "label",
            { className: "easel-field" },
            h("span", { className: "easel-field-label" }, t("schedule.time")),
            h("input", { type: "time", className: "easel-input", "data-easel-schedule-time": "", value: fields.time, onChange: change("time") }),
          ),
          h(
            "label",
            { className: "easel-field" },
            h("span", { className: "easel-field-label" }, t("schedule.zone")),
            h("input", { className: "easel-input", "data-easel-schedule-zone": "", value: fields.timeZone, onChange: change("timeZone") }),
          ),
        ),
        h(
          "div",
          { className: "easel-actions" },
          h(
            "button",
            { type: "submit", className: "easel-button", "data-easel-schedule-submit": "", disabled: status.status === "running" },
            status.status === "running" ? t("schedule.submitting") : t("schedule.submit"),
          ),
        ),
        status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-schedule-error": "" }, status.message) : null,
        status.status === "done"
          ? h(
              "p",
              { className: "easel-hint", "data-easel-schedule-done": "" },
              status.at === "" ? t("schedule.created") : t("schedule.createdAt", { at: status.at }),
            )
          : null,
      );
    }

    // ---------------------------------------------------------------- 内容日历

    /** 月历固定 6 周（42 格），周一起始：与宿主 `monthWindow` 的取数窗口一一对应。 */
    var CALENDAR_GRID_DAYS = 42;

    /** 表头顺序：ISO 周，周一起始；文案走词条 `calendar.weekday.<0..6>`。 */
    var CALENDAR_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

    /** 日历过滤器：全部 / 内容 / 活动（`data-easel-calendar-filter` 的取值）。 */
    var CALENDAR_FILTERS = ["all", "content", "event"];

    /** 图例条目；色点类名 `easel-calendar-dot is-<条目>` 只用 `--dsw-*` 令牌上色。 */
    var CALENDAR_LEGEND = ["idea", "draft", "scheduled", "published", "event"];

    /** 内容条目的稳定分类枚举（平台活动另算 `event`）。 */
    var CALENDAR_CATEGORIES = ["idea", "draft", "scheduled", "published"];

    /** 本地时区的 `YYYY-MM-DD`。`toISOString()` 是 UTC，东八区月初月末会错一天。 */
    function dayKeyOf(date) {
      var month = date.getMonth() + 1;
      var day = date.getDate();
      return (
        String(date.getFullYear()) +
        "-" +
        (month < 10 ? "0" + String(month) : String(month)) +
        "-" +
        (day < 10 ? "0" + String(day) : String(day))
      );
    }

    function monthKeyOf(date) {
      return dayKeyOf(date).slice(0, 7);
    }

    /** 月份加减；`delta` 为月数（-1 = 上个月）。 */
    function shiftMonthKey(month, delta) {
      var parts = String(month).split("-");
      var year = Number(parts[0]);
      var index = Number(parts[1]) - 1 + delta;
      return monthKeyOf(new Date(year, index, 1));
    }

    /** 月历要渲染的日期：当月 1 号所在周的周一起，连续 42 天（首尾补位）。 */
    function monthGridDays(month) {
      var parts = String(month).split("-");
      var first = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      var leading = (first.getDay() + 6) % 7;
      var start = new Date(first.getFullYear(), first.getMonth(), 1 - leading);
      var days = [];
      for (var index = 0; index < CALENDAR_GRID_DAYS; index += 1) {
        days.push(dayKeyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)));
      }
      return days;
    }

    /**
     * 条目分类：平台活动自带 `kind=event`；内容条目优先用宿主给的 `status`
     * （`idea`/`draft`/`scheduled`/`published`），没给就按「已排期」上色——
     * 日历上最不该发生的事是「有东西却看不见」。
     */
    function calendarCategory(entry) {
      if (entry.kind === "event") return "event";
      var status = entry.status === undefined || entry.status === null ? "" : String(entry.status);
      return CALENDAR_CATEGORIES.indexOf(status) >= 0 ? status : "scheduled";
    }

    function CalendarRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/schedule");
      var monthTuple = React.useState(monthKeyOf(new Date()));
      var month = monthTuple[0];
      var setMonth = monthTuple[1];
      var filterTuple = React.useState("all");
      var filter = filterTuple[0];
      var setFilter = filterTuple[1];
      var calendarState = useEndpoint(props.api, "/calendar?month=" + encodeURIComponent(month));
      var failureTuple = React.useState({ id: null, message: "" });
      var failure = failureTuple[0];
      var setFailure = failureTuple[1];

      /**
       * 删除：DSH 的排期按会话投递，所以宿主 `schedule.remove` 同时要 `id` 与 `sessionId`
       * （`lib/host/schedule.js:remove`）。条目没有会话绑定时不渲染删除按钮——点了必然报错。
       */
      function remove(item) {
        return function () {
          setFailure({ id: item.id, message: "" });
          props
            .api("/schedule/" + encodeURIComponent(String(item.id)), {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: item.id, sessionId: item.sessionId }),
            })
            .then(function () {
              setFailure({ id: null, message: "" });
              state.reload();
            })
            .catch(function (error) {
              setFailure({ id: item.id, message: errorMessage(error) });
            });
        };
      }

      // 两类数据合成一天的条目：`/schedule` 是 DSH 排期（「登记排期」写的就是它），
      // `/calendar` 是仓库里的内容日历（发布自动落库的条目 + 平台活动）。
      var scheduleItems = state.data !== null && Array.isArray(state.data.items) ? state.data.items : [];
      var calendarItems =
        calendarState.data !== null && Array.isArray(calendarState.data.items) ? calendarState.data.items : [];
      var buckets = {};
      function addEntry(entry) {
        if (entry.date === "") return;
        if (buckets[entry.date] === undefined) buckets[entry.date] = [];
        buckets[entry.date].push(entry);
      }
      scheduleItems.forEach(function (item, index) {
        addEntry({
          key: "schedule-" + String(item.id === undefined ? index : item.id),
          date: String(item.scheduledAt === undefined || item.scheduledAt === null ? "" : item.scheduledAt).slice(0, 10),
          title: String(item.topic || item.title || item.id || ""),
          platform: "",
          kind: "content",
          status: item.status === undefined || item.status === null ? "" : String(item.status),
        });
      });
      calendarItems.forEach(function (item, index) {
        addEntry({
          key: "calendar-" + String(item.id === undefined ? index : item.id),
          date: String(item.date === undefined || item.date === null ? "" : item.date).slice(0, 10),
          title: String(item.title || ""),
          platform: String(item.platform || ""),
          kind: item.kind === "event" ? "event" : "content",
          status: String(item.status || ""),
        });
      });
      function matchesFilter(entry) {
        if (filter === "event") return entry.kind === "event";
        if (filter === "content") return entry.kind !== "event";
        return true;
      }
      function entriesOn(day) {
        return (buckets[day] === undefined ? [] : buckets[day]).filter(matchesFilter);
      }
      var todayKey = dayKeyOf(new Date());
      var days = monthGridDays(month);

      return h(
        "div",
        null,
        h(
          Section,
          { title: t("calendar.title") },
          h("p", { className: "easel-muted easel-calendar-hint" }, t("calendar.hint")),
          h(
            "div",
            { className: "easel-calendar-toolbar" },
            h(
              "div",
              { className: "easel-actions", "data-easel-calendar-filters": "" },
              CALENDAR_FILTERS.map(function (option) {
                return h(
                  "button",
                  {
                    key: option,
                    type: "button",
                    className: "easel-button" + (filter === option ? " is-active" : ""),
                    "data-easel-calendar-filter": option,
                    "aria-pressed": filter === option ? "true" : "false",
                    onClick: function () {
                      setFilter(option);
                    },
                  },
                  t("calendar.filter." + option),
                );
              }),
            ),
            h(
              "div",
              { className: "easel-actions" },
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  "data-easel-calendar-prev": "",
                  onClick: function () {
                    setMonth(shiftMonthKey(month, -1));
                  },
                },
                t("calendar.prev"),
              ),
              h("span", { className: "easel-calendar-month", "data-easel-calendar-month": month }, month),
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  "data-easel-calendar-next": "",
                  onClick: function () {
                    setMonth(shiftMonthKey(month, 1));
                  },
                },
                t("calendar.next"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "easel-button",
                  "data-easel-calendar-today": "",
                  onClick: function () {
                    setMonth(monthKeyOf(new Date()));
                  },
                },
                t("calendar.today"),
              ),
            ),
          ),
          h(
            "ul",
            { className: "easel-calendar-legend", "data-easel-calendar-legend": "" },
            CALENDAR_LEGEND.map(function (name) {
              return h(
                "li",
                { key: name, className: "easel-calendar-legend-item" },
                h("span", { className: "easel-calendar-dot is-" + name }),
                name === "event" ? t("calendar.legendEvent") : valueLabel(t, name),
              );
            }),
          ),
          calendarState.status === "error"
            ? h(
                "p",
                { className: "easel-error-text", "data-easel-calendar-error": "" },
                errorMessage(calendarState.error),
              )
            : null,
          h(
            "div",
            { className: "easel-calendar-grid", "data-easel-calendar-grid": "" },
            CALENDAR_WEEKDAYS.map(function (index) {
              return h(
                "div",
                { key: "weekday-" + String(index), className: "easel-calendar-weekday" },
                t("calendar.weekday." + String(index)),
              );
            }).concat(
              days.map(function (day) {
                var entries = entriesOn(day);
                var shown = entries.slice(0, 3);
                var className = "easel-calendar-day";
                if (day.slice(0, 7) !== month) className += " is-outside";
                if (day === todayKey) className += " is-today";
                return h(
                  "div",
                  { key: day, className: className, "data-easel-calendar-day": day },
                  h("span", { className: "easel-calendar-date" }, String(Number(day.slice(8, 10)))),
                  shown.map(function (entry, index) {
                    var category = calendarCategory(entry);
                    return h(
                      "div",
                      {
                        key: entry.key + "-" + String(index),
                        className: "easel-calendar-item is-" + category,
                        "data-easel-calendar-item": category,
                        title: entry.title,
                      },
                      h("span", { className: "easel-calendar-dot is-" + category }),
                      entry.platform === "" ? null : h("span", { className: "easel-calendar-badge" }, entry.platform),
                      h(
                        "span",
                        { className: "easel-calendar-item-title" },
                        entry.title === "" ? t("calendar.untitled") : entry.title,
                      ),
                    );
                  }),
                  entries.length > shown.length
                    ? h(
                        "span",
                        { className: "easel-calendar-more" },
                        t("calendar.more", { count: String(entries.length - shown.length) }),
                      )
                    : null,
                );
              }),
            ),
          ),
        ),
        h(
          Section,
          { title: t("schedule.create") },
          h(ScheduleForm, {
            t: t,
            api: props.api,
            onCreated: function () {
              state.reload();
            },
          }),
        ),
        h(
          Section,
          { title: t("schedule.list") },
          h(Resource, { state: state, t: t }, function (data) {
            var items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) return h(EmptyState, { t: t, hintKey: "schedule.emptyHint" });
            return h(
              "ul",
              { className: "easel-list" },
              items.map(function (item, index) {
                return h(
                  "li",
                  { className: "easel-row", key: String(item.id === undefined ? index : item.id) },
                  h(
                    "div",
                    { className: "easel-row-main" },
                    h("span", { className: "easel-row-title" }, String(item.topic || item.title || item.id || "")),
                    h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, item.status), valueLabel(t, item.kind), item.scheduledAt])),
                  ),
                  h("span", { className: "easel-tag easel-state-" + String(item.status) }, valueLabel(t, item.status)),
                  // 只有真的记下了 sessionId 的条目才给入口：点了没目标的按钮比没有按钮更糟。
                  typeof item.sessionId === "string" && item.sessionId !== ""
                    ? h(
                        "button",
                        {
                          type: "button",
                          className: "easel-button",
                          "data-easel-open-session": item.sessionId,
                          onClick: function () {
                            props.openSession(item.sessionId);
                          },
                        },
                        t("schedule.openSession"),
                      )
                    : null,
                  typeof item.sessionId === "string" && item.sessionId !== ""
                    ? h(
                        "button",
                        {
                          type: "button",
                          className: "easel-button",
                          "data-easel-schedule-delete": String(item.id),
                          onClick: remove(item),
                        },
                        t("schedule.delete"),
                      )
                    : null,
                  failure.id !== null && String(failure.id) === String(item.id)
                    ? h("span", { className: "easel-error-text", "data-easel-schedule-delete-error": "" }, failure.message)
                    : null,
                );
              }),
            );
          }),
        ),
      );
    }

    /**
     * 派发到会话：选题只是待办，真正产出内容的一步是「把它变成某个会话里的任务说明」。
     * 宿主 `POST /dispatch` 早就有（`lib/host/dispatch.js`），缺的一直是入口——所以这里
     * 把只能由人决定的两件事收齐：**期望产物**（任务说明的必填项）与**投递目标**
     * （新会话，或从 `/sessions` 里挑一个既有会话）。
     *
     * `target` 的取值与宿主一致：`new-session` / `current-session`（后者必须带 `sessionId`）。
     */
    function DispatchForm(props) {
      var t = props.t;
      var topic = props.topic;
      var fieldsTuple = React.useState({ deliverable: "", profile: "", platform: "", notes: "" });
      var fields = fieldsTuple[0];
      var setFields = fieldsTuple[1];
      var targetTuple = React.useState("new-session");
      var target = targetTuple[0];
      var setTarget = targetTuple[1];
      var statusTuple = React.useState({ status: "idle", message: "", sessionId: null });
      var status = statusTuple[0];
      var setStatus = statusTuple[1];
      var sessions = useEndpoint(props.api, "/sessions");

      function change(name) {
        return function (event) {
          var value = event.target.value;
          setFields(function (previous) {
            var next = {};
            Object.keys(previous).forEach(function (key) {
              next[key] = previous[key];
            });
            next[name] = value;
            return next;
          });
        };
      }

      function submit(event) {
        event.preventDefault();
        var deliverable = String(fields.deliverable).trim();
        if (deliverable === "") {
          setStatus({ status: "failed", message: t("dispatch.deliverableRequired"), sessionId: null });
          return;
        }
        var body = {
          target: target === "new-session" ? "new-session" : "current-session",
          task: {
            goal: String(topic.title),
            deliverable: deliverable,
            profile: String(fields.profile).trim(),
            platform: String(fields.platform).trim(),
            notes: String(fields.notes).trim(),
          },
        };
        if (target !== "new-session") body.sessionId = target;
        setStatus({ status: "running", message: "", sessionId: null });
        props
          .api("/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
          .then(function (payload) {
            var sessionId = payload !== null && payload !== undefined && typeof payload.sessionId === "string" ? payload.sessionId : "";
            setStatus({ status: "done", message: "", sessionId: sessionId });
          })
          .catch(function (error) {
            setStatus({ status: "failed", message: error instanceof Error ? error.message : String(error), sessionId: null });
          });
      }

      var options = [{ id: "new-session", label: t("dispatch.newSession") }];
      if (sessions.status === "ready" && sessions.data !== null && Array.isArray(sessions.data.sessions)) {
        sessions.data.sessions.forEach(function (session) {
          if (session === null || session === undefined || typeof session.id !== "string") return;
          options.push({ id: session.id, label: (session.title === undefined || session.title === null ? session.id : String(session.title)) + "（" + t(session.running === true ? "dispatch.running" : "dispatch.idle") + "）" });
        });
      }

      return h(
        "form",
        { className: "easel-dispatch", "data-easel-dispatch-form": String(topic.id), onSubmit: submit },
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.deliverable")),
          h("input", {
            className: "easel-input",
            "data-easel-dispatch-deliverable": "",
            value: fields.deliverable,
            placeholder: t("dispatch.deliverablePlaceholder"),
            onChange: change("deliverable"),
          }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.profile")),
          h("input", { className: "easel-input", "data-easel-dispatch-profile": "", value: fields.profile, onChange: change("profile") }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.platform")),
          h("input", { className: "easel-input", "data-easel-dispatch-platform": "", value: fields.platform, onChange: change("platform") }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.notes")),
          h("input", { className: "easel-input", "data-easel-dispatch-notes": "", value: fields.notes, onChange: change("notes") }),
        ),
        h(
          "label",
          { className: "easel-field" },
          h("span", { className: "easel-field-label" }, t("dispatch.target")),
          h(
            "select",
            {
              className: "easel-input",
              "data-easel-dispatch-target": "",
              value: target,
              onChange: function (event) {
                setTarget(event.target.value);
              },
            },
            options.map(function (option) {
              return h("option", { key: option.id, value: option.id }, option.label);
            }),
          ),
        ),
        sessions.status === "error" ? h("p", { className: "easel-hint", "data-easel-dispatch-sessions": "" }, t("dispatch.sessionsUnavailable")) : null,
        h(
          "div",
          { className: "easel-actions" },
          h(
            "button",
            { type: "submit", className: "easel-button", "data-easel-dispatch-submit": "", disabled: status.status === "running" },
            status.status === "running" ? t("dispatch.sending") : t("dispatch.submit"),
          ),
        ),
        status.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-dispatch-error": "" }, status.message) : null,
        status.status === "done"
          ? h(
              "p",
              { className: "easel-hint", "data-easel-dispatch-done": "" },
              t("dispatch.done", { session: String(status.sessionId) }),
              status.sessionId === "" || typeof props.openSession !== "function"
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      className: "easel-button",
                      "data-easel-dispatch-open": status.sessionId,
                      onClick: function () {
                        props.openSession(status.sessionId);
                      },
                    },
                    t("dispatch.openSession"),
                  ),
            )
          : null,
      );
    }

    function TopicsRegion(props) {
      var t = props.t;
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var submitTuple = React.useState({ status: "idle", message: "" });
      var submit = submitTuple[0];
      var setSubmit = submitTuple[1];
      var openTuple = React.useState(null);
      var open = openTuple[0];
      var setOpen = openTuple[1];
      var state = useEndpoint(props.api, "/topics");

      function create(event) {
        event.preventDefault();
        var title = draft.trim();
        if (title === "") return;
        setSubmit({ status: "running", message: "" });
        props
          .api("/topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title }) })
          .then(function () {
            setDraft("");
            setSubmit({ status: "idle", message: "" });
            state.reload();
          })
          .catch(function (error) {
            setSubmit({ status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(
        "div",
        null,
        h(
          "form",
          { className: "easel-form", onSubmit: create },
          h("input", {
            className: "easel-input",
            "data-easel-topic-input": "",
            value: draft,
            placeholder: t("topics.title"),
            onChange: function (event) {
              setDraft(event.target.value);
            },
          }),
          h("button", { type: "submit", className: "easel-button", "data-easel-topic-add": "", disabled: submit.status === "running" }, t("topics.add")),
        ),
        submit.status === "failed" ? h("p", { className: "easel-error-text", "data-easel-topic-error": "" }, submit.message) : null,
        h(Resource, { state: state, t: t }, function (data) {
          var topics = Array.isArray(data.topics) ? data.topics : [];
          if (topics.length === 0) return h(EmptyState, { t: t, hintKey: "topics.emptyHint" });
          return h(
            "ul",
            { className: "easel-list" },
            topics.map(function (topic) {
              var expanded = open === topic.id;
              return h(
                "li",
                { className: "easel-row easel-row-block", key: String(topic.id) },
                h(
                  "div",
                  { className: "easel-row-main" },
                  h("span", { className: "easel-row-title" }, String(topic.title)),
                  h("span", { className: "easel-muted" }, joinMeta([valueLabel(t, topic.status), topic.source, topic.note])),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "easel-button",
                    "data-easel-dispatch-toggle": String(topic.id),
                    onClick: function () {
                      setOpen(expanded ? null : topic.id);
                    },
                  },
                  expanded ? t("dispatch.close") : t("topics.dispatch"),
                ),
                expanded ? h(DispatchForm, { t: t, api: props.api, topic: topic, openSession: props.openSession }) : null,
              );
            }),
          );
        }),
      );
    }

    /**
     * 可选的热点来源。宿主 `lib/host/trends.js` 的 `TREND_SOURCES` 是权威清单，
     * 这里只用于「选哪几个源」的勾选框（顺序与宿主一致）；勾选结果用 `?ids=` 传给
     * 宿主，宿主不认识的 id 会被忽略。
     */
    var TREND_SOURCE_IDS = ["weibo", "douyin", "zhihu", "bilibili", "baidu", "toutiao"];

    /** 抓取时间：取数还没落地时显示「未知」，不显示 `undefined`。 */
    function fetchedAtOf(state, t) {
      var value = state.data === null || state.data === undefined ? undefined : state.data.fetchedAt;
      return value === undefined || value === null ? t("common.unknown") : value;
    }

    function TrendsRegion(props) {
      var t = props.t;
      var selectedTuple = React.useState({});
      var selected = selectedTuple[0];
      var setSelected = selectedTuple[1];
      var saveTuple = React.useState({ title: "", status: "idle", message: "" });
      var save = saveTuple[0];
      var setSave = saveTuple[1];

      var picked = TREND_SOURCE_IDS.filter(function (id) {
        return selected[id] === true;
      });
      // 全选与不选等价（都由宿主取全部源）：这样默认状态不会因为少传 ids 而变。
      var query = picked.length === 0 || picked.length === TREND_SOURCE_IDS.length ? "" : "?ids=" + picked.join(",");
      var state = useEndpoint(props.api, "/trends" + query, [query]);

      function toggle(id) {
        setSelected(function (prev) {
          var next = {};
          Object.keys(prev).forEach(function (key) {
            next[key] = prev[key];
          });
          next[id] = prev[id] !== true;
          return next;
        });
      }

      /** 把一条热点线索存进选题库（带原文链接作为备注，来源标为 trend）。 */
      function saveAsTopic(item) {
        setSave({ title: String(item.title || ""), status: "running", message: "" });
        props
          .api("/topics", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: String(item.title || ""),
              note: item.url === undefined || item.url === null ? "" : String(item.url),
              source: "trend",
            }),
          })
          .then(function () {
            setSave({ title: String(item.title || ""), status: "done", message: "" });
          })
          .catch(function (error) {
            setSave({ title: String(item.title || ""), status: "failed", message: error instanceof Error ? error.message : String(error) });
          });
      }

      return h(
        "div",
        null,
        h(
          "div",
          { className: "easel-actions", "data-easel-trend-sources": "" },
          TREND_SOURCE_IDS.map(function (id) {
            return h(
              "label",
              { key: id, className: "easel-check" },
              h("input", {
                type: "checkbox",
                "data-easel-trend-source": id,
                checked: selected[id] === true,
                onChange: function () {
                  toggle(id);
                },
              }),
              h("span", null, t("trends.source." + id)),
            );
          }),
        ),
        h(
          "p",
          { className: "easel-muted" },
          h("span", null, t("trends.fetchedAt") + " "),
          h("span", { "data-easel-fetched-at": "" }, String(fetchedAtOf(state, t))),
        ),
        h(Resource, { state: state, t: t }, function (data) {
          var items = Array.isArray(data.items) ? data.items : [];
          var sources = Array.isArray(data.sources) ? data.sources : [];
          return h(
            "div",
            null,
            sources.length === 0
              ? null
              : h(
                  "ul",
                  { className: "easel-list easel-tags" },
                  sources.map(function (source) {
                    return h(
                      "li",
                      { key: String(source.source), className: "easel-tag" + (source.ok === true ? "" : " easel-state-degraded") },
                      String(source.label || source.source),
                    );
                  }),
                ),
            items.length === 0
              ? h(EmptyState, { t: t, hintKey: "trends.emptyHint" })
              : h(
                  "ul",
                  { className: "easel-list" },
                  items.map(function (item, index) {
                    var saved = save.status !== "idle" && save.title === String(item.title || "");
                    return h(
                      "li",
                      { className: "easel-row easel-row-block", key: String(index) },
                      h(
                        "div",
                        { className: "easel-row-main" },
                        h("span", { className: "easel-row-title" }, String(item.title || "")),
                        h("span", { className: "easel-muted" }, joinMeta([item.label || item.source, item.hot])),
                        saved
                          ? h(
                              "span",
                              {
                                className: save.status === "failed" ? "easel-error-text" : "easel-muted",
                                "data-easel-trend-save-state": save.status,
                              },
                              save.status === "failed" ? save.message : save.status === "done" ? t("trends.saved") : t("common.loading"),
                            )
                          : null,
                      ),
                      h(
                        "div",
                        { className: "easel-actions" },
                        item.url
                          ? h(
                              "a",
                              { className: "easel-button", href: String(item.url), target: "_blank", rel: "noreferrer noopener" },
                              t("common.open"),
                            )
                          : null,
                        h(
                          "button",
                          {
                            type: "button",
                            className: "easel-button",
                            "data-easel-trend-save": String(index),
                            disabled: save.status === "running",
                            onClick: function () {
                              saveAsTopic(item);
                            },
                          },
                          t("trends.save"),
                        ),
                      ),
                    );
                  }),
                ),
          );
        }),
      );
    }

    function AnalyticsRegion(props) {
      var t = props.t;
      var overview = useEndpoint(props.api, "/overview");
      var history = useEndpoint(props.api, "/publish/history?limit=50");
      return h(
        "div",
        null,
        h(
          Section,
          { title: t("nav.overview") },
          h(Resource, { state: overview, t: t }, function (data) {
            return h(KeyValue, {
              t: t,
              rows: [
                [t("overview.profiles"), data.profileCount],
                [t("overview.artifacts"), data.projectCount],
                [t("overview.topics"), data.topicCount],
                [t("overview.scheduled"), data.scheduledCount],
              ],
            });
          }),
        ),
        h(
          Section,
          { title: t("publish.history") },
          h(Resource, { state: history, t: t }, function (data) {
            var records = Array.isArray(data.records) ? data.records : [];
            var succeeded = records.filter(function (record) {
              return record.ok === true;
            }).length;
            var rate = records.length === 0 ? "0" : String(Math.round((succeeded / records.length) * 100));
            return h(KeyValue, {
              t: t,
              rows: [
                [t("analytics.records"), records.length],
                [t("analytics.succeeded"), succeeded],
                [t("analytics.successRate"), rate + "%"],
              ],
            });
          }),
        ),
      );
    }

    function SelfcheckRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/selfcheck");
      return h(Resource, { state: state, t: t }, function (data) {
        var entries = Array.isArray(data.entries) ? data.entries : [];
        // 摘要行必须点名「缺什么」：只写「缺失」两个字会被读成区块标题，而列表里
        // 明明还有一串正常条目，用户会以为整页都坏了（实际反馈过这一点）。
        var labelOf = function (entry) {
          return String(entry.label || entry.id || "");
        };
        var byStatus = function (status) {
          return entries
            .filter(function (entry) {
              return entry.status === status;
            })
            .map(labelOf);
        };
        var missingNames = byStatus("missing");
        var degradedNames = byStatus("degraded");
        var summaryParts = [];
        if (missingNames.length > 0) {
          summaryParts.push(t("selfcheck.summaryMissing", { items: missingNames.join(t("common.listSeparator")) }));
        }
        if (degradedNames.length > 0) {
          summaryParts.push(t("selfcheck.summaryDegraded", { items: degradedNames.join(t("common.listSeparator")) }));
        }
        return h(
          "div",
          null,
          h(
            "p",
            { className: "easel-muted", "data-easel-selfcheck-ready": data.ready === true ? "true" : "false" },
            summaryParts.length > 0 ? summaryParts.join(t("common.clauseSeparator")) : t("selfcheck.summaryOk"),
          ),
          h(
            "ul",
            { className: "easel-list" },
            entries.map(function (entry, index) {
              return h(
                "li",
                { className: "easel-row", key: String(entry.id === undefined ? index : entry.id) },
                h(
                  "div",
                  { className: "easel-row-main" },
                  h("span", { className: "easel-row-title" }, String(entry.label || entry.id || "")),
                  hasText(entry.path) ? h("span", { className: "easel-path easel-muted" }, String(entry.path)) : null,
                  hasText(entry.detail) ? h("span", { className: "easel-muted" }, String(entry.detail)) : null,
                  hasText(entry.hint) ? h("span", { className: "easel-hint" }, String(entry.hint)) : null,
                ),
                h("span", { className: "easel-tag easel-state-" + String(entry.status) }, valueLabel(t, entry.status)),
              );
            }),
          ),
        );
      });
    }

    /**
     * 区域组件表。做成一等公民的模块级字典是为了留一个**可测试的注入点**：
     * 测试把某个区域替换成必然抛错的组件，用来验证「区域崩了不影响子导航与返回对话」。
     */
    var REGION_VIEWS = {
      overview: OverviewRegion,
      accounts: AccountsRegion,
      profiles: ProfilesRegion,
      library: LibraryRegion,
      publish: PublishRegion,
      calendar: CalendarRegion,
      topics: TopicsRegion,
      trends: TrendsRegion,
      analytics: AnalyticsRegion,
      selfcheck: SelfcheckRegion,
    };

    /** 测试注入点：覆盖/清空一个区域的组件，返回被替换掉的那个。 */
    function __setRegionOverride(regionId, component) {
      var previous = REGION_VIEWS[regionId];
      if (component === null || component === undefined) delete REGION_VIEWS[regionId];
      else REGION_VIEWS[regionId] = component;
      return previous;
    }

    function RegionView(props) {
      var Component = REGION_VIEWS[props.id];
      return h(
        "div",
        { className: "easel-region", "data-easel-region": String(props.id) },
        Component === undefined
          ? h(EmptyState, { t: props.t })
          : h(Component, { t: props.t, api: props.api, apiBase: props.apiBase, openSession: props.openSession }),
      );
    }

    // -------------------------------------------------------------- 面板本体

    function createPanel(deps) {
      var t = deps.t;
      var api = deps.api;
      var selectPanel = deps.selectPanel;
      var openSession = deps.openSession;
      var localeStore = deps.localeStore;

      // 边界必须包在「面板自己的渲染体」外面：标题取词失败这类错误发生在面板组件自身，
      // 边界若渲染在它的输出里就兜不住（React 的边界只兜子树，兜不住自己）。
      function Panel() {
        return h(
          Boundary,
          {
            t: t,
            scope: "panel",
            onBack: function () {
              selectPanel(null);
            },
          },
          h(PanelBody, null),
        );
      }

      function PanelBody() {
        var regionTuple = React.useState(REGIONS[0].id);
        var region = regionTuple[0];
        var setRegion = regionTuple[1];
        // 字典可在运行时切换，闭包里的 t 会读到新语言，但 React 不知道要重画。
        React.useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getSnapshot);

        return h(
          "div",
          { className: "easel-panel", "data-easel-panel": PANEL_ID },
          h(
            "header",
            { className: "easel-header" },
            h(
              "div",
              null,
              h("h1", { className: "easel-title" }, t("panel.title")),
              h("p", { className: "easel-subtitle" }, t("panel.subtitle")),
            ),
            h(
              "button",
              {
                type: "button",
                className: "easel-button easel-back",
                "data-easel-back": "",
                onClick: function () {
                  selectPanel(null);
                },
              },
              t("panel.back"),
            ),
          ),
          h(
            "nav",
            { className: "easel-nav", "aria-label": t("panel.regions") },
            REGIONS.map(function (entry) {
              return h(
                "button",
                {
                  key: entry.id,
                  type: "button",
                  className: "easel-nav-item" + (entry.id === region ? " easel-nav-item-active" : ""),
                  "data-easel-nav": entry.id,
                  "aria-current": entry.id === region ? "page" : undefined,
                  onClick: function () {
                    setRegion(entry.id);
                  },
                },
                t(entry.labelKey),
              );
            }),
          ),
          h(
            "div",
            { className: "easel-body" },
            // key 用区域 id：换区域时重挂边界，否则某个区域崩过一次之后错误态会一直粘着。
            h(Boundary, { key: region, t: t, scope: "region" }, h(RegionView, { id: region, t: t, api: api, apiBase: API_PREFIX, openSession: openSession })),
          ),
        );
      }

      return Panel;
    }

    function createGlyph() {
      function EaselGlyph(props) {
        var size = typeof props.size === "number" ? props.size : 18;
        return h(
          "svg",
          {
            width: size,
            height: size,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            role: "img",
            "aria-hidden": "true",
            focusable: "false",
          },
          GLYPH_PATHS.map(function (d) {
            return h("path", { key: d, d: d });
          }),
        );
      }

      return EaselGlyph;
    }

    /**
     * 样式标签在 `ctx.effect` 里挂、在 dispose 时摘：插件卸载后页面里不该留下它的 CSS。
     * factory 执行时只注册 factory，真正的挂载要等 apply，所以这里再判一次 document。
     */
    function injectStyle(ctx) {
      ctx.effect(function () {
        if (typeof document === "undefined" || document === null || document.head === null || document.head === undefined) return undefined;
        var tag = document.createElement("style");
        tag.dataset.plugin = PANEL_ID;
        tag.dataset.pluginCss = PANEL_ID + "/panel";
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      }, PANEL_ID + ": styles");
    }

    /**
     * 槽位声明握在别的插件手里（`main` 归 layout，`sidebar.panellist` 归 sidebar），
     * 而且可能晚于本插件 apply；声明缺失时 `register()` 直接抛错。所以先等声明
     * （`slots.inject`），拿到注册的 disposer 就交给 `ctx.effect`，卸载时自动摘除。
     */
    function mountSlot(ctx, slotKey, install, label) {
      ctx.effect(function () {
        if (typeof ctx.slots.inject === "function") return ctx.slots.inject(slotKey, install);
        return install();
      }, label);
    }

    // ------------------------------------------------------------------ 入口

    function apply(ctx) {
      var locale = ctx.locale;

      // 客户端内置 locale id 只有 zh / en（`zh-CN` 只用于包内文档，不是运行时 id），
      // 两个语言必须一次注册齐，否则切到 en 会整片回落成 key。
      ctx.effect(
        function () {
          return locale.register(NS, { zh: DICT_ZH, en: DICT_EN });
        },
        NS + ": dictionaries",
      );

      var t = locale.bind(NS);
      var localeStore = createNotifier();
      if (typeof locale.subscribe === "function") {
        ctx.effect(
          function () {
            return locale.subscribe(localeStore.bump);
          },
          NS + ": locale re-render",
        );
      }

      injectStyle(ctx);

      var api = createApi(API_PREFIX, t);

      // 返回对话：`ILayout.selectPanel(null)` 即回到 Conversation。layout 是可选服务，
      // 取不到时只降级为「点了没反应」，不能让整个面板崩掉。
      var selectPanel = function (panelId) {
        try {
          var controller = typeof ctx.get === "function" ? ctx.get("layout") : undefined;
          if (controller === undefined || controller === null) controller = ctx.layout;
          if (controller !== undefined && controller !== null && typeof controller.selectPanel === "function") controller.selectPanel(panelId);
        } catch (error) {
          console.warn("[easel-workbench] cannot switch the main panel", error);
        }
      };

      // 打开某个会话：`uiWorkspace.openSession`。同样按可选服务处理——排期面板没它也能看，
      // 只是「打开会话」按钮点了没反应，绝不能因此让面板崩掉。
      var openSession = function (target) {
        try {
          var workspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
          if (workspace === undefined || workspace === null) workspace = ctx.uiWorkspace;
          if (workspace !== undefined && workspace !== null && typeof workspace.openSession === "function") {
            workspace.openSession(target);
            return true;
          }
        } catch (error) {
          console.warn("[easel-workbench] cannot open the session", error);
        }
        return false;
      };

      var Panel = createPanel({ t: t, api: api, selectPanel: selectPanel, openSession: openSession, localeStore: localeStore });
      var Glyph = createGlyph();

      // main 的 key 与 side bar 条目的 id 必须同值：宿主选中侧边栏条目时就是按这个值去找面板。
      mountSlot(
        ctx,
        "main",
        function () {
          return ctx.slots.register({ name: "main", key: PANEL_ID }, Panel);
        },
        NS + ": main panel",
      );

      mountSlot(
        ctx,
        "sidebar.panellist",
        function () {
          return ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: PANEL_ROW_ORDER,
              // label 用 thunk：语言切换时宿主会重新取词（sidebar 订阅了 locale）。
              label: function () {
                return t("panel.title");
              },
            },
            Glyph,
          );
        },
        NS + ": sidebar entry",
      );
    }

    exports.name = NS;
    // 静态依赖只放真正必需的客户端服务：多声明一个当前 profile 不存在的服务，
    // fiber 会永久停在 INACTIVE，插件再也不会激活。
    exports.inject = ["slots", "locale"];
    exports.apply = apply;

    // 便于测试与排查的只读面（宿主只读 name / inject / apply，多余字段会被忽略）。
    exports.__setRegionOverride = __setRegionOverride;
    exports.REGIONS = REGIONS;
    exports.PANEL_ID = PANEL_ID;
    exports.API_PREFIX = API_PREFIX;
    exports.NS = NS;

    module.exports = exports;
    return module.exports;
  },
});
