# 侦察：DSH 客户端插件 UI 契约（Slots / Locale / 布局 / 主题 / 模块装载）

只读侦察。对象是 DSH `0.2.0-rc.2`：核心安装 `/usr/local/lib/node_modules/@deepseek-ai/dsh/`，活动 profile `/data/dsh/profiles/web/`。下文每条结论都给出**逐字**代码/类型片段与绝对 `path:line`；行号对应本次侦察当时的这份安装。

阅读约定：`.d.ts` 是权威（编译期契约），`lib/client.js` 是运行时实现（真实调用点）。凡**未验证**的，一律写「未验证」，不猜。

---

## Q1. `ctx.slots.register(...)` 的精确客户端签名

### Q1.0 服务身份：`ctx.slots` 是 `SlotRegistry`，由 `dsh-client-ui-renderer` 提供

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts:1-11` 模块头逐字：

```ts
/**
 * SlotRegistry: the renderer-owned Cordis service over the pure
 * SlotCore (ui-slots owns registration semantics, the declaration ledger,
 * the load-time validations, and the unload cascade). This layer owns what
 * needs a live application: the 'slots/changed' event bridge, register and
 * declaration injection through the caller's ctx.effect (fiber unload
 * collects both), the renderer installation contract (install()/renderSlot('root') +
 * the SlotRendererHost face), and the store INSTANCE axis — handle x scope
 * key -> create/cache, dropped with the last holding entry, and in-memory
 * session instances released without clearing persisted state on scope death.
 */
```

同文件 `:46` `export declare class SlotRegistry extends Service {`；注册入口在 `:85` 是**直接复用 core 的类型面**：

```ts
85	    readonly register: SlotCore['register'];
```

`:68-84` 的 doc 逐字说明了为什么必须是原型方法（**这条对「我的 disposer 会不会挂到我自己 fiber 上」至关重要**）：

```ts
    /**
     * The ordinary Slot registration API. The typed face IS the core's register
     * (both overloads reused verbatim — one authority, no structural copy;
     * see SlotCore.register for children declaration, store seat, inject
     * face, load-time validation, and the unload cascade). This layer adds:
     * disposal through the caller's ctx.effect (fiber unload = cascade),
     * exclusive-factory minting (`store: createXxxStore` becomes a per-entry
     * handle), the registrant diagnostics stamp, and store-instance lifecycle
     * on the entry axis.
     *
     * Declared here, implemented by prototype assignment below the class: it
     * MUST stay a prototype method (never an instance arrow) — the cordis
     * service proxy binds `this.ctx` to the CALLER's context at call time,
     * which is what routes the effect (and the unload cascade) into the
     * caller's fiber. An arrow property would freeze `this` to the service's
     * own root ctx and silently break per-plugin disposal.
     */
```

**结论**：`ctx.slots.register(...)` 的返回值被自动挂到**调用方 fiber** 的 effect 上，插件卸载即自动撤销；不需要手动登记（但仍应保存 disposer 以便提前撤销，见 Q1.4）。

### Q1.1 `register` 的精确签名（两个 overload）

权威类型在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:789-804`：

```ts
    register<K extends keyof SlotMap & string, const EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>, const D extends ChildrenDecl = Record<never, never>, H extends StoreDecl | undefined = undefined, M = never, N extends (keyof LocaleNamespaceMap & string) | undefined = undefined, C extends SlotComponent<never> = SlotComponent<never>>(options: BaseOptions<K, EntryKey, D, H, M, N> & {
        inject?: undefined;
    }, component: C & SlotComponent<ComposedProps<K, NoInfer<EntryKey>, keyof NoInfer<D> & keyof SlotMap & string, HandleOf<NoInfer<H>>, object, NoInfer<M>, NoInfer<N>>> & RendersCheck<C, D>): () => void;
    /**
     * Inject-bearing overload: identical semantics to the overload above, plus
     * the registrant's business face — `I` is inferred from the inject
     * factory's return and joins the component's composed-props constraint
     * (factory parameters derive from the declaration, {@link InjectParams}).
     * @param options - registration options plus the `inject` business-face factory.
     * @param component - component honoring the five-share composed props
     * contract including the inject share `I`.
     * @returns disposer removing the registration and its declarations.
     */
    register<K extends keyof SlotMap & string, I extends object, const EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>, const D extends ChildrenDecl = Record<never, never>, H extends StoreDecl | undefined = undefined, M = never, N extends (keyof LocaleNamespaceMap & string) | undefined = undefined, C extends SlotComponent<never> = SlotComponent<never>>(options: BaseOptions<K, EntryKey, D, H, M, N> & {
        inject: (...args: InjectParams<K, H>) => I;
    }, component: C & SlotComponent<ComposedProps<K, NoInfer<EntryKey>, keyof NoInfer<D> & keyof SlotMap & string, HandleOf<NoInfer<H>>, I, NoInfer<M>, NoInfer<N>>> & RendersCheck<C, D>): () => void;
```

**返回类型恒为 `() => void`**（幂等 disposer；`:786-787` doc 逐字：“@returns disposer removing the registration and its declarations (idempotent; stale disposers after a cascade are no-ops).”）。

`:757-787` 的 doc 是全部装载期校验的成文规则，逐字：

```ts
    /**
     * Contribute a component to a declared slot and (optionally) declare child
     * slots, a store seat, and the registrant's business face.
     *
     * Load-time validation (misconfiguration fails loud; the render hot path
     * re-checks nothing): registering into an undeclared slot throws; declaring
     * an already-declared child key throws (one declarer per slot — the message
     * names the first declarer); mounting one shared store handle under slots
     * of different scopes throws. Kind constraints: keyed — missing `key`
     * throws; list — missing `id` throws; chain — missing `select` throws (the
     * selector is the entry's routing seat, see {@link ChainSelect}).
     *
     * Shadowing (single/keyed/list): entries sharing one cell (single — the
     * slot itself; keyed — same `key`; list — same `id`) coexist at distinct
     * priorities, sorted ascending with ties keeping registration order; the
     * cell's lowest live entry renders ({@link SlotCore.entriesOfSlot}). A
     * second registration at an occupied cell's exact priority (default 0)
     * throws naming the occupant, so priority-less composition keeps the
     * historical one-occupant-per-cell fail-loud.
     *
     * Lifecycle: the disposer removes the contribution AND collapses every
     * declared child slot (child entries clear recursively; their stale
     * disposers become no-ops) — one lifecycle axis, no dangling state.
     *
     * @param options - registration options: target `name`, `children`
     * declaration table, `store` seat, `inject` business-face factory, kind
     * shape fields (keyed `key`; list `id`/`order`/`label`).
     * @param component - component honoring the five-share composed props
     * contract ({@link ComposedProps}); checked at this call site.
     * @returns disposer removing the registration and its declarations
     * (idempotent; stale disposers after a cascade are no-ops).
     */
```

### Q1.2 `options` 的精确字段（`BaseOptions` + `KindOptions`）

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:596-613`：

```ts
/** Common register options share (see {@link SlotCore.register} for semantics). */
type BaseOptions<K extends keyof SlotMap & string, EntryKey extends EntryKeyOf<K>, D extends ChildrenDecl, H, M = never, N = undefined> = {
    /** Target slot key (the entry contributes INTO this slot). */
    name: K;
    /** Child-slot declaration + render authorization + runtime spec, in one table. */
    children?: D;
    /** Store seat: a shared handle (apply-constructed) or an exclusive factory (framework-called per entry x scope). */
    store?: H;
    /**
     * Dictionary namespace of this entry's copy. Declaring it puts the
     * framework-synthesized `t` seat (typed to the namespace's dictionary
     * union) on the component props; rendering requires an installed locale
     * face — fails loud otherwise.
     */
    locale?: N;
    /** Registrant identity label for diagnostics (the runtime Service wrapper stamps the caller's fiber name). */
    registrant?: string;
} & KindOptions<K, EntryKey, M>;
```

`:555-583`（`SlotLabel` 与按 kind 分派的字段）：

```ts
export type SlotLabel = string | (() => string);
/**
 * Kind shape fields carried in register options (keyed dispatch key; list
 * id/order/label; chain select/priority; non-chain priority = cell shadowing rank).
 */
export type KindOptions<K extends keyof SlotMap & string, EntryKey extends EntryKeyOf<K>, M = never> = SlotMap[K]['kind'] extends 'keyed' ? {
    key: EntryKey;
    /** Cell shadowing rank (ascending, default 0, lowest renders; same key + same priority throws — see {@link SlotCore.register}). */
    priority?: number;
} : SlotMap[K]['kind'] extends 'list' ? {
    id: string;
    order?: number;
    label?: SlotLabel;
    /** Cell shadowing rank (ascending, default 0, lowest renders; same id + same priority throws — see {@link SlotCore.register}). */
    priority?: number;
} : SlotMap[K]['kind'] extends 'chain' ? {
    /** Routing selector, mandatory on chain entries; `M` (the component's `matched` prop) infers from its return. */
    select: ChainSelect<SlotMap[K] extends {
        owner: infer O extends object;
    } ? O : object, M>;
    /** Explicit chain position (ascending, default 0, lower tries first); ties keep registration = assembly order. */
    priority?: number;
} : {
    /**
     * Cell shadowing rank (ascending, default 0, lowest renders; a
     * same-priority second registration throws — see {@link SlotCore.register}).
     */
    priority?: number;
};
```

**`label` 的形状：`string | (() => string)`**（`:555`）。**没有 locale-aware 对象形式**；要做本地化就用 thunk 在调用时读 `t()`（见 Q1.4 的真实调用点）。`order` 只在 **list** kind 上存在。

### Q1.3 (a) `sidebar.panellist` 条目的精确形状与 props

**槽位声明**在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:42-50`：

```ts
        /**
         * Global panel icons. Each list id addresses the matching main panel;
         * the sidebar owns the button and resolves its label from list metadata.
         */
        'sidebar.panellist': {
            kind: 'list';
            scope: 'root';
            owner: SidebarPanelIconOwnerProps;
        };
```

**owner（render 函数必收的 props）**在同文件 `:93-99`：

```ts
/** Icon presentation supplied by the global panel row. */
export interface SidebarPanelIconOwnerProps {
    /** Requested square edge in pixels. */
    size: number;
    /** Whether this panel is selected in the main column. */
    active: boolean;
}
```

**列表元数据（`id`/`order`/`label` 就是从这里被消费的）**在同文件 `:100-108`：

```ts
/** Serializable metadata for one active global panel list registration. */
export interface SidebarPanelMetadata {
    /** List id and matching main panel key. */
    id: MainPanelId;
    /** Ascending row order; ties retain registration order. */
    order: number;
    /** Row title and accessible name: resolved label, or the id when omitted. */
    label: string;
}
```

**被尊重的 option key（`sidebar.panellist`）**：`name`（必须 `'sidebar.panellist'`）、**`id`（必填，缺失抛错）**、`order`、`label`、`priority`，加上 `children` / `store` / `locale` / `registrant`。**`id` 必须与 `main` 槽位条目的 `key` 相同**，否则侧栏行选中时找不到主面板（见 Q1.5、Q5 的宿主行为证据）。

**props 合并规则**（权威）在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:161-164` 与 `:217-222`：

```ts
/** Owner-supplied props share for a slot key ({} for entries declaring no `owner`). */
export type OwnerOf<K extends keyof SlotMap & string> = SlotMap[K] extends { owner: infer O extends object } ? O : object;
```

```ts
export type ScopeStandardProps<S extends SlotScope> = (S extends 'session' ? SessionStandardProps : S extends 'session-maybe' ? SessionMaybeStandardProps : object) & GlobalStandardProps;
/** … */
export type PropsRuntime<K, EntryKey> = OwnerOf<K> & KeyPropsOf<K, EntryKey> & SlotInjectFace<SlotInjectOf<K>> & ScopeStandardProps<ScopeOf<K>>;
```

所以 `sidebar.panellist` 组件收到的 props = `SidebarPanelIconOwnerProps`（`{size, active}`）+ 注册时声明的 `inject` 面 + `store` handle（若声明）+ `t`（若声明 `locale`）+ `GlobalStandardProps`（`usePanelInfo` / `useSessions` / `useSessionStatus` / `useSessionRetainInfo` / `useWorkspaces` / `useResource`，见 Q1.6）。

**真实调用点**（`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:10192-10198`）：

```js
				own(ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: INSIGHT_PANEL_ID,
					order: 20,
					label: () => t("ov.title"),
					locale: ns
				}, (props) => (0, react.createElement)(InsightPanelIcon, { size: typeof props.size === "number" ? props.size : void 0 }))));
```

对照 `:10168-10179` 的成文 doc（逐字要点）：

```js
		/**
		* Mount the page and its sidebar entry while the preference shows them.
		* @param ctx - client root context carrying `slots` and the locale service.
		* …
		* @param t - the plugin-namespace translate; the label thunk reads it at call
		*   time, so a language switch relabels the sidebar row.
		* @param ns - the plugin's locale namespace, put on both registrations so the
		*   framework synthesizes the `t` seat for the page too.
		* @returns the watcher's disposer (unsubscribes and unwinds any live mount).
		*/
```

另一处真实调用点，`label` 用**纯字符串**，`locale` 不声明，`store` 声明了（`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1863-1875`）：

```js
				nativeEntryDispose = ctx.slots.register({
					name: "sidebar.panellist",
					id: "mcp-connector",
					order: 40,
					label: "MCP连接器"
				}, NativeSidebarIcon);
```

> 注意：`dsh-context` 的 `sidebar.panellist` **没有** `label` 之外的 `store`；`dsh-mcp-connector` 的 `sidebar.footer.action` 用 `store: marketView`（`:1876-1881`），证明 `store` 在 list 条目上同样合法。

### Q1.4 (b) keyed `main` 面板的精确形状与 props

**槽位声明**在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:49-56`：

```ts
        /**
         * Central panel selected by sidebar entry id. The reserved `conversation`
         * key hosts the Conversation; other keys receive no Session binding.
         */
        'main': {
            kind: 'keyed';
            scope: 'root';
        };
```

**`main` 没有 `owner`、也没有 `keyProps`**，因此：
- `OwnerOf<'main'>` = `object`（`:162` 的 `: object` 分支）——**没有任何 owner props**；
- `EntryKeyOf<'main'>` = `string`，`KeyPropsOf` = `object`；
- `scope: 'root'` → `ScopeStandardProps<'root'>` = `GlobalStandardProps`，**不含 `sessionId`**（成文注释：「other keys receive no Session binding」，`index.d.ts:50-52`）。

所以 `main` 面板组件收到的 props = `object`（owner 空）+ `KeyPropsOf`（空）+ `SlotInjectFace<注册时声明的 inject>` + `GlobalStandardProps`。**要拿会话身份必须自己经 `inject` 面或 `useSessions()` 取**。

**真实调用点**（`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:10187-10191`）：

```js
				own(ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: INSIGHT_PANEL_ID,
					locale: ns
				}, page)));
```

带 `store` + `inject` 的完整形态（`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1896-1908`）：

```js
	// main 必须先于 panellist 行就绪，否则宿主会拒绝选中缺页面的行。
	ctx.slots.inject("main", () => {
		const disposeMain = ctx.slots.register({
			name: "main",
			key: "mcp-connector",
			store: marketView,
			inject: () => ({
				...marketRuntimeProps(ctx),
				presentation: "panel",
				closePanel: () => layout()?.selectPanel?.(null)
			})
		}, MarketOverlay);
```

### Q1.5 `main` 与 `sidebar.panellist` 的 key/id 必须同值（宿主侧证据）

`SidebarPanelMetadata`（`.../dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:101-103`）逐字把二者绑死：

```ts
    /** List id and matching main panel key. */
    id: MainPanelId;
```

`dsh-mcp-connector` 的作者注释（`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1896`）也印证了选中校验：

```js
	// main 必须先于 panellist 行就绪，否则宿主会拒绝选中缺页面的行。
```

配套契约在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/service.d.ts:27-32`：

```ts
    /**
     * Select a global central panel without changing the current Session.
     * @param panelId - registered main key, or null to show the Conversation.
     * @throws if the selected main key is not registered; preserves the current selection.
     */
    selectPanel(panelId: MainPanelId | null): void;
```

### Q1.6 `GlobalStandardProps` / `SessionStandardProps` 的完整来源（props 里有什么）

`GlobalStandardProps` 由多个包 `declare module` 合并而来：

- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:29-32`：
  ```ts
      interface GlobalStandardProps {
          /** Subscribe to the selected main panel independently of parent renders. */
          usePanelInfo: UsePanelInfo;
      }
  ```
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-session/lib/types/client/index.d.ts:71-75`：`useSessions: UseSessions; useSessionStatus: UseSessionStatus; useSessionRetainInfo: UseSessionRetainInfo;`
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/types/client/index.d.ts:9-11`：`useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>;`
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:328-331`：`useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>;`
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-resources/lib/types/client/contract.d.ts:19-24`：`useResource: UseResource;`

`SessionStandardProps`（只在 `scope: 'session'` 时注入）：
- `.../dsh-client-ui-session/lib/types/client/index.d.ts:77-84`：`useSession: SessionSnapshotSelector; sessionId: SessionId; useProjection: UseProjection;`
- `.../dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:332-338`：`useConversation: UseConversation; useInput: SnapshotSelectorHook<InputState>; inputActions: InputActions;`

`SessionMaybeStandardProps`（`scope: 'session-maybe'`，同键但可 `undefined`）：`.../dsh-client-ui-session/lib/types/client/index.d.ts:85-93`、`.../dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:340-346`。

**`sidebar.panellist` 与 `main` 都是 `scope: 'root'`，拿不到 `sessionId`/`useSession`。**

---

## Q2. `ctx.slots.inject(slotName, callback)` 与 `ctx.effect(...)`

### Q2.1 `inject` 的精确签名与语义

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts:43-44` 与 `:96-111` 逐字：

```ts
/** One synchronous effect installed while an injected slot declaration is live. */
type SlotInjectionEffect = (() => void) | Iterable<() => void, void, void>;
```

```ts
    /**
     * Install an effect for each declaration lifetime of a slot. The callback
     * runs synchronously when the declaration already exists; otherwise it runs
     * inside the declaring `register()` call after the declaration is committed.
     * Collapse disposes the effect and a later declaration runs it again.
     * Callback effects are synchronous disposers; iterable effects install
     * transactionally and dispose in reverse order. The controller belongs to
     * the caller's fiber, so plugin unload cancels a pending wait and removes any
     * active contribution.
     *
     * @param key - declared SlotMap key to depend on.
     * @param callback - creates one disposer or an iterable of disposers.
     * @returns idempotent disposer for the wait and active effect.
     * @throws callback setup failures synchronously when the slot is already declared.
     */
    inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void;
```

**逐条回答**：
- **返回 disposer 吗？** 返回，`() => void`，且幂等（“idempotent disposer for the wait and active effect”）。
- **slot 出现时会重跑吗？** 会。语义是「**按声明的生死周期反复安装 effect**」：声明已存在 → 同步跑一次；随后被 collapse（`dispose` 掉声明它的 `register`）→ effect 被 dispose；之后**再次声明 → 再跑一次**。所以它同时是「等 slot 出现」和「每代实现都挂一遍」的机制。
- **callback 的返回值**：一个同步 disposer，**或**一个 disposer 可迭代（iterable）——iterable 是「事务式安装、逆序销毁」。
- **错误**：若 slot 已声明，callback 的 setup 异常会**同步抛出**。
- **生命周期**：controller 属于调用方 fiber，插件卸载会取消等待并撤掉已生效的贡献。

### Q2.2 真实用法：把 disposer 收集起来手动卸载

`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:10181-10202`：

```js
			let mounted = false;
			const disposers = [];
			const own = (result) => {
				if (typeof result === "function") disposers.push(result);
			};
			const mount = () => {
				own(ctx.slots.inject("main", () => ctx.slots.register({…}, page)));
				own(ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({…}, …)));
			};
			const unmount = () => {
				while (disposers.length > 0) disposers.pop()?.();
			};
```

> 这段 `mount/unmount` 由 settings 偏好驱动：偏好显示时 mount，隐藏时 unmount。**这是「同一个面板按需挂/卸」的范式**。

### Q2.3 `ctx.effect(...)` 的精确签名与语义

`ctx` 代理 fiber 成员，`effect` 实现在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts:402-418` 逐字：

```ts
  /**
   * Register a cleanup-aware effect on this fiber.
   *
   * `execute` runs immediately; the disposers it produces are collected and
   * run (in reverse order) either when the returned disposer is called or
   * when the fiber unloads, whichever comes first. Calling the disposer twice
   * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
   * already disposed, and `TypeError` if `execute` returns an invalid shape.
   *
   * @param execute — the effect body; see {@link Effect} for accepted shapes.
   * @param label — effect label shown in `getEffects()` diagnostics.
   * @returns a disposer that tears the effect down and settles once done.
   */
  effect(execute: () => SyncEffect, label?: string): Disposable<Promise<void>>
  /** Same as above for async effects; the disposer is also awaitable. */
  effect(execute: () => Effect, label?: string): AsyncDisposable<Promise<void>>
  effect(execute: () => Effect, label = 'anonymous'): any {
    this.assertActive()
    if (this.state === FiberState.UNLOADING) {
      throw new CordisError('INACTIVE_EFFECT')
    }
```

要点：`execute` **立即执行**；返回的 disposer（或 disposer 数组）被收集，并在「调用返回的 disposer」或「fiber 卸载」二者先到者时**逆序**执行；重复调用 disposer 是 no-op。`label` 是诊断字段。

**客户端插件里的标准清理用法**（`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:14216-14222`）：

```js
	function apply(ctx) {
		ctx.effect(() => {
			return ctx.locale.register(NS, {
				zh: DICT_ZH,
				en: DICT_EN
			});
		}, "dsh-context: dictionaries");
		const t = ctx.locale.bind(NS);
```

注入 `<style>` 标签的清理写法（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1181-1191`）：

```js
	function installThemeStyles(ctx) {
		if (typeof document === "undefined") return;
		for (const [name, css] of STYLES) ctx.effect(() => {
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}, `ui-theme: ${name} stylesheet`);
	}
```

> **范式**：`ctx.effect(() => { …apply…; return () => { …undo… }; }, "标签")`。标签是给人看的诊断字符串，官方示例里统一写成 `"<plugin>: <things>"`。

---

## Q3. 声明式 inject：`module.exports = { name, inject, apply }`

### Q3.1 真实模板

`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:14303-14307`：

```js
	module.exports = {
		name: "dsh-context",
		inject: ["slots", "locale"],
		apply
	};
```

`dsh-context` 只声明了两个服务，却用到了 `settingsScope` / `configForms`——因为它对**可选/后到的服务**改用 `ctx.inject([...], cb)` 动态注入（`:14270`、`:14285`）：

```js
		ctx.inject(["settingsScope"], (raw) => {
```

### Q3.2 逐服务回答

| 服务 | 键名就是该名字？ | client 还是 host？ | 声明位置 |
|---|---|---|---|
| `ctx.slots` | 是（`SlotRegistry`，cordis Service） | **client**（`dsh-client-ui-renderer`，浏览器半体） | `inject: ["slots"]` |
| `ctx.locale` | 是（`LocaleRuntime`） | **client**（`dsh-client-locale/lib/client.js`） | `inject: ["locale"]` |
| `ctx.layout` | 是（`ILayout`） | **client**（`dsh-client-ui-layout`） | `inject: ["layout"]` |
| `ctx.uiWorkspace` | 是（`UiWorkspace`） | **client**（`dsh-client-ui-workspace`） | `inject: ["uiWorkspace"]` |
| `ctx.theme` | 是（`ThemeRuntime`） | **client**（`dsh-client-ui-theme`） | `inject: ["theme"]` |

证据（逐个的 `declare module '@deepseek-ai/cordis'` 合并块）：

```ts
// /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/types/client/index.d.ts:57-60
declare module '@deepseek-ai/cordis' {
    interface Context {
        locale: LocaleRuntime;
    }
```

```ts
// /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/types/client/index.d.ts:84-87
declare module '@deepseek-ai/cordis' {
    interface Context {
        theme: ThemeRuntime;
    }
```

```ts
// /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts:18-23
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** The outward face only; the concrete service stays inside this plugin. */
        layout: import('./service.ts').ILayout;
    }
}
```

```ts
// /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/types/client/navigation.d.ts:91-96
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** … */
        uiWorkspace: UiWorkspace;
    }
}
```

（`ctx.slots` 的 Service 类在 `.../dsh-client-ui-renderer/lib/types/client/registry.d.ts:46`：`export declare class SlotRegistry extends Service {`。）

### Q3.3 「在 `inject` 里声明」是否为访问所必需？——**是，否则抛错**

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/reflect.ts:133-171` 的 Service 代理 `get` 陷阱：

```ts
    get: (target, prop, ctx: Context) => {
      if (isSpecialProperty(prop)) { return Reflect.get(target, prop, ctx) }
      if (Reflect.has(target, prop)) { return getTraceable(ctx, Reflect.get(target, prop, ctx)) }
      const error = new Error(`cannot get property "${prop}" without inject`)
      try {
        const def = target.reflect.props[prop]
        if (def?.type === 'accessor') { return def.get.call(ctx, ctx[symbols.receiver], error) }
        if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)
        return ctx.events.waterfall('internal/get', ctx, prop, error, () => {
          const key = target[symbols.isolate][prop]
          let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber
          while (true) {
            const impl = fiber.store?.[prop]
            if (impl) return getTraceable(ctx, impl.value)
            if (prop in fiber.inject) {
              error.message = `cannot get required service "${prop}" in inactive context`
              throw error
            }
            if (!fiber.runtime) throw error
            if (fiber.parent[symbols.isolate][prop] !== key) throw error
            fiber = fiber.parent.fiber
          }
        })
```

两条逐字错误串即证据：`cannot get property "${prop}" without inject`（`:144`）与 `cannot get required service "${prop}" in inactive context`（`:160`）。

**官方逃生舱**（`reflect.ts:9-19` 的 `get` doc 逐字）：

```ts
  /**
   * Read a service from the store **without the inject requirement**.
   * @param strict — when `true` (default), only return implementations whose providing fiber is currently active.
   * @returns the service value, or `undefined` when not (yet) provided.
   */
```

`dsh-mcp-connector` 正是这么用的（`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1835`、`:1071-1076`）：

```js
	const layout = () => typeof ctx.get === "function" ? ctx.get("layout") ?? ctx.layout : ctx.layout;
```

```js
	const uiWorkspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : ctx.uiWorkspace;
```

### Q3.4 **关键陷阱**：静态 `inject` 列了「可能永不出现」的服务 → 插件永不激活

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts:314-319`：

```ts
    if (this.uid !== null && parent.fiber.state !== FiberState.UNLOADING) {
      for (const name of Object.keys(this.inject)) {
        this._checkImpl(name)
      }
      this._refresh()
    }
```

`fiber.ts:611-623`：

```ts
  private _refresh() {
    let epoch = ''
    for (const name of Object.keys(this.inject)) {
      const impl = this._store[name]
      if (!impl) { epoch = INACTIVE; break }
      epoch += ':' + impl.fiber.uid
    }
    this._setEpoch(epoch)
```

`fiber.ts:600-609` 的 `_checkImpl` 在 `impl.check` 失败时 `delete this._store[name]`。**任一声明名解析不出来 → epoch = INACTIVE → 插件不激活（`apply` 不跑）。**

第三方插件的作者注释（`/data/dsh/profiles/web/node_modules/@weibaohui/skills-management/client/index.js:2193-2195`）逐字：

```js
    // Sessions face for 打开对话: dynamic inject per the ui-commands
    // precedent (scope.sessions). Static inject must NOT list services —
    // that stalls activation; root-level slot entries get no standard kit.
```

同文件 `:2202-2203` 逐字：

```js
        // dsh 0.1.7+: sessions.open() 被移除，会话导航改走
        // uiWorkspace.openSession()。归一成 { open(id) } 面孔，调用点不变。
```

同文件 `:2220-2221` 逐字（父路径 inject 的坑）：

```js
    // 0.1.5+: subpath inject `remote.skills` (just `remote` is not enough —
    // cordis guards child paths against undeclared inject). Older cores fall back
    // to `connection.api.skills`.
```

`reflect.ts:320` 的同源证据：

```ts
      if (!(name in fiber.inject)) continue
```

**实践结论**：
- 必需且确定存在的服务（`slots`、`locale`）→ 放静态 `inject`。
- 可选/后到/由宿主版本差异决定的服务（`layout`、`uiWorkspace`、`theme`、`sessions`、`settingsScope`、`configForms`）→ 用 `ctx.inject([...], cb)` 动态注入 + `ctx.get(name)` 兜底，**不要**放进静态 `inject`。
- `dsh-context` 的 `inject: ["slots", "locale"]` 就是这个策略的产物：它没声明 `layout`，却仍然通过 `ctx.get`/动态注入完成所有事。

---

## Q4. Locale：注册、namespace、解析、字典来源

### Q4.1 服务与 API

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/types/client/index.d.ts:1-6` 模块头逐字：

```ts
/**
 * Browser-side locale registry. Bound translation functions retain stable
 * identity for injected consumers. The plugin also registers the Language
 * preference row into the settings General section — the locale feature owns
 * its own settings surface.
 */
```

关键类型与常量（同文件）：`:29` `export type LocaleDict = Record<string, string>;`（“flat key to template string ({name} placeholders)”）；`:49-56` `LocaleSnapshot {active, locales, revision}`。

`LocaleRuntime` 的方法（同文件行号）：

| 行 | 签名 |
|---|---|
| `:123` | `getLocale(): LocaleSnapshot` |
| `:130` | `resolveText(text: LocalizedText): string` |
| `:144` | `subscribe(fn): () => void` |
| `:157` | `setLocale(id: string): void`（unknown ids throw） |
| `:170` | `addLanguage(input: LanguageRegistration): () => void` |
| `:199` | `register<N extends Extract<keyof LocaleNamespaceMap,string>>(ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void` |
| `:209` | `register(ns: string, locale: string, dict: LocaleDict): () => void` |
| `:219` | `bind<N>(ns: N): TranslateNS<N>` |
| `:226` | `bind(ns: string): Translate` |

`:87-96` 的查找规则 doc 逐字：

```ts
/**
 * Lookup walks the active language's declared fallback chain in the entry
 * namespace, then repeats it in the shared common namespace before showing
 * the key itself.
 */
```

### Q4.2 运行时实现（重载怎么区分、绑定为何稳定）

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js:1387-1412` 逐字：

```js
			register(ns, localeOrDicts, dict) {
				const pairs = typeof localeOrDicts === "string" ? [[localeOrDicts, dict]] : Object.entries(localeOrDicts);
				for (const [locale] of pairs) if (!LOCALE_ID_PATTERN.test(locale)) throw new Error(`locale id "${locale}" is not a BCP 47-style tag`);
				let locales = this.dicts.get(ns);
				if (!locales) {
					locales = new Map();
					this.dicts.set(ns, locales);
				}
				for (const [locale] of pairs) if (locales.has(localeKey(locale))) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
				for (const [locale, entries] of pairs) locales.set(localeKey(locale), entries);
				this.publish(this.snapshot.active, false);
				return () => { … };
			}
```

```js
			bind(ns) {
				let t = this.bound.get(ns);
				if (!t) {
					t = (key, params) => this.translate(ns, key, params);
					this.bound.set(ns, t);
					return t;
				}
				return t;
			}
			translate(ns, key, params) {
				const chain = this.fallbackChain(this.snapshot.active);
				const template = this.lookup(ns, key, chain) ?? (ns !== "common" ? this.lookup("common", key, chain) : void 0) ?? key;
				if (!params) return template;
				return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
			}
			lookup(ns, key, chain) {
				const locales = this.dicts.get(ns);
				for (const locale of chain) {
					const value = locales?.get(localeKey(locale))?.[key];
					if (value !== void 0) return value;
				}
			}
```

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js:1135-1139`：

```js
		const FALLBACK_LOCALE = "en";
		/** … */
		const COMMON_NS = "common";
		/** … */
		const SETTINGS_NS = "settings.locale";
```

`:920` 的 id 正则逐字：

```js
		const LOCALE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
```

`lib/types/locale-settings.d.ts:10-14`：

```ts
export declare const LOCALE_IDS: readonly ["zh", "en"];
export type BuiltInLocaleId = typeof LOCALE_IDS[number];
export type LocaleId = string;
```

**结论**：
- 两/三参数重载**靠 `typeof localeOrDicts === "string"` 在运行时区分**；两者都返回 disposer。
- **内置 locale id 只有 `zh` / `en`**（不是 `zh-CN`）。`zh-CN` 语法上合法（正则允许），但内置语言选择器只有 `zh`/`en`；注册 `zh-CN` 而用户选 `zh` 时**不会命中**（`zh` 的 fallback 链只到 `en`）。**插件要提供中文就用 `zh`。**
- `bind(ns)` 对同一 ns **返回同一函数引用**（`this.bound` 缓存），因此可以安全地放进 slot 的 `inject` 面 / props 而不破坏 memo。
- 缺键时**回落到 `common` namespace，再回落到 key 本身**；`{name}` 占位符做插值，缺失的占位符原样保留。
- 重复 `(ns, locale)` 抛 `locale namespace "${ns}" already has locale "${locale}"`。
- 字典注册会 `publish(...)` 提升 revision，**已渲染的 outlet 会拿到后到的字典**（`:1258-1260` doc：“notifications on every snapshot change (locale switch **or dictionary registration** — registrations bump the revision so already rendered outlets pick up late-arriving dictionaries and locale definitions)”）。

### Q4.3 namespace 约定

- 插件自己的 namespace 用**自己的包名**（`dsh-context` 用 `const NS = "dsh-context"`，`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:14215`）。
- 核心的共享词表用 `common`（`COMMON_NS`）；核心设置行用 `settings.locale`、`settings.theme` 这类 `<feature>.<area>` 形式。
- TypeScript 侧要专门做模块增强才有类型：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/types/client/index.d.ts:20-27`：

  ```ts
  declare module '@deepseek-ai/dsh-client-ui-slots' {
      interface LocaleNamespaceMap {
          /** Shared cross-feature vocabulary, consulted by the lookup chain after the entry's own namespace misses. */
          common: CommonKey;
          /** This feature's own settings-row copy (the Language row). */
          'settings.locale': SettingsLocaleKey;
      }
  }
  ```

  **不增强也能跑**：`dsh-context` 的客户端 half 不带 `.d.ts`（`/data/dsh/profiles/web/node_modules/dsh-context/package.json` 的 `files` 只含 `lib/client.js`·`lib/index.js`·`lib/index.d.ts`），2 参数 `register` 在运行时照样工作。类型只影响宿主半体。

### Q4.4 字典是打进 bundle 还是运行时抓 JSON？

- **打进 bundle**。`dsh-context` 在 `lib/client.js:34` 起就是内联字典（`const DICT_ZH = {…}` / `const DICT_EN = {…}`），随后 `ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN })`（`:14218-14221`）。
- 主题包同样内联：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1196-1220` 是 `zh = { "appearance.title": "外观", … }` / `en = {…}` 的 JS 对象字面量。
- **包的 `exports["./locale/*.json"]` 不是客户端翻译源的运行时来源**。它是「包展示元数据」。`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:544-551` 逐字：

  ```
  * The bundles the dsh installation ships for a person to switch on: each a
  * runtime dependency of the installation that declares `dsh.bundle.patch`,
  * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
  * template, and offered switched off by the plugin manager
  ```

  （同义声明也在 `dsh-app-boot/lib/types/profile.d.ts:142`。）

**对本仓库的含义**：`/data/dsh/home/dsh-hub/Easel/dsh-plugins/easel-workbench/locale/{en.json,zh-CN.json}` 现在是（且只应是）包展示元数据；客户端界面文案必须另建一份**内联进 `lib/client.js` 的字典**，键名用 `zh` / `en`。

---

## Q5. 返回会话 / 布局控制

### Q5.1 (a) 回到会话视图：`ctx.layout.selectPanel(null)`

服务面在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/service.d.ts:14-32`：

```ts
/** Identity shared by a sidebar panel entry and its main-slot occupant. */
export type MainPanelId = Branded<'MainPanelId'>;
/** Root-scoped navigation state exposed to panel-aware components. */
export interface PanelInfo {
    /** Selected global panel; null displays the current Conversation. */
    readonly activePanelId: MainPanelId | null;
}
/** … */
export interface ILayout {
    /** Selected central panel from the same root store used by `usePanelInfo`. */
    readonly panelInfo: HostObservable<PanelInfo>;
    /**
     * Select a global central panel without changing the current Session.
     * @param panelId - registered main key, or null to show the Conversation.
     * @throws if the selected main key is not registered; preserves the current selection.
     */
    selectPanel(panelId: MainPanelId | null): void;
```

DSH 自带包的真实调用点：
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:480` `ctx.layout.selectPanel(id);`
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:969` `this.ctx.layout.selectPanel(null);`（`clearMain()`，即「回到会话」）
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:462-465` `selectPanel(panelId) { … this.panels.selectPanel(panelId); }`

第三方插件的真实调用点（**完整可抄**，`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1835-1841`）：

```js
	const layout = () => typeof ctx.get === "function" ? ctx.get("layout") ?? ctx.layout : ctx.layout;
	const leaveNativePanel = () => {
		const controller = layout();
		try {
			if (controller?.panelInfo?.getSnapshot?.().activePanelId === "mcp-connector") {
				controller.selectPanel(null);
			}
```

同文件 `:1905`（面板自己的「关闭」按钮）：

```js
				closePanel: () => layout()?.selectPanel?.(null)
```

另一例（`/data/dsh/profiles/web/node_modules/@xmanrui/dsh-im/lib/client.js:21094`）：

```js
			onOpen: () => pageCtx.layout.selectPanel(IM_MAIN_PANEL_ID)
```

### Q5.2 (b) 导航到某个 session：`ctx.uiWorkspace.openSession(target)`

服务面在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/types/client/navigation.d.ts:10-15`：

```ts
    /**
     * Select a Session and show its Conversation as one UI navigation action.
     * @param target - known Session identity or durable direct-parent subagent
     *   address to display.
     */
    openSession(target: SessionTarget): void;
```

（`SessionTarget` 来自 `@deepseek-ai/dsh-api-session-controller/client`。）

真实调用点：`/data/dsh/profiles/web/node_modules/@weibaohui/skills-management/client/index.js:2196-2210` 逐字：

```js
      if (typeof ctx.inject === 'function') {
        ctx.inject(['sessions'], (scope) => {
          const svc = scope && scope.sessions
          if (svc && typeof svc.open === 'function') sessionsApi = svc
        })
        // dsh 0.1.7+: sessions.open() 被移除，会话导航改走
        // uiWorkspace.openSession()。归一成 { open(id) } 面孔，调用点不变。
        ctx.inject(['uiWorkspace'], (scope) => {
          const svc = scope && scope.uiWorkspace
          if (svc && typeof svc.openSession === 'function' && !sessionsApi) {
            sessionsApi = { open: (id) => svc.openSession(id) }
          }
        })
      }
```

另一处相关能力（打开工作区而非会话）在 `/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1071-1076`：

```js
	const uiWorkspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : ctx.uiWorkspace;
	…
			sessionId = await uiWorkspace.connectWorkspace(targetWorkspaceId);
```

（同文件 `:1068` 中文注释：“uiWorkspace；0.1.1 Desktop 仍暴露旧方法。优先使用当前公开能力，”）

### Q5.3 「不声明另一个 DSH 客户端包为依赖，能做到吗？」——**能**

- Q5.1 与 Q5.2 的**全部**真实调用点，访问路径只有两种：`ctx.layout` / `ctx.get("layout")`、`ctx.uiWorkspace` / `ctx.get("uiWorkspace")`；**没有任何调用点**把 `@deepseek-ai/dsh-client-ui-layout` 或 `@deepseek-ai/dsh-client-ui-workspace` 写进运行期要求（`dsh-mcp-connector` 的 `dsh.client.inject` 里确实列了这两个包名，但那是**包的 factory 到达顺序**，不是 cordis 服务注入；`skills-management` 连它都没写，照样工作）。
- 只要运行时**服务已由宿主安装**，`ctx.inject(["uiWorkspace"], cb)` 或 `ctx.get("uiWorkspace")` 就能拿到；`dsh.client.inject` 只影响「谁的 factory 先到」，**不影响**服务代理能否解析（服务解析走 cordis fiber store，见 Q3.3）。
- **代价**：不写 `dsh.client.inject` 就失去「我的 factory 物化时它已在 graph 里」的顺序保证；动态注入正好把这种不确定性变成「晚到也能接上」。所以 `skills-management` 的注释才写「Static inject must NOT list services — that stalls activation」。
- 不需要 `import`/`require` 这些包：**服务是运行时对象，不是模块**。单文件 bundle 只需要 `react`。

---

## Q6. 主题 token

### Q6.1 权威来源

**权威定义**：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1148` 的 `var design_platform_css_default = "…"` —— 一整行压缩 CSS，内含三个块：

1. `body{--dsw-static-*…}`（亮色静态调色板）
2. `body[data-ds-dark-theme]{--dsw-static-*…}`（暗色静态调色板）
3. `body{--dsw-alias-*…}`（亮色语义别名）+ `body[data-ds-dark-theme]{--dsw-alias-*…}`（暗色语义别名）

逐字（节选该行的相关片段）：

```css
body{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-layer-3:var(--dsw-static-neutral-bluish-00);--dsw-alias-bg-overlay:var(--dsw-static-neutral-bluish-150);--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-border-l3:#0000001f;--dsw-alias-border-l4:#00000029;--dsw-alias-brand-primary:var(--dsw-static-neutral-bluish-1000);--dsw-alias-label-primary:var(--dsw-static-neutral-bluish-1000);--dsw-alias-label-secondary:var(--dsw-static-neutral-bluish-700);--dsw-alias-label-tertiary:var(--dsw-static-neutral-bluish-600);--dsw-alias-link:var(--dsw-static-deepseek-500);…}
body[data-ds-dark-theme]{--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950);--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-875);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-850);--dsw-alias-bg-layer-3:var(--dsw-static-neutral-bluish-800);--dsw-alias-border-l2:#ffffff1f;--dsw-alias-label-primary:var(--dsw-static-neutral-bluish-50);--dsw-alias-label-secondary:var(--dsw-static-neutral-bluish-300);--dsw-alias-link:var(--dsw-static-deepseek-400);…}
```

**暗色不是媒体查询，而是 `body[data-ds-dark-theme]` 属性**。

**挂载方式**（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1170-1191`）：

```js
		["design-platform.css", design_platform_css_default],
		["focus.css", focus_css_default],
		["onboarding.css", onboarding_css_default],
		["scrollbar.css", scrollbar_css_default],
		["gradient-shadow-text.css", gradient_shadow_text_css_default],
		["shiki.css", shiki_css_default]
	];
	/** … */
	function installThemeStyles(ctx) {
		if (typeof document === "undefined") return;
		for (const [name, css] of STYLES) ctx.effect(() => {
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}, `ui-theme: ${name} stylesheet`);
	}
```

> **前端 dist 里没有定义。** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BPHePDI_.css` 只有 `var(--dsw-alias-*)` 的**引用**，定义全在 `dsh-client-ui-theme/lib/client.js` 的内联字符串里。要查一个 token 的亮/暗值，必须读那个文件。

### Q6.2 `--dsw-alias-*` 家族完整清单（107 个，按用途分组）

分组是本文档按语义归的类，**名字逐字来自 `design_platform_css_default`**（另有 4 个 onboarding token 来自 `onboarding_css_default`，已标注）。

**背景 / 表面（17）**
`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-layer-3`、`--dsw-alias-bg-overlay`、`--dsw-alias-bg-skeleton`、`--dsw-alias-bg-module-platform`、`--dsw-alias-bg-multi-select`、`--dsw-alias-bg-document-preview`、`--dsw-alias-bg-document-selection`、`--dsw-alias-settings-card-fill`、`--dsw-alias-menu-group-header-fill`、`--dsw-alias-toast-bg`、`--dsw-alias-tooltip-bg`、`--dsw-alias-tooltip-key-bg`、`--dsw-alias-turn-trigger-bg`、`--dsw-alias-turn-trigger-bg-hover`

**遮罩（5）**
`--dsw-alias-bg-mask-1`、`--dsw-alias-bg-mask-2`、`--dsw-alias-bg-mask-3`、`--dsw-alias-bg-mask-drop`、`--dsw-alias-bg-mask-photo`

**文字 / 标签（15）**
`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-label-tertiary`、`--dsw-alias-label-caption`、`--dsw-alias-label-dimmed`、`--dsw-alias-label-primary-foreground`、`--dsw-alias-label-primary-inverted`、`--dsw-alias-label-primary-dimmed`、`--dsw-alias-label-primary-bluish`、`--dsw-alias-label-document-preview`、`--dsw-alias-label-shimmer`、`--dsw-alias-label-deep-diving`、`--dsw-alias-label-deep-diving-shimmer`、`--dsw-alias-toast-label`、`--dsw-alias-link`

**边框（8）**
`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-border-l2-darkmode-thin`、`--dsw-alias-border-l3`、`--dsw-alias-border-l4`、`--dsw-alias-border-inverted`、`--dsw-alias-border-inverted2`、`--dsw-alias-settings-card-stroke`

**品牌 / 强调（3）**
`--dsw-alias-brand-primary`、`--dsw-alias-brand-primary-invert`、`--dsw-alias-brand-text`（另有畸形名 `--dsw-alias-brand-primary-new-colorprimary-new-color`——上游拼接 bug，**不要用**）

**按钮（15）**
`--dsw-alias-button-primary-fill`、`--dsw-alias-button-primary-hover`、`--dsw-alias-button-primary-dimmed`、`--dsw-alias-button-ghost-active-fill`、`--dsw-alias-button-ghost-active-hover`、`--dsw-alias-button-ghost-active-border`、`--dsw-alias-button-elevated-fill`、`--dsw-alias-button-floating-fill`、`--dsw-alias-button-floating-hover`、`--dsw-alias-button-contrast-fill`、`--dsw-alias-button-info-fill`、`--dsw-alias-button-info-hover`、`--dsw-alias-button-tool-bar-fill`、`--dsw-alias-button-tool-bar-fill-invisible`、`--dsw-alias-button-tool-bar-hover`

**交互态（5）**
`--dsw-alias-interactive-bg-hover`、`--dsw-alias-interactive-bg-active`、`--dsw-alias-interactive-bg-hover-accent`、`--dsw-alias-interactive-bg-hover-solid`、`--dsw-alias-interactive-bg-hover-danger`

**状态色（12）**
`--dsw-alias-state-success-primary`、`--dsw-alias-state-success-secondary`、`--dsw-alias-state-success-tertiary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-warn-secondary`、`--dsw-alias-state-warn-tertiary`、`--dsw-alias-state-warn-label`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-error-secondary`、`--dsw-alias-state-business-primary`、`--dsw-alias-state-business-tertiary`、`--dsw-alias-state-idle-primary`

**Markdown / 代码（10）**
`--dsw-alias-markdown-code-block`、`--dsw-alias-markdown-code-block-banner`、`--dsw-alias-markdown-code-segment-selected`、`--dsw-alias-markdown-code-segment-unselected`、`--dsw-alias-markdown-inline-code`、`--dsw-alias-markdown-citation`、`--dsw-alias-markdown-tag`、`--dsw-alias-markdown-placeholder`、`--dsw-alias-code-diff-added`、`--dsw-alias-code-diff-deleted`

**diff 行（6）**
`--dsw-alias-file-diff-added-bg`、`--dsw-alias-file-diff-added-gutter`、`--dsw-alias-file-diff-added-marker`、`--dsw-alias-file-diff-deleted-bg`、`--dsw-alias-file-diff-deleted-gutter`、`--dsw-alias-file-diff-deleted-marker`

**滚动条 / 开关 / 菜单图标（6）**
`--dsw-alias-scrollbar-bg-l1`、`--dsw-alias-scrollbar-bg-l2`、`--dsw-alias-scrollbar-hover-l1`、`--dsw-alias-scrollbar-hover-l2`、`--dsw-alias-switch-thumb`、`--dsw-alias-menu-icon`

**onboarding（4，定义在 `onboarding_css_default` 而非 `design_platform_css_default`）**
`--dsw-alias-onboarding-accent`、`--dsw-alias-onboarding-card-fill`、`--dsw-alias-onboarding-secondary-fill`、`--dsw-alias-onboarding-checkbox-border`

**姊妹家族（同一 CSS 行内，插件通常用不到，但主题覆盖层可写）**
`--dsw-static-*`（~78 个静态色阶：`-neutral-bluish-NNN`、`-deepseek-NNN`、`-blue-NNN`、`-green-NNN`、`-red-NNN`、`-amber-NNN`）、`--dsw-specific-*`（`-bubble`、`-bubble-highlight`、`-input-major`、`-login-input`、`-menu`、`-selector`、`-sidebar-fill`、`-sidebar-nav-item-active`、`-sidebar-nav-item-active-accent`、`-sidebar-nav-item-hover`、`-tip`）、`--dsw-menu-surface-fill`、`--dsw-font-*`、`--dsw-radius-*`、`--dsw-shadow-*`、`--dsw-elevation-*`、`--dsh-scrollbar-*`（见 `base_css_default` :1142、`gradient_shadow_text_css_default` :1160、`scrollbar_css_default` :1157）。

### Q6.3 「插件应当使用哪些 token」的成文规则

**成文目录只有 14 项**，来自 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1234-1333` 的 `BUILTIN_INSPECT_TOKENS`（每项 `{name, description, valueType: "CSS color", requiresLightAndDark: true, cssVariable: name}`）：

| token | 逐字 description |
|---|---|
| `--dsw-alias-bg-base` | Application base background. |
| `--dsw-alias-bg-layer-1` | Primary raised surface background. |
| `--dsw-alias-bg-layer-2` | Secondary nested surface background. |
| `--dsw-alias-bg-overlay` | Overlay and popover background. |
| `--dsw-alias-border-l1` | Primary subtle border. |
| `--dsw-alias-border-l2` | Secondary stronger border. |
| `--dsw-alias-brand-primary` | Primary brand accent. |
| `--dsw-alias-label-primary` | Primary text color. |
| `--dsw-alias-label-secondary` | Secondary text color. |
| `--dsw-alias-state-error-primary` | Primary error state color. |
| `--dsw-alias-state-idle-primary` | Primary inactive state color. |
| `--dsw-alias-state-success-primary` | Primary success state color. |
| `--dsw-alias-state-warn-primary` | Primary warning state color. |
| `--dsw-specific-sidebar-fill` | Sidebar column and title-row background. |

`exportInspectTokens()`（`:1397-1400`）以这张表为基底，再补上注册主题/override 层里新出现的 token——所以这张表就是**「宿主已知的、会被主题检查器展示的 token 集合」**。

**未找到额外的「插件只许用这些」成文禁令** → 见 `## 不确定项`。

### Q6.4 插件如何改 token：`ctx.theme.overrideTokens(source, tokens)`

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/types/client/index.d.ts:27-41`：

```ts
export type ThemeTokens = Record<string, string>;
…
export interface ThemeTokenModes {
    light: string;
    dark: string;
}
export type ThemeTokenOverrides = Record<string, ThemeTokenModes>;
```

`:178` `overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void`。**每个 token 必须同时给 `light` 和 `dark`**；给裸字符串会抛教学错，逐字（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1543`）：

```js
					throw new TypeError(`theme override "${name}" from "${source}" is a bare string — pass { light: ${JSON.stringify(value)}, dark: ${JSON.stringify(value)} } (repeat the value when it is the same in both palettes); a single value goes illegible when the user switches color scheme`);
```

（`:178` 的 doc 另注：“逐 token 分层叠加，同 source 重调 = 整层替换并置顶”。）

---

## Q7. 图标 / 内联 SVG

两种已被验证的形态。

### Q7.1 内联 SVG + `dangerouslySetInnerHTML`（构建期把 `icon.svg` 原文打进来）

`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:863-865`（构建产物，来自 tsdown 的 `?raw` 通道）：

```js
	//#region icon.svg?raw
	var icon_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" …>…</svg>\n";
```

同文件 `:882-897` 逐字（**完整示例**）：

```js
	/** Everything between the file's `<svg>` tags: the sheet's strokes in paint order, whitespace-folded. */
	const SHEET_MARKUP = icon_default.slice(icon_default.indexOf(">") + 1, icon_default.lastIndexOf("</svg>")).trim().replace(/>\s+</g, "><");
	/** The mono seat's strokes: same geometry, every palette fill traded for the surrounding text colour. */
	const SHEET_MARKUP_MONO = SHEET_MARKUP.replace(/fill="#[0-9A-Fa-f]{6}"/g, "fill=\"currentColor\"");
	/** The document sheet at the requested square edge — polychrome by default, text-coloured in `mono`. */
	function ContextIcon({ size = 20, className, mono = false }) {
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			width: size,
			height: size,
			viewBox: "0 0 1024 1024",
			className,
			"aria-hidden": "true",
			xmlns: "http://www.w3.org/2000/svg",
			dangerouslySetInnerHTML: { __html: mono ? SHEET_MARKUP_MONO : SHEET_MARKUP }
		});
	}
```

侧栏字形（**完整示例**，`:898-910`）：

```js
	/**
	* The sidebar panel-list glyph (`sidebar.panellist`): the emblem in `mono` at
	* the size the shell asks for, so the shell-owned row's hover/active colors
	* paint it like the shipped panel glyphs. The shell owns the row's label,
	* and the row's selected state its own styling, so — as on the shipped
	* glyphs — the owner props' `active` goes unread.
	*/
	function InsightPanelIcon({ size = 18 }) {
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextIcon, {
			size,
			mono: true
		});
	}
```

> 成文要点：**sidebar 拥有整行**（按钮、label、active 样式、点击选中面板），插件只贡献**字形 + 本地化 label thunk**；因此 `active` 用不上，`mono: true` 让字形跟随 `currentColor`。

### Q7.2 纯描边 SVG（`stroke="currentColor"` + `size`）

`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1796-1814` 逐字：

```js
	/** 新版 DSH 会渲染整行按钮；插件只提供随 size/currentColor 变化的字形。 */
	function NativeSidebarIcon(props) {
		const size = Number.isFinite(props?.size) ? props.size : 16;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			viewBox: "0 0 16 16",
			width: size,
			height: size,
			fill: "none",
			stroke: "currentColor",
			"aria-hidden": "true",
			style: { display: "block" },
			children: [
				(0, react_jsx_runtime.jsx)("path", { d: "M6 2V4.5", strokeLinecap: "round" }),
				…
			]
		});
	}
```

> 该函数**不写任何 props 类型**，用 `props?.size` 兜底。因为 `sidebar.panellist` 的 owner props 就是 `{size, active}`，`size` 一定存在，但兜底更稳。

**两处共同点**：接 `size`（像素方边）、`aria-hidden="true"`、颜色一律走 `currentColor`（不写死调色板）。

---

## Q8. 错误边界

**存在 slot 级错误边界，且组件抛错不会清空整个主区域。**

实现与成文语义在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:601-641` 逐字：

```js
	/**
	* Per-entry isolation: one registrant crashing (component render or inject
	* factory) must not take down siblings. Assembly errors (missing providers)
	* rethrow — a miswired shell must fail loud, not degrade into fallbacks.
	* Every catch reports through `onEntryError` (the ledger's supervision
	* seam); for shadowing kinds the report abdicates the entry, the outlet
	* re-renders onto the cell's next survivor, and this boundary's crash face
	* only shows until that re-render lands (permanently once the cell is dry —
	* the outlet then owns the crash face).
	*/
	var SlotErrorBoundary = class extends react.Component {
		state = { failed: false };
		static getDerivedStateFromError(error) {
			if (error instanceof SlotAssemblyError) throw error;
			return { failed: true };
		}
		componentDidCatch(error) {
			console.error(`slot entry crashed in '${this.props.slotKey}':`, error);
			this.props.onEntryError(error);
		}
		render() {
			if (this.state.failed) return (0, react_jsx_runtime.jsx)("div", { "data-slot-error": this.props.slotKey });
			return this.props.children;
		}
	};
	/** Contain one Factory occurrence without retiring the shared definition. */
	var FactoryErrorBoundary = class extends react.Component { … render 返回 <div data-factory-error={this.props.name} /> … };
```

abdication 的接线在 `:1113-1118`：

```js
			const guarded = (entry, key, owner = ownerProps) => {
				const onEntryError = (error) => {
					host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== "chain" });
```

list 槽位的死格降级面在 `:1147` 与 `:1196`：

```js
			const deadCell = () => (0, react_jsx_runtime.jsx)("div", { "data-slot-error": slotKey });
```

```js
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: list.map((item, i) => item.entry !== void 0 ? guarded(item.entry, `e${entryKeyOf(item.entry)}`) : (0, react_jsx_runtime.jsx)("div", { "data-slot-error": slotKey }, `x${item.id ?? i}`)) });
```

root 出口的兜底在 `:1214-1223`：

```js
				if (host.entriesOf("root").length > 0) return (0, react_jsx_runtime.jsx)("div", { "data-slot-error": "root" });
```

（`reportEntryError` 的实现见 `:1631-1632`：`reportEntryError: (key, entry, error, info) => { this._core.reportEntryError(key, entry, error, info); }`；`onEntryError` 的公开订阅面在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.d.ts:181-192`。）

出口锚点在 `:1094-1104`（`SlotOutlet`）：`<div data-slot={slotKey} style={ANCHOR_STYLE}>…</div>`，`ANCHOR_STYLE = { display: "contents" }`（“keeps the wrapper out of layout … purely addressable surface”）。

**逐条结论**：
1. **有** slot 级错误边界（`SlotErrorBoundary`），粒度是**每个 entry**，不是一个 slot 整体。
2. 抛错时**不会**清空主区域：崩溃面是该 slot cell 内的 `<div data-slot-error="<slotKey>">`（空 div，`display: contents` 锚点保证不撑布局）；兄弟 entry 与框架其他区域（侧栏等）不受影响。
3. 对 shadowing kind（`single` / `keyed` / `list`，**`main` 属于 keyed**）发生崩溃时会**abdicate 该 entry**：出口重新投影到该 cell 的下一个幸存者；只有当 cell 空了，崩溃面才永久保留。
4. `SlotAssemblyError`（装配错误、缺 provider）**故意重抛**——成文理由「a miswired shell must fail loud, not degrade into fallbacks」，即这类错误**会**冒泡到宿主。
5. 崩溃会 `console.error("slot entry crashed in '<slotKey>':", error)`，并送进 `onEntryError` 监督通道。
6. `inject` 工厂抛错也走同一条通道（doc 逐字：“one registrant crashing (component render **or inject factory**) must not take down siblings”）。

**未验证**：真实浏览器里 `main` cell 只剩崩溃面时用户看到的视觉效果——只读侦察没有 DOM 快照可比对（见 `## 不确定项`）。

> 对照要点：错误边界只在 `dsh-client-ui-renderer` 的 client half 里；它是**框架装好的**，插件不需要自己包 ErrorBoundary。但**不要**在 slot 组件里把宿主的 `SlotAssemblyError` 吞掉——官方明确要求这类错误冒泡。

---

## Q9. 客户端半体的 `module.exports` 契约

### Q9.1 平台产出的精确包装

```js
window.__ModuleLoader__.load({
	id: "dsh-context",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		…
		return module.exports;
	}
});
```

以上是 `/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:1-2` 与 `:14309` 的实际骨架。更完整的可抄模板（`/data/dsh/profiles/web/node_modules/@weibaohui/skills-management/client/bundle.js:1-8` + `:2463-2466`，**手写单文件 bundle**）：

```js
/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@weibaohui/skills-management",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
```

```js
    return module.exports
  }
})
```

`dsh-context` 的作者注释（`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:14208-14214`）逐字：

```js
	// This module is the body of the package's `./client` bundle: tsdown
	// (tsdown.config.ts) bundles it (external `react` — the browser module table
	// supplies it via the injected `require`) into the web boot handoff
	// (`window.__ModuleLoader__.load({id, factory})`). All imports from other
	// client modules are inlined by the bundler; everything here is zero-runtime
	// beyond the bundled source.
```

**`id` 的取值规则**（运行时校验，`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:568-580`）：

```js
			/** Register one bundle factory, rejecting a script that executes twice without invalidation. */
			register(registration) {
				const ownerId = stripClientSuffix(registration.id);
				if (registration.chunk !== void 0 && !CLIENT_CHUNK.test(registration.chunk)) throw new Error(`client-modules: invalid package-local chunk ${JSON.stringify(registration.chunk)}`);
				const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
				if (this.bootstrapIds.has(id) || this.factories.has(id)) {
					const registrationName = registration.chunk === void 0 ? registration.id : id;
					throw new Error(`client-modules: duplicate factory registration for "${registrationName}" (bundle executed twice without invalidate?)`);
				}
```

配套：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:98-100`：

```js
function stripClientSuffix(spec) {
	return spec.endsWith("/client") ? spec.slice(0, -7) : spec;
}
```

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:169`：

```js
const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
```

即：**`id` 必须是包名（裸名或 `<pkg>/client` 两种写法等价）**；同一个 bundle 被执行两次（HMR 未 invalidate）会抛 `duplicate factory registration`。

### Q9.2 运行时 `require()` 能拿到什么——**只有 9 个 specifier**

宿主内联脚本**先**定义 `window.__ModuleLoader__`（mode: `"queue"`），再由 bootstrap 批次换成 `"live"`（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:453-475`，`bootInjections(graph)` 产出的内联字符串）：

```js
(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id==="@deepseek-ai/dsh-client-modules")
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: @deepseek-ai/dsh-client-modules/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()
```

**静态 module table（前端 bundle 里唯一定义它的地方）**，逐字取自 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js`：

```js
function rM(){return{react:Ef,"react/jsx-runtime":If,"react-dom":Rf,"react-dom/client":Df,"@deepseek-ai/cordis":sf,"@deepseek-ai/dsh-client-store":lh,"@deepseek-ai/dsh-client-ui-slots":hh,"@deepseek-ai/dsh-client-ui-primitives":sE,"@deepseek-ai/dsh-client-ui-dockkit":XS}}
```

**这 9 个就是全部**：

| specifier | 说明 |
|---|---|
| `react` | 唯一被广泛使用、且**唯一安全**的依赖 |
| `react/jsx-runtime` | `dsh-context` 在用；手写 `React.createElement` 可不用 |
| `react-dom` | `dsh-context` 在用（`require("react-dom")`） |
| `react-dom/client` | 可用 |
| `@deepseek-ai/cordis` | 可用（v4 的 `Service` 等） |
| `@deepseek-ai/dsh-client-store` | 可用 |
| `@deepseek-ai/dsh-client-ui-slots` | 可用 |
| `@deepseek-ai/dsh-client-ui-primitives` | **可选 peer**，`dsh-context` 在用 |
| `@deepseek-ai/dsh-client-ui-dockkit` | 可用 |

`require` 的解析实现在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:743-757`：

```js
				async import(specifier) {
					if (this.seed.has(specifier)) return this.seed.get(specifier);
					const id = stripClientSuffix(specifier);
					const existing = this.loadCache.get(id);
					if (existing !== void 0) return existing.exports;
					const row = this.graphRows.get(id);
					if (row === void 0) {
						if (this.factories.has(id)) return this.materialize(id).exports;
						throw new Error(`client-modules: cannot resolve "${specifier}" — not a seed word, not a materialized module, and not a row in the boot graph (the runtime mirror of the bundle purity gate)`);
					}
```

（`this.seed = new Map(Object.entries(options.staticModules))`，`:548`。）

**结论**：`require("别的东西")` 会在物化时抛 `cannot resolve … (the runtime mirror of the bundle purity gate)`。**单文件 bundle 只应 `require("react")`（最多再加 `react/jsx-runtime`）。**

### Q9.3 `package.json` 必需/常用字段

`dsh` 字段的权威类型是 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:76-89`：

```ts
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** … Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /** Exact module-table requests beyond the implicit client baseline, including subpaths such as `<pkg>/client`; absent means baseline externals only. */
    external?: string[];
}
```

同文件 `:15` 与 `:43-50`：`icon?: string`（“Base64 image data URL read from the manifest's icon file; render as an image, not inline markup”）。

**声明校验**（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:61-75`）逐字：

```js
function parseDshClient(pkgName, value) {
	if (value === void 0) return void 0;
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	const decl = value;
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
	const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return {
		platform: decl.platform,
		...inject !== void 0 ? { inject } : {},
		...external !== void 0 ? { external } : {},
		...decl.immediately !== void 0 ? { immediately: decl.immediately } : {}
	};
}
```

**只有 `platform === "web"` 的包会被扫描**（`lib/index.js:714-727`）：`if (decl === void 0 || decl.platform !== "web") { … return null }`；随后缺 `exports["./client"]` 抛 `client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`（:719）；导出形状错抛 `client-modules: ${pkgName} exports["./client"] must be a string or an object with a string default`（:171-180）。

**bundle 文件不存在**时抛 `MissingClientBundleError`（`lib/index.js:128-142`），逐字消息模板：

```js
		super([
			`client-modules: client bundle not found; ${CLIENT_BUNDLE_BUILD_INSTRUCTION}:`,
			`  package: ${packageName}`,
			`  path: ${clientPath}`
		].join("\n"), { cause });
```

其中 `:128`：

```js
const CLIENT_BUNDLE_BUILD_INSTRUCTION = "run \`pnpm run build\` before launch";
```

**真实示例**（`/data/dsh/profiles/web/node_modules/dsh-context/package.json` 相关字段，逐字）：

```json
  "type": "module",
  "icon": "icon.svg",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-sidebar-right"
      ]
    }
  },
  "files": ["icon.svg", "locale/*.json", "lib/client.js", "lib/index.js", "lib/index.d.ts", "cordis.patch.yml", "README.md", "LICENSE"]
```

**`dsh.client.inject` 是可选字段**：`dsh-context`、`@weibaohui/skills-management`、`billion-context` 都不写它；`@michengai/dsh-skills-manager` 写 `["@deepseek-ai/dsh-client-ui-slots","@deepseek-ai/dsh-client-locale"]`；`@xmanrui/dsh-im` 写 5 个。写了就列**包名**。其语义逐字在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/types/client/manifest.d.ts:40-63`：

```ts
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch. `inject` names package rows whose
 * factories must arrive before this row materializes, while Cordis separately
 * uses the same package edges to compose entries. `external` carries exact
 * non-inject module requests (see {@link WebBootGraph.entries}).
 */
export interface WebBootEntry {
    /** Entry name == package name. */
    id: string;
    …
    /** Package-name dependency edges used for factory arrival and plugin composition. */
    inject?: string[];
    /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
    immediately?: boolean;
    /** Non-baseline module specifiers this row requests; omitted when it requests none. */
    external?: string[];
}
```

`external` 的图排序规则（`dsh-client-modules/lib/index.js:405-437`）doc 逐字：**“An `external` specifier is either the package row it names (`<pkg>/client` aliases the bare package) **or a static-table name that adds no graph edge**.”**；自引用抛 `client-modules: "${entry.id}" requests module "${name}" that it answers itself — a row must not declare its own package in dsh.client.external`（:428）；成环抛 `client-modules: module graph cycle … — a requested package row must precede its consumers, and factory-form CJS cannot deliver partial exports`（:424）。

### Q9.4 `immediately` 的语义

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:81` 逐字：“Boot phase-one registration barrier; absent means the shared application batch.”

运行时语义在 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/types/client/manifest.d.ts:43,60-61`：“`immediately` marks **stage-one prefetch**… load the script for factory registration during module-face boot.”

前端消费（同一个压缩 bundle `index-5SrrfWpU.js` 内）：

```js
    async prefetchImmediateTier(){ await Promise.all(this.manifest.plugins.filter(e=>e.immediately).map(e=>e.modules.prefetch(e.id).catch(n=>{}))) }
```

**`dsh-context` 没有 `immediately`；核心包（`dsh-client-locale`、`dsh-client-ui-theme`、`dsh-client-hmr`、`dsh-client-modules`）都写了 `"immediately": true`。**

---

## Q10. 会让单文件、零依赖（仅 react）客户端 bundle 崩掉的坑

### Q10.1 构建期必须做的变换

1. **外层必须包 `window.__ModuleLoader__.load({ id, factory })`**。裸 ES module 或 IIFE 不会被认领；`id` 必须是包名。未注册时的错误逐字（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js:625,739`）：

   ```
   `${url}: loaded without registering "${id}" via __ModuleLoader__.load`
   ```

   最终形态（`:640`）：`client-modules: could not load "${id}": ${failures.join("; ")}`。

2. **`react`（以及 `react/jsx-runtime`、`react-dom`）必须 external**：不能把 React 打进 bundle，否则会拿到**第二份 React 实例**（hooks 直接崩）。构建脚本里要写 `external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"]`，并把 `import` 转成 `require(...)`。

3. **CommonJS 输出**：`factory(require)` 拿到的 `require` 是**异步物化**的实现（`async import(specifier)`，`lib/client.js:743`），但 bundle 里的调用形式是同步 CJS `require("react")`（`react` 在 seed 里，同步命中）。第三方 bundle 一律产出 CJS。
   - `@weibaohui/skills-management` 的手写 bundle 完全不用 jsx-runtime（`grep -c jsx-runtime` = 0），改用 `React.createElement` —— **这是「零构建工具」路线的最省事形态**。
   - `dsh-context` 用 tsdown 的 JSX 自动运行时，`require("react/jsx-runtime")`。

4. **`?raw` / 内联资源必须构建期解决**：`dsh-context` 用 tsdown 的 `?raw` 把 `icon.svg` 变成字符串常量（`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:863-865`）。运行时**没有** fetch/URL 通道（`exports["./locale/*.json"]` 也不给客户端用，见 Q4.4）。手写方案里就直接把 SVG 源码字符串拷进源文件。

5. **CSS 也必须内联**：`dsh-context` 在工厂闭包里 `document.createElement("style")` 挂 `data-plugin` / `data-pluginCss`（`lib/client.js:14184-14188`）。**惰性 CJS 语义**（`manifest.d.ts:9-16` doc 逐字）：“executing a plugin bundle only REGISTERS its factory”; every module body side effect — including CSS injection — lives inside the factory closure and runs at materialization, not at script execution.”

### Q10.2 期望的导出名

`module.exports = { name, inject, apply }`（`/data/dsh/profiles/web/node_modules/dsh-context/lib/client.js:14303-14307`）：

```js
	module.exports = {
		name: "dsh-context",
		inject: ["slots", "locale"],
		apply
	};
```

- `name`：**必须等于包名**（诊断/注册表用）。
- `inject`：**cordis 服务名数组**（不是包名！包名数组属于 `package.json` 的 `dsh.client.inject`——**两处同名不同物，极易混淆**）。
- `apply(ctx)`：同步或返回 Promise 都可。

### Q10.3 `immediately` 标志

**单文件插件通常不写**。`immediately: true` 只表示「stage-one 预取」，用于核心包（`dsh-client-modules` 必须最早就位，所以它写）。写了会进 `prefetchImmediateTier`，**对功能正确性没有影响**，只影响启动时序。若你的客户端 half 需要在应用批之前就注册 factory，才写它。校验是 `typeof === "boolean"`，写错会抛错（Q9.3）。

### Q10.4 热重载（HMR）

- HMR 由 `@deepseek-ai/dsh-client-hmr`（`package.json` 的 `dsh.client = { inject:["@deepseek-ai/dsh-client-modules"], platform:"web", immediately:true }`）驱动。
- **同一个 bundle 被执行两次而没有被 invalidate，会抛**（`lib/client.js:573-576`）：

  ```
  client-modules: duplicate factory registration for "<id>" (bundle executed twice without invalidate?)
  ```

- 发行版/手工测试时**不会**触发（脚本只插入一次）。但如果你在宿主里手动 re-inject 同一个 `index.js`，就会看到这条错误——**它不是你代码的 bug**。
- `registration.chunk` 仅用于拆分分片（`client.<name>.js`），单文件插件**不要**写它。

### Q10.5 清单：最省事的「单文件 + 仅 react」路线

| 项 | 值 |
|---|---|
| 产物路径 | 与 `package.json` 的 `exports["./client"]` 一致（例如 `./lib/client.js`） |
| 外层 | `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" }); … return module.exports; } })` |
| 依赖 | `const React = require("react")`（可选 `react/jsx-runtime`）；**不要** require 其它任何东西 |
| JSX | 用 `React.createElement` 免去构建期 JSX 变换（skills-management 证明可行） |
| 导出 | `module.exports = { name: "<包名>", inject: ["slots","locale"], apply }` |
| `package.json` | `"type": "module"`、`"icon": "icon.svg"`、`exports["./client"]`、`dsh.client = { platform: "web" }`（`inject`/`external`/`immediately` 都可省） |
| 本地构建脚本 | `node scripts/build-client.mjs`（本仓库 `package.json` 已经这么声明，但**`scripts/` 目录尚不存在**，见附录） |

**会崩的具体情形**（逐条）：
- 忘了 `window.__ModuleLoader__.load` 外层 → `loaded without registering "<id>" via __ModuleLoader__.load`。
- `id` 写成别的东西（不是包名）→ 宿主按包名找不到 → `could not load`。
- `require` 了不在 9 项静态表里的包 → `cannot resolve "<spec>" — not a seed word, not a materialized module, and not a row in the boot graph`。
- 把 React 打进 bundle → 双份 React，hooks 崩（**运行时错误，不是启动错误**）。
- 静态 `inject` 里列了不存在的服务 → 插件**永不激活**，`apply` 根本不跑，且很难定位（见 Q3.4）。
- 向注册选项传了常量数组之外的字段（如把 `label` 写成对象 `{zh, en}`）→ `SlotLabel` 只接受 `string | (() => string)`；运行时 label 会渲染成 `[object Object]` 或被当作字符串处理（**未验证确切失败模式**，见 `## 不确定项`）。

---

## 附录：与本仓库 `easel-workbench` 的现状对照

被侦察的仓库：`/data/dsh/home/dsh-hub/Easel/dsh-plugins/easel-workbench/`。

**现状**（`/data/dsh/home/dsh-hub/Easel/dsh-plugins/easel-workbench/package.json` 相关字段逐字）：

```json
  "icon": "icon.svg",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "scripts": {
    "build": "node scripts/build-client.mjs",
    "test": "node --test test/*.test.mjs",
    "check": "node scripts/build-client.mjs --check && node --test test/*.test.mjs"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  }
```

**已有**：`icon.svg`、`locale/{en.json,zh-CN.json}`、`assets/{persona.md,rules.md}`、`index.js`、`lib/host/`、`cordis.patch.yml`、`test/*.test.mjs`、`docs/{recon-client-remote.md,recon-data.md,recon-scripts.md}`。

**缺口**（按本侦察的契约）：
1. **`scripts/build-client.mjs` 不存在**（顶层没有 `scripts/` 目录），但 `package.json` 的 `build`/`check` 都指向它。
2. **`lib/client.js` 不存在**，而 `exports["./client"]` 已指向它 → 按 `Q9.3`，宿主会因 `platform === "web"` 而扫描本包，然后抛 `MissingClientBundleError`（消息含 `run \`pnpm run build\` before launch`）。
3. **`dsh.client.inject` 未写**：按 Q3.4 与 Q9.3，这是**推荐**形态（不写 ⇒ 不因可选服务缺失而卡住激活），但客户端 half 里必须改用 `ctx.inject([...], cb)` / `ctx.get(name)` 拿 `layout`/`uiWorkspace`/`theme`。
4. **`locale/zh-CN.json` 的 id 与客户端字典不一致**：客户端字典必须用 `zh`/`en`（Q4.1）；`locale/*.json` 只服务宿主展示元数据（Q4.4）。

---

## 不确定项

以下条目**未验证**，不做推断：

1. **`label` 传非法形状（如 `{zh, en}` 对象）时的确切运行时行为**。类型只允许 `string | (() => string)`；`SidebarPanelMetadata.label` 是 `string`（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:107`）；但**没有**找到运行时对该值做 typeof 校验或抛错的代码。是否静默渲染成 `[object Object]`、是否 toString、是否崩——未验证。
2. **`main` cell 全部崩溃时用户看到的真实视觉**。代码路径清楚（`data-slot-error` 空 div → 出口保留崩溃面，`dsh-client-ui-renderer/lib/client.js:1147,1214-1223`），但**没有浏览器 DOM 快照**，无法确认「主区域会变成空白」这一具体说法。
3. **`SlotAssemblyError` 冒泡后在宿主 UI 上的表现**（是否整页白屏、是否有全局错误页）。只验证了它会 rethrow（`registry` 的 doc 与 `dsh-client-ui-renderer/lib/client.js:613-616`），宿主上层如何处理未读。
4. **是否存在「插件只许使用 `BUILTIN_INSPECT_TOKENS` 里 14 个 token」的成文规则**。未在 DSH 源码或文档中找到禁令；只找到那 14 项作为 `exportInspectTokens()` 的基底。**未找到** ≠ 允许，但没有证据。
5. **`--dsw-alias-brand-primary-new-colorprimary-new-color`** 这个畸形 token 名（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1148` 内）的成因（疑似上游字符串拼接 bug）与是否有意为之——未验证。
6. **`dsh-client-ui-primitives` 与 `dsh-client-ui-dockkit` 的可用导出面**。它们确实在静态 module table 里（`rM()`），但本次未侦察其 `.d.ts`，无法给出可安全使用的组件清单。
7. **`ctx.theme.register(definition)` 注册整套主题**的完整字段语义（`ThemeDefinition.tokens` 的键是否必须落在 `--dsw-alias-*` 命名空间）——只读到类型声明（`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/types/client/index.d.ts:43-53`），未读 `register` 的运行时校验。
8. **`dsh.client.external` 在纯 react-only 单文件插件上的必要用法**。理论上单文件插件不需要它（`react` 在静态表里，plugin 的 `baseline externals` 已含），但**没有**找到「baseline externals 具体包含哪些 specifier」的成文清单，因此「不写 `external` 就一定能解析 `react`」只由第三方插件的实践间接支持（`dsh-context` / skills-management 都没写 `external` 却都能 `require("react")`）。
9. **`immediately: true` 对单文件插件的实际收益**（是否只影响首屏时序、是否会改变 `apply` 时机）——只读到「stage-one prefetch」的措辞，未读前端 `prefetchImmediateTier` 之外的全部调用链。
10. **宿主是否会拒绝对 `main` 槽位已注册 key 之外的 `sidebar.panellist` id 的选中**。`dsh-mcp-connector` 的中文注释（`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/client.js:1896`）与 `ILayout.selectPanel` 的 `@throws` doc（`.../dsh-client-ui-layout/lib/types/client/service.d.ts:30`）都指向「会 throw / 会拒绝」，但**没有**定位到那条判定代码，也没读到抛出后侧栏行的视觉表现。
