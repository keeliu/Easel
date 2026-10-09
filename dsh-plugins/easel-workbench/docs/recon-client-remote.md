# Recon: Host↔Client Remote contract, ToolDefinition shape, `ctx.tools.guard()`

Read-only reconnaissance inside the DSH 0.2.0-rc.2 installation at `/usr/local/lib/node_modules/@deepseek-ai/dsh/` and the live profile at `/data/dsh/profiles/web/`. Every claim below is quoted verbatim from the cited absolute path and line range.

---

## Q1. Remote service contract between a plugin's HOST half and its CLIENT half

### Q1.0 The carrier is the Typert protocol (not a bespoke `remote` plugin API)

The "remote" data plane is the **Typert** protocol, split across five core packages:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-typert-protocol` | the wire/host contracts, `Remote` / `RemoteScope` decorators, `TypertRemoteService`, `bindTypertRemote`, `RemoteResult`, `RemoteError` |
| `@deepseek-ai/dsh-typert-registry` | the runtime registry exposed as the `typert` Cordis service |
| `@deepseek-ai/dsh-typert-loader` | auto-discovers each mounted plugin's `./typert` export and registers its `TYPERT` manifest |
| `@deepseek-ai/dsh-api-gateway` | the **client** face: declares `ctx.remote` and owns the physical stream mux |
| `@deepseek-ai/dsh-api-remotes` | forwards selected Host events to the client remote |

Proof that `dsh-api-remotes` (the "remote events" package) is a Typert citizen — `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-remotes/lib/types/types.d.ts`:

```ts
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]['event'];

declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
```

### Q1.1 The `.d.ts` definition of the client-side `remote` service

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/types/client/index.d.ts`

Header (lines 1-5):

```ts
/**
 * Client projection of generated Typert Remote descriptors. Contributions
 * install traced `remote.<namespace>` services; no JavaScript Proxy
 * participates in method lookup, invocation, or type exposure.
 */
```

The `remote` service itself (lines 17-44):

```ts
/** Typed Remote service augmented by generated direct namespaces and Gateway stream supervision. */
export interface ClientRemote extends TypertClientRemote {
    /**
     * Create one independently cancellable, reconnecting logical stream.
     * @param options - domain-owned opener and generation-end classification.
     * @returns a single-consumer stream annotated with physical generation ids.
     */
    $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item>;
    /**
     * Fixed Host facts as plain reads: no store, no subscription, no generation
     * counter. `home` stays undefined until the first ready frame and reflects
     * the latest one afterwards.
     */
    readonly $host: RemoteHostFacts;
}
/** The fixed Host facts exposed on `ctx.remote.$host`. */
export interface RemoteHostFacts {
    /** Host home directory from the ready frame, undefined before it. */
    readonly home: string | undefined;
    /** Whether the carrier connects to the local Host. */
    readonly isLoopback: boolean;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Generated Remote namespaces selected by the Client assembly. */
        remote: ClientRemote;
    }
}
/** Required Client services: the Typert registry and the existing Connection carrier. */
export declare const inject: string[];
```

Its `package.json` (verified via `node -e`), `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/package.json`:

```json
"exports": { ".": {…}, "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }, … },
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-typert-registry", "@deepseek-ai/dsh-client-connection"], "platform": "web", "immediately": true } }
```

The client remote namespace map, `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts:351-368`:

```ts
export interface TypertClientRemote extends TypertRemoteNamespaceMap {
    $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>;
    $on<Event extends TypertRemoteEvent>(event: Event, listener: TypertClientEventListener<Event>): () => void;
}
```

```ts
export interface TypertRemoteContribution {
    readonly package: string;
    readonly descriptors: readonly InvocationDescriptor[];
}
```

and the namespace-projection helper (endpoint key format `<namespace>/<method>`):

```ts
export type TypertRemoteNamespace<Namespace extends string> = {
    [Endpoint in keyof TypertRemoteMap as Endpoint extends `${Namespace}/${infer Method}` ? Method : never]: TypertRemoteMap[Endpoint]
};
```

The result envelope every remote call resolves to, same file (lines 67-73):

```ts
export type RemoteResult<T> =
    | { readonly ok: true; readonly value: T; }
    | { readonly ok: false; readonly error: RemoteFailure };
```

The canonical endpoint key: `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-registry/lib/types/service.d.ts:30`

```ts
export declare function typertEndpoint(descriptor: Pick<InvocationDescriptor, 'namespace' | 'method'>): string;
```
doc: *"Compose the endpoint key used by local and Remote invocation registries. @returns `<namespace>/<method>`."*

Registry contract, `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts:466-486`:

```ts
export interface TypertRemoteRegistry {
    /**
     * Register one generated contribution for the calling Cordis fiber.
     * @param contribution - generated Remote descriptors.
     * @returns disposer withdrawing the exact contribution.
     */
    register(contribution: TypertRemoteContribution): TypertDisposer;
    /**
     * Look up one Remote descriptor by endpoint.
     * @param endpoint - canonical endpoint.
     * @returns the descriptor, or `undefined` when unmounted.
     */
    get(endpoint: string): InvocationDescriptor | undefined;
    /** @returns a registration-order snapshot of Remote descriptors. */
    list(): readonly InvocationDescriptor[];
    /**
     * Observe later Remote contribution changes.
     * @param listener - synchronous contained observer.
     * @returns disposer for this subscription.
     */
    subscribe(listener: TypertRegistryListener): TypertDisposer;
}
```

### Q1.2 Host-side declaration — three concrete, working forms

There is **no single mandatory decorator**. Three host-side forms are in production use:

#### Form A — `class extends TypertRemoteService` + `Remote` decorators (and, in plain JS, the manual `Remote(exportName)(method, ctx)` application)

The decorator declarations, `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/index.d.ts:64-102`:

```ts
// line 64
export declare function bindTypertRemote<Service extends object>(service: Service, serviceKey: string, options?: TypertGatewayBindingOptions): TypertGatewayBinding<Service>;

// lines 66-76
export declare abstract class TypertRemoteService<out T = never> extends Service<T> {
    readonly typertRemote: TypertGatewayBinding<this>;
    protected constructor(ctx: Context, serviceKey: string, options?: TypertGatewayBindingOptions);

// line 82
export declare function Remote<This extends object, Args extends unknown[], Result>(_method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>): void;

// line 88
export declare function Remote(option: string | RemoteMethodOptions): RemoteMethodDecorator;
```

with the option types verbatim (same file, lines 20-30 and 47-51):

```ts
/** Options for an explicit Service-to-Gateway binding. */
export interface TypertGatewayBindingOptions {
    /** Wire namespace; defaults to the Cordis service key. */
    readonly namespace?: string;
}
/** Visible declaration that one Service participates in Typert Gateway export. */
export interface TypertGatewayBinding<Service extends object = object> {
    readonly service: Service;
    readonly serviceKey: string;
    readonly namespace: string;
}
…
/** Options for a non-unary Remote method. */
export interface RemoteMethodOptions {
    /** `stream`: deliver each Iterable item over the shared logical-stream carrier. */
    readonly mode: 'stream';
}
```

Also declared there: `export declare function RemoteScope(key: Extract<keyof TypertContextMap, string>, exportName?: string): RemoteMethodDecorator;` (line 95) and `export declare function remoteMethods(service: object): readonly RemoteMethodMarker[];` (line 102).

Real usage, `/data/dsh/profiles/web/node_modules/deepseek-flow/lib/index.js`:

```js
// line 19
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
```

```js
// lines 231-233
// Remote 服务（namespace: dflow）

// lines 235-250
function registerRemoteMethods(service, methods) {
  for (const [implementation, exportName] of methods) {
    const method = service[implementation];
    if (typeof method !== "function") throw new Error(`Remote implementation ${implementation} is not callable`);
    const initializers = [];
    Remote(exportName)(method, {
      name: implementation,
      private: false,
      static: false,
      addInitializer: (initializer) => {
        initializers.push(initializer);
      }
    });
    for (const initializer of initializers) initializer.call(service);
  }
}

// line 252
class DeepSeekFlowRemoteService extends TypertRemoteService {
  // lines 253-255
  constructor(ctx, host) {
    super(ctx, "deepseekFlow", { namespace: "dflow" });
    this.host = host;

// lines 256-272
    registerRemoteMethods(this, [
      ["list", "list"], ["allFlows", "allFlows"], ["activate", "activate"], ["get", "get"],
      ["create", "create"], ["put", "put"], ["delete", "delete"], ["revisions", "revisions"],
      ["draftSave", "draftSave"], ["draftGet", "draftGet"], ["draftClear", "draftClear"],
      ["assist", "assist"], ["topologyApply", "topologyApply"], ["finalizePending", "finalizePending"],
      ["topologyFinalize", "topologyFinalize"], ["assistCancel", "assistCancel"],
      ["assistHistory", "assistHistory"], ["models", "models"]
    ]);
```

and registration is just construction inside the plugin `apply`, `/data/dsh/profiles/web/node_modules/deepseek-flow/lib/index.js:966, 1038`:

```js
export async function apply(ctx, config) { … }
    new DeepSeekFlowRemoteService(ctx, host);
```

#### Form B — `bindTypertRemote(service, serviceKey)` on an existing service

`/data/dsh/profiles/web/node_modules/@michengai/dsh-archive-manager/lib/workspace.js`:

```js
// line 9
import { bindTypertRemote, Remote } from "@deepseek-ai/dsh-typert-protocol";
```

```js
// line 78
Remote(method)(function() {
```

```js
// line 327
var ArchiveWorkspaceRegistry = class extends WorkspaceRegistry {
  static inject = [
    "storageDomain",
    "sessionPersistence",
    "sessionProjectionCache",
    "typert"
  ];
```

```js
  // lines 344-351
  constructor(ctx) {
    super(ctx);
    tolerateStaleFileUploadResolver(ctx);
    protectArchivedSessionPath(this);
    this.typertRemote = bindTypertRemote(this, this.name);
    for (const method of ARCHIVE_REMOTE_METHODS) markRemoteMethod(this, method);
    registerHostRemote(this.ctx);
  }
```

`WorkspaceRegistry` is imported from core (`lib/workspace.js:8`):

```js
import { WorkspaceRegistry } from "@deepseek-ai/dsh-workspace";
```

so `this.name === "workspaceRegistry"` — and the hand-written invocation descriptors (lines 168-171, 189-191, 210-212, 231-233) confirm the wire namespace matches:

```js
    namespace: "workspaceRegistry",
```

The plugin's host plugin (`/data/dsh/profiles/web/node_modules/@michengai/dsh-archive-manager/lib/host-install.js:3`) declares the Cordis services it needs — note it injects `typert`:

```js
const inject = ["workspaceRegistry", "sessionProjectionCache", "typert"];
```

#### Form C — hand-written `./typert` manifest (no decorators at all)

`/data/dsh/profiles/web/node_modules/dsh-cost-meter/package.json` exposes the manifest as the `./typert` subpath:

```json
"type": "module",
"main": "lib/index.js",
"exports": {
  ".": "./lib/index.js",
  "./client": "./lib/client.js",
  "./typert": "./lib/typert.host.js",
  "./package.json": "./package.json",
  "./locale/*.json": "./locale/*.json"
},
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web" },
  "compatibility": { "dsh": ">=0.1.0-rc.5", "dshReleases": { "0.2.0-rc.2": "compatible" } }
}
```

`/data/dsh/profiles/web/node_modules/dsh-cost-meter/lib/typert.host.js` header (lines 1-5) states the contract verbatim:

```
dsh-cost-meter 的 Host 面 Typert 清单(由 typert-loader 自动扫描注册)。手写清单,结构与
@deepseek-ai/dsh-typert-generator 产物一致: `./typert` 导出 TYPERT;strict codec 同时提供
旧宿主的 schema 和新宿主的 create()。
```

```js
// line 551
const strictCodec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema })

// lines 572-… (abridged shape)
export const TYPERT = {
  package: 'dsh-cost-meter',
  face: 'host',
  schemas: [],
  invocations: [
    { id: 'dsh-cost-meter#costMeter/getState', service: 'costMeter', namespace: 'costMeter', method: 'getState',
      invocation: { kind: 'direct' }, parameters: [], result: _state$codec },
    …
  ],
  model: { services: [ { key: 'costMeter', exportName: 'CostMeterService', members: [ … ], types: [] } ], events: [], objects: [] }
}
export default TYPERT
```

Parameter descriptor + optional-argument rule, same file:

```js
parameters: [ { name: 'patch', wire: 'patch', source: 'json', codec: _patch$codec } ]
```

and the header comment explaining `acceptsUndefined` (lines 631-635):

```
acceptsUndefined(v1.7.1):网关按「期望 wire 字段是否在 args 中」判缺失——无此标志的 json 参数缺省
会以 arguments-invalid 拒绝调用…codec 必须是 strict 对象(裸 zod schema 会被 typert-loader 以
「parameter codec must use a strict codec」拒绝注册…)
```

The manifest is auto-discovered, `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-loader/lib/types/index.d.ts:1-35`:

```ts
/**
 * Typert Loader integration: automatic registration for mounted plugin packages.
 *
 * When a loader entry mounts, this plugin resolves the entry's package.json; a
 * package exporting `./typert` has its host face imported and its
 * `TYPERT` manifest registered into `ctx.typert`, and the registration is
 * withdrawn when the entry unmounts. Explicit `packages` cover plugins nested
 * behind another Loader entry, whose Cordis fibers carry no resolvable package
 * specifier. Packages without the export are skipped silently when discovered
 * from Loader entries; an explicit package or declared artifact that is broken
 * fails loud — aggregated into this plugin's activation throw for existing
 * entries, contained to a logged error per package in steady state.
 *
 * Scanning is incremental per entry name. Every cordis `internal/plugin`
 * emission marks the fiber's entry name dirty, and a microtask flush
 * reconciles each dirty name against the live
 * loader entries; the activation pass seeds the same dirty set with all
 * current entries. Package verdicts and imported manifests are cached per
 * package name and never expire — plugin-set changes take effect on restart.
 *
 * Manual `ctx.typert.register()` remains available for contributions
 * that do not use a `./typert` artifact (hand-written wire schemas,
 * tests, non-loader compositions).
 *
 * @module @deepseek-ai/dsh-typert-loader
 */
…
/** The package.json exports key naming a package's host-face typert artifact. */
export declare const TYPERT_HOST_EXPORT = "./typert";
```

Cost-meter also binds reflectively in its own host entry, `/data/dsh/profiles/web/node_modules/dsh-cost-meter/lib/index.js:2648`:

```js
Object.defineProperty(service, 'typertRemote', {
```

### Q1.3 How the namespace is derived

Answer: **an explicit string, defaulting to the Cordis service key — never the class name.**

The implementation states it in one line — `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js:146-148`:

```js
function bindTypertRemote(service, serviceKey, options = {}) {
	validateName("service key", serviceKey);
	const namespace = options.namespace ?? serviceKey;
```

and `TypertRemoteService`'s constructor is `super(ctx, serviceKey); this.typertRemote = bindTypertRemote(this, this.name, options);` (same file, lines 168-171).

- `TypertRemoteService` ctor parameter is documented as *"exact Cordis service key and default wire namespace"*; `TypertGatewayBindingOptions.namespace` is documented *"Wire namespace; defaults to the Cordis service key."* (`…/dsh-typert-protocol/lib/types/index.d.ts:64-102`, quoted above).
- `deepseek-flow` passes service key `"deepseekFlow"` and **overrides** the namespace to `"dflow"`:
  ```js
  super(ctx, "deepseekFlow", { namespace: "dflow" });
  ```
- `archive-manager` passes `this.name` → `"workspaceRegistry"`, and its descriptors repeat `namespace: "workspaceRegistry"`.
- `dsh-cost-meter` declares `service: 'costMeter', namespace: 'costMeter'` explicitly in each invocation entry.
- The wire endpoint is the composition: `` `${namespace}/${method}` `` — e.g. `dflow/list`, `workspaceRegistry/deleteSession`, `costMeter/getState`.
- The **client-side Cordis service key** is `remote.<namespace>` — e.g. `remote.dflow`, `remote.workspaceRegistry`, `remote.costMeter`.

### Q1.4 What the host must declare in `package.json`

`package.json.dsh` is documented by the core manifest types, `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:28-89`:

```ts
/** Public author fields under `package.json.dsh`; a package may declare several roles. */
export interface DshManifest {
    /** Manifest format version, independent of the npm package and Session format versions. */
    manifestVersion?: 1;
    /** Bundle metadata consumed by the profile launcher. */
    bundle?: DshBundleManifest;
    /** Profile metadata consumed by the profile launcher. */
    profile?: DshProfileManifest;
    /** Client module loading and build metadata. */
    client?: DshClientManifest;
}
…
/** Client module declaration read by client-modules and the client build. */
export interface DshClientManifest {
    /** Client platform identifier; the Web consumer selects `web`. */
    platform: string;
    /** Informational package-name dependencies, not Cordis service injection. */
    inject?: string[];
    /** Boot phase-one registration barrier; absent means the shared application batch. */
    immediately?: boolean;
    /**
     * Exact module-table requests beyond the implicit client baseline, including
     * subpaths such as `<pkg>/client`; absent means baseline externals only.
     * Type-only imports are erased and create no module request.
     */
    external?: string[];
}
```

**Critically: `dsh.client.inject` lists client-plugin PACKAGE names to compose — it is NOT Cordis service injection and it does NOT carry remote namespaces.** The doc comment on the field says so explicitly: *"Informational package-name dependencies, not Cordis service injection."*

Real examples:

- `/data/dsh/profiles/web/node_modules/@michengai/dsh-archive-manager/package.json`
  ```json
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-workspace","@deepseek-ai/dsh-typert-registry","@deepseek-ai/dsh-client-connection"],
      "platform": "web"
    }
  }
  ```
- `/data/dsh/profiles/web/node_modules/dsh-mcp-connector/package.json`
  ```json
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "inject": ["@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-conversation"], "platform": "web" } }
  ```
- `/data/dsh/profiles/web/node_modules/dsh-cost-meter/package.json`: `"client": { "platform": "web" }` — **no `inject` array at all**, yet it has a working remote service. This is the decisive counter-example: `dsh.client.inject` is not required to expose a remote namespace.

What the package **must** do instead:

1. Export a client entry, conventionally `"./client"` (e.g. `"./client": "./lib/client.js"` in cost-meter / archive-manager / mcp-connector exports).
2. Declare `dsh.client.platform` (e.g. `"web"`).
3. On the host, **make the Service's Typert binding visible to the Gateway**. `bindTypertRemote` / `TypertRemoteService` do this by attaching a `typertRemote` field — the implementation never looks a service up (`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js:146-157`):

```js
function bindTypertRemote(service, serviceKey, options = {}) {
	validateName("service key", serviceKey);
	const namespace = options.namespace ?? serviceKey;
	validateName("namespace", namespace);
	const ctx = Reflect.get(service, "ctx");
	if (ctx instanceof Context) provideInvocationAccessor(ctx);
	return Object.freeze({
		service,
		serviceKey,
		namespace
	});
}
```

   The comment on `TypertRemoteService.typertRemote` states its purpose: *"Visible binding consumed by the Gateway's source-mode discovery."*

4. **Only if** the host registers descriptor contributions itself (rather than relying on decorators or a `./typert` manifest) does it need the `typert` registry service. `archive-manager` does exactly this — and only this path throws when the service is absent (`/data/dsh/profiles/web/node_modules/@michengai/dsh-archive-manager/lib/workspace.js:252-268`):

```js
function registerHostRemote(ctx) {
  const existing = ctx.get("typert");
  if (existing !== void 0) {
    existing.register(ARCHIVE_MANAGER_TYPERT);
    return;
  }
  ctx.inject(["typert"], (typertCtx) => {
    typertCtx.typert.register(ARCHIVE_MANAGER_TYPERT);
  });
}
function bindArchiveManagerRemote(ctx) {
  const typert = ctx.get("typert");
  if (typert === void 0 || typeof typert.register !== "function") {
    throw new Error("archive-manager: typert is unavailable");
  }
  try {
    const dispose = typert.register(ARCHIVE_MANAGER_TYPERT);
    return typeof dispose === "function" ? () => { dispose(); } : () => {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already registered")) throw error;
```

   This is also why `host-install.js:3` lists `"typert"` in its Cordis `inject`.

5. Alternatively, ship a `./typert` manifest and let `dsh-typert-loader` register it into `ctx.typert` automatically (Form C above).

   Note: `deepseek-flow` (Form A, decorators only) and `dsh-cost-meter` / `archive-manager` (which register descriptors explicitly) differ on this point — decorator-only plugins need no `typert` lookup at all.

### Q1.5 The exact client-side call path

#### (a) Injecting a namespace owned by the core/host composition — `ctx.inject(['remote', 'remote.<ns>'])`

`/data/dsh/profiles/web/node_modules/@weibaohui/skills-management/client/index.js:2220-2230` verbatim:

```js
// 0.1.5+: subpath inject `remote.skills` (just `remote` is not enough —
// cordis guards child paths against undeclared inject). Older cores fall
// back to `connection.api.skills`. Absence keeps the button's fallback
// to the host slash menu.
try {
  if (typeof ctx.inject === 'function') {
    ctx.inject(['remote', 'remote.skills'], (scope) => {
      remoteSkillsApi = scope && scope.remote && scope.remote.skills
    })
  }
} catch {}
```

So the invocation expression is **`scope.remote.<namespace>.<method>(args)`** — i.e. `remoteSkillsApi.list({ sessionId })`. Note the comment: injecting only `'remote'` is not enough; you must also name the child path `'remote.<namespace>'`, because Cordis guards undeclared child paths.

Unwrapping that call, `client/index.js:215-217`:

```js
if (remoteSkills && typeof remoteSkills.list === 'function') {
  const res = await remoteSkills.list({ sessionId })
  if (!res || res.ok !== true) throw new Error('remote.skills.list failed')
```

#### (b) A plugin mounting its **own** generated contribution — `ctx.get('remote')` → `$mount(...)` → `ctx.get('remote.<ns>')`

This is the pattern for a third-party plugin's own namespace, because the generated descriptors exist only in the client bundle.

`/data/dsh/profiles/web/node_modules/dsh-cost-meter/lib/client.js` (minified, single-file bundle):

```js
const eo=["remote"];                       // client plugin inject list
async function to(t){
  const s=t.remote;
  if(s===void 0||typeof s.$mount!="function")return;
  const o=await s.$mount(gn);              // mount this plugin's contribution literal
  t.effect(()=>()=>{o()},"cost-meter: remote contribution");
  const a=t.get("remote.costMeter");       // resolve the namespace service by Cordis key
  if(a===void 0)return;
  …
}
…
bt.inject=eo
```

The mounted contribution literal `gn` is a plain `TypertRemoteContribution` object embedded in the bundle:

```js
gn={package:"dsh-cost-meter",descriptors:[{method:"getState",result:ve("CostState",vt)},
    {method:"updateConfig",parameters:[ce("patch","ConfigPatch",rn)],result:ve("Cos…
```

A second, independent cost-meter client surface (`lib/client.statistics.js`) shows the same idiom with `ctx.get`:

```js
async function Lt(a){
  const l=await a.get("remote").$mount(kt);
  a.effect(()=>()=>l(),"cost-meter: statistics contribution");
  const c=a.get("remote.costMeter"),
  o=Object.fromEntries(["getBillingStatistics","getSessionBilling","getTurnInspection"].map(i=>[i,async n=>{
    const m=await c[i]((i==="getTurnInspection"?vt:yt)(n));
    if(!m?.ok)throw new Error(m?.error?.message||"Statistics request failed");
    return{getBillingStatistics:dt,getSessionBilling:mt,getTurnInspection:pt}[i](m.value)
  }]));
  return i=>t(Ot,{...i,api:o})
}
```

with its own contribution `kt`:

```js
kt={package:"dsh-cost-meter/statistics",descriptors:[["getBillingStatistics","BillingStatistics",dt],
    ["getSessionBilling","SessionBilling",mt],["getTurnInspection","TurnInspection",pt,vt]]
    .map(([a,l,c,o])=>({id:"dsh-cost-meter#costMeter/"+a,service:"costMeter",namespace:"costMeter",
    method:a,invocation:{kind:"direct"},parameters:[{name:"query",wire:"query",source:"json",
    codec:xt(o?"TurnInspectionQuery":"StatisticsQuery",o??yt)}],result…
```

The generic unwrapping helper in `dsh-cost-meter/lib/client.js`:

```js
r=async(C,Q)=>{const Z=await a[C](...Q??[]);
  if(Z===null||typeof Z!="object"||Z.ok!==!0)
    throw new Error(Z?.error?.message??i()("rpcFailed",{method:C}));
  return Z.value}
```

i.e. **client method invocation is positional spread: `service[methodName](...args)`** (no named-args object unless the host method takes one).

`/data/dsh/profiles/web/node_modules/@michengai/dsh-archive-manager/lib/client.js` (single minified bundle line) is a third full example — its exported client plugin inject list and mount function:

```js
dk=["slots","sessions","workspaces","locale","remote","typert"]
…
r.apply=uk,r.inject=dk

async function uk(N){
  mk(N);
  let z=N.get("remote"),Y=o(()=>{},"disposeRemote");
  return z!==void 0&&(Y=await z.$mount(k)),async()=>{await Y()}
}
```

and its namespace usage:

```js
Ye=e0(N.workspaces,()=>N.get("remote.workspaceRegistry"))
```

```js
tt=o(async(_e,...nt)=>{
  let Ot=N.get("remote.workspaceRegistry");
  if(!Ot||typeof Ot[_e]!="function")throw new Error(N.locale.bind(Wi)("service.unavailable"));
  let Ro=await Ot[_e].apply(Ot,nt);
  if(!Ro.ok)throw new Error(Ro.error.message);
  return Ro.value
},"registryCall")
```

```js
deleteOne:o(async _e=>{
  let nt=N.get("remote.workspaceRegistry");
  if(!nt)throw new Error(N.locale.bind(Wi)("service.unavailable"));
  let Ot=await nt.deleteSession(_e);
  if(!Ot.ok)throw new Error(Ot.error.message)
},"deleteOne")
```

#### (c) A counter-example worth knowing: `connection.rpc.call('/api', '<namespace>/<method>')`

`deepseek-flow`'s client half does **not** use `ctx.remote` at all; it goes through the older Connection gateway RPC. `/data/dsh/profiles/web/node_modules/deepseek-flow/src/client/entry.js:45` and lines 50-54:

```js
const inject = ["slots", "connection", "locale"];
…
async function remoteCall(connection, endpoint, args = {}) {
  const result = await connection.rpc.call("/api", endpoint, { args });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
```

Call sites use the same `<namespace>/<method>` endpoint string, e.g. `remoteCall(connection, "dflow/list", { sessionId })`, `remoteCall(connection, "dflow/draftGet", { sessionId, flowId: flow.id })`, `remoteCall(connection, "dflow/models")`. So `dflow` is reachable by both carriers; the Typert client is the newer one.

### Q1.6 Is the value a promise? How do errors surface?

- **Always a promise.** Every layer is `async`: `$mount(contribution): Promise<TypertDisposer>`; `TypertRemoteMap` methods resolve to `Promise<RemoteResult<T>>` (`RemoteResult<T>` = `{ok:true,value}` | `{ok:false,error}`); the cost-meter helper does `await a[C](...Q)`.
- **Two equivalent error idioms**:
  1. **Envelope check** — inspect `.ok` and branch (cost-meter statistics: `if(!m?.ok)throw new Error(m?.error?.message||"Statistics request failed")`; archive-manager: `if(!Ro.ok)throw new Error(Ro.error.message)`).
  2. **Throw the error branch** — `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/remote-error.d.ts` documents that a `RemoteError` thrown by an owner is encoded onto the wire unchanged and rebuilt on the client, *"so `throw result.error` keeps throw semantics. Discrimination is always by `code`, never by instanceof."*
- `RemoteError` (same file):
  ```ts
  export declare class RemoteError<Code extends RemoteErrorCode = RemoteErrorCode> extends Error {
      readonly code: Code;
      readonly details: RemoteErrorDetailsMap[Code];
      readonly isDSHRemoteError: true;
      constructor(code, message, details, options?);
  }
  ```
- Universal error codes declared in `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts`: `'gateway/bad-request'` (details `{ issues?: readonly object[] }`), `'gateway/cancelled'`, `'gateway/internal'`, plus per-namespace merge-declared codes.
- The gateway folds carrier faults into results rather than rejecting: `carrierFailure()` → `gateway/internal` and `cancelledFailure()` → `gateway/cancelled` (`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/types/client/index.d.ts:52-70`).

---

## Q2. `ToolSchema`, `ToolOutputDefinition`, `defineTool`, and real registrations

### Q2.1 `ToolSchema` verbatim (from `@deepseek-ai/dsh-llm`)

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:448-466`

```ts
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
export interface ToolSchema {
    /**
     * Requests deferred loading of the tool definition into model context,
     * independently of whether a tool-addition block records the tool.
     * Uses Anthropic's defer_loading terminology.
     */
    deferLoading?: true;
    name: string;
    description: string;
    /** JSON Schema object for the arguments. */
    parameters: Record<string, unknown>;
}
```

Note: `ToolSchema` is declared **only** in `@deepseek-ai/dsh-llm`; `@deepseek-ai/dsh-tools` imports it. Other references in this install: `dsh-llm/lib/types/content.d.ts:136,148` and `dsh-llm/lib/types/types.d.ts:479,485,508`.

### Q2.2 `ToolOutputDefinition` verbatim (from `@deepseek-ai/dsh-tools`)

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:105-117`

```ts
/** Tool-owned canonical output contract used after the body returns a JSON value. */
export interface ToolOutputDefinition {
    /** Raw supported JSON Schema enforced against every successful canonical value. */
    readonly schema: JsonSchemaNode;
    /** Pure projection from validated arguments and value to Native/model content. */
    render(args: unknown, value: JsonValue): ContentBlock[];
    /** Pure replayable presentation projection, computed only for top-level calls. */
    presentationMeta?(args: unknown, value: JsonValue): JsonValue;
}
/** A registered tool: its schema plus the execution function. */
export interface ToolDefinition extends ToolSchema {
    /** Mandatory canonical output declaration. */
    readonly output: ToolOutputDefinition;
```

`execute` on the same interface (lines 118-128):

```ts
    /**
     * Run one accepted call and return only its canonical lossless-JSON value.
     * Async work must observe or forward `exec.signal` …
     * @returns the canonical value declared by `output.schema`.
     */
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
```

Optional `ToolDefinition` members (lines 129-190): `projectContent?`, `finalizeContent?`, `timeoutMs?`, `isConcurrencySafe?`, `presentCall?`, `presentResult?`. The `timeoutMs` doc says it is *"Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it is NEVER sent to the model — `schemas()` whitelists only name/description/parameters."*

### Q2.3 `defineTool` verbatim (from `@deepseek-ai/dsh-tools/lib/types/schema.d.ts`)

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts` (249 lines). Module header, line 1:

```ts
/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
```

Signature and doc, lines 241-248:

```ts
/**
 * Define a first-party tool with inferred arguments and strict execution validation.
 * Replay-only presenters validate softly and fall back to generic rendering for
 * obsolete logged arguments.
 * @param options - typed definition and optional finalizer and presenters.
 * @returns A registry-ready definition.
 */
export declare function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(
    options: DefineToolOptions<S, O>
): ToolDefinition;
```

`DefineToolOptions`, lines 178-239:

```ts
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
    readonly name: string;
    readonly description: string;
    readonly parameters: S;
    readonly output: {
        readonly schema: O;
        render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
        presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue;
    };
    readonly deferLoading?: true;
    readonly timeoutMs?: number;
    isConcurrencySafe?(args: InferArgs<S>): boolean;
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
    projectContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    presentCall?(args: InferArgs<S>): ToolCallView | undefined;
    presentResult?(args: InferArgs<S>, result: ToolResult): ToolResultView | undefined;
}
```

The parameter DSL (lines 58-84) is **not** raw JSON Schema — it is a small typed spec that the helper compiles:

```ts
// ValueSchemaSpec union (line 72): string | number | integer | boolean | null | array | object | `json` | oneOf
export type ParameterPropertySpec = ValueSchemaSpec & { required?: true };   // lines 74-76
export type ParameterSchemaSpec = { [key: string]: ParameterPropertySpec };  // lines 81-84
```

Key consequences:

- the top-level `parameters` map **is** an implicit open object root — there is no explicit `{type:'object', properties:{…}}`;
- a property is required **only** via `required: true` on that property; properties without it are optional;
- `{ type: 'json' }` accepts any lossless JSON value;
- `oneOf` takes at least two alternatives (`oneOf: readonly [ValueSchemaSpec, ValueSchemaSpec, ...]`), which is how nullable fields are written.

Compilation/validation helpers in the same file:

```ts
export declare function valueSchemaSpecToJsonSchema(spec: ValueSchemaSpec): JsonSchemaNode;        // line 157
export declare function parameterSchemaSpecToJsonSchema(spec: ParameterSchemaSpec): ParameterJsonSchema; // line 163
export declare class ToolArgsError extends HarnessError { readonly violations: string[]; constructor(violations: string[]); } // lines 165-168
export declare function validateArgs(spec: ParameterSchemaSpec, args: unknown): string[];          // line 176
```

### Q2.4 `ctx.tools.register` signature

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:630-637`

```ts
    /**
     * Register globally or in the calling agent scope. Scoped tools shadow
     * globals; duplicates within one layer and the reserved `run_code` name fail.
     * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
     * @returns the exact disposer that unregisters the tool.
     */
    register(definition: ToolDefinition): () => void;
    restrict(filter: ToolRestriction): () => void;
```

`ToolRuntime` class header (lines 523-527):

```ts
/** Tool registry and execution pipeline. Scoped registrations shadow globals; one visibility resolver feeds presentation, lookup, and dispatch. */
export declare class ToolRuntime extends Service {
    static inject: string[];
    static Config: z<Config>;
```

### Q2.5 Real `ctx.tools.register(defineTool({...}))` usages

#### Example 1 (minimal, in a third-party plugin): `@nagi-ovo/dsh-visualize`

`/data/dsh/profiles/web/node_modules/@nagi-ovo/dsh-visualize/src/index.ts:21-48`:

```ts
/** Cordis plugin name. */
export const name = 'dsh-visualize'
/** Required services: the tool registry, the skill registry, and the fs seam. */
export const inject = ['tools', 'skills', 'fs']

export interface Config {
  maxFragmentBytes: number
}

/** Schemastery configuration validated by the Loader. */
export const Config: z<Config> = z.object({
  maxFragmentBytes: z.natural().default(1_000_000),
})

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(visualizeTool(ctx, config.maxFragmentBytes))
  ctx.skills.registerProvider(() => visualizeSkillProvider)
}
```

(compiled mirror: `/data/dsh/profiles/web/node_modules/@nagi-ovo/dsh-visualize/lib/index.js:393`)

`/data/dsh/profiles/web/node_modules/@nagi-ovo/dsh-visualize/src/tool.ts:14-15, 56-58`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
…
export function visualizeTool(ctx: Context, maxFragmentBytes: number): ToolDefinition {
  return defineTool({
    name: VISUALIZE_TOOL_NAME,
```

`parameters` (lines 60-97, abridged where descriptions are long):

```ts
    parameters: {
      action: { type: 'string', enum: ['create', 'update'], description: … },
      fragment: { type: 'string', description: … },
      title: { type: 'string', description: … },
      mode: { type: 'string', enum: ['inline', 'wide'], description: … },
      path: { type: 'string', description: … },
      old_str: { type: 'string', description: … },
      new_str: { type: 'string', description: … },
    },
```

`output.schema` and `render` + `presentationMeta` (lines 99-131):

```ts
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true, enum: ['create', 'update'] },
          path: { type: 'string', required: true },
          title: { type: 'string', required: true },
          mode: { type: 'string', required: true, enum: ['inline', 'wide'] },
          sizeBytes: { type: 'integer', required: true },
          fragment: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: … }],
      presentationMeta: (_args, value) => ({ kind: 'visualize', fragment: value.fragment, title: value.title, mode: value.mode, path: value.path }),
    },
```

`execute` (lines 137-184) returns a plain object matching `output.schema` and forwards `exec.signal` to every fs call:

```ts
    async execute(args, exec) {
      …
      const sandboxPolicy = ctx.get('sandboxPolicy')?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} });
      const cwd = sandboxPolicy?.workspaceRoot ?? exec.agent?.session.header.cwd;
      const resolveOpts = { ...cwd !== undefined ? { cwd } : {}, signal: exec.signal };
      …
      await ctx.fs.writeText(target, fragment, undefined, exec.signal, sandboxPolicy);
      return { action, path: target.displayPath, title, mode: (args.mode ?? 'inline'), sizeBytes, fragment };
    }
```

plus `isConcurrencySafe: args => (args.action ?? 'create') === 'create'` (line 136), `presentCall` (line 185) and `presentResult(_args, result)` (lines 187-198, which checks `result.isError` and reads `result.meta`).

#### Example 2 (raw JSON Schema output, `type: 'json'` result): `@michengai/dsh-automation`

`/data/dsh/profiles/web/node_modules/@michengai/dsh-automation/lib/index.js`:

```js
// line 23077
import { defineTool } from "@deepseek-ai/dsh-tools";
```

```js
// lines 23089-23095
function render(_args, value) {
  return [{ type: "text", text: JSON.stringify(value) }];
}
var JSON_OUTPUT = {
  schema: { type: "json" },
  render
};
```

```js
// lines 23117-23119
function json2(value) {
  return JSON.parse(JSON.stringify(value));
}
```

```js
// lines 23161-23167 — registration goes through the AGENT's scoped ctx
function registerAutomationTools(service, agent) {
  …
  const register = (definition) => {
    disposers.push(agent.ctx.tools.register(definition));
  };
```

```js
// lines 23169-23207 (abridged)
  register(defineTool({
    name: "automation_create",
    description: AUTOMATION_CREATE_DESCRIPTION,
    parameters: {
      name: { type: "string", required: true },
      prompt: { type: "string", required: true, description: "每次独立运行都使用的自包含任务说明。" },
      kind: { type: "string", required: true, enum: ["once", "interval", "hourly", "daily", "weekly", "monthly", "custom"] },
      time_zone: { type: "string", required: true, description: "IANA 时区，例如 Asia/Shanghai。" },
      at: { type: "string", … },
      every_minutes: { type: "integer", … },
      minute: { type: "integer", … },
      time: { type: "string", … },
      weekdays: { type: "array", items: { type: "string", enum: WEEKDAYS2 } },
      month_day: { type: "integer", … },
      every_days: { type: "integer", … },
      max_concurrent_runs: { type: "integer", … },
      permission: { type: "string", enum: permissionNames },
      ...MODEL_PARAMETERS
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) return json2({ ok: false, code: "cancelled" });
      try {
        const value = await service.create(scope, { … }, exec.signal);
        return json2({ ok: true, automation: value });
      } catch (error51) {
        if (exec.signal.aborted) return json2({ ok: false, code: "cancelled" });
        return json2({ ok: false, code: "automation_error", message: error51 instanceof Error ? error51.message : String(error51) });
      }
    },
    presentCall: (args) => present("创建自动化", "other", args.name)
  }));
```

Note the nullable-field idiom in `MODEL_PARAMETERS` (lines 23096-23109):

```js
provider: {
  oneOf: [{ type: "string" }, { type: "null" }],
  description: "…"
},
```

#### Example 3 (thin wrapper plugin, throws on failure, `parameters: {}`): `deepseek-flow`

`/data/dsh/profiles/web/node_modules/deepseek-flow/lib/index.js:39-41`:

```js
export const name = "deepseek-flow";
// apply() 中通过 ctx.tools.register 注册工具，需声明 tools 服务依赖
export const inject = ["tools"];
```

Registration at lines 702-741 (abridged):

```js
ctx.tools.register(defineTool({
  name: "flow_create",
  description: "优先用这个工具新建 DeepSeekFlow 工作流。…",
  parameters: {
    name: { type: "string", description: "工作流名称。省略时使用用户语言生成默认名称。" },
    description: { type: "string", description: "总目标、交付标准和约束。" },
    steps: { type: "json", description: "有序步骤数组；…" },
    connections: { type: "json", description: "可选连线数组 [{source,target,branch?,feedback?}]。…" },
    doc_root: { type: "string", description: "可选的文档工作区绝对路径；…" },
    language: { type: "string", description: "默认标签语言：en 或 zh。…" }
  },
  output: { schema: { type: "json" }, render: renderJson },
  async execute(args, exec) {
    const sessionId = sessionOf(exec);
    if (!sessionId) throw new Error("No current session");
    …
    return {
      ok: true,
      id: next.id,
      name: next.name,
      revision: next.revision,
      topologyPersisted: true,
      studioAction: "The topology is already saved. …",
      workflow: join(next.docRoot, next.workflowDoc),
      stepFiles: Object.values(next.docs).map((path) => join(next.docRoot, path))
    };
  }
}));
```

Further registrations in the same file at lines 743, 773, 833, 855, 897, 935, using `required: true`, e.g.:

```js
id: { type: "string", required: true, description: "flow id；先用 flow_list 获取。" }
values: { type: "json", required: true, description: "上游节点结果对象，例如 {\"check-a\": true, \"check-b\": false}。" }
```

#### Other `defineTool` importers in this install

Profile: `@michengai/dsh-automation`, `@nagi-ovo/dsh-visualize`, `deepseek-flow`, `dsh-better-sidebar`, `dsh-univer-office`.
Core: `dsh-tool-str-replace-editor`, `dsh-tool-bash`, `dsh-tool-workspace-dependencies`, `dsh-schedule`, `dsh-tool-cordis`, `dsh-plan-mode`, `dsh-tool-pwsh`, `dsh-tool-ask-user`, `dsh-tool-workflow`, `dsh-tool-fs-search`, `dsh-tool-ralph`, `dsh-tool-present`, `dsh-mcp-resources`, `dsh-tool-pwsh-persistent`, `dsh-tool-fs`, `dsh-tool-jobs`, `dsh-tool-goal`, `dsh-plugin-manager`.

### Q2.6 How `execute(args, exec)` returns values and signals errors

`ToolRunContext extends ToolExecution` (`…/dsh-tools/lib/types/index.d.ts:305-322`) adds `deferContext(context: UserMessage): void` and `concludeTurn(): void`; `ToolExecution` adds `rootCallId: ToolCallId` and `token: ToolExecutionToken` (lines 282-287).

**Return value.** `execute` returns `Promise<InferValue<O>>` — "only its canonical lossless-JSON value" — which is then validated against `output.schema` and projected by `output.render` into `ContentBlock[]`. Returning `{ ok: false, … }` is just a JSON value, not a signal.

**Error signalling — two idioms in practice:**

1. **Throw an `Error`** → becomes an error result. `deepseek-flow` does `throw new Error("No current session")`. For argument validation specifically, throw `ToolArgsError`:
   `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:165-168` + usage in
   `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js:72-78`:
   ```js
   execute(args, exec) {
     const violations = validateJsonSchemaValue(schema, args);
     if (violations.length > 0) throw new ToolArgsError(violations);
     staged.set(exec, { value: args });
     exec.concludeTurn();
     return Promise.resolve({ recorded: true });
   }
   ```
   A body that returns a value violating `output.schema` raises `ToolOutputError` (`…/index.d.ts:406-411`: *"Thrown when a tool body or post-policy value violates its declared output."*, `readonly violations: string[]`).

2. **Return a discriminated JSON value** — `@michengai/dsh-automation` never throws for domain failure; it returns `{ ok: false, code: 'automation_error', message }` and checks `exec.signal.aborted` to report `{ ok: false, code: 'cancelled' }`.

**Result envelope after execution** (`…/index.d.ts:412-435`):

```ts
export interface ToolExecutionSuccess {
    readonly isError: false;
    readonly value: JsonValue;
    readonly content: ContentBlock[];
    readonly error?: never;
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: true;
}
export interface ToolExecutionFailure {
    readonly isError: true;
    readonly error: ToolFailure;
    readonly value?: never;
    readonly content: ContentBlock[];
    readonly meta?: JsonValue;
    readonly additionalContexts?: UserMessage[];
    readonly concludesTurn?: never;
}
export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;
```

**Policy objects:**

```ts
// lines 436-460
export type PreToolDecision =
    | { kind: 'allow' }
    | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
    | { kind: 'cancel' }
    | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } };
// lines 461-479
export type PostToolDecision =
    | { kind: 'accept'; content?: ContentBlock[]; value?: never; additionalContexts? }
    | { kind: 'accept'; value: JsonValue; content?: never; additionalContexts? }
    | { kind: 'block'; feedback: ContentBlock[]; additionalContexts? };
```

---

## Q3. `ctx.tools.guard()` in practice

### Q3.1 `ToolGuard` verbatim

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:504-522`

```ts
/** Per-scope filter over global tools. Restrictions intersect and do not affect scoped registrations or the reserved PTC mode transport. */
export interface ToolRestriction {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
}
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute` listener and
 * before the tool body. Returning a reason denies the call; returning `undefined`
 * leaves it unchanged. Because guards have no allow result, listener ordering cannot
 * turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
export type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined;
```

Registration API, same file lines 646-656:

```ts
    /**
     * Register a monotonic guard after the extensible `tools/pre-execute` waterfall.
     * A plain-context guard applies globally; one registered through `agent.ctx`
     * applies only to that agent. Any matching guard may deny by returning a reason,
     * while no guard can force-allow a call another guard denied.
     * The exact effect disposer is returned…
     */
    guard(guard: ToolGuard): () => void;
    private guardReason;
```

Implementation, `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js:2921-2936`:

```js
    guard(guard) {
      return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), { label: "tools.guard()", notify: false });
    }
```

and the evaluation order (`guardReason(exec)`): the global layer first, then each agent-scope layer from `this.layers.chainLayers(exec.agent)`.

### Q3.2 `ToolExecutionInput` / `ToolExecution` verbatim — the fields a guard can identify a call by

**File:** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:211-242`

```ts
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
export interface ToolExecutionInput {
    readonly callId: ToolCallId;
    /**
     * Root model-requested call owning this execution tree. Callers omit it for
     * a root execution; nested dispatchers propagate the enclosing value.
     */
    readonly rootCallId?: ToolCallId;
    readonly name: string;
    /** Binding-time tool schema for a PTC inner call; frozen by its producer and never logged. */
    readonly schema?: ToolSchema;
    /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
    readonly arguments: unknown;
    /** The agent on whose behalf the call runs (set by the agent loop). */
    readonly agent?: Agent;
    /**
     * Opaque token of the enclosing transport execution, when one exists. PTC
     * mode sets this on SDK sub-dispatches so commit-style observers can wait for
     * the outer `run_code` outcome without receiving its live mutable execution.
     * The token also marks the call as a transport sub-dispatch rather than a
     * model-direct call: under `mode: 'ptc'`, only calls WITH a parent may
     * execute a native tool name — a model-direct call (no parent) is denied as
     * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
     */
    readonly parent?: ToolExecutionToken;
    /** Required caller-owned cancellation for this invocation. */
    readonly signal: AbortSignal;
}
```

```ts
// lines 282-287
export interface ToolExecution extends ToolExecutionInput {
    readonly rootCallId: ToolCallId;
    readonly token: ToolExecutionToken;
}
```

and the run context the tool body receives (lines 305-322):

```ts
export interface ToolRunContext extends ToolExecution {
    deferContext(context: UserMessage): void;
    concludeTurn(): void;
}
```

So a guard sees `execution.name`, `execution.arguments`, `execution.agent`, `execution.signal`, `execution.callId`/`rootCallId`, and `execution.token` — and must return either a denial reason string or `undefined`.

### Q3.3 Real `ctx.tools.guard(...)` registrations

**Yes — three in an installed third-party plugin and one in a core package.**

A whole-install search for `ctx.tools.guard|tools.guard(` in the DSH core tree matched exactly `dsh-tools/lib/types/index.js`, `dsh-tools/lib/index.js`, `dsh-subagent-in-process-driver/lib/index.js`. A search of the profile plugin tree matched exactly `dsh-mcp-connector/lib/{index.js,governance.js,connection-scopes.js,session-injection.js}`.

#### (a) Installed plugin `dsh-mcp-connector` — workspace-scope guard

`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/connection-scopes.js:274-280`:

```js
const disposeGuard = typeof ctx.tools?.guard === 'function'
  ? ctx.tools.guard((execution) => {
      const record = recordForPublicName(execution.name);
      if (!record || visible(record, execution.agent)) return undefined;
      return `MCP 工具 ${execution.name} 不属于当前工作区`;
    })
  : null;
```

#### (b) Installed plugin `dsh-mcp-connector` — governance-policy guard

`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/governance.js:296-302`:

```js
const disposeGuard = typeof ctx.tools?.guard === 'function'
  ? ctx.tools.guard((execution) => {
      const resolved = inspect(execution.name);
      if (resolved?.policy.effect !== 'deny') return undefined;
      return `MCP 工具 ${execution.name} 已被${resolved.policy.sourceLabel}拒绝`;
    })
  : null;
```

#### (c) Installed plugin `dsh-mcp-connector` — per-session activation guard (the richest example: it exercises `name`, `agent`, and multiple denial reasons)

`/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/session-injection.js:188-199`:

```js
const disposeGuard = typeof ctx.tools?.guard === 'function'
  ? ctx.tools.guard((execution) => {
      const record = recordForPublicName(execution.name);
      if (!record || normalizeInjectionMode(record.injectionMode) !== 'session') return undefined;
      if (record.enabled === false) return `MCP 工具 ${execution.name} 所属连接已停用`;
      if (!execution.agent) return `MCP 工具 ${execution.name} 需要当前会话显式激活`;
      if (!isRecordVisible(record, execution.agent)) return `MCP 工具 ${execution.name} 不属于当前工作区`;
      if (!isToolAllowed(execution.name, record)) return `MCP 工具 ${execution.name} 已被治理策略拒绝`;
      if (!activationValid(execution.agent, execution.name)) return `MCP 工具 ${execution.name} 未在当前会话激活或已过期`;
      return undefined;
    })
  : null;
```

This plugin also feature-detects the API and fails loudly rather than silently degrading, `/data/dsh/profiles/web/node_modules/dsh-mcp-connector/lib/session-injection.js:201-206`:

```js
function assertSessionCapabilities() {
  const current = capabilities();
  if (!current.executionGuard || !current.visibilityRestriction) {
    throw new Error('当前 DSH Host 不同时支持 tools.guard 与 Agent tools.restrict，不能安全使用按会话注入');
  }
}
```

#### (d) Core package `dsh-subagent-in-process-driver` — agent-scoped guard via `childCtx`

`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js:85`:

```js
childCtx.tools.guard((exec) => captured === void 0 && pending === void 0 ? void 0 : `structured output already recorded: the run is complete, so \`${exec.name}\` is not executed`);
```

This is the "register through `agent.ctx` to scope to one agent" pattern that the `guard()` doc describes. Immediately before it (lines 72-78) the same driver shows `ToolArgsError`-based argument validation, and at line 86 it subscribes to results via `childCtx.on("tools/result", function(exec, result) {`.

### Q3.4 Closest alternative: the `tools/pre-execute` waterfall

The guard doc itself says guards run *"after every `tools/pre-execute` listener"*, and guards are strictly stronger (no allow result):

```ts
export type PreToolDecision =
    | { kind: 'allow' }
    | { kind: 'deny'; reason: string; info?: ToolErrorInfo }
    | { kind: 'cancel' }
    | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } };
```

So `ctx.on('tools/pre-execute', …)` → return `{ kind: 'deny', reason }` is the extensible-listener equivalent, but it is **not** monotonic: later listeners can still allow a call an earlier listener denied, which is exactly what `ToolGuard` prevents. Not required here since real `ctx.tools.guard` usages exist.

---

## Uncertainties

1. **`@deepseek-ai/dsh-typert-generator` is not present in this install.** The cost-meter manifest header references it as the source of the `lib/typert.host.js` + client-contribution shape, and several core packages ship generated-looking `lib/typert.remote-client.d.ts` files (seen on `dsh-api-terminal-controller`, `dsh-user-questions`, `dsh-agent-preset-registry`). The generator's own input format/schema was not inspected, so the exact authoring workflow for a *generated* (as opposed to hand-written or decorator) manifest is unverified.
2. **No decorator-syntax (`@Remote method() {}`) source was found in an installed plugin.** All plugins here ship compiled or plain JS and apply the decorator imperatively — `Remote(method)(function() {…})` in `archive-manager/lib/workspace.js:78` and the `Remote(exportName)(method, {name, private:false, static:false, addInitializer})` loop in `deepseek-flow/lib/index.js:235-250`. The TypeScript class-decorator form is therefore documented from the `.d.ts` only, not observed in source.
3. **No third-party plugin was observed using `ctx.inject(['remote', 'remote.<its-own-namespace>'])`.** Both observed self-namespace plugins (`dsh-cost-meter`, `@michengai/dsh-archive-manager`) instead do `ctx.get('remote')` → `$mount(contribution)` → `ctx.get('remote.<ns>')`. The `ctx.inject(['remote', 'remote.X'])` form was only observed for a **core**-provided namespace (`remote.skills` in `skills-management/client/index.js:2226`). Whether subpath injection also works for a plugin's own mounted namespace was not verified at runtime.
4. **The namespace→descriptor wiring for the "overlay" remote in archive-manager is dynamic.** `bindOverlayRemote` reads a service key off the instance and reflects `typertRemote` on/off (`lib/workspace.js:1256-1264`, used as `restoreRemote` at 1290/1307). The exact lifecycle guarantees of that reflective binding were not traced.
5. **`RemoteScope` / scoped-namespace endpoints (`<ContextKey>:<Namespace>/<Method>`) were read from types only.** No installed plugin was found using `RemoteScope`, so no runtime example of the scoped key format is included.
6. **`ToolExecution.schema` semantics.** The field is `readonly schema?: ToolSchema` on `ToolExecutionInput`; it was not verified whether it is always populated by the dispatch pipeline before guards run (in the observed guards only `name`, `agent` and `arguments` are used).
7. **`ToolGuard` "identity-protected" wording.** The doc says the guard receives the *"identity-protected call"*; the concrete mechanism (whether `arguments` is frozen or a proxy) is described in `dsh-tools/lib/index.js` beyond the lines read and was not quoted here.
8. **Guard execution order across layers** is stated in the doc as global-then-agent-chain and corroborated by `guardReason` in `dsh-tools/lib/index.js:2928-2936`, but the ordering *within* a single layer (append order vs. reverse) was not confirmed.
9. **The Gateway's "source-mode discovery" of `typertRemote` fields was not traced.** `bindTypertRemote` merely freezes `{service, serviceKey, namespace}` onto the service and the comment calls it *"Visible binding consumed by the Gateway's source-mode discovery"* (`dsh-typert-protocol/lib/index.js:146-161`). How/when the Host Gateway scans for those fields (at service registration, at first call, or via a Cordis accessor), and whether a service constructed *outside* a plugin `apply` would still be discovered, are unverified.
10. **`ctx.remote` vs `ctx.typert` on the client.** The client-side `typert` Cordis service is also injected by some client bundles (e.g. `archive-manager` client inject list contains both `"remote"` and `"typert"`), but its client-side API surface was not inspected for this report; only `remote` was traced.
