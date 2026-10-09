/**
 * 读取 DSH 宿主服务（全部按**可选能力**处理）。
 *
 * 为什么不能直接写 `ctx.schedule`：cordis 的上下文代理只允许读取当前插件
 * `inject` 里声明过的服务属性，否则在属性读取的瞬间抛
 * `Error: cannot get property "schedule" without inject`（实测：宿主半边因此整条
 * 记录激活失败，HTTP 前缀从未注册，面板每个子页报 HTTP 404）。
 *
 * 本插件的静态 `inject` 故意保持为空——工作台在缺少任何一项能力时都必须能打开，
 * 只是对应功能降级并给出可读原因；把可选服务写进静态 `inject` 会让插件在缺失时
 * 永久停在 INACTIVE。因此一律经由 `ctx.get(name)` 读取：`ctx.get` 的契约定为
 * 「不要求 inject」，未提供或提供者未激活时返回 undefined
 * （cordis `ReflectService.get`，见设计 D15）。
 *
 * @param {Record<string, any> | undefined} ctx 插件上下文（或测试替身）
 * @param {string} name 服务名
 * @returns {any} 服务实例；未提供或提供者未激活时为 undefined
 */
export function serviceOf(ctx, name) {
  return ctx?.get?.(name);
}

/**
 * 把一个宿主服务包装成**延迟解析**的取用函数。
 *
 * 为什么不能像过去那样在 `apply()` 里取一次就存下来：DSH 的服务注册顺序不由插件控制。
 * 实测本机重启后 `ctx.get("subprocess")` 在插件挂载那一刻返回 `undefined`、而请求到达时
 * 已可用——于是账号「验证」报「DSH 子进程服务不可用」，同一进程的环境自检却把
 * `subprocess` 判为可用（自检是调用时才解析的）。服务要当**能力**而不是**快照**持有。
 *
 * 消费方（`lib/host/exec.js` 的 `runCommand`）同时接受服务对象与解析器，测试替身仍是普通对象。
 *
 * @param {Record<string, any> | undefined} ctx 插件上下文
 * @param {string} name 服务名
 * @returns {() => any} 每次调用都重新查询的解析器
 */
export function lazyService(ctx, name) {
  return () => serviceOf(ctx, name);
}
