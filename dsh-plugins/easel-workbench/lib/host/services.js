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
