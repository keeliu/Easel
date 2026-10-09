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
      ".easel-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:13px}",
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
     */
    function createApi(prefix) {
      return function request(path, options) {
        return fetch(prefix + path, options).then(function (response) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (payload) {
              if (payload !== null && payload.ok === true) return payload;
              var message =
                payload !== null && typeof payload.message === "string" && payload.message !== ""
                  ? payload.message
                  : "HTTP " + String(response.status);
              var error = new Error(message);
              error.code = payload !== null && typeof payload.code === "string" ? payload.code : "http-" + String(response.status);
              throw error;
            });
        });
      };
    }

    /**
     * 一次性取数：`loader` 变了就重取，组件卸载后落地的结果直接丢弃（否则快速切区域
     * 会让上一个区域的响应覆盖当前区域的界面）。
     */
    function useResource(loader, deps) {
      var tuple = React.useState({ status: "loading", data: null, error: null });
      var state = tuple[0];
      var setState = tuple[1];
      React.useEffect(function () {
        var alive = true;
        setState({ status: "loading", data: null, error: null });
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

    function EmptyState(props) {
      return h("p", { className: "easel-muted", "data-easel-state": "empty" }, props.t("common.empty"));
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
      if (state.status === "loading") return h(Loading, { t: props.t });
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
              h("span", { className: "easel-muted" }, String(account.state)),
            ),
            h("span", { className: "easel-tag easel-state-" + String(account.state) }, String(account.state)),
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
          h(Section, { title: t("nav.accounts") }, accounts.length === 0 ? h(EmptyState, { t: t }) : h(AccountsRows, { t: t, accounts: accounts })),
        );
      });
    }

    function AccountsRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/accounts");
      var actionTuple = React.useState({ platform: null, status: "idle", message: "" });
      var action = actionTuple[0];
      var setAction = actionTuple[1];

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
        if (accounts.length === 0) return h(EmptyState, { t: t });
        return h(
          "ul",
          { className: "easel-list" },
          accounts.map(function (account) {
            var busy = action.platform === account.platform && action.status === "running";
            return h(
              "li",
              { className: "easel-row", key: String(account.platform) },
              h(
                "div",
                { className: "easel-row-main" },
                h("span", { className: "easel-row-title" }, String(account.label || account.platform)),
                h("span", { className: "easel-muted" }, joinMeta([account.state, account.message])),
                action.platform === account.platform && action.status !== "idle" && action.status !== "running"
                  ? h("span", { className: "easel-muted", "data-easel-action": action.status }, action.message)
                  : null,
              ),
              h("span", { className: "easel-tag easel-state-" + String(account.state) }, String(account.state)),
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
            );
          }),
        );
      });
    }

    function ProfileDetail(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/profiles/" + encodeURIComponent(props.name));
      return h(Resource, { state: state, t: t }, function (data) {
        var dimensions = data.dimensions !== null && typeof data.dimensions === "object" ? data.dimensions : {};
        var keys = Object.keys(dimensions);
        if (keys.length === 0) return h(EmptyState, { t: t });
        return h(
          "div",
          { className: "easel-region" },
          keys.map(function (dimension) {
            return h(Section, { key: dimension, title: dimension }, h("pre", { className: "easel-text" }, String(dimensions[dimension])));
          }),
        );
      });
    }

    function ProfilesRegion(props) {
      var t = props.t;
      var tuple = React.useState(null);
      var selected = tuple[0];
      var setSelected = tuple[1];
      var state = useEndpoint(props.api, "/profiles");
      return h(Resource, { state: state, t: t }, function (data) {
        var profiles = Array.isArray(data.profiles) ? data.profiles : [];
        var dimensions = Array.isArray(data.dimensions) ? data.dimensions : [];
        if (profiles.length === 0) return h(EmptyState, { t: t });
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
          selected === null ? h(EmptyState, { t: t }) : h(ProfileDetail, { t: t, api: props.api, name: selected }),
        );
      });
    }

    function ProjectDetail(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/projects/" + encodeURIComponent(props.topic));
      return h(Resource, { state: state, t: t }, function (data) {
        var files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) return h(EmptyState, { t: t });
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
        if (projects.length === 0) return h(EmptyState, { t: t });
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
                  h("span", { className: "easel-muted" }, joinMeta([project.status, project.updated])),
                ),
              );
            }),
          ),
          selected === null ? h(EmptyState, { t: t }) : h(ProjectDetail, { t: t, api: props.api, topic: selected }),
        );
      });
    }

    function describeAccepts(value) {
      if (!Array.isArray(value)) return "";
      return value
        .map(function (entry) {
          if (typeof entry === "string") return entry;
          if (entry !== null && typeof entry === "object") return String(entry.label || entry.id || "");
          return "";
        })
        .filter(function (entry) {
          return entry !== "";
        })
        .join(" / ");
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
          { title: t("publish.platforms") },
          h(Resource, { state: platforms, t: t }, function (data) {
            var rows = (Array.isArray(data.platforms) ? data.platforms : []).map(function (platform) {
              return [String(platform.label || platform.id), describeAccepts(platform.accepts)];
            });
            return rows.length === 0 ? h(EmptyState, { t: t }) : h(KeyValue, { t: t, rows: rows });
          }),
        ),
        h(
          Section,
          { title: t("publish.history") },
          h(Resource, { state: history, t: t }, function (data) {
            var records = Array.isArray(data.records) ? data.records : [];
            if (records.length === 0) return h(EmptyState, { t: t });
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

    function CalendarRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/schedule");
      return h(Resource, { state: state, t: t }, function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) return h(EmptyState, { t: t });
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
                h("span", { className: "easel-muted" }, joinMeta([item.status, item.kind, item.scheduledAt])),
              ),
              h("span", { className: "easel-tag easel-state-" + String(item.status) }, String(item.status)),
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
            );
          }),
        );
      });
    }

    function TopicsRegion(props) {
      var t = props.t;
      var draftTuple = React.useState("");
      var draft = draftTuple[0];
      var setDraft = draftTuple[1];
      var submitTuple = React.useState({ status: "idle", message: "" });
      var submit = submitTuple[0];
      var setSubmit = submitTuple[1];
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
          if (topics.length === 0) return h(EmptyState, { t: t });
          return h(
            "ul",
            { className: "easel-list" },
            topics.map(function (topic) {
              return h(
                "li",
                { className: "easel-row", key: String(topic.id) },
                h(
                  "div",
                  { className: "easel-row-main" },
                  h("span", { className: "easel-row-title" }, String(topic.title)),
                  h("span", { className: "easel-muted" }, joinMeta([topic.status, topic.source, topic.note])),
                ),
              );
            }),
          );
        }),
      );
    }

    function TrendsRegion(props) {
      var t = props.t;
      var state = useEndpoint(props.api, "/trends");
      return h(Resource, { state: state, t: t }, function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        var sources = Array.isArray(data.sources) ? data.sources : [];
        return h(
          "div",
          null,
          h(
            "p",
            { className: "easel-muted" },
            h("span", null, t("trends.fetchedAt") + " "),
            h("span", { "data-easel-fetched-at": "" }, String(data.fetchedAt === undefined || data.fetchedAt === null ? t("common.unknown") : data.fetchedAt)),
          ),
          sources.length === 0
            ? null
            : h(
                "ul",
                { className: "easel-list easel-tags" },
                sources.map(function (source) {
                  return h("li", { key: String(source.source), className: "easel-tag" + (source.ok === true ? "" : " easel-state-degraded") }, String(source.label || source.source));
                }),
              ),
          items.length === 0
            ? h(EmptyState, { t: t })
            : h(
                "ul",
                { className: "easel-list" },
                items.map(function (item, index) {
                  return h(
                    "li",
                    { className: "easel-row", key: String(index) },
                    h(
                      "div",
                      { className: "easel-row-main" },
                      h("span", { className: "easel-row-title" }, String(item.title || "")),
                      h("span", { className: "easel-muted" }, joinMeta([item.label || item.source, item.hot])),
                    ),
                    item.url ? h("a", { className: "easel-button", href: String(item.url), target: "_blank", rel: "noreferrer noopener" }, t("common.open")) : null,
                  );
                }),
              ),
        );
      });
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
        return h(
          "div",
          null,
          h(
            "p",
            { className: "easel-muted", "data-easel-selfcheck-ready": data.ready === true ? "true" : "false" },
            data.ready === true ? t("selfcheck.ok") : t("selfcheck.missing"),
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
                  h("span", { className: "easel-path easel-muted" }, String(entry.path || entry.detail || "")),
                ),
                h("span", { className: "easel-tag easel-state-" + String(entry.status) }, String(entry.status)),
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
          : h(Component, { t: props.t, api: props.api, openSession: props.openSession }),
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
            h(Boundary, { key: region, t: t, scope: "region" }, h(RegionView, { id: region, t: t, api: api, openSession: openSession })),
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

      var api = createApi(API_PREFIX);

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
